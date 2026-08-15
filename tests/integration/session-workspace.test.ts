import { afterEach, describe, expect, it } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import { createSessionWorkspaceCoordinator } from "../../src/application/session-workspace";
import type { WorkspaceState } from "../../src/application/workspace-restoration";
import { createSubtitleSnapshot, createVideoRef } from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbArchiveRepository } from "../../src/infrastructure/indexeddb/archive-repository";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";
import { IndexedDbTrashRepository } from "../../src/infrastructure/indexeddb/trash-repository";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";
import { IndexedDbWorkspaceRestorationRepository } from "../../src/infrastructure/indexeddb/workspace-restoration-repository";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-workspace-${crypto.randomUUID()}`;
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

describe("SessionWorkspaceCoordinator", () => {
  it("moves a workspace session without subtitles to trash instead of hard deleting it", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    let workspaceState: WorkspaceState | null = null;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "empty-session",
      now: () => 1_000,
    });
    const coordinator = createSessionWorkspaceCoordinator({
      gateway: {
        resolve: async () =>
          createVideoRef({
            bvid: "BV1Q541167Qg",
            canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
            cid: 30_000_000_001,
            page: 1,
            title: "尚未获取字幕",
          }),
      },
      repository,
      restorationRepository: new IndexedDbWorkspaceRestorationRepository(
        database,
      ),
      stateStore: {
        load: async () => workspaceState,
        save: async (state) => {
          workspaceState = state;
        },
      },
      trashRepository: new IndexedDbTrashRepository(database, {
        now: () => 2_000,
      }),
    });

    try {
      await coordinator.bind({ kind: "identifier", value: "BV1Q541167Qg" });
      await expect(coordinator.delete("empty-session")).resolves.toEqual({
        restoredWorkspace: null,
        sessions: [],
      });
      const verify = database.transaction(
        ["sessions", "trashSessionPlacements", "workspaceSessionPlacements"],
        "readonly",
      );
      await expect(
        requestResult(verify.objectStore("sessions").get("empty-session")),
      ).resolves.toBeDefined();
      await expect(
        requestResult(
          verify.objectStore("trashSessionPlacements").get("empty-session"),
        ),
      ).resolves.toMatchObject({
        deletionReason: "workspace-session",
        trashedAt: 2_000,
      });
      await expect(
        requestResult(
          verify.objectStore("workspaceSessionPlacements").get("empty-session"),
        ),
      ).resolves.toBeUndefined();
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("archives a populated workspace session without deleting its content", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    let workspaceState: WorkspaceState | null = null;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "archive-session",
      now: () => 1_000,
    });
    const archiveRepository = new IndexedDbArchiveRepository(database, {
      now: () => 2_000,
    });
    const coordinator = createSessionWorkspaceCoordinator({
      archiveRepository,
      gateway: {
        resolve: async () =>
          createVideoRef({
            bvid: "BV1Q541167Qg",
            canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
            cid: 30_000_000_001,
            page: 1,
            title: "待归档会话",
          }),
      },
      repository,
      restorationRepository: new IndexedDbWorkspaceRestorationRepository(
        database,
      ),
      stateStore: {
        load: async () => workspaceState,
        save: async (state) => {
          workspaceState = state;
        },
      },
    });

    try {
      const bound = await coordinator.bind({
        kind: "identifier",
        value: "BV1Q541167Qg",
      });
      const owner = {
        acquisitionId: "archive-acquisition",
        draftBranchId: "archive-branch",
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: "archive-session",
        taskId: "archive-task",
        videoKey: bound.restoredWorkspace!.session.videoKey,
      };
      const subtitles = new IndexedDbSubtitleRepository(database, {
        now: () => 1_500,
      });
      await subtitles.beginAcquisition(owner, {
        method: "direct",
        trackId: "official:zh-CN",
      });
      await subtitles.commitAcquisition(
        owner,
        createSubtitleSnapshot({
          branchId: owner.draftBranchId,
          contentHash: "sha256:archive",
          createdAt: 1_500,
          language: "zh-CN",
          rows: [{ endMs: 1_000, startMs: 0, text: "归档内容" }],
          sessionId: owner.sessionId,
          source: "bilibili",
          status: "staged",
          subtitleId: "archive-subtitle",
          videoKey: owner.videoKey,
        }),
      );

      const archived = await coordinator.archive(
        "archive-session",
        ["archive-branch"],
        "archive-root",
      );
      expect(archived).toEqual({ restoredWorkspace: null, sessions: [] });
      expect(workspaceState).toEqual({
        activeSessionId: null,
        sessions: [],
        version: 1,
      });

      const verify = database.transaction(
        [
          "archiveSessionPlacements",
          "branchPlacements",
          "sessions",
          "subtitleSnapshots",
        ],
        "readonly",
      );
      await expect(
        requestResult(
          verify.objectStore("branchPlacements").get("archive-branch"),
        ),
      ).resolves.toMatchObject({ location: "archive" });
      await expect(
        requestResult(
          verify.objectStore("archiveSessionPlacements").get("archive-session"),
        ),
      ).resolves.toMatchObject({ folderId: "archive-root" });
      await expect(
        requestResult(verify.objectStore("sessions").get("archive-session")),
      ).resolves.toBeDefined();
      await expect(
        requestResult(
          verify.objectStore("subtitleSnapshots").get("archive-subtitle"),
        ),
      ).resolves.toBeDefined();
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("batch deletes workspace sessions and immediately selects the remaining session", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["batch-first", "batch-second", "batch-third"];
    let workspaceState: WorkspaceState | null = null;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => 1_000,
    });
    const coordinator = createSessionWorkspaceCoordinator({
      gateway: {
        resolve: async (input) => {
          const value = input.kind === "identifier" ? input.value : "p=1";
          const page = Number(value.match(/p=(\d+)/)?.[1] ?? "1");
          return createVideoRef({
            bvid: "BV1Q541167Qg",
            canonicalUrl: `https://www.bilibili.com/video/BV1Q541167Qg?p=${page}`,
            cid: 30_000_000_000 + page,
            page,
            title: `批量会话 ${page}`,
          });
        },
      },
      repository,
      restorationRepository: new IndexedDbWorkspaceRestorationRepository(
        database,
      ),
      stateStore: {
        load: async () => workspaceState,
        save: async (state) => {
          workspaceState = state;
        },
      },
      trashRepository: new IndexedDbTrashRepository(database, {
        now: () => 2_000,
      }),
    });

    try {
      await coordinator.bind({ kind: "identifier", value: "p=1" });
      await coordinator.bind({ kind: "identifier", value: "p=2" });
      await coordinator.bind({ kind: "identifier", value: "p=3" });
      await coordinator.select("batch-second");

      const result = await coordinator.deleteMany([
        "batch-first",
        "batch-second",
      ]);
      expect(result.sessions.map((session) => session.sessionId)).toEqual([
        "batch-third",
      ]);
      expect(result.restoredWorkspace?.session.sessionId).toBe("batch-third");
      expect(workspaceState).toMatchObject({
        activeSessionId: "batch-third",
        sessions: [{ sessionId: "batch-third" }],
      });
      const projection = database.transaction(
        ["trashSessionPlacements", "workspaceSessionPlacements"],
        "readonly",
      );
      await expect(
        requestResult(
          projection.objectStore("trashSessionPlacements").getAll(),
        ),
      ).resolves.toHaveLength(2);
      await expect(
        requestResult(
          projection.objectStore("workspaceSessionPlacements").getAll(),
        ),
      ).resolves.toHaveLength(1);
      await transactionDone(projection);
    } finally {
      database.close();
    }
  });

  it("batch archives populated sessions in one projection refresh", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["archive-first", "archive-second"];
    let workspaceState: WorkspaceState | null = null;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => 1_000,
    });
    const coordinator = createSessionWorkspaceCoordinator({
      archiveRepository: new IndexedDbArchiveRepository(database, {
        now: () => 2_000,
      }),
      gateway: {
        resolve: async (input) => {
          const value = input.kind === "identifier" ? input.value : "p=1";
          const page = Number(value.match(/p=(\d+)/)?.[1] ?? "1");
          return createVideoRef({
            bvid: "BV1Q541167Qg",
            canonicalUrl: `https://www.bilibili.com/video/BV1Q541167Qg?p=${page}`,
            cid: 30_000_000_000 + page,
            page,
            title: `归档会话 ${page}`,
          });
        },
      },
      repository,
      restorationRepository: new IndexedDbWorkspaceRestorationRepository(
        database,
      ),
      stateStore: {
        load: async () => workspaceState,
        save: async (state) => {
          workspaceState = state;
        },
      },
    });
    const subtitles = new IndexedDbSubtitleRepository(database, {
      now: () => 1_500,
    });

    try {
      for (const page of [1, 2]) {
        const bound = await coordinator.bind({
          kind: "identifier",
          value: `p=${page}`,
        });
        const sessionId = `archive-${page === 1 ? "first" : "second"}`;
        const branchId = `archive-batch-branch-${page}`;
        const owner = {
          acquisitionId: `archive-batch-acquisition-${page}`,
          draftBranchId: branchId,
          expectedContextRevision: 1,
          expectedSelectionRevision: 0,
          sessionId,
          taskId: `archive-batch-task-${page}`,
          videoKey: bound.restoredWorkspace!.session.videoKey,
        };
        await subtitles.beginAcquisition(owner, {
          method: "direct",
          trackId: `official:${page}`,
        });
        await subtitles.commitAcquisition(
          owner,
          createSubtitleSnapshot({
            branchId,
            contentHash: `sha256:archive-batch-${page}`,
            createdAt: 1_500,
            language: "zh-CN",
            rows: [{ endMs: 1_000, startMs: 0, text: `归档 ${page}` }],
            sessionId,
            source: "bilibili",
            status: "staged",
            subtitleId: `archive-batch-subtitle-${page}`,
            videoKey: owner.videoKey,
          }),
        );
      }

      const result = await coordinator.archiveMany(
        [
          { branchIds: ["archive-batch-branch-1"], sessionId: "archive-first" },
          {
            branchIds: ["archive-batch-branch-2"],
            sessionId: "archive-second",
          },
        ],
        "archive-root",
      );
      expect(result).toEqual({ restoredWorkspace: null, sessions: [] });
      expect(workspaceState).toEqual({
        activeSessionId: null,
        sessions: [],
        version: 1,
      });
      const verify = database.transaction(
        ["archiveSessionPlacements", "branchPlacements"],
        "readonly",
      );
      await expect(
        requestResult(verify.objectStore("archiveSessionPlacements").getAll()),
      ).resolves.toHaveLength(2);
      await expect(
        requestResult(verify.objectStore("branchPlacements").getAll()),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ location: "archive" }),
          expect.objectContaining({ location: "archive" }),
        ]),
      );
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("archives an empty session together with branched sessions", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["archive-empty-first", "archive-empty-second"];
    let workspaceState: WorkspaceState | null = null;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => 1_000,
    });
    const coordinator = createSessionWorkspaceCoordinator({
      archiveRepository: new IndexedDbArchiveRepository(database, {
        now: () => 1_500,
      }),
      gateway: {
        resolve: async (input) => {
          const page =
            input.kind === "identifier" && input.value.includes("p=2") ? 2 : 1;
          return createVideoRef({
            bvid: "BV1Q541167Qg",
            canonicalUrl: `https://www.bilibili.com/video/BV1Q541167Qg${
              page === 1 ? "" : "?p=2"
            }`,
            cid: 30_000_000_000 + page,
            page,
            title: page === 1 ? "有字幕会话" : "空会话",
          });
        },
      },
      repository,
      restorationRepository: new IndexedDbWorkspaceRestorationRepository(
        database,
      ),
      stateStore: {
        load: async () => workspaceState,
        save: async (state) => {
          workspaceState = state;
        },
      },
      trashRepository: new IndexedDbTrashRepository(database, {
        now: () => 2_000,
      }),
    });
    const subtitles = new IndexedDbSubtitleRepository(database, {
      now: () => 1_500,
    });

    try {
      const first = await coordinator.bind({
        kind: "identifier",
        value: "BV1Q541167Qg",
      });
      const firstVideo = first.restoredWorkspace!.session.videoKey;
      const firstOwner = {
        acquisitionId: "archive-empty-acquisition-1",
        draftBranchId: "archive-empty-branch-1",
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: "archive-empty-first",
        taskId: "archive-empty-task-1",
        videoKey: firstVideo,
      };
      await subtitles.beginAcquisition(firstOwner, {
        method: "direct",
        trackId: "official:1",
      });
      await subtitles.commitAcquisition(
        firstOwner,
        createSubtitleSnapshot({
          branchId: "archive-empty-branch-1",
          contentHash: "sha256:archive-empty-1",
          createdAt: 1_500,
          language: "zh-CN",
          rows: [{ endMs: 1_000, startMs: 0, text: "归档内容" }],
          sessionId: "archive-empty-first",
          source: "bilibili",
          status: "staged",
          subtitleId: "archive-empty-subtitle-1",
          videoKey: firstVideo,
        }),
      );
      await coordinator.bind({
        kind: "identifier",
        value: "BV1Q541167Qg?p=2",
      });

      const result = await coordinator.archiveMany(
        [
          {
            branchIds: ["archive-empty-branch-1"],
            sessionId: "archive-empty-first",
          },
          {
            branchIds: [],
            sessionId: "archive-empty-second",
          },
        ],
        "archive-root",
      );
      expect(result).toEqual({ restoredWorkspace: null, sessions: [] });
      expect(workspaceState).toEqual({
        activeSessionId: null,
        sessions: [],
        version: 1,
      });
      const verify = database.transaction(
        ["archiveSessionPlacements", "workspaceSessionPlacements"],
        "readonly",
      );
      await expect(
        requestResult(verify.objectStore("archiveSessionPlacements").getAll()),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: "archive-empty-first",
          }),
          expect.objectContaining({
            sessionId: "archive-empty-second",
          }),
        ]),
      );
      await expect(
        requestResult(
          verify.objectStore("workspaceSessionPlacements").getAll(),
        ),
      ).resolves.toEqual([]);
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("binds, restores, renames, and deletes sessions while preserving view state", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const sessionIds = ["session-first", "session-second"];
    let now = 1_000;
    let workspaceState: WorkspaceState | null = null;
    const repository = new IndexedDbSessionRepository(database, {
      createSessionId: () => sessionIds.shift() ?? "unexpected-session",
      now: () => now,
    });
    const trashRepository = new IndexedDbTrashRepository(database, {
      now: () => now,
    });
    const coordinator = createSessionWorkspaceCoordinator({
      archiveRepository: new IndexedDbArchiveRepository(database, {
        now: () => now,
      }),
      gateway: {
        resolve: async (input) => {
          const page =
            input.kind === "identifier" && input.value.endsWith("?p=2") ? 2 : 1;
          return createVideoRef({
            bvid: "BV1Q541167Qg",
            canonicalUrl: `https://www.bilibili.com/video/BV1Q541167Qg${
              page === 1 ? "" : "?p=2"
            }`,
            cid: 30_000_000_000 + page,
            page,
            title: "同名视频",
          });
        },
      },
      repository,
      restorationRepository: new IndexedDbWorkspaceRestorationRepository(
        database,
      ),
      stateStore: {
        load: async () => workspaceState,
        save: async (state) => {
          workspaceState = state;
        },
      },
      trashRepository,
    });

    try {
      await expect(coordinator.initialize()).resolves.toEqual({
        restoredWorkspace: null,
        sessions: [],
      });

      const first = await coordinator.bind({
        kind: "identifier",
        value: "BV1Q541167Qg",
      });
      expect(first).toMatchObject({
        restoredWorkspace: {
          activeMode: "timeline",
          session: { sessionId: "session-first", title: "同名视频" },
          subtitle: null,
        },
        sessions: [{ sessionId: "session-first", title: "同名视频" }],
      });
      await coordinator.saveView({
        activeMode: "chat",
        scrollTopByMode: {
          chat: 90,
          segments: 0,
          summary: 0,
          timeline: 20,
        },
        sessionId: "session-first",
      });

      now = 2_000;
      const second = await coordinator.bind({
        kind: "identifier",
        value: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      });
      expect(second.sessions.map((session) => session.title)).toEqual([
        "同名视频",
        "同名视频",
      ]);
      expect(second.restoredWorkspace?.session.sessionId).toBe(
        "session-second",
      );

      const reordered = await coordinator.reorder(
        "session-second",
        "session-first",
      );
      expect(reordered.sessions.map((session) => session.sessionId)).toEqual([
        "session-second",
        "session-first",
      ]);

      now = 3_000;
      const selected = await coordinator.select("session-first");
      expect(selected.restoredWorkspace).toMatchObject({
        activeMode: "chat",
        scrollTopByMode: { chat: 90, timeline: 20 },
        session: { sessionId: "session-first" },
      });
      expect(selected.sessions[0]?.sessionId).toBe("session-second");

      const pinned = await coordinator.setPinned("session-first", true);
      expect(pinned.sessions.map((session) => session.sessionId)).toEqual([
        "session-first",
        "session-second",
      ]);

      const renamed = await coordinator.rename("session-first", "自定义标题");
      expect(renamed.restoredWorkspace?.session.title).toBe("自定义标题");
      expect(renamed.sessions[0]?.title).toBe("自定义标题");

      const videoKey = renamed.restoredWorkspace!.session.videoKey;
      const subtitleRepository = new IndexedDbSubtitleRepository(database, {
        now: () => now,
      });
      const owner = {
        acquisitionId: "workspace-delete-acquisition",
        draftBranchId: "workspace-delete-branch",
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: "session-first",
        taskId: "workspace-delete-task",
        videoKey,
      };
      await subtitleRepository.beginAcquisition(owner, {
        method: "direct",
        trackId: "official:zh-CN",
      });
      await subtitleRepository.commitAcquisition(
        owner,
        createSubtitleSnapshot({
          branchId: owner.draftBranchId,
          contentHash: "sha256:workspace-delete",
          createdAt: now,
          language: "zh-CN",
          rows: [{ endMs: 1_000, startMs: 0, text: "保留到回收站" }],
          sessionId: owner.sessionId,
          source: "bilibili",
          status: "staged",
          subtitleId: "workspace-delete-subtitle",
          videoKey,
        }),
      );

      now = 4_000;
      const deleted = await coordinator.delete("session-first");
      expect(deleted.sessions).toHaveLength(1);
      expect(deleted.restoredWorkspace?.session.sessionId).toBe(
        "session-second",
      );
      expect(workspaceState).toMatchObject({
        activeSessionId: "session-second",
        sessions: [{ sessionId: "session-second" }],
      });
      const verification = database.transaction(
        ["branchPlacements", "sessions", "subtitleSnapshots"],
        "readonly",
      );
      await expect(
        requestResult(
          verification
            .objectStore("branchPlacements")
            .get("workspace-delete-branch"),
        ),
      ).resolves.toMatchObject({
        location: "trash",
        trashedAt: 4_000,
        trashOrigin: "workspace",
      });
      await expect(
        requestResult(
          verification.objectStore("sessions").get("session-first"),
        ),
      ).resolves.toBeDefined();
      await expect(
        requestResult(
          verification
            .objectStore("subtitleSnapshots")
            .get("workspace-delete-subtitle"),
        ),
      ).resolves.toBeDefined();
      await transactionDone(verification);
      expect(Object.isFrozen(deleted)).toBe(true);
    } finally {
      database.close();
    }
  });
});
