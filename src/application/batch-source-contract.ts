export const BATCH_SOURCE_KINDS = [
  "single-video",
  "video-pages",
  "collection",
  "favorites",
  "user-space",
  "search",
] as const;

export type BatchSourceKind = (typeof BATCH_SOURCE_KINDS)[number];

export type BatchSourceErrorCode =
  | "VALIDATION_FAILED"
  | "SOURCE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "NETWORK_ERROR";

export class BatchSourceError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: BatchSourceErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "BatchSourceError";
    this.retryable = retryable;
  }
}

export type BatchSourceDescriptor =
  | {
      readonly bvid: string;
      readonly kind: "single-video";
      readonly page: number;
    }
  | { readonly bvid: string; readonly kind: "video-pages" }
  | {
      readonly kind: "collection";
      readonly mid: number;
      readonly seasonId: number;
      readonly series: boolean;
    }
  | { readonly kind: "favorites"; readonly mediaId: number }
  | { readonly kind: "user-space"; readonly mid: number }
  | { readonly keyword: string; readonly kind: "search" };

/**
 * One enumerated source entry. A batch adapter only normalizes identity: the
 * exact `VideoRef` is produced later by the same canonical resolver the single
 * video path uses, so a batch item can never bind a different CID than a
 * manually opened page would.
 */
export interface BatchSourceItem {
  /** Exact archive identity supplied by the source API when available. */
  readonly aid?: number;
  readonly author?: string;
  readonly bvid: string;
  /** Exact part identity supplied by the source API when available. */
  readonly cid?: number;
  /** `null` keeps the product convention of selecting P1. */
  readonly page: number | null;
  /** Unix seconds when supplied by the source API. */
  readonly publishedAt?: number | null;
  readonly title: string;
}

export interface BatchSourceListing {
  readonly descriptor: BatchSourceDescriptor;
  readonly items: readonly BatchSourceItem[];
  readonly title: string;
  readonly total: number;
  readonly truncated: boolean;
}

export interface BatchSourceGateway {
  list(
    descriptor: BatchSourceDescriptor,
    options?: { readonly limit?: number },
  ): Promise<BatchSourceListing>;
}

export const BATCH_SOURCE_LABELS: Readonly<Record<BatchSourceKind, string>> =
  Object.freeze({
    collection: "合集 / 系列（多个视频）",
    favorites: "收藏夹",
    search: "搜索页面",
    "single-video": "单个视频",
    "user-space": "用户主页",
    "video-pages": "视频选集 / 分 P（同一视频）",
  });

const BVID_PATTERN = /^BV[0-9A-Za-z]{10}$/;

function invalid(message: string): BatchSourceError {
  return new BatchSourceError("VALIDATION_FAILED", message);
}

function readPositiveInteger(value: string | null): number | null {
  if (value === null || !/^[1-9]\d{0,17}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readPage(url: URL): number {
  const values = url.searchParams.getAll("p");
  if (values.length === 0) return 1;
  const page = values.length === 1 ? readPositiveInteger(values[0]) : null;
  if (page === null) throw invalid("批量来源的分 P 参数无效。");
  return page;
}

/** `https://space.bilibili.com/1/...` and `.../space/1` both yield `1`. */
function readSpaceMid(url: URL): number | null {
  const segments = url.pathname.split("/").filter((part) => part.length > 0);
  return segments.length === 0 ? null : readPositiveInteger(segments[0]);
}

function normalizeBilibiliHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^m\./, "www.");
}

/**
 * Detects the batch source from a user-pasted URL, BV identifier or search
 * keyword. Long share URLs, missing `www.`, mobile hosts, trailing slashes and
 * arbitrary query order all resolve to the same descriptor.
 */
