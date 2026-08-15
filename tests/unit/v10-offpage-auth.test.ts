import { afterEach, describe, expect, it, vi } from "vitest";

import serviceWorkerSource from "../../src/entries/service-worker.ts?raw";
import { createChromeBilibiliPageFetchFromChrome } from "../../src/infrastructure/chrome-bilibili-page-fetch";

const P4_REFERER = "https://www.bilibili.com/video/BV1b7411N798?p=4";
const PLAYER_URL =
  "https://api.bilibili.com/x/player/v2?bvid=BV1b7411N798&cid=400000004";

function requestInit() {
  return {
    credentials: "include" as const,
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: P4_REFERER,
    },
    method: "GET" as const,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("v10 off-page Bilibili authorization", () => {
  it("retires the legacy cookie snapshot without reading or writing credential storage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T08:00:00.000Z"));
    const snapshotKey = "__muzhi.bilibili.cookie-snapshot.v1";
    const remove = vi.fn(async () => undefined);
    const setAccessLevel = vi.fn(async () => undefined);
    const get = vi.fn(async () => ({}));
    const set = vi.fn(async () => undefined);

    createChromeBilibiliPageFetchFromChrome({
      cookies: {
        getAll: vi.fn(async () => []),
        onChanged: { addListener: vi.fn() },
      },
      declarativeNetRequest: {
        getSessionRules: vi.fn(async () => []),
        updateSessionRules: vi.fn(async () => undefined),
      },
      runtime: { id: "muzhi-test-extension" },
      storage: {
        local: {
          get,
          remove,
          set,
          setAccessLevel,
        },
      },
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(snapshotKey);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(setAccessLevel).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1_000 + 1);

    expect(remove).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(setAccessLevel).not.toHaveBeenCalled();
  });

  it("constructs both Bilibili security adapters eagerly at Service Worker startup", () => {
    expect(serviceWorkerSource).toMatch(
      /const\s+bilibiliPageFetch\s*(?::[^=]+)?=\s*createChromeBilibiliPageFetchFromChrome\(chromeValue\)/,
    );
    expect(serviceWorkerSource).toMatch(
      /const\s+bilibiliMediaFetch\s*(?::[^=]+)?=\s*createChromeBilibiliMediaFetchFromChrome\(chromeValue\)/,
    );
    expect(serviceWorkerSource).not.toMatch(
      /bilibili(?:Page|Media)Fetch\s*\?\?=/,
    );
  });

  it("uses a precise ephemeral DNR rule for exact P4 without requiring any video tab", async () => {
    const sensitiveValue = globalThis.crypto.randomUUID();
    let listener:
      | ((change: {
          readonly cookie: { readonly domain: string; readonly name: string };
          readonly removed: boolean;
        }) => void)
      | undefined;
    let installedOwnedRule = false;
    let removedInstalledRule = false;
    let installedRuleId: number | undefined;
    let ruleWasNarrowAndSecretBearing = false;
    const updateSessionRules = vi.fn(
      async (update: {
        readonly addRules?: readonly Record<string, unknown>[];
        readonly removeRuleIds?: readonly number[];
      }) => {
        const added = update.addRules?.[0];
        if (added) {
          installedRuleId = Number(added.id);
          const serialized = JSON.stringify(added);
          installedOwnedRule = true;
          ruleWasNarrowAndSecretBearing =
            serialized.includes("api.bilibili.com") &&
            serialized.includes("initiatorDomains") &&
            serialized.includes(sensitiveValue) &&
            /nonce|request/i.test(serialized);
        }
        if (
          installedRuleId !== undefined &&
          update.removeRuleIds?.includes(installedRuleId)
        ) {
          removedInstalledRule = true;
        }
      },
    );
    const storage = {
      get: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      set: vi.fn(async () => undefined),
    };
    const query = vi.fn(async () => []);
    const networkFetch = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.has("Cookie")).toBe(false);
      expect(new URL(url).searchParams.size).toBeGreaterThan(
        new URL(PLAYER_URL).searchParams.size,
      );
      return new Response(
        JSON.stringify({
          code: 0,
          data: { cid: 400_000_004, page: 4, subtitle: { subtitles: [] } },
        }),
        {
          headers: { "content-type": "application/json" },
          status: 200,
        },
      );
    });
    vi.stubGlobal("fetch", networkFetch);

    const pageFetch = createChromeBilibiliPageFetchFromChrome({
      cookies: {
        getAll: vi.fn(async () => [
          {
            domain: ".bilibili.com",
            expirationDate: Date.now() / 1_000 + 3_600,
            httpOnly: true,
            name: "SESSDATA",
            path: "/",
            secure: true,
            value: sensitiveValue,
          },
        ]),
        onChanged: {
          addListener: vi.fn((registered) => {
            listener = registered;
          }),
        },
      },
      declarativeNetRequest: {
        getSessionRules: vi.fn(async () => []),
        updateSessionRules,
      },
      runtime: { id: "muzhi-test-extension" },
      scripting: { executeScript: vi.fn() },
      storage: { local: storage },
      tabs: { query },
    });

    await expect(
      pageFetch(PLAYER_URL, requestInit()).then((r) => r.json()),
    ).resolves.toMatchObject({
      code: 0,
      data: { cid: 400_000_004, page: 4 },
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, {
      active: true,
      lastFocusedWindow: true,
    });
    expect(query).toHaveBeenNthCalledWith(2, {
      url: ["https://www.bilibili.com/video/*"],
    });
    expect(networkFetch).toHaveBeenCalledOnce();
    expect(installedOwnedRule).toBe(true);
    expect(ruleWasNarrowAndSecretBearing).toBe(true);
    expect(removedInstalledRule).toBe(true);

    listener?.({
      cookie: { domain: ".bilibili.com", name: "SESSDATA" },
      removed: true,
    });
    await vi.waitFor(() => expect(storage.remove).toHaveBeenCalled());
  });

  it("rejects a late authorized response after the browser login generation changes", async () => {
    const sensitiveValue = globalThis.crypto.randomUUID();
    let cookieListener:
      | ((change: {
          readonly cookie: { readonly domain: string; readonly name: string };
          readonly removed: boolean;
        }) => void)
      | undefined;
    let resolvePageInjection: ((response: unknown) => void) | undefined;
    const networkFetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 0, data: { page: 4 } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", networkFetch);
    const pageFetch = createChromeBilibiliPageFetchFromChrome({
      cookies: {
        getAll: vi.fn(async () => [
          {
            domain: ".bilibili.com",
            expirationDate: Date.now() / 1_000 + 3_600,
            name: "SESSDATA",
            path: "/",
            value: sensitiveValue,
          },
        ]),
        onChanged: {
          addListener: vi.fn((registered) => {
            cookieListener = registered;
          }),
        },
      },
      declarativeNetRequest: {
        getSessionRules: vi.fn(async () => []),
        updateSessionRules: vi.fn(async () => undefined),
      },
      runtime: { id: "muzhi-test-extension" },
      scripting: {
        executeScript: vi.fn(
          () =>
            new Promise<unknown>((resolve) => {
              resolvePageInjection = resolve;
            }),
        ),
      },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          remove: vi.fn(async () => undefined),
          set: vi.fn(async () => undefined),
        },
      },
      tabs: {
        query: vi.fn(async () => [{ id: 41, url: P4_REFERER }]),
      },
    });

    const pending = pageFetch(PLAYER_URL, requestInit());
    const outcome = pending.then(
      () => ({ error: null, ok: true as const }),
      (error: unknown) => ({ error, ok: false as const }),
    );
    await vi.waitFor(() =>
      expect(resolvePageInjection).toEqual(expect.any(Function)),
    );
    expect(networkFetch).not.toHaveBeenCalled();
    const changeLoginGeneration = cookieListener;
    expect(changeLoginGeneration).toEqual(expect.any(Function));
    if (changeLoginGeneration === undefined) {
      throw new Error("The login generation listener was not registered");
    }
    changeLoginGeneration({
      cookie: { domain: ".bilibili.com", name: "SESSDATA" },
      removed: true,
    });
    const releasePageResponse = resolvePageInjection;
    expect(releasePageResponse).toEqual(expect.any(Function));
    if (releasePageResponse === undefined) {
      throw new Error("The controlled page injection was not entered");
    }
    releasePageResponse([
      {
        frameId: 0,
        result: {
          body: { code: 0, data: { page: 4 } },
          bodyKind: "json",
          marker: "muzhi.bilibili.page-fetch.v1",
          ok: true,
          status: 200,
        },
      },
    ]);

    const settled = await outcome;
    expect(settled.ok).toBe(false);
    expect(settled.error).toEqual(
      expect.objectContaining({
        code: "AUTHENTICATION_REQUIRED",
        message: expect.stringMatching(/login|登录|generation|expired/i),
      }),
    );
  });
});
