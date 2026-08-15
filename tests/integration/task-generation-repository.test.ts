import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import type { GenerationRuntimeEvent } from "../../src/application/generation-runtime-contract";
import { GenerationTaskConflictError } from "../../src/application/task";
import type { TaskOwner } from "../../src/domain";
import {
  createChatThread,
  createGenerationRun,
  createSubtitleSnapshot,
  createVideoRef,
} from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbGenerationRepository } from "../../src/infrastructure/indexeddb/generation-repository";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-generation-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

async function createFixture() {
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: createDatabaseName(),
  });
  const video = createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    cid: 30_000_000_002,
    page: 2,
    title: "generation repository",
  });
  const session = await new IndexedDbSessionRepository(database, {
    createSessionId: () => "generation-session",
    now: () => 100,
  }).create(video);
  const acquisition = {
    acquisitionId: "generation-acquisition",
    draftBranchId: "generation-branch",
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: session.sessionId,
    taskId: "generation-acquisition-task",
    videoKey: video.videoKey,
  };
  const subtitles = new IndexedDbSubtitleRepository(database, {
    now: () => 200,
  });
  await subtitles.beginAcquisition(acquisition, {
    method: "direct",
    trackId: "official:en:1",
  });
  await subtitles.commitAcquisition(
    acquisition,
    createSubtitleSnapshot({
      branchId: acquisition.draftBranchId,
      contentHash: "sha256:generation",
      createdAt: 200,
      language: "en",
      rows: [{ endMs: 1_000, startMs: 0, text: "generation" }],
      sessionId: acquisition.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "generation-subtitle",
      videoKey: acquisition.videoKey,
    }),
  );
  const owner: TaskOwner = {
    branchId: acquisition.draftBranchId,
    contextRevision: 1,
    expectedOwnerRevision: 0,
    kind: "chat",
    sessionId: acquisition.sessionId,
    subtitleId: "generation-subtitle",
    targetId: "generation-thread",
    taskId: "generation-task",
  };
  const transaction = database.transaction(
    ["chatThreads", "generationRuns"],
    "readwrite",
  );
  transaction.objectStore("chatThreads").put(
    createChatThread({
      branchId: owner.branchId,
      chatThreadId: owner.targetId,
      conversationRevision: owner.expectedOwnerRevision,
      createdAt: 300,
      order: 0,
      sessionId: owner.sessionId,
      subtitleId: owner.subtitleId,
      title: null,
      updatedAt: 300,
    }),
  );
  transaction.objectStore("generationRuns").put(
    createGenerationRun({
      ...owner,
      browserSessionId: "browser-session-a",
      completionSequence: null,
      createdAt: 300,
      errorCode: null,
      partialOutput: "",
      runId: "generation-run",
      status: "running",
      stopReason: null,
      updatedAt: 300,
    }),
  );
  await transactionDone(transaction);
  return {
    database,
    owner,
    repository: new IndexedDbGenerationRepository(database, { now: () => 400 }),
  };
}

function event(
  owner: TaskOwner,
  type: GenerationRuntimeEvent["type"],
  payload: GenerationRuntimeEvent["payload"],
): GenerationRuntimeEvent {
  return {
    ...owner,
    payload,
    protocolVersion: 1,
    requestId: "generation-request",
    type,
  } as GenerationRuntimeEvent;
}

