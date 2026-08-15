import { afterEach, describe, expect, it, vi } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot as createDomainSubtitleSnapshot,
  createVideoRef,
  type CreateSubtitleSnapshotInput,
  type SubtitleSnapshot,
} from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbWorkspaceRestorationRepository } from "../../src/infrastructure/indexeddb/workspace-restoration-repository";

const databaseNames: string[] = [];

function createSubtitleSnapshot(
  input: Omit<CreateSubtitleSnapshotInput, "branchId"> & {
    readonly branchId?: string;
  },
): SubtitleSnapshot {
  return createDomainSubtitleSnapshot({
    ...input,
    branchId: input.branchId ?? `branch:${input.subtitleId}`,
  });
}

function createDatabaseName(): string {
  const name = `muzhi-session-${crypto.randomUUID()}`;
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

async function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

async function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
    transaction.addEventListener("error", () => reject(transaction.error), {
      once: true,
    });
  });
}

function createVideo(
  overrides: Partial<Parameters<typeof createVideoRef>[0]> = {},
) {
  return createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
    cid: 30_000_000_001,
    page: 1,
    title: "精确视频",
    ...overrides,
  });
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("IndexedDbSessionRepository", () => {
  it("lists workspace sessions by manual placement order instead of recent activity", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["session-first", "session-second"];
    let now = 1_000;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => now,
    });

    try {
      const first = await repository.create(createVideo());
      now = 2_000;
      const second = await repository.create(
        createVideo({
          canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
          cid: 30_000_000_002,
          page: 2,
        }),
      );
      now = 3_000;
      const touchedSecond = await repository.touch(second.sessionId);

      const sessions = await repository.list();

      expect(sessions).toEqual([first, touchedSecond]);
      expect(Object.isFrozen(sessions)).toBe(true);
      expect(sessions.every(Object.isFrozen)).toBe(true);
    } finally {
      database.close();
    }
  });

  it("creates one session per exact video identity and restores it", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const createSessionId = vi.fn(() => "session-1");
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId,
      now: () => 1_000,
    });
    const video = createVideo();

    try {
      const created = await repository.create(video);
      const restored = await repository.create(video);
      const sessionCount = await requestResult(
        database
          .transaction("sessions", "readonly")
          .objectStore("sessions")
          .count(),
      );
      const videoCount = await requestResult(
        database
          .transaction("videos", "readonly")
          .objectStore("videos")
          .count(),
      );

      expect(created).toEqual({
        activeBranchId: null,
        createdAt: 1_000,
        customTitle: false,
        lastActivityAt: 1_000,
        selectionRevision: 0,
        sessionId: "session-1",
        title: "精确视频",
        updatedAt: 1_000,
        videoKey: video.videoKey,
      });
      expect(restored).toEqual(created);
      expect(createSessionId).toHaveBeenCalledOnce();
      expect(sessionCount).toBe(1);
      expect(videoCount).toBe(1);
    } finally {
      database.close();
    }
  });

  it("uses workspace placement visibility as the concurrent create-or-restore authority", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const first = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-first",
      now: () => 1_000,
    });
    const second = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-second",
      now: () => 2_000,
    });

    try {
      const [created, restored] = await Promise.all([
        first.create(createVideo()),
        second.create(createVideo()),
      ]);
      const sessions = await requestResult(
        database
          .transaction("sessions", "readonly")
          .objectStore("sessions")
          .getAll(),
      );

      expect(restored).toEqual(created);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({ sessionId: "session-first" });
    } finally {
      database.close();
    }
  });

  it("creates a fresh workspace session when the exact video exists only in archive or trash", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["session-hidden", "session-workspace"];
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => 1_000,
    });
    const video = createVideo();

    try {
      const hidden = await repository.create(video);
      const seed = database.transaction(
        [
          "archiveSessionPlacements",
          "branchPlacements",
          "subtitleBranches",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      seed.objectStore("workspaceSessionPlacements").delete(hidden.sessionId);
      seed.objectStore("archiveSessionPlacements").put({
        folderId: "archive-root",
        order: 0,
        pinned: false,
        sessionId: hidden.sessionId,
      });
      for (const [branchId, location] of [
        ["hidden-archive", "archive"],
        ["hidden-trash", "trash"],
      ] as const) {
        seed.objectStore("subtitleBranches").put(
          createSubtitleBranch({
            activeSubtitleId: `${branchId}-subtitle`,
            branchId,
            contextRevision: 1,
            createdAt: 1_000,
            detectedLanguage: null,
            language: "zh-CN",
            lastOpenedAt: 1_000,
            lastSelectedAt: 1_000,
            requestedLanguageMode: null,
            sessionId: hidden.sessionId,
            source: "bilibili",
            title: null,
            updatedAt: 1_000,
            videoKey: video.videoKey,
          }),
        );
        seed.objectStore("branchPlacements").put(
          createBranchPlacement({
            branchId,
            deletionReason: location === "trash" ? "user-delete" : null,
            location,
            order: location === "archive" ? 0 : 1,
            purgeAfter: null,
            retentionStartedAt: location === "trash" ? 1_000 : null,
            sessionId: hidden.sessionId,
            trashedAt: location === "trash" ? 1_000 : null,
            trashOrigin: location === "trash" ? "workspace" : null,
            trashOriginFolderId: null,
            trashOriginPathSnapshot: null,
          }),
        );
      }
      await transactionDone(seed);

      const created = await repository.create(video);

      expect(created).toMatchObject({
        sessionId: "session-workspace",
        videoKey: video.videoKey,
      });
      expect(created.sessionId).not.toBe(hidden.sessionId);
      await expect(repository.getByVideoKey(video.videoKey)).resolves.toEqual(
        created,
      );
      await expect(repository.list()).resolves.toEqual([created]);

      await repository.deleteCascade(created.sessionId);
      const verify = database.transaction(["sessions", "videos"], "readonly");
      await expect(
        requestResult(verify.objectStore("sessions").get(hidden.sessionId)),
      ).resolves.toBeDefined();
      await expect(
        requestResult(verify.objectStore("videos").get(video.videoKey)),
      ).resolves.toEqual(video);
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("persists pin and manual order independently from session activity", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["session-first", "session-second", "session-third"];
    let now = 1_000;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => now,
    });

    try {
      const first = await repository.create(createVideo());
      now = 2_000;
      const second = await repository.create(
        createVideo({
          canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
          cid: 30_000_000_002,
          page: 2,
        }),
      );
      now = 3_000;
      const third = await repository.create(
        createVideo({
          canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=3",
          cid: 30_000_000_003,
          page: 3,
        }),
      );

      await repository.setPinned(third.sessionId, true);
      await repository.reorder(second.sessionId, first.sessionId);
      expect((await repository.list()).map((value) => value.sessionId)).toEqual(
        [third.sessionId, second.sessionId, first.sessionId],
      );

      now = 9_000;
      await repository.touch(first.sessionId);
      expect((await repository.list()).map((value) => value.sessionId)).toEqual(
        [third.sessionId, second.sessionId, first.sessionId],
      );

      await repository.setPinned(third.sessionId, false);
      const placement = await requestResult(
        database
          .transaction("workspaceSessionPlacements", "readonly")
          .objectStore("workspaceSessionPlacements")
          .get(third.sessionId),
      );
      expect(placement).toMatchObject({ pinned: false, order: 0 });
      expect((await repository.list()).map((value) => value.sessionId)).toEqual(
        [third.sessionId, second.sessionId, first.sessionId],
      );
    } finally {
      database.close();
    }
  });

  it("keeps exact parts separate without persisting presentation ordinals", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["session-p1", "session-p2"];
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => 1_000,
    });

    try {
      const part1 = await repository.create(createVideo({ title: "同名视频" }));
      const part2 = await repository.create(
        createVideo({
          canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
          cid: 30_000_000_002,
          page: 2,
          title: "同名视频",
        }),
      );

      expect(part1.title).toBe("同名视频");
      expect(part2).toMatchObject({
        customTitle: false,
        sessionId: "session-p2",
        title: "同名视频",
      });
      await expect(repository.getByVideoKey(part2.videoKey)).resolves.toEqual(
        part2,
      );
    } finally {
      database.close();
    }
  });

  it("renames and touches a session without replacing its stable identity", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    let now = 1_000;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-update",
      now: () => now,
    });

    try {
      const created = await repository.create(createVideo());
      now = 2_000;
      const renamed = await repository.rename(
        created.sessionId,
        "  我的标题  ",
      );
      now = 3_000;
      const touched = await repository.touch(created.sessionId);

      expect(renamed).toEqual({
        ...created,
        customTitle: true,
        title: "我的标题",
        updatedAt: 2_000,
      });
      expect(touched).toEqual({
        ...renamed,
        lastActivityAt: 3_000,
        updatedAt: 3_000,
      });
    } finally {
      database.close();
    }
  });

  it("keeps timestamps monotonic and returns safe missing-session outcomes", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    let now = 2_000;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-monotonic",
      now: () => now,
    });

    try {
      const created = await repository.create(createVideo());
      now = 1_000;

      await expect(repository.touch(created.sessionId)).resolves.toEqual(
        created,
      );
      await expect(
        repository.getByVideoKey(
          createVideo({
            canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
            cid: 30_000_000_002,
            page: 2,
          }).videoKey,
        ),
      ).resolves.toBeNull();
      await expect(repository.deleteCascade("missing-session")).resolves.toBe(
        undefined,
      );
      await expect(
        repository.rename("missing-session", "标题"),
      ).rejects.toMatchObject({
        code: "STORAGE_TRANSACTION_FAILED",
        message: "The Bilimuzhi session does not exist",
        retryable: false,
      });
    } finally {
      database.close();
    }
  });

  it("rolls back the video write when a session primary key conflicts", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "duplicate-session-id",
      now: () => 1_000,
    });
    const secondVideo = createVideo({
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      cid: 30_000_000_002,
      page: 2,
    });

    try {
      await repository.create(createVideo());
      await expect(repository.create(secondVideo)).rejects.toMatchObject({
        code: "STORAGE_TRANSACTION_FAILED",
        message: "Unable to update the Bilimuzhi session database",
        retryable: false,
      });
      const secondVideoRecord = await requestResult(
        database
          .transaction("videos", "readonly")
          .objectStore("videos")
          .get(secondVideo.videoKey),
      );

      expect(secondVideoRecord).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("deletes a session and every current or reserved owner store atomically", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["session-delete", "session-keep"];
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => 1_000,
    });

    try {
      const deleted = await repository.create(createVideo());
      const kept = await repository.create(
        createVideo({
          bvid: "BV1xx411c7mD",
          canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
          cid: 30_000_000_002,
          title: "保留视频",
        }),
      );
      const seed = database.transaction(
        [
          "archiveSessionPlacements",
          "artifacts",
          "attachments",
          "branchPlacements",
          "chatMessages",
          "chatThreads",
          "generationRuns",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readwrite",
      );
      const snapshots = seed.objectStore("subtitleSnapshots");
      const ownerFixtures = [
        {
          branchId: "branch:subtitle-delete",
          label: "delete",
          session: deleted,
          subtitleId: "subtitle-delete",
        },
        {
          branchId: "branch:subtitle-keep",
          label: "keep",
          session: kept,
          subtitleId: "subtitle-keep",
        },
      ] as const;
      for (const fixture of ownerFixtures) {
        const snapshot = createSubtitleSnapshot({
          branchId: fixture.branchId,
          contentHash: `hash-${fixture.label}`,
          createdAt: 1_000,
          language: "zh-CN",
          rows: [{ endMs: 1_000, startMs: 0, text: fixture.label }],
          sessionId: fixture.session.sessionId,
          source: "bilibili",
          status: "active",
          subtitleId: fixture.subtitleId,
          videoKey: fixture.session.videoKey,
        });
        snapshots.add(snapshot);
        seed.objectStore("subtitleBranches").add(
          createSubtitleBranch({
            activeSubtitleId: snapshot.subtitleId,
            branchId: fixture.branchId,
            contextRevision: 1,
            createdAt: 1_000,
            detectedLanguage: null,
            language: "zh-CN",
            lastOpenedAt: 1_000,
            lastSelectedAt: 1_000,
            requestedLanguageMode: null,
            sessionId: fixture.session.sessionId,
            source: "bilibili",
            title: null,
            updatedAt: 1_000,
            videoKey: fixture.session.videoKey,
          }),
        );
        seed.objectStore("branchPlacements").add(
          createBranchPlacement({
            branchId: fixture.branchId,
            deletionReason: null,
            location: "workspace",
            order: 1_000,
            purgeAfter: null,
            retentionStartedAt: null,
            sessionId: fixture.session.sessionId,
            trashedAt: null,
            trashOrigin: null,
            trashOriginFolderId: null,
            trashOriginPathSnapshot: null,
          }),
        );
        seed.objectStore("archiveSessionPlacements").add({
          folderId: "archive-root",
          order: 1_000,
          pinned: false,
          sessionId: fixture.session.sessionId,
        });
        seed.objectStore("artifacts").add({
          artifactId: `artifact-${fixture.label}`,
          branchId: fixture.branchId,
          kind: "summary",
          sessionId: fixture.session.sessionId,
          subtitleId: fixture.subtitleId,
        });
        seed.objectStore("attachments").add({
          attachmentId: `attachment-${fixture.label}`,
          branchId: fixture.branchId,
          messageId: `message-${fixture.label}`,
          sessionId: fixture.session.sessionId,
        });
        seed.objectStore("chatMessages").add({
          branchId: fixture.branchId,
          chatThreadId: `thread-${fixture.label}`,
          messageId: `message-${fixture.label}`,
          order: 0,
          sessionId: fixture.session.sessionId,
        });
        seed.objectStore("chatThreads").add({
          branchId: fixture.branchId,
          chatThreadId: `thread-${fixture.label}`,
          order: 0,
          sessionId: fixture.session.sessionId,
          subtitleId: fixture.subtitleId,
        });
        seed.objectStore("generationRuns").add({
          branchId: fixture.branchId,
          runId: `run-${fixture.label}`,
          sessionId: fixture.session.sessionId,
          status: "completed",
          subtitleId: fixture.subtitleId,
          taskId: `task-${fixture.label}`,
        });
      }
      await transactionDone(seed);

      await repository.deleteCascade(deleted.sessionId);

      const read = database.transaction(
        [...database.objectStoreNames],
        "readonly",
      );
      const ownerStoreNames = [
        "artifacts",
        "attachments",
        "branchPlacements",
        "chatMessages",
        "chatThreads",
        "generationRuns",
        "subtitleBranches",
        "subtitleSnapshots",
      ] as const;
      const [remainingSessions, remainingVideos, ...remainingOwnedRecords] =
        await Promise.all([
          requestResult(read.objectStore("sessions").getAll()),
          requestResult(read.objectStore("videos").getAll()),
          ...ownerStoreNames.map((storeName) =>
            requestResult(read.objectStore(storeName).getAll()),
          ),
        ]);
      const deletedWorkspacePlacement = await requestResult(
        read.objectStore("workspaceSessionPlacements").get(deleted.sessionId),
      );
      const keptWorkspacePlacement = await requestResult(
        read.objectStore("workspaceSessionPlacements").get(kept.sessionId),
      );
      const deletedArchivePlacement = await requestResult(
        read.objectStore("archiveSessionPlacements").get(deleted.sessionId),
      );
      const keptArchivePlacement = await requestResult(
        read.objectStore("archiveSessionPlacements").get(kept.sessionId),
      );
      await transactionDone(read);

      expect(remainingSessions).toEqual([kept]);
      expect(remainingVideos).toHaveLength(1);
      expect(remainingVideos[0]).toMatchObject({ videoKey: kept.videoKey });
      for (const records of remainingOwnedRecords) {
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ sessionId: kept.sessionId });
      }
      expect(deletedWorkspacePlacement).toBeUndefined();
      expect(deletedArchivePlacement).toBeUndefined();
      expect(keptWorkspacePlacement).toMatchObject({
        sessionId: kept.sessionId,
      });
      expect(keptArchivePlacement).toMatchObject({ sessionId: kept.sessionId });
    } finally {
      database.close();
    }
  });
});

