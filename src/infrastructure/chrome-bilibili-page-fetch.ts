import { parseBilibiliPageIdentity } from "./bilibili-page-identity";
import { createBilibiliCookieAuthorizedFetch } from "./bilibili-cookie-authorized-fetch";

interface PageFetchResponse {
  readonly authorizationContext?: "off-page" | "page";
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

interface ChromeBilibiliCookieChange {
  readonly cookie?: {
    readonly domain?: unknown;
  };
}

export interface ExactPageRequestOwner {
  readonly aid: number;
  readonly bvid: string;
  readonly cid: number;
  readonly page: number;
  readonly pageRevision: number;
  readonly requestOwner: string;
  readonly trackId: string;
  readonly videoKey?: string;
}
export type PageFetchCredentials = "include" | "omit";

interface PageFetchInit {
  /**
   * "include" is only correct for api.bilibili.com, which answers with an
   * exact allow-origin plus allow-credentials. The *.hdslb.com and
   * *.bilivideo.com CDNs answer with a wildcard allow-origin, which the
   * browser rejects for a credentialed cross-origin request, so subtitle and
   * media asset downloads must use "omit".
   */
  readonly credentials: PageFetchCredentials;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET";
  /** Exact immutable owner captured by the acquisition coordinator. */
  readonly owner?: ExactPageRequestOwner;
  readonly signal?: AbortSignal;
}

export type ChromeBilibiliPageFetch = (
  url: string,
  init: PageFetchInit,
) => Promise<PageFetchResponse>;

interface ChromeBilibiliPageFetchDependencies {
  readonly scripting: {
    executeScript(injection: {
      readonly args: readonly [
        string,
        string,
        boolean,
        string,
        number,
        PageFetchCredentials,
      ];
      readonly func: (
        url: string,
        accept: string,
        binary: boolean,
        expectedBvid: string,
        expectedPage: number,
        credentials: PageFetchCredentials,
      ) => Promise<unknown>;
      readonly target: { readonly tabId: number };
      readonly world: "MAIN";
    }): Promise<unknown>;
  };
  readonly tabs: {
    query(queryInfo: {
      readonly active?: boolean;
      readonly currentWindow?: boolean;
      readonly lastFocusedWindow?: boolean;
      readonly url?: string | readonly string[];
    }): Promise<unknown>;
  };
}

interface ChromeBilibiliPageFetchOptions {
  readonly timeoutMs?: number;
}

const PAGE_FETCH_MARKER = "muzhi.bilibili.page-fetch.v1";
const MAX_BINARY_BYTES = 16 * 1_024 * 1_024;

const ALLOWED_API_PATHS = new Set([
  "/x/player/v2",
  "/x/player/wbi/v2",
  "/x/player/v2/ai/subtitle/search/stat",
  "/x/player/playurl",
  "/x/v2/subtitle/web/view",
  "/x/web-interface/nav",
  "/x/web-interface/view",
  "/x/web-interface/wbi/view/detail",
  "/x/space/wbi/arc/search",
  "/x/v3/fav/resource/list",
  "/x/series/archives",
  "/x/polymer/web-space/seasons_archives_list",
  "/x/web-interface/wbi/search/type",
]);

const ALLOWED_ACCEPT = new Set([
  "application/json",
  "application/json, */*",
  "application/json, text/plain, */*",
  "application/x-protobuf, application/octet-stream, */*",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBilibiliCookieChange(change: ChromeBilibiliCookieChange): boolean {
  const domain = change.cookie?.domain;
  if (typeof domain !== "string") return false;
  const normalized = domain.trim().toLowerCase().replace(/^\./, "");
  return normalized === "bilibili.com" || normalized.endsWith(".bilibili.com");
}

function authenticationRequired(): Error {
  return Object.assign(
    new Error(
      "Bilibili login generation expired; please login again before retrying",
    ),
    { code: "AUTHENTICATION_REQUIRED" as const },
  );
}

function exactPageOwner(value: unknown): ExactPageRequestOwner | null {
  if (!isRecord(value)) return null;
  const owner = {
    aid: value.aid,
    bvid: value.bvid,
    cid: value.cid,
    page: value.page,
    pageRevision: value.pageRevision,
    requestOwner: value.requestOwner,
    trackId: value.trackId,
    videoKey: value.videoKey,
  };
  if (
    typeof owner.aid !== "number" ||
    !Number.isSafeInteger(owner.aid) ||
    owner.aid <= 0 ||
    typeof owner.bvid !== "string" ||
    !/^BV[0-9A-Za-z]{10}$/.test(owner.bvid) ||
    typeof owner.cid !== "number" ||
    !Number.isSafeInteger(owner.cid) ||
    owner.cid <= 0 ||
    typeof owner.page !== "number" ||
    !Number.isSafeInteger(owner.page) ||
    owner.page <= 0 ||
    typeof owner.pageRevision !== "number" ||
    !Number.isSafeInteger(owner.pageRevision) ||
    owner.pageRevision < 0 ||
    typeof owner.requestOwner !== "string" ||
    owner.requestOwner.length === 0 ||
    owner.requestOwner.length > 512 ||
    typeof owner.trackId !== "string" ||
    owner.trackId.length === 0 ||
    owner.trackId.length > 512
  ) {
    return null;
  }
  if (
    owner.videoKey !== undefined &&
    (typeof owner.videoKey !== "string" ||
      owner.videoKey.length === 0 ||
      owner.videoKey.length > 512)
  ) {
    return null;
  }
  return Object.freeze(owner as ExactPageRequestOwner);
}

function exactPageOwnersMatch(
  left: ExactPageRequestOwner,
  right: ExactPageRequestOwner,
): boolean {
  return (
    left.aid === right.aid &&
    left.bvid === right.bvid &&
    left.cid === right.cid &&
    left.page === right.page &&
    left.pageRevision === right.pageRevision &&
    left.requestOwner === right.requestOwner &&
    left.trackId === right.trackId &&
    left.videoKey === right.videoKey
  );
}

function payloadOwner(body: unknown): ExactPageRequestOwner | null {
  if (!isRecord(body)) return null;
  const nested = isRecord(body.data) ? body.data.owner : undefined;
  return exactPageOwner(nested ?? body.owner);
}

function abortError(): Error {
  return invalidPageRequest("was cancelled (aborted)");
}

function invalidPageRequest(message: string): Error {
  return new Error(`The Bilibili page request ${message}`);
}

function normalizeRequestUrl(value: string): string {
  if (value.length === 0 || value.length > 4_096) {
    throw invalidPageRequest("URL is not allowed");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidPageRequest("URL is not allowed");
  }
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    throw invalidPageRequest("URL is not allowed");
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    (host === "api.bilibili.com" && ALLOWED_API_PATHS.has(url.pathname)) ||
    host === "hdslb.com" ||
    host.endsWith(".hdslb.com") ||
    host === "bilivideo.com" ||
    host.endsWith(".bilivideo.com");
  if (!allowed) throw invalidPageRequest("URL is not allowed");
  return url.toString();
}

function normalizeRequestInit(init: PageFetchInit): {
  readonly accept: string;
  readonly credentials: PageFetchCredentials;
  readonly referer: string;
} {
  if (
    (init.credentials !== "include" && init.credentials !== "omit") ||
    init.method !== "GET" ||
    !isRecord(init.headers)
  ) {
    throw invalidPageRequest("options are invalid");
  }
  const keys = Object.keys(init.headers).sort();
  if (keys.length !== 2 || keys[0] !== "Accept" || keys[1] !== "Referer") {
    throw invalidPageRequest("headers are invalid");
  }
  const accept = init.headers.Accept;
  const referer = init.headers.Referer;
  if (
    !ALLOWED_ACCEPT.has(accept) ||
    parseBilibiliPageIdentity(referer) === null
  ) {
    throw invalidPageRequest("headers are invalid");
  }
  return Object.freeze({ accept, credentials: init.credentials, referer });
}

function findExactBilibiliTab(value: unknown, referer: string): number | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const expected = parseBilibiliPageIdentity(referer);
  if (expected === null) {
    return null;
  }
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const actual =
      typeof candidate.url === "string"
        ? parseBilibiliPageIdentity(candidate.url)
        : null;
    const tabId = candidate.id;
    if (
      actual !== null &&
      actual.bvid === expected.bvid &&
      actual.page === expected.page &&
      typeof tabId === "number" &&
      Number.isSafeInteger(tabId) &&
      tabId > 0
    ) {
      return tabId;
    }
  }
  return null;
}

function decodeBase64(value: unknown): ArrayBuffer {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > Math.ceil(MAX_BINARY_BYTES / 3) * 4 + 4
  ) {
    throw invalidPageRequest("response is invalid");
  }
  let decoded: string;
  try {
    decoded = globalThis.atob(value);
  } catch {
    throw invalidPageRequest("response is invalid");
  }
  if (decoded.length === 0 || decoded.length > MAX_BINARY_BYTES) {
    throw invalidPageRequest("response is invalid");
  }
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0))
    .buffer;
}

