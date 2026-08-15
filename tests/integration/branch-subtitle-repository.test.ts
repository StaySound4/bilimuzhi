import { afterEach, describe, expect, it } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import type { SubtitleAcquisitionOwner } from "../../src/application/subtitle-acquisition-contract";
import {
  createSubtitleSnapshot,
  createVideoRef,
  type SubtitleSnapshot,
} from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-branch-acquisition-${crypto.randomUUID()}`;
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
    title: "分支字幕事务",
  });
  const session = await new IndexedDbSessionRepository(database, {
    createSessionId: () => "session-branch",
    now: () => 1_000,
  }).create(video);
  const repository = new IndexedDbSubtitleRepository(database, {
    now: () => 2_000,
  });
  return { database, repository, session, video };
}

function createOwner(
  videoKey: SubtitleAcquisitionOwner["videoKey"],
  suffix: string,
  expectedSelectionRevision = 0,
  expectedContextRevision = 1,
): SubtitleAcquisitionOwner {
  return {
    acquisitionId: `acquisition-${suffix}`,
    draftBranchId: `branch-${suffix}`,
    expectedContextRevision,
    expectedSelectionRevision,
    sessionId: "session-branch",
    taskId: `task-${suffix}`,
    videoKey,
  };
}

function createStaged(
  owner: SubtitleAcquisitionOwner,
  subtitleId: string,
): SubtitleSnapshot {
  return createSubtitleSnapshot({
    branchId: owner.draftBranchId,
    contentHash: `sha256:${subtitleId}`,
    createdAt: 1_500,
    language: "zh-CN",
    rows: [{ endMs: 1_000, startMs: 0, text: subtitleId }],
    sessionId: owner.sessionId,
    source: "bilibili",
    status: "staged",
    subtitleId,
    videoKey: owner.videoKey,
  });
}

describe("owner-correlated single-context subtitle repository", () => {
  it("atomically replaces the old subtitle and every old owned record", async () => {
    const { database, repository, video } = await createFixture();
    const first = createOwner(video.videoKey, "first");
    const second = createOwner(video.videoKey, "second", 1, 2);

    try {
      await repository.beginAcquisition(first, {
        method: "direct",
        trackId: "official:zh:1",
      });
      await expect(
        repository.beginAcquisition(first, {
          method: "direct",
          trackId: "official:zh:1",
        }),
      ).resolves.toMatchObject({ session: { sessionId: first.sessionId } });
      await expect(
        repository.commitAcquisition(
          first,
          createStaged(first, "subtitle-first"),
        ),
      ).resolves.toMatchObject({ branch: { branchId: first.draftBranchId } });
      const seed = database.transaction(
        [
          "artifacts",
          "attachments",
          "batchItems",
          "batchJobs",
          "chatMessages",
          "chatThreads",
          "generationRuns",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      seed.objectStore("artifacts").add({
        artifactId: "artifact-first",
        branchId: first.draftBranchId,
        kind: "summary",
        sessionId: first.sessionId,
        subtitleId: "subtitle-first",
      });
      seed.objectStore("chatThreads").add({
        branchId: first.draftBranchId,
        chatThreadId: "thread-first",
        order: 0,
        sessionId: first.sessionId,
        subtitleId: "subtitle-first",
      });
      seed.objectStore("chatMessages").add({
        branchId: first.draftBranchId,
        chatThreadId: "thread-first",
        messageId: "message-first",
        order: 0,
        sessionId: first.sessionId,
      });
      seed.objectStore("attachments").add({
        attachmentId: "attachment-first",
        branchId: first.draftBranchId,
        messageId: "message-first",
        sessionId: first.sessionId,
      });
      seed.objectStore("batchJobs").add({
        batchJobId: "batch-first",
        status: "completed",
      });
      seed.objectStore("batchItems").add({
        batchItemId: "batch-item-first",
        batchJobId: "batch-first",
        order: 0,
        resultBranchId: first.draftBranchId,
      });
      seed.objectStore("workspaceSessionPlacements").put({
        order: 123,
        pinned: true,
        sessionId: first.sessionId,
      });
      await transactionDone(seed);

      await repository.beginAcquisition(second, {
        method: "direct",
        trackId: "official:en:1",
      });
      await expect(
        repository.commitAcquisition(
          second,
          createStaged(second, "subtitle-second"),
        ),
      ).resolves.toMatchObject({ branch: { branchId: second.draftBranchId } });

      const transaction = database.transaction(
        [
          "artifacts",
          "attachments",
          "batchItems",
          "batchJobs",
          "branchPlacements",
          "chatMessages",
          "chatThreads",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      const [
        session,
        branches,
        placements,
        snapshots,
        firstRun,
        secondRun,
        artifacts,
        attachments,
        batchItems,
        batchJobs,
        chatMessages,
        chatThreads,
        workspacePlacement,
      ] = await Promise.all([
        requestResult(transaction.objectStore("sessions").get(first.sessionId)),
        requestResult(transaction.objectStore("subtitleBranches").getAll()),
        requestResult(transaction.objectStore("branchPlacements").getAll()),
        requestResult(transaction.objectStore("subtitleSnapshots").getAll()),
        requestResult(
          transaction.objectStore("generationRuns").get(first.acquisitionId),
        ),
        requestResult(
          transaction.objectStore("generationRuns").get(second.acquisitionId),
        ),
        requestResult(transaction.objectStore("artifacts").getAll()),
        requestResult(transaction.objectStore("attachments").getAll()),
        requestResult(transaction.objectStore("batchItems").getAll()),
        requestResult(transaction.objectStore("batchJobs").getAll()),
        requestResult(transaction.objectStore("chatMessages").getAll()),
        requestResult(transaction.objectStore("chatThreads").getAll()),
        requestResult(
          transaction
            .objectStore("workspaceSessionPlacements")
            .get(first.sessionId),
        ),
      ]);
      await transactionDone(transaction);

      expect(branches).toEqual([
        expect.objectContaining({ branchId: second.draftBranchId }),
      ]);
      expect(placements).toEqual([
        expect.objectContaining({
          branchId: second.draftBranchId,
          location: "workspace",
        }),
      ]);
      expect(snapshots).toEqual([
        expect.objectContaining({
          branchId: second.draftBranchId,
          status: "active",
          subtitleId: "subtitle-second",
        }),
      ]);
      expect(session).toMatchObject({
        activeBranchId: second.draftBranchId,
        selectionRevision: 2,
      });
      expect(firstRun).toBeUndefined();
      expect(secondRun).toMatchObject({
        status: "completed",
        subtitleId: "subtitle-second",
      });
      expect({
        artifacts,
        attachments,
        batchItems,
        batchJobs,
        chatMessages,
        chatThreads,
      }).toEqual({
        artifacts: [],
        attachments: [],
        batchItems: [],
        batchJobs: [],
        chatMessages: [],
        chatThreads: [],
      });
      expect(workspacePlacement).toEqual({
        order: 123,
        pinned: true,
        sessionId: first.sessionId,
      });
    } finally {
      database.close();
    }
  });

  it("reports the next context revision and keeps the old context when commit validation fails", async () => {
    const { database, repository, video } = await createFixture();
    const first = createOwner(video.videoKey, "keep-old");

    try {
      await expect(
        repository.readAcquisitionContext(video.videoKey),
      ).resolves.toMatchObject({ expectedContextRevision: 1 });
      await repository.beginAcquisition(first, {
        method: "direct",
        trackId: "official:zh:1",
      });
      await repository.commitAcquisition(
        first,
        createStaged(first, "subtitle-keep-old"),
      );
      await expect(
        repository.readAcquisitionContext(video.videoKey),
      ).resolves.toMatchObject({
        expectedContextRevision: 2,
        session: { activeBranchId: first.draftBranchId, selectionRevision: 1 },
      });

      const second = createOwner(video.videoKey, "overwrite-fail", 1, 2);
      await repository.beginAcquisition(second, {
        method: "direct",
        trackId: "official:en:1",
      });
      await expect(
        repository.commitAcquisition(second, {
          ...createStaged(second, "subtitle-overwrite-fail"),
          // Deliberately mismatch the owner session so validation fails before
          // any destructive write can land.
          sessionId: "session-other",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      const transaction = database.transaction(
        [
          "artifacts",
          "branchPlacements",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readonly",
      );
      const [session, branches, placements, snapshots, firstRun, secondRun] =
        await Promise.all([
          requestResult(
            transaction.objectStore("sessions").get(first.sessionId),
          ),
          requestResult(transaction.objectStore("subtitleBranches").getAll()),
          requestResult(transaction.objectStore("branchPlacements").getAll()),
          requestResult(transaction.objectStore("subtitleSnapshots").getAll()),
          requestResult(
            transaction.objectStore("generationRuns").get(first.acquisitionId),
          ),
          requestResult(
            transaction.objectStore("generationRuns").get(second.acquisitionId),
          ),
        ]);
      await transactionDone(transaction);

      expect(session).toMatchObject({
        activeBranchId: first.draftBranchId,
        selectionRevision: 1,
      });
      expect(branches).toEqual([
        expect.objectContaining({
          branchId: first.draftBranchId,
          contextRevision: 1,
        }),
      ]);
      expect(placements).toEqual([
        expect.objectContaining({ branchId: first.draftBranchId }),
      ]);
      expect(snapshots).toEqual([
        expect.objectContaining({
          status: "active",
          subtitleId: "subtitle-keep-old",
        }),
      ]);
      expect(firstRun).toMatchObject({
        status: "completed",
        subtitleId: "subtitle-keep-old",
      });
      expect(secondRun).toMatchObject({
        status: "running",
        subtitleId: null,
      });
    } finally {
      database.close();
    }
  });

  it("refuses a failed acquisition run from cascading away the previous active subtitle", async () => {
    const { database, repository, video } = await createFixture();
    const first = createOwner(video.videoKey, "active");
    const second = createOwner(video.videoKey, "failed-finish", 1, 2);

    try {
      await repository.beginAcquisition(first, {
        method: "direct",
        trackId: "official:zh:1",
      });
      await repository.commitAcquisition(
        first,
        createStaged(first, "subtitle-active"),
      );
      await repository.beginAcquisition(second, {
        method: "speech",
        mediaIdentity: "media-1",
        model: "whisper-large-v3",
        provider: "groq",
        requestedLanguageMode: "zh",
      });
      await repository.finishAcquisition(second, "failed");
      await expect(
        repository.commitAcquisition(
          second,
          createSubtitleSnapshot({
            branchId: second.draftBranchId,
            contentHash: "sha256:failed",
            createdAt: 2_500,
            language: "zh",
            rows: [{ endMs: 1_000, startMs: 0, text: "should not land" }],
            sessionId: second.sessionId,
            source: "groq-whisper",
            status: "staged",
            subtitleId: "subtitle-failed",
            videoKey: second.videoKey,
          }),
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      const transaction = database.transaction(
        ["sessions", "subtitleBranches", "subtitleSnapshots", "generationRuns"],
        "readonly",
      );
      const [session, branches, snapshots, secondRun] = await Promise.all([
        requestResult(transaction.objectStore("sessions").get(first.sessionId)),
        requestResult(transaction.objectStore("subtitleBranches").getAll()),
        requestResult(transaction.objectStore("subtitleSnapshots").getAll()),
        requestResult(
          transaction.objectStore("generationRuns").get(second.acquisitionId),
        ),
      ]);
      await transactionDone(transaction);
      expect(session).toMatchObject({ activeBranchId: first.draftBranchId });
      expect(branches).toEqual([
        expect.objectContaining({ branchId: first.draftBranchId }),
      ]);
      expect(snapshots).toEqual([
        expect.objectContaining({
          status: "active",
          subtitleId: "subtitle-active",
        }),
      ]);
      expect(secondRun).toMatchObject({ status: "failed", subtitleId: null });
    } finally {
      database.close();
    }
  });

  it("rejects a cancelled owner with zero branch or snapshot writes", async () => {
    const { database, repository, video } = await createFixture();
    const owner = createOwner(video.videoKey, "cancelled");

    try {
      await repository.beginAcquisition(owner, {
        method: "direct",
        trackId: "official:zh:1",
      });
      await repository.finishAcquisition(owner, "cancelled");
      await expect(
        repository.commitAcquisition(
          owner,
          createStaged(owner, "subtitle-cancelled"),
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });

      const transaction = database.transaction(
        ["generationRuns", "subtitleBranches", "subtitleSnapshots"],
        "readonly",
      );
      const [branches, snapshots, run] = await Promise.all([
        requestResult(transaction.objectStore("subtitleBranches").count()),
        requestResult(transaction.objectStore("subtitleSnapshots").count()),
        requestResult(
          transaction.objectStore("generationRuns").get(owner.acquisitionId),
        ),
      ]);
      await transactionDone(transaction);
      expect({ branches, run, snapshots }).toEqual({
        branches: 0,
        run: expect.objectContaining({ status: "cancelled", subtitleId: null }),
        snapshots: 0,
      });
    } finally {
      database.close();
    }
  });

  it("rejects a stale unconfirmed selection before it can create an acquisition run", async () => {
    const { database, repository, video } = await createFixture();
    const owner = {
      ...createOwner(video.videoKey, "stale"),
      expectedSelectionRevision: 1,
    };

    try {
      await expect(
        repository.beginAcquisition(owner, {
          method: "direct",
          trackId: "official:zh:1",
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      const transaction = database.transaction(["generationRuns"], "readonly");
      await expect(
        requestResult(transaction.objectStore("generationRuns").count()),
      ).resolves.toBe(0);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  });
});
