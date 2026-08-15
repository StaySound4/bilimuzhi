import { describe, expect, it, vi } from "vitest";

import { bindVideoSession } from "../../src/application/session-management";
import type { SessionRepository } from "../../src/application/session-repository";
import type { VideoResolveInput } from "../../src/application/video-gateway";
import { createSession, createVideoRef } from "../../src/domain";
import { createCurrentPageSyncBridge } from "../../src/infrastructure/current-page-sync";

describe("current-page sync bridge", () => {
  it("resolves the active tab exactly only after an explicit sync request", async () => {
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      cid: 30_000_000_002,
      page: 2,
      title: "当前第二分 P",
    });
    const resolve = vi.fn(async () => video);
    const bridge = createCurrentPageSyncBridge(
      {
        get: async () => ({}),
        getActiveTabId: async () => 17,
        onActivated: () => () => undefined,
        onUrlChanged: () => () => undefined,
      },
      { resolve },
    );

    expect(resolve).not.toHaveBeenCalled();
    await expect(bridge.sync()).resolves.toEqual({ tabId: 17, video });
    expect(resolve).toHaveBeenCalledExactlyOnceWith({
      kind: "current-tab",
      tabId: 17,
    });
  });

  it("leaves caller-owned workspace state untouched when exact resolution fails", async () => {
    const workspace = { activeSessionId: "session-old" };
    const bridge = createCurrentPageSyncBridge(
      {
        get: async () => ({}),
        getActiveTabId: async () => 17,
        onActivated: () => () => undefined,
        onUrlChanged: () => () => undefined,
      },
      {
        resolve: async () => {
          throw new Error("unbound current page");
        },
      },
    );

    await expect(bridge.sync()).rejects.toThrow("unbound current page");
    expect(workspace).toEqual({ activeSessionId: "session-old" });
  });

  it("binds the session from the exact sync result without resolving the active tab a second time", async () => {
    const pageTwo = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      cid: 30_000_000_002,
      page: 2,
      title: "当前第二分 P",
    });
    const barePageOne = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "错误的第一分 P",
    });
    const resolve = vi
      .fn()
      .mockResolvedValueOnce(pageTwo)
      .mockResolvedValue(barePageOne);
    const bridge = createCurrentPageSyncBridge(
      {
        get: async () => ({}),
        getActiveTabId: async () => 17,
        onActivated: () => () => undefined,
        onUrlChanged: () => () => undefined,
      },
      { resolve },
    );
    const synced = await bridge.sync();
    const session = createSession({
      activeBranchId: null,
      createdAt: 1_000,
      customTitle: false,
      lastActivityAt: 1_000,
      selectionRevision: 0,
      sessionId: "session-current-page-two",
      title: synced.video.title,
      updatedAt: 1_000,
      videoKey: synced.video.videoKey,
    });
    const create = vi.fn(async () => session);

    const bound = await bindVideoSession(
      {
        gateway: { resolve },
        repository: { create } as unknown as SessionRepository,
      },
      {
        kind: "resolved-video",
        video: synced.video,
      } as unknown as VideoResolveInput,
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledExactlyOnceWith(synced.video);
    expect(bound.videoKey).toBe(synced.video.videoKey);
    expect(synced.video).toBe(pageTwo);
  });
});
