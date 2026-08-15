import {
  BatchSourceError,
  describeBatchSource,
  type BatchSourceDescriptor,
  type BatchSourceGateway,
  type BatchSourceItem,
  type BatchSourceListing,
} from "../application/batch-source-contract";
import {
  createBilibiliWbiUrlSigner,
  type BilibiliWbiParameter,
} from "./bilibili-wbi";

interface JsonResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type BilibiliBatchFetch = (
  url: string,
  init: {
    readonly credentials: "include";
    readonly headers: Readonly<Record<string, string>>;
    readonly method: "GET";
  },
) => Promise<JsonResponse>;

export interface BilibiliBatchSourceGatewayDependencies {
  readonly createRequestNonce?: () => string;
  readonly fetch: BilibiliBatchFetch;
  readonly now?: () => number;
}

const DEFAULT_LIMIT = 300;
const HARD_LIMIT = 1_000;
const PAGE_SIZE = 30;
const FAVORITE_PAGE_SIZE = 20;
const MAX_PAGE_REQUESTS = 40;

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^[1-9]\d{0,17}$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function networkError(): BatchSourceError {
  return new BatchSourceError(
    "NETWORK_ERROR",
    "无法读取 Bilibili 批量来源列表，请稍后重试。",
    true,
  );
}

/** Bilibili search results embed `<em>` highlight markup in titles. */
function plainTitle(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const stripped = value
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
  return stripped.length === 0 ? fallback : stripped.slice(0, 200);
}

function readApiData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw networkError();
  const code = value.code;
  if (code === -403 || code === 62002 || code === -404) {
    throw new BatchSourceError(
      code === -404 ? "SOURCE_NOT_FOUND" : "PERMISSION_DENIED",
      code === -404
        ? "未找到该批量来源，请确认地址是否正确。"
        : "当前账号没有访问该批量来源的权限。",
    );
  }
  if (code === -101 || code === -401) {
    throw new BatchSourceError(
      "PERMISSION_DENIED",
      "该批量来源需要登录 Bilibili，请先在浏览器中登录。",
    );
  }
  if (code !== 0 || !isRecord(value.data)) throw networkError();
  return value.data;
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function itemFromArchive(value: unknown): BatchSourceItem | null {
  if (!isRecord(value)) return null;
  const bvid = value.bvid;
  if (typeof bvid !== "string" || !BVID_PATTERN.test(bvid)) return null;
  const upper = isRecord(value.upper) ? value.upper : null;
  const authorValue = upper?.name ?? value.author ?? value.owner_name;
  const publishedAt =
    positiveInteger(value.pubtime) ??
    positiveInteger(value.pubdate) ??
    positiveInteger(value.created);
  return Object.freeze({
    ...(typeof authorValue === "string" && authorValue.trim().length > 0
      ? { author: plainTitle(authorValue, "") }
      : {}),
    bvid,
    page: null,
    ...(publishedAt === null ? {} : { publishedAt }),
    title: plainTitle(value.title, bvid),
  });
}

