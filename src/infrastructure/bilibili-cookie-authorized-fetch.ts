export interface BilibiliCookieAuthorizedResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

export interface BilibiliCookieAuthorizedFetchInit {
  readonly accept: string;
  readonly credentials: "include" | "omit";
  readonly method: "GET";
  readonly referer: string;
  readonly signal?: AbortSignal;
}

interface ChromeCookieChange {
  readonly cookie?: {
    readonly domain?: unknown;
    readonly name?: unknown;
  };
  readonly removed?: unknown;
}

interface ChromeDnrRule {
  readonly id?: unknown;
}

export interface BilibiliCookieAuthorizedFetchDependencies {
  readonly cookies: {
    getAll(details: { readonly domain: string }): Promise<unknown>;
    readonly onChanged: {
      addListener(listener: (change: ChromeCookieChange) => void): void;
    };
  };
  readonly declarativeNetRequest: {
    getSessionRules(): Promise<unknown>;
    updateSessionRules(update: {
      readonly addRules?: readonly Record<string, unknown>[];
      readonly removeRuleIds?: readonly number[];
    }): Promise<void>;
  };
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly runtime: { readonly id: string };
  readonly storage: {
    get(keys?: string | readonly string[] | null): Promise<unknown>;
    remove(keys: string | readonly string[]): Promise<void>;
    set(items: Readonly<Record<string, unknown>>): Promise<void>;
    setAccessLevel?(settings: {
      readonly accessLevel: "TRUSTED_CONTEXTS";
    }): Promise<void>;
  };
}

export interface BilibiliCookieAuthorizedFetchOptions {
  readonly timeoutMs?: number;
}

export type BilibiliCookieAuthorizedFetch = (
  url: string,
  init: BilibiliCookieAuthorizedFetchInit,
) => Promise<BilibiliCookieAuthorizedResponse>;

const SNAPSHOT_KEY = "__muzhi.bilibili.cookie-snapshot.v1";
const LOGIN_COOKIE_NAME = "SESSDATA";
const OWNED_RULE_MIN = 1_940_000_000;
const OWNED_RULE_MAX = 1_940_009_999;
const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1_000;
const MAX_COOKIE_HEADER_CHARACTERS = 64 * 1_024;
const MAX_RESPONSE_BYTES = 16 * 1_024 * 1_024;
const REQUEST_NONCE_KEY = "_muzhi_request_nonce";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authenticationRequired(): Error {
  return Object.assign(
    new Error(
      "Bilibili login generation expired; please login again before retrying",
    ),
    { code: "AUTHENTICATION_REQUIRED" as const },
  );
}

function dnrFailure(): Error {
  return new Error(
    "The Bilibili authorized request could not install its rule",
  );
}

function dnrCleanupFailure(): Error {
  return new Error("The Bilibili authorized request rule could not be cleaned");
}

function isBilibiliCookieDomain(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase().replace(/^\./, "");
  return normalized === "bilibili.com" || normalized.endsWith(".bilibili.com");
}

