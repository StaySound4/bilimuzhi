import { describe, expect, it, vi } from "vitest";

import {
  parseBatchSource,
  type BatchSourceDescriptor,
} from "../../src/application/batch-source-contract";
import { createBilibiliBatchSourceGateway } from "../../src/infrastructure/bilibili-batch-sources";

const bvid = "BV1zt4y1z72D";
const otherBvid = "BV1xx411c7mD";

const NAV_RESPONSE = {
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

function jsonResponse(value: unknown) {
  return { json: async () => value, ok: true, status: 200 };
}

const SOURCE_FAILURE_CASES: readonly {
  readonly descriptor: BatchSourceDescriptor;
  readonly emptyData: Readonly<Record<string, unknown>>;
  readonly label: string;
}[] = [
  {
    descriptor: { bvid, kind: "single-video", page: 1 },
    emptyData: { pages: [] },
    label: "single video",
  },
  {
    descriptor: { bvid, kind: "video-pages" },
    emptyData: { pages: [] },
    label: "video pages",
  },
  {
    descriptor: { kind: "user-space", mid: 12345 },
    emptyData: { list: { vlist: [] }, page: { count: 0 } },
    label: "user space",
  },
  {
    descriptor: { kind: "favorites", mediaId: 9876 },
    emptyData: { has_more: false, medias: [] },
    label: "favorites",
  },
  {
    descriptor: {
      kind: "collection",
      mid: 12345,
      seasonId: 777,
      series: false,
    },
    emptyData: { archives: [], page: { total: 0 } },
    label: "collection",
  },
  {
    descriptor: { keyword: "组成原理", kind: "search" },
    emptyData: { numPages: 1, numResults: 0, result: [] },
    label: "search",
  },
];

function sourceResponse(
  url: string,
  value: unknown,
  options: { readonly ok?: boolean; readonly status?: number } = {},
) {
  if (url.includes("/x/web-interface/nav")) return jsonResponse(NAV_RESPONSE);
  return {
    json: async () => value,
    ok: options.ok ?? true,
    status: options.status ?? 200,
  };
}

describe("BilibiliBatchSourceGateway", () => {
  it.each(SOURCE_FAILURE_CASES)(
    "maps an empty $label result without inventing batch rows",
    async ({ descriptor, emptyData }) => {
      const gateway = createBilibiliBatchSourceGateway({
        fetch: vi.fn(async (url: string) =>
          sourceResponse(url, { code: 0, data: emptyData }),
        ),
        now: () => 1_700_000_000_000,
      });

      await expect(gateway.list(descriptor)).rejects.toMatchObject({
        code: "SOURCE_NOT_FOUND",
      });
    },
  );

  it.each(SOURCE_FAILURE_CASES)(
    "maps a malformed $label response to a retryable network failure",
    async ({ descriptor }) => {
      const gateway = createBilibiliBatchSourceGateway({
        fetch: vi.fn(async (url: string) =>
          sourceResponse(url, { code: 0, data: null }),
        ),
        now: () => 1_700_000_000_000,
      });

      await expect(gateway.list(descriptor)).rejects.toMatchObject({
        code: "NETWORK_ERROR",
        retryable: true,
      });
    },
  );

  it.each(SOURCE_FAILURE_CASES)(
    "maps a $label transport rejection to a retryable network failure",
    async ({ descriptor }) => {
      const gateway = createBilibiliBatchSourceGateway({
        fetch: vi.fn(async () => {
          throw new Error("offline");
        }),
        now: () => 1_700_000_000_000,
      });

      await expect(gateway.list(descriptor)).rejects.toMatchObject({
        code: "NETWORK_ERROR",
        retryable: true,
      });
    },
  );

  it.each(SOURCE_FAILURE_CASES)(
    "maps a $label HTTP permission response without treating it as empty",
    async ({ descriptor }) => {
      const gateway = createBilibiliBatchSourceGateway({
        fetch: vi.fn(async (url: string) =>
          sourceResponse(url, null, { ok: false, status: 403 }),
        ),
        now: () => 1_700_000_000_000,
      });

      await expect(gateway.list(descriptor)).rejects.toMatchObject({
        code: "PERMISSION_DENIED",
        retryable: false,
      });
    },
  );

  it("loads table metadata for the exact selected part of a single video", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          aid: 88_000_001,
          bvid,
          owner: { name: "单视频作者" },
          pages: [
            { cid: 101, page: 1, part: "第一讲" },
            { cid: 113, page: 13, part: "第十三讲" },
          ],
          pubdate: 1_700_000_000,
          title: "单视频课程",
        },
      }),
    );
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    const listing = await gateway.list({
      bvid,
      kind: "single-video",
      page: 13,
    });

    expect(listing.items).toEqual([
      {
        author: "单视频作者",
        bvid,
        page: 13,
        publishedAt: 1_700_000_000,
        title: "第十三讲",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("enumerates P1, P4 and P104 with their distinct exact AID and CID identities", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          aid: 88_000_104,
          pages: [
            { cid: 30_000_000_001, page: 1, part: "第一讲" },
            { cid: 30_000_000_004, page: 4, part: "第四讲" },
            { cid: 30_000_000_104, page: 104, part: "第一百零四讲" },
          ],
          title: "多分 P 课程",
        },
      }),
    );
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    const listing = await gateway.list(
      parseBatchSource(bvid, { includeAllPages: true }),
    );

    expect(listing.title).toBe("多分 P 课程");
    expect(listing.items).toEqual([
      {
        aid: 88_000_104,
        bvid,
        cid: 30_000_000_001,
        page: 1,
        title: "第一讲",
      },
      {
        aid: 88_000_104,
        bvid,
        cid: 30_000_000_004,
        page: 4,
        title: "第四讲",
      },
      {
        aid: 88_000_104,
        bvid,
        cid: 30_000_000_104,
        page: 104,
        title: "第一百零四讲",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`,
      expect.objectContaining({ credentials: "include", method: "GET" }),
    );
  });

  it("pages through a favourites list and stops when has_more is false", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toContain("/x/v3/fav/resource/list");
      const page = new URL(url).searchParams.get("pn");
      return jsonResponse({
        code: 0,
        data: {
          has_more: page === "1",
          info: { media_count: 3, title: "我的收藏" },
          medias:
            page === "1"
              ? [
                  { bvid, id: 1, title: "第一个" },
                  { bvid: otherBvid, id: 2, title: "第二个" },
                ]
              : [{ bvid: "BV1aa411c7mD", id: 3, title: "第三个" }],
        },
      });
    });
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    const listing = await gateway.list(
      parseBatchSource("https://space.bilibili.com/1/favlist?fid=9876"),
    );

    expect(listing.title).toBe("我的收藏");
    expect(listing.total).toBe(3);
    expect(listing.items.map((item) => item.bvid)).toEqual([
      bvid,
      otherBvid,
      "BV1aa411c7mD",
    ]);
  });

  it("keeps only table metadata from a remote item and never exposes Cookie material", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      void url;
      void init;
      return jsonResponse({
        code: 0,
        data: {
          has_more: false,
          info: { media_count: 1, title: "课程收藏" },
          medias: [
            {
              bvid,
              id: 1,
              intro: "不属于批量表格的供应商原始字段",
              pubtime: 1_700_000_000,
              title: "第一讲",
              upper: { mid: 12345, name: "讲师" },
            },
          ],
        },
      });
    });
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    const listing = await gateway.list(
      parseBatchSource("https://space.bilibili.com/1/favlist?fid=9876"),
    );

    expect(listing.items).toEqual([
      {
        author: "讲师",
        bvid,
        page: null,
        publishedAt: 1_700_000_000,
        title: "第一讲",
      },
    ]);
    const serialized = JSON.stringify(listing).toLowerCase();
    expect(serialized).not.toContain("cookie");
    expect(serialized).not.toContain("intro");
    const init = fetch.mock.calls[0]?.[1] as
      { readonly headers?: Record<string, string> } | undefined;
    expect(
      Object.keys(init?.headers ?? {}).some(
        (name) => name.toLowerCase() === "cookie",
      ),
    ).toBe(false);
  });

  it("signs the user space listing and keeps only well-formed archives", async () => {
    const requested: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      requested.push(url);
      if (url.includes("/x/web-interface/nav")) {
        return jsonResponse(NAV_RESPONSE);
      }
      return jsonResponse({
        code: 0,
        data: {
          list: {
            vlist: [
              { bvid, title: "第一个投稿" },
              { bvid: "not-a-bvid", title: "损坏条目" },
            ],
          },
          page: { count: 1 },
        },
      });
    });
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    const listing = await gateway.list(
      parseBatchSource("https://space.bilibili.com/12345"),
    );

    expect(listing.items).toEqual([{ bvid, page: null, title: "第一个投稿" }]);
    const signed = requested.find((url) =>
      url.includes("/x/space/wbi/arc/search"),
    );
    expect(signed).toBeDefined();
    expect(signed).toContain("w_rid=");
    expect(signed).toContain("mid=12345");
  });

  it("strips search highlight markup from titles", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/x/web-interface/nav")) {
        return jsonResponse(NAV_RESPONSE);
      }
      return jsonResponse({
        code: 0,
        data: {
          numPages: 1,
          numResults: 1,
          result: [
            {
              bvid,
              title: '<em class="keyword">组成</em>原理 &amp; 实践',
            },
          ],
        },
      });
    });
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    const listing = await gateway.list(parseBatchSource("组成原理"));

    expect(listing.items).toEqual([
      { bvid, page: null, title: "组成原理 & 实践" },
    ]);
  });

  it("reads a collection listing and reports the declared total", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toContain("seasons_archives_list");
      return jsonResponse({
        code: 0,
        data: {
          archives: [
            { bvid, title: "EP1" },
            { bvid: otherBvid, title: "EP2" },
          ],
          meta: { name: "算法合集" },
          page: { total: 2 },
        },
      });
    });
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    const listing = await gateway.list(
      parseBatchSource(
        "https://space.bilibili.com/12345/channel/collectiondetail?sid=777",
      ),
    );

    expect(listing.title).toBe("算法合集");
    expect(listing.total).toBe(2);
    expect(listing.truncated).toBe(false);
  });

  it("maps a login-required listing to a stable permission failure", async () => {
    const fetch = vi.fn(async () => jsonResponse({ code: -101 }));
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    await expect(
      gateway.list(
        parseBatchSource("https://space.bilibili.com/1/favlist?fid=9876"),
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("caps the listing at the requested limit and marks it truncated", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        code: 0,
        data: {
          pages: Array.from({ length: 5 }, (_, index) => ({
            cid: index + 1,
            page: index + 1,
            part: `P${index + 1}`,
          })),
          title: "长课程",
        },
      }),
    );
    const gateway = createBilibiliBatchSourceGateway({
      fetch,
      now: () => 1_700_000_000_000,
    });

    const listing = await gateway.list(
      parseBatchSource(bvid, { includeAllPages: true }),
      { limit: 2 },
    );

    expect(listing.items).toHaveLength(2);
    expect(listing.total).toBe(5);
    expect(listing.truncated).toBe(true);
  });
});
