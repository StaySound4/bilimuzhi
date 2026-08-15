import { parseBilibiliPageIdentity } from "./bilibili-page-identity";

interface MediaFetchInit {
  readonly credentials: "omit";
  readonly headers: Readonly<Record<string, string>>;
  readonly method: "GET";
  readonly redirect: "error";
  readonly signal?: AbortSignal;
}

interface ChromeMediaFetchDependencies {
  readonly declarativeNetRequest: {
    getSessionRules(): Promise<unknown>;
    updateSessionRules(update: {
      readonly addRules?: readonly Record<string, unknown>[];
      readonly removeRuleIds?: readonly number[];
    }): Promise<void>;
  };
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly runtime: { readonly id: string };
}

export type ChromeBilibiliMediaFetch = (
  url: string,
  init: MediaFetchInit,
) => Promise<Response>;

const OWNED_RULE_MIN = 1_940_010_000;
const OWNED_RULE_MAX = 1_940_019_999;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOwnedRuleId(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= OWNED_RULE_MIN &&
    value <= OWNED_RULE_MAX
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMediaUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The Bilibili media URL is invalid");
  }
  const host = url.hostname.toLowerCase();
  const allowedHost =
    host === "bilivideo.com" ||
    host.endsWith(".bilivideo.com") ||
    host === "hdslb.com" ||
    host.endsWith(".hdslb.com") ||
    host === "bilibili.com" ||
    host.endsWith(".bilibili.com");
  if (
    url.protocol !== "https:" ||
    !allowedHost ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    value.length > 4_096
  ) {
    throw new Error("The Bilibili media URL is invalid");
  }
  return url;
}

function normalizeInit(init: MediaFetchInit): {
  readonly accept: string;
  readonly referer: string;
  readonly signal?: AbortSignal;
} {
  if (
    init.credentials !== "omit" ||
    init.method !== "GET" ||
    init.redirect !== "error" ||
    !isRecord(init.headers) ||
    Object.keys(init.headers).sort().join(",") !== "Accept,Referer" ||
    parseBilibiliPageIdentity(init.headers.Referer) === null ||
    !/^[-+*/;=,. A-Za-z0-9]{1,128}$/.test(init.headers.Accept)
  ) {
    throw new Error("The Bilibili media request is invalid");
  }
  return Object.freeze({
    accept: init.headers.Accept,
    referer: init.headers.Referer,
    ...(init.signal === undefined ? {} : { signal: init.signal }),
  });
}

export function createChromeBilibiliMediaFetch(
  dependencies: ChromeMediaFetchDependencies,
): ChromeBilibiliMediaFetch {
  let nextRuleOffset = 0;
  let startupFailure: Error | null = null;
  const activeRuleIds = new Set<number>();
  const startupCleanup = (async (): Promise<void> => {
    const rules = await dependencies.declarativeNetRequest.getSessionRules();
    if (!Array.isArray(rules)) {
      throw new Error("The Bilibili media request cleanup failed");
    }
    const owned = rules.flatMap((rule): number[] =>
      isRecord(rule) && isOwnedRuleId(rule.id) ? [rule.id] : [],
    );
    if (owned.length > 0) {
      await dependencies.declarativeNetRequest.updateSessionRules({
        removeRuleIds: owned,
      });
    }
  })().catch(() => {
    startupFailure = new Error("The Bilibili media request cleanup failed");
  });

  const allocateRuleId = (): number => {
    for (
      let attempts = 0;
      attempts <= OWNED_RULE_MAX - OWNED_RULE_MIN;
      attempts += 1
    ) {
      const id = OWNED_RULE_MIN + nextRuleOffset;
      nextRuleOffset =
        (nextRuleOffset + 1) % (OWNED_RULE_MAX - OWNED_RULE_MIN + 1);
      if (!activeRuleIds.has(id)) {
        activeRuleIds.add(id);
        return id;
      }
    }
    throw new Error("The Bilibili media request rule is unavailable");
  };

  const removeRule = async (id: number): Promise<void> => {
    try {
      await dependencies.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [id],
      });
    } catch {
      await dependencies.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [id],
      });
    } finally {
      activeRuleIds.delete(id);
    }
  };

  return async (inputUrl, inputInit) => {
    await startupCleanup;
    if (startupFailure !== null) throw startupFailure;
    const url = normalizeMediaUrl(inputUrl);
    const init = normalizeInit(inputInit);
    const ruleId = allocateRuleId();
    let installed = false;
    try {
      const rule = Object.freeze({
        action: Object.freeze({
          requestHeaders: Object.freeze([
            Object.freeze({
              header: "Referer",
              operation: "set",
              value: init.referer,
            }),
          ]),
          type: "modifyHeaders",
        }),
        condition: Object.freeze({
          initiatorDomains: Object.freeze([dependencies.runtime.id]),
          regexFilter: `^${escapeRegex(url.toString())}$`,
          requestDomains: Object.freeze([url.hostname.toLowerCase()]),
          requestMethods: Object.freeze(["get"]),
          resourceTypes: Object.freeze(["xmlhttprequest"]),
          tabIds: Object.freeze([-1]),
        }),
        id: ruleId,
        priority: 1,
      });
      await dependencies.declarativeNetRequest.updateSessionRules({
        addRules: [rule],
        removeRuleIds: [ruleId],
      });
      installed = true;
      return await dependencies.fetch(url.toString(), {
        credentials: "omit",
        headers: { Accept: init.accept },
        method: "GET",
        redirect: "error",
        signal: init.signal,
      });
    } finally {
      if (installed) {
        await removeRule(ruleId);
      } else {
        activeRuleIds.delete(ruleId);
      }
    }
  };
}

export function createChromeBilibiliMediaFetchFromChrome(
  chromeValue: unknown,
): ChromeBilibiliMediaFetch {
  if (!isRecord(chromeValue)) {
    throw new Error("Chrome Bilibili media request APIs are unavailable");
  }
  const declarativeNetRequest = Reflect.get(
    chromeValue,
    "declarativeNetRequest",
  ) as unknown;
  const runtime = Reflect.get(chromeValue, "runtime") as unknown;
  const getSessionRules = isRecord(declarativeNetRequest)
    ? (Reflect.get(declarativeNetRequest, "getSessionRules") as unknown)
    : null;
  const updateSessionRules = isRecord(declarativeNetRequest)
    ? (Reflect.get(declarativeNetRequest, "updateSessionRules") as unknown)
    : null;
  const runtimeId = isRecord(runtime)
    ? (Reflect.get(runtime, "id") as unknown)
    : null;
  if (
    !isRecord(declarativeNetRequest) ||
    typeof getSessionRules !== "function" ||
    typeof updateSessionRules !== "function" ||
    typeof runtimeId !== "string" ||
    runtimeId.length === 0
  ) {
    throw new Error("Chrome Bilibili media request APIs are unavailable");
  }
  return createChromeBilibiliMediaFetch({
    declarativeNetRequest: {
      getSessionRules: () =>
        Reflect.apply(getSessionRules, declarativeNetRequest, []),
      updateSessionRules: (update) =>
        Reflect.apply(updateSessionRules, declarativeNetRequest, [update]),
    },
    fetch: (url, init) => globalThis.fetch(url, init),
    runtime: { id: runtimeId },
  });
}
