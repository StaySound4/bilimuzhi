import { describe, expect, it, vi } from "vitest";
import { createVideoRef } from "../../src/domain";
import { createChromePageMediaDownloader } from "../../src/infrastructure/chrome-page-media-downloader";

function video(page = 7) {
  return createVideoRef({
    aid: 100,
    bvid: "BV1zt4y1z72D",
    canonicalUrl: `https://www.bilibili.com/video/BV1zt4y1z72D?p=${page}`,
    cid: 30_000_000_000 + page,
    durationSec: 268,
    page,
    title: `P${page}`,
  });
}

describe("Chrome page media downloader", () => {
  it("downloads from the exact long-form Bilibili page in MAIN world and validates ordered chunks", async () => {
    let listener: ((message: unknown, sender: unknown) => void) | null = null;
    const removeListener = vi.fn();
    const executeScript = vi.fn(async () => {
      listener?.(
        {
          byteLength: 4,
          mimeType: "audio/mp4",
          requestId: "media-request-1",
          type: "muzhi.media.started",
        },
        { tab: { id: 41 } },
      );
      listener?.(
        {
          data: "AQI=",
          index: 0,
          requestId: "media-request-1",
          type: "muzhi.media.chunk",
        },
        { tab: { id: 41 } },
      );
      listener?.(
        {
          data: "AwQ=",
          index: 1,
          requestId: "media-request-1",
          type: "muzhi.media.chunk",
        },
        { tab: { id: 41 } },
      );
      listener?.(
        {
          byteLength: 4,
          requestId: "media-request-1",
          type: "muzhi.media.completed",
        },
        { tab: { id: 41 } },
      );
      return [];
    });
    const downloader = createChromePageMediaDownloader(
      {
        runtime: {
          onMessage: {
            addListener: (value) => {
              listener = value;
            },
            removeListener,
          },
        },
        scripting: { executeScript },
        tabs: {
          query: vi.fn(async () => [
            {
              id: 41,
              url: "https://www.bilibili.com/video/BV1zt4y1z72D?vd_source=x&spm_id_from=y&p=7",
            },
          ]),
        },
      },
      { createRequestId: () => "media-request-1" },
    );

    await expect(
      downloader.download(video(), [
        "https://xy123.mcdn.bilivideo.com/audio.m4s?token=private",
      ]),
    ).resolves.toEqual({
      bytes: new Uint8Array([1, 2, 3, 4]),
      mimeType: "audio/mp4",
    });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [
          "media-request-1",
          ["https://xy123.mcdn.bilivideo.com/audio.m4s?token=private"],
        ],
        target: { tabId: 41 },
        world: "MAIN",
      }),
    );
    const [injection] = executeScript.mock.calls[0] as unknown as [
      { readonly func: (...args: unknown[]) => unknown },
    ];
    expect(String(injection?.func)).not.toMatch(/MAX_MEDIA|MAX_MESSAGE/);
    expect(removeListener).toHaveBeenCalledOnce();
  });

  it("rejects a different Bilibili part before exposing any media URL to the page", async () => {
    const executeScript = vi.fn();
    const downloader = createChromePageMediaDownloader(
      {
        runtime: {
          onMessage: {
            addListener: vi.fn(),
            removeListener: vi.fn(),
          },
        },
        scripting: { executeScript },
        tabs: {
          query: vi.fn(async () => [
            {
              id: 41,
              url: "https://www.bilibili.com/video/BV1zt4y1z72D?p=6",
            },
          ]),
        },
      },
      { createRequestId: () => "media-request-2" },
    );

    await expect(
      downloader.download(video(7), [
        "https://xy123.mcdn.bilivideo.com/audio.m4s?token=private",
      ]),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR", retryable: true });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it("opens any exact video tab when the focused tab is not the video page", async () => {
    let listener: ((message: unknown, sender: unknown) => void) | null = null;
    const removeListener = vi.fn();
    const executeScript = vi.fn(async () => {
      listener?.(
        {
          byteLength: 2,
          mimeType: "audio/mp4",
          requestId: "media-request-2",
          type: "muzhi.media.started",
        },
        { tab: { id: 41 } },
      );
      listener?.(
        {
          data: "AQI=",
          index: 0,
          requestId: "media-request-2",
          type: "muzhi.media.chunk",
        },
        { tab: { id: 41 } },
      );
      listener?.(
        {
          byteLength: 2,
          requestId: "media-request-2",
          type: "muzhi.media.completed",
        },
        { tab: { id: 41 } },
      );
      return [];
    });
    const query = vi
      .fn()
      .mockResolvedValueOnce([{ id: 1, url: "chrome://extensions/" }])
      .mockResolvedValueOnce([
        {
          id: 41,
          url: "https://www.bilibili.com/video/BV1zt4y1z72D?p=7",
        },
      ]);
    const downloader = createChromePageMediaDownloader(
      {
        runtime: {
          onMessage: {
            addListener: (value) => {
              listener = value;
            },
            removeListener,
          },
        },
        scripting: { executeScript },
        tabs: { query },
      },
      { createRequestId: () => "media-request-2" },
    );
    await expect(
      downloader.download(video(7), [
        "https://upos-sz-mirrorcos.bilivideo.com/upgcxcode/audio.m4s",
      ]),
    ).resolves.toMatchObject({ mimeType: "audio/mp4" });
    expect(query).toHaveBeenNthCalledWith(1, {
      active: true,
      lastFocusedWindow: true,
    });
    expect(query).toHaveBeenNthCalledWith(2, {
      url: ["https://www.bilibili.com/video/*"],
    });
    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 41 } }),
    );
  });
});