function safeCookieComponent(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function buildCookieSnapshot(
  value: unknown,
  now: number,
): {
  readonly cookieHeader: string;
  readonly expiresAt: number;
} {
  if (!Array.isArray(value)) throw authenticationRequired();
  const cookies = value.flatMap(
    (
      raw,
    ): Array<{
      readonly expiresAt: number | null;
      readonly name: string;
      readonly value: string;
    }> => {
      if (!isRecord(raw) || !isBilibiliCookieDomain(raw.domain)) return [];
      const name = safeCookieComponent(
        raw.name,
        /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/,
      );
      const cookieValue = safeCookieComponent(
        raw.value,
        /^[^;\r\n\0]{1,4096}$/,
      );
      if (name === null || cookieValue === null) return [];
      const expirationSeconds = raw.expirationDate;
      const expiresAt =
        typeof expirationSeconds === "number" &&
        Number.isFinite(expirationSeconds)
          ? Math.floor(expirationSeconds * 1_000)
          : null;
      if (expiresAt !== null && expiresAt <= now) return [];
      return [{ expiresAt, name, value: cookieValue }];
    },
  );
  if (!cookies.some((cookie) => cookie.name === LOGIN_COOKIE_NAME)) {
    throw authenticationRequired();
  }
  cookies.sort((left, right) => left.name.localeCompare(right.name));
  const cookieHeader = cookies
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  if (
    cookieHeader.length === 0 ||
    cookieHeader.length > MAX_COOKIE_HEADER_CHARACTERS
  ) {
    throw authenticationRequired();
  }
  const finiteExpirations = cookies.flatMap((cookie) =>
    cookie.expiresAt === null ? [] : [cookie.expiresAt],
  );
  return Object.freeze({
    cookieHeader,
    expiresAt: Math.min(
      now + SNAPSHOT_MAX_AGE_MS,
      ...(finiteExpirations.length === 0
        ? [now + SNAPSHOT_MAX_AGE_MS]
        : finiteExpirations),
    ),
  });
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

function responseIndicatesInvalidLogin(value: unknown): boolean {
  return isRecord(value) && value.code === -101;
}

function parseBoundedJson(buffer: ArrayBuffer): unknown {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("The Bilibili authorized response is invalid");
  }
  try {
    return JSON.parse(new TextDecoder().decode(buffer)) as unknown;
  } catch {
    throw new Error("The Bilibili authorized response is invalid");
  }
}

async function bufferResponse(
  response: Response,
  accept: string,
): Promise<{
  readonly response: BilibiliCookieAuthorizedResponse;
  readonly value: unknown;
}> {
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_RESPONSE_BYTES) {
    throw new Error("The Bilibili authorized response is invalid");
  }
  const isJson = !accept.startsWith("application/x-protobuf");
  const value = isJson && response.ok ? parseBoundedJson(buffer) : null;
  return Object.freeze({
    response: Object.freeze({
      ok: response.ok,
      status: response.status,
      async arrayBuffer() {
        if (isJson || buffer.byteLength === 0) {
          throw new Error("The Bilibili authorized response is not binary");
        }
        return buffer.slice(0);
      },
      async json() {
        if (!isJson || value === null) {
          throw new Error("The Bilibili authorized response is not JSON");
        }
        return value;
      },
    }),
    value,
  });
}

function withRequestTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  readonly cleanup: () => void;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  const abortFromOwner = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromOwner, { once: true });
  if (signal?.aborted) abortFromOwner();
  const timeout = setTimeout(
    () =>
      controller.abort(new DOMException("Request timed out", "TimeoutError")),
    timeoutMs,
  );
  return Object.freeze({
    cleanup: () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromOwner);
    },
    signal: controller.signal,
  });
}

/**
 * Owns the only path that materializes a Bilibili Cookie header. The value is
 * confined to one request's memory and one ephemeral DNR session rule;
 * callers, storage, request DTOs and fetch headers never receive it.
 */