function dedupe(items: readonly BatchSourceItem[]): readonly BatchSourceItem[] {
  const seen = new Set<string>();
  return Object.freeze(
    items.filter((item) => {
      const key = `${item.bvid}:${item.page ?? 1}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
}

function listing(
  descriptor: BatchSourceDescriptor,
  items: readonly BatchSourceItem[],
  total: number,
  limit: number,
  title?: string,
): BatchSourceListing {
  const deduped = dedupe(items);
  const bounded = deduped.slice(0, limit);
  return Object.freeze({
    descriptor,
    items: bounded,
    title: title ?? describeBatchSource(descriptor),
    total: Math.max(total, deduped.length),
    truncated: bounded.length < Math.max(total, deduped.length),
  });
}

export function createBilibiliBatchSourceGateway(
  dependencies: BilibiliBatchSourceGatewayDependencies,
): BatchSourceGateway {
  const now = dependencies.now ?? Date.now;
  const signer = createBilibiliWbiUrlSigner({
    allowReferer: (url) =>
      (url.hostname === "space.bilibili.com" ||
        url.hostname === "search.bilibili.com" ||
        url.hostname === "www.bilibili.com") &&
      url.pathname.length <= 128,
    ...(dependencies.createRequestNonce === undefined
      ? {}
      : { createRequestNonce: dependencies.createRequestNonce }),
    fetch: dependencies.fetch,
    now,
  });

  const requestJson = async (
    url: string,
    referer: string,
  ): Promise<unknown> => {
    let response: JsonResponse;
    try {
      response = await dependencies.fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json", Referer: referer },
        method: "GET",
      });
    } catch {
      throw networkError();
    }
    if (!response.ok) {
      if (response.status === 401) {
        throw new BatchSourceError(
          "PERMISSION_DENIED",
          "B 站登录状态已失效，请重新登录后重试。",
        );
      }
      if (response.status === 403) {
        throw new BatchSourceError(
          "PERMISSION_DENIED",
          "当前账号没有访问该批量来源的权限。",
        );
      }
      if (response.status === 404) {
        throw new BatchSourceError(
          "SOURCE_NOT_FOUND",
          "未找到该批量来源，请确认地址是否正确。",
        );
      }
      throw networkError();
    }
    try {
      return await response.json();
    } catch {
      throw networkError();
    }
  };

  const requestSigned = async (
    pathname: string,
    parameters: Readonly<Record<string, BilibiliWbiParameter>>,
    referer: string,
  ): Promise<unknown> => {
    let url: string;
    try {
      url = await signer.sign(pathname, parameters, referer);
    } catch {
      throw networkError();
    }
    return requestJson(url, referer);
  };

  const listVideoPages = async (
    descriptor: Extract<BatchSourceDescriptor, { kind: "video-pages" }>,
    limit: number,
  ): Promise<BatchSourceListing> => {
    const data = readApiData(
      await requestJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(
          descriptor.bvid,
        )}`,
        `https://www.bilibili.com/video/${descriptor.bvid}`,
      ),
    );
    if (typeof data.bvid === "string" && data.bvid !== descriptor.bvid) {
      throw new BatchSourceError(
        "SOURCE_NOT_FOUND",
        "分 P 来源身份与 Bilibili 返回结果不一致。",
      );
    }
    const videoTitle = plainTitle(data.title, descriptor.bvid);
    const aid = positiveInteger(data.aid);
    const owner = isRecord(data.owner) ? data.owner : {};
    const author = plainTitle(owner.name, "");
    const publishedAt =
      positiveInteger(data.pubdate) ?? positiveInteger(data.ctime);
    const pages = readArray(data.pages).flatMap((value): BatchSourceItem[] => {
      if (!isRecord(value)) return [];
      const page = positiveInteger(value.page);
      const cid = positiveInteger(value.cid);
      if (page === null || cid === null) return [];
      return [
        Object.freeze({
          ...(aid === null ? {} : { aid }),
          ...(author.length === 0 ? {} : { author }),
          bvid: descriptor.bvid,
          cid,
          page,
          ...(publishedAt === null ? {} : { publishedAt }),
          title: plainTitle(value.part, `P${page} · ${videoTitle}`),
        }),
      ];
    });
    if (pages.length === 0) {
      throw new BatchSourceError(
        "SOURCE_NOT_FOUND",
        "该视频没有可用的分 P 列表。",
      );
    }
    return listing(descriptor, pages, pages.length, limit, videoTitle);
  };

  const listSingleVideo = async (
    descriptor: Extract<BatchSourceDescriptor, { kind: "single-video" }>,
    limit: number,
  ): Promise<BatchSourceListing> => {
    const data = readApiData(
      await requestJson(
        `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(
          descriptor.bvid,
        )}`,
        `https://www.bilibili.com/video/${descriptor.bvid}${
          descriptor.page === 1 ? "" : `?p=${descriptor.page}`
        }`,
      ),
    );
    if (typeof data.bvid === "string" && data.bvid !== descriptor.bvid) {
      throw new BatchSourceError(
        "SOURCE_NOT_FOUND",
        "单视频来源身份与 Bilibili 返回结果不一致。",
      );
    }
    const page = readArray(data.pages).find(
      (candidate) =>
        isRecord(candidate) &&
        positiveInteger(candidate.page) === descriptor.page,
    );
    if (!isRecord(page)) {
      throw new BatchSourceError(
        "SOURCE_NOT_FOUND",
        "未找到单视频中指定的分 P。",
      );
    }
    const videoTitle = plainTitle(data.title, descriptor.bvid);
    const owner = isRecord(data.owner) ? data.owner : {};
    const author = plainTitle(owner.name, "");
    const publishedAt =
      positiveInteger(data.pubdate) ?? positiveInteger(data.ctime);
    return listing(
      descriptor,
      [
        Object.freeze({
          ...(author.length === 0 ? {} : { author }),
          bvid: descriptor.bvid,
          page: descriptor.page,
          ...(publishedAt === null ? {} : { publishedAt }),
          title: plainTitle(page.part, videoTitle),
        }),
      ],
      1,
      limit,
      videoTitle,
    );
  };

  const listUserSpace = async (
    descriptor: Extract<BatchSourceDescriptor, { kind: "user-space" }>,
    limit: number,
  ): Promise<BatchSourceListing> => {
    const referer = `https://space.bilibili.com/${descriptor.mid}/video`;
    const items: BatchSourceItem[] = [];
    let total = 0;
    for (
      let pageNumber = 1;
      pageNumber <= MAX_PAGE_REQUESTS && items.length < limit;
      pageNumber += 1
    ) {
      const data = readApiData(
        await requestSigned(
          "/x/space/wbi/arc/search",
          {
            index: 1,
            mid: descriptor.mid,
            order: "pubdate",
            platform: "web",
            pn: pageNumber,
            ps: PAGE_SIZE,
          },
          referer,
        ),
      );
      const list = isRecord(data.list) ? data.list : {};
      const batch = readArray(list.vlist).flatMap((value) => {
        const item = itemFromArchive(value);
        return item === null ? [] : [item];
      });
      total =
        positiveInteger(isRecord(data.page) ? data.page.count : null) ?? total;
      items.push(...batch);
      if (batch.length < PAGE_SIZE || items.length >= total) break;
    }
    if (items.length === 0) {
      throw new BatchSourceError(
        "SOURCE_NOT_FOUND",
        "该用户主页没有可批量处理的视频。",
      );
    }
    return listing(descriptor, items, total, limit);
  };

  const listFavorites = async (
    descriptor: Extract<BatchSourceDescriptor, { kind: "favorites" }>,
    limit: number,
  ): Promise<BatchSourceListing> => {
    const referer = `https://www.bilibili.com/medialist/play/ml${descriptor.mediaId}`;
    const items: BatchSourceItem[] = [];
    let total = 0;
    let title: string | undefined;
    for (
      let pageNumber = 1;
      pageNumber <= MAX_PAGE_REQUESTS && items.length < limit;
      pageNumber += 1
    ) {
      const data = readApiData(
        await requestJson(
          `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${
            descriptor.mediaId
          }&pn=${pageNumber}&ps=${FAVORITE_PAGE_SIZE}&keyword=&order=mtime&type=0&tid=0&platform=web`,
          referer,
        ),
      );
      const info = isRecord(data.info) ? data.info : {};
      title ??= plainTitle(info.title, `收藏夹 ${descriptor.mediaId}`);
      total = positiveInteger(info.media_count) ?? total;
      const batch = readArray(data.medias).flatMap((value) => {
        const item = itemFromArchive(value);
        return item === null ? [] : [item];
      });
      items.push(...batch);
      if (data.has_more !== true || batch.length === 0) break;
    }
    if (items.length === 0) {
      throw new BatchSourceError(
        "SOURCE_NOT_FOUND",
        "该收藏夹没有可批量处理的视频。",
      );
    }
    return listing(descriptor, items, total, limit, title);
  };

  const listCollection = async (
    descriptor: Extract<BatchSourceDescriptor, { kind: "collection" }>,
    limit: number,
  ): Promise<BatchSourceListing> => {
    const referer = `https://space.bilibili.com/${descriptor.mid}/channel/${
      descriptor.series ? "seriesdetail" : "collectiondetail"
    }?sid=${descriptor.seasonId}`;
    const items: BatchSourceItem[] = [];
    let total = 0;
    let title: string | undefined;
    for (
      let pageNumber = 1;
      pageNumber <= MAX_PAGE_REQUESTS && items.length < limit;
      pageNumber += 1
    ) {
      const data = readApiData(
        await requestJson(
          descriptor.series
            ? `https://api.bilibili.com/x/series/archives?mid=${
                descriptor.mid
              }&series_id=${descriptor.seasonId}&only_normal=true&sort=desc&pn=${pageNumber}&ps=${PAGE_SIZE}`
            : `https://api.bilibili.com/x/polymer/web-space/seasons_archives_list?mid=${
                descriptor.mid
              }&season_id=${descriptor.seasonId}&sort_reverse=false&page_num=${pageNumber}&page_size=${PAGE_SIZE}`,
          referer,
        ),
      );
      const meta = isRecord(data.meta) ? data.meta : {};
      title ??= plainTitle(meta.name, describeBatchSource(descriptor));
      const page = isRecord(data.page) ? data.page : {};
      total = positiveInteger(page.total) ?? total;
      const batch = readArray(data.archives).flatMap((value) => {
        const item = itemFromArchive(value);
        return item === null ? [] : [item];
      });
      items.push(...batch);
      if (batch.length < PAGE_SIZE || (total > 0 && items.length >= total)) {
        break;
      }
    }
    if (items.length === 0) {
      throw new BatchSourceError(
        "SOURCE_NOT_FOUND",
        "该合集/系列没有可批量处理的视频。",
      );
    }
    return listing(descriptor, items, total, limit, title);
  };

  const listSearch = async (
    descriptor: Extract<BatchSourceDescriptor, { kind: "search" }>,
    limit: number,
  ): Promise<BatchSourceListing> => {
    const referer = `https://search.bilibili.com/all?keyword=${encodeURIComponent(
      descriptor.keyword,
    )}`;
    const items: BatchSourceItem[] = [];
    let total = 0;
    for (
      let pageNumber = 1;
      pageNumber <= MAX_PAGE_REQUESTS && items.length < limit;
      pageNumber += 1
    ) {
      const data = readApiData(
        await requestSigned(
          "/x/web-interface/wbi/search/type",
          {
            keyword: descriptor.keyword,
            page: pageNumber,
            page_size: PAGE_SIZE,
            search_type: "video",
          },
          referer,
        ),
      );
      total = positiveInteger(data.numResults) ?? total;
      const batch = readArray(data.result).flatMap((value) => {
        const item = itemFromArchive(value);
        return item === null ? [] : [item];
      });
      items.push(...batch);
      if (batch.length === 0) break;
      const totalPages = positiveInteger(data.numPages) ?? 1;
      if (pageNumber >= totalPages) break;
    }
    if (items.length === 0) {
      throw new BatchSourceError(
        "SOURCE_NOT_FOUND",
        "没有搜索到可批量处理的视频。",
      );
    }
    return listing(descriptor, items, total, limit);
  };

  return Object.freeze({
    async list(
      descriptor: BatchSourceDescriptor,
      options: { readonly limit?: number } = {},
    ): Promise<BatchSourceListing> {
      const limit = Math.min(
        HARD_LIMIT,
        Math.max(1, options.limit ?? DEFAULT_LIMIT),
      );
      switch (descriptor.kind) {
        case "single-video":
          return listSingleVideo(descriptor, limit);
        case "video-pages":
          return listVideoPages(descriptor, limit);
        case "user-space":
          return listUserSpace(descriptor, limit);
        case "favorites":
          return listFavorites(descriptor, limit);
        case "collection":
          return listCollection(descriptor, limit);
        case "search":
          return listSearch(descriptor, limit);
      }
    },
  });
}
