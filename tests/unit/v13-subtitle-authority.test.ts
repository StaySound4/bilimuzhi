import { describe, expect, it, vi } from "vitest";

import { createVideoRef } from "../../src/domain";
import { createBilibiliSubtitleGateway } from "../../src/infrastructure/bilibili-subtitle-gateway";

const diagnosticVideo = createVideoRef({
  aid: 91300001,
  bvid: "BV1tZ4y1Z755",
  canonicalUrl: "https://www.bilibili.com/video/BV1tZ4y1Z755?p=1",
  cid: 71300001,
  page: 1,
  title: "Root 隐藏教程（非敏感测试身份）",
});

const authorityTrack = {
  ai_type: 0,
  id: 713001,
  lan: "zh-CN",
  lan_doc: "中文（权威）",
  subtitle_url: "https://aisubtitle.hdslb.com/v13/root-authority.json",
};

const unrelatedTrack = {
  ai_type: 0,
  id: 813001,
  lan: "en-US",
  lan_doc: "TED - Jane Goodall",
  subtitle_url: "https://aisubtitle.hdslb.com/v13/ted-jane-goodall.json",
};

const authorityRows = {
  body: [
    { content: "隐藏 Root 教程入口", from: 0, to: 1.5 },
    { content: "逐步核对时间点", from: 1.5, to: 3.25 },
    { content: "结束前恢复配置", from: 3.25, to: 5 },
  ],
};

function varint(value: number): number[] {
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
  return [...varint((field << 3) | 2), ...varint(bytes.length), ...bytes];
}

function protobufString(field: number, value: string): number[] {
  return protobufBytes(field, Array.from(new TextEncoder().encode(value)));
}

function subtitleWebViewResponse(track: typeof authorityTrack): Uint8Array {
  const encodedTrack = [
    ...varint(8),
    ...varint(Number(track.id)),
    ...protobufString(3, track.lan),
    ...protobufString(4, track.lan_doc),
    ...protobufString(5, track.subtitle_url),
  ];
  const videoSubtitle = protobufBytes(3, encodedTrack);
  return new Uint8Array(protobufBytes(1, videoSubtitle));
}

function jsonResponse(value: unknown, status = 200) {
  return {
    arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    json: vi.fn(async () => value),
    ok: status >= 200 && status < 300,
    status,
  };
}

function binaryResponse(bytes: Uint8Array, status = 200) {
  return {
    arrayBuffer: vi.fn(async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    ),
    json: vi.fn(async () => {
      throw new Error("binary fixture");
    }),
    ok: status >= 200 && status < 300,
    status,
  };
}

function detailResponse(video = diagnosticVideo) {
  return {
    code: 0,
    data: {
      View: {
        aid: video.aid,
        bvid: video.bvid,
        pages: [{ cid: video.cid, page: video.page }],
      },
    },
  };
}

function playerResponse(tracks: readonly Record<string, unknown>[]) {
  return {
    code: 0,
    data: {
      need_login_subtitle: false,
      subtitle: { subtitles: tracks },
    },
  };
}

type UnsignedRound = "empty" | "unrelated" | "same-id-wrong-url";

function gatewayRound(unsignedRound: UnsignedRound) {
  const requested: string[] = [];
  const unsignedTracks =
    unsignedRound === "empty"
      ? []
      : unsignedRound === "unrelated"
        ? [unrelatedTrack]
        : [
            {
              ...authorityTrack,
              subtitle_url:
                "https://aisubtitle.hdslb.com/v13/ted-jane-goodall.json",
            },
          ];
  const fetch = vi.fn(async (rawUrl: string) => {
    requested.push(rawUrl);
    const url = new URL(rawUrl);
    if (url.hostname === "signed.fixture" && url.pathname === "/detail") {
      return jsonResponse(detailResponse());
    }
    if (url.pathname === "/x/player/v2")
      return jsonResponse(playerResponse(unsignedTracks));
    if (url.hostname === "signed.fixture" && url.pathname === "/player-wbi") {
      return jsonResponse(
        playerResponse([{ ...authorityTrack, subtitle_url: "" }]),
      );
    }
    if (url.pathname === "/x/v2/subtitle/web/view") {
      return binaryResponse(subtitleWebViewResponse(authorityTrack));
    }
    if (rawUrl === authorityTrack.subtitle_url)
      return jsonResponse(authorityRows);
    if (rawUrl.includes("ted-jane-goodall")) {
      return jsonResponse({
        body: [
          { content: "TED Jane Goodall unrelated fixture", from: 0, to: 1 },
        ],
      });
    }
    if (url.pathname.includes("/ai/subtitle/search/stat")) {
      return jsonResponse({ code: 0, data: { subtitle_url: "" } });
    }
    throw new Error(
      `Unexpected non-network fixture URL: ${url.origin}${url.pathname}`,
    );
  });
  const signWbiUrl = vi.fn(async (pathname: string) =>
    pathname.includes("view/detail")
      ? "https://signed.fixture/detail"
      : "https://signed.fixture/player-wbi",
  );
  return {
    gateway: createBilibiliSubtitleGateway({
      fetch: fetch as never,
      signWbiUrl,
    }),
    requested,
  };
}

