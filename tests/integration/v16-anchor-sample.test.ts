import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";

import { createSessionWorkspaceCoordinator } from "../../src/application/session-workspace";
import type { WorkspaceState } from "../../src/application/workspace-restoration";
import { createVideoRef } from "../../src/domain";
import { IndexedDbArchiveRepository } from "../../src/infrastructure/indexeddb/archive-repository";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbTrashRepository } from "../../src/infrastructure/indexeddb/trash-repository";
import { IndexedDbWorkspaceRestorationRepository } from "../../src/infrastructure/indexeddb/workspace-restoration-repository";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";

/**
 * v16 验收锚点样例（ticket 08）：
 * https://www.bilibili.com/video/BV1b7411N798/?p=22
 * 第 22P 标题「3.1.3_栈的链式存储实现」；P1 标题「0.0 课程白嫖指南」。
 */
const ANCHOR_BVID = "BV1b7411N798";
const ANCHOR_P22_URL = `https://www.bilibili.com/video/${ANCHOR_BVID}/?p=22`;

function anchorVideo(page: 1 | 22) {
  return createVideoRef({
    aid: 2_803_108_323,
    bvid: ANCHOR_BVID,
    canonicalUrl:
      page === 1
        ? `https://www.bilibili.com/video/${ANCHOR_BVID}`
        : ANCHOR_P22_URL,
    cid: page === 1 ? 304_765_521 : 304_765_522,
    durationSec: 600,
    page,
    title: page === 1 ? "0.0 课程白嫖指南" : "3.1.3_栈的链式存储实现",
  });
}

function uniqueDatabaseName(): string {
  return `muzhi-anchor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

afterEach(async () => {
  globalThis.indexedDB = new IDBFactory();
});

describe("v16 验收锚点样例（BV1b7411N798/?p=22）", () => {
  it("会话模式二绑定分 P 地址时正确绑定第 22P 并更新标题，绑定前不获取任何字幕", async () => {
    const database = await openBilimuzhiDatabase({
      factory: new IDBFactory(),
      name: uniqueDatabaseName(),
    });
    const now = 1_000;
    let sessionCounter = 0;
    let workspaceState: WorkspaceState | null = null;
    const coordinator = createSessionWorkspaceCoordinator({
      archiveRepository: new IndexedDbArchiveRepository(database, {
        now: () => now,
      }),
      gateway: {
        resolve: async (input) => {
          const page =
            input.kind === "identifier" && input.value.includes("p=22")
              ? 22
              : 1;
          return anchorVideo(page);
        },
      },
      repository: new IndexedDbSessionRepository(database, {
        createSessionId: () => `anchor-session-${++sessionCounter}`,
        now: () => now,
      }),
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
        now: () => now,
      }),
    });

    try {
      // 模式二：分 P 地址 → 绑定 P22，标题为第 22P 标题。
      const bound = await coordinator.bind({
        kind: "identifier",
        value: ANCHOR_P22_URL,
      });
      expect(bound.restoredWorkspace).toMatchObject({
        session: { title: "3.1.3_栈的链式存储实现" },
        subtitle: null,
      });
      expect(bound.restoredWorkspace?.session.videoKey).toContain("p:22");
      // 绑定前不获取任何字幕（初始状态与会话新建一致）。
      expect(bound.restoredWorkspace?.subtitle).toBeNull();

      // 裸 BV 无 p → 正确默认 P1（P1 标题），语义不被破坏。
      const bare = await coordinator.bind({
        kind: "identifier",
        value: ANCHOR_BVID,
      });
      expect(bare.restoredWorkspace?.session.title).toBe("0.0 课程白嫖指南");
      expect(bare.restoredWorkspace?.session.videoKey).toContain("p:1");
    } finally {
      database.close();
    }
  });

  it("会话模式一创建未绑定会话后绑定当前页视频，命名序列为「新建会话1」", async () => {
    const database = await openBilimuzhiDatabase({
      factory: new IDBFactory(),
      name: uniqueDatabaseName(),
    });
    const now = 1_000;
    let sessionCounter = 0;
    let workspaceState: WorkspaceState | null = null;
    const coordinator = createSessionWorkspaceCoordinator({
      archiveRepository: new IndexedDbArchiveRepository(database, {
        now: () => now,
      }),
      gateway: {
        resolve: async () => anchorVideo(22),
      },
      repository: new IndexedDbSessionRepository(database, {
        createSessionId: () => `anchor-session-${++sessionCounter}`,
        now: () => now,
      }),
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
        now: () => now,
      }),
    });

    try {
      // 新建会话：未绑定、命名「新建会话1」，不获取任何字幕。
      const created = await coordinator.createSession({
        titleBase: "新建会话",
      });
      expect(created.restoredWorkspace).toMatchObject({
        session: {
          title: "新建会话1",
          videoBound: false,
        },
        subtitle: null,
      });
      const sessionId = created.restoredWorkspace!.session.sessionId;

      // 模式一真实路径：createSession 后 synchronizeCreatedSession 把同一会话
      // 绑定到当前页视频（稳定等待由 settlePageUrl 负责，此处验证绑定后标题更新）。
      const bound = await coordinator.synchronizeCreatedSession({
        pageRevision: 1,
        sessionId,
        video: anchorVideo(22),
      });
      expect(bound.restoredWorkspace?.session.sessionId).toBe(sessionId);
      expect(bound.restoredWorkspace?.session.title).toBe(
        "3.1.3_栈的链式存储实现",
      );
      expect(bound.restoredWorkspace?.session.videoBound).toBe(true);
    } finally {
      database.close();
    }
  });
});
