import { describe, expect, it, vi } from "vitest";

import { AuthorizedMediaGatewayError } from "../../src/application/authorized-media-gateway";
import { createVideoRef } from "../../src/domain";
import { createBilibiliMediaGateway } from "../../src/infrastructure/bilibili-media-gateway";

const video = createVideoRef({
  aid: 100,
  bvid: "BV1Q541167Qg",
  canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
  cid: 30_000_000_002,
  durationSec: 120,
  page: 2,
  title: "授权视频",
});

function jsonResponse(body: unknown, status = 200) {
  return {
    arrayBuffer: async () => new ArrayBuffer(0),
    headers: { get: () => null },
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

function binaryResponse(bytes: readonly number[], status = 200) {
  return {
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-length"
          ? String(bytes.length)
          : name.toLowerCase() === "content-type"
            ? "audio/mp4"
            : null,
    },
    json: async () => {
      throw new Error("binary");
    },
    ok: status >= 200 && status < 300,
    status,
  };
}

function entitlement(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    code: 0,
    data: {
      is_owner: false,
      is_ugc_pay_preview: false,
      is_upower_exclusive: false,
      is_upower_play: false,
      need_login_subtitle: false,
      ...overrides,
    },
  });
}

function dash(url = "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s") {
  return jsonResponse({
    code: 0,
    data: {
      dash: { audio: [{ bandwidth: 128_000, baseUrl: url }], duration: 120 },
      timelength: 120_000,
    },
  });
}

