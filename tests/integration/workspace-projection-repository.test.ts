import { afterEach, describe, expect, it } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  createArchiveFolder,
  createArchiveSessionPlacement,
  createBranchPlacement,
  createChatMessage,
  createChatThread,
  createGenerationRun,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createWorkspaceSessionPlacement,
  type BranchPlacement,
  type Session,
  type SubtitleBranch,
  type VideoKey,
} from "../../src/domain";
import {
  openBilimuzhiDatabase,
  ROOT_ARCHIVE_FOLDER_ID,
} from "../../src/infrastructure/indexeddb/muzhi-database";
import { transactionDone } from "../../src/infrastructure/indexeddb/idb-requests";
import { IndexedDbWorkspaceProjectionRepository } from "../../src/infrastructure/indexeddb/workspace-projection-repository";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-workspace-projection-${crypto.randomUUID()}`;
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

const videoKeyA = "bvid:BV1Q541167Qg:cid:30000000002:p:2" as VideoKey;
const videoKeyB = "bvid:BV1xx411c7mD:cid:30000000003:p:1" as VideoKey;

function session(
  sessionId: string,
  videoKey: VideoKey,
  title: string,
): Session {
  return createSession({
    activeBranchId: null,
    createdAt: 100,
    customTitle: true,
    lastActivityAt: 900,
    selectionRevision: 3,
    sessionId,
    title,
    updatedAt: 900,
    videoKey,
  });
}

function branch(input: {
  branchId: string;
  completionSequence?: number;
  createdAt: number;
  lastOpenedAt: number;
  lastReadCompletionSequence?: number;
  sessionId: string;
  subtitleId: string;
  videoKey: VideoKey;
}): SubtitleBranch {
  return createSubtitleBranch({
    activeSubtitleId: input.subtitleId,
    branchId: input.branchId,
    completionSequence: input.completionSequence ?? 0,
    contextRevision: 1,
    createdAt: input.createdAt,
    detectedLanguage: null,
    language: "zh-CN",
    lastOpenedAt: input.lastOpenedAt,
    lastReadCompletionSequence: input.lastReadCompletionSequence ?? 0,
    lastSelectedAt: input.lastOpenedAt,
    requestedLanguageMode: null,
    sessionId: input.sessionId,
    source: "bilibili",
    title: `${input.branchId} title`,
    updatedAt: input.lastOpenedAt,
    videoKey: input.videoKey,
  });
}

function placement(input: {
  branchId: string;
  location: "workspace" | "archive" | "trash";
  order: number;
  sessionId: string;
  trashOrigin?: "workspace" | "archive";
}): BranchPlacement {
  const trashedAt = input.location === "trash" ? 1_000 + input.order : null;
  const trashOrigin = input.trashOrigin ?? null;
  return createBranchPlacement({
    branchId: input.branchId,
    deletionReason: input.location === "trash" ? "user-delete" : null,
    location: input.location,
    order: input.order,
    purgeAfter: trashedAt === null ? null : trashedAt + 7 * 86_400_000,
    retentionStartedAt: trashedAt,
    sessionId: input.sessionId,
    trashedAt,
    trashOrigin,
    trashOriginFolderId: trashOrigin === "archive" ? "folder-child" : null,
    trashOriginPathSnapshot: trashOrigin === "archive" ? "归档 / 课程" : null,
  });
}

describe("IndexedDbWorkspaceProjectionRepository", () => {
  it("derives dense same-video ordinals across workspace, archive, and trash", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const makeSession = (sessionId: string, createdAt: number) =>
        createSession({
          activeBranchId: null,
          createdAt,
          customTitle: false,
          lastActivityAt: createdAt,
          selectionRevision: 0,
          sessionId,
          title: "同一视频",
          updatedAt: createdAt,
          videoKey: videoKeyA,
        });
      const trashSession = makeSession("session-oldest", 100);
      const archiveSession = makeSession("session-middle", 200);
      const workspaceSession = makeSession("session-newest", 300);
      const trashBranch = branch({
        branchId: "branch-oldest",
        createdAt: 100,
        lastOpenedAt: 100,
        sessionId: trashSession.sessionId,
        subtitleId: "subtitle-oldest",
        videoKey: videoKeyA,
      });
      const archiveBranch = branch({
        branchId: "branch-middle",
        createdAt: 200,
        lastOpenedAt: 200,
        sessionId: archiveSession.sessionId,
        subtitleId: "subtitle-middle",
        videoKey: videoKeyA,
      });
      const seed = database.transaction(
        [
          "archiveSessionPlacements",
          "branchPlacements",
          "sessions",
          "subtitleBranches",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      for (const value of [trashSession, archiveSession, workspaceSession]) {
        seed.objectStore("sessions").put(value);
      }
      seed.objectStore("subtitleBranches").put(trashBranch);
      seed.objectStore("subtitleBranches").put(archiveBranch);
      seed.objectStore("branchPlacements").put(
        placement({
          branchId: trashBranch.branchId,
          location: "trash",
          order: 0,
          sessionId: trashSession.sessionId,
          trashOrigin: "workspace",
        }),
      );
      seed.objectStore("branchPlacements").put(
        placement({
          branchId: archiveBranch.branchId,
          location: "archive",
          order: 0,
          sessionId: archiveSession.sessionId,
        }),
      );
      seed.objectStore("archiveSessionPlacements").put(
        createArchiveSessionPlacement({
          archivedAt: 0,
          folderId: ROOT_ARCHIVE_FOLDER_ID,
          order: 0,
          pinned: false,
          sessionId: archiveSession.sessionId,
        }),
      );
      seed.objectStore("workspaceSessionPlacements").put(
        createWorkspaceSessionPlacement({
          order: 0,
          pinned: false,
          sessionId: workspaceSession.sessionId,
        }),
      );
      await transactionDone(seed);

      const repository = new IndexedDbWorkspaceProjectionRepository(database);
      const first = await repository.load();
      expect(first.trash.sessions[0]?.title).toBe("[1] 同一视频");
      expect(first.archive.sessions[0]?.title).toBe("[2] 同一视频");
      expect(first.workspace.sessions[0]?.title).toBe("[3] 同一视频");

      const deleteOldest = database.transaction(
        ["branchPlacements", "sessions", "subtitleBranches"],
        "readwrite",
      );
      deleteOldest.objectStore("branchPlacements").delete(trashBranch.branchId);
      deleteOldest.objectStore("subtitleBranches").delete(trashBranch.branchId);
      deleteOldest.objectStore("sessions").delete(trashSession.sessionId);
      await transactionDone(deleteOldest);
      const second = await repository.load();
      expect(second.archive.sessions[0]?.title).toBe("[1] 同一视频");
      expect(second.workspace.sessions[0]?.title).toBe("[2] 同一视频");

      const deleteMiddle = database.transaction(
        [
          "archiveSessionPlacements",
          "branchPlacements",
          "sessions",
          "subtitleBranches",
        ],
        "readwrite",
      );
      deleteMiddle
        .objectStore("archiveSessionPlacements")
        .delete(archiveSession.sessionId);
      deleteMiddle
        .objectStore("branchPlacements")
        .delete(archiveBranch.branchId);
      deleteMiddle
        .objectStore("subtitleBranches")
        .delete(archiveBranch.branchId);
      deleteMiddle.objectStore("sessions").delete(archiveSession.sessionId);
      await transactionDone(deleteMiddle);
      const third = await repository.load();
      expect(third.workspace.sessions[0]?.title).toBe("同一视频");
    } finally {
      database.close();
    }
  });

  it("isolates workspace, archive, and trash branches while preserving stable sorting and status aggregation", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const sessionA = session("session-a", videoKeyA, "精确 P2 会话");
      const sessionB = session("session-b", videoKeyB, "置顶会话");
      const workspaceA = branch({
        branchId: "workspace-a",
        completionSequence: 3,
        createdAt: 200,
        lastOpenedAt: 800,
        lastReadCompletionSequence: 1,
        sessionId: sessionA.sessionId,
        subtitleId: "subtitle-workspace-a",
        videoKey: videoKeyA,
      });
      const archiveA = branch({
        branchId: "archive-a",
        createdAt: 300,
        lastOpenedAt: 700,
        sessionId: sessionA.sessionId,
        subtitleId: "subtitle-archive-a",
        videoKey: videoKeyA,
      });
      const trashA = branch({
        branchId: "trash-a",
        createdAt: 400,
        lastOpenedAt: 600,
        sessionId: sessionA.sessionId,
        subtitleId: "subtitle-trash-a",
        videoKey: videoKeyA,
      });
      const workspaceB = branch({
        branchId: "workspace-b",
        createdAt: 500,
        lastOpenedAt: 500,
        sessionId: sessionB.sessionId,
        subtitleId: "subtitle-workspace-b",
        videoKey: videoKeyB,
      });
      const transaction = database.transaction(
        [
          "archiveFolders",
          "archiveSessionPlacements",
          "branchPlacements",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      transaction.objectStore("sessions").put(sessionA);
      transaction.objectStore("sessions").put(sessionB);
      for (const value of [workspaceA, archiveA, trashA, workspaceB]) {
        transaction.objectStore("subtitleBranches").put(value);
      }
      for (const value of [
        placement({
          branchId: workspaceA.branchId,
          location: "workspace",
          order: 2,
          sessionId: sessionA.sessionId,
        }),
        placement({
          branchId: archiveA.branchId,
          location: "archive",
          order: 1,
          sessionId: sessionA.sessionId,
        }),
        placement({
          branchId: trashA.branchId,
          location: "trash",
          order: 9,
          sessionId: sessionA.sessionId,
          trashOrigin: "archive",
        }),
        placement({
          branchId: workspaceB.branchId,
          location: "workspace",
          order: 1,
          sessionId: sessionB.sessionId,
        }),
      ]) {
        transaction.objectStore("branchPlacements").put(value);
      }
      transaction.objectStore("workspaceSessionPlacements").put(
        createWorkspaceSessionPlacement({
          order: 0,
          pinned: false,
          sessionId: sessionA.sessionId,
        }),
      );
      transaction.objectStore("workspaceSessionPlacements").put(
        createWorkspaceSessionPlacement({
          order: 99,
          pinned: true,
          sessionId: sessionB.sessionId,
        }),
      );
      transaction.objectStore("archiveFolders").put(
        createArchiveFolder({
          folderId: "folder-child",
          order: 2,
          parentFolderId: ROOT_ARCHIVE_FOLDER_ID,
          title: "课程",
        }),
      );
      transaction.objectStore("archiveSessionPlacements").put(
        createArchiveSessionPlacement({
          archivedAt: 4,
          folderId: "folder-child",
          order: 4,
          pinned: true,
          sessionId: sessionA.sessionId,
        }),
      );
      transaction.objectStore("generationRuns").put(
        createGenerationRun({
          branchId: workspaceA.branchId,
          browserSessionId: "browser-a",
          completionSequence: null,
          contextRevision: workspaceA.contextRevision,
          createdAt: 900,
          errorCode: null,
          expectedOwnerRevision: 0,
          kind: "summary",
          partialOutput: "private running output",
          runId: "run-workspace-a",
          sessionId: sessionA.sessionId,
          status: "running",
          stopReason: null,
          subtitleId: workspaceA.activeSubtitleId,
          targetId: "summary-workspace-a",
          taskId: "task-workspace-a",
          updatedAt: 900,
        }),
      );
      await transactionDone(transaction);

      const projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();

      expect(
        projection.workspace.sessions.map((value) => value.sessionId),
      ).toEqual(["session-b", "session-a"]);
      expect(projection.workspace.sessions[1]).toMatchObject({
        branches: [
          {
            branchId: "workspace-a",
            running: true,
            unread: true,
          },
        ],
        location: "workspace",
        title: "精确 P2 会话",
        videoKey: videoKeyA,
      });
      expect(projection.archive.sessions).toMatchObject([
        {
          branches: [{ branchId: "archive-a", running: false, unread: false }],
          folderId: "folder-child",
          location: "archive",
          pinned: true,
          sessionId: "session-a",
        },
      ]);
      expect(projection.trash.sessions).toMatchObject([
        {
          branches: [
            {
              branchId: "trash-a",
              trashOrigin: "archive",
              trashOriginFolderId: "folder-child",
              trashOriginPathSnapshot: "归档 / 课程",
            },
          ],
          location: "trash",
          sessionId: "session-a",
          title: "精确 P2 会话",
          videoKey: videoKeyA,
        },
      ]);
      expect(projection.archive.folders).toMatchObject([
        {
          childFolderIds: ["folder-child"],
          folderId: ROOT_ARCHIVE_FOLDER_ID,
          isRoot: true,
        },
        {
          childFolderIds: [],
          folderId: "folder-child",
          isRoot: false,
          sessionIds: ["session-a"],
        },
      ]);
      expect(projection.workspace.sessions[1]?.branches).toHaveLength(1);
      expect(projection.archive.sessions[0]?.branches).toHaveLength(1);
      expect(projection.trash.sessions[0]?.branches).toHaveLength(1);
    } finally {
      database.close();
    }
  });

  it("keeps trash metadata-only even when subtitle, chat, and run content exist", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const trashSession = session("private-session", videoKeyA, "隐私会话");
      const trash = branch({
        branchId: "private-trash-branch",
        createdAt: 200,
        lastOpenedAt: 300,
        sessionId: trashSession.sessionId,
        subtitleId: "private-subtitle",
        videoKey: videoKeyA,
      });
      const transaction = database.transaction(
        [
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
      transaction.objectStore("sessions").put(trashSession);
      transaction.objectStore("subtitleBranches").put(trash);
      transaction.objectStore("branchPlacements").put(
        placement({
          branchId: trash.branchId,
          location: "trash",
          order: 5,
          sessionId: trashSession.sessionId,
          trashOrigin: "workspace",
        }),
      );
      transaction.objectStore("subtitleSnapshots").put(
        createSubtitleSnapshot({
          branchId: trash.branchId,
          contentHash: "sha256:private",
          createdAt: 200,
          language: "zh-CN",
          rows: [{ endMs: 1_000, startMs: 0, text: "SECRET_SUBTITLE_TEXT" }],
          sessionId: trashSession.sessionId,
          source: "bilibili",
          status: "active",
          subtitleId: trash.activeSubtitleId,
          videoKey: videoKeyA,
        }),
      );
      transaction.objectStore("chatThreads").put(
        createChatThread({
          branchId: trash.branchId,
          chatThreadId: "private-thread",
          conversationRevision: 0,
          createdAt: 300,
          order: 0,
          sessionId: trashSession.sessionId,
          subtitleId: trash.activeSubtitleId,
          title: "private thread",
          updatedAt: 300,
        }),
      );
      transaction.objectStore("chatMessages").put(
        createChatMessage({
          chatThreadId: "private-thread",
          content: "SECRET_CHAT_CONTENT",
          createdAt: 300,
          generationRunId: null,
          messageId: "private-message",
          order: 0,
          role: "user",
          status: "complete",
          updatedAt: 300,
        }),
      );
      transaction.objectStore("generationRuns").put(
        createGenerationRun({
          branchId: trash.branchId,
          browserSessionId: "private-browser",
          completionSequence: null,
          contextRevision: trash.contextRevision,
          createdAt: 300,
          errorCode: null,
          expectedOwnerRevision: 0,
          kind: "chat",
          partialOutput: "SECRET_PARTIAL_OUTPUT",
          runId: "private-run",
          sessionId: trashSession.sessionId,
          status: "running",
          stopReason: null,
          subtitleId: trash.activeSubtitleId,
          targetId: "private-thread",
          taskId: "private-task",
          updatedAt: 300,
        }),
      );
      await transactionDone(transaction);

      const projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();
      const serialized = JSON.stringify(projection.trash);

      expect(projection.trash.sessions).toHaveLength(1);
      expect(
        Object.keys(projection.trash.sessions[0]?.branches[0] ?? {}),
      ).toEqual([
        "branchId",
        "createdAt",
        "detectedLanguage",
        "language",
        "purgeAfter",
        "requestedLanguageMode",
        "source",
        "title",
        "trackOrigin",
        "trashedAt",
        "trashOrigin",
        "trashOriginFolderId",
        "trashOriginPathSnapshot",
      ]);
      expect(serialized).not.toContain("SECRET_SUBTITLE_TEXT");
      expect(serialized).not.toContain("SECRET_CHAT_CONTENT");
      expect(serialized).not.toContain("SECRET_PARTIAL_OUTPUT");
      expect(serialized).not.toContain("activeSubtitleId");
      expect(serialized).not.toContain("contextRevision");
      expect(serialized).not.toContain("partialOutput");
    } finally {
      database.close();
    }
  });

  it("omits malformed relations, corrupt trash metadata, and folders not connected to the root", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const validSession = session("valid-session", videoKeyA, "有效会话");
      const validBranch = branch({
        branchId: "valid-branch",
        createdAt: 200,
        lastOpenedAt: 300,
        sessionId: validSession.sessionId,
        subtitleId: "valid-subtitle",
        videoKey: videoKeyA,
      });
      const mismatchedBranch = branch({
        branchId: "mismatched-branch",
        createdAt: 200,
        lastOpenedAt: 300,
        sessionId: validSession.sessionId,
        subtitleId: "mismatched-subtitle",
        videoKey: videoKeyB,
      });
      const transaction = database.transaction(
        [
          "archiveFolders",
          "archiveSessionPlacements",
          "branchPlacements",
          "sessions",
          "subtitleBranches",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      transaction.objectStore("sessions").put(validSession);
      transaction.objectStore("subtitleBranches").put(validBranch);
      transaction.objectStore("subtitleBranches").put(mismatchedBranch);
      transaction.objectStore("workspaceSessionPlacements").put(
        createWorkspaceSessionPlacement({
          order: 0,
          pinned: false,
          sessionId: validSession.sessionId,
        }),
      );
      transaction.objectStore("branchPlacements").put({
        ...placement({
          branchId: validBranch.branchId,
          location: "trash",
          order: 0,
          sessionId: validSession.sessionId,
          trashOrigin: "workspace",
        }),
        retentionStartedAt: null,
      });
      transaction.objectStore("branchPlacements").put(
        placement({
          branchId: mismatchedBranch.branchId,
          location: "workspace",
          order: 1,
          sessionId: validSession.sessionId,
        }),
      );
      for (const folder of [
        createArchiveFolder({
          folderId: "orphan-folder",
          order: 1,
          parentFolderId: "missing-parent",
          title: "孤儿",
        }),
        createArchiveFolder({
          folderId: "cycle-a",
          order: 2,
          parentFolderId: "cycle-b",
          title: "循环 A",
        }),
        createArchiveFolder({
          folderId: "cycle-b",
          order: 3,
          parentFolderId: "cycle-a",
          title: "循环 B",
        }),
      ]) {
        transaction.objectStore("archiveFolders").put(folder);
      }
      transaction.objectStore("archiveSessionPlacements").put(
        createArchiveSessionPlacement({
          archivedAt: 0,
          folderId: "orphan-folder",
          order: 0,
          pinned: false,
          sessionId: validSession.sessionId,
        }),
      );
      await transactionDone(transaction);

      const projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();

      expect(projection.workspace.sessions).toEqual([
        expect.objectContaining({
          branches: [],
          sessionId: validSession.sessionId,
          title: validSession.title,
        }),
      ]);
      expect(projection.archive.sessions).toEqual([]);
      expect(projection.trash.sessions).toEqual([]);
      expect(projection.archive.folders.map((value) => value.folderId)).toEqual(
        [ROOT_ARCHIVE_FOLDER_ID],
      );
    } finally {
      database.close();
    }
  });

  it("includes archived sessions without any branch in the archive projection", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const session = createSession({
        activeBranchId: null,
        createdAt: 100,
        customTitle: false,
        lastActivityAt: 100,
        selectionRevision: 0,
        sessionId: "archived-empty",
        title: "空会话",
        updatedAt: 100,
        videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
      });
      const seed = database.transaction(
        ["archiveSessionPlacements", "sessions"],
        "readwrite",
      );
      seed.objectStore("sessions").put(session);
      seed.objectStore("archiveSessionPlacements").put(
        createArchiveSessionPlacement({
          archivedAt: 5,
          folderId: ROOT_ARCHIVE_FOLDER_ID,
          order: 5,
          pinned: false,
          sessionId: session.sessionId,
        }),
      );
      await transactionDone(seed);

      const projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();
      expect(
        projection.archive.sessions.find(
          (item) => item.sessionId === "archived-empty",
        ),
      ).toMatchObject({
        branches: [],
        folderId: ROOT_ARCHIVE_FOLDER_ID,
        sessionId: "archived-empty",
      });
    } finally {
      database.close();
    }
  });

  it("resolves archivedAt from legacy placements via order, and from branch/session time when order is zero", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const makeSession = (sessionId: string, createdAt: number) =>
        createSession({
          activeBranchId: null,
          createdAt,
          customTitle: false,
          lastActivityAt: createdAt,
          selectionRevision: 0,
          sessionId,
          title: sessionId,
          updatedAt: createdAt,
          videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
        });
      const seed = database.transaction(
        ["archiveSessionPlacements", "sessions"],
        "readwrite",
      );
      const legacyOrder = makeSession("legacy-order", 100);
      const legacyZero = makeSession("legacy-zero", 200);
      seed.objectStore("sessions").put(legacyOrder);
      seed.objectStore("sessions").put(legacyZero);
      // 旧数据：无 archivedAt 字段（order 为时间戳）
      seed.objectStore("archiveSessionPlacements").put({
        folderId: ROOT_ARCHIVE_FOLDER_ID,
        order: 1_752_729_600_000,
        pinned: false,
        sessionId: "legacy-order",
      });
      // 旧数据：order 为 0（序号），回退到会话时间
      seed.objectStore("archiveSessionPlacements").put({
        folderId: ROOT_ARCHIVE_FOLDER_ID,
        order: 0,
        pinned: false,
        sessionId: "legacy-zero",
      });
      await transactionDone(seed);

      const projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();
      const byId = new Map(
        projection.archive.sessions.map((item) => [item.sessionId, item]),
      );
      expect(byId.get("legacy-order")?.archivedAt).toBe(1_752_729_600_000);
      expect(byId.get("legacy-zero")?.archivedAt).toBe(200);
    } finally {
      database.close();
    }
  });

  it("treats every in-flight generation status as running for the projection", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const session = createSession({
        activeBranchId: null,
        createdAt: 100,
        customTitle: false,
        lastActivityAt: 100,
        selectionRevision: 0,
        sessionId: "inflight-session",
        title: "生成中会话",
        updatedAt: 100,
        videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
      });
      const branch = createSubtitleBranch({
        activeSubtitleId: "subtitle-1",
        branchId: "inflight-branch",
        contextRevision: 1,
        createdAt: 100,
        detectedLanguage: null,
        language: "zh-CN",
        lastOpenedAt: 100,
        lastSelectedAt: 100,
        requestedLanguageMode: null,
        sessionId: session.sessionId,
        source: "bilibili",
        title: null,
        updatedAt: 100,
        videoKey: session.videoKey,
      });
      const seed = database.transaction(
        [
          "branchPlacements",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      seed.objectStore("sessions").put(session);
      seed.objectStore("subtitleBranches").put(branch);
      seed.objectStore("branchPlacements").put(
        createBranchPlacement({
          branchId: branch.branchId,
          deletionReason: null,
          location: "workspace",
          order: 1,
          purgeAfter: null,
          retentionStartedAt: null,
          sessionId: session.sessionId,
          trashedAt: null,
          trashOrigin: null,
          trashOriginFolderId: null,
          trashOriginPathSnapshot: null,
        }),
      );
      seed.objectStore("workspaceSessionPlacements").put(
        createWorkspaceSessionPlacement({
          order: 1,
          pinned: false,
          sessionId: session.sessionId,
        }),
      );
      seed.objectStore("generationRuns").put(
        createGenerationRun({
          branchId: branch.branchId,
          browserSessionId: "browser",
          completionSequence: null,
          contextRevision: 1,
          createdAt: 200,
          errorCode: null,
          expectedOwnerRevision: 0,
          kind: "summary",
          partialOutput: "",
          runId: "run-inflight",
          sessionId: session.sessionId,
          status: "requesting",
          stopReason: null,
          subtitleId: "subtitle-1",
          targetId: "summary-inflight",
          taskId: "task-inflight",
          updatedAt: 200,
        }),
      );
      await transactionDone(seed);

      const projection = await new IndexedDbWorkspaceProjectionRepository(
        database,
      ).load();
      expect(projection.workspace.sessions[0]).toMatchObject({
        branches: [{ branchId: "inflight-branch", running: true }],
      });
    } finally {
      database.close();
    }
  });
});
