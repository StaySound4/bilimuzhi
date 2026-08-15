import { afterEach, describe, expect, it, vi } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  createArchiveSessionPlacement,
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoRef,
  createWorkspaceSessionPlacement,
  type VideoKey,
} from "../../src/domain";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";
import {
  openBilimuzhiDatabase,
  ROOT_ARCHIVE_FOLDER_ID,
} from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbWorkspaceRestorationRepository } from "../../src/infrastructure/indexeddb/workspace-restoration-repository";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-startup-router-${crypto.randomUUID()}`;
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

interface SeedContextInput {
  readonly branchId: string;
  readonly createdAt: number;
  readonly lastOpenedAt: number;
  readonly location: "archive" | "trash" | "workspace";
  readonly sessionId: string;
  readonly videoKey: VideoKey;
}

async function seedContext(
  database: IDBDatabase,
  input: SeedContextInput,
): Promise<void> {
  const subtitleId = `subtitle-${input.branchId}`;
  const session = createSession({
    activeBranchId: input.branchId,
    createdAt: input.createdAt,
    customTitle: false,
    lastActivityAt: input.lastOpenedAt,
    selectionRevision: 1,
    sessionId: input.sessionId,
    title: "启动路由",
    updatedAt: input.lastOpenedAt,
    videoKey: input.videoKey,
  });
  const branch = createSubtitleBranch({
    activeSubtitleId: subtitleId,
    branchId: input.branchId,
    contextRevision: 1,
    createdAt: input.createdAt,
    detectedLanguage: null,
    language: "zh-CN",
    lastOpenedAt: input.lastOpenedAt,
    lastSelectedAt: input.lastOpenedAt,
    requestedLanguageMode: null,
    sessionId: input.sessionId,
    source: "bilibili",
    title: null,
    updatedAt: input.lastOpenedAt,
    videoKey: input.videoKey,
  });
  const subtitle = createSubtitleSnapshot({
    branchId: input.branchId,
    contentHash: `sha256:${input.branchId}`,
    createdAt: input.createdAt,
    language: "zh-CN",
    rows: [{ endMs: 1_000, startMs: 0, text: input.branchId }],
    sessionId: input.sessionId,
    source: "bilibili",
    status: "active",
    subtitleId,
    videoKey: input.videoKey,
  });
  const trashed = input.location === "trash";
  const transaction = database.transaction(
    [
      "archiveSessionPlacements",
      "branchPlacements",
      "sessions",
      "subtitleBranches",
      "subtitleSnapshots",
      "workspaceSessionPlacements",
    ],
    "readwrite",
  );
  transaction.objectStore("sessions").put(session);
  transaction.objectStore("subtitleBranches").put(branch);
  transaction.objectStore("subtitleSnapshots").put(subtitle);
  transaction.objectStore("branchPlacements").put(
    createBranchPlacement({
      branchId: input.branchId,
      deletionReason: trashed ? "user-delete" : null,
      location: input.location,
      order: input.createdAt,
      purgeAfter: null,
      retentionStartedAt: trashed ? input.createdAt : null,
      sessionId: input.sessionId,
      trashedAt: trashed ? input.createdAt : null,
      trashOrigin: trashed ? "workspace" : null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
  );
  if (input.location === "workspace") {
    transaction.objectStore("workspaceSessionPlacements").put(
      createWorkspaceSessionPlacement({
        order: input.createdAt,
        pinned: false,
        sessionId: input.sessionId,
      }),
    );
  } else if (input.location === "archive") {
    transaction.objectStore("archiveSessionPlacements").put(
      createArchiveSessionPlacement({
        archivedAt: input.createdAt,
        folderId: ROOT_ARCHIVE_FOLDER_ID,
        order: input.createdAt,
        pinned: false,
        sessionId: input.sessionId,
      }),
    );
  }
  await transactionDone(transaction);
}

async function fixture() {
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: createDatabaseName(),
  });
  const video = createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    cid: 30_000_000_002,
    page: 2,
    title: "启动路由",
  });
  return { database, video };
}

describe("IndexedDbWorkspaceRestorationRepository startup routing", () => {
  it("chooses the workspace context and ignores archive for the same exact VideoKey", async () => {
    const { database, video } = await fixture();
    try {
      await seedContext(database, {
        branchId: "branch-archive",
        createdAt: 1_000,
        lastOpenedAt: 9_000,
        location: "archive",
        sessionId: "session-archive",
        videoKey: video.videoKey,
      });
      await seedContext(database, {
        branchId: "branch-workspace",
        createdAt: 2_000,
        lastOpenedAt: 2_000,
        location: "workspace",
        sessionId: "session-workspace",
        videoKey: video.videoKey,
      });

      const router = new IndexedDbWorkspaceRestorationRepository(database, {
        now: () => 10_000,
      });
      await expect(router.route(video.videoKey)).resolves.toMatchObject({
        branch: { branchId: "branch-workspace" },
        location: "workspace",
        session: { sessionId: "session-workspace" },
      });
      const read = database.transaction("branchPlacements", "readonly");
      await expect(
        requestResult(
          read.objectStore("branchPlacements").get("branch-archive"),
        ),
      ).resolves.toMatchObject({ location: "archive" });
      await transactionDone(read);
    } finally {
      database.close();
    }
  });

  it("returns null for archive/trash-only matches without opening a write transaction", async () => {
    const { database, video } = await fixture();
    try {
      await seedContext(database, {
        branchId: "branch-archive",
        createdAt: 1_000,
        lastOpenedAt: 1_000,
        location: "archive",
        sessionId: "session-archive",
        videoKey: video.videoKey,
      });
      await seedContext(database, {
        branchId: "branch-trash",
        createdAt: 2_000,
        lastOpenedAt: 2_000,
        location: "trash",
        sessionId: "session-trash",
        videoKey: video.videoKey,
      });
      const router = new IndexedDbWorkspaceRestorationRepository(database, {
        now: () => 5_000,
      });
      const transaction = vi.spyOn(database, "transaction");
      await expect(router.route(video.videoKey)).resolves.toBeNull();
      expect(
        transaction.mock.calls.every(([, mode]) => mode === "readonly"),
      ).toBe(true);
    } finally {
      database.close();
    }
  });

  it("chooses a workspace context before a newer trash context", async () => {
    const { database, video } = await fixture();
    try {
      await seedContext(database, {
        branchId: "branch-workspace",
        createdAt: 1_000,
        lastOpenedAt: 1_000,
        location: "workspace",
        sessionId: "session-workspace",
        videoKey: video.videoKey,
      });
      await seedContext(database, {
        branchId: "branch-trash",
        createdAt: 9_000,
        lastOpenedAt: 9_000,
        location: "trash",
        sessionId: "session-trash",
        videoKey: video.videoKey,
      });
      const router = new IndexedDbWorkspaceRestorationRepository(database, {
        now: () => 10_000,
      });
      await expect(router.route(video.videoKey)).resolves.toMatchObject({
        branch: { branchId: "branch-workspace" },
        location: "workspace",
      });
    } finally {
      database.close();
    }
  });

  it("deterministically chooses the most recently opened workspace context if legacy data contains duplicates", async () => {
    const { database, video } = await fixture();
    try {
      await seedContext(database, {
        branchId: "branch-older",
        createdAt: 1_000,
        lastOpenedAt: 7_000,
        location: "workspace",
        sessionId: "session-older",
        videoKey: video.videoKey,
      });
      await seedContext(database, {
        branchId: "branch-newer",
        createdAt: 2_000,
        lastOpenedAt: 8_000,
        location: "workspace",
        sessionId: "session-newer",
        videoKey: video.videoKey,
      });
      const router = new IndexedDbWorkspaceRestorationRepository(database, {
        now: () => 9_000,
      });
      await expect(router.route(video.videoKey)).resolves.toMatchObject({
        branch: { branchId: "branch-newer" },
        session: { sessionId: "session-newer" },
      });
    } finally {
      database.close();
    }
  });
});
