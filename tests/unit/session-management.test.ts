import { describe, expect, it, vi } from "vitest";

import { bindVideoSession } from "../../src/application/session-management";
import { VideoGatewayError } from "../../src/application/video-gateway";
import { createSession, createVideoRef } from "../../src/domain";

describe("bindVideoSession", () => {
  it("resolves a video identifier before creating or restoring its session", async () => {
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      cid: 30_000_000_002,
      page: 2,
      title: "待绑定视频",
    });
    const session = createSession({
      activeBranchId: null,
      createdAt: 1_000,
      customTitle: false,
      lastActivityAt: 1_000,
      selectionRevision: 0,
      sessionId: "session-bound",
      title: video.title,
      updatedAt: 1_000,
      videoKey: video.videoKey,
    });
    const resolve = vi.fn(async () => video);
    const create = vi.fn(async () => session);

    await expect(
      bindVideoSession(
        {
          gateway: { resolve },
          repository: {
            create,
            deleteCascade: async () => undefined,
            getByVideoKey: async () => null,
            list: async () => [],
            rename: async () => session,
            reorder: async () => [],
            setPinned: async () => ({
              order: 0,
              pinned: false,
              sessionId: session.sessionId,
            }),
            touch: async () => session,
          },
        },
        {
          kind: "identifier",
          value: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
        },
      ),
    ).resolves.toBe(session);
    expect(resolve).toHaveBeenCalledWith({
      kind: "identifier",
      value: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    });
    expect(create).toHaveBeenCalledWith(video);
  });

  it("does not write a session when video resolution fails", async () => {
    const create = vi.fn();
    const failure = new VideoGatewayError(
      "VALIDATION_FAILED",
      "The video identifier is invalid",
    );

    await expect(
      bindVideoSession(
        {
          gateway: {
            resolve: async () => {
              throw failure;
            },
          },
          repository: {
            create,
            deleteCascade: async () => undefined,
            getByVideoKey: async () => null,
            list: async () => [],
            rename: async () => {
              throw new Error("not called");
            },
            reorder: async () => [],
            setPinned: async () => {
              throw new Error("not called");
            },
            touch: async () => {
              throw new Error("not called");
            },
          },
        },
        { kind: "identifier", value: "invalid" },
      ),
    ).rejects.toBe(failure);
    expect(create).not.toHaveBeenCalled();
  });
});