describe("authorized Bilibili media gateway", () => {
  it("prefers the exact Bilibili page for CDN audio before the service worker fallback", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(dash());
    const pageDownloader = {
      download: vi.fn(async () => ({
        bytes: new Uint8Array([4, 5, 6]),
        mimeType: "audio/mp4",
      })),
    };
    const gateway = createBilibiliMediaGateway({
      fetch,
      pageDownloader,
      sha256: async () => "page-media",
    });

    await expect(gateway.acquireCompleteAudio(video)).resolves.toMatchObject({
      bytes: new Uint8Array([4, 5, 6]),
      mediaIdentity: "sha256:page-media",
    });
    expect(pageDownloader.download).toHaveBeenCalledWith(video, [
      "https://upos-sz-mirrorcos.bilivideo.com/audio.m4s",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not mislabel a missing page download as an expired media URL", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(dash())
      .mockResolvedValueOnce({
        arrayBuffer: async () => new Uint8Array([9, 9, 9]).buffer,
        headers: { get: () => null },
        ok: false,
        status: 403,
      });
    const pageDownloader = {
      download: vi.fn(async () => {
        throw new AuthorizedMediaGatewayError(
          "NETWORK_ERROR",
          "请先打开并保持当前视频页面，再进行语音转字幕。",
          true,
        );
      }),
    };
    const gateway = createBilibiliMediaGateway({
      fetch,
      pageDownloader,
      sha256: async () => "should-not-hash",
    });
    await expect(gateway.acquireCompleteAudio(video)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "请先打开并保持当前视频页面，再进行语音转字幕。",
    });
    expect(pageDownloader.download).toHaveBeenCalledOnce();
    // entitlement + playurl only; no CDN fallback after page download fails
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the exact BVID/CID with first-party credentials and returns only bytes", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(dash())
      .mockResolvedValueOnce(binaryResponse([1, 2, 3]));
    const gateway = createBilibiliMediaGateway({
      fetch,
      sha256: async () => "media-hash",
    });

    const result = await gateway.acquireCompleteAudio(video);
    expect(result).toEqual({
      byteLength: 3,
      bytes: new Uint8Array([1, 2, 3]),
      durationMs: 120_000,
      mediaIdentity: "sha256:media-hash",
      mimeType: "audio/mp4",
      videoKey: video.videoKey,
    });
    expect(fetch.mock.calls[0]?.[0]).toContain(
      "/x/player/v2?bvid=BV1Q541167Qg&cid=30000000002",
    );
    expect(fetch.mock.calls[1]?.[0]).toContain(
      "/x/player/playurl?bvid=BV1Q541167Qg&cid=30000000002",
    );
    for (const [requestUrl, init] of fetch.mock.calls) {
      // The API endpoints need the login session; the signed media CDN answers
      // with a wildcard allow-origin and rejects a credentialed request.
      expect(init).toEqual(
        expect.objectContaining({
          credentials:
            new URL(requestUrl).hostname === "api.bilibili.com"
              ? "include"
              : "omit",
          method: "GET",
        }),
      );
      expect(init.headers).not.toHaveProperty("Cookie");
    }
    expect(JSON.stringify(result)).not.toContain("bilivideo");
  });

  it.each([
    [{ need_login_subtitle: true }, "AUTHENTICATION_REQUIRED"],
    [
      { is_upower_exclusive: true, is_upower_play: false },
      "UNSUPPORTED_CAPABILITY",
    ],
    [
      { is_upower_exclusive: true, is_upower_play: true, is_owner: true },
      "UNSUPPORTED_CAPABILITY",
    ],
    [{ is_ugc_pay_preview: true }, "UNSUPPORTED_CAPABILITY"],
  ] as const)("rejects entitlement state %#", async (overrides, code) => {
    const gateway = createBilibiliMediaGateway({
      fetch: vi.fn().mockResolvedValueOnce(entitlement(overrides)),
    });
    await expect(gateway.acquireCompleteAudio(video)).rejects.toMatchObject({
      code,
    });
  });

  it("rejects a successful but shortened preview response", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            dash: {
              audio: [
                {
                  baseUrl:
                    "https://upos-sz-mirrorcos.bilivideo.com/preview.m4s",
                },
              ],
              duration: 20,
            },
            timelength: 20_000,
          },
        }),
      );
    const gateway = createBilibiliMediaGateway({ fetch });

    await expect(gateway.acquireCompleteAudio(video)).rejects.toMatchObject({
      code: "MEDIA_INCOMPLETE",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes an expired signed media URL once without exposing it", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(
        dash("https://upos-sz-mirrorcos.bilivideo.com/old.m4s?token=secret"),
      )
      .mockResolvedValueOnce(binaryResponse([], 403))
      .mockResolvedValueOnce(
        dash("https://upos-sz-mirrorcos.bilivideo.com/new.m4s?token=secret-2"),
      )
      .mockResolvedValueOnce(binaryResponse([9, 8]));
    const gateway = createBilibiliMediaGateway({
      fetch,
      sha256: async () => "fresh",
    });

    await expect(gateway.acquireCompleteAudio(video)).resolves.toMatchObject({
      byteLength: 2,
      mediaIdentity: "sha256:fresh",
    });
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("uses a safe DASH backup before refreshing metadata", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            dash: {
              audio: [
                {
                  backupUrl: [
                    "https://upos-sz-mirrorcos.bilivideo.com/backup.m4s",
                  ],
                  bandwidth: 128_000,
                  baseUrl:
                    "https://upos-sz-mirrorcos.bilivideo.com/expired.m4s",
                },
              ],
              duration: 120,
            },
            timelength: 120_000,
          },
        }),
      )
      .mockResolvedValueOnce(binaryResponse([], 403))
      .mockResolvedValueOnce(binaryResponse([7]));
    const gateway = createBilibiliMediaGateway({
      fetch,
      sha256: async () => "backup",
    });

    await expect(gateway.acquireCompleteAudio(video)).resolves.toMatchObject({
      bytes: new Uint8Array([7]),
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("concatenates every durl segment and rejects unsafe hosts", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            durl: [
              { url: "https://upos-sz-mirrorcos.bilivideo.com/part-1.mp4" },
              { url: "https://upos-sz-mirrorcos.bilivideo.com/part-2.mp4" },
            ],
            timelength: 120_000,
          },
        }),
      )
      .mockResolvedValueOnce(binaryResponse([1, 2]))
      .mockResolvedValueOnce(binaryResponse([3]));
    const gateway = createBilibiliMediaGateway({
      fetch,
      sha256: async () => "joined",
    });
    await expect(gateway.acquireCompleteAudio(video)).resolves.toMatchObject({
      bytes: new Uint8Array([1, 2, 3]),
    });

    const unsafeGateway = createBilibiliMediaGateway({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(entitlement())
        .mockResolvedValueOnce(dash("https://example.com/audio.m4s")),
    });
    await expect(
      unsafeGateway.acquireCompleteAudio(video),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_CAPABILITY",
    });
  });

  it("forwards AbortSignal to every network request and stops an in-flight media download", async () => {
    const controller = new AbortController();
    let downloadAborted = false;
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(dash())
      .mockImplementationOnce(
        async (
          _url: string,
          init: { readonly signal?: AbortSignal },
        ): Promise<never> =>
          await new Promise<never>((_resolve, reject) => {
            init.signal?.addEventListener(
              "abort",
              () => {
                downloadAborted = true;
                reject(new DOMException("cancelled", "AbortError"));
              },
              { once: true },
            );
          }),
      );
    const gateway = createBilibiliMediaGateway({ fetch });
    const operation = gateway.acquireCompleteAudio(video, {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));

    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: "AbortError" });
    expect(downloadAborted).toBe(true);
    for (const [, init] of fetch.mock.calls) {
      expect(init.signal).toBe(controller.signal);
    }
  });

  it("publishes real streamed byte progress and cancels the response reader", async () => {
    const controller = new AbortController();
    const cancel = vi.fn(async () => undefined);
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        done: false as const,
        value: new Uint8Array([1, 2]),
      })
      .mockImplementationOnce(
        async (): Promise<never> => await new Promise<never>(() => undefined),
      );
    const progress: unknown[] = [];
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(entitlement())
      .mockResolvedValueOnce(dash())
      .mockResolvedValueOnce({
        arrayBuffer: async () => new ArrayBuffer(0),
        body: { getReader: () => ({ cancel, read }) },
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-length"
              ? "4"
              : name.toLowerCase() === "content-type"
                ? "audio/mp4"
                : null,
        },
        json: async () => {
          throw new Error("binary");
        },
        ok: true,
        status: 200,
      });
    const gateway = createBilibiliMediaGateway({ fetch });
    const operation = gateway.acquireCompleteAudio(video, {
      onProgress: async (next) => {
        progress.push(next);
      },
      signal: controller.signal,
    });
    const cancelled = expect(operation).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() =>
      expect(progress).toContainEqual({
        completedBytes: 2,
        phase: "downloading",
        totalBytes: 4,
      }),
    );

    controller.abort();

    await cancelled;
    expect(cancel).toHaveBeenCalledOnce();
  });
});
