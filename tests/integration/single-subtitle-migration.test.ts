import { afterEach, describe, expect, it } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import type { SubtitleAcquisitionOwner } from "../../src/application/subtitle-acquisition-contract";
import { createSubtitleSnapshot, createVideoRef } from "../../src/domain";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import {
  inspectSingleSubtitleMigration,
  migrateToSingleSubtitleContexts,
} from "../../src/infrastructure/indexeddb/single-subtitle-migration";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";

const databaseNames: string[] = [];

function databaseName(): string {
  const name = `muzhi-single-subtitle-migration-${crypto.randomUUID()}`;
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

async function fixture() {
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: databaseName(),
  });
  const video = createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    cid: 30_000_000_002,
    page: 2,
    title: "单字幕迁移",
  });
  const session = await new IndexedDbSessionRepository(database, {
    createSessionId: () => "session-migration",
    now: () => 1_000,
  }).create(video);
  const repository = new IndexedDbSubtitleRepository(database, {
    now: () => 2_000,
  });
  const owner: SubtitleAcquisitionOwner = {
    acquisitionId: "acquisition-old",
    draftBranchId: "branch-old",
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: session.sessionId,
    taskId: "task-old",
    videoKey: video.videoKey,
  };
  await repository.beginAcquisition(owner, {
    method: "direct",
    trackId: "official:zh:old",
  });
  await repository.commitAcquisition(
    owner,
    createSubtitleSnapshot({
      branchId: owner.draftBranchId,
      contentHash: "sha256:old",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "旧字幕" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-old",
      videoKey: video.videoKey,
    }),
  );

  const read = database.transaction(
    ["branchPlacements", "sessions", "subtitleBranches", "subtitleSnapshots"],
    "readonly",
  );
  const [storedSession, oldBranch, oldPlacement, oldSubtitle] =
    await Promise.all([
      requestResult(read.objectStore("sessions").get(session.sessionId)),
      requestResult(read.objectStore("subtitleBranches").get("branch-old")),
      requestResult(read.objectStore("branchPlacements").get("branch-old")),
      requestResult(read.objectStore("subtitleSnapshots").get("subtitle-old")),
    ]);
  await transactionDone(read);

  const seed = database.transaction(
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
    ],
    "readwrite",
  );
  seed.objectStore("sessions").put({
    ...(storedSession as Record<string, unknown>),
    activeBranchId: "branch-current",
    selectionRevision: 2,
  });
  seed.objectStore("subtitleBranches").add({
    ...(oldBranch as Record<string, unknown>),
    activeSubtitleId: "subtitle-current",
    branchId: "branch-current",
    contextRevision: 2,
  });
  seed.objectStore("branchPlacements").add({
    ...(oldPlacement as Record<string, unknown>),
    branchId: "branch-current",
    order: 2_000,
  });
  seed.objectStore("subtitleSnapshots").add({
    ...(oldSubtitle as Record<string, unknown>),
    branchId: "branch-current",
    contentHash: "sha256:current",
    rows: [{ endMs: 1_000, startMs: 0, text: "当前字幕" }],
    subtitleId: "subtitle-current",
  });
  seed.objectStore("artifacts").add({
    artifactId: "artifact-old",
    branchId: "branch-old",
    kind: "summary",
    sessionId: session.sessionId,
    subtitleId: "subtitle-old",
  });
  seed.objectStore("chatThreads").add({
    branchId: "branch-old",
    chatThreadId: "thread-old",
    order: 0,
    sessionId: session.sessionId,
    subtitleId: "subtitle-old",
  });
  seed.objectStore("chatMessages").add({
    branchId: "branch-old",
    chatThreadId: "thread-old",
    messageId: "message-old",
    order: 0,
    sessionId: session.sessionId,
  });
  seed.objectStore("attachments").add({
    attachmentId: "attachment-old",
    branchId: "branch-old",
    messageId: "message-old",
    sessionId: session.sessionId,
  });
  seed.objectStore("batchJobs").add({
    batchJobId: "batch-old",
    status: "completed",
  });
  seed.objectStore("batchItems").add({
    batchItemId: "batch-item-old",
    batchJobId: "batch-old",
    order: 0,
    resultBranchId: "branch-old",
  });
  await transactionDone(seed);
  return { database, session };
}

