import { describe, expect, it } from "vitest";

import {
  BATCH_SOURCE_LABELS,
  BatchSourceError,
  describeBatchSource,
  parseBatchSource,
  parseBatchSourceForKind,
} from "../../src/application/batch-source-contract";

const bvid = "BV1zt4y1z72D";

describe("parseBatchSource", () => {
  it.each([
    {
      expected: { bvid, kind: "single-video", page: 1 },
      label: "a bare BV identifier",
      value: `  ${bvid} `,
    },
    {
      expected: { bvid, kind: "video-pages" },
      label: "a long share URL with an exact part in any query order",
      value: `https://www.bilibili.com/video/${bvid}/?vd_source=x&p=13&spm_id_from=333.788`,
    },
    {
      expected: { bvid, kind: "single-video", page: 1 },
      label: "a bare-domain URL without www",
      value: `https://bilibili.com/video/${bvid}`,
    },
    {
      expected: { bvid, kind: "video-pages" },
      label: "a mobile host URL",
      value: `https://m.bilibili.com/video/${bvid}?p=4`,
    },
    {
      expected: { kind: "user-space", mid: 12_345 },
      label: "a user space home page",
      value: "https://space.bilibili.com/12345",
    },
    {
      expected: { kind: "user-space", mid: 12_345 },
      label: "a user space video tab",
      value: "https://space.bilibili.com/12345/upload/video",
    },
    {
      expected: { kind: "favorites", mediaId: 9_876 },
      label: "a favourites list",
      value: "https://space.bilibili.com/12345/favlist?fid=9876&ftype=create",
    },
    {
      expected: { kind: "favorites", mediaId: 9_876 },
      label: "a favourites playlist page",
      value: "https://www.bilibili.com/medialist/play/ml9876",
    },
    {
      expected: {
        kind: "collection",
        mid: 12_345,
        seasonId: 777,
        series: false,
      },
      label: "a collection detail page",
      value:
        "https://space.bilibili.com/12345/channel/collectiondetail?sid=777&ctype=0",
    },
    {
      expected: {
        kind: "collection",
        mid: 12_345,
        seasonId: 777,
        series: true,
      },
      label: "a series detail page",
      value: "https://space.bilibili.com/12345/channel/seriesdetail?sid=777",
    },
    {
      expected: {
        kind: "collection",
        mid: 12_345,
        seasonId: 777,
        series: false,
      },
      label: "a collection playlist page",
      value: "https://www.bilibili.com/list/12345?sid=777",
    },
    {
      expected: { keyword: "计算机组成原理", kind: "search" },
      label: "a search results page",
      value:
        "https://search.bilibili.com/all?keyword=%E8%AE%A1%E7%AE%97%E6%9C%BA%E7%BB%84%E6%88%90%E5%8E%9F%E7%90%86&from_source=web",
    },
    {
      expected: { keyword: "计算机组成原理", kind: "search" },
      label: "a plain keyword",
      value: "计算机组成原理",
    },
  ])("parses $label", ({ expected, value }) => {
    expect(parseBatchSource(value)).toEqual(expected);
  });

  it("expands a video into its parts when the user asks for all pages", () => {
    expect(
      parseBatchSource(`https://www.bilibili.com/video/${bvid}?p=13`, {
        includeAllPages: true,
      }),
    ).toEqual({ bvid, kind: "video-pages" });
  });

  it("expands a shared P6 URL with timing and source params into the full part listing", () => {
    // 用户实测回归:分享链接 ?p=6&t=183.73&vd_source=... 与规范化后的
    // ?p=6&t=183.73 都必须解析为整个选集(video-pages),而不是单分 P。
    expect(
      parseBatchSource(
        `https://www.bilibili.com/video/${bvid}?p=6&t=183.73&vd_source=abcdef`,
      ),
    ).toEqual({ bvid, kind: "video-pages" });
    expect(
      parseBatchSource(`https://www.bilibili.com/video/${bvid}?p=6&t=183.73`),
    ).toEqual({ bvid, kind: "video-pages" });
  });

  it("automatically treats the user's P4 video URL as one video's part listing", () => {
    expect(
      parseBatchSource("https://www.bilibili.com/video/BV1b7411N798?p=4"),
    ).toEqual({ bvid: "BV1b7411N798", kind: "video-pages" });
  });

  it.each([
    "https://www.bilibili.com/video/BV1invalid",
    "https://space.bilibili.com/12345/favlist",
    "https://space.bilibili.com/12345/channel/collectiondetail",
    "https://search.bilibili.com/all",
    "https://example.com/video/BV1zt4y1z72D",
    `https://www.bilibili.com/video/${bvid}?p=0`,
    `https://www.bilibili.com/video/${bvid}?p=1&p=2`,
    "   ",
  ])("rejects %s", (value) => {
    expect(() => parseBatchSource(value)).toThrow(BatchSourceError);
  });

  it("keeps a user-facing label for every descriptor", () => {
    expect(describeBatchSource(parseBatchSource(bvid))).toContain(bvid);
    expect(
      describeBatchSource(
        parseBatchSource("https://space.bilibili.com/12345/favlist?fid=9876"),
      ),
    ).toBe("收藏夹 9876");
  });

  it("exposes exactly the six frozen source choices without credential fields", () => {
    expect(BATCH_SOURCE_LABELS).toEqual({
      collection: "合集 / 系列（多个视频）",
      favorites: "收藏夹",
      search: "搜索页面",
      "single-video": "单个视频",
      "user-space": "用户主页",
      "video-pages": "视频选集 / 分 P（同一视频）",
    });

    const serialized = JSON.stringify(
      parseBatchSource("https://space.bilibili.com/12345/favlist?fid=9876"),
    ).toLowerCase();
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("authorization");
  });
});

describe("parseBatchSourceForKind single-video", () => {
  it("accepts a part URL and binds the exact part without type guessing", () => {
    expect(
      parseBatchSourceForKind(
        "https://www.bilibili.com/video/BV19E411D78Q?p=3",
        "single-video",
      ),
    ).toEqual({ bvid: "BV19E411D78Q", kind: "single-video", page: 3 });
    expect(
      parseBatchSourceForKind(
        "https://www.bilibili.com/video/BV19E411D78Q/?p=22",
        "single-video",
      ),
    ).toMatchObject({ bvid: "BV19E411D78Q", page: 22 });
  });

  it("accepts a bare BV as P1 and rejects non-video inputs", () => {
    expect(parseBatchSourceForKind("BV19E411D78Q", "single-video")).toEqual({
      bvid: "BV19E411D78Q",
      kind: "single-video",
      page: 1,
    });
    expect(() =>
      parseBatchSourceForKind(
        "https://space.bilibili.com/12345/favlist?fid=9876",
        "single-video",
      ),
    ).toThrow(BatchSourceError);
    expect(() =>
      parseBatchSourceForKind(
        "https://www.bilibili.com/video/BV19E411D78Q?p=abc",
        "single-video",
      ),
    ).toThrow(BatchSourceError);
  });
});