export function createBilibiliCookieAuthorizedFetch(
  dependencies: BilibiliCookieAuthorizedFetchDependencies,
  options: BilibiliCookieAuthorizedFetchOptions = {},
): BilibiliCookieAuthorizedFetch {
  let generation = 0;
  let nextRuleOffset = 0;
  let invalidLoginGeneration: number | null = null;
  let startupFailure: Error | null = null;
  const activeRuleIds = new Set<number>();

  dependencies.cookies.onChanged.addListener((change) => {
    if (!isBilibiliCookieDomain(change.cookie?.domain)) return;
    generation += 1;
    invalidLoginGeneration = null;
  });

  const startupCleanup = (async (): Promise<void> => {
    // Delete the retired v13 replayable snapshot before any authorized request.
    // Failure is fatal: proceeding would leave an old credential projection at
    // rest even though the v14 request itself is memory-only.
    await dependencies.storage.remove(SNAPSHOT_KEY);

    const value = await dependencies.declarativeNetRequest.getSessionRules();
    if (!Array.isArray(value)) throw dnrCleanupFailure();
    const owned = value.flatMap((rule): number[] =>
      isRecord(rule) && isOwnedRuleId((rule as ChromeDnrRule).id)
        ? [(rule as { readonly id: number }).id]
        : [],
    );
    if (owned.length > 0) {
      await dependencies.declarativeNetRequest.updateSessionRules({
        removeRuleIds: owned,
      });
    }
  })().catch(() => {
    startupFailure = dnrCleanupFailure();
  });

  const removeRule = async (ruleId: number): Promise<void> => {
    try {
      await dependencies.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId],
      });
    } catch {
      try {
        await dependencies.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [ruleId],
        });
      } catch {
        throw dnrCleanupFailure();
      }
    } finally {
      activeRuleIds.delete(ruleId);
    }
  };

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
    throw dnrFailure();
  };

  const collectSnapshot = async (): Promise<{
    readonly cookieHeader: string;
    readonly expiresAt: number;
    readonly generation: number;
  }> => {
    if (invalidLoginGeneration === generation) {
      throw authenticationRequired();
    }
    let cookies: unknown;
    try {
      cookies = await dependencies.cookies.getAll({ domain: ".bilibili.com" });
    } catch {
      throw authenticationRequired();
    }
    let snapshot: ReturnType<typeof buildCookieSnapshot>;
    try {
      snapshot = buildCookieSnapshot(cookies, Date.now());
    } catch {
      throw authenticationRequired();
    }
    const capturedGeneration = generation;
    if (capturedGeneration !== generation) throw authenticationRequired();
    return Object.freeze({
      cookieHeader: snapshot.cookieHeader,
      expiresAt: snapshot.expiresAt,
      generation: capturedGeneration,
    });
  };

  return async (inputUrl, init) => {
    await startupCleanup;
    if (startupFailure !== null) throw startupFailure;
    const target = new URL(inputUrl);
    if (init.credentials === "omit") {
      const timing = withRequestTimeout(
        init.signal,
        options.timeoutMs ?? 30_000,
      );
      try {
        const response = await dependencies.fetch(target.toString(), {
          credentials: "omit",
          headers: { Accept: init.accept },
          method: "GET",
          redirect: "error",
          referrer: init.referer,
          referrerPolicy: "strict-origin-when-cross-origin",
          signal: timing.signal,
        });
        return (await bufferResponse(response, init.accept)).response;
      } finally {
        timing.cleanup();
      }
    }

    const snapshot = await collectSnapshot();
    const isWbiSigned =
      target.searchParams.has("w_rid") && target.searchParams.has("wts");
    if (!isWbiSigned) {
      if (target.searchParams.has(REQUEST_NONCE_KEY)) throw dnrFailure();
      target.searchParams.set(
        REQUEST_NONCE_KEY,
        globalThis.crypto.randomUUID(),
      );
    }
    const requestUrl = target.toString();
    const ruleId = allocateRuleId();
    const rule = Object.freeze({
      action: Object.freeze({
        requestHeaders: Object.freeze([
          Object.freeze({
            header: "Cookie",
            operation: "set",
            value: snapshot.cookieHeader,
          }),
        ]),
        type: "modifyHeaders",
      }),
      condition: Object.freeze({
        initiatorDomains: Object.freeze([dependencies.runtime.id]),
        regexFilter: `^${escapeRegex(requestUrl)}$`,
        requestDomains: Object.freeze([target.hostname.toLowerCase()]),
        requestMethods: Object.freeze(["get"]),
        resourceTypes: Object.freeze(["xmlhttprequest"]),
        tabIds: Object.freeze([-1]),
      }),
      id: ruleId,
      priority: 1,
    });

    let installed = false;
    try {
      try {
        await dependencies.declarativeNetRequest.updateSessionRules({
          addRules: [rule],
          removeRuleIds: [ruleId],
        });
        installed = true;
      } catch {
        throw dnrFailure();
      }
      if (
        snapshot.generation !== generation ||
        snapshot.expiresAt <= Date.now()
      ) {
        throw authenticationRequired();
      }
      const timing = withRequestTimeout(
        init.signal,
        options.timeoutMs ?? 30_000,
      );
      try {
        const response = await dependencies.fetch(requestUrl, {
          credentials: "omit",
          headers: { Accept: init.accept },
          method: "GET",
          redirect: "error",
          referrer: init.referer,
          referrerPolicy: "strict-origin-when-cross-origin",
          signal: timing.signal,
        });
        if (
          snapshot.generation !== generation ||
          snapshot.expiresAt <= Date.now()
        ) {
          throw authenticationRequired();
        }
        const buffered = await bufferResponse(response, init.accept);
        if (
          snapshot.generation !== generation ||
          snapshot.expiresAt <= Date.now()
        ) {
          throw authenticationRequired();
        }
        if (responseIndicatesInvalidLogin(buffered.value)) {
          invalidLoginGeneration = snapshot.generation;
        }
        return buffered.response;
      } finally {
        timing.cleanup();
      }
    } finally {
      if (installed) {
        await removeRule(ruleId);
      } else {
        activeRuleIds.delete(ruleId);
      }
    }
  };
}
