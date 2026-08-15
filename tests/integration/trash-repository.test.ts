import { afterEach, describe, expect, it } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  createArchiveFolder,
  createArchiveSessionPlacement,
  createBranchPlacement,
  createGenerationRun,
  createSubtitleSnapshot,
  createVideoRef,
  createWorkspaceSessionPlacement,
} from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";
import { IndexedDbTrashRepository } from "../../src/infrastructure/indexeddb/trash-repository";
import { IndexedDbArchiveRepository } from "../../src/infrastructure/indexeddb/archive-repository";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";
import { IndexedDbWorkspaceProjectionRepository } from "../../src/infrastructure/indexeddb/workspace-projection-repository";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-trash-${crypto.randomUUID()}`;
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

async function seedPlacements(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(
    [
      "archiveFolders",
      "archiveSessionPlacements",
      "branchPlacements",
      "workspaceSessionPlacements",
    ],
    "readwrite",
  );
  transaction.objectStore("archiveFolders").put(
    createArchiveFolder({
      folderId: "course-folder",
      order: 1,
      parentFolderId: "archive-root",
      title: "课程",
    }),
  );
  const placements = transaction.objectStore("branchPlacements");
  placements.put(
    createBranchPlacement({
      branchId: "workspace-branch",
      deletionReason: null,
      location: "workspace",
      order: 1,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: "workspace-session",
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
  );
  placements.put(
    createBranchPlacement({
      branchId: "archive-branch",
      deletionReason: null,
      location: "archive",
      order: 2,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: "archive-session",
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
  );
  transaction.objectStore("workspaceSessionPlacements").put(
    createWorkspaceSessionPlacement({
      order: 1,
      pinned: false,
      sessionId: "workspace-session",
    }),
  );
  transaction.objectStore("archiveSessionPlacements").put(
    createArchiveSessionPlacement({
      archivedAt: 2,
      folderId: "course-folder",
      order: 2,
      pinned: false,
      sessionId: "archive-session",
    }),
  );
  await transactionDone(transaction);
}

async function seedOwnedWorkspaceBranch(
  database: IDBDatabase,
): Promise<string> {
  const video = createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    cid: 30_000_000_002,
    page: 2,
    title: "永久删除",
  });
  const session = await new IndexedDbSessionRepository(database, {
    createSessionId: () => "owned-session",
    now: () => 500,
  }).create(video);
  const owner = {
    acquisitionId: "owned-acquisition",
    draftBranchId: "owned-branch",
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: session.sessionId,
    taskId: "owned-task",
    videoKey: video.videoKey,
  };
  const subtitles = new IndexedDbSubtitleRepository(database, {
    now: () => 600,
  });
  await subtitles.beginAcquisition(owner, {
    method: "direct",
    trackId: "official:owned",
  });
  await subtitles.commitAcquisition(
    owner,
    createSubtitleSnapshot({
      branchId: owner.draftBranchId,
      contentHash: "sha256:owned",
      createdAt: 600,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "owned" }],
      sessionId: owner.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "owned-subtitle",
      videoKey: owner.videoKey,
    }),
  );
  const runningGeneration = database.transaction("generationRuns", "readwrite");
  runningGeneration.objectStore("generationRuns").put(
    createGenerationRun({
      branchId: owner.draftBranchId,
      browserSessionId: "owned-browser",
      completionSequence: null,
      contextRevision: 1,
      createdAt: 700,
      errorCode: null,
      expectedOwnerRevision: 0,
      kind: "summary",
      partialOutput: "partial",
      runId: "owned-generation",
      sessionId: owner.sessionId,
      status: "running",
      stopReason: null,
      subtitleId: "owned-subtitle",
      targetId: "owned-target",
      taskId: "owned-generation-task",
      updatedAt: 700,
    }),
  );
  await transactionDone(runningGeneration);
  return owner.draftBranchId;
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("IndexedDbTrashRepository", () => {
  it("moves an empty workspace session to trash, restores it, and permanently deletes it", async () => {
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
        title: "尚未获取字幕",
      });
      await new IndexedDbSessionRepository(database, {
        createSessionId: () => "empty-session",
        now: () => 500,
      }).create(video);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });

      await expect(
        repository.moveWorkspaceSessionToTrash(
          "empty-session",
          "workspace-session",
        ),
      ).resolves.toEqual([]);
      await expect(
        new IndexedDbWorkspaceProjectionRepository(database).load(),
      ).resolves.toMatchObject({
        trash: {
          sessions: [
            {
              branches: [],
              emptySession: {
                trashedAt: 1_000,
                trashOrigin: "workspace",
              },
              sessionId: "empty-session",
            },
          ],
        },
        workspace: { sessions: [] },
      });

      await expect(
        repository.restoreEmptySessionsToWorkspace(["empty-session"]),
      ).resolves.toEqual([
        { order: 500, pinned: false, sessionId: "empty-session" },
      ]);
      await expect(
        new IndexedDbWorkspaceProjectionRepository(database).load(),
      ).resolves.toMatchObject({
        trash: { sessions: [] },
        workspace: { sessions: [{ sessionId: "empty-session" }] },
      });

      await repository.moveWorkspaceSessionToTrash(
        "empty-session",
        "workspace-session",
      );
      await expect(
        repository.permanentlyDeleteTrashContent({
          branchIds: [],
          sessionIds: ["empty-session"],
        }),
      ).resolves.toEqual({ branchIds: [], sessionIds: ["empty-session"] });
      const verify = database.transaction(
        ["sessions", "trashSessionPlacements", "videos"],
        "readonly",
      );
      await expect(
        requestResult(verify.objectStore("sessions").get("empty-session")),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(
          verify.objectStore("trashSessionPlacements").get("empty-session"),
        ),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(verify.objectStore("videos").get(video.videoKey)),
      ).resolves.toBeUndefined();
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("moves populated and empty workspace sessions as one rollback-safe batch", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const branchId = await seedOwnedWorkspaceBranch(database);
      await new IndexedDbSessionRepository(database, {
        createSessionId: () => "empty-batch-session",
        now: () => 700,
      }).create(
        createVideoRef({
          bvid: "BV1Q541167Qh",
          canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qh",
          cid: 30_000_000_003,
          page: 1,
          title: "批量空会话",
        }),
      );
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });

      await expect(
        repository.moveWorkspaceSessionsToTrash(
          ["owned-session", "missing-session", "empty-batch-session"],
          "workspace-selection",
        ),
      ).rejects.toThrow("workspace session placement is missing");
      await expect(
        new IndexedDbWorkspaceProjectionRepository(database).load(),
      ).resolves.toMatchObject({
        trash: { sessions: [] },
        workspace: {
          sessions: expect.arrayContaining([
            expect.objectContaining({ sessionId: "owned-session" }),
            expect.objectContaining({ sessionId: "empty-batch-session" }),
          ]),
        },
      });

      await expect(
        repository.moveWorkspaceSessionsToTrash(
          ["owned-session", "empty-batch-session"],
          "workspace-selection",
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          branchId,
          deletionReason: "workspace-selection",
          location: "trash",
        }),
      ]);
      const projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();
      expect(projection.workspace.sessions).toEqual([]);
      expect(
        projection.trash.sessions.find(
          (session) => session.sessionId === "owned-session",
        ),
      ).toMatchObject({
        branches: [expect.objectContaining({ branchId })],
        sessionId: "owned-session",
      });
      expect(
        projection.trash.sessions.find(
          (session) => session.sessionId === "empty-batch-session",
        ),
      ).toMatchObject({
        branches: [],
        emptySession: expect.objectContaining({ trashOrigin: "workspace" }),
        sessionId: "empty-batch-session",
      });
      const verify = database.transaction("trashSessionPlacements", "readonly");
      await expect(
        requestResult(
          verify
            .objectStore("trashSessionPlacements")
            .get("empty-batch-session"),
        ),
      ).resolves.toMatchObject({ deletionReason: "workspace-selection" });
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("keeps shared video metadata when deleting an older same-video trash session", async () => {
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
        title: "同一视频",
      });
      const firstRepository = new IndexedDbSessionRepository(database, {
        createSessionId: () => "history-session",
        now: () => 500,
      });
      await firstRepository.create(video);
      const trash = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });
      await trash.moveWorkspaceSessionToTrash(
        "history-session",
        "workspace-session",
      );
      await new IndexedDbSessionRepository(database, {
        createSessionId: () => "current-session",
        now: () => 1_500,
      }).create(video);

      await trash.permanentlyDeleteTrashContent({
        branchIds: [],
        sessionIds: ["history-session"],
      });
      const verify = database.transaction(["sessions", "videos"], "readonly");
      await expect(
        requestResult(verify.objectStore("sessions").get("history-session")),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(verify.objectStore("sessions").get("current-session")),
      ).resolves.toBeDefined();
      await expect(
        requestResult(verify.objectStore("videos").get(video.videoKey)),
      ).resolves.toBeDefined();
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("moves every workspace branch of a session to trash without destroying owned data", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const branchId = await seedOwnedWorkspaceBranch(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });

      await expect(
        repository.moveWorkspaceSessionToTrash(
          "owned-session",
          "workspace-session",
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          branchId,
          deletionReason: "workspace-session",
          location: "trash",
          purgeAfter: 1_000 + 7 * 24 * 60 * 60 * 1_000,
          trashOrigin: "workspace",
        }),
      ]);

      const verify = database.transaction(
        [
          "branchPlacements",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      await expect(
        requestResult(verify.objectStore("sessions").get("owned-session")),
      ).resolves.toBeDefined();
      await expect(
        requestResult(verify.objectStore("subtitleBranches").get(branchId)),
      ).resolves.toBeDefined();
      await expect(
        requestResult(
          verify.objectStore("subtitleSnapshots").get("owned-subtitle"),
        ),
      ).resolves.toBeDefined();
      await expect(
        requestResult(
          verify.objectStore("workspaceSessionPlacements").get("owned-session"),
        ),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(
          verify.objectStore("generationRuns").get("owned-generation"),
        ),
      ).resolves.toMatchObject({
        status: "stopped",
        stopReason: "owner-deleted",
      });
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("moves workspace and archive branches atomically while retaining exact origin metadata", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedPlacements(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });

      await expect(
        repository.moveToTrash(
          ["workspace-branch", "archive-branch"],
          "user-delete",
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          branchId: "workspace-branch",
          purgeAfter: 1_000 + 7 * 24 * 60 * 60 * 1_000,
          retentionStartedAt: 1_000,
          trashedAt: 1_000,
          trashOrigin: "workspace",
        }),
        expect.objectContaining({
          branchId: "archive-branch",
          trashOrigin: "archive",
          trashOriginFolderId: "course-folder",
          trashOriginPathSnapshot: "归档 / 课程",
        }),
      ]);

      const transaction = database.transaction(
        [
          "archiveSessionPlacements",
          "branchPlacements",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      await expect(
        requestResult(
          transaction.objectStore("branchPlacements").get("workspace-branch"),
        ),
      ).resolves.toMatchObject({ location: "trash" });
      await expect(
        requestResult(
          transaction.objectStore("branchPlacements").get("archive-branch"),
        ),
      ).resolves.toMatchObject({ location: "trash" });
      await expect(
        requestResult(
          transaction
            .objectStore("workspaceSessionPlacements")
            .get("workspace-session"),
        ),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(
          transaction
            .objectStore("archiveSessionPlacements")
            .get("archive-session"),
        ),
      ).resolves.toBeUndefined();
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  });

  it("rejects a non-live branch without moving the other selected branch", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedPlacements(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });

      await expect(
        repository.moveToTrash(
          ["workspace-branch", "missing-branch"],
          "user-delete",
        ),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      const transaction = database.transaction("branchPlacements", "readonly");
      await expect(
        requestResult(
          transaction.objectStore("branchPlacements").get("workspace-branch"),
        ),
      ).resolves.toMatchObject({ location: "workspace" });
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  });

  it("restores workspace and archive origins without retaining trash metadata", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedPlacements(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 2_000,
      });
      await repository.moveToTrash(
        ["workspace-branch", "archive-branch"],
        "user-delete",
      );

      await expect(
        repository.restoreToWorkspace(["workspace-branch"]),
      ).resolves.toEqual([
        expect.objectContaining({
          branchId: "workspace-branch",
          deletionReason: null,
          location: "workspace",
          purgeAfter: null,
          retentionStartedAt: null,
          trashedAt: null,
          trashOrigin: null,
        }),
      ]);

      const transaction = database.transaction(
        ["branchPlacements", "workspaceSessionPlacements"],
        "readonly",
      );
      await expect(
        requestResult(
          transaction.objectStore("branchPlacements").get("workspace-branch"),
        ),
      ).resolves.toMatchObject({ location: "workspace" });
      await expect(
        requestResult(
          transaction
            .objectStore("workspaceSessionPlacements")
            .get("workspace-session"),
        ),
      ).resolves.toBeDefined();
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  });

  it("previews and atomically deletes a nested archive folder tree into trash", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedPlacements(database);
      const seed = database.transaction(
        [
          "archiveFolders",
          "archiveSessionPlacements",
          "branchPlacements",
          "generationRuns",
        ],
        "readwrite",
      );
      seed.objectStore("archiveFolders").put(
        createArchiveFolder({
          folderId: "child-folder",
          order: 1,
          parentFolderId: "course-folder",
          title: "子目录",
        }),
      );
      seed.objectStore("archiveSessionPlacements").put(
        createArchiveSessionPlacement({
          archivedAt: 3,
          folderId: "child-folder",
          order: 3,
          pinned: false,
          sessionId: "child-session",
        }),
      );
      seed.objectStore("branchPlacements").put(
        createBranchPlacement({
          branchId: "child-branch",
          deletionReason: null,
          location: "archive",
          order: 3,
          purgeAfter: null,
          retentionStartedAt: null,
          sessionId: "child-session",
          trashedAt: null,
          trashOrigin: null,
          trashOriginFolderId: null,
          trashOriginPathSnapshot: null,
        }),
      );
      seed.objectStore("generationRuns").put(
        createGenerationRun({
          branchId: "child-branch",
          browserSessionId: "browser-a",
          completionSequence: null,
          contextRevision: 1,
          createdAt: 500,
          errorCode: null,
          expectedOwnerRevision: 0,
          kind: "summary",
          partialOutput: "partial",
          runId: "child-run",
          sessionId: "child-session",
          status: "running",
          stopReason: null,
          subtitleId: "child-subtitle",
          targetId: "child-target",
          taskId: "child-task",
          updatedAt: 500,
        }),
      );
      await transactionDone(seed);

      const repository = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });
      await expect(
        repository.previewArchiveFolderDeletion("archive-root"),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        repository.previewArchiveFolderDeletion("course-folder"),
      ).resolves.toEqual({
        branchCount: 2,
        branchIds: ["archive-branch", "child-branch"],
        folderIds: ["course-folder", "child-folder"],
        runningTaskCount: 1,
        sessionCount: 2,
        sessionIds: ["archive-session", "child-session"],
      });

      await expect(
        repository.deleteArchiveFolderTree("course-folder", "folder-delete"),
      ).resolves.toHaveLength(2);
      const verify = database.transaction(
        [
          "archiveFolders",
          "archiveSessionPlacements",
          "branchPlacements",
          "generationRuns",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      await expect(
        Promise.all(
          ["course-folder", "child-folder"].map((folderId) =>
            requestResult(verify.objectStore("archiveFolders").get(folderId)),
          ),
        ),
      ).resolves.toEqual([undefined, undefined]);
      await expect(
        requestResult(verify.objectStore("archiveSessionPlacements").count()),
      ).resolves.toBe(0);
      await expect(
        Promise.all(
          ["archive-branch", "child-branch"].map((branchId) =>
            requestResult(verify.objectStore("branchPlacements").get(branchId)),
          ),
        ),
      ).resolves.toEqual([
        expect.objectContaining({
          location: "trash",
          trashOrigin: "archive",
          trashOriginFolderId: "course-folder",
        }),
        expect.objectContaining({
          location: "trash",
          trashOrigin: "archive",
          trashOriginFolderId: "child-folder",
        }),
      ]);
      await expect(
        requestResult(verify.objectStore("generationRuns").get("child-run")),
      ).resolves.toMatchObject({
        status: "stopped",
        stopReason: "owner-deleted",
      });
      await expect(
        requestResult(
          verify
            .objectStore("workspaceSessionPlacements")
            .get("workspace-session"),
        ),
      ).resolves.toMatchObject({ sessionId: "workspace-session" });
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("permanently deletes a trashed final branch and every owned record", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const branchId = await seedOwnedWorkspaceBranch(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 4_000,
      });
      const seedAttachment = database.transaction("attachments", "readwrite");
      seedAttachment.objectStore("attachments").put({
        attachmentId: "owned-image",
        blob: new Blob(["safe image bytes"], { type: "image/png" }),
        branchId,
        chatThreadId: "owned-thread",
        currentTimeMs: 12_000,
        messageId: "owned-message",
        mimeType: "image/png",
        sessionId: "owned-session",
        subtitleContextRevision: 1,
        thumbnailBlob: new Blob(["safe thumbnail"], { type: "image/png" }),
        videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
      });
      await transactionDone(seedAttachment);
      await repository.moveToTrash([branchId], "user-delete");
      const stoppedRead = database.transaction(
        ["attachments", "generationRuns"],
        "readonly",
      );
      await expect(
        requestResult(
          stoppedRead.objectStore("generationRuns").get("owned-generation"),
        ),
      ).resolves.toMatchObject({
        status: "stopped",
        stopReason: "owner-deleted",
        updatedAt: 4_000,
      });
      await expect(
        requestResult(
          stoppedRead.objectStore("attachments").get("owned-image"),
        ),
      ).resolves.toMatchObject({
        attachmentId: "owned-image",
        chatThreadId: "owned-thread",
        currentTimeMs: 12_000,
        subtitleContextRevision: 1,
      });
      await transactionDone(stoppedRead);

      await expect(
        repository.permanentlyDeleteTrashBranches([branchId]),
      ).resolves.toEqual([branchId]);
      const transaction = database.transaction(
        [
          "attachments",
          "branchPlacements",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
          "videos",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      await expect(
        Promise.all(
          [
            "attachments",
            "branchPlacements",
            "generationRuns",
            "sessions",
            "subtitleBranches",
            "subtitleSnapshots",
            "videos",
            "workspaceSessionPlacements",
          ].map((storeName) =>
            requestResult(transaction.objectStore(storeName).count()),
          ),
        ),
      ).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  });

  it("selects and permanently deletes expired trash branches in one repository transaction", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const branchId = await seedOwnedWorkspaceBranch(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 4_000,
      });
      await repository.moveToTrash([branchId], "retention-expired");
      const updateExpiry = database.transaction(
        "branchPlacements",
        "readwrite",
      );
      const placements = updateExpiry.objectStore("branchPlacements");
      const placement = await requestResult(placements.get(branchId));
      placements.put(
        createBranchPlacement({
          ...(placement as Parameters<typeof createBranchPlacement>[0]),
          purgeAfter: 4_500,
        }),
      );
      await transactionDone(updateExpiry);

      await expect(
        repository.permanentlyDeleteExpiredTrashBranches(4_499),
      ).resolves.toEqual([]);
      await expect(
        repository.permanentlyDeleteExpiredTrashBranches(4_500),
      ).resolves.toEqual([branchId]);
      const verify = database.transaction(
        ["branchPlacements", "subtitleBranches", "generationRuns"],
        "readonly",
      );
      await expect(
        Promise.all(
          ["branchPlacements", "subtitleBranches", "generationRuns"].map(
            (storeName) => requestResult(verify.objectStore(storeName).count()),
          ),
        ),
      ).resolves.toEqual([0, 0, 0]);
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("previews deduplicated trash counts and running tasks without writing", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const branchId = await seedOwnedWorkspaceBranch(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 4_000,
      });
      await repository.moveToTrash([branchId], "user-delete");
      await new IndexedDbSessionRepository(database, {
        createSessionId: () => "preview-empty-session",
        now: () => 4_000,
      }).create(
        createVideoRef({
          bvid: "BV1Q541167Qj",
          canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qj",
          cid: 30_000_000_005,
          page: 1,
          title: "预览空会话",
        }),
      );
      await repository.moveWorkspaceSessionToTrash(
        "preview-empty-session",
        "workspace-session",
      );
      // 回收站分支上仍处于排队/运行中的任务（如恢复后重新触发的任务被再次删除前）。
      const runningSeed = database.transaction("generationRuns", "readwrite");
      runningSeed.objectStore("generationRuns").put(
        createGenerationRun({
          branchId,
          browserSessionId: "preview-browser",
          completionSequence: null,
          contextRevision: 1,
          createdAt: 4_100,
          errorCode: null,
          expectedOwnerRevision: 0,
          kind: "summary",
          partialOutput: "partial",
          runId: "preview-generation",
          sessionId: "owned-session",
          status: "running",
          stopReason: null,
          subtitleId: "owned-subtitle",
          targetId: "preview-target",
          taskId: "preview-task",
          updatedAt: 4_100,
        }),
      );
      await transactionDone(runningSeed);

      // 分支 + 空会话混合选择；预览不写任何数据。
      await expect(
        repository.previewTrashPermanentDeletion({
          branchIds: [branchId],
          sessionIds: ["preview-empty-session"],
        }),
      ).resolves.toEqual({
        branchCount: 1,
        runningTaskCount: 1,
        sessionCount: 2,
      });
      const unchanged = database.transaction(
        ["branchPlacements", "trashSessionPlacements", "generationRuns"],
        "readonly",
      );
      await expect(
        requestResult(unchanged.objectStore("branchPlacements").count()),
      ).resolves.toBeGreaterThan(0);
      await expect(
        requestResult(unchanged.objectStore("trashSessionPlacements").count()),
      ).resolves.toBeGreaterThan(0);
      await expect(
        requestResult(unchanged.objectStore("generationRuns").count()),
      ).resolves.toBeGreaterThan(0);
      await transactionDone(unchanged);

      // 只有运行中/排队任务计入；停止或失败的任务不计。
      const settleSeed = database.transaction("generationRuns", "readwrite");
      const runs = settleSeed.objectStore("generationRuns");
      const storedRun = await requestResult(runs.get("preview-generation"));
      runs.put(
        createGenerationRun({
          ...(storedRun as Parameters<typeof createGenerationRun>[0]),
          errorCode: "summary-generation-failed",
          status: "failed",
        }),
      );
      await transactionDone(settleSeed);
      await expect(
        repository.previewTrashPermanentDeletion({
          branchIds: [branchId],
          sessionIds: [],
        }),
      ).resolves.toEqual({
        branchCount: 1,
        runningTaskCount: 0,
        sessionCount: 1,
      });
    } finally {
      database.close();
    }
  });

  it("rejects previews that reference missing or non-trash owners", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedPlacements(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });
      await expect(
        repository.previewTrashPermanentDeletion({
          branchIds: ["workspace-branch"],
          sessionIds: [],
        }),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        repository.previewTrashPermanentDeletion({
          branchIds: ["missing-branch"],
          sessionIds: [],
        }),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        repository.previewTrashPermanentDeletion({
          branchIds: [],
          sessionIds: ["missing-session"],
        }),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        repository.previewTrashPermanentDeletion({
          branchIds: [],
          sessionIds: [],
        }),
      ).resolves.toEqual({
        branchCount: 0,
        runningTaskCount: 0,
        sessionCount: 0,
      });
    } finally {
      database.close();
    }
  });

  it("moves an archived empty session to trash and restores it to the workspace", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await new IndexedDbSessionRepository(database, {
        createSessionId: () => "archived-empty-session",
        now: () => 700,
      }).create(
        createVideoRef({
          bvid: "BV1Q541167Qi",
          canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qi",
          cid: 30_000_000_004,
          page: 1,
          title: "归档空会话",
        }),
      );
      await new IndexedDbArchiveRepository(database, {
        now: () => 800,
      }).archiveWorkspaceBranches([], "archive-root", [
        "archived-empty-session",
      ]);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 1_000,
      });

      await expect(
        repository.moveArchivedEmptySessionToTrash(
          "archived-empty-session",
          "archive-session",
        ),
      ).resolves.toMatchObject({ sessionId: "archived-empty-session" });

      let projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();
      expect(
        projection.trash.sessions.find(
          (session) => session.sessionId === "archived-empty-session",
        ),
      ).toMatchObject({
        branches: [],
        emptySession: expect.objectContaining({
          trashOrigin: "archive",
        }),
        sessionId: "archived-empty-session",
      });

      await expect(
        repository.restoreEmptySessionsToWorkspace(["archived-empty-session"]),
      ).resolves.toMatchObject([{ sessionId: "archived-empty-session" }]);
      projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();
      expect(projection.trash.sessions).toEqual([]);
      expect(projection.workspace.sessions).toMatchObject([
        { sessionId: "archived-empty-session" },
      ]);
    } finally {
      database.close();
    }
  });

  it("restores an archive-origin trash branch back to the workspace", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedPlacements(database);
      const repository = new IndexedDbTrashRepository(database, {
        now: () => 2_000,
      });
      await repository.moveToTrash(["archive-branch"], "archive-session");
      await expect(
        repository.restoreToWorkspace(["archive-branch"]),
      ).resolves.toEqual([
        expect.objectContaining({
          branchId: "archive-branch",
          deletionReason: null,
          location: "workspace",
          trashOrigin: null,
        }),
      ]);
      const verify = database.transaction(
        ["branchPlacements", "workspaceSessionPlacements"],
        "readonly",
      );
      await expect(
        requestResult(
          verify.objectStore("branchPlacements").get("archive-branch"),
        ),
      ).resolves.toMatchObject({ location: "workspace" });
      await expect(
        requestResult(
          verify
            .objectStore("workspaceSessionPlacements")
            .get("archive-session"),
        ),
      ).resolves.toBeDefined();
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });
});
