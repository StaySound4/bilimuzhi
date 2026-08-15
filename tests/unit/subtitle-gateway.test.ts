import { describe, expect, it, vi } from "vitest";

import {
  createDirectSubtitleAcquirer,
  type DirectSubtitleGateway,
} from "../../src/application/subtitle-gateway";
import { createSession, createVideoRef } from "../../src/domain";
import {
  createBilibiliSubtitleGateway,
  createChromeBilibiliSubtitleGateway,
} from "../../src/infrastructure/bilibili-subtitle-gateway";
import { hashSubtitleRows } from "../../src/infrastructure/subtitle-content-hash";

/**
 * Only `api.bilibili.com` answers a credentialed cross-origin request. The
 * subtitle CDN answers with a wildcard allow-origin, so sending credentials
 * there makes the browser drop the response.
 */
function expectedCredentials(requestUrl: string): "include" | "omit" {
  return new URL(requestUrl).hostname === "api.bilibili.com"
    ? "include"
    : "omit";
}

function createBoundVideo() {
  const video = createVideoRef({
    aid: 100,
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
    cid: 30_000_000_001,
    page: 1,
    title: "普通视频",
  });
  const session = createSession({
    activeBranchId: null,
    createdAt: 1_000,
    customTitle: false,
    lastActivityAt: 1_000,
    selectionRevision: 0,
    sessionId: "session-1",
    title: video.title,
    updatedAt: 1_000,
    videoKey: video.videoKey,
  });
  return { session, video };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
  };
}

function protobufVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    bytes.push(byte);
  } while (remaining > 0);
  return bytes;
}

function protobufBytes(field: number, bytes: readonly number[]): number[] {
  return [
    ...protobufVarint((field << 3) | 2),
    ...protobufVarint(bytes.length),
    ...bytes,
  ];
}

function protobufString(field: number, value: string): number[] {
  return protobufBytes(field, [...new TextEncoder().encode(value)]);
}

function subtitleWebViewResponse(
  input: {
    readonly id: number;
    readonly language: string;
    readonly name: string;
    readonly url: string;
  } = {
    id: 2001,
    language: "ja-JP",
    name: "日本語",
    url: "https://aisubtitle.hdslb.com/web-view/ja.json",
  },
): Uint8Array {
  const track = [
    ...protobufVarint(8),
    ...protobufVarint(input.id),
    ...protobufString(3, input.language),
    ...protobufString(4, input.name),
    ...protobufString(5, input.url),
  ];
  const videoSubtitle = protobufBytes(3, track);
  return new Uint8Array(protobufBytes(1, videoSubtitle));
}

function binaryResponse(bytes: Uint8Array, status = 200) {
  return {
    arrayBuffer: async () => bytes.buffer.slice(0),
    json: async () => {
      throw new Error("binary response");
    },
    ok: status >= 200 && status < 300,
    status,
  };
}

