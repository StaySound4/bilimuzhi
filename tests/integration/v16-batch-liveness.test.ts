import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBatchRuntime,
  type BatchRepositoryPort,
  type BatchRuntime,
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
import { installChromeBatchRuntimeListener } from "../../src/infrastructure/chrome-batch-runtime";
import { createChromeBilibiliSubtitleGateway } from "../../src/infrastructure/bilibili-subtitle-gateway";
import { createChromeBilibiliPageFetchFromChrome } from "../../src/infrastructure/chrome-bilibili-page-fetch";
import type { BilibiliSubtitleRequestOwner } from "../../src/infrastructure/bilibili-subtitle-gateway";

const BVID = "BV1b7411N798";
const BODY_URL =
  "https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1663062850788560269c8a416b6b8e19e76b6c1b2c46fz?auth_key=1700000000-0-0-abc";

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

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

interface ChromeRecorder {
  readonly chrome: Record<string, unknown>;
  readonly create: ReturnType<typeof vi.fn>;
  readonly networkFetch: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
  readonly requestedUrls: string[];
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
  const query = vi.fn(async () => [...(options.userTabs ?? [])]);
  const executeScript = vi.fn(async () => ({ result: options.playerBody }));
  const networkFetch = vi.fn(async (rawUrl: string) => {
    const url = new URL(rawUrl);
    requestedUrls.push(rawUrl);
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
      return jsonResponse({ body: [{ content: "行", from: 0, to: 1 }] });
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
      runtime: { id: "muzhi-v16-liveness-test" },
      scripting: { executeScript },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          remove: vi.fn(async () => undefined),
          set: vi.fn(async () => undefined),
        },
      },
      tabs: { create, query, remove: vi.fn(), update: vi.fn() },
    },
    create,
    networkFetch,
    query,
    requestedUrls,
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

function createMemoryRepository(): BatchRepositoryPort & {
  readonly debugItems: () => readonly BatchItem[];
} {
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
    debugItems(): readonly BatchItem[] {
      return [...items.values()];
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
      readonly signal?: AbortSignal;
    },
  ) => {
    return pageFetch(url, {
      credentials: init.credentials,
      headers: init.headers,
      method: "GET" as const,
      ...(init.owner === undefined ? {} : { owner: init.owner }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    });
  };
}

function createBatchRuntimeHarness(
  recorder: ChromeRecorder,
  pages: number[],
): ReturnType<typeof createBatchRuntimeHarnessWithOnUpdate> {
  return createBatchRuntimeHarnessWithOnUpdate(recorder, pages, undefined);
}

