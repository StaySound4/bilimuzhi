import type {
  CanonicalVideoResolveInput,
  CanonicalVideoResolver,
  VideoGateway,
} from "../application/video-gateway";
import { VideoGatewayError } from "../application/video-gateway";
import { createVideoRef, type VideoRef } from "../domain";

interface BrowserTab {
  readonly url?: string;
}

interface BilibiliVideoGatewayDependencies {
  readonly getTab: (tabId: number) => Promise<BrowserTab>;
  readonly fetchView: (
    identity: { readonly aid: number } | { readonly bvid: string },
  ) => Promise<unknown>;
}

interface ChromeTabsApi {
  readonly get: (tabId: number) => Promise<BrowserTab>;
}

interface JsonResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

interface ChromeBilibiliVideoGatewayDependencies {
  readonly fetch: (
    url: string,
    init: {
      credentials: "include";
      headers: { Accept: "application/json" };
      method: "GET";
    },
  ) => Promise<JsonResponse>;
  readonly tabs: ChromeTabsApi;
}

interface BilibiliPage {
  readonly cid: number;
  readonly duration: number;
  readonly page: number;
  readonly part?: string;
}

interface BilibiliView {
  readonly aid: number;
  readonly bvid: string;
  readonly pages: BilibiliPage[];
  readonly pic?: string;
  readonly title: string;
}

const BVID_PATH_PATTERN = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/;
const AVID_PATH_PATTERN = /^\/video\/[Aa][Vv]([1-9]\d{0,15})\/?$/;
const BVID_IDENTIFIER_PATTERN = /^BV[0-9A-Za-z]{10}$/;
const AVID_IDENTIFIER_PATTERN = /^[Aa][Vv]([1-9]\d{0,15})$/;

/**
 * Hosts that address the very same video page. Bilibili serves the desktop,
 * bare-domain and mobile hosts interchangeably, and a pasted share link often
 * uses one of the latter two.
 */
const VIDEO_HOSTS = new Set([
  "www.bilibili.com",
  "bilibili.com",
  "m.bilibili.com",
]);

