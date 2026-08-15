import { describe, expect, it, vi } from "vitest";

import {
  createBilibiliCookieAuthorizedFetch,
  type BilibiliCookieAuthorizedFetchDependencies,
} from "../../src/infrastructure/bilibili-cookie-authorized-fetch";

const FIXTURE_BVID = "BV1wyTF6ZEWb";
const FIXTURE_CID = 71_400_014;
const FIXTURE_COOKIE_VALUE = "v14-unit-session-only";

type CookieOutcome = "cancel" | "failure" | "success" | "timeout";
type CookieChangeListener = Parameters<
  BilibiliCookieAuthorizedFetchDependencies["cookies"]["onChanged"]["addListener"]
>[0];

interface CookieBoundaryHarness {
  readonly activeRules: Map<number, Readonly<Record<string, unknown>>>;
  readonly authorizedFetch: ReturnType<
    typeof createBilibiliCookieAuthorizedFetch
  >;
  readonly cookieChangeListener: () => CookieChangeListener | undefined;
  readonly installedRules: readonly Readonly<Record<string, unknown>>[];
  readonly removedRuleIds: readonly number[];
  readonly storageSet: ReturnType<typeof vi.fn>;
  readonly storageValues: Readonly<Record<string, unknown>>;
}

function cookieBoundaryHarness(outcome: CookieOutcome): CookieBoundaryHarness {
  const activeRules = new Map<number, Readonly<Record<string, unknown>>>();
  const installedRules: Readonly<Record<string, unknown>>[] = [];
  const removedRuleIds: number[] = [];
  const storageValues: Record<string, unknown> = {};
  let listener: CookieChangeListener | undefined;

  const storageSet = vi.fn(async (items: Readonly<Record<string, unknown>>) => {
    Object.assign(storageValues, structuredClone(items));
  });
  const dependencies: BilibiliCookieAuthorizedFetchDependencies = {
    cookies: {
      getAll: vi.fn(async () => [
        {
          domain: ".bilibili.com",
          name: "SESSDATA",
          value: FIXTURE_COOKIE_VALUE,
        },
      ]),
      onChanged: {
        addListener: vi.fn((nextListener) => {
          listener = nextListener;
        }),
      },
    },
    declarativeNetRequest: {
      getSessionRules: vi.fn(async () => [...activeRules.values()]),
      updateSessionRules: vi.fn(async (update) => {
        for (const id of update.removeRuleIds ?? []) {
          removedRuleIds.push(id);
          activeRules.delete(id);
        }
        for (const rule of update.addRules ?? []) {
          const id = rule.id;
          if (typeof id !== "number") {
            throw new Error("fixture DNR rule requires an integer id");
          }
          installedRules.push(rule);
          activeRules.set(id, rule);
        }
      }),
    },
    fetch: vi.fn(async (_url, init) => {
      if (outcome === "success") {
        return new Response(JSON.stringify({ code: 0 }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }
      if (outcome === "failure") {
        throw new TypeError("fixture transport failed");
      }
      const signal = init.signal;
      return new Promise<Response>((_resolve, reject) => {
        const rejectFromAbort = (): void => {
          reject(
            signal?.reason ??
              new DOMException("fixture request aborted", "AbortError"),
          );
        };
        if (signal?.aborted) {
          rejectFromAbort();
        } else {
          signal?.addEventListener("abort", rejectFromAbort, { once: true });
        }
      });
    }),
    runtime: { id: "muzhi-v14-unit-extension" },
    storage: {
      get: vi.fn(async (keys) => {
        if (typeof keys === "string" && Object.hasOwn(storageValues, keys)) {
          return { [keys]: structuredClone(storageValues[keys]) };
        }
        return {};
      }),
      remove: vi.fn(async (keys) => {
        for (const key of typeof keys === "string" ? [keys] : keys) {
          delete storageValues[key];
        }
      }),
      set: storageSet,
      setAccessLevel: vi.fn(async () => undefined),
    },
  };

  return {
    activeRules,
    authorizedFetch: createBilibiliCookieAuthorizedFetch(dependencies, {
      timeoutMs: outcome === "timeout" ? 5 : 5_000,
    }),
    cookieChangeListener: () => listener,
    installedRules,
    removedRuleIds,
    storageSet,
    storageValues,
  };
}

describe("v14 A9/A10 Cookie authorization boundary", () => {
  it.each<CookieOutcome>(["success", "failure", "cancel", "timeout"])(
    "keeps replayable credentials out of storage and cleans the temporary rule after %s",
    async (outcome) => {
      const harness = cookieBoundaryHarness(outcome);
      const owner = new AbortController();
      const pending = harness
        .authorizedFetch(
          `https://api.bilibili.com/x/player/v2?bvid=${FIXTURE_BVID}&cid=${FIXTURE_CID}`,
          {
            accept: "application/json, text/plain, */*",
            credentials: "include",
            method: "GET",
            referer: `https://www.bilibili.com/video/${FIXTURE_BVID}`,
            signal: owner.signal,
          },
        )
        .then(
          (response) => ({ response }),
          (error: unknown) => ({ error }),
        );

      if (outcome === "cancel") {
        await vi.waitFor(() => expect(harness.activeRules.size).toBe(1));
        owner.abort(new DOMException("fixture owner cancelled", "AbortError"));
      }

      const result = await pending;
      try {
        if (outcome === "success") {
          expect(result).toHaveProperty("response");
          expect("error" in result).toBe(false);
        } else {
          expect(result).toHaveProperty("error");
          expect(String("error" in result ? result.error : "")).not.toContain(
            FIXTURE_COOKIE_VALUE,
          );
        }

        expect(harness.installedRules).toHaveLength(1);
        const installedRuleId = harness.installedRules[0].id;
        expect(installedRuleId).toBeTypeOf("number");
        expect(harness.removedRuleIds).toContain(installedRuleId);
        expect(harness.activeRules.size).toBe(0);

        const storedPayloads = JSON.stringify(harness.storageSet.mock.calls);
        expect(storedPayloads).not.toContain("cookieHeader");
        expect(storedPayloads).not.toContain(FIXTURE_COOKIE_VALUE);
        expect(harness.storageValues).toEqual({});
      } finally {
        harness.cookieChangeListener()?.({
          cookie: { domain: ".bilibili.com", name: "SESSDATA" },
        });
      }
    },
  );
});