function createBatchRuntimeHarnessWithOnUpdate(
  recorder: ChromeRecorder,
  pages: number[],
  onUpdate:
    | ((view: {
        readonly job: { readonly status: string };
        readonly items: readonly { readonly status: string }[];
      }) => void)
    | undefined,
) {
  const repository = createMemoryRepository();
  const runtime = createBatchRuntime({
    browserSessionId: "browser-1",
    createId: (() => {
      let counter = 0;
      return () => `v16-liveness-id-${++counter}`;
    })(),
    gateway: createChromeBilibiliSubtitleGateway({
      createRequestNonce: () => globalThis.crypto.randomUUID(),
      fetch: sharedGatewayFetch(recorder),
      now: () => 1_700_000_000_000,
    }),
    now: () => 1_700_000_000_000,
    onUpdate,
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

describe("v16 batch liveness (D2)", () => {
  it("pushes running/progress updates to onUpdate while items are still in flight", async () => {
    // 回归锚点:用户报告批量获取过程中完全没有转圈/进度实时显示。
    // 根因是 start() 只在每个 item 完成后才 onUpdate,运行期间零推送。
    // 本测试:挂起正文请求,断言运行中已收到 status=running 的事件。
    const recorder = createChromeRecorder({
      navBody: navBody(),
      playerBody: playerBody([
        {
          ai_type: 0,
          id: 3_047_655,
          lan: "zh-CN",
          lan_doc: "中文（中国）",
          subtitle_url: BODY_URL,
        },
      ]),
    });
    let releaseBody!: (value: Response) => void;
    const pendingBody = new Promise<Response>((resolve) => {
      releaseBody = resolve;
    });
    const originalFetch = recorder.networkFetch.getMockImplementation() as
      ((rawUrl: string, init?: RequestInit) => Promise<Response>) | undefined;
    vi.mocked(recorder.networkFetch).mockImplementation(
      async (rawUrl: string, init?: RequestInit) => {
        if (rawUrl === BODY_URL) return pendingBody;
        return (
          originalFetch?.(rawUrl, init) ?? new Response(null, { status: 500 })
        );
      },
    );
    const updates: { status: string }[] = [];
    const onUpdate = (view: {
      job: { status: string };
      items: readonly { status: string }[];
    }): void => {
      updates.push({ status: view.job.status });
    };
    const { repository, runtime } = createBatchRuntimeHarnessWithOnUpdate(
      recorder,
      [22],
      onUpdate,
    );
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: BVID,
      method: "direct",
    });

    const running = runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });
    // 等待正文请求发出(运行中),此时应已收到 running 推送。
    await vi.waitFor(() => {
      expect(
        recorder.networkFetch.mock.calls.some((call) => call[0] === BODY_URL),
      ).toBe(true);
    });
    expect(updates.some((u) => u.status === "running")).toBe(true);

    // 完成并收尾
    releaseBody(jsonResponse({ body: [{ content: "行", from: 0, to: 1 }] }));
    const finished = await running;
    expect(finished.job.status).toBe("completed");
    expect(repository.debugItems()).toHaveLength(1);
  });

  it("aborts an in-flight off-page fetch on cancel and never commits a late response", async () => {
    const recorder = createChromeRecorder({
      navBody: navBody(),
      playerBody: playerBody([
        {
          ai_type: 0,
          id: 3_047_655,
          lan: "zh-CN",
          lan_doc: "中文（中国）",
          subtitle_url: BODY_URL,
        },
      ]),
    });
    let releaseBody!: (value: Response) => void;
    const pendingBody = new Promise<Response>((resolve) => {
      releaseBody = resolve;
    });
    // 正文请求挂起：模拟慢速 CDN。
    const originalFetch = recorder.networkFetch.getMockImplementation() as
      ((rawUrl: string, init?: RequestInit) => Promise<Response>) | undefined;
    vi.mocked(recorder.networkFetch).mockImplementation(
      async (rawUrl: string, init?: RequestInit) => {
        if (rawUrl === BODY_URL) return pendingBody;
        return (
          originalFetch?.(rawUrl, init) ?? new Response(null, { status: 500 })
        );
      },
    );
    const { repository, runtime } = createBatchRuntimeHarness(recorder, [22]);
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: BVID,
      method: "direct",
    });

    const running = runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });
    // 等待正文请求实际发出（拦截实现不写 requestedUrls，改查 mock 调用）。
    await vi.waitFor(() => {
      expect(
        recorder.networkFetch.mock.calls.some((call) => call[0] === BODY_URL),
      ).toBe(true);
    });
    await runtime.cancel(prepared.job.batchJobId);

    const bodyCall = recorder.networkFetch.mock.calls.find(
      (call) => call[0] === BODY_URL,
    );
    const signal = (bodyCall?.[1] as RequestInit | undefined)?.signal;
    expect(signal?.aborted).toBe(true);
    releaseBody(
      jsonResponse({ body: [{ content: "迟到行", from: 0, to: 1 }] }),
    );
    const cancelled = await running;
    expect(cancelled.job.status).toBe("cancelled");
    expect(cancelled.items[0].status).toBe("cancelled");
    await expect(
      repository.readSubtitle!(prepared.items[0].batchItemId),
    ).resolves.toBeNull();
    expect(repository.debugItems()).toHaveLength(1);
  });

  it("settles the SW batch command channel on an unexpected handler failure", async () => {
    let capturedListener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const sendMessage = vi.fn(async () => undefined);
    const chromeValue = {
      runtime: {
        id: "muzhi-v16-liveness-test",
        onMessage: {
          addListener: (listener: never) => {
            capturedListener = listener as never;
          },
        },
        sendMessage,
      },
    };
    const failingRuntime: BatchRuntime = {
      cancel: vi.fn(async () => null),
      collectExport: vi.fn(async () => []),
      deleteJob: vi.fn(async () => {
        throw new Error("boom");
      }),
      listWorkspaceLists: vi.fn(async () => []),
      listArchivedLists: vi.fn(async () => []),
      listTrashedLists: vi.fn(async () => []),
      restoreList: vi.fn(async () => null),
      purgeList: vi.fn(async () => undefined),
      getRetentionPolicy: vi.fn(async () => ({
        durationDays: 7,
        kind: "duration" as const,
      })),
      updateRetentionPolicy: vi.fn(async () => undefined),
      permanentlyDeleteExpiredBatchTrash: vi.fn(async () => []),

      renameList: vi.fn(async () => null),
      setPinned: vi.fn(async () => null),
      archiveList: vi.fn(async () => null),
      trashList: vi.fn(async () => null),
      prepare: vi.fn(async () => {
        throw new Error("boom");
      }),
      read: vi.fn(async () => null),
      reconcile: vi.fn(async () => undefined),
      setSelection: vi.fn(async () => null),
      setItemSpeechLanguage: vi.fn(async () => null),
      refetchTrack: vi.fn(async () => null),
      clearSubtitles: vi.fn(async () => null),
      deleteItems: vi.fn(async () => null),
      start: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    installChromeBatchRuntimeListener(chromeValue, {
      getRuntime: async () => failingRuntime,
    });

    const responses: unknown[] = [];
    const responded = new Promise<void>((resolve) => {
      const listener = capturedListener!;
      const keepAlive = listener(
        {
          payload: { batchJobId: "job-1" },
          protocolVersion: 1,
          requestId: "request-1",
          type: "muzhi.batch.delete",
        },
        {},
        (response) => {
          responses.push(response);
          resolve();
        },
      );
      expect(keepAlive).toBe(true);
    });
    await responded;

    expect(responses).toHaveLength(1);
    const response = responses[0] as {
      readonly payload: { readonly ok: boolean; readonly errorCode: string };
    };
    expect(response.payload.ok).toBe(false);
    expect(response.payload.errorCode).toBe("INTERNAL_ERROR");
  });

  it("settles the SW batch command channel on success without hanging the message port", async () => {
    let capturedListener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const chromeValue = {
      runtime: {
        id: "muzhi-v16-liveness-test",
        onMessage: {
          addListener: (listener: never) => {
            capturedListener = listener as never;
          },
        },
        sendMessage: vi.fn(async () => undefined),
      },
    };
    const view = {
      items: [] as readonly BatchItem[],
      job: createBatchJob({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
        method: "direct",
        sourceKind: "single-video",
        sourceLabel: "活性测试",
        status: "cancelled",
        updatedAt: 2,
      }),
      overwriteCount: 0,
    };
    const runtime: BatchRuntime = {
      cancel: vi.fn(async () => view),
      collectExport: vi.fn(async () => []),
      deleteJob: vi.fn(async () => undefined),
      listWorkspaceLists: vi.fn(async () => []),
      renameList: vi.fn(async () => null),
      setPinned: vi.fn(async () => null),
      archiveList: vi.fn(async () => null),
      trashList: vi.fn(async () => null),
      listArchivedLists: vi.fn(async () => []),
      listTrashedLists: vi.fn(async () => []),
      restoreList: vi.fn(async () => null),
      purgeList: vi.fn(async () => undefined),
      getRetentionPolicy: vi.fn(async () => ({
        durationDays: 7,
        kind: "duration" as const,
      })),
      updateRetentionPolicy: vi.fn(async () => undefined),
      permanentlyDeleteExpiredBatchTrash: vi.fn(async () => []),

      prepare: vi.fn(async () => view),
      read: vi.fn(async () => view),
      reconcile: vi.fn(async () => undefined),
      setSelection: vi.fn(async () => view),
      setItemSpeechLanguage: vi.fn(async () => view),
      refetchTrack: vi.fn(async () => view),
      clearSubtitles: vi.fn(async () => view),
      deleteItems: vi.fn(async () => view),
      start: vi.fn(async () => view),
    };
    installChromeBatchRuntimeListener(chromeValue, {
      getRuntime: async () => runtime,
    });

    const responses: unknown[] = [];
    const responded = new Promise<void>((resolve) => {
      const listener = capturedListener!;
      listener(
        {
          payload: { batchJobId: "job-1" },
          protocolVersion: 1,
          requestId: "request-2",
          type: "muzhi.batch.cancel",
        },
        {},
        (response) => {
          responses.push(response);
          resolve();
        },
      );
    });
    await responded;

    expect(responses).toHaveLength(1);
    const response = responses[0] as {
      readonly payload: { readonly ok: boolean; readonly data: unknown };
    };
    expect(response.payload.ok).toBe(true);
    expect(response.payload.data).toMatchObject({ overwriteCount: 0 });
  });
});

