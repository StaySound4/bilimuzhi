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
import { createChromeBilibiliPageFetchFromChrome } from "../../src/infrastructure/chrome-bilibili-page-fetch";

const BVID = "BV1b7411N798";
const USER_BODY_URL = "https://aisubtitle.hdslb.com/v16/fixture-user.json";
const CC_BODY_URL = "https://aisubtitle.hdslb.com/v16/fixture-cc.json";
const AI_BODY_URL = "https://aisubtitle.hdslb.com/v16/fixture-ai.json";
const EN_BODY_URL = "https://aisubtitle.hdslb.com/v16/fixture-en.json";

const WBI_KEYS = "0123456789abcdef0123456789abcdef";

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
    if (
      rawUrl === USER_BODY_URL ||
      rawUrl === CC_BODY_URL ||
      rawUrl === AI_BODY_URL ||
      rawUrl === EN_BODY_URL
    ) {
      return jsonResponse({
        body: [{ content: "正文行", from: 0, to: 1 }],
      });
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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function injected(body: unknown) {
  return [
    {
      frameId: 0,
      result: {
        body,
        bodyKind: "json",
        marker: "muzhi.bilibili.page-fetch.v1",
      },
    },
  ];
}

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

/** 用户上传轨道：player 列表带 author_mid。 */
function userUploadTrack() {
  return {
    ai_type: 0,
    author_mid: 123_456,
    id: 3_047_651,
    lan: "zh-CN",
    lan_doc: "用户上传",
    subtitle_url: USER_BODY_URL,
  };
}

/** 官方 CC 轨道：无 author_mid、非 AI。 */
function officialCcTrack() {
  return {
    ai_type: 0,
    id: 3_047_655,
    lan: "zh-CN",
    lan_doc: "中文（中国）",
    subtitle_url: CC_BODY_URL,
  };
}

/** AI 轨道：ai_type 非 0。 */
function aiTrack() {
  return {
    ai_type: 1,
    id: 3_047_660,
    lan: "zh-CN",
    lan_doc: "AI 字幕",
    subtitle_url: AI_BODY_URL,
  };
}

function englishTrack() {
  return {
    ai_type: 0,
    id: 3_047_670,
    lan: "en-US",
    lan_doc: "English",
    subtitle_url: EN_BODY_URL,
  };
}

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
    return pageFetch(url, {
      credentials: init.credentials,
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

const DISCOVERY_PATHS = new Set([
  "/x/player/v2",
  "/x/player/wbi/v2",
  "/x/v2/subtitle/web/view",
  "/x/player/v2/ai/subtitle/search/stat",
  "/x/web-interface/nav",
  "/x/web-interface/wbi/view/detail",
]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("v16 track priority and on-demand acquisition (D3)", () => {
  it("projects track origins during discovery without downloading any body", async () => {
    const recorder = createChromeRecorder({
      navBody: navBody(),
      playerBody: playerBody([
        officialCcTrack(),
        aiTrack(),
        userUploadTrack(),
        englishTrack(),
      ]),
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      createRequestNonce: () => "v16-nonce-0123456789abcdef",
      fetch: sharedGatewayFetch(recorder),
      now: () => 1_700_000_000_000,
    });
    const video = videoRef(22);

    const tracks = await gateway.listTracks(video);

    expect(
      tracks.map((track) => ({
        language: track.language,
        origin: track.origin,
        trackId: track.trackId,
      })),
    ).toEqual([
      // 列表保持发现顺序；优先级排序只发生在 selectBatchTrack 选择时。
      { language: "zh-CN", origin: "official-cc", trackId: "id:3047655" },
      { language: "zh-CN", origin: "ai", trackId: "id:3047660" },
      { language: "zh-CN", origin: "user-upload", trackId: "id:3047651" },
      { language: "en-US", origin: "official-cc", trackId: "id:3047670" },
    ]);
    // 请求计数断言：发现阶段只发清单请求，任何轨道正文都未被下载。
    for (const url of recorder.requestedUrls) {
      expect(DISCOVERY_PATHS.has(new URL(url).pathname)).toBe(true);
    }
    expect(recorder.requestedUrls).not.toContain(USER_BODY_URL);
    expect(recorder.requestedUrls).not.toContain(CC_BODY_URL);
    expect(recorder.requestedUrls).not.toContain(AI_BODY_URL);
    expect(recorder.requestedUrls).not.toContain(EN_BODY_URL);
  });

  it("acquires only the body of the selected track", async () => {
    const recorder = createChromeRecorder({
      navBody: navBody(),
      playerBody: playerBody([
        officialCcTrack(),
        aiTrack(),
        userUploadTrack(),
        englishTrack(),
      ]),
    });
    const gateway = createChromeBilibiliSubtitleGateway({
      createRequestNonce: () => "v16-nonce-0123456789abcdef",
      fetch: sharedGatewayFetch(recorder),
      now: () => 1_700_000_000_000,
    });
    const video = videoRef(22);

    const tracks = await gateway.listTracks(video);
    const userUpload = tracks.find((track) => track.origin === "user-upload");
    expect(userUpload).toBeDefined();
    const acquired = await gateway.acquire(video, userUpload!.trackId);

    expect(acquired.language).toBe("zh-CN");
    expect(acquired.trackOrigin).toBe("user-upload");
    // 请求计数断言：正文只请求被选中轨道（用户上传）的 URL。
    expect(recorder.requestedUrls).toContain(USER_BODY_URL);
    expect(recorder.requestedUrls).not.toContain(CC_BODY_URL);
    expect(recorder.requestedUrls).not.toContain(AI_BODY_URL);
    expect(recorder.requestedUrls).not.toContain(EN_BODY_URL);
  });

  it("selects user-upload first for zh and persists the chosen origin", async () => {
    const recorder = createChromeRecorder({
      navBody: navBody(),
      playerBody: playerBody([
        officialCcTrack(),
        aiTrack(),
        userUploadTrack(),
        englishTrack(),
      ]),
    });
    const { runtime } = createBatchRuntimeHarness(recorder, [22]);
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: BVID,
      method: "direct",
    });

    const zhView = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });
    expect(zhView.items[0].status).toBe("succeeded");
    expect(zhView.items[0].selectedTrackId).toBe("id:3047651");
    expect(
      zhView.items[0].availableTracks?.find(
        (track) => track.trackId === "id:3047651",
      )?.origin,
    ).toBe("user-upload");
    await expect(runtime.read(zhView.job.batchJobId)).resolves.toMatchObject({
      items: [{ status: "succeeded", trackId: "id:3047651" }],
    });
  });

  it("falls back to zh tracks when the requested language has no match", async () => {
    const recorder = createChromeRecorder({
      navBody: navBody(),
      playerBody: playerBody([officialCcTrack(), englishTrack()]),
    });
    const { runtime } = createBatchRuntimeHarness(recorder, [22]);
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: BVID,
      method: "direct",
    });

    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "ja",
    });

    expect(view.items[0].status).toBe("succeeded");
    // ja 无命中 → zh 回退选官方 CC（zh 语言内优先级最高档）。
    expect(view.items[0].selectedTrackId).toBe("id:3047655");
    expect(recorder.requestedUrls).toContain(CC_BODY_URL);
    expect(recorder.requestedUrls).not.toContain(EN_BODY_URL);
  });

  it("marks the item failed and retryable when neither the language nor zh has a track", async () => {
    const recorder = createChromeRecorder({
      navBody: navBody(),
      playerBody: playerBody([englishTrack()]),
    });
    const { runtime } = createBatchRuntimeHarness(recorder, [22]);
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: BVID,
      method: "direct",
    });

    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "ja",
    });

    expect(view.items[0].status).toBe("failed");
    expect(view.items[0].errorCode).toBe("SUBTITLE_NOT_FOUND");
    expect(view.items[0].retryable).toBe(true);
    // 失败路径也不应下载任何轨道正文。
    expect(recorder.requestedUrls).not.toContain(EN_BODY_URL);
  });
});