export function parseBatchSource(
  input: string,
  options: { readonly includeAllPages?: boolean } = {},
): BatchSourceDescriptor {
  const normalized = input.trim();
  if (normalized.length === 0) throw invalid("请输入批量来源地址或关键词。");
  if (BVID_PATTERN.test(normalized)) {
    return options.includeAllPages
      ? Object.freeze({ bvid: normalized, kind: "video-pages" as const })
      : Object.freeze({
          bvid: normalized,
          kind: "single-video" as const,
          page: 1,
        });
  }

  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`,
    );
  } catch {
    return Object.freeze({ keyword: normalized, kind: "search" as const });
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw invalid("批量来源地址无效。");
  }
  if (url.username !== "" || url.password !== "") {
    throw invalid("批量来源地址无效。");
  }
  const host = normalizeBilibiliHost(url);
  if (!host.endsWith("bilibili.com")) {
    if (!normalized.includes("://") && !normalized.includes(".")) {
      return Object.freeze({ keyword: normalized, kind: "search" as const });
    }
    throw invalid("只支持 Bilibili 的视频、主页、收藏夹、合集与搜索地址。");
  }

  if (host === "search.bilibili.com") {
    const keyword = url.searchParams.get("keyword")?.trim() ?? "";
    if (keyword.length === 0) throw invalid("搜索地址缺少关键词。");
    return Object.freeze({ keyword, kind: "search" as const });
  }

  if (host === "space.bilibili.com") {
    const mid = readSpaceMid(url);
    if (mid === null) throw invalid("用户主页地址缺少 UID。");
    const path = url.pathname.toLowerCase();
    if (path.includes("/favlist")) {
      const mediaId = readPositiveInteger(url.searchParams.get("fid"));
      if (mediaId === null) throw invalid("收藏夹地址缺少 fid。");
      return Object.freeze({ kind: "favorites" as const, mediaId });
    }
    if (path.includes("/collectiondetail") || path.includes("/seriesdetail")) {
      const seasonId = readPositiveInteger(url.searchParams.get("sid"));
      if (seasonId === null) throw invalid("合集地址缺少 sid。");
      return Object.freeze({
        kind: "collection" as const,
        mid,
        seasonId,
        series: path.includes("/seriesdetail"),
      });
    }
    return Object.freeze({ kind: "user-space" as const, mid });
  }

  if (host === "www.bilibili.com" || host === "bilibili.com") {
    const listMatch = /^\/list\/(\d+)\/?$/.exec(url.pathname);
    if (listMatch) {
      const mid = readPositiveInteger(listMatch[1]);
      const seasonId = readPositiveInteger(url.searchParams.get("sid"));
      if (mid === null || seasonId === null) {
        throw invalid("合集播放页地址缺少 UID 或 sid。");
      }
      return Object.freeze({
        kind: "collection" as const,
        mid,
        seasonId,
        series: url.searchParams.get("series_type") === "series",
      });
    }
    const mediaListMatch = /^\/medialist\/play\/ml(\d+)\/?$/.exec(url.pathname);
    if (mediaListMatch) {
      const mediaId = readPositiveInteger(mediaListMatch[1]);
      if (mediaId === null) throw invalid("收藏夹播放页地址无效。");
      return Object.freeze({ kind: "favorites" as const, mediaId });
    }
    const videoMatch = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
    if (videoMatch) {
      const bvid = videoMatch[1];
      const page = readPage(url);
      return options.includeAllPages || url.searchParams.has("p")
        ? Object.freeze({ bvid, kind: "video-pages" as const })
        : Object.freeze({
            bvid,
            kind: "single-video" as const,
            page,
          });
    }
  }
  throw invalid("只支持 Bilibili 的视频、主页、收藏夹、合集与搜索地址。");
}

/** Applies the user's explicit source-type choice without guessing across types. */
export function parseBatchSourceForKind(
  input: string,
  kind: BatchSourceKind | "auto",
): BatchSourceDescriptor {
  if (kind === "auto") return parseBatchSource(input);
  if (kind === "single-video") {
    // 单一视频显式接受带分 P 参数的地址：`?p=3` 绑定第 3P，不做类型猜测。
    return parseSingleVideo(input);
  }
  if (kind === "video-pages") {
    const descriptor = parseBatchSource(input, { includeAllPages: true });
    if (descriptor.kind === kind) return descriptor;
  } else {
    const descriptor = parseBatchSource(input);
    if (descriptor.kind === kind) return descriptor;
  }
  throw invalid(`输入内容与所选来源类型“${BATCH_SOURCE_LABELS[kind]}”不一致。`);
}

/** 单一视频解析：裸 BV 或视频页地址（可带 `p`），返回对应分 P 描述符。 */
export function parseSingleVideo(
  input: string,
): Extract<BatchSourceDescriptor, { readonly kind: "single-video" }> {
  const normalized = input.trim();
  if (normalized.length === 0) throw invalid("请输入批量来源地址或关键词。");
  if (BVID_PATTERN.test(normalized)) {
    return Object.freeze({
      bvid: normalized,
      kind: "single-video" as const,
      page: 1,
    });
  }
  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`,
    );
  } catch {
    throw invalid("不是有效的视频地址或 BV 号。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw invalid("不是有效的视频地址或 BV 号。");
  }
  if (url.username !== "" || url.password !== "") {
    throw invalid("不是有效的视频地址或 BV 号。");
  }
  const host = normalizeBilibiliHost(url);
  if (host !== "www.bilibili.com" && host !== "bilibili.com") {
    throw invalid("不是有效的视频地址或 BV 号。");
  }
  const videoMatch = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(url.pathname);
  if (!videoMatch) {
    throw invalid("不是有效的视频地址或 BV 号。");
  }
  return Object.freeze({
    bvid: videoMatch[1],
    kind: "single-video" as const,
    page: readPage(url),
  });
}

export function describeBatchSource(descriptor: BatchSourceDescriptor): string {
  switch (descriptor.kind) {
    case "single-video":
      return `单视频 ${descriptor.bvid}${
        descriptor.page === 1 ? "" : ` · P${descriptor.page}`
      }`;
    case "video-pages":
      return `分 P ${descriptor.bvid}`;
    case "collection":
      return `${descriptor.series ? "系列" : "合集"} ${descriptor.seasonId}`;
    case "favorites":
      return `收藏夹 ${descriptor.mediaId}`;
    case "user-space":
      return `用户主页 ${descriptor.mid}`;
    case "search":
      return `搜索「${descriptor.keyword}」`;
  }
}