interface BilibiliVideoLocation {
  readonly aid?: number;
  readonly bvid?: string;
  readonly expectedCid?: number;
  readonly page: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function invalidViewResponse(): VideoGatewayError {
  return new VideoGatewayError(
    "VALIDATION_FAILED",
    "The Bilibili video response is invalid",
  );
}

function readView(response: unknown): BilibiliView {
  if (!isRecord(response)) {
    throw invalidViewResponse();
  }
  if (response.code === -404) {
    throw new VideoGatewayError(
      "VIDEO_NOT_BOUND",
      "The current Bilibili video was not found",
    );
  }
  if (response.code !== 0 || !isRecord(response.data)) {
    throw invalidViewResponse();
  }

  const data = response.data;
  if (
    !isPositiveSafeInteger(data.aid) ||
    typeof data.bvid !== "string" ||
    typeof data.title !== "string" ||
    data.title.trim().length === 0 ||
    !Array.isArray(data.pages) ||
    (data.pic !== undefined &&
      (typeof data.pic !== "string" || data.pic.trim().length === 0))
  ) {
    throw invalidViewResponse();
  }

  const pages = data.pages.map((value): BilibiliPage => {
    if (
      !isRecord(value) ||
      !isPositiveSafeInteger(value.cid) ||
      !isPositiveSafeInteger(value.page) ||
      !isPositiveFiniteNumber(value.duration) ||
      (value.part !== undefined &&
        (typeof value.part !== "string" || value.part.trim().length === 0))
    ) {
      throw invalidViewResponse();
    }
    return {
      cid: value.cid,
      duration: value.duration,
      page: value.page,
      ...(value.part === undefined ? {} : { part: value.part.trim() }),
    };
  });
  if (
    new Set(pages.map((page) => page.page)).size !== pages.length ||
    new Set(pages.map((page) => page.cid)).size !== pages.length
  ) {
    throw invalidViewResponse();
  }

  return {
    aid: data.aid,
    bvid: data.bvid,
    pages,
    ...(data.pic === undefined ? {} : { pic: data.pic }),
    title: data.title,
  };
}

function readPage(url: URL, errorMessage: string): number {
  const values = url.searchParams.getAll("p");
  if (values.length === 0) {
    return 1;
  }
  const value = values[0];
  if (!/^[1-9]\d*$/.test(value)) {
    throw new VideoGatewayError("VALIDATION_FAILED", errorMessage);
  }
  const page = Number(value);
  if (values.length !== 1 || !Number.isSafeInteger(page)) {
    throw new VideoGatewayError("VALIDATION_FAILED", errorMessage);
  }
  return page;
}

function readBilibiliVideoUrl(
  url: URL,
  invalidUrlMessage: string,
  invalidPageMessage: string,
): BilibiliVideoLocation {
  if (
    url.protocol !== "https:" ||
    !VIDEO_HOSTS.has(url.hostname.toLowerCase()) ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new VideoGatewayError("VIDEO_NOT_BOUND", invalidUrlMessage);
  }
  const bvidMatch = BVID_PATH_PATTERN.exec(url.pathname);
  if (bvidMatch) {
    return Object.freeze({
      bvid: bvidMatch[1],
      page: readPage(url, invalidPageMessage),
    });
  }
  const avidMatch = AVID_PATH_PATTERN.exec(url.pathname);
  if (avidMatch) {
    const aid = Number(avidMatch[1]);
    if (!Number.isSafeInteger(aid) || aid <= 0) {
      throw new VideoGatewayError("VIDEO_NOT_BOUND", invalidUrlMessage);
    }
    return Object.freeze({ aid, page: readPage(url, invalidPageMessage) });
  }
  // Festival, watch-later and playlist pages carry the exact video in `bvid`.
  const queryBvid = url.searchParams.get("bvid");
  if (queryBvid !== null && BVID_IDENTIFIER_PATTERN.test(queryBvid)) {
    return Object.freeze({
      bvid: queryBvid,
      page: readPage(url, invalidPageMessage),
    });
  }
  throw new VideoGatewayError("VIDEO_NOT_BOUND", invalidUrlMessage);
}

function readIdentifier(value: string): BilibiliVideoLocation {
  const normalized = value.trim();
  if (BVID_IDENTIFIER_PATTERN.test(normalized)) {
    return Object.freeze({ bvid: normalized, page: 1 });
  }
  const avidMatch = AVID_IDENTIFIER_PATTERN.exec(normalized);
  if (avidMatch) {
    const aid = Number(avidMatch[1]);
    if (Number.isSafeInteger(aid) && aid > 0) {
      return Object.freeze({ aid, page: 1 });
    }
  }

  let url: URL;
  try {
    url = new URL(
      /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`,
    );
  } catch {
    throw new VideoGatewayError(
      "VALIDATION_FAILED",
      "The Bilibili video identifier is invalid",
    );
  }
  if (url.hostname.toLowerCase() === "b23.tv") {
    throw new VideoGatewayError(
      "VALIDATION_FAILED",
      "b23.tv short links must be opened once so the exact video URL is known",
    );
  }
  try {
    return readBilibiliVideoUrl(
      url,
      "The Bilibili video identifier is invalid",
      "The Bilibili video identifier page parameter is invalid",
    );
  } catch (error) {
    if (error instanceof VideoGatewayError) {
      throw new VideoGatewayError("VALIDATION_FAILED", error.message);
    }
    throw error;
  }
}

function readSelection(
  input: Extract<CanonicalVideoResolveInput, { kind: "selection" }>,
): BilibiliVideoLocation {
  if (
    !BVID_IDENTIFIER_PATTERN.test(input.bvid) ||
    !isPositiveSafeInteger(input.cid) ||
    !isPositiveSafeInteger(input.page)
  ) {
    throw new VideoGatewayError(
      "VALIDATION_FAILED",
      "The selected Bilibili video identity is invalid",
    );
  }
  return Object.freeze({
    bvid: input.bvid,
    expectedCid: input.cid,
    page: input.page,
  });
}

class BilibiliVideoGateway implements CanonicalVideoResolver {
  constructor(
    private readonly dependencies: BilibiliVideoGatewayDependencies,
  ) {}

  async resolve(input: CanonicalVideoResolveInput): Promise<VideoRef> {
    let location: BilibiliVideoLocation;
    if (input.kind === "identifier") {
      location = readIdentifier(input.value);
    } else if (input.kind === "selection") {
      location = readSelection(input);
    } else {
      let tab: BrowserTab;
      try {
        tab = await this.dependencies.getTab(input.tabId);
      } catch {
        throw new VideoGatewayError(
          "VIDEO_NOT_BOUND",
          "Unable to read the current browser tab",
        );
      }
      let url: URL;
      try {
        url = new URL(tab.url ?? "");
      } catch {
        throw new VideoGatewayError(
          "VIDEO_NOT_BOUND",
          "The current tab is not a Bilibili video page",
        );
      }
      location = readBilibiliVideoUrl(
        url,
        "The current tab is not a Bilibili video page",
        "The current video page parameter is invalid",
      );
    }

    const { aid, bvid, expectedCid, page } = location;
    let response: unknown;
    try {
      response = await this.dependencies.fetchView(
        bvid === undefined ? { aid: aid! } : { bvid },
      );
    } catch {
      throw new VideoGatewayError(
        "NETWORK_ERROR",
        "Unable to load Bilibili video metadata",
        true,
      );
    }
    const view = readView(response);
    if (
      (bvid !== undefined && view.bvid !== bvid) ||
      (aid !== undefined && view.aid !== aid)
    ) {
      throw new VideoGatewayError(
        "VALIDATION_FAILED",
        "The current page and video response identify different videos",
      );
    }
    const selectedPage = view.pages.find(
      (candidate) => candidate.page === page,
    );
    if (
      !selectedPage ||
      (expectedCid !== undefined && selectedPage.cid !== expectedCid)
    ) {
      throw new VideoGatewayError(
        "VIDEO_NOT_BOUND",
        "The selected Bilibili video part was not found",
      );
    }

    return createVideoRef({
      aid: view.aid,
      bvid: view.bvid,
      canonicalUrl: `https://www.bilibili.com/video/${view.bvid}${
        page === 1 ? "" : `?p=${page}`
      }`,
      cid: selectedPage.cid,
      coverUrl: view.pic,
      durationSec: selectedPage.duration,
      page,
      title:
        view.pages.length === 1
          ? view.title
          : (selectedPage.part ?? `P${page} · ${view.title}`),
    });
  }
}

export function createBilibiliVideoGateway(
  dependencies: BilibiliVideoGatewayDependencies,
): CanonicalVideoResolver & VideoGateway {
  return new BilibiliVideoGateway(dependencies);
}

export function createChromeBilibiliVideoGateway(
  dependencies: ChromeBilibiliVideoGatewayDependencies,
): CanonicalVideoResolver & VideoGateway {
  return createBilibiliVideoGateway({
    getTab: (tabId) => dependencies.tabs.get(tabId),
    fetchView: async (identity) => {
      const query =
        "bvid" in identity
          ? `bvid=${encodeURIComponent(identity.bvid)}`
          : `aid=${identity.aid}`;
      const response = await dependencies.fetch(
        `https://api.bilibili.com/x/web-interface/view?${query}`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
          method: "GET",
        },
      );
      if (!response.ok) {
        throw new Error("Bilibili view request failed");
      }
      return response.json();
    },
  });
}