async function fetchBilibiliInMainWorld(
  url: string,
  accept: string,
  binary: boolean,
  expectedBvid: string,
  expectedPage: number,
  credentials: "include" | "omit",
): Promise<unknown> {
  const marker = "muzhi.bilibili.page-fetch.v1";
  const maxJsonCharacters = 16 * 1_024 * 1_024;
  const maxBinaryBytes = 16 * 1_024 * 1_024;
  const failed = (): Record<string, unknown> => ({
    body: null,
    bodyKind: "failed",
    marker,
    ok: false,
    status: 0,
  });
  const hasExpectedPageIdentity = (): boolean => {
    let current: URL;
    try {
      current = new URL(window.location.href);
    } catch {
      return false;
    }
    const match = /^\/video\/(BV[0-9A-Za-z]{10})\/?$/.exec(current.pathname);
    if (
      current.protocol !== "https:" ||
      current.hostname !== "www.bilibili.com" ||
      current.port !== "" ||
      current.username !== "" ||
      current.password !== "" ||
      match === null ||
      match[1] !== expectedBvid
    ) {
      return false;
    }
    const pageValues = current.searchParams.getAll("p");
    if (pageValues.length === 0) return expectedPage === 1;
    if (pageValues.length !== 1 || !/^[1-9]\d*$/.test(pageValues[0])) {
      return false;
    }
    return Number(pageValues[0]) === expectedPage;
  };
  const hasAllowedResponseUrl = (value: string): boolean => {
    let responseUrl: URL;
    try {
      responseUrl = new URL(value);
    } catch {
      return false;
    }
    if (
      responseUrl.protocol !== "https:" ||
      responseUrl.port !== "" ||
      responseUrl.username !== "" ||
      responseUrl.password !== ""
    ) {
      return false;
    }
    const host = responseUrl.hostname.toLowerCase();
    if (host === "hdslb.com" || host.endsWith(".hdslb.com")) return true;
    if (host !== "api.bilibili.com") return false;
    return new Set([
      "/x/player/v2",
      "/x/player/wbi/v2",
      "/x/player/v2/ai/subtitle/search/stat",
      "/x/player/playurl",
      "/x/v2/subtitle/web/view",
      "/x/web-interface/nav",
      "/x/web-interface/wbi/view/detail",
    ]).has(responseUrl.pathname);
  };
  try {
    if (!hasExpectedPageIdentity()) return failed();
    const response = await window.fetch(url, {
      credentials,
      headers: { Accept: accept },
      method: "GET",
      redirect: "follow",
      referrer: window.location.href,
      referrerPolicy: "strict-origin-when-cross-origin",
    });
    if (
      !hasExpectedPageIdentity() ||
      typeof response.url !== "string" ||
      !hasAllowedResponseUrl(response.url)
    ) {
      return failed();
    }
    if (!response.ok) {
      return {
        body: null,
        bodyKind: "empty",
        marker,
        ok: false,
        status: response.status,
      };
    }
    if (!binary) {
      const text = await response.text();
      if (text.length === 0 || text.length > maxJsonCharacters) return failed();
      let body: unknown;
      try {
        body = JSON.parse(text) as unknown;
      } catch {
        return failed();
      }
      return {
        body,
        bodyKind: "json",
        marker,
        ok: true,
        status: response.status,
      };
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > maxBinaryBytes) {
      return failed();
    }
    const bytes = new Uint8Array(buffer);
    let encoded = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8_000) {
      encoded += String.fromCharCode(
        ...bytes.subarray(offset, offset + 0x8_000),
      );
    }
    return {
      body: window.btoa(encoded),
      bodyKind: "binary",
      marker,
      ok: true,
      status: response.status,
    };
  } catch {
    return failed();
  }
}