describe("v13 A8 unsigned player output is diagnostic, never authority", () => {
  it.each<UnsignedRound>(["empty", "unrelated", "same-id-wrong-url"])(
    "keeps the WBI/Web View track authoritative when unsigned round is %s",
    async (round) => {
      const { gateway, requested } = gatewayRound(round);
      const tracks = await gateway.listTracks(diagnosticVideo);

      expect(tracks).toEqual([
        {
          language: "zh-CN",
          name: "中文（权威）",
          source: "official",
          trackId: "id:713001",
        },
      ]);
      const subtitle = await gateway.acquire(diagnosticVideo, "id:713001");
      expect(subtitle.rows.map((row) => row.text)).toEqual([
        "隐藏 Root 教程入口",
        "逐步核对时间点",
        "结束前恢复配置",
      ]);
      expect(
        requested.some((url) => new URL(url).pathname === "/x/player/v2"),
      ).toBe(true);
      expect(requested).toContain("https://signed.fixture/player-wbi");
      expect(
        requested.some(
          (url) => new URL(url).pathname === "/x/v2/subtitle/web/view",
        ),
      ).toBe(true);
      expect(
        requested.filter((url) => url.includes("ted-jane-goodall")),
      ).toHaveLength(0);
    },
  );

  it("isolates authoritative track caches by complete VideoKey even when track ids collide", async () => {
    const otherVideo = createVideoRef({
      aid: 91300002,
      bvid: "BV1vDNo6AEFm",
      canonicalUrl: "https://www.bilibili.com/video/BV1vDNo6AEFm?p=1",
      cid: 71300002,
      page: 1,
      title: "第二个非敏感测试视频",
    });
    const requests: string[] = [];
    const fetch = vi.fn(async (rawUrl: string) => {
      requests.push(rawUrl);
      const url = new URL(rawUrl);
      const isSecond =
        url.searchParams.get("fixture") === "second" ||
        url.searchParams.get("bvid") === otherVideo.bvid;
      const video = isSecond ? otherVideo : diagnosticVideo;
      const track = {
        ...authorityTrack,
        lan_doc: isSecond ? "第二视频权威字幕" : authorityTrack.lan_doc,
        subtitle_url: isSecond
          ? "https://aisubtitle.hdslb.com/v13/second-authority.json"
          : authorityTrack.subtitle_url,
      };
      if (url.pathname === "/detail")
        return jsonResponse(detailResponse(video));
      if (url.pathname === "/x/player/v2")
        return jsonResponse(playerResponse([]));
      if (url.pathname === "/player-wbi")
        return jsonResponse(playerResponse([track]));
      if (rawUrl === authorityTrack.subtitle_url)
        return jsonResponse(authorityRows);
      if (rawUrl.endsWith("second-authority.json")) {
        return jsonResponse({
          body: [{ content: "第二视频唯一锚点", from: 0, to: 1 }],
        });
      }
      throw new Error(`Unexpected fixture URL ${rawUrl}`);
    });
    const gateway = createBilibiliSubtitleGateway({
      fetch: fetch as never,
      signWbiUrl: vi.fn(async (pathname, parameters) => {
        const second =
          parameters.bvid === otherVideo.bvid ||
          parameters.aid === otherVideo.aid;
        return `https://signed.fixture/${pathname.includes("detail") ? "detail" : "player-wbi"}?fixture=${second ? "second" : "first"}`;
      }),
    });

    const firstTracks = await gateway.listTracks(diagnosticVideo);
    const secondTracks = await gateway.listTracks(otherVideo);
    expect(firstTracks[0].name).toBe("中文（权威）");
    expect(secondTracks[0].name).toBe("第二视频权威字幕");
    expect(
      (await gateway.acquire(diagnosticVideo, firstTracks[0].trackId)).rows[0]
        .text,
    ).toBe("隐藏 Root 教程入口");
    expect(
      (await gateway.acquire(otherVideo, secondTracks[0].trackId)).rows[0].text,
    ).toBe("第二视频唯一锚点");
  });

  it("fails closed before caching when the signed owner or same-id metadata conflicts", async () => {
    const fetch = vi.fn(async (rawUrl: string) => {
      const url = new URL(rawUrl);
      if (url.pathname === "/detail") return jsonResponse(detailResponse());
      if (url.pathname === "/x/player/v2")
        return jsonResponse(playerResponse([]));
      if (url.pathname === "/player-wbi") {
        return jsonResponse(
          playerResponse([
            {
              ...authorityTrack,
              lan: "en-US",
              lan_doc: "签名来源冲突轨道",
              subtitle_url: "",
            },
          ]),
        );
      }
      if (url.pathname === "/x/v2/subtitle/web/view") {
        return binaryResponse(subtitleWebViewResponse(authorityTrack));
      }
      throw new Error(`Unexpected fixture URL ${rawUrl}`);
    });
    const gateway = createBilibiliSubtitleGateway({
      fetch: fetch as never,
      signWbiUrl: vi.fn(
        async (pathname) =>
          `https://signed.fixture/${pathname.includes("detail") ? "detail" : "player-wbi"}`,
      ),
    });

    await expect(gateway.listTracks(diagnosticVideo)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
    });
    expect(
      fetch.mock.calls.some(([url]) =>
        String(url).includes("root-authority.json"),
      ),
    ).toBe(false);
  });

  it("rejects a signed detail owner mismatch before any player or subtitle request", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          View: {
            aid: diagnosticVideo.aid,
            bvid: "BV1vDNo6AEFm",
            pages: [{ cid: diagnosticVideo.cid, page: diagnosticVideo.page }],
          },
        },
      }),
    );
    const gateway = createBilibiliSubtitleGateway({
      fetch: fetch as never,
      signWbiUrl: vi.fn(async () => "https://signed.fixture/detail"),
    });

    await expect(gateway.listTracks(diagnosticVideo)).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
