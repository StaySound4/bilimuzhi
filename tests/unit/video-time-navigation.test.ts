import { describe, expect, it, vi } from "vitest";

import {
  createVideoTimeNavigator,
  type VideoTimeNavigationOwner,
} from "../../src/application/video-time-navigation";
import type { VideoKey } from "../../src/domain";

const videoKey =
  "bvid:BV1Q541167Qg:cid:30000000007:p:7" as const satisfies VideoKey;
const owner = Object.freeze({
  revision: 4,
  sessionId: "session-a",
  subtitleId: "subtitle-a",
  videoKey,
}) satisfies VideoTimeNavigationOwner;

describe("统一视频时间导航入口", () => {
  it("按目标 VideoKey 导航，不读取当前活动页面身份覆盖目标", async () => {
    const navigate = vi.fn(async () => "seeked" as const);
    const navigator = createVideoTimeNavigator({
      player: { navigate, readTime: vi.fn() },
      readCurrentOwner: () => owner,
    });

    await expect(navigator.navigate({ owner, seconds: 42.5 })).resolves.toEqual(
      { kind: "seeked", seconds: 42.5, videoKey },
    );
    expect(navigate).toHaveBeenCalledExactlyOnceWith(
      videoKey,
      42.5,
      expect.any(Function),
    );
  });

  it("取消时返回零成功副作用的稳定结果", async () => {
    const navigator = createVideoTimeNavigator({
      player: {
        navigate: vi.fn(async () => "cancelled" as const),
        readTime: vi.fn(),
      },
      readCurrentOwner: () => owner,
    });

    await expect(navigator.navigate({ owner, seconds: 9 })).resolves.toEqual({
      kind: "cancelled",
    });
  });

  it("丢弃旧 revision、旧 owner 和被后续导航取代的迟到成功", async () => {
    let release: (() => void) | undefined;
    const navigate = vi.fn(
      () =>
        new Promise<"seeked">((resolve) => {
          release = () => resolve("seeked");
        }),
    );
    let currentOwner: VideoTimeNavigationOwner | null = owner;
    const navigator = createVideoTimeNavigator({
      player: { navigate, readTime: vi.fn() },
      readCurrentOwner: () => currentOwner,
    });
    const pending = navigator.navigate({ owner, seconds: 15 });
    currentOwner = { ...owner, revision: 5 };
    release?.();

    await expect(pending).resolves.toEqual({ kind: "stale" });
  });

  it("后续导航会使先发请求的迟到成功失效", async () => {
    const releases: Array<() => void> = [];
    const navigate = vi.fn(
      () =>
        new Promise<"seeked">((resolve) => {
          releases.push(() => resolve("seeked"));
        }),
    );
    const navigator = createVideoTimeNavigator({
      player: { navigate, readTime: vi.fn() },
      readCurrentOwner: () => owner,
    });
    const first = navigator.navigate({ owner, seconds: 10 });
    const second = navigator.navigate({ owner, seconds: 20 });
    releases[0]?.();
    releases[1]?.();

    await expect(first).resolves.toEqual({ kind: "stale" });
    await expect(second).resolves.toEqual({
      kind: "seeked",
      seconds: 20,
      videoKey,
    });
  });

  it("定位读取也拒绝旧 owner 的迟到结果", async () => {
    let release: ((value: number) => void) | undefined;
    let currentOwner: VideoTimeNavigationOwner | null = owner;
    const navigator = createVideoTimeNavigator({
      player: {
        navigate: vi.fn(),
        readTime: vi.fn(
          () =>
            new Promise<number>((resolve) => {
              release = resolve;
            }),
        ),
      },
      readCurrentOwner: () => currentOwner,
    });
    const pending = navigator.readCurrentTime(owner);
    currentOwner = { ...owner, revision: 5 };
    release?.(12_000);

    await expect(pending).resolves.toBeNull();
  });

  it("确认等待期间 owner 失效时不允许播放器继续创建标签页或 seek", async () => {
    let currentOwner: VideoTimeNavigationOwner | null = owner;
    const navigate = vi.fn(
      async (
        _videoKey: VideoKey,
        _seconds: number,
        canContinue?: () => boolean,
      ) => {
        currentOwner = { ...owner, revision: 5 };
        return canContinue?.() === false ? "cancelled" : "seeked";
      },
    );
    const navigator = createVideoTimeNavigator({
      player: { navigate, readTime: vi.fn() },
      readCurrentOwner: () => currentOwner,
    });

    await expect(navigator.navigate({ owner, seconds: 15 })).resolves.toEqual({
      kind: "stale",
    });
    expect(navigate.mock.calls[0]?.[2]?.()).toBe(false);
  });

  it("只暴露安全稳定的错误，不透传底层 transport、页面对象或 URL", async () => {
    const navigator = createVideoTimeNavigator({
      player: {
        navigate: vi.fn(async () => {
          throw new Error(
            "tabs.sendMessage failed at https://signed.example/video?token=secret",
          );
        }),
        readTime: vi.fn(),
      },
      readCurrentOwner: () => owner,
    });

    await expect(navigator.navigate({ owner, seconds: 15 })).resolves.toEqual({
      kind: "failed",
      message: "无法完成视频跳转，请重试。",
      retryable: true,
    });
  });
});