describe("single subtitle context migration", () => {
  it("previews destructive deletion without mutating the legacy database", async () => {
    const { database, session } = await fixture();
    try {
      await expect(inspectSingleSubtitleMigration(database)).resolves.toEqual(
        expect.objectContaining({
          affectedSessionCount: 1,
          branchesToDelete: 1,
          requiresConfirmation: true,
        }),
      );
      const read = database.transaction(
        ["artifacts", "subtitleBranches", "subtitleSnapshots"],
        "readonly",
      );
      await expect(
        Promise.all([
          requestResult(read.objectStore("artifacts").count()),
          requestResult(read.objectStore("subtitleBranches").count()),
          requestResult(read.objectStore("subtitleSnapshots").count()),
        ]),
      ).resolves.toEqual([1, 2, 2]);
      await transactionDone(read);
      expect(session.sessionId).toBe("session-migration");
    } finally {
      database.close();
    }
  });

  it("requires explicit confirmation before deleting historical contexts", async () => {
    const { database } = await fixture();
    try {
      await expect(
        migrateToSingleSubtitleContexts(database, {
          confirmed: false,
          now: 3_000,
        }),
      ).rejects.toThrow("explicit user confirmation");
      const read = database.transaction(
        ["subtitleBranches", "subtitleSnapshots"],
        "readonly",
      );
      await expect(
        Promise.all([
          requestResult(read.objectStore("subtitleBranches").count()),
          requestResult(read.objectStore("subtitleSnapshots").count()),
        ]),
      ).resolves.toEqual([2, 2]);
      await transactionDone(read);
    } finally {
      database.close();
    }
  });

  it("keeps only the active context and cascades every historical owner", async () => {
    const { database } = await fixture();
    try {
      await expect(
        migrateToSingleSubtitleContexts(database, {
          confirmed: true,
          now: 3_000,
        }),
      ).resolves.toEqual(
        expect.objectContaining({ branchesToDelete: 1, migrated: true }),
      );
      const read = database.transaction(
        [
          "artifacts",
          "attachments",
          "batchItems",
          "batchJobs",
          "branchPlacements",
          "chatMessages",
          "chatThreads",
          "generationRuns",
          "settings",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readonly",
      );
      const values = await Promise.all([
        requestResult(read.objectStore("artifacts").count()),
        requestResult(read.objectStore("attachments").count()),
        requestResult(read.objectStore("batchItems").count()),
        requestResult(read.objectStore("batchJobs").count()),
        requestResult(read.objectStore("branchPlacements").getAll()),
        requestResult(read.objectStore("chatMessages").count()),
        requestResult(read.objectStore("chatThreads").count()),
        requestResult(read.objectStore("generationRuns").count()),
        requestResult(
          read.objectStore("settings").get("singleSubtitleContext"),
        ),
        requestResult(read.objectStore("subtitleBranches").getAll()),
        requestResult(read.objectStore("subtitleSnapshots").getAll()),
      ]);
      await transactionDone(read);
      expect(values).toEqual([
        0,
        0,
        0,
        0,
        [expect.objectContaining({ branchId: "branch-current" })],
        0,
        0,
        0,
        expect.objectContaining({ completedAt: 3_000, version: 1 }),
        [expect.objectContaining({ branchId: "branch-current" })],
        [expect.objectContaining({ subtitleId: "subtitle-current" })],
      ]);
    } finally {
      database.close();
    }
  });

  it("aborts instead of guessing when the active branch is missing", async () => {
    const { database } = await fixture();
    try {
      const corrupt = database.transaction("sessions", "readwrite");
      const sessions = corrupt.objectStore("sessions");
      const value = (await requestResult(
        sessions.get("session-migration"),
      )) as Record<string, unknown>;
      sessions.put({ ...value, activeBranchId: "branch-missing" });
      await transactionDone(corrupt);

      await expect(inspectSingleSubtitleMigration(database)).rejects.toThrow(
        "active subtitle context",
      );
      await expect(
        migrateToSingleSubtitleContexts(database, { now: 3_000 }),
      ).rejects.toThrow("active subtitle context");

      const read = database.transaction("subtitleBranches", "readonly");
      await expect(
        requestResult(read.objectStore("subtitleBranches").count()),
      ).resolves.toBe(2);
      await transactionDone(read);
    } finally {
      database.close();
    }
  });
});