describe("direct Bilibili subtitle acquisition", () => {
  it("lists only safe track choices and acquires the explicitly selected track", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  ai_type: 1,
                  id: 1001,
                  lan: "zh-CN",
                  lan_doc: "中文（自动生成）",
                  subtitle_url:
                    "https://aisubtitle.hdslb.com/zh.json?token=secret",
                },
                {
                  ai_type: 0,
                  id: 1002,
                  lan: "en-US",
                  lan_doc: "English",
                  subtitle_url:
                    "https://aisubtitle.hdslb.com/en.json?token=secret",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          body: [{ content: "selected", from: 1, to: 2 }],
        }),
      );
    const gateway = createBilibiliSubtitleGateway({ fetch });
    const video = createBoundVideo().video;

    const tracks = await gateway.listTracks(video);
    expect(tracks).toEqual([
      {
        language: "zh-CN",
        name: "中文（自动生成）",
        origin: "ai",
        source: "ai",
        trackId: "id:1001",
      },
      {
        language: "en-US",
        name: "English",
        origin: "official-cc",
        source: "official",
        trackId: "id:1002",
      },
    ]);
    expect(Object.isFrozen(tracks)).toBe(true);
    expect(tracks.every(Object.isFrozen)).toBe(true);
    await expect(gateway.acquire(video, "id:1002")).resolves.toEqual({
      language: "en-US",
      rows: [{ endMs: 2_000, startMs: 1_000, text: "selected" }],
      trackOrigin: "official-cc",
    });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://aisubtitle.hdslb.com/en.json?token=secret",
    );
    expect(JSON.stringify(tracks)).not.toContain("token=secret");
  });

  it("classifies track origin from player/v2 metadata and carries it through acquire", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            is_upower_exclusive: false,
            is_upower_play: false,
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  ai_type: 0,
                  author_mid: 0,
                  id: 3001,
                  lan: "zh-CN",
                  lan_doc: "中文（官方）",
                  subtitle_url:
                    "https://aisubtitle.hdslb.com/zh-official.json?token=secret",
                },
                {
                  ai_type: 1,
                  author_mid: 0,
                  id: 3002,
                  lan: "zh-CN",
                  lan_doc: "中文（自动生成）",
                  subtitle_url:
                    "https://aisubtitle.hdslb.com/zh-ai.json?token=secret",
                },
                {
                  ai_type: 0,
                  author_mid: 12345,
                  id: 3003,
                  lan: "zh-CN",
                  lan_doc: "UP主字幕",
                  subtitle_url:
                    "https://aisubtitle.hdslb.com/zh-user.json?token=secret",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ body: [{ content: "official", from: 1, to: 2 }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ body: [{ content: "ai", from: 1, to: 2 }] }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ body: [{ content: "user", from: 1, to: 2 }] }),
      );
    const gateway = createBilibiliSubtitleGateway({ fetch });
    const video = createBoundVideo().video;

    await expect(gateway.acquire(video, "id:3001")).resolves.toMatchObject({
      language: "zh-CN",
      trackOrigin: "official-cc",
    });
    await expect(gateway.acquire(video, "id:3002")).resolves.toMatchObject({
      language: "zh-CN",
      trackOrigin: "ai",
    });
    await expect(gateway.acquire(video, "id:3003")).resolves.toMatchObject({
      language: "zh-CN",
      trackOrigin: "user-upload",
    });
  });

  it("keeps same-ID tracks isolated while two exact pages are discovered and acquired out of order", async () => {
    const p7 = createVideoRef({
      aid: 100,
      bvid: "BV1zt4y1z72D",
      canonicalUrl: "https://www.bilibili.com/video/BV1zt4y1z72D?p=7",
      cid: 70_000_007,
      page: 7,
      title: "P7",
    });
    const p9 = createVideoRef({
      aid: 100,
      bvid: "BV1zt4y1z72D",
      canonicalUrl: "https://www.bilibili.com/video/BV1zt4y1z72D?p=9",
      cid: 70_000_009,
      page: 9,
      title: "P9",
    });
    const fetch = vi.fn(async (url: string) => {
      const request = new URL(url);
      if (request.pathname === "/x/player/v2") {
        const cid = request.searchParams.get("cid");
        const page =
          cid === String(p7.cid) ? 7 : cid === String(p9.cid) ? 9 : 0;
        return jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles:
                page === 0
                  ? []
                  : [
                      {
                        ai_type: 0,
                        id: 7100,
                        lan: "en-US",
                        lan_doc: "English",
                        subtitle_url: `https://aisubtitle.hdslb.com/ted/p${page}.json`,
                      },
                    ],
            },
          },
        });
      }
      if (url === "https://aisubtitle.hdslb.com/ted/p7.json") {
        return jsonResponse({
          body: [{ content: "P7 exact subtitle", from: 7, to: 8 }],
        });
      }
      if (url === "https://aisubtitle.hdslb.com/ted/p9.json") {
        return jsonResponse({
          body: [{ content: "P9 exact subtitle", from: 9, to: 10 }],
        });
      }
      return jsonResponse({}, 404);
    });
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await gateway.listTracks(p7);
    await gateway.listTracks(p9);
    await expect(gateway.acquire(p9, "id:7100")).resolves.toEqual({
      language: "en-US",
      rows: [{ endMs: 10_000, startMs: 9_000, text: "P9 exact subtitle" }],
      trackOrigin: "official-cc",
    });
    await expect(gateway.acquire(p7, "id:7100")).resolves.toEqual({
      language: "en-US",
      rows: [{ endMs: 8_000, startMs: 7_000, text: "P7 exact subtitle" }],
      trackOrigin: "official-cc",
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining(`cid=${p7.cid}`),
      expect.stringContaining(`cid=${p9.cid}`),
      "https://aisubtitle.hdslb.com/ted/p9.json",
      "https://aisubtitle.hdslb.com/ted/p7.json",
    ]);
  });

  it("unions exact-CID tracks across player sources instead of trusting the first non-empty source", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  ai_type: 1,
                  id: 1101,
                  lan: "ai-zh",
                  lan_doc: "中文（自动生成）",
                  subtitle_url: "https://aisubtitle.hdslb.com/ai-zh.json",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  ai_type: 0,
                  id: 1102,
                  lan: "zh-CN",
                  lan_doc: "中文简体",
                  subtitle_url: "https://aisubtitle.hdslb.com/zh-CN.json",
                },
                {
                  ai_type: 0,
                  id: 1103,
                  lan: "en-US",
                  lan_doc: "English (US)",
                  subtitle_url: "https://aisubtitle.hdslb.com/en-US.json",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }));
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(createBoundVideo().video)).resolves.toEqual(
      [
        {
          language: "ai-zh",
          name: "中文（自动生成）",
          origin: "ai",
          source: "ai",
          trackId: "id:1101",
        },
        {
          language: "zh-CN",
          name: "中文简体",
          origin: "official-cc",
          source: "official",
          trackId: "id:1102",
        },
        {
          language: "en-US",
          name: "English (US)",
          origin: "official-cc",
          source: "official",
          trackId: "id:1103",
        },
      ],
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("uses the WBI player when the ordinary player has no tracks", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: { subtitles: [] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  id: 1003,
                  lan: "de-DE",
                  lan_doc: "Deutsch",
                  subtitle_url: "https://aisubtitle.hdslb.com/wbi/de.json",
                },
              ],
            },
          },
        }),
      );
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(createBoundVideo().video)).resolves.toEqual(
      [
        {
          language: "de-DE",
          name: "Deutsch",
          origin: "official-cc",
          source: "official",
          trackId: "id:1003",
        },
      ],
    );
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://api.bilibili.com/x/player/wbi/v2?aid=100&cid=30000000001",
    );
  });

  it("decodes the bounded binary subtitle Web View fallback", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: { subtitles: [] },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: { subtitles: [] },
          },
        }),
      )
      .mockResolvedValueOnce(binaryResponse(subtitleWebViewResponse()));
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(createBoundVideo().video)).resolves.toEqual(
      [
        {
          language: "ja-JP",
          name: "日本語",
          source: "official",
          trackId: "id:2001",
        },
      ],
    );
    expect(fetch.mock.calls[2]?.[0]).toContain(
      "https://api.bilibili.com/x/v2/subtitle/web/view?",
    );
    for (const [requestUrl, init] of fetch.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          credentials: expectedCredentials(requestUrl),
          headers: expect.objectContaining({
            Referer: createBoundVideo().video.canonicalUrl,
          }),
          method: "GET",
        }),
      );
      expect(init.headers).not.toHaveProperty("Cookie");
    }
    expect(fetch.mock.calls[2]?.[1].headers.Accept).toBe(
      "application/x-protobuf, application/octet-stream, */*",
    );
  });

  it("rejects subtitle discovery when no CID-bound source has a track", async () => {
    const emptyPlayer = jsonResponse({
      code: 0,
      data: {
        need_login_subtitle: false,
        subtitle: { subtitles: [] },
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(emptyPlayer)
      .mockResolvedValueOnce(emptyPlayer)
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }));
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(createBoundVideo().video)).rejects.toEqual(
      expect.objectContaining({ code: "SUBTITLE_NOT_FOUND" }),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(
      "https://api.bilibili.com/x/web-interface/view?bvid=BV1Q541167Qg",
    );
  });

  it("synthesizes a safe AI track when only the AI subtitle address endpoint succeeds", async () => {
    const emptyPlayer = jsonResponse({
      code: 0,
      data: {
        need_login_subtitle: false,
        subtitle: { subtitles: [] },
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(emptyPlayer)
      .mockResolvedValueOnce(emptyPlayer)
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            lan: "ai-zh",
            lan_doc: "中文（自动生成）",
            subtitle_url: "https://aisubtitle.hdslb.com/ai/zh.json",
          },
        }),
      );
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(createBoundVideo().video)).resolves.toEqual(
      [
        {
          language: "ai-zh",
          name: "中文（自动生成）",
          origin: "ai",
          source: "ai",
          trackId: "id:ai-fallback",
        },
      ],
    );
    expect(fetch.mock.calls[3]?.[0]).toBe(
      "https://api.bilibili.com/x/player/v2/ai/subtitle/search/stat?aid=100&cid=30000000001",
    );
  });

  it("resolves an empty AI track URL only when Web View confirms the same stable identity", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            subtitle: {
              subtitles: [
                {
                  ai_type: 1,
                  id: 4001,
                  lan: "ai-zh",
                  lan_doc: "中文（自动生成）",
                  subtitle_url: "",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        binaryResponse(
          subtitleWebViewResponse({
            id: 4001,
            language: "ai-zh",
            name: "中文（自动生成）",
            url: "https://aisubtitle.hdslb.com/ai/resolved.json",
          }),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          body: [{ content: "resolved AI", from: 0, to: 1 }],
        }),
      );
    const gateway = createBilibiliSubtitleGateway({ fetch });
    const video = createBoundVideo().video;

    await gateway.listTracks(video);
    await expect(gateway.acquire(video, "id:4001")).resolves.toEqual({
      language: "ai-zh",
      rows: [{ endMs: 1_000, startMs: 0, text: "resolved AI" }],
      trackOrigin: "ai",
    });
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "https://aisubtitle.hdslb.com/ai/resolved.json",
    );
  });

  it("never binds an unresolved selected track to a same-language fallback identity", async () => {
    const unresolvedPlayer = jsonResponse({
      code: 0,
      data: {
        need_login_subtitle: false,
        subtitle: {
          subtitles: [
            {
              ai_type: 1,
              id: 4001,
              lan: "ai-zh",
              lan_doc: "中文（自动生成）",
              subtitle_url: "",
            },
          ],
        },
      },
    });
    const unrelatedAiAddress = jsonResponse({
      code: 0,
      data: {
        lan: "ai-zh",
        lan_doc: "中文（自动生成）",
        subtitle_url: "https://aisubtitle.hdslb.com/ai/unrelated-source.json",
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(unresolvedPlayer)
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(unrelatedAiAddress)
      .mockResolvedValueOnce(unresolvedPlayer)
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(unrelatedAiAddress)
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(unrelatedAiAddress);
    const gateway = createBilibiliSubtitleGateway({ fetch });
    const video = createBoundVideo().video;

    await gateway.listTracks(video);
    await expect(gateway.acquire(video, "id:4001")).rejects.toMatchObject({
      code: "SUBTITLE_URL_EXPIRED",
      message: "The Bilibili subtitle URL has expired",
      retryable: true,
    });
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(
      "https://aisubtitle.hdslb.com/ai/unrelated-source.json",
    );
  });

  it.each([
    "http://aisubtitle.hdslb.com/insecure.json",
    "https://bilibili.com.evil.example/subtitle.json",
    "https://example.com/subtitle.json",
    "javascript:alert(1)",
  ])(
    "rejects an unsafe subtitle host before content fetch (%s)",
    async (url) => {
      const fetch = vi.fn().mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            subtitle: {
              subtitles: [{ id: 5001, lan: "zh-CN", subtitle_url: url }],
            },
          },
        }),
      );
      const gateway = createBilibiliSubtitleGateway({ fetch });

      await expect(
        gateway.listTracks(createBoundVideo().video),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", retryable: false });
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("reports a stable expired-URL error when the single refresh also expires", async () => {
    const player = (url: string) =>
      jsonResponse({
        code: 0,
        data: {
          subtitle: {
            subtitles: [
              {
                id: 6001,
                lan: "zh-CN",
                subtitle_url: url,
              },
            ],
          },
        },
      });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        player("https://aisubtitle.hdslb.com/expired-first.json"),
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))
      .mockResolvedValueOnce(
        player("https://aisubtitle.hdslb.com/expired-again.json"),
      )
      .mockResolvedValueOnce(jsonResponse({}, 410));
    const gateway = createBilibiliSubtitleGateway({ fetch });
    const video = createBoundVideo().video;

    await gateway.listTracks(video);
    await expect(gateway.acquire(video, "id:6001")).rejects.toMatchObject({
      code: "SUBTITLE_URL_EXPIRED",
      message: "The Bilibili subtitle URL has expired",
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("refreshes a selected TED P13 track through exact-CID Web View after its listed CDN URL fails to fetch", async () => {
    const video = createVideoRef({
      aid: 628_690_784,
      bvid: "BV1zt4y1z72D",
      canonicalUrl: "https://www.bilibili.com/video/BV1zt4y1z72D?p=13",
      cid: 30_000_000_013,
      page: 13,
      title:
        "2020-10-16 What if there were 1 trillion more trees - Jean-François Bastin",
    });
    const staleUrl =
      "https://aisubtitle.hdslb.com/ted/p13-en-US-stale.json?token=expired";
    const freshUrl =
      "https://aisubtitle.hdslb.com/ted/p13-en-US-fresh.json?token=refreshed";
    const playerWithStaleSelectedTrack = jsonResponse({
      code: 0,
      data: {
        need_login_subtitle: false,
        subtitle: {
          subtitles: [
            {
              ai_type: 0,
              id: 13_002,
              lan: "en-US",
              lan_doc: "English (US)",
              subtitle_url: staleUrl,
            },
          ],
        },
      },
    });
    const requestedUrls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url === staleUrl) {
        throw new TypeError("Failed to fetch");
      }
      if (url === freshUrl) {
        return jsonResponse({
          body: [
            {
              content: "And how do they sequester carbon in the first place?",
              from: 55,
              to: 58,
            },
          ],
        });
      }
      if (url.includes("/x/web-interface/wbi/view/detail?")) {
        return jsonResponse({
          code: 0,
          data: {
            View: {
              aid: video.aid,
              bvid: video.bvid,
              pages: [{ cid: video.cid, page: video.page }],
            },
          },
        });
      }
      if (url.includes("/x/v2/subtitle/web/view?")) {
        return binaryResponse(
          subtitleWebViewResponse({
            id: 13_002,
            language: "en-US",
            name: "English (US)",
            url: freshUrl,
          }),
        );
      }
      if (url.includes("/x/player/v2?") || url.includes("/x/player/wbi/v2?")) {
        return playerWithStaleSelectedTrack;
      }
      return jsonResponse({ code: -404 }, 404);
    });
    const gateway = createBilibiliSubtitleGateway({
      fetch,
      signWbiUrl: async (pathname, parameters) => {
        const query = new URLSearchParams(
          Object.entries(parameters).map(([key, value]) => [
            key,
            String(value),
          ]),
        );
        query.set("w_rid", "fixture-signature");
        return `https://api.bilibili.com${pathname}?${query.toString()}`;
      },
    });

    await expect(gateway.listTracks(video)).resolves.toEqual([
      {
        language: "en-US",
        name: "English (US)",
        origin: "official-cc",
        source: "official",
        trackId: "id:13002",
      },
    ]);
    await expect(gateway.acquire(video, "id:13002")).resolves.toEqual({
      language: "en-US",
      rows: [
        {
          endMs: 58_000,
          startMs: 55_000,
          text: "And how do they sequester carbon in the first place?",
        },
      ],
    });
    expect(requestedUrls).toContain(staleUrl);
    expect(requestedUrls).toContain(freshUrl);
    expect(
      requestedUrls.find((url) => url.includes("/x/v2/subtitle/web/view?")),
    ).toContain("oid=30000000013&pid=628690784");
  });

  it("never refreshes an expired track into another same-language identity", async () => {
    const player = (input: {
      readonly id: number;
      readonly name: string;
      readonly url: string;
    }) =>
      jsonResponse({
        code: 0,
        data: {
          need_login_subtitle: false,
          subtitle: {
            subtitles: [
              {
                ai_type: 0,
                id: input.id,
                lan: "zh-CN",
                lan_doc: input.name,
                subtitle_url: input.url,
              },
            ],
          },
        },
      });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        player({
          id: 7001,
          name: "中文简体",
          url: "https://aisubtitle.hdslb.com/old-track.json",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))
      .mockResolvedValueOnce(
        player({
          id: 7002,
          name: "中文（另一轨）",
          url: "https://aisubtitle.hdslb.com/different-track.json",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ body: [{ content: "错误轨道", from: 0, to: 1 }] }),
      );
    const gateway = createBilibiliSubtitleGateway({ fetch });
    const video = createBoundVideo().video;

    await gateway.listTracks(video);
    await expect(gateway.acquire(video, "id:7001")).rejects.toMatchObject({
      code: "SUBTITLE_URL_EXPIRED",
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never refreshes an expired track when the same ID now describes a different track", async () => {
    const player = (input: {
      readonly language: string;
      readonly name: string;
      readonly source: "ai" | "official";
      readonly url: string;
    }) =>
      jsonResponse({
        code: 0,
        data: {
          need_login_subtitle: false,
          subtitle: {
            subtitles: [
              {
                ai_type: input.source === "ai" ? 1 : 0,
                id: 7003,
                lan: input.language,
                lan_doc: input.name,
                subtitle_url: input.url,
              },
            ],
          },
        },
      });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        player({
          language: "zh-CN",
          name: "中文简体",
          source: "official",
          url: "https://aisubtitle.hdslb.com/old-descriptor.json",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 403))
      .mockResolvedValueOnce(
        player({
          language: "en-US",
          name: "English",
          source: "official",
          url: "https://aisubtitle.hdslb.com/reused-id-wrong-track.json",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          body: [{ content: "wrong reused-ID track", from: 0, to: 1 }],
        }),
      );
    const gateway = createBilibiliSubtitleGateway({ fetch });
    const video = createBoundVideo().video;

    await gateway.listTracks(video);
    await expect(gateway.acquire(video, "id:7003")).rejects.toMatchObject({
      code: "SUBTITLE_URL_EXPIRED",
      retryable: true,
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(
      "https://aisubtitle.hdslb.com/reused-id-wrong-track.json",
    );
  });

  it("normalizes an ordinary video subtitle into a new immutable staged snapshot", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            subtitle: {
              subtitles: [
                {
                  lan: "zh-CN",
                  subtitle_url:
                    "//aisubtitle.hdslb.com/bfs/ai_subtitle/demo.json?token=signed",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          body: [
            { content: "  第一行  ", from: 0.125, to: 1.5 },
            { content: "第二行", from: 1.5, to: 2.75 },
          ],
        }),
      );
    const gateway: DirectSubtitleGateway = createBilibiliSubtitleGateway({
      fetch,
    });
    const hashRows = vi.fn(async () => "sha256:deterministic");
    const acquire = createDirectSubtitleAcquirer({
      createSubtitleId: () => "subtitle-1",
      gateway,
      hashRows,
      now: () => 2_000,
    });
    const { session, video } = createBoundVideo();

    const snapshot = await acquire({
      session,
      trackId: "fallback:official:zh-CN:2606c833",
      video,
    });

    expect(snapshot).toEqual({
      branchId: "initial:subtitle-1",
      contentHash: "sha256:deterministic",
      createdAt: 2_000,
      language: "zh-CN",
      rows: [
        { endMs: 1_500, startMs: 125, text: "第一行" },
        { endMs: 2_750, startMs: 1_500, text: "第二行" },
      ],
      sessionId: "session-1",
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-1",
      trackOrigin: "official-cc",
      videoKey: video.videoKey,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(hashRows).toHaveBeenCalledWith(snapshot.rows);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls).toEqual([
      [
        "https://api.bilibili.com/x/player/v2?bvid=BV1Q541167Qg&cid=30000000001",
        expect.objectContaining({
          credentials: "include",
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: video.canonicalUrl,
          },
          method: "GET",
        }),
      ],
      [
        "https://aisubtitle.hdslb.com/bfs/ai_subtitle/demo.json?token=signed",
        expect.objectContaining({
          credentials: "omit",
          headers: {
            Accept: "application/json, text/plain, */*",
            Referer: video.canonicalUrl,
          },
          method: "GET",
        }),
      ],
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers).not.toHaveProperty("Cookie");
    }
  });

  it.each([
    {
      code: "AUTHENTICATION_REQUIRED",
      isLogin: false,
      message: "Bilibili login is required to access these subtitles",
    },
    {
      code: "PERMISSION_DENIED",
      isLogin: true,
      message: "The current Bilibili account cannot access these subtitles",
    },
  ] as const)(
    "distinguishes $code when restricted subtitle tracks are absent",
    async ({ code, isLogin, message }) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            code: 0,
            data: {
              need_login_subtitle: true,
              subtitle: { subtitles: [] },
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            code: 0,
            data: {
              need_login_subtitle: true,
              subtitle: { subtitles: [] },
            },
          }),
        )
        .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
        .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }))
        .mockResolvedValueOnce(jsonResponse({ code: 0, data: { isLogin } }));
      const gateway = createBilibiliSubtitleGateway({ fetch });

      await expect(
        gateway.listTracks(createBoundVideo().video),
      ).rejects.toEqual(
        expect.objectContaining({ code, message, retryable: false }),
      );
      expect(fetch.mock.calls[4]).toEqual([
        "https://api.bilibili.com/x/web-interface/nav",
        expect.objectContaining({ credentials: "include", method: "GET" }),
      ]);
    },
  );

  it("does not disguise an ordinary no-subtitle result as an authorization error", async () => {
    const emptyPlayer = jsonResponse({
      code: 0,
      data: {
        need_login_subtitle: false,
        subtitle: { subtitles: [] },
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(emptyPlayer)
      .mockResolvedValueOnce(emptyPlayer)
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }));
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(createBoundVideo().video)).rejects.toEqual(
      expect.objectContaining({
        code: "SUBTITLE_NOT_FOUND",
        message: "The bound Bilibili video has no direct subtitles",
        retryable: false,
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("preserves a fallback network failure when no later endpoint finds a track", async () => {
    const emptyPlayer = jsonResponse({
      code: 0,
      data: {
        need_login_subtitle: false,
        subtitle: { subtitles: [] },
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(emptyPlayer)
      .mockRejectedValueOnce(new Error("SESSDATA=secret"))
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }));
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(createBoundVideo().video)).rejects.toEqual(
      expect.objectContaining({
        code: "NETWORK_ERROR",
        message: "Unable to load Bilibili subtitles",
        retryable: true,
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("preserves malformed Web View binary evidence when no later fallback succeeds", async () => {
    const emptyPlayer = jsonResponse({
      code: 0,
      data: {
        need_login_subtitle: false,
        subtitle: { subtitles: [] },
      },
    });
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(emptyPlayer)
      .mockResolvedValueOnce(emptyPlayer)
      .mockResolvedValueOnce(binaryResponse(new Uint8Array([0x0b])))
      .mockResolvedValueOnce(jsonResponse({ code: 0, data: {} }));
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(gateway.listTracks(createBoundVideo().video)).rejects.toEqual(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        message: "The Bilibili subtitle response is invalid",
        retryable: false,
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it.each([undefined, "true", 1, null])(
    "rejects a malformed missing-track authorization marker (%s)",
    async (needLoginSubtitle) => {
      const fetch = vi.fn().mockResolvedValue(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: needLoginSubtitle,
            subtitle: { subtitles: [] },
          },
        }),
      );
      const gateway = createBilibiliSubtitleGateway({ fetch });

      await expect(
        gateway.listTracks(createBoundVideo().video),
      ).rejects.toEqual(
        expect.objectContaining({
          code: "VALIDATION_FAILED",
          message: "The Bilibili subtitle response is invalid",
        }),
      );
    },
  );

  it("acquires the selected AI track through the direct subtitle URL", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  lan: "ai-zh",
                  subtitle_url: "https://aisubtitle.hdslb.com/authorized.json",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: { subtitles: [] },
          },
        }),
      )
      .mockResolvedValueOnce(binaryResponse(new Uint8Array()))
      .mockResolvedValueOnce(
        jsonResponse({
          body: [{ content: "普通视频字幕", from: 2, to: 3.25 }],
        }),
      );
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await expect(
      gateway.acquire(createBoundVideo().video, "fallback:ai:ai-zh:e228cb24"),
    ).resolves.toEqual({
      language: "ai-zh",
      rows: [{ endMs: 3_250, startMs: 2_000, text: "普通视频字幕" }],
      trackOrigin: "ai",
    });
    for (const [requestUrl, init] of fetch.mock.calls) {
      expect(init).toEqual(
        expect.objectContaining({
          credentials: expectedCredentials(requestUrl),
          method: "GET",
        }),
      );
    }
  });

  it("rejects a charged video with full playback entitlement before any track discovery", async () => {
    const video = createVideoRef({
      aid: 777,
      bvid: "BV1qTNP6QE4n",
      canonicalUrl: "https://www.bilibili.com/video/BV1qTNP6QE4n",
      cid: 88_000_001,
      page: 1,
      title: "充电视频",
    });
    const requestedUrls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.endsWith("/x/web-interface/nav")) {
        return jsonResponse({
          code: 0,
          data: {
            wbi_img: {
              img_url:
                "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
              sub_url:
                "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
            },
          },
        });
      }
      if (url.includes("/x/web-interface/wbi/view/detail?")) {
        return jsonResponse({
          code: 0,
          data: {
            View: {
              aid: 777,
              bvid: "BV1qTNP6QE4n",
              pages: [{ cid: 88_000_001, page: 1 }],
            },
          },
        });
      }
      if (url.includes("/x/player/wbi/v2?")) {
        return jsonResponse({
          code: 0,
          data: {
            is_upower_exclusive: true,
            is_upower_play: true,
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  ai_type: 1,
                  id: 9001,
                  lan: "ai-zh",
                  lan_doc: "中文",
                  subtitle_url: "",
                },
              ],
            },
          },
        });
      }
      return jsonResponse({ code: -403 }, 403);
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      fetch,
      now: () => 1_702_204_169_000,
    });

    await expect(gateway.listTracks(video)).rejects.toEqual(
      expect.objectContaining({
        code: "CHARGED_CONTENT_UNSUPPORTED",
        retryable: false,
      }),
    );
    // 充电视频在轨道发现前短路,不请求任何字幕轨道或正文。
    expect(requestedUrls).not.toContain(
      "https://aisubtitle.hdslb.com/charge/exact.json",
    );
    expect(requestedUrls).not.toContain(
      "https://aisubtitle.hdslb.com/restricted.json",
    );
  });

  it.each([
    {
      data: {
        is_upower_exclusive: true,
        is_upower_play: true,
        need_login_subtitle: false,
      },
      label: "a charged video with full playback entitlement",
    },
    {
      data: {
        is_upower_exclusive: true,
        is_upower_play: false,
        need_login_subtitle: false,
      },
      label: "a charged video without supporter entitlement",
    },
    {
      data: {
        is_ugc_pay_preview: true,
        need_login_subtitle: false,
      },
      label: "a paid preview video",
    },
  ])(
    "rejects $label with CHARGED_CONTENT_UNSUPPORTED regardless of account state",
    async ({ data }) => {
      const fetch = vi.fn().mockResolvedValue(
        jsonResponse({
          code: 0,
          data: {
            ...data,
            subtitle: {
              subtitles: [
                {
                  lan: "ai-zh",
                  subtitle_url: "https://aisubtitle.hdslb.com/restricted.json",
                },
              ],
            },
          },
        }),
      );
      const gateway = createBilibiliSubtitleGateway({ fetch });

      await expect(
        gateway.listTracks(createBoundVideo().video),
      ).rejects.toEqual(
        expect.objectContaining({
          code: "CHARGED_CONTENT_UNSUPPORTED",
          retryable: false,
        }),
      );
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("rejects a charged video before any track discovery when entitlement fields are malformed", async () => {
    const gateway = createBilibiliSubtitleGateway({
      fetch: vi.fn().mockResolvedValue(
        jsonResponse({
          code: 0,
          data: {
            is_upower_exclusive: "true",
            need_login_subtitle: false,
            subtitle: { subtitles: [] },
          },
        }),
      ),
    });

    await expect(gateway.listTracks(createBoundVideo().video)).rejects.toEqual(
      expect.objectContaining({ code: "VALIDATION_FAILED", retryable: false }),
    );
  });

  it("returns safe normalized network and malformed-response errors", async () => {
    const secretFailure = new Error(
      "SESSDATA=secret https://aisubtitle.hdslb.com/demo?token=secret",
    );
    const networkGateway = createBilibiliSubtitleGateway({
      fetch: vi.fn().mockRejectedValue(secretFailure),
    });

    await expect(
      networkGateway.listTracks(createBoundVideo().video),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "NETWORK_ERROR",
        message: "Unable to load Bilibili subtitles",
        retryable: true,
      }),
    );

    const malformedGateway = createBilibiliSubtitleGateway({
      fetch: vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    lan: "zh-CN",
                    subtitle_url: "https://aisubtitle.hdslb.com/malformed.json",
                  },
                ],
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            body: [{ content: "坏时间", from: -1, to: 2 }],
          }),
        ),
    });

    await expect(
      malformedGateway.acquire(
        createBoundVideo().video,
        "fallback:official:zh-CN:2606c833",
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        message: "The Bilibili subtitle response is invalid",
        retryable: false,
      }),
    );
  });

  it.each([401, 403, 404, 410])(
    "refreshes an expired signed subtitle URL once (%i)",
    async (status) => {
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    lan: "zh-CN",
                    subtitle_url:
                      "https://aisubtitle.hdslb.com/expired.json?token=expired",
                  },
                ],
              },
            },
          }),
        )
        .mockResolvedValueOnce(jsonResponse({}, status))
        .mockResolvedValueOnce(
          jsonResponse({
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    lan: "zh-CN",
                    subtitle_url:
                      "https://aisubtitle.hdslb.com/refreshed.json?token=fresh",
                  },
                ],
              },
            },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            body: [{ content: "已刷新", from: 0, to: 1 }],
          }),
        );
      const gateway = createBilibiliSubtitleGateway({ fetch });

      await expect(
        gateway.acquire(
          createBoundVideo().video,
          "fallback:official:zh-CN:2606c833",
        ),
      ).resolves.toEqual({
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "已刷新" }],
        trackOrigin: "official-cc",
      });
      expect(fetch).toHaveBeenCalledTimes(4);
    },
  );

  it("keeps content hashes deterministic while assigning a new snapshot ID", async () => {
    const directSubtitle = {
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "相同内容" }],
    } as const;
    const gateway: DirectSubtitleGateway = {
      acquire: vi.fn(async () => directSubtitle),
      listTracks: vi.fn(),
    };
    const ids = ["subtitle-first", "subtitle-second"];
    const acquire = createDirectSubtitleAcquirer({
      createSubtitleId: () => ids.shift() ?? "unexpected-subtitle",
      gateway,
      hashRows: hashSubtitleRows,
      now: () => 2_000,
    });
    const input = { ...createBoundVideo(), trackId: "id:1" };

    const first = await acquire(input);
    const second = await acquire(input);

    expect(first.subtitleId).toBe("subtitle-first");
    expect(second.subtitleId).toBe("subtitle-second");
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.contentHash).toBe(
      "sha256:4c173e46046315a6bf4ff640d0c67a766224e6badd1116a2fa8fe18d9b48cf2e",
    );
    await expect(
      hashSubtitleRows([{ endMs: 1_000, startMs: 0, text: "不同内容" }]),
    ).resolves.toBe(
      "sha256:16982d4702fefd50d136da047744cb2db3899f93426a7e3d4c06e9dc5f1abe16",
    );
  });

  it("rejects a session/video identity mismatch before any network request", async () => {
    const gateway: DirectSubtitleGateway = {
      acquire: vi.fn(),
      listTracks: vi.fn(),
    };
    const acquire = createDirectSubtitleAcquirer({
      createSubtitleId: () => "subtitle-mismatch",
      gateway,
      hashRows: hashSubtitleRows,
      now: () => 2_000,
    });
    const { session } = createBoundVideo();
    const otherVideo = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      cid: 30_000_000_002,
      page: 2,
      title: "其他分 P",
    });

    await expect(
      acquire({ session, trackId: "id:1", video: otherVideo }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "VALIDATION_FAILED",
        message: "The session and subtitle video identities do not match",
      }),
    );
    expect(gateway.acquire).not.toHaveBeenCalled();
  });
});

