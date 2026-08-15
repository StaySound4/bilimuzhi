import { afterEach, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import type { GenerationRuntimeEvent } from "../../src/application/generation-runtime-contract";
import {
  createBranchPlacement,
  createChatThread,
  createGenerationRun,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoRef,
} from "../../src/domain";
import { IndexedDbGenerationRepository } from "../../src/infrastructure/indexeddb/generation-repository";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";
import { IndexedDbTrashRepository } from "../../src/infrastructure/indexeddb/trash-repository";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-generation-race-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = fakeIndexedDB.deleteDatabase(name);
          request.addEventListener("success", () => resolve(), { once: true });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        }),
    ),
  );
});

it("rejects a late delta after a real trash transaction stops its owner", async () => {
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: createDatabaseName(),
  });
  try {
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "late event",
    });
    const branch = createSubtitleBranch({
      activeSubtitleId: "race-subtitle",
      branchId: "race-branch",
      contextRevision: 1,
      createdAt: 100,
      detectedLanguage: null,
      language: "en",
      lastOpenedAt: 100,
      lastSelectedAt: 100,
      requestedLanguageMode: null,
      sessionId: "race-session",
      source: "bilibili",
      title: null,
      updatedAt: 100,
      videoKey: video.videoKey,
    });
    const transaction = database.transaction(
      [
        "branchPlacements",
        "chatThreads",
        "generationRuns",
        "sessions",
        "subtitleBranches",
        "subtitleSnapshots",
      ],
      "readwrite",
    );
    transaction.objectStore("sessions").put(
      createSession({
        activeBranchId: branch.branchId,
        createdAt: 100,
        customTitle: false,
        lastActivityAt: 100,
        selectionRevision: 1,
        sessionId: branch.sessionId,
        title: "late event",
        updatedAt: 100,
        videoKey: video.videoKey,
      }),
    );
    transaction.objectStore("subtitleBranches").put(branch);
    transaction.objectStore("subtitleSnapshots").put(
      createSubtitleSnapshot({
        branchId: branch.branchId,
        contentHash: "sha256:race",
        createdAt: 100,
        language: "en",
        rows: [{ endMs: 1_000, startMs: 0, text: "race" }],
        sessionId: branch.sessionId,
        source: "bilibili",
        status: "active",
        subtitleId: branch.activeSubtitleId,
        videoKey: video.videoKey,
      }),
    );
    transaction.objectStore("branchPlacements").put(
      createBranchPlacement({
        branchId: branch.branchId,
        deletionReason: null,
        location: "workspace",
        order: 0,
        purgeAfter: null,
        retentionStartedAt: null,
        sessionId: branch.sessionId,
        trashedAt: null,
        trashOrigin: null,
        trashOriginFolderId: null,
        trashOriginPathSnapshot: null,
      }),
    );
    transaction.objectStore("chatThreads").put(
      createChatThread({
        branchId: branch.branchId,
        chatThreadId: "race-target",
        conversationRevision: 0,
        createdAt: 100,
        order: 0,
        sessionId: branch.sessionId,
        subtitleId: branch.activeSubtitleId,
        title: null,
        updatedAt: 100,
      }),
    );
    transaction.objectStore("generationRuns").put(
      createGenerationRun({
        branchId: branch.branchId,
        browserSessionId: "race-browser",
        completionSequence: null,
        contextRevision: branch.contextRevision,
        createdAt: 100,
        errorCode: null,
        expectedOwnerRevision: 0,
        kind: "chat",
        partialOutput: "before",
        runId: "race-run",
        sessionId: branch.sessionId,
        status: "running",
        stopReason: null,
        subtitleId: branch.activeSubtitleId,
        targetId: "race-target",
        taskId: "race-task",
        updatedAt: 100,
      }),
    );
    await transactionDone(transaction);
    await new IndexedDbTrashRepository(database, {
      now: () => 200,
    }).moveToTrash([branch.branchId], "user-delete");

    const event: GenerationRuntimeEvent = {
      branchId: branch.branchId,
      contextRevision: 1,
      expectedOwnerRevision: 0,
      kind: "chat",
      payload: { delta: "late" },
      protocolVersion: 1,
      requestId: "race-request",
      sessionId: branch.sessionId,
      subtitleId: branch.activeSubtitleId,
      targetId: "race-target",
      taskId: "race-task",
      type: "muzhi.generation.delta",
    };
    await expect(
      new IndexedDbGenerationRepository(database, {
        now: () => 300,
      }).applyEvent(event, 300),
    ).resolves.toBeNull();
    const read = database.transaction("generationRuns", "readonly");
    await expect(
      requestResult(read.objectStore("generationRuns").get("race-run")),
    ).resolves.toMatchObject({
      partialOutput: "before",
      status: "stopped",
      stopReason: "owner-deleted",
    });
    await transactionDone(read);
  } finally {
    database.close();
  }
});
