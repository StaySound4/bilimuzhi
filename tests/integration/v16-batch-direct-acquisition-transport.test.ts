import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBatchRuntime,
  type BatchRepositoryPort,
} from "../../src/application/batch-runtime";
import type {
  BatchSourceDescriptor,
  BatchSourceGateway,
} from "../../src/application/batch-source-contract";
import type { CanonicalVideoResolver } from "../../src/application/video-gateway";
import {
  createBatchItem,
  createBatchJob,
  createBatchSubtitle,
  createVideoRef,
  type BatchItem,
  type BatchJob,
  type BatchSubtitle,
  type VideoRef,
} from "../../src/domain";
import {
  createChromeBilibiliSubtitleGateway,
  type BilibiliSubtitleRequestOwner,
} from "../../src/infrastructure/bilibili-subtitle-gateway";
import {
  createChromeBilibiliPageFetchFromChrome,
  type ExactPageRequestOwner,
} from "../../src/infrastructure/chrome-bilibili-page-fetch";

const BVID = "BV1b7411N798";
const REFERER = `https://www.bilibili.com/video/${BVID}?p=22`;
const PLAYER_URL = `https://api.bilibili.com/x/player/v2?bvid=${BVID}&cid=304765522`;
const BODY_URL = "https://aisubtitle.hdslb.com/v16/fixture-zh.json";

const exactOwner: ExactPageRequestOwner = Object.freeze({
  aid: 2_803_108_323,
  bvid: BVID,
  cid: 304_765_522,
  page: 22,
  pageRevision: 3,
  requestOwner: "batch:item-1:request-3",
  trackId: "track:official:zh:22",
  videoKey: `bvid:${BVID}:cid:304765522:p:22`,
});

function playerBody(tracks: readonly Record<string, unknown>[]) {
  return {
    code: 0,
    data: {
      is_ugc_pay_preview: false,
      is_upower_exclusive: false,
      is_upower_play: false,
      need_login_subtitle: false,
      subtitle: { subtitles: tracks },
    },
  };
}

function requestInit(signal?: AbortSignal) {
  return {
    credentials: "include" as const,
    headers: {
      Accept: "application/json, text/plain, */*",
      Referer: REFERER,
    },
    method: "GET" as const,
    owner: exactOwner,
    ...(signal === undefined ? {} : { signal }),
  };
}