describe("Bilibili subtitle CDN credentials", () => {
  it("never sends credentials to the wildcard-CORS subtitle CDN", async () => {
    const { video } = createBoundVideo();
    const observed: { readonly credentials: string; readonly url: string }[] =
      [];
    const fetch = vi.fn(
      async (
        requestUrl: string,
        init: { readonly credentials: "include" | "omit" },
      ) => {
        observed.push({ credentials: init.credentials, url: requestUrl });
        if (requestUrl.startsWith("https://api.bilibili.com/")) {
          return jsonResponse({
            code: 0,
            data: {
              subtitle: {
                subtitles: [
                  {
                    id: 1001,
                    lan: "zh-CN",
                    lan_doc: "中文（中国）",
                    subtitle_url: "//i0.hdslb.com/bfs/subtitle/exact.json",
                  },
                ],
              },
            },
          });
        }
        // A credentialed request against a wildcard allow-origin is rejected
        // by the browser before any response is delivered.
        throw new TypeError("Failed to fetch");
      },
    );
    const gateway = createBilibiliSubtitleGateway({ fetch });

    await gateway.listTracks(video);
    await gateway.acquire(video, "id:1001").catch(() => undefined);

    const contentCall = observed.find((call) =>
      call.url.includes("i0.hdslb.com"),
    );
    expect(contentCall).toBeDefined();
    expect(contentCall?.credentials).toBe("omit");
    expect(
      observed
        .filter((call) => call.url.startsWith("https://api.bilibili.com/"))
        .every((call) => call.credentials === "include"),
    ).toBe(true);
  });
});