function parseInjectionResult(value: unknown): {
  readonly body: unknown;
  readonly bodyKind: "binary" | "empty" | "json";
  readonly ok: boolean;
  readonly status: number;
} {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    !isRecord(value[0]) ||
    value[0].frameId !== 0 ||
    !isRecord(value[0].result)
  ) {
    throw invalidPageRequest("response is invalid");
  }
  const result = value[0].result;
  if (
    result.marker !== PAGE_FETCH_MARKER ||
    typeof result.ok !== "boolean" ||
    typeof result.status !== "number" ||
    !Number.isInteger(result.status) ||
    result.status < 0 ||
    result.status > 599 ||
    (result.bodyKind !== "binary" &&
      result.bodyKind !== "empty" &&
      result.bodyKind !== "json") ||
    (result.ok && (result.status < 200 || result.status >= 300)) ||
    (!result.ok && result.status === 0 && result.bodyKind !== "empty")
  ) {
    throw invalidPageRequest("response is invalid");
  }
  if (result.bodyKind === "empty" && result.body !== null) {
    throw invalidPageRequest("response is invalid");
  }
  return Object.freeze({
    body: result.body,
    bodyKind: result.bodyKind,
    ok: result.ok,
    status: result.status,
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(abortError()));
    const timeout = setTimeout(
      () => finish(() => reject(invalidPageRequest("timed out"))),
      timeoutMs,
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) {
      onAbort();
    }
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export function createChromeBilibiliPageFetch(
  dependencies: ChromeBilibiliPageFetchDependencies,
  options: ChromeBilibiliPageFetchOptions = {},
): ChromeBilibiliPageFetch {
  return async (inputUrl, init) => {
    const url = normalizeRequestUrl(inputUrl);
    const { accept, credentials, referer } = normalizeRequestInit(init);
    const expectedIdentity = parseBilibiliPageIdentity(referer);
    if (expectedIdentity === null) {
      throw invalidPageRequest("headers are invalid");
    }
    const owner = init.owner === undefined ? null : exactPageOwner(init.owner);
    if (init.owner !== undefined && owner === null) {
      throw invalidPageRequest("owner identity is invalid");
    }
    if (owner !== null) {
      const requestUrl = new URL(url);
      const urlBvid = requestUrl.searchParams.get("bvid");
      const urlCid =
        requestUrl.searchParams.get("cid") ??
        requestUrl.searchParams.get("oid");
      const urlAid =
        requestUrl.searchParams.get("aid") ??
        requestUrl.searchParams.get("pid");
      if (
        owner.bvid !== expectedIdentity.bvid ||
        owner.page !== expectedIdentity.page ||
        (urlBvid !== null && urlBvid !== owner.bvid) ||
        (urlAid !== null && urlAid !== String(owner.aid)) ||
        (urlCid !== null && urlCid !== String(owner.cid))
      ) {
        throw invalidPageRequest("owner identity does not match the request");
      }
    }
    // Prefer the focused/active tab, but Side Panel interactions often leave a
    // non-video tab active. Fall back to any exact BVID+page video tab. The
    // page transport never creates, navigates, mutes, or closes tabs: when no
    // exact page exists the caller's Cookie/DNR off-page authorization takes
    // over instead of opening a new window.
    const focusedTabs = await dependencies.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    let tabId = findExactBilibiliTab(focusedTabs, referer);
    if (tabId === null) {
      const videoTabs = await dependencies.tabs.query({
        url: ["https://www.bilibili.com/video/*"],
      });
      tabId = findExactBilibiliTab(videoTabs, referer);
    }
    if (tabId === null) {
      throw invalidPageRequest(
        "requires the exact Bilibili page to remain open",
      );
    }
    const binary = accept.startsWith("application/x-protobuf");
    let rawResult: unknown;
    try {
      rawResult = await withTimeout(
        dependencies.scripting.executeScript({
          args: [
            url,
            accept,
            binary,
            expectedIdentity.bvid,
            expectedIdentity.page,
            credentials,
          ],
          func: fetchBilibiliInMainWorld,
          target: { tabId },
          world: "MAIN",
        }),
        options.timeoutMs ?? 30_000,
        init.signal,
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("The Bilibili")) {
        throw error;
      }
      throw invalidPageRequest("failed");
    }
    const result = parseInjectionResult(rawResult);
    const responseOwner = payloadOwner(result.body);
    if (
      owner !== null &&
      responseOwner !== null &&
      !exactPageOwnersMatch(owner, responseOwner)
    ) {
      throw invalidPageRequest("owner identity does not match the response");
    }
    const response: PageFetchResponse = {
      authorizationContext: "page",
      ok: result.ok,
      status: result.status,
      async arrayBuffer() {
        if (result.bodyKind !== "binary") {
          throw invalidPageRequest("response is not binary");
        }
        return decodeBase64(result.body);
      },
      async json() {
        if (result.bodyKind !== "json") {
          throw invalidPageRequest("response is not JSON");
        }
        return result.body;
      },
    };
    return Object.freeze(response);
  };
}

function validateOwnedPageRequest(
  url: string,
  referer: string,
  owner: ExactPageRequestOwner,
): void {
  const expectedIdentity = parseBilibiliPageIdentity(referer);
  if (expectedIdentity === null) {
    throw invalidPageRequest("headers are invalid");
  }
  const requestUrl = new URL(url);
  const urlBvid = requestUrl.searchParams.get("bvid");
  const urlCid =
    requestUrl.searchParams.get("cid") ?? requestUrl.searchParams.get("oid");
  const urlAid =
    requestUrl.searchParams.get("aid") ?? requestUrl.searchParams.get("pid");
  if (
    owner.bvid !== expectedIdentity.bvid ||
    owner.page !== expectedIdentity.page ||
    (urlBvid !== null && urlBvid !== owner.bvid) ||
    (urlAid !== null && urlAid !== String(owner.aid)) ||
    (urlCid !== null && urlCid !== String(owner.cid))
  ) {
    throw invalidPageRequest("owner identity does not match the request");
  }
}

export function createChromeBilibiliPageFetchFromChrome(
  chromeValue: unknown,
  options: ChromeBilibiliPageFetchOptions = {},
): ChromeBilibiliPageFetch {
  if (!isRecord(chromeValue)) {
    throw new Error("Chrome Bilibili page request APIs are unavailable");
  }
  const cookies = Reflect.get(chromeValue, "cookies") as unknown;
  const scripting = Reflect.get(chromeValue, "scripting") as unknown;
  const tabs = Reflect.get(chromeValue, "tabs") as unknown;
  const declarativeNetRequest = Reflect.get(
    chromeValue,
    "declarativeNetRequest",
  ) as unknown;
  const runtime = Reflect.get(chromeValue, "runtime") as unknown;
  const storage = Reflect.get(chromeValue, "storage") as unknown;
  const local = isRecord(storage)
    ? (Reflect.get(storage, "local") as unknown)
    : null;
  const onChanged = isRecord(cookies)
    ? (Reflect.get(cookies, "onChanged") as unknown)
    : null;
  const getAll = isRecord(cookies)
    ? (Reflect.get(cookies, "getAll") as unknown)
    : null;
  const addListener = isRecord(onChanged)
    ? (Reflect.get(onChanged, "addListener") as unknown)
    : null;
  const getSessionRules = isRecord(declarativeNetRequest)
    ? (Reflect.get(declarativeNetRequest, "getSessionRules") as unknown)
    : null;
  const updateSessionRules = isRecord(declarativeNetRequest)
    ? (Reflect.get(declarativeNetRequest, "updateSessionRules") as unknown)
    : null;
  const get = isRecord(local) ? (Reflect.get(local, "get") as unknown) : null;
  const remove = isRecord(local)
    ? (Reflect.get(local, "remove") as unknown)
    : null;
  const set = isRecord(local) ? (Reflect.get(local, "set") as unknown) : null;
  const setAccessLevel = isRecord(local)
    ? (Reflect.get(local, "setAccessLevel") as unknown)
    : null;
  const runtimeId = isRecord(runtime)
    ? (Reflect.get(runtime, "id") as unknown)
    : null;
  const executeScript = isRecord(scripting)
    ? (Reflect.get(scripting, "executeScript") as unknown)
    : null;
  const queryTabs = isRecord(tabs)
    ? (Reflect.get(tabs, "query") as unknown)
    : null;
  if (
    !isRecord(cookies) ||
    typeof getAll !== "function" ||
    !isRecord(onChanged) ||
    typeof addListener !== "function" ||
    !isRecord(declarativeNetRequest) ||
    typeof getSessionRules !== "function" ||
    typeof updateSessionRules !== "function" ||
    !isRecord(local) ||
    typeof get !== "function" ||
    typeof remove !== "function" ||
    typeof set !== "function" ||
    typeof runtimeId !== "string" ||
    runtimeId.length === 0
  ) {
    throw new Error("Chrome Bilibili page request APIs are unavailable");
  }
  // The cookie-authorized transport owns the single Chrome cookie listener.
  // Decorate that listener at the composition boundary so MAIN-world page
  // requests and off-page requests observe the same login-generation events
  // without exposing cookie values or registering a second listener.
  let loginGeneration = 0;
  const authorizedFetch = createBilibiliCookieAuthorizedFetch(
    {
      cookies: {
        getAll: (details) => Reflect.apply(getAll, cookies, [details]),
        onChanged: {
          addListener: (listener) =>
            Reflect.apply(addListener, onChanged, [
              (change: ChromeBilibiliCookieChange) => {
                if (isBilibiliCookieChange(change)) loginGeneration += 1;
                listener(change);
              },
            ]),
        },
      },
      declarativeNetRequest: {
        getSessionRules: () =>
          Reflect.apply(getSessionRules, declarativeNetRequest, []),
        updateSessionRules: (update) =>
          Reflect.apply(updateSessionRules, declarativeNetRequest, [update]),
      },
      fetch: (url, init) => globalThis.fetch(url, init),
      runtime: { id: runtimeId },
      storage: {
        get: (keys) => Reflect.apply(get, local, [keys]),
        remove: (keys) => Reflect.apply(remove, local, [keys]),
        set: (items) => Reflect.apply(set, local, [items]),
        ...(typeof setAccessLevel === "function"
          ? {
              setAccessLevel: (settings: {
                readonly accessLevel: "TRUSTED_CONTEXTS";
              }) => Reflect.apply(setAccessLevel, local, [settings]),
            }
          : {}),
      },
    },
    options,
  );
  const authorizedPageFetch =
    isRecord(scripting) &&
    typeof executeScript === "function" &&
    isRecord(tabs) &&
    typeof queryTabs === "function"
      ? createChromeBilibiliPageFetch(
          {
            scripting: {
              executeScript: (injection) =>
                Reflect.apply(executeScript, scripting, [
                  injection,
                ]) as Promise<unknown>,
            },
            tabs: {
              query: (queryInfo) =>
                Reflect.apply(queryTabs, tabs, [queryInfo]) as Promise<unknown>,
            },
          },
          options,
        )
      : null;
  return async (inputUrl, init) => {
    const requestLoginGeneration = loginGeneration;
    const assertCurrentLoginGeneration = (): void => {
      if (requestLoginGeneration !== loginGeneration) {
        throw authenticationRequired();
      }
    };
    const url = normalizeRequestUrl(inputUrl);
    if (
      (init.credentials !== "include" && init.credentials !== "omit") ||
      init.method !== "GET" ||
      !isRecord(init.headers)
    ) {
      throw invalidPageRequest("options are invalid");
    }
    const keys = Object.keys(init.headers).sort();
    if (keys.length !== 2 || keys[0] !== "Accept" || keys[1] !== "Referer") {
      throw invalidPageRequest("headers are invalid");
    }
    const accept = init.headers.Accept;
    const referer = init.headers.Referer;
    let refererUrl: URL;
    try {
      refererUrl = new URL(referer);
    } catch {
      throw invalidPageRequest("headers are invalid");
    }
    const refererHost = refererUrl.hostname.toLowerCase();
    if (
      !ALLOWED_ACCEPT.has(accept) ||
      refererUrl.protocol !== "https:" ||
      (refererHost !== "bilibili.com" && !refererHost.endsWith(".bilibili.com"))
    ) {
      throw invalidPageRequest("headers are invalid");
    }
    const targetHost = new URL(url).hostname.toLowerCase();
    const isApi = targetHost === "api.bilibili.com";
    if (
      (isApi && init.credentials !== "include") ||
      (!isApi && init.credentials !== "omit")
    ) {
      throw invalidPageRequest("credentials are invalid");
    }
    const owner = init.owner === undefined ? null : exactPageOwner(init.owner);
    if (init.owner !== undefined && owner === null) {
      throw invalidPageRequest("owner identity is invalid");
    }
    if (owner !== null) validateOwnedPageRequest(url, referer, owner);

    // The normal video page is the authority for requests which depend on the
    // user's existing playback entitlement. A successful page response,
    // including an HTTP account rejection, is returned as-is and can never be
    // overwritten by a later Service Worker/DNR request. Only absence or a
    // transport-level page failure falls back to the bounded off-page path.
    if (
      authorizedPageFetch !== null &&
      parseBilibiliPageIdentity(referer) !== null
    ) {
      try {
        const response = await authorizedPageFetch(url, init);
        assertCurrentLoginGeneration();
        return response;
      } catch (error) {
        if (
          init.signal?.aborted === true ||
          (error instanceof Error && /owner identity/i.test(error.message))
        ) {
          throw error;
        }
        assertCurrentLoginGeneration();
      }
    }
    const response = await authorizedFetch(url, {
      accept,
      credentials: init.credentials,
      method: "GET",
      referer,
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    });
    assertCurrentLoginGeneration();
    return Object.freeze({
      authorizationContext: "off-page" as const,
      arrayBuffer: () => response.arrayBuffer(),
      json: () => response.json(),
      ok: response.ok,
      status: response.status,
    });
  };
}