function injected(body: unknown) {
  return [
    {
      frameId: 0,
      result: {
        body,
        bodyKind: "json",
        marker: "muzhi.bilibili.page-fetch.v1",
        ok: true,
        status: 200,
      },
    },
  ];
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

interface ChromeRecorder {
  readonly chrome: Record<string, unknown>;
  readonly create: ReturnType<typeof vi.fn>;
  readonly executeScript: ReturnType<typeof vi.fn>;
  readonly networkFetch: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
  readonly remove: ReturnType<typeof vi.fn>;
  readonly requestedUrls: string[];
  readonly update: ReturnType<typeof vi.fn>;
}

function createChromeRecorder(options: {
  readonly playerBody: unknown;
  readonly bodyBody?: unknown;
  readonly navBody?: unknown;
  readonly userTabs?: readonly { readonly id: number; readonly url: string }[];
}): ChromeRecorder {
  const requestedUrls: string[] = [];
  const create = vi.fn(
    async (properties: { readonly active: false; readonly url: string }) => ({
      id: 71,
      ...properties,
    }),
  );
  const update = vi.fn(async (tabId: number) => ({ id: tabId }));
  const remove = vi.fn(async () => undefined);
  const query = vi.fn(async () => [...(options.userTabs ?? [])]);
  const executeScript = vi.fn(async () => injected(options.playerBody));
  const networkFetch = vi.fn(async (rawUrl: string, init?: RequestInit) => {
    const url = new URL(rawUrl);
    requestedUrls.push(rawUrl);
    const headers = new Headers(init?.headers);
    // 敏感数据边界：离页授权 fetch 永远不携带 Cookie header。
    expect(headers.has("Cookie")).toBe(false);
    if (
      url.pathname === "/x/player/v2" ||
      url.pathname === "/x/player/wbi/v2"
    ) {
      return jsonResponse(options.playerBody);
    }
    if (url.pathname === "/x/web-interface/wbi/view/detail") {
      return jsonResponse({
        code: 0,
        data: {
          View: {
            aid: 2_803_108_323,
            bvid: BVID,
            pages: [{ cid: 304_765_522, page: 22 }],
          },
        },
      });
    }
    if (url.pathname === "/x/v2/subtitle/web/view") {
      // 空 protobuf 响应：无 web-view 轨道。
      return new Response(new ArrayBuffer(0), {
        headers: { "content-type": "application/x-protobuf" },
        status: 200,
      });
    }
    if (url.pathname === "/x/player/v2/ai/subtitle/search/stat") {
      return jsonResponse({ code: 0, data: {} });
    }
    if (url.pathname === "/x/web-interface/nav") {
      return jsonResponse(
        options.navBody ?? { code: 0, data: { isLogin: true } },
      );
    }
    if (rawUrl === BODY_URL) {
      return jsonResponse(options.bodyBody);
    }
    throw new Error(`Unexpected fixture URL ${rawUrl}`);
  });
  vi.stubGlobal("fetch", networkFetch);
  return {
    chrome: {
      cookies: {
        getAll: vi.fn(async () => [
          {
            domain: ".bilibili.com",
            expirationDate: Date.now() / 1_000 + 3_600,
            httpOnly: true,
            name: "SESSDATA",
            path: "/",
            secure: true,
            value: "fixture-session",
          },
        ]),
        onChanged: { addListener: vi.fn() },
      },
      declarativeNetRequest: {
        getSessionRules: vi.fn(async () => []),
        updateSessionRules: vi.fn(async () => undefined),
      },
      runtime: { id: "muzhi-v16-test" },
      scripting: { executeScript },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          remove: vi.fn(async () => undefined),
          set: vi.fn(async () => undefined),
        },
      },
      tabs: { create, query, remove, update },
    },
    create,
    executeScript,
    networkFetch,
    query,
    remove,
    requestedUrls,
    update,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const WBI_KEYS = "0123456789abcdef0123456789abcdef";

function navBody() {
  return {
    code: 0,
    data: {
      isLogin: true,
      wbi_img: {
        img_url: `https://i0.hdslb.com/bfs/wbi/${WBI_KEYS}.png`,
        sub_url: `https://i0.hdslb.com/bfs/wbi/${WBI_KEYS}.png`,
      },
    },
  };
}

function videoRef(page = 22): VideoRef {
  return createVideoRef({
    aid: 2_803_108_323,
    bvid: BVID,
    canonicalUrl: `https://www.bilibili.com/video/${BVID}${
      page === 1 ? "" : `?p=${page}`
    }`,
    cid: 304_765_522,
    durationSec: 600,
    page,
    title: "3.1.3_栈的链式存储实现",
  });
}

function zhTrack() {
  return {
    ai_type: 0,
    id: 3_047_655,
    lan: "zh-CN",
    lan_doc: "中文（中国）",
    subtitle_url: BODY_URL,
  };
}

function createMemoryRepository(): BatchRepositoryPort {
  const jobs = new Map<string, BatchJob>();
  const items = new Map<string, BatchItem>();
  const subtitles = new Map<string, BatchSubtitle>();
  return {
    async commitSubtitle(item, subtitle) {
      const normalizedItem = createBatchItem(item);
      const normalizedSubtitle = createBatchSubtitle(subtitle);
      items.set(normalizedItem.batchItemId, normalizedItem);
      subtitles.set(normalizedSubtitle.batchItemId, normalizedSubtitle);
      return { item: normalizedItem, subtitle: normalizedSubtitle };
    },
    async createJob(job, list) {
      jobs.set(job.batchJobId, job);
      for (const item of list) items.set(item.batchItemId, item);
      return { items: list, job };
    },
    async deleteJob(batchJobId) {
      jobs.delete(batchJobId);
      for (const [key, item] of items) {
        if (item.batchJobId === batchJobId) {
          items.delete(key);
          subtitles.delete(key);
        }
      }
    },
    async listWorkspaceLists() {
      return [...jobs.values()].map((job) => ({ job, pinned: false }));
    },
    async listArchivedLists() {
      return [];
    },
    async listTrashedLists() {
      return [];
    },
    async restoreList() {
      return true;
    },
    async purgeList() {},
    async getRetentionPolicy() {
      return { durationDays: 7, kind: "duration" };
    },
    async updateRetentionPolicy() {},
    async permanentlyDeleteExpiredBatchTrash() {
      return [];
    },

    async renameList(batchJobId, name) {
      const job = jobs.get(batchJobId);
      if (job === undefined) return null;
      const next = { ...job, name };
      jobs.set(batchJobId, next);
      return next;
    },
    async setPinned() {
      return true;
    },
    async moveListToArchive() {},
    async moveListToTrash() {},
    async read(batchJobId) {
      const job = jobs.get(batchJobId);
      if (job === undefined) return null;
      return {
        items: [...items.values()]
          .filter((item) => item.batchJobId === batchJobId)
          .sort((left, right) => left.order - right.order),
        job,
      };
    },
    async readSubtitle(batchItemId) {
      return subtitles.get(batchItemId) ?? null;
    },
    async setSelection(batchJobId, selectedItemIds) {
      const selected = new Set(selectedItemIds);
      const next: BatchItem[] = [];
      for (const [key, item] of items) {
        if (item.batchJobId !== batchJobId) continue;
        const updated = createBatchItem({
          ...item,
          selected: selected.has(item.batchItemId),
        });
        items.set(key, updated);
        next.push(updated);
      }
      return next.sort((left, right) => left.order - right.order);
    },
    async updateItem(item) {
      items.set(item.batchItemId, item);
      return item;
    },
    async updateJobStatus(batchJobId, status) {
      const job = jobs.get(batchJobId);
      if (job === undefined) return null;
      const next = createBatchJob({ ...job, status, updatedAt: job.updatedAt });
      jobs.set(batchJobId, next);
      return next;
    },
    async writeSubtitle(subtitle) {
      const normalized = createBatchSubtitle(subtitle);
      subtitles.set(normalized.batchItemId, normalized);
      return normalized;
    },
  };
}

function sharedGatewayFetch(recorder: ChromeRecorder) {
  const pageFetch = createChromeBilibiliPageFetchFromChrome(recorder.chrome);
  return async (
    url: string,
    init: {
      readonly credentials: "include" | "omit";
      readonly headers: Readonly<Record<string, string>>;
      readonly method: "GET";
      readonly owner?: BilibiliSubtitleRequestOwner;
    },
  ) => {
    if (init.credentials === "include") {
      return pageFetch(url, {
        credentials: "include",
        headers: init.headers,
        method: "GET",
        ...(init.owner === undefined ? {} : { owner: init.owner }),
      });
    }
    // hdslb 正文：omit 直连（与共享 gateway 注入一致）。
    return pageFetch(url, {
      credentials: "omit",
      headers: init.headers,
      method: "GET",
      ...(init.owner === undefined ? {} : { owner: init.owner }),
    });
  };
}

function createBatchRuntimeHarness(recorder: ChromeRecorder, pages: number[]) {
  const repository = createMemoryRepository();
  const runtime = createBatchRuntime({
    browserSessionId: "browser-1",
    createId: (() => {
      let counter = 0;
      return () => `v16-id-${++counter}`;
    })(),
    gateway: createChromeBilibiliSubtitleGateway({
      createRequestNonce: () => globalThis.crypto.randomUUID(),
      fetch: sharedGatewayFetch(recorder),
      now: () => 1_700_000_000_000,
    }),
    now: () => 1_700_000_000_000,
    repository,
    resolver: {
      resolve: async () => videoRef(22),
    } as CanonicalVideoResolver,
    sourceGateway: {
      list: async (descriptor: BatchSourceDescriptor) => ({
        descriptor,
        items: pages.map((page) => ({
          aid: 2_803_108_323,
          bvid: BVID,
          cid: 304_765_522,
          page,
          title: `P${page}`,
        })),
        title: "验收锚点样例",
        total: pages.length,
        truncated: false,
      }),
    } as unknown as BatchSourceGateway,
  });
  return { repository, runtime };
}

describe("v16 batch direct acquisition transport (D1)", () => {
  it("performs zero tab ops and falls back to approved Cookie/DNR off-page authorization when no exact video page is open", async () => {
    const recorder = createChromeRecorder({
      playerBody: playerBody([zhTrack()]),
    });
    const pageFetch = createChromeBilibiliPageFetchFromChrome(recorder.chrome);

    const response = await pageFetch(PLAYER_URL, requestInit());

    // 退役受控页面租赁后，批量直接获取路径不得调用任何 tab 操作。
    expect(recorder.create).not.toHaveBeenCalled();
    expect(recorder.update).not.toHaveBeenCalled();
    expect(recorder.remove).not.toHaveBeenCalled();
    // 无精确视频页时页面注入不执行，直接走 Cookie/DNR 离页授权。
    expect(recorder.executeScript).not.toHaveBeenCalled();
    expect(response.authorizationContext).toBe("off-page");
    expect(await response.json()).toMatchObject({ code: 0 });
    expect(recorder.networkFetch).toHaveBeenCalled();
  });

  it("uses the exact open video page with zero tab creation when the page exists", async () => {
    const recorder = createChromeRecorder({
      playerBody: playerBody([]),
      userTabs: [{ id: 41, url: REFERER }],
    });
    const pageFetch = createChromeBilibiliPageFetchFromChrome(recorder.chrome);

    const response = await pageFetch(PLAYER_URL, requestInit());

    expect(response.authorizationContext).toBe("page");
    expect(await response.json()).toMatchObject({ code: 0 });
    expect(recorder.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({ target: { tabId: 41 }, world: "MAIN" }),
    );
    expect(recorder.create).not.toHaveBeenCalled();
    expect(recorder.update).not.toHaveBeenCalled();
    expect(recorder.remove).not.toHaveBeenCalled();
    expect(recorder.networkFetch).not.toHaveBeenCalled();
  });

  it("rejects a stale owner on the off-page path instead of opening a window", async () => {
    const recorder = createChromeRecorder({
      playerBody: playerBody([]),
    });
    const pageFetch = createChromeBilibiliPageFetchFromChrome(recorder.chrome);

    await expect(
      pageFetch(PLAYER_URL, {
        ...requestInit(),
        owner: { ...exactOwner, bvid: "BV1zzzzzzzzz" },
      }),
    ).rejects.toThrow(/owner identity/);
    expect(recorder.create).not.toHaveBeenCalled();
    expect(recorder.update).not.toHaveBeenCalled();
    expect(recorder.remove).not.toHaveBeenCalled();
  });

  it("discovers tracks and acquires the body through the shared authorized fetch with zero tab ops", async () => {
    const recorder = createChromeRecorder({
      bodyBody: {
        body: [
          { content: "集成锚点一", from: 0, to: 1.25 },
          { content: "集成锚点二", from: 1.25, to: 2.75 },
        ],
      },
      navBody: navBody(),
      playerBody: playerBody([zhTrack()]),
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      createRequestNonce: () => "v16-nonce-0123456789abcdef",
      fetch: sharedGatewayFetch(recorder),
      now: () => 1_700_000_000_000,
    });
    const video = videoRef(22);

    const tracks = await gateway.listTracks(video);
    const acquired = await gateway.acquire(video, tracks[0].trackId);

    expect(tracks.map((track) => track.trackId)).toEqual(["id:3047655"]);
    expect(acquired.rows.map((row) => row.text)).toEqual([
      "集成锚点一",
      "集成锚点二",
    ]);
    expect(recorder.create).not.toHaveBeenCalled();
    expect(recorder.update).not.toHaveBeenCalled();
    expect(recorder.remove).not.toHaveBeenCalled();
    // 发现（credentials include）与正文（hdslb omit 直连）都经由共享授权 fetch。
    const paths = recorder.requestedUrls.map((url) => new URL(url).pathname);
    expect(paths).toContain("/x/player/v2");
    expect(recorder.requestedUrls).toContain(BODY_URL);
  });

  it("keeps the session workspace untouched when a batch succeeds through the shared gateway", async () => {
    const recorder = createChromeRecorder({
      bodyBody: { body: [{ content: "批量成功行", from: 0, to: 1 }] },
      navBody: navBody(),
      playerBody: playerBody([zhTrack()]),
    });
    const { repository, runtime } = createBatchRuntimeHarness(recorder, [22]);

    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: BVID,
      method: "direct",
    });
    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });

    expect(view.job.status).toBe("completed");
    expect(view.items[0].status).toBe("succeeded");
    expect(view.items[0].rowCount).toBe(1);
    expect(view.items[0]).not.toHaveProperty("resultSessionId");
    await expect(
      repository.readSubtitle!(view.items[0].batchItemId),
    ).resolves.toMatchObject({ language: "zh-CN", trackId: "id:3047655" });
    expect(recorder.create).not.toHaveBeenCalled();
    expect(recorder.update).not.toHaveBeenCalled();
    expect(recorder.remove).not.toHaveBeenCalled();
  });

  it.each([
    {
      expected: "all items succeed",
      pages: [22],
      expectedStatuses: ["succeeded"],
    },
    {
      expected:
        "partial success when one item cannot resolve to its exact page",
      pages: [22, 1],
      expectedStatuses: ["succeeded", "failed"],
    },
  ])("batch start: $expected", async ({ pages, expectedStatuses }) => {
    const recorder = createChromeRecorder({
      bodyBody: { body: [{ content: "参数化行", from: 0, to: 1 }] },
      navBody: navBody(),
      playerBody: playerBody([zhTrack()]),
    });
    const { runtime } = createBatchRuntimeHarness(recorder, pages);
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: BVID,
      method: "direct",
    });

    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });

    expect(view.items.map((item) => item.status)).toEqual(expectedStatuses);
    expect(recorder.create).not.toHaveBeenCalled();
    expect(recorder.update).not.toHaveBeenCalled();
    expect(recorder.remove).not.toHaveBeenCalled();
  });

  it("fails charged-content items stably with CHARGED_CONTENT_UNSUPPORTED", async () => {
    const recorder = createChromeRecorder({
      navBody: navBody(),
      playerBody: {
        code: 0,
        data: {
          is_ugc_pay_preview: false,
          is_upower_exclusive: true,
          is_upower_play: false,
          need_login_subtitle: true,
          subtitle: { subtitles: [] },
        },
      },
    });
    const { repository, runtime } = createBatchRuntimeHarness(recorder, [22]);
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: BVID,
      method: "direct",
    });

    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });
    expect(view.items[0].status).toBe("failed");
    // 充电/付费内容:批量条目稳定失败(不支持),不冒充页面、不尝试绕过。
    expect(view.items[0].errorCode).toBe("CHARGED_CONTENT_UNSUPPORTED");
    expect(view.items[0].retryable).toBe(false);
    await expect(
      repository.readSubtitle!(view.items[0].batchItemId),
    ).resolves.toBeNull();
    expect(recorder.create).not.toHaveBeenCalled();
    expect(recorder.update).not.toHaveBeenCalled();
    expect(recorder.remove).not.toHaveBeenCalled();
  });
});