describe("IndexedDbWorkspaceRestorationRepository", () => {
  it("restores a session and its active subtitle in one consistent view", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideo();
    const session = createSession({
      activeBranchId: "branch-restore",
      createdAt: 1_000,
      customTitle: false,
      lastActivityAt: 2_000,
      selectionRevision: 1,
      sessionId: "session-restore",
      title: video.title,
      updatedAt: 2_000,
      videoKey: video.videoKey,
    });
    const subtitle = createSubtitleSnapshot({
      branchId: "branch-restore",
      contentHash: "sha256:restore",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 2_000, startMs: 1_000, text: "恢复字幕" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "active",
      subtitleId: "subtitle-restore",
      videoKey: video.videoKey,
    });
    const branch = createSubtitleBranch({
      activeSubtitleId: subtitle.subtitleId,
      branchId: subtitle.branchId,
      contextRevision: 1,
      createdAt: subtitle.createdAt,
      detectedLanguage: null,
      language: subtitle.language,
      lastOpenedAt: 2_000,
      lastSelectedAt: 2_000,
      requestedLanguageMode: null,
      sessionId: session.sessionId,
      source: subtitle.source,
      title: null,
      updatedAt: 2_000,
      videoKey: video.videoKey,
    });
    const placement = createBranchPlacement({
      branchId: branch.branchId,
      deletionReason: null,
      location: "workspace",
      order: branch.createdAt,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: session.sessionId,
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    });
    const seed = database.transaction(
      [
        "branchPlacements",
        "sessions",
        "subtitleBranches",
        "subtitleSnapshots",
        "videos",
      ],
      "readwrite",
    );
    seed.objectStore("videos").add(video);
    seed.objectStore("sessions").add(session);
    seed.objectStore("subtitleBranches").add(branch);
    seed.objectStore("branchPlacements").add(placement);
    seed.objectStore("subtitleSnapshots").add(subtitle);
    await transactionDone(seed);

    try {
      const repository = new IndexedDbWorkspaceRestorationRepository(database);
      const transaction = vi.spyOn(database, "transaction");
      await expect(repository.restore(session.sessionId)).resolves.toEqual({
        branch,
        placement,
        session,
        subtitle,
      });
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(
        [
          "branchPlacements",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readonly",
      );
    } finally {
      database.close();
    }
  });

  it("returns safe empty outcomes for a missing session or inactive subtitle", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideo();
    const session = createSession({
      activeBranchId: null,
      createdAt: 1_000,
      customTitle: false,
      lastActivityAt: 1_000,
      selectionRevision: 0,
      sessionId: "session-without-subtitle",
      title: video.title,
      updatedAt: 1_000,
      videoKey: video.videoKey,
    });
    const seed = database.transaction("sessions", "readwrite");
    seed.objectStore("sessions").add(session);
    await transactionDone(seed);

    try {
      const repository = new IndexedDbWorkspaceRestorationRepository(database);
      await expect(repository.restore("missing-session")).resolves.toBeNull();
      await expect(repository.restore(session.sessionId)).resolves.toEqual({
        branch: null,
        placement: null,
        session,
        subtitle: null,
      });
    } finally {
      database.close();
    }
  });

  it("rejects missing and cross-session active subtitle relationships", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideo();
    const secondVideo = createVideo({
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      cid: 30_000_000_002,
      page: 2,
    });
    const missingSubtitleSession = createSession({
      activeBranchId: "branch-missing",
      createdAt: 1_000,
      customTitle: false,
      lastActivityAt: 2_000,
      selectionRevision: 1,
      sessionId: "session-missing-subtitle",
      title: video.title,
      updatedAt: 2_000,
      videoKey: video.videoKey,
    });
    const mismatchedSession = createSession({
      ...missingSubtitleSession,
      activeBranchId: "branch-mismatched",
      sessionId: "session-mismatched",
      videoKey: secondVideo.videoKey,
    });
    const mismatchedSubtitle = createSubtitleSnapshot({
      branchId: "branch-mismatched",
      contentHash: "sha256:mismatched",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 2_000, startMs: 1_000, text: "错误归属" }],
      sessionId: "another-session",
      source: "bilibili",
      status: "active",
      subtitleId: "subtitle-mismatched",
      videoKey: secondVideo.videoKey,
    });
    const mismatchedBranch = createSubtitleBranch({
      activeSubtitleId: mismatchedSubtitle.subtitleId,
      branchId: mismatchedSubtitle.branchId,
      contextRevision: 1,
      createdAt: mismatchedSubtitle.createdAt,
      detectedLanguage: null,
      language: mismatchedSubtitle.language,
      lastOpenedAt: 2_000,
      lastSelectedAt: 2_000,
      requestedLanguageMode: null,
      sessionId: "another-session",
      source: mismatchedSubtitle.source,
      title: null,
      updatedAt: 2_000,
      videoKey: secondVideo.videoKey,
    });
    const mismatchedPlacement = createBranchPlacement({
      branchId: mismatchedBranch.branchId,
      deletionReason: null,
      location: "workspace",
      order: 1_500,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: "another-session",
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    });
    const seed = database.transaction(
      ["branchPlacements", "sessions", "subtitleBranches", "subtitleSnapshots"],
      "readwrite",
    );
    seed.objectStore("sessions").add(missingSubtitleSession);
    seed.objectStore("sessions").add(mismatchedSession);
    seed.objectStore("subtitleBranches").add(mismatchedBranch);
    seed.objectStore("branchPlacements").add(mismatchedPlacement);
    seed.objectStore("subtitleSnapshots").add(mismatchedSubtitle);
    await transactionDone(seed);

    try {
      const repository = new IndexedDbWorkspaceRestorationRepository(database);
      await expect(
        repository.restore(missingSubtitleSession.sessionId),
      ).rejects.toMatchObject({
        code: "STORAGE_TRANSACTION_FAILED",
        message: "The Bilimuzhi workspace data is inconsistent",
        retryable: false,
      });
      await expect(
        repository.restore(mismatchedSession.sessionId),
      ).rejects.toMatchObject({
        code: "STORAGE_TRANSACTION_FAILED",
        message: "The Bilimuzhi workspace data is inconsistent",
        retryable: false,
      });
    } finally {
      database.close();
    }
  });
});