describe("v16 batch wire item-language validation", () => {
  it("accepts and dispatches the item-speech-language command so per-item speech mode persists", async () => {
    let capturedListener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const setItemSpeechLanguage = vi.fn(async () => null);
    const chromeValue = {
      runtime: {
        id: "muzhi-v16-wire-speech-language",
        onMessage: {
          addListener: (listener: never) => {
            capturedListener = listener as never;
          },
        },
        sendMessage: vi.fn(async () => undefined),
      },
    };
    installChromeBatchRuntimeListener(chromeValue, {
      getRuntime: async () =>
        ({
          cancel: vi.fn(async () => null),
          clearSubtitles: vi.fn(async () => null),
          collectExport: vi.fn(async () => []),
          deleteItems: vi.fn(async () => null),
          deleteJob: vi.fn(async () => undefined),
          listWorkspaceLists: vi.fn(async () => []),
          renameList: vi.fn(async () => null),
          setPinned: vi.fn(async () => null),
          archiveList: vi.fn(async () => null),
          trashList: vi.fn(async () => null),
          prepare: vi.fn(async () => ({})),
          read: vi.fn(async () => null),
          reconcile: vi.fn(async () => undefined),
          refetchTrack: vi.fn(async () => null),
          setSelection: vi.fn(async () => null),
          setItemSpeechLanguage,
          start: vi.fn(async () => ({})),
        }) as unknown as BatchRuntime,
    });

    const responses: unknown[] = [];
    const responded = new Promise<void>((resolve) => {
      const keepAlive = capturedListener!(
        {
          payload: {
            batchItemId: "item-1",
            batchJobId: "job-1",
            speechLanguageMode: "en",
          },
          protocolVersion: 1,
          requestId: "request-speech-language",
          type: "muzhi.batch.item-speech-language",
        },
        {},
        (response) => {
          responses.push(response);
          resolve();
        },
      );
      expect(keepAlive).toBe(true);
    });
    await responded;

    expect(setItemSpeechLanguage).toHaveBeenCalledWith("job-1", "item-1", "en");
    const response = responses[0] as {
      readonly payload: { readonly ok: boolean };
    };
    expect(response.payload.ok).toBe(true);
  });
  it("rejects an invalid item-speech-language speechLanguageMode", async () => {
    let capturedListener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    installChromeBatchRuntimeListener(
      {
        runtime: {
          id: "muzhi-v16-wire-speech-language-invalid",
          onMessage: {
            addListener: (listener: never) => {
              capturedListener = listener as never;
            },
          },
          sendMessage: vi.fn(async () => undefined),
        },
      },
      {
        getRuntime: async () =>
          ({
            cancel: vi.fn(async () => null),
            clearSubtitles: vi.fn(async () => null),
            collectExport: vi.fn(async () => []),
            deleteItems: vi.fn(async () => null),
            deleteJob: vi.fn(async () => undefined),
            listWorkspaceLists: vi.fn(async () => []),
            renameList: vi.fn(async () => null),
            setPinned: vi.fn(async () => null),
            archiveList: vi.fn(async () => null),
            trashList: vi.fn(async () => null),
            prepare: vi.fn(async () => ({})),
            read: vi.fn(async () => null),
            reconcile: vi.fn(async () => undefined),
            refetchTrack: vi.fn(async () => null),
            setSelection: vi.fn(async () => null),
            setItemSpeechLanguage: vi.fn(async () => null),
            start: vi.fn(async () => ({})),
          }) as unknown as BatchRuntime,
      },
    );
    expect(
      capturedListener!(
        {
          payload: {
            batchItemId: "item-1",
            batchJobId: "job-1",
            speechLanguageMode: "ko",
          },
          protocolVersion: 1,
          requestId: "request-speech-language-invalid",
          type: "muzhi.batch.item-speech-language",
        },
        {},
        vi.fn(),
      ),
    ).toBe(false);
  });
  it("accepts legacy v1 prepare payloads and strictly validates append batchJobId", async () => {
    let capturedListener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const prepare = vi.fn(async () => ({
      items: [],
      job: createBatchJob({
        batchJobId: "job-legacy",
        browserSessionId: "browser-1",
        createdAt: 1,
        method: "direct",
        sourceKind: "single-video",
        sourceLabel: "legacy",
        status: "ready",
        updatedAt: 1,
      }),
      overwriteCount: 0,
    }));
    installChromeBatchRuntimeListener(
      {
        runtime: {
          id: "transport-compat",
          onMessage: {
            addListener: (listener: never) => {
              capturedListener = listener as never;
            },
          },
          sendMessage: vi.fn(async () => undefined),
        },
      },
      {
        getRuntime: async () =>
          ({
            cancel: vi.fn(async () => null),
            collectExport: vi.fn(async () => []),
            deleteJob: vi.fn(async () => undefined),
            listWorkspaceLists: vi.fn(async () => []),
            renameList: vi.fn(async () => null),
            setPinned: vi.fn(async () => null),
            archiveList: vi.fn(async () => null),
            trashList: vi.fn(async () => null),
            listArchivedLists: vi.fn(async () => []),
            listTrashedLists: vi.fn(async () => []),
            restoreList: vi.fn(async () => null),
            purgeList: vi.fn(async () => undefined),
            getRetentionPolicy: vi.fn(async () => ({
              durationDays: 7,
              kind: "duration" as const,
            })),
            updateRetentionPolicy: vi.fn(async () => undefined),
            permanentlyDeleteExpiredBatchTrash: vi.fn(async () => []),

            listBatchTags: vi.fn(async () => []),
            createBatchTag: vi.fn(async (name: string) => ({
              name,
              order: 0,
              tagId: "tag-1",
            })),
            renameBatchTag: vi.fn(async () => null),
            deleteBatchTag: vi.fn(async () => undefined),
            moveBatchTag: vi.fn(async () => true),
            setListTags: vi.fn(async () => null),
            prepare,
            read: vi.fn(async () => null),
            reconcile: vi.fn(async () => undefined),
            setSelection: vi.fn(async () => null),
            setItemSpeechLanguage: vi.fn(async () => null),
            refetchTrack: vi.fn(async () => null),
            clearSubtitles: vi.fn(async () => null),
            deleteItems: vi.fn(async () => null),
            start: vi.fn(async () => {
              throw new Error("unused");
            }),
          }) as BatchRuntime,
      },
    );
    const send = (message: unknown) =>
      new Promise<unknown>((resolve) => {
        const accepted = capturedListener!(message, {}, resolve);
        expect(accepted).toBe(true);
      });

    const legacy = await send({
      payload: {
        includeAllPages: false,
        input: "BV1zt4y1z72D",
        method: "direct",
      },
      protocolVersion: 1,
      requestId: "legacy-prepare",
      type: "muzhi.batch.prepare",
    });
    expect((legacy as { payload: { ok: boolean } }).payload.ok).toBe(true);
    expect(prepare).toHaveBeenCalledWith({
      includeAllPages: false,
      input: "BV1zt4y1z72D",
      method: "direct",
    });
    const legacyAppend = await send({
      payload: {
        batchJobId: "job-existing",
        includeAllPages: false,
        input: "BV1zt4y1z72D",
        method: "direct",
      },
      protocolVersion: 1,
      requestId: "legacy-append-prepare",
      type: "muzhi.batch.prepare",
    });
    expect((legacyAppend as { payload: { ok: boolean } }).payload.ok).toBe(
      true,
    );
    expect(prepare).toHaveBeenLastCalledWith({
      batchJobId: "job-existing",
      includeAllPages: false,
      input: "BV1zt4y1z72D",
      method: "direct",
      operationId: "legacy-append-prepare",
    });

    expect(
      capturedListener!(
        {
          payload: {
            batchJobId: "../unsafe",
            includeAllPages: false,
            input: "BV1zt4y1z72D",
            method: "direct",
          },
          protocolVersion: 1,
          requestId: "unsafe-prepare",
          type: "muzhi.batch.prepare",
        },
        {},
        vi.fn(),
      ),
    ).toBe(false);
  });

  describe("v16 batch wire list lifecycle validation", () => {
    it("dispatches rename, pin, archive and trash commands with strict payloads", async () => {
      let capturedListener:
        | ((
            message: unknown,
            sender: unknown,
            sendResponse: (response: unknown) => void,
          ) => boolean)
        | undefined;
      const renameList = vi.fn(async () => null);
      const setPinned = vi.fn(async () => null);
      const archiveList = vi.fn(async () => null);
      const trashList = vi.fn(async () => null);
      installChromeBatchRuntimeListener(
        {
          runtime: {
            id: "muzhi-list-lifecycle-wire",
            onMessage: {
              addListener: (listener: never) => {
                capturedListener = listener as never;
              },
            },
            sendMessage: vi.fn(async () => undefined),
          },
        },
        {
          getRuntime: async () =>
            ({
              cancel: vi.fn(async () => null),
              clearSubtitles: vi.fn(async () => null),
              collectExport: vi.fn(async () => []),
              deleteItems: vi.fn(async () => null),
              deleteJob: vi.fn(async () => undefined),
              listWorkspaceLists: vi.fn(async () => []),
              prepare: vi.fn(async () => ({})),
              read: vi.fn(async () => null),
              reconcile: vi.fn(async () => undefined),
              refetchTrack: vi.fn(async () => null),
              renameList,
              setPinned,
              archiveList,
              trashList,
              setSelection: vi.fn(async () => null),
              setItemSpeechLanguage: vi.fn(async () => null),
              start: vi.fn(async () => ({})),
            }) as unknown as BatchRuntime,
        },
      );
      const listener = capturedListener!;
      const send = (message: unknown) =>
        new Promise<unknown>((resolve) => {
          expect(listener(message, {}, resolve)).toBe(true);
        });

      const renamed = await send({
        payload: { batchJobId: "job-1", name: "我的课程" },
        protocolVersion: 1,
        requestId: "rename-1",
        type: "muzhi.batch.list.rename",
      });
      expect((renamed as { payload: { ok: boolean } }).payload.ok).toBe(true);
      expect(renameList).toHaveBeenCalledWith("job-1", "我的课程");

      const pinned = await send({
        payload: { batchJobId: "job-1", pinned: true },
        protocolVersion: 1,
        requestId: "pin-1",
        type: "muzhi.batch.list.pin",
      });
      expect((pinned as { payload: { ok: boolean } }).payload.ok).toBe(true);
      expect(setPinned).toHaveBeenCalledWith("job-1", true);

      const archived = await send({
        payload: { batchJobId: "job-1" },
        protocolVersion: 1,
        requestId: "archive-1",
        type: "muzhi.batch.list.archive",
      });
      expect((archived as { payload: { ok: boolean } }).payload.ok).toBe(true);
      expect(archiveList).toHaveBeenCalledWith("job-1");

      const trashed = await send({
        payload: { batchJobId: "job-1" },
        protocolVersion: 1,
        requestId: "trash-1",
        type: "muzhi.batch.list.trash",
      });
      expect((trashed as { payload: { ok: boolean } }).payload.ok).toBe(true);
      expect(trashList).toHaveBeenCalledWith("job-1");
    });

    it("rejects empty rename names and non-boolean pinned payloads", async () => {
      let capturedListener:
        | ((
            message: unknown,
            sender: unknown,
            sendResponse: (response: unknown) => void,
          ) => boolean)
        | undefined;
      installChromeBatchRuntimeListener(
        {
          runtime: {
            id: "muzhi-list-lifecycle-wire-invalid",
            onMessage: {
              addListener: (listener: never) => {
                capturedListener = listener as never;
              },
            },
            sendMessage: vi.fn(async () => undefined),
          },
        },
        {
          getRuntime: async () =>
            ({
              cancel: vi.fn(async () => null),
              clearSubtitles: vi.fn(async () => null),
              collectExport: vi.fn(async () => []),
              deleteItems: vi.fn(async () => null),
              deleteJob: vi.fn(async () => undefined),
              listWorkspaceLists: vi.fn(async () => []),
              prepare: vi.fn(async () => ({})),
              read: vi.fn(async () => null),
              reconcile: vi.fn(async () => undefined),
              refetchTrack: vi.fn(async () => null),
              renameList: vi.fn(async () => null),
              setPinned: vi.fn(async () => null),
              archiveList: vi.fn(async () => null),
              trashList: vi.fn(async () => null),
              setSelection: vi.fn(async () => null),
              setItemSpeechLanguage: vi.fn(async () => null),
              start: vi.fn(async () => ({})),
            }) as unknown as BatchRuntime,
        },
      );
      const listener = capturedListener!;
      expect(
        listener(
          {
            payload: { batchJobId: "job-1", name: "   " },
            protocolVersion: 1,
            requestId: "rename-invalid",
            type: "muzhi.batch.list.rename",
          },
          {},
          vi.fn(),
        ),
      ).toBe(false);
      expect(
        listener(
          {
            payload: { batchJobId: "job-1", pinned: "yes" },
            protocolVersion: 1,
            requestId: "pin-invalid",
            type: "muzhi.batch.list.pin",
          },
          {},
          vi.fn(),
        ),
      ).toBe(false);
    });
  });

  describe("v16 batch wire archive/trash/tags commands", () => {
    it("dispatches archive/trash listing, restore, purge and tag commands", async () => {
      let capturedListener:
        | ((
            message: unknown,
            sender: unknown,
            sendResponse: (response: unknown) => void,
          ) => boolean)
        | undefined;
      const listArchivedLists = vi.fn(async () => []);
      const listTrashedLists = vi.fn(async () => []);
      const restoreList = vi.fn(async () => null);
      const purgeList = vi.fn(async () => undefined);
      const listBatchTags = vi.fn(async () => []);
      const createBatchTag = vi.fn(async (name: string) => ({
        name,
        order: 0,
        tagId: "tag-1",
      }));
      const renameBatchTag = vi.fn(async () => null);
      const deleteBatchTag = vi.fn(async () => undefined);
      const moveBatchTag = vi.fn(async () => true);
      const setListTags = vi.fn(async () => null);
      installChromeBatchRuntimeListener(
        {
          runtime: {
            id: "muzhi-archive-trash-wire",
            onMessage: {
              addListener: (listener: never) => {
                capturedListener = listener as never;
              },
            },
            sendMessage: vi.fn(async () => undefined),
          },
        },
        {
          getRuntime: async () =>
            ({
              cancel: vi.fn(async () => null),
              clearSubtitles: vi.fn(async () => null),
              collectExport: vi.fn(async () => []),
              deleteItems: vi.fn(async () => null),
              deleteJob: vi.fn(async () => undefined),
              listWorkspaceLists: vi.fn(async () => []),
              renameList: vi.fn(async () => null),
              setPinned: vi.fn(async () => null),
              archiveList: vi.fn(async () => null),
              trashList: vi.fn(async () => null),
              listArchivedLists,
              listTrashedLists,
              restoreList,
              purgeList,
              listBatchTags,
              createBatchTag,
              renameBatchTag,
              deleteBatchTag,
              moveBatchTag,
              setListTags,
              prepare: vi.fn(async () => ({})),
              read: vi.fn(async () => null),
              reconcile: vi.fn(async () => undefined),
              refetchTrack: vi.fn(async () => null),
              setSelection: vi.fn(async () => null),
              setItemSpeechLanguage: vi.fn(async () => null),
              start: vi.fn(async () => ({})),
            }) as unknown as BatchRuntime,
        },
      );
      const listener = capturedListener!;
      const send = (message: unknown) =>
        new Promise<unknown>((resolve) => {
          expect(listener(message, {}, resolve)).toBe(true);
        });

      await send({
        payload: {},
        protocolVersion: 1,
        requestId: "a1",
        type: "muzhi.batch.archive.lists",
      });
      expect(listArchivedLists).toHaveBeenCalled();
      await send({
        payload: {},
        protocolVersion: 1,
        requestId: "t1",
        type: "muzhi.batch.trash.lists",
      });
      expect(listTrashedLists).toHaveBeenCalled();
      await send({
        payload: { batchJobId: "job-1" },
        protocolVersion: 1,
        requestId: "r1",
        type: "muzhi.batch.list.restore",
      });
      expect(restoreList).toHaveBeenCalledWith("job-1");
      await send({
        payload: { batchJobId: "job-1" },
        protocolVersion: 1,
        requestId: "p1",
        type: "muzhi.batch.list.purge",
      });
      expect(purgeList).toHaveBeenCalledWith("job-1");
    });
  });
});