describe("IndexedDbGenerationRepository", () => {
  it("atomically begins, replays, and rejects conflicting active generation owners", async () => {
    const { database, owner, repository } = await createFixture();
    try {
      const removeExisting = database.transaction(
        "generationRuns",
        "readwrite",
      );
      removeExisting.objectStore("generationRuns").delete("generation-run");
      await transactionDone(removeExisting);
      const candidate = createGenerationRun({
        ...owner,
        browserSessionId: "browser-session-a",
        completionSequence: null,
        createdAt: 400,
        errorCode: null,
        partialOutput: "",
        runId: "generation-run-new",
        status: "queued",
        stopReason: null,
        updatedAt: 400,
      });

      await expect(repository.begin(candidate)).resolves.toEqual(candidate);
      await expect(
        repository.begin({ ...candidate, runId: "ignored-replay-run" }),
      ).resolves.toEqual(candidate);
      await expect(
        repository.begin({
          ...candidate,
          runId: "generation-run-conflict",
          taskId: "generation-task-conflict",
        }),
      ).rejects.toBeInstanceOf(GenerationTaskConflictError);
      await expect(repository.listQueuedOrRunning()).resolves.toEqual([
        candidate,
      ]);
    } finally {
      database.close();
    }
  });

  it("atomically applies an owner-correlated completion and assigns the Branch completion sequence", async () => {
    const { database, owner, repository } = await createFixture();
    try {
      await expect(
        repository.applyEvent(
          event(owner, "muzhi.generation.reasoning", {
            text: "transient reasoning only",
          }),
          400,
        ),
      ).resolves.toBeNull();
      const reasoningRead = database.transaction("generationRuns", "readonly");
      await expect(
        requestResult(
          reasoningRead.objectStore("generationRuns").get("generation-run"),
        ),
      ).resolves.toMatchObject({
        partialOutput: "",
        status: "running",
        updatedAt: 300,
      });
      await transactionDone(reasoningRead);

      await expect(
        repository.applyEvent(
          event(owner, "muzhi.generation.delta", { delta: "partial " }),
          400,
        ),
      ).resolves.toMatchObject({ partialOutput: "partial " });
      await expect(
        repository.applyEvent(
          event(owner, "muzhi.generation.completed", {
            completionSequence: 999,
            output: "final output",
          }),
          400,
        ),
      ).resolves.toMatchObject({
        completionSequence: 1,
        partialOutput: "final output",
        status: "completed",
      });

      const transaction = database.transaction(
        ["generationRuns", "subtitleBranches"],
        "readonly",
      );
      const [run, branch] = await Promise.all([
        requestResult(
          transaction.objectStore("generationRuns").get("generation-run"),
        ),
        requestResult(
          transaction.objectStore("subtitleBranches").get(owner.branchId),
        ),
      ]);
      await transactionDone(transaction);
      expect(run).toMatchObject({
        completionSequence: 1,
        partialOutput: "final output",
        status: "completed",
      });
      expect(branch).toMatchObject({ completionSequence: 1 });
    } finally {
      database.close();
    }
  });

  it("drops mismatched, terminal, and legacy heterogeneous-store events without mutating a run", async () => {
    const { database, owner, repository } = await createFixture();
    try {
      await expect(
        repository.applyEvent(
          event({ ...owner, contextRevision: 2 }, "muzhi.generation.delta", {
            delta: "wrong",
          }),
          400,
        ),
      ).resolves.toBeNull();
      await expect(repository.stopByUser(owner, 400)).resolves.toMatchObject({
        runId: "generation-run",
        status: "stopped",
        stopReason: "user",
      });
      await expect(
        repository.applyEvent(
          event(owner, "muzhi.generation.delta", { delta: "late" }),
          400,
        ),
      ).resolves.toBeNull();

      const transaction = database.transaction("generationRuns", "readwrite");
      transaction.objectStore("generationRuns").put({
        runId: "legacy-acquisition",
        taskId: "legacy-task",
        status: "running",
      });
      await transactionDone(transaction);
      await expect(
        repository.applyEvent(
          event({ ...owner, taskId: "legacy-task" }, "muzhi.generation.delta", {
            delta: "ignored",
          }),
          400,
        ),
      ).resolves.toBeNull();
    } finally {
      database.close();
    }
  });

  it("drops an event when the Branch context revision advanced", async () => {
    const { database, owner, repository } = await createFixture();
    try {
      const transaction = database.transaction("subtitleBranches", "readwrite");
      const branch = await requestResult(
        transaction.objectStore("subtitleBranches").get(owner.branchId),
      );
      transaction.objectStore("subtitleBranches").put({
        ...branch,
        contextRevision: 2,
        updatedAt: 401,
      });
      await transactionDone(transaction);

      await expect(
        repository.applyEvent(
          event(owner, "muzhi.generation.delta", { delta: "stale" }),
          400,
        ),
      ).resolves.toBeNull();
      const read = database.transaction("generationRuns", "readonly");
      await expect(
        requestResult(read.objectStore("generationRuns").get("generation-run")),
      ).resolves.toMatchObject({ partialOutput: "", status: "running" });
      await transactionDone(read);
    } finally {
      database.close();
    }
  });

  it("drops a chat event when its target thread conversation revision changed", async () => {
    const { database, owner, repository } = await createFixture();
    const chatOwner: TaskOwner = {
      ...owner,
      kind: "chat",
      targetId: "generation-thread",
      taskId: "generation-chat-task",
    };
    try {
      const transaction = database.transaction(
        ["chatThreads", "generationRuns"],
        "readwrite",
      );
      transaction.objectStore("chatThreads").put(
        createChatThread({
          branchId: chatOwner.branchId,
          chatThreadId: chatOwner.targetId,
          conversationRevision: 1,
          createdAt: 300,
          order: 0,
          sessionId: chatOwner.sessionId,
          subtitleId: chatOwner.subtitleId,
          title: null,
          updatedAt: 300,
        }),
      );
      transaction.objectStore("generationRuns").put(
        createGenerationRun({
          ...chatOwner,
          browserSessionId: "browser-session-a",
          completionSequence: null,
          createdAt: 300,
          errorCode: null,
          partialOutput: "",
          runId: "generation-chat-run",
          status: "running",
          stopReason: null,
          updatedAt: 300,
        }),
      );
      await transactionDone(transaction);

      await expect(
        repository.applyEvent(
          event(chatOwner, "muzhi.generation.delta", { delta: "stale" }),
          400,
        ),
      ).resolves.toBeNull();
      const read = database.transaction("generationRuns", "readonly");
      await expect(
        requestResult(
          read.objectStore("generationRuns").get("generation-chat-run"),
        ),
      ).resolves.toMatchObject({ partialOutput: "", status: "running" });
      await transactionDone(read);
    } finally {
      database.close();
    }
  });

  it("blocks summary and segments events until artifacts gain a stable target revision", async () => {
    const { database, owner, repository } = await createFixture();
    const summaryOwner: TaskOwner = {
      ...owner,
      kind: "summary",
      targetId: "summary-target-without-artifact",
      taskId: "summary-task",
    };
    const segmentsOwner: TaskOwner = {
      ...owner,
      kind: "segments",
      targetId: "segments-target-with-old-artifact",
      taskId: "segments-task",
    };
    try {
      const transaction = database.transaction(
        ["artifacts", "generationRuns"],
        "readwrite",
      );
      transaction.objectStore("generationRuns").put(
        createGenerationRun({
          ...summaryOwner,
          browserSessionId: "browser-session-a",
          completionSequence: null,
          createdAt: 300,
          errorCode: null,
          partialOutput: "",
          runId: "summary-run",
          status: "running",
          stopReason: null,
          updatedAt: 300,
        }),
      );
      transaction.objectStore("artifacts").put({
        artifactId: segmentsOwner.targetId,
        branchId: segmentsOwner.branchId,
        kind: "segments",
        sessionId: segmentsOwner.sessionId,
        subtitleId: segmentsOwner.subtitleId,
      });
      transaction.objectStore("generationRuns").put(
        createGenerationRun({
          ...segmentsOwner,
          browserSessionId: "browser-session-a",
          completionSequence: null,
          createdAt: 300,
          errorCode: null,
          partialOutput: "",
          runId: "segments-run",
          status: "running",
          stopReason: null,
          updatedAt: 300,
        }),
      );
      await transactionDone(transaction);

      await expect(
        repository.applyEvent(
          event(summaryOwner, "muzhi.generation.delta", { delta: "blocked" }),
          400,
        ),
      ).resolves.toBeNull();
      await expect(
        repository.applyEvent(
          event(segmentsOwner, "muzhi.generation.delta", {
            delta: "blocked",
          }),
          400,
        ),
      ).resolves.toBeNull();

      const read = database.transaction("generationRuns", "readonly");
      const [summaryRun, segmentsRun] = await Promise.all([
        requestResult(read.objectStore("generationRuns").get("summary-run")),
        requestResult(read.objectStore("generationRuns").get("segments-run")),
      ]);
      await transactionDone(read);
      expect(summaryRun).toMatchObject({
        partialOutput: "",
        status: "running",
        updatedAt: 300,
      });
      expect(segmentsRun).toMatchObject({
        partialOutput: "",
        status: "running",
        updatedAt: 300,
      });
    } finally {
      database.close();
    }
  });

  it("interrupts only non-live canonical runs during browser-session reconciliation", async () => {
    const { database, repository } = await createFixture();
    try {
      const [candidate] = await repository.listQueuedOrRunning();
      await expect(
        repository.reconcileAfterBackgroundStart(candidate, {
          browserSessionId: "browser-session-a",
          hasLiveExecutor: true,
          now: 500,
        }),
      ).resolves.toMatchObject({ status: "running", updatedAt: 300 });
      await expect(
        repository.reconcileAfterBackgroundStart(candidate, {
          browserSessionId: "browser-session-new",
          hasLiveExecutor: false,
          now: 600,
        }),
      ).resolves.toMatchObject({ status: "interrupted", updatedAt: 600 });
      const transaction = database.transaction("generationRuns", "readonly");
      await expect(
        requestResult(
          transaction.objectStore("generationRuns").get("generation-run"),
        ),
      ).resolves.toMatchObject({ status: "interrupted", updatedAt: 600 });
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  });
});