describe("stale AV id on a stored VideoRef", () => {
  const strangerAid = 999_999;
  const exactAid = 88_000_123;

  function createStaleVideo() {
    // The session stored an AV id that belongs to another video. BVID, page
    // and CID are the identity the user actually chose.
    return createVideoRef({
      aid: strangerAid,
      bvid: "BV1PoRRBNEBb",
      canonicalUrl: "https://www.bilibili.com/video/BV1PoRRBNEBb",
      cid: 30_000_000_555,
      page: 1,
      title: "恐怖游戏实况",
    });
  }

  it("never addresses the stranger video and repairs the identity", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requested.push(url);
      const request = new URL(url);
      if (request.pathname === "/x/web-interface/nav") {
        return jsonResponse({
          code: 0,
          data: {
            wbi_img: {
              img_url:
                "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
              sub_url:
                "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
            },
          },
        });
      }
      if (request.pathname === "/x/player/v2") {
        // The ordinary player reports the track without a usable address.
        return jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                { ai_type: 0, id: 4001, lan: "zh-CN", lan_doc: "中文" },
              ],
            },
          },
        });
      }
      if (request.pathname === "/x/web-interface/wbi/view/detail") {
        return jsonResponse({
          code: 0,
          data: {
            View: {
              aid: exactAid,
              bvid: "BV1PoRRBNEBb",
              pages: [{ cid: 30_000_000_555, page: 1 }],
            },
          },
        });
      }
      if (request.pathname === "/x/player/wbi/v2") {
        return jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  ai_type: 0,
                  id: 4001,
                  lan: "zh-CN",
                  lan_doc: "中文",
                  subtitle_url: "//i0.hdslb.com/bfs/subtitle/exact.json",
                },
              ],
            },
          },
        });
      }
      if (url.includes("i0.hdslb.com")) {
        return jsonResponse({
          body: [{ content: "这才是本视频的字幕", from: 1, to: 2 }],
        });
      }
      return jsonResponse({}, 404);
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });
    const video = createStaleVideo();

    await gateway.listTracks(video);
    await expect(gateway.acquire(video, "id:4001")).resolves.toEqual({
      language: "zh-CN",
      rows: [{ endMs: 2_000, startMs: 1_000, text: "这才是本视频的字幕" }],
      trackOrigin: "official-cc",
    });

    expect(requested.some((url) => url.includes(String(strangerAid)))).toBe(
      false,
    );
    expect(
      requested.some(
        (url) =>
          url.includes("/x/player/wbi/v2") && url.includes(String(exactAid)),
      ),
    ).toBe(true);
  });

  it("fails closed when exact identity lookup is transiently unavailable and never caches a stranger track", async () => {
    const wrongTrackId = "id:4901";
    const exactTrackId = "id:4902";
    const wrongUrl =
      "https://i0.hdslb.com/bfs/subtitle/stranger-transient.json";
    const exactUrl = "https://i0.hdslb.com/bfs/subtitle/exact-after-retry.json";
    const requested: string[] = [];
    let exactDetailAttempts = 0;
    const playerResponse = (id: number, url: string) =>
      jsonResponse({
        code: 0,
        data: {
          need_login_subtitle: false,
          subtitle: {
            subtitles: [
              {
                ai_type: 0,
                id,
                lan: "zh-CN",
                lan_doc: "中文",
                subtitle_url: url,
              },
            ],
          },
        },
      });
    const fetch = vi.fn(async (url: string) => {
      requested.push(url);
      const request = new URL(url);
      if (request.pathname === "/x/web-interface/nav") {
        return jsonResponse({
          code: 0,
          data: {
            wbi_img: {
              img_url:
                "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
              sub_url:
                "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
            },
          },
        });
      }
      if (request.pathname === "/x/web-interface/wbi/view/detail") {
        exactDetailAttempts += 1;
        if (exactDetailAttempts === 1) {
          throw new TypeError("temporary exact-detail failure");
        }
        return jsonResponse({
          code: 0,
          data: {
            View: {
              aid: exactAid,
              bvid: "BV1PoRRBNEBb",
              pages: [{ cid: 30_000_000_555, page: 1 }],
            },
          },
        });
      }

      const exactIdentityIsAvailable = exactDetailAttempts > 1;
      if (
        request.pathname === "/x/player/v2" ||
        request.pathname === "/x/player/wbi/v2"
      ) {
        return exactIdentityIsAvailable
          ? playerResponse(4902, exactUrl)
          : playerResponse(4901, wrongUrl);
      }
      if (request.pathname === "/x/v2/subtitle/web/view") {
        return binaryResponse(
          subtitleWebViewResponse(
            exactIdentityIsAvailable
              ? {
                  id: 4902,
                  language: "zh-CN",
                  name: "中文",
                  url: exactUrl,
                }
              : {
                  id: 4901,
                  language: "zh-CN",
                  name: "中文",
                  url: wrongUrl,
                },
          ),
        );
      }
      if (url === wrongUrl) {
        return jsonResponse({
          body: [{ content: "这是其他视频的合法字幕", from: 1, to: 2 }],
        });
      }
      if (url === exactUrl) {
        return jsonResponse({
          body: [{ content: "重试后才确认的本视频字幕", from: 3, to: 4 }],
        });
      }
      return jsonResponse({}, 404);
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });
    const video = createStaleVideo();

    await expect(gateway.listTracks(video)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      retryable: true,
    });
    expect(requested).not.toContain(wrongUrl);

    await expect(gateway.acquire(video, wrongTrackId)).rejects.toMatchObject({
      code: "SUBTITLE_NOT_FOUND",
    });
    await expect(gateway.acquire(video, exactTrackId)).resolves.toEqual({
      language: "zh-CN",
      rows: [
        {
          endMs: 4_000,
          startMs: 3_000,
          text: "重试后才确认的本视频字幕",
        },
      ],
      trackOrigin: "official-cc",
    });
    expect(requested).not.toContain(wrongUrl);
    expect(exactDetailAttempts).toBe(2);
  });

  it("still refuses when the exact CID does not belong to the video", async () => {
    const fetch = vi.fn(async (url: string) => {
      const request = new URL(url);
      if (request.pathname === "/x/web-interface/nav") {
        return jsonResponse({
          code: 0,
          data: {
            wbi_img: {
              img_url:
                "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
              sub_url:
                "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
            },
          },
        });
      }
      if (request.pathname === "/x/player/v2") {
        return jsonResponse({
          code: 0,
          data: { need_login_subtitle: false, subtitle: { subtitles: [] } },
        });
      }
      if (request.pathname === "/x/web-interface/wbi/view/detail") {
        return jsonResponse({
          code: 0,
          data: {
            View: {
              aid: exactAid,
              bvid: "BV1PoRRBNEBb",
              pages: [{ cid: 11_111_111, page: 1 }],
            },
          },
        });
      }
      return jsonResponse({}, 404);
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    await expect(gateway.listTracks(createStaleVideo())).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("first discovery right after a page opens", () => {
  const navResponse = {
    code: 0,
    data: {
      wbi_img: {
        img_url:
          "https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png",
        sub_url:
          "https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png",
      },
    },
  };

  it("never answers from the unsigned player alone, so a bilingual video is not reported as monolingual", async () => {
    const { video } = createBoundVideo();
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requested.push(url);
      const request = new URL(url);
      if (request.pathname === "/x/web-interface/nav") {
        return jsonResponse(navResponse);
      }
      if (request.pathname === "/x/web-interface/wbi/view/detail") {
        return jsonResponse({
          code: 0,
          data: {
            View: {
              aid: video.aid,
              bvid: video.bvid,
              pages: [{ cid: video.cid, page: 1 }],
            },
          },
        });
      }
      if (request.pathname === "/x/player/v2") {
        // The page context has not settled yet: only the AI Chinese track is
        // listed, and it already carries a usable address.
        return jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  ai_type: 1,
                  id: 5001,
                  lan: "ai-zh",
                  lan_doc: "中文（自动生成）",
                  subtitle_url: "//aisubtitle.hdslb.com/zh.json",
                },
              ],
            },
          },
        });
      }
      if (request.pathname === "/x/player/wbi/v2") {
        return jsonResponse({
          code: 0,
          data: {
            need_login_subtitle: false,
            subtitle: {
              subtitles: [
                {
                  ai_type: 1,
                  id: 5001,
                  lan: "ai-zh",
                  lan_doc: "中文（自动生成）",
                  subtitle_url: "//aisubtitle.hdslb.com/zh.json",
                },
                {
                  ai_type: 0,
                  id: 5002,
                  lan: "en-US",
                  lan_doc: "English",
                  subtitle_url: "//i0.hdslb.com/bfs/subtitle/en.json",
                },
              ],
            },
          },
        });
      }
      return jsonResponse({}, 404);
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    await expect(gateway.listTracks(video)).resolves.toEqual([
      {
        language: "ai-zh",
        name: "中文（自动生成）",
        origin: "ai",
        source: "ai",
        trackId: "id:5001",
      },
      {
        language: "en-US",
        name: "English",
        origin: "official-cc",
        source: "official",
        trackId: "id:5002",
      },
    ]);
    // The identity is confirmed before any track is read.
    const detailIndex = requested.findIndex((url) =>
      url.includes("/x/web-interface/wbi/view/detail"),
    );
    const playerIndex = requested.findIndex((url) =>
      url.includes("/x/player/v2"),
    );
    expect(detailIndex).toBeGreaterThanOrEqual(0);
    expect(detailIndex).toBeLessThan(playerIndex);
  });
});
