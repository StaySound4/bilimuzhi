import { describe, expect, it, vi } from "vitest";

import {
  createBilibiliVideoGateway,
  createChromeBilibiliVideoGateway,
} from "../../src/infrastructure/bilibili-video-gateway";

const bvid = "BV1Q541167Qg";

describe("BilibiliVideoGateway", () => {
  it("resolves the current single-part Bilibili page to an exact VideoRef", async () => {
    const getTab = vi.fn(async () => ({
      url: `https://www.bilibili.com/video/${bvid}`,
    }));
    const fetchView = vi.fn(async () => ({
      code: 0,
      data: {
        aid: 88_000_001,
        bvid,
        pages: [{ cid: 30_000_000_001, duration: 125, page: 1 }],
        pic: "https://i0.hdslb.com/bfs/archive/cover.jpg",
        title: "精确视频示例",
      },
    }));
    const gateway = createBilibiliVideoGateway({ fetchView, getTab });

    const video = await gateway.resolve({ kind: "current-tab", tabId: 17 });

    expect(getTab).toHaveBeenCalledWith(17);
    expect(fetchView).toHaveBeenCalledWith({ bvid });
    expect(video).toEqual({
      aid: 88_000_001,
      bvid,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      cid: 30_000_000_001,
      coverUrl: "https://i0.hdslb.com/bfs/archive/cover.jpg",
      durationSec: 125,
      page: 1,
      title: "精确视频示例",
      videoKey: `bvid:${bvid}:cid:30000000001:p:1`,
    });
    expect(Object.isFrozen(video)).toBe(true);
  });

  it("selects the exact current part from multi-part metadata", async () => {
    const gateway = createBilibiliVideoGateway({
      getTab: async () => ({
        url: `https://www.bilibili.com/video/${bvid}?spm_id_from=333.1&p=2`,
      }),
      fetchView: async () => ({
        code: 0,
        data: {
          aid: 88_000_003,
          bvid,
          pages: [
            {
              cid: 30_000_000_011,
              duration: 80,
              page: 1,
              part: "第一讲：准备",
            },
            {
              cid: 30_000_000_012,
              duration: 95,
              page: 2,
              part: "第二讲：加法器",
            },
          ],
          title: " 多分 P 示例 ",
        },
      }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 23 }),
    ).resolves.toMatchObject({
      bvid,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}?p=2`,
      cid: 30_000_000_012,
      durationSec: 95,
      page: 2,
      title: "第二讲：加法器",
      videoKey: `bvid:${bvid}:cid:30000000012:p:2`,
    });
  });

  it("resolves all observed long and short URL forms to the same exact part", async () => {
    const observedBvid = "BV1zt4y1z72D";
    const urls = [
      `https://www.bilibili.com/video/${observedBvid}?vd_source=test&spm_id_from=333.788.videopod.episodes&p=7`,
      `https://www.bilibili.com/video/${observedBvid}/?p=7&vd_source=test`,
      `https://www.bilibili.com/video/${observedBvid}?p=7`,
    ];
    const fetchView = vi.fn(async () => ({
      code: 0,
      data: {
        aid: 88_000_077,
        bvid: observedBvid,
        pages: Array.from({ length: 7 }, (_, index) => ({
          cid: 30_000_000_071 + index,
          duration: 90 + index,
          page: index + 1,
          part: `第 ${index + 1} 集`,
        })),
        title: "多分 P URL 兼容样本",
      },
    }));

    for (const url of urls) {
      const gateway = createBilibiliVideoGateway({
        fetchView,
        getTab: async () => ({ url }),
      });
      await expect(
        gateway.resolve({ kind: "current-tab", tabId: 17 }),
      ).resolves.toMatchObject({
        bvid: observedBvid,
        canonicalUrl: `https://www.bilibili.com/video/${observedBvid}?p=7`,
        cid: 30_000_000_077,
        page: 7,
        videoKey: `bvid:${observedBvid}:cid:30000000077:p:7`,
      });
    }
    expect(fetchView).toHaveBeenCalledTimes(urls.length);
  });

  it("resolves a selected non-first collection episode and its exact non-first part", async () => {
    const episodeBvid = "BV1xx411c7mD";
    const fetchView = vi.fn(async (identity: unknown) => {
      expect(identity).toEqual({ bvid: episodeBvid });
      return {
        code: 0,
        data: {
          aid: 88_000_008,
          bvid: episodeBvid,
          pages: [
            { cid: 30_000_000_081, duration: 80, page: 1 },
            { cid: 30_000_000_082, duration: 95, page: 2 },
          ],
          title: "合集第二集的第二分 P",
        },
      };
    });
    const gateway = createBilibiliVideoGateway({
      fetchView,
      getTab: vi.fn(),
    });

    await expect(
      gateway.resolve({
        bvid: episodeBvid,
        cid: 30_000_000_082,
        kind: "selection",
        page: 2,
      }),
    ).resolves.toMatchObject({
      bvid: episodeBvid,
      cid: 30_000_000_082,
      page: 2,
      videoKey: `bvid:${episodeBvid}:cid:30000000082:p:2`,
    });
    expect(fetchView).toHaveBeenCalledTimes(1);
  });

  it("rejects a selected page/CID mismatch without falling back to the first part", async () => {
    const fetchView = vi.fn(async () => ({
      code: 0,
      data: {
        aid: 88_000_009,
        bvid,
        pages: [
          { cid: 30_000_000_091, duration: 80, page: 1 },
          { cid: 30_000_000_092, duration: 95, page: 2 },
        ],
        title: "不可猜测分 P",
      },
    }));
    const gateway = createBilibiliVideoGateway({
      fetchView,
      getTab: vi.fn(),
    });

    await expect(
      gateway.resolve({
        bvid,
        cid: 30_000_000_091,
        kind: "selection",
        page: 2,
      }),
    ).rejects.toMatchObject({
      code: "VIDEO_NOT_BOUND",
      retryable: false,
    });
    expect(fetchView).toHaveBeenCalledWith({ bvid });
  });

  it("rejects a view response bound to a different BVID", async () => {
    const gateway = createBilibiliVideoGateway({
      getTab: async () => ({
        url: `https://www.bilibili.com/video/${bvid}?p=2`,
      }),
      fetchView: async () => ({
        code: 0,
        data: {
          aid: 88_000_002,
          bvid: "BV1xx411c7mD",
          pages: [{ cid: 30_000_000_002, duration: 90, page: 2 }],
          title: "错误身份",
        },
      }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 18 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
    });
  });

  it("rejects ambiguous page metadata rather than selecting its first duplicate", async () => {
    const gateway = createBilibiliVideoGateway({
      getTab: async () => ({
        url: `https://www.bilibili.com/video/${bvid}?p=2`,
      }),
      fetchView: async () => ({
        code: 0,
        data: {
          aid: 88_000_010,
          bvid,
          pages: [
            { cid: 30_000_000_101, duration: 80, page: 1 },
            { cid: 30_000_000_102, duration: 90, page: 2 },
            { cid: 30_000_000_103, duration: 95, page: 2 },
          ],
          title: "重复分 P",
        },
      }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 30 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
    });
  });

  it("rejects a page part that is absent from Bilibili metadata", async () => {
    const gateway = createBilibiliVideoGateway({
      getTab: async () => ({
        url: `https://www.bilibili.com/video/${bvid}?p=3`,
      }),
      fetchView: async () => ({
        code: 0,
        data: {
          aid: 88_000_004,
          bvid,
          pages: [
            { cid: 30_000_000_021, duration: 80, page: 1 },
            { cid: 30_000_000_022, duration: 95, page: 2 },
          ],
          title: "缺失分 P",
        },
      }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 24 }),
    ).rejects.toMatchObject({
      code: "VIDEO_NOT_BOUND",
      retryable: false,
    });
  });

  it("rejects a current tab that is not a Bilibili video page", async () => {
    const fetchView = vi.fn();
    const gateway = createBilibiliVideoGateway({
      fetchView,
      getTab: async () => ({ url: "https://www.bilibili.com/" }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 19 }),
    ).rejects.toMatchObject({
      code: "VIDEO_NOT_BOUND",
      retryable: false,
    });
    expect(fetchView).not.toHaveBeenCalled();
  });

  it("rejects a lookalike video URL outside Bilibili", async () => {
    const fetchView = vi.fn();
    const gateway = createBilibiliVideoGateway({
      fetchView,
      getTab: async () => ({ url: `https://example.com/video/${bvid}` }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 27 }),
    ).rejects.toMatchObject({ code: "VIDEO_NOT_BOUND" });
    expect(fetchView).not.toHaveBeenCalled();
  });

  it("normalizes a missing current tab without exposing browser errors", async () => {
    const gateway = createBilibiliVideoGateway({
      fetchView: vi.fn(),
      getTab: async () => {
        throw new Error("No tab with id: 25");
      },
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 25 }),
    ).rejects.toMatchObject({
      code: "VIDEO_NOT_BOUND",
      message: "Unable to read the current browser tab",
      retryable: false,
    });
  });

  it("rejects a non-canonical page parameter before requesting metadata", async () => {
    const fetchView = vi.fn();
    const gateway = createBilibiliVideoGateway({
      fetchView,
      getTab: async () => ({
        url: `https://www.bilibili.com/video/${bvid}?p=0`,
      }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 20 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
    });
    expect(fetchView).not.toHaveBeenCalled();
  });

  it("normalizes malformed Bilibili metadata as a validation failure", async () => {
    const gateway = createBilibiliVideoGateway({
      getTab: async () => ({
        url: `https://www.bilibili.com/video/${bvid}`,
      }),
      fetchView: async () => ({
        code: 0,
        data: { bvid, pages: "invalid", title: "损坏响应" },
      }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 21 }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
    });
  });

  it("maps a missing Bilibili video response to VIDEO_NOT_BOUND", async () => {
    const gateway = createBilibiliVideoGateway({
      getTab: async () => ({
        url: `https://www.bilibili.com/video/${bvid}`,
      }),
      fetchView: async () => ({ code: -404, message: "啥都木有" }),
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 28 }),
    ).rejects.toMatchObject({
      code: "VIDEO_NOT_BOUND",
      message: "The current Bilibili video was not found",
      retryable: false,
    });
  });

  it("normalizes metadata transport failures without exposing raw errors", async () => {
    const gateway = createBilibiliVideoGateway({
      getTab: async () => ({
        url: `https://www.bilibili.com/video/${bvid}`,
      }),
      fetchView: async () => {
        throw new Error("request failed: https://signed.invalid/?token=secret");
      },
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 22 }),
    ).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "Unable to load Bilibili video metadata",
      retryable: true,
    });
  });

  it.each([
    {
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      cid: 30_000_000_041,
      label: "a raw BV identifier",
      page: 1,
      value: `  ${bvid}  `,
    },
    {
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      cid: 30_000_000_041,
      label: "a full URL without p",
      page: 1,
      value: `https://www.bilibili.com/video/${bvid}?spm_id_from=333.1`,
    },
    {
      canonicalUrl: `https://www.bilibili.com/video/${bvid}?p=2`,
      cid: 30_000_000_042,
      label: "a full URL with an exact part",
      page: 2,
      value: `https://www.bilibili.com/video/${bvid}/?p=2&spm_id_from=333.1`,
    },
    {
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      cid: 30_000_000_041,
      label: "a share URL without the www host",
      page: 1,
      value: `https://bilibili.com/video/${bvid}`,
    },
    {
      canonicalUrl: `https://www.bilibili.com/video/${bvid}?p=2`,
      cid: 30_000_000_042,
      label: "a mobile host URL with an exact part",
      page: 2,
      value: `https://m.bilibili.com/video/${bvid}?p=2`,
    },
    {
      canonicalUrl: `https://www.bilibili.com/video/${bvid}?p=2`,
      cid: 30_000_000_042,
      label: "a festival page carrying the exact bvid query",
      page: 2,
      value: `https://www.bilibili.com/festival/spring?bvid=${bvid}&p=2`,
    },
  ])(
    "resolves $label without reading a browser tab",
    async ({ canonicalUrl, cid, page, value }) => {
      const getTab = vi.fn();
      const fetchView = vi.fn(async () => ({
        code: 0,
        data: {
          aid: 88_000_006,
          bvid,
          pages: [
            { cid: 30_000_000_041, duration: 60, page: 1 },
            { cid: 30_000_000_042, duration: 90, page: 2 },
          ],
          title: "标识符绑定",
        },
      }));
      const gateway = createBilibiliVideoGateway({ fetchView, getTab });

      await expect(
        gateway.resolve({ kind: "identifier", value }),
      ).resolves.toMatchObject({
        bvid,
        canonicalUrl,
        cid,
        page,
        videoKey: `bvid:${bvid}:cid:${cid}:p:${page}`,
      });
      expect(getTab).not.toHaveBeenCalled();
      expect(fetchView).toHaveBeenCalledWith({ bvid });
    },
  );

  it("resolves an AV identifier through the exact aid view lookup", async () => {
    const fetchView = vi.fn(async () => ({
      code: 0,
      data: {
        aid: 170_001,
        bvid,
        pages: [{ cid: 30_000_000_051, duration: 60, page: 1 }],
        title: "AV 号绑定",
      },
    }));
    const gateway = createBilibiliVideoGateway({ fetchView, getTab: vi.fn() });

    await expect(
      gateway.resolve({ kind: "identifier", value: "av170001" }),
    ).resolves.toMatchObject({
      aid: 170_001,
      bvid,
      canonicalUrl: `https://www.bilibili.com/video/${bvid}`,
      cid: 30_000_000_051,
    });
    expect(fetchView).toHaveBeenCalledWith({ aid: 170_001 });
  });

  it("rejects an AV response bound to a different aid", async () => {
    const gateway = createBilibiliVideoGateway({
      fetchView: async () => ({
        code: 0,
        data: {
          aid: 999,
          bvid,
          pages: [{ cid: 30_000_000_052, duration: 60, page: 1 }],
          title: "错误 aid",
        },
      }),
      getTab: vi.fn(),
    });

    await expect(
      gateway.resolve({ kind: "identifier", value: "av170001" }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it.each([
    "BV1invalid",
    "https://b23.tv/abcd123",
    `http://www.bilibili.com/video/${bvid}`,
    `https://user@www.bilibili.com/video/${bvid}`,
    `https://www.bilibili.com:8443/video/${bvid}`,
    `https://evil.example/video/${bvid}`,
    `https://www.bilibili.com/video/${bvid}/extra`,
    `https://www.bilibili.com/video/${bvid}?p=0`,
    `https://www.bilibili.com/video/${bvid}?p=2&p=1`,
  ])("rejects invalid identifier %s before metadata lookup", async (value) => {
    const fetchView = vi.fn();
    const getTab = vi.fn();
    const gateway = createBilibiliVideoGateway({
      fetchView,
      getTab,
    });

    await expect(
      gateway.resolve({ kind: "identifier", value }),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      retryable: false,
    });
    expect(fetchView).not.toHaveBeenCalled();
    expect(getTab).not.toHaveBeenCalled();
  });

  it.each([
    { bvid: "BV1invalid", cid: 30_000_000_001, page: 1 },
    { bvid, cid: 0, page: 1 },
    { bvid, cid: 30_000_000_001, page: 0 },
  ])(
    "rejects an invalid explicit selected identity before metadata lookup",
    async (selection) => {
      const fetchView = vi.fn();
      const gateway = createBilibiliVideoGateway({
        fetchView,
        getTab: vi.fn(),
      });

      await expect(
        gateway.resolve({ ...selection, kind: "selection" }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", retryable: false });
      expect(fetchView).not.toHaveBeenCalled();
    },
  );

  it("wires Chrome tab lookup to the credentialed Bilibili view endpoint", async () => {
    const get = vi.fn(async () => ({
      url: `https://www.bilibili.com/video/${bvid}`,
    }));
    const json = vi.fn(async () => ({
      code: 0,
      data: {
        aid: 88_000_005,
        bvid,
        pages: [{ cid: 30_000_000_031, duration: 75, page: 1 }],
        title: "浏览器适配器",
      },
    }));
    const fetch = vi.fn(async () => ({ json, ok: true }));
    const gateway = createChromeBilibiliVideoGateway({
      fetch,
      tabs: { get },
    });

    await expect(
      gateway.resolve({ kind: "current-tab", tabId: 26 }),
    ).resolves.toMatchObject({ cid: 30_000_000_031, page: 1 });
    expect(get).toHaveBeenCalledWith(26);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      {
        credentials: "include",
        headers: { Accept: "application/json" },
        method: "GET",
      },
    );
    expect(json).toHaveBeenCalledOnce();
  });
});
