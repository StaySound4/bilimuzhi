import { afterEach, describe, expect, it, vi } from "vitest";

import type { CurrentPageSyncBridge } from "../../src/infrastructure/current-page-sync";
import { syncStableCurrentPage } from "../../src/infrastructure/current-page-sync";
import { settlePageUrl } from "../../src/infrastructure/page-url-settle";
import { createVideoRef } from "../../src/domain";

afterEach(() => {
  vi.useRealTimers();
});

describe("settlePageUrl", () => {
  it("returns the settled URL after two consecutive identical reads", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const urls = [
      "https://www.bilibili.com/video/BV1b7411N798?p=22&spm_id_from=333.1007",
      "https://www.bilibili.com/video/BV1b7411N798",
      "https://www.bilibili.com/video/BV1b7411N798/?p=22",
    ];
    const getUrl = async (): Promise<string> => {
      const value = urls[Math.min(calls, urls.length - 1)]!;
      calls += 1;
      return value;
    };
    const promise = settlePageUrl(getUrl, {
      intervalMs: 300,
      maxWaitMs: 3_000,
    });

    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toBe(
      "https://www.bilibili.com/video/BV1b7411N798/?p=22",
    );
    expect(calls).toBe(4);
  });

  it("returns the latest read when the URL never settles before the deadline", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const getUrl = async (): Promise<string> =>
      `https://www.bilibili.com/video/BV1b7411N798?x=${calls++}`;
    const promise = settlePageUrl(getUrl, { intervalMs: 300, maxWaitMs: 900 });

    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    await expect(promise).resolves.toMatch(/x=3/);
  });

  it("propagates a failing URL read immediately", async () => {
    vi.useFakeTimers();
    const getUrl = async (): Promise<string> => {
      throw new Error("unbound current page");
    };
    await expect(settlePageUrl(getUrl)).rejects.toThrow("unbound current page");
  });
});

describe("syncStableCurrentPage", () => {
  it("consumes only the settled third-state URL of a video page", async () => {
    vi.useFakeTimers();
    const longUrl =
      "https://www.bilibili.com/video/BV1b7411N798?p=22&spm_id_from=333.1007.top_bar_bar_more";
    const bareUrl = "https://www.bilibili.com/video/BV1b7411N798";
    const settledUrl = "https://www.bilibili.com/video/BV1b7411N798/?p=22";
    const videos = [
      createVideoRef({
        bvid: "BV1b7411N798",
        canonicalUrl: longUrl,
        cid: 30_000_000_001,
        page: 22,
        title: "3.1.3_栈的链式存储实现",
      }),
      createVideoRef({
        bvid: "BV1b7411N798",
        canonicalUrl: bareUrl,
        cid: 30_000_000_001,
        page: 1,
        title: "0.0 课程白嫖指南",
      }),
      createVideoRef({
        bvid: "BV1b7411N798",
        canonicalUrl: settledUrl,
        cid: 30_000_000_022,
        page: 22,
        title: "3.1.3_栈的链式存储实现",
      }),
    ];
    let calls = 0;
    const bridge: CurrentPageSyncBridge = {
      sync: vi.fn(async () => ({
        tabId: 7,
        video: videos[Math.min(calls++, videos.length - 1)]!,
      })),
    };
    const promise = syncStableCurrentPage(bridge);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result.video.page).toBe(22);
    expect(result.video.canonicalUrl).toBe(settledUrl);
    expect(bridge.sync).toHaveBeenCalledTimes(4);
  });

  it("propagates the unbound-page error so the caller can show the page error", async () => {
    vi.useFakeTimers();
    const bridge: CurrentPageSyncBridge = {
      sync: vi.fn(async () => {
        throw new Error("unbound current page");
      }),
    };
    await expect(syncStableCurrentPage(bridge)).rejects.toThrow(
      "unbound current page",
    );
  });
});
