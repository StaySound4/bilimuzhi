import { describe, expect, it, vi } from "vitest";

import {
  createBatchRuntime,
  selectBatchTrack,
  type BatchJobView,
  type BatchSpeechClient,
  type BatchRepositoryPort,
} from "../../src/application/batch-runtime";
import type {
  BatchSourceGateway,
  BatchSourceItem,
  BatchSourceKind,
} from "../../src/application/batch-source-contract";
import type { BranchSubtitleAcquisitionService } from "../../src/application/branch-subtitle-acquisition";
import type { SessionRepository } from "../../src/application/session-repository";
import type {
  DirectSubtitleGateway,
  SubtitleTrackOption,
} from "../../src/application/subtitle-gateway";
import { SubtitleGatewayError } from "../../src/application/subtitle-gateway";
import type { SubtitleRepository } from "../../src/application/subtitle-repository";
import type {
  CanonicalVideoResolveInput,
  CanonicalVideoResolver,
} from "../../src/application/video-gateway";
import type { SubtitleAcquisitionOwner } from "../../src/application/subtitle-acquisition-contract";
import {
  createBatchItem,
  createBatchJob,
  createBatchSubtitle,
  createSession,
  createVideoRef,
  type BatchItem,
  type BatchJob,
  type BatchSubtitle,
  type Session,
  type VideoRef,
} from "../../src/domain";

const bvid = "BV1zt4y1z72D";

function videoRef(page: number): VideoRef {
  return createVideoRef({
    aid: 88_000_001,
    bvid,
    canonicalUrl: `https://www.bilibili.com/video/${bvid}${
      page === 1 ? "" : `?p=${page}`
    }`,
    cid: 30_000_000_000 + page,
    durationSec: 100,
    page,
    title: `P${page}`,
  });
}

function session(video: VideoRef): Session {
  return createSession({
    activeBranchId: null,
    createdAt: 1,
    customTitle: false,
    lastActivityAt: 1,
    selectionRevision: 0,
    sessionId: `session-${video.page}`,
    title: video.title,
    updatedAt: 1,
    videoKey: video.videoKey,
  });
}

function persistedSpeechOwner(
  suffix: string,
  page = 1,
): SubtitleAcquisitionOwner {
  return Object.freeze({
    acquisitionId: `speech-acquisition-${suffix}`,
    draftBranchId: `speech-branch-${suffix}`,
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: `session-${page}`,
    taskId: `speech-task-${suffix}`,
    videoKey: videoRef(page).videoKey,
  });
}

function runningSpeechItem(
  batchJobId: string,
  owner: SubtitleAcquisitionOwner,
): BatchItem {
  return {
    ...createBatchItem({
      batchItemId: `item-${batchJobId}`,
      batchJobId,
      bvid,
      errorCode: null,
      order: 0,
      page: 1,
      progress: { completed: 0, stage: "transcribing", total: 1 },
      resultBranchId: null,
      resultSessionId: null,
      rowCount: 0,
      selected: true,
      status: "running",
      title: "待恢复语音条目",
      trackId: null,
      updatedAt: 2,
      videoKey: videoRef(1).videoKey,
    }),
    acquisitionMethod: "speech",
    speechOwner: owner,
  } as BatchItem;
}

function runningSpeechJob(batchJobId: string): BatchJob {
  return createBatchJob({
    batchJobId,
    browserSessionId: "browser-1",
    createdAt: 1,
    method: "speech",
    sourceKind: "single-video",
    sourceLabel: "恢复语音任务",
    status: "running",
    updatedAt: 2,
  });
}

interface MemoryBatchRepository extends BatchRepositoryPort {
  readonly debugItems: () => readonly BatchItem[];
  readonly lifecycleMoves: Array<{
    readonly batchJobId: string;
    readonly target: "archive" | "trash";
    readonly meta?: { readonly trashOrigin: string };
  }>;
  readonly placements: Map<
    string,
    { readonly order: number; readonly pinned: boolean }
  >;
}

function createMemoryRepository(): MemoryBatchRepository {
  const jobs = new Map<string, BatchJob>();
  const items = new Map<string, BatchItem>();
  const subtitles = new Map<string, BatchSubtitle>();
  const placements = new Map<
    string,
    { readonly order: number; readonly pinned: boolean }
  >();
  const lifecycleMoves: Array<{
    readonly batchJobId: string;
    readonly target: "archive" | "trash";
    readonly meta?: { readonly trashOrigin: string };
  }> = [];
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
      placements.set(job.batchJobId, { order: job.createdAt, pinned: false });
      for (const item of list) items.set(item.batchItemId, item);
      return { items: list, job };
    },
    async appendSource(batchJobId, candidates) {
      const job = jobs.get(batchJobId)!;
      const existing = [...items.values()].filter(
        (item) => item.batchJobId === batchJobId,
      );
      const identities = new Set(
        existing.map(
          (item) =>
            `${item.bvid}:${item.aid ?? ""}:${item.cid ?? ""}:${item.page}`,
        ),
      );
      let duplicateCount = 0;
      const appended: BatchItem[] = [];
      for (const candidate of candidates) {
        const identity = `${candidate.bvid}:${candidate.aid ?? ""}:${candidate.cid ?? ""}:${candidate.page}`;
        if (identities.has(identity)) {
          duplicateCount += 1;
          continue;
        }
        identities.add(identity);
        const normalized = createBatchItem({
          ...candidate,
          order: existing.length + appended.length,
        });
        items.set(normalized.batchItemId, normalized);
        appended.push(normalized);
      }
      const ready = createBatchJob({ ...job, status: "ready" });
      jobs.set(batchJobId, ready);
      return {
        addedCount: appended.length,
        duplicateCount,
        items: [...existing, ...appended],
        job: ready,
      };
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
    async deleteSubtitle(batchItemId) {
      subtitles.delete(batchItemId);
    },
    async deleteItems(batchJobId, batchItemIds) {
      const target = new Set(batchItemIds);
      for (const [key, item] of items) {
        if (item.batchJobId !== batchJobId || !target.has(key)) continue;
        items.delete(key);
        subtitles.delete(key);
      }
    },
    async listWorkspaceLists() {
      return [...jobs.values()]
        .filter((job) => placements.has(job.batchJobId))
        .map((job) => ({
          job,
          pinned: placements.get(job.batchJobId)?.pinned ?? false,
        }));
    },
    async renameList(batchJobId, name) {
      const job = jobs.get(batchJobId);
      if (job === undefined) return null;
      const next = { ...job, name };
      jobs.set(batchJobId, next);
      return next;
    },
    async setPinned(batchJobId, pinned) {
      const current = placements.get(batchJobId);
      if (current === undefined) return false;
      placements.set(batchJobId, { order: current.order, pinned });
      return true;
    },
    async moveListToArchive(batchJobId) {
      lifecycleMoves.push({ batchJobId, target: "archive" });
      placements.delete(batchJobId);
    },
    async moveListToTrash(batchJobId, meta) {
      lifecycleMoves.push({ batchJobId, meta, target: "trash" });
      placements.delete(batchJobId);
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
    lifecycleMoves,
    placements,
  };
}

interface Harness {
  readonly acquireDirect: ReturnType<typeof vi.fn>;
  readonly listTracks: ReturnType<typeof vi.fn>;
  readonly lifecycleMoves: Array<{
    readonly batchJobId: string;
    readonly target: "archive" | "trash";
    readonly meta?: { readonly trashOrigin: string };
  }>;
  readonly repository: MemoryBatchRepository;
  readonly startDirect: ReturnType<typeof vi.fn>;
  readonly startSpeech: ReturnType<typeof vi.fn>;
  readonly statusSpeech: ReturnType<typeof vi.fn>;
  readonly speechClient: BatchSpeechClient;
  readonly createRuntime: (
    overrides?: Partial<{
      readonly existingContextRevision: number;
      readonly onUpdate: (view: BatchJobView) => void;
      readonly readSubtitleRows: (input: {
        readonly branchId: string;
        readonly sessionId: string;
      }) => Promise<{
        readonly language: string;
        readonly rows: readonly {
          readonly endMs: number;
          readonly startMs: number;
          readonly text: string;
        }[];
      } | null>;
      readonly repository: BatchRepositoryPort;
      readonly resolver: CanonicalVideoResolver;
      readonly sourceGateway: BatchSourceGateway;
      readonly speechClient: BatchSpeechClient;
    }>,
  ) => ReturnType<typeof createBatchRuntime>;
}
function createHarness(
  tracks: readonly SubtitleTrackOption[],
  pages: readonly number[],
): Harness {
  const listTracks = vi.fn(async () => tracks);
  const acquireDirect = vi.fn(async (_video: VideoRef, trackId: string) => ({
    language: trackId === "track-en" ? "en-US" : "zh-CN",
    rows: [{ endMs: 1_000, startMs: 0, text: "导出行" }],
  }));
  const startDirect = vi.fn(async ({ videoKey }: { videoKey: string }) => {
    const page = Number(videoKey.slice(videoKey.lastIndexOf(":") + 1));
    const video = videoRef(page);
    return {
      cancel: async () => undefined,
      owner: {
        acquisitionId: "a",
        draftBranchId: `branch-${page}`,
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: `session-${page}`,
        taskId: "t",
        videoKey: video.videoKey,
      },
      result: Promise.resolve({
        branch: { branchId: `branch-${page}` },
        placement: {},
        session: session(video),
        subtitle: { rows: [{ endMs: 1, startMs: 0, text: "行" }] },
      }),
    };
  });
  const speechOwner = {
    acquisitionId: "speech-acquisition",
    draftBranchId: "speech-branch-1",
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: "session-1",
    taskId: "speech-task-1",
    videoKey: videoRef(1).videoKey,
  };
  const startSpeech = vi.fn(async () => speechOwner);
  const statusSpeech = vi.fn(async () => ({
    browserSessionId: "browser-1",
    checkpoint: null,
    createdAt: 1,
    errorCode: null,
    owner: speechOwner,
    parameters: {
      model: "whisper-large-v3",
      provider: "groq",
      requestedLanguageMode: "zh",
      routingMode: "balanced",
    },
    progress: { completedChunks: 1, stage: "completed", totalChunks: 1 },
    status: "completed",
    updatedAt: 2,
  }));
  const repository = createMemoryRepository();
  const lifecycleMoves = repository.lifecycleMoves;
  const defaultSpeechClient = {
    active: vi.fn(async () => []),
    cancel: vi.fn(async () => true),
    result: vi.fn(async () => ({
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "语音字幕" }],
    })),
    start: startSpeech,
    status: statusSpeech,
  } as BatchSpeechClient;

  return {
    createRuntime(overrides = {}) {
      return createBatchRuntime({
        branchAcquisition: {
          startDirect,
        } as unknown as BranchSubtitleAcquisitionService,
        browserSessionId: "browser-1",
        createId: (() => {
          let counter = 0;
          return () => `id-${++counter}`;
        })(),
        gateway: {
          acquire: acquireDirect,
          listTracks,
        } as DirectSubtitleGateway,
        now: () => 1_700_000_000_000,
        onUpdate: overrides.onUpdate,
        readSubtitleRows:
          overrides.readSubtitleRows ??
          (async () => ({
            language: "zh-CN",
            rows: [{ endMs: 1_000, startMs: 0, text: "导出行" }],
          })),
        repository: overrides.repository ?? repository,
        resolver:
          overrides.resolver ??
          ({
            resolve: async (input) => {
              if (input.kind !== "identifier") throw new Error("unexpected");
              const url = new URL(input.value);
              return videoRef(Number(url.searchParams.get("p") ?? "1"));
            },
          } as CanonicalVideoResolver),
        sessionRepository: {
          create: async (video: VideoRef) => session(video),
        } as unknown as SessionRepository,
        speechClient: overrides.speechClient ?? defaultSpeechClient,
        sourceGateway:
          overrides.sourceGateway ??
          ({
            list: async (descriptor) => ({
              descriptor,
              items: pages.map((page) => ({
                bvid,
                page,
                title: `P${page}`,
              })),
              title: "测试来源",
              total: pages.length,
              truncated: false,
            }),
          } as BatchSourceGateway),
        subtitleRepository: {
          commitInitialAcquisition: vi.fn(),
          readAcquisitionContext: async () =>
            overrides.existingContextRevision === undefined
              ? null
              : {
                  expectedContextRevision: overrides.existingContextRevision,
                  session: session(videoRef(1)),
                  video: videoRef(1),
                },
        } as unknown as SubtitleRepository,
      });
    },
    acquireDirect,
    listTracks,
    lifecycleMoves,
    repository,
    startDirect,
    startSpeech,
    statusSpeech,
    speechClient: defaultSpeechClient,
  };
}

describe("selectBatchTrack", () => {
  const official: SubtitleTrackOption = {
    language: "zh-CN",
    name: "中文（中国）",
    source: "official",
    trackId: "track-official",
  };
  const officialCc: SubtitleTrackOption = {
    ...official,
    origin: "official-cc",
    trackId: "track-cc",
  };
  const userUpload: SubtitleTrackOption = {
    ...official,
    origin: "user-upload",
    trackId: "track-user",
  };
  const ai: SubtitleTrackOption = {
    language: "zh-CN",
    name: "AI 字幕",
    source: "ai",
    trackId: "track-ai",
  };
  const aiOrigin: SubtitleTrackOption = {
    ...ai,
    origin: "ai",
  };
  const english: SubtitleTrackOption = {
    language: "en-US",
    name: "English",
    source: "official",
    trackId: "track-en",
  };
  const englishCc: SubtitleTrackOption = {
    ...english,
    origin: "official-cc",
    trackId: "track-en-cc",
  };
  const japanese: SubtitleTrackOption = {
    language: "ja-JP",
    name: "日本語",
    source: "ai",
    trackId: "track-ja",
  };

  it("prefers an official track over an AI track for the same language", () => {
    expect(selectBatchTrack([ai, official], "")?.trackId).toBe(
      "track-official",
    );
  });

  it("prefers user-upload over official-cc over ai within the same language", () => {
    expect(
      selectBatchTrack([officialCc, aiOrigin, userUpload], "zh")?.trackId,
    ).toBe("track-user");
    expect(selectBatchTrack([aiOrigin, officialCc], "zh")?.trackId).toBe(
      "track-cc",
    );
    expect(selectBatchTrack([userUpload, aiOrigin], "zh")?.trackId).toBe(
      "track-user",
    );
  });

  it("derives the sort tier from source for legacy tracks without origin", () => {
    // 旧数据无 origin：source official → 官方 CC 档，ai → AI 档；user-upload 仍最高。
    expect(selectBatchTrack([aiOrigin, official], "zh")?.trackId).toBe(
      "track-official",
    );
    expect(selectBatchTrack([official, userUpload], "zh")?.trackId).toBe(
      "track-user",
    );
    expect(selectBatchTrack([ai, officialCc], "zh")?.trackId).toBe("track-cc");
  });

  it("falls back to zh when the requested language has no track", () => {
    expect(selectBatchTrack([official, english], "ja")?.trackId).toBe(
      "track-official",
    );
    expect(selectBatchTrack([officialCc, englishCc], "en")?.trackId).toBe(
      "track-en-cc",
    );
  });

  it("refuses when neither the requested language nor zh has a track", () => {
    expect(selectBatchTrack([english], "ja")).toBeNull();
    expect(selectBatchTrack([japanese], "en")).toBeNull();
    expect(selectBatchTrack([], "zh")).toBeNull();
  });

  it("honours the requested language prefix", () => {
    expect(selectBatchTrack([official, english], "en")?.trackId).toBe(
      "track-en",
    );
  });

  it("prefix-matches zh against zh-Hans/zh-CN/zh-Hant", () => {
    const zhHans: SubtitleTrackOption = {
      language: "zh-Hans",
      name: "简体",
      origin: "official-cc",
      source: "official",
      trackId: "track-hans",
    };
    const zhHant: SubtitleTrackOption = {
      language: "zh-Hant",
      name: "繁體",
      origin: "official-cc",
      source: "official",
      trackId: "track-hant",
    };
    const zhCn: SubtitleTrackOption = {
      language: "zh-CN",
      name: "简体（中国）",
      origin: "official-cc",
      source: "official",
      trackId: "track-zhcn",
    };
    expect(selectBatchTrack([zhCn], "zh")?.trackId).toBe("track-zhcn");
    expect(selectBatchTrack([zhHant, zhHans], "zh")?.trackId).toBe(
      "track-hans",
    );
    expect(selectBatchTrack([englishCc, zhHans], "zh")?.trackId).toBe(
      "track-hans",
    );
  });

  it("keeps the automatic preference language-agnostic with priority ordering", () => {
    const zhAi: SubtitleTrackOption = {
      language: "zh-CN",
      name: "中文 AI",
      source: "ai",
      trackId: "track-zh-ai",
    };
    // 空偏好（自动）：维持现有兜底——不限语言，优先级排序取第一条。
    expect(selectBatchTrack([zhAi, englishCc], "")?.trackId).toBe(
      "track-en-cc",
    );
    expect(selectBatchTrack([englishCc, userUpload], "")?.trackId).toBe(
      "track-user",
    );
    expect(selectBatchTrack([zhAi], "")?.trackId).toBe("track-zh-ai");
  });

  it("sorts same-tier ties by trackId for a stable selection", () => {
    const trackA: SubtitleTrackOption = {
      language: "zh-CN",
      name: "A",
      origin: "official-cc",
      source: "official",
      trackId: "track-a",
    };
    const trackB: SubtitleTrackOption = {
      ...trackA,
      trackId: "track-b",
    };
    expect(selectBatchTrack([trackB, trackA], "zh")?.trackId).toBe("track-a");
    expect(selectBatchTrack([trackA, trackB], "")?.trackId).toBe("track-a");
  });
});

describe("BatchRuntime", () => {
  const tracks: readonly SubtitleTrackOption[] = [
    {
      language: "zh-CN",
      name: "中文",
      source: "official",
      trackId: "track-zh",
    },
  ];

  it("resolves every listed item to an exact VideoKey during preparation", async () => {
    const runtime = createHarness(tracks, [1, 2]).createRuntime();

    const view = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });

    expect(view.job.status).toBe("ready");
    expect(view.items.map((item) => item.videoKey)).toEqual([
      `bvid:${bvid}:cid:30000000001:p:1`,
      `bvid:${bvid}:cid:30000000002:p:2`,
    ]);
    expect(view.overwriteCount).toBe(0);
  });

  it("cancels only the active append, ignores late resolution and permits re-append", async () => {
    const harness = createHarness(tracks, []);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resolver = vi.fn(async () => {
      await blocked;
      return videoRef(1);
    });
    const runtime = harness.createRuntime({
      resolver: { resolve: resolver },
      sourceGateway: {
        list: vi.fn(async (descriptor) => ({
          descriptor,
          items: [{ bvid, page: 1, title: "P1" }],
          title: "来源",
          total: 1,
          truncated: false,
        })),
      },
    });
    const list = await runtime.createList!();
    const preparing = runtime.prepare({
      batchJobId: list.job.batchJobId,
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await vi.waitFor(async () => {
      expect((await runtime.read(list.job.batchJobId))?.job.status).toBe(
        "preparing",
      );
    });
    await runtime.cancel(list.job.batchJobId);
    release();
    const cancelled = await preparing;
    expect(cancelled.job.status).toBe("ready");
    expect(cancelled.items).toHaveLength(0);

    const appended = await runtime.prepare({
      batchJobId: list.job.batchJobId,
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    expect(appended.job.status).toBe("ready");
    expect(appended.items).toHaveLength(1);
  });

  it("stores a one-way search history digest without persisting free input", async () => {
    const repository = createMemoryRepository();
    let historyKey = "";
    repository.appendSource = vi.fn(async (batchJobId, items, history) => {
      historyKey = history.sourceKey;
      const job = (await repository.read(batchJobId))!.job;
      return { addedCount: items.length, duplicateCount: 0, items, job };
    });
    const runtime = createHarness(tracks, [1]).createRuntime({ repository });
    const list = await runtime.createList!();
    const keyword = "Bearer secret-token SESSDATA=abc 搜索词";
    await runtime.prepare({
      batchJobId: list.job.batchJobId,
      includeAllPages: false,
      input: keyword,
      method: "direct",
      sourceKind: "search",
    });
    expect(historyKey).toMatch(/^search:sha256:[0-9a-f]{64}$/);
    expect(historyKey).not.toContain(keyword);
    expect(historyKey).not.toMatch(/bearer|token|sessdata/i);
  });

  it.each<{
    input: string;
    kind: BatchSourceKind;
    sourceItem: BatchSourceItem;
    expectedPage: number;
  }>([
    {
      expectedPage: 1,
      input: bvid,
      kind: "single-video",
      sourceItem: { bvid, page: null, title: "单视频" },
    },
    {
      expectedPage: 1,
      input: "https://space.bilibili.com/12345",
      kind: "user-space",
      sourceItem: { bvid, page: null, title: "用户投稿" },
    },
    {
      expectedPage: 1,
      input: "https://space.bilibili.com/1/favlist?fid=9876",
      kind: "favorites",
      sourceItem: { bvid, page: null, title: "收藏视频" },
    },
    {
      expectedPage: 1,
      input:
        "https://space.bilibili.com/12345/channel/collectiondetail?sid=777",
      kind: "collection",
      sourceItem: { bvid, page: null, title: "合集视频" },
    },
    {
      expectedPage: 1,
      input: "组成原理",
      kind: "search",
      sourceItem: { bvid, page: null, title: "搜索视频" },
    },
    {
      expectedPage: 4,
      input: bvid,
      kind: "video-pages",
      sourceItem: {
        aid: 88_000_001,
        bvid,
        cid: 30_000_000_004,
        page: 4,
        title: "第四讲",
      },
    },
  ])(
    "persists canonical resolver AID/CID/page for $kind prepare rows",
    async ({ expectedPage, input, kind, sourceItem }) => {
      const canonical = videoRef(expectedPage);
      const harness = createHarness(tracks, []);
      const runtime = harness.createRuntime({
        resolver: {
          resolve: vi.fn(async () => canonical),
        },
        sourceGateway: {
          list: vi.fn(async (descriptor) => ({
            descriptor,
            items: [sourceItem],
            title: "身份测试来源",
            total: 1,
            truncated: false,
          })),
        },
      });

      const prepared = await runtime.prepare({
        includeAllPages: kind === "video-pages",
        input,
        method: "direct",
        sourceKind: kind,
      });

      expect(prepared.items[0]).toMatchObject({
        aid: canonical.aid,
        cid: canonical.cid,
        page: canonical.page,
        status: "pending",
        videoKey: canonical.videoKey,
      });
    },
  );

  it.each([
    {
      constraint: "AID",
      resolved: videoRef(1),
      sourceItem: {
        aid: 88_000_999,
        bvid,
        cid: 30_000_000_001,
        page: 1,
        title: "AID 冲突",
      },
    },
    {
      constraint: "CID",
      resolved: createVideoRef({
        ...videoRef(1),
        cid: 30_000_000_099,
      }),
      sourceItem: {
        aid: 88_000_001,
        bvid,
        cid: 30_000_000_001,
        page: 1,
        title: "CID 冲突",
      },
    },
    {
      constraint: "page",
      resolved: videoRef(2),
      sourceItem: {
        aid: 88_000_001,
        bvid,
        cid: 30_000_000_001,
        page: 1,
        title: "page 冲突",
      },
    },
  ])(
    "keeps a source-provided $constraint as a canonical resolution constraint",
    async ({ resolved, sourceItem }) => {
      const harness = createHarness(tracks, []);
      const runtime = harness.createRuntime({
        resolver: { resolve: vi.fn(async () => resolved) },
        sourceGateway: {
          list: vi.fn(async (descriptor) => ({
            descriptor,
            items: [sourceItem],
            title: "约束测试来源",
            total: 1,
            truncated: false,
          })),
        },
      });

      const prepared = await runtime.prepare({
        includeAllPages: true,
        input: bvid,
        method: "direct",
        sourceKind: "video-pages",
      });

      expect(prepared.items[0]).toMatchObject({
        errorCode: "VALIDATION_FAILED",
        status: "failed",
        videoKey: null,
      });
    },
  );

  it("keeps P1, P4 and P104 on their own CID while deferring track discovery until direct acquisition", async () => {
    const harness = createHarness(tracks, [1, 4, 104]);
    const runtime = harness.createRuntime();

    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });

    expect(prepared.items.map((entry) => entry.videoKey)).toEqual([
      `bvid:${bvid}:cid:30000000001:p:1`,
      `bvid:${bvid}:cid:30000000004:p:4`,
      `bvid:${bvid}:cid:30000000104:p:104`,
    ]);
    expect(harness.listTracks).not.toHaveBeenCalled();

    const completed = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });

    expect(completed.items.map((entry) => entry.status)).toEqual([
      "succeeded",
      "succeeded",
      "succeeded",
    ]);
    expect(harness.listTracks).toHaveBeenNthCalledWith(
      1,
      videoRef(1),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(harness.listTracks).toHaveBeenNthCalledWith(
      2,
      videoRef(4),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(harness.listTracks).toHaveBeenNthCalledWith(
      3,
      videoRef(104),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(harness.acquireDirect.mock.calls).toEqual([
      [
        videoRef(1),
        "track-zh",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ],
      [
        videoRef(4),
        "track-zh",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ],
      [
        videoRef(104),
        "track-zh",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ],
    ]);
    expect(harness.startDirect).not.toHaveBeenCalled();
  });

  it("publishes observable prepare stages and processed totals while resolving every row", async () => {
    const updates = vi.fn<(view: BatchJobView) => void>();
    const runtime = createHarness(tracks, [1, 4, 104]).createRuntime({
      onUpdate: updates,
    });

    await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });

    expect(updates).toHaveBeenCalled();
    expect(updates.mock.calls.map(([next]) => next.progress)).toEqual(
      expect.arrayContaining([
        { completed: 0, stage: "listing", total: 3 },
        { completed: 1, stage: "listing", total: 3 },
        { completed: 2, stage: "listing", total: 3 },
        { completed: 3, stage: "listing", total: 3 },
      ]),
    );
  });

  it("reports how many selected items would overwrite an existing independent BatchSubtitle", async () => {
    const harness = createHarness(tracks, [1]);
    const runtime = harness.createRuntime();

    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await harness.repository.writeSubtitle!(
      createBatchSubtitle({
        batchItemId: prepared.items[0].batchItemId,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "已有批量字幕" }],
        source: "official",
        trackId: "track-zh",
        updatedAt: 2,
      }),
    );
    const view = await runtime.read(prepared.job.batchJobId);

    expect(view?.overwriteCount).toBe(1);
  });

  it("retries an authorized failed direct overwrite instead of skipping the preserved old BatchSubtitle", async () => {
    const harness = createHarness(tracks, [1]);
    harness.acquireDirect.mockRejectedValueOnce(
      new SubtitleGatewayError("NETWORK_ERROR", "first overwrite failed", true),
    );
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    const batchItemId = prepared.items[0].batchItemId;
    await harness.repository.writeSubtitle!(
      createBatchSubtitle({
        batchItemId,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "必须保留的旧字幕" }],
        source: "official",
        trackId: "track-old",
        updatedAt: 1,
      }),
    );

    const failed = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      method: "direct",
      overwrite: "all",
    });

    expect(failed.items[0]).toMatchObject({
      acquisitionMethod: "direct",
      errorCode: "NETWORK_ERROR",
      retryable: true,
      status: "failed",
    });
    await expect(
      harness.repository.readSubtitle!(batchItemId),
    ).resolves.toMatchObject({
      rows: [{ text: "必须保留的旧字幕" }],
      trackId: "track-old",
    });

    const retried = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });

    expect(harness.acquireDirect).toHaveBeenCalledTimes(2);
    expect(retried.items[0]).toMatchObject({
      acquisitionMethod: "direct",
      errorCode: null,
      status: "succeeded",
      trackId: "track-zh",
    });
    await expect(
      harness.repository.readSubtitle!(batchItemId),
    ).resolves.toMatchObject({
      rows: [{ text: "导出行" }],
      trackId: "track-zh",
    });
  });

  it("preserves each selected item's acquisition method during a mixed retry with a direct overwrite", async () => {
    const harness = createHarness(tracks, [1, 2]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    const [directItem, speechItem] = prepared.items;
    await harness.repository.writeSubtitle!(
      createBatchSubtitle({
        batchItemId: directItem.batchItemId,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "旧 direct 字幕" }],
        source: "official",
        trackId: "track-old",
        updatedAt: 1,
      }),
    );
    await harness.repository.updateItem(
      createBatchItem({
        ...directItem,
        acquisitionMethod: "direct",
        errorCode: "NETWORK_ERROR",
        retryable: true,
        status: "failed",
      }),
    );
    await harness.repository.updateItem(
      createBatchItem({
        ...speechItem,
        acquisitionMethod: "speech",
        errorCode: "SPEECH_TRANSCRIPTION_FAILED",
        retryable: true,
        status: "failed",
      }),
    );

    const retried = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });

    expect(harness.acquireDirect).toHaveBeenCalledOnce();
    expect(harness.acquireDirect).toHaveBeenCalledWith(
      videoRef(1),
      "track-zh",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(harness.startSpeech).toHaveBeenCalledOnce();
    expect(harness.startSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        batchItemId: speechItem.batchItemId,
        videoKey: videoRef(2).videoKey,
      }),
    );
    expect(retried.items.map((entry) => entry.acquisitionMethod)).toEqual([
      "direct",
      "speech",
    ]);
  });

  it("discovers selectable tracks only after direct starts and honours the requested language", async () => {
    const selectableTracks: readonly SubtitleTrackOption[] = [
      {
        language: "zh-CN",
        name: "中文",
        source: "official",
        trackId: "track-zh",
      },
      {
        language: "en-US",
        name: "English",
        source: "official",
        trackId: "track-en",
      },
    ];
    const harness = createHarness(selectableTracks, [1, 2]);
    const runtime = harness.createRuntime();

    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    expect(prepared.items).toHaveLength(2);
    expect(prepared.items.map((entry) => entry.availableTracks)).toEqual([
      [],
      [],
    ]);
    expect(harness.listTracks).not.toHaveBeenCalled();

    await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "en",
    });
    expect(harness.acquireDirect).toHaveBeenNthCalledWith(
      1,
      videoRef(1),
      "track-en",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(harness.acquireDirect).toHaveBeenNthCalledWith(
      2,
      videoRef(2),
      "track-en",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("acquires each selected item into independent BatchSubtitle storage without Session results", async () => {
    const harness = createHarness(tracks, [1, 2]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });

    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });

    expect(harness.listTracks).toHaveBeenCalledTimes(2);
    expect(view.job.status).toBe("completed");
    expect(view.items.every((item) => item.status === "succeeded")).toBe(true);
    expect(view.items.map((item) => item.trackId)).toEqual([
      "track-zh",
      "track-zh",
    ]);
    expect(harness.acquireDirect).toHaveBeenCalledTimes(2);
    expect(harness.startDirect).not.toHaveBeenCalled();
    expect(view.items[0]).not.toHaveProperty("resultBranchId");
    expect(view.items[0]).not.toHaveProperty("resultSessionId");
    await expect(
      harness.repository.readSubtitle!(view.items[0].batchItemId),
    ).resolves.toMatchObject({ source: "official", trackId: "track-zh" });
  });

  it("keeps a partial success when one item has no matching track", async () => {
    const harness = createHarness(tracks, [1, 2]);
    harness.listTracks.mockImplementationOnce(async () => tracks);
    harness.listTracks.mockImplementationOnce(async () => []);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });

    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });

    expect(view.job.status).toBe("completed");
    expect(view.items.map((item) => item.status)).toEqual([
      "succeeded",
      "failed",
    ]);
    expect(view.items[1].errorCode).toBe("SUBTITLE_NOT_FOUND");
  });

  it("skips unselected items", async () => {
    const harness = createHarness(tracks, [1, 2]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    await runtime.setSelection(prepared.job.batchJobId, [
      prepared.items[0].batchItemId,
    ]);

    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });

    expect(harness.listTracks).toHaveBeenCalledOnce();
    expect(harness.acquireDirect).toHaveBeenCalledOnce();
    expect(harness.acquireDirect).toHaveBeenCalledWith(
      videoRef(1),
      "track-zh",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(view.items.map((item) => item.status)).toEqual([
      "succeeded",
      "pending",
    ]);
    expect(view.items[1].rowCount).toBe(0);
    expect(view.items[1]).not.toHaveProperty("resultBranchId");
    expect(view.items[1]).not.toHaveProperty("resultSessionId");
  });

  it("collects only committed subtitles for export", async () => {
    const harness = createHarness(tracks, [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });

    await expect(
      runtime.collectExport(prepared.job.batchJobId),
    ).resolves.toEqual([
      {
        bvid,
        language: "zh-CN",
        page: 1,
        rows: [{ endMs: 1_000, startMs: 0, text: "导出行" }],
        title: "P1",
      },
    ]);
  });

  it("collects only the successful rows selected at export time", async () => {
    const harness = createHarness(tracks, [1, 2]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });
    await runtime.setSelection(prepared.job.batchJobId, [
      prepared.items[0].batchItemId,
    ]);

    const exported = await runtime.collectExport(prepared.job.batchJobId);

    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ bvid, page: 1, title: "P1" });
  });

  it("runs speech directly for a selected item with no BatchSubtitle and never discovers direct tracks", async () => {
    const harness = createHarness(tracks, [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "speech",
      speechLanguageMode: "zh",
    });

    const completed = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });

    expect(harness.listTracks).not.toHaveBeenCalled();
    expect(harness.startDirect).not.toHaveBeenCalled();
    expect(harness.startSpeech).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedLanguageMode: "zh",
        routingMode: "balanced",
        videoKey: videoRef(1).videoKey,
      }),
    );
    expect(completed.items[0].status).toBe("succeeded");
    expect(completed.items[0]).not.toHaveProperty("resultSessionId");
    expect(completed.items[0]).not.toHaveProperty("resultBranchId");
    await expect(
      harness.repository.readSubtitle!(completed.items[0].batchItemId),
    ).resolves.toMatchObject({ source: "speech", trackId: null });
  });

  it.each([
    { speechLanguageMode: undefined, expected: "mixed" },
    { speechLanguageMode: "zh" as const, expected: "zh" },
    { speechLanguageMode: "en" as const, expected: "en" },
    { speechLanguageMode: "other" as const, expected: "other" },
  ])(
    "writes the session speech default $speechLanguageMode onto appended items and uses it",
    async ({ speechLanguageMode, expected }) => {
      const harness = createHarness([], [1]);
      const runtime = harness.createRuntime();
      const prepared = await runtime.prepare({
        includeAllPages: false,
        input: bvid,
        method: "speech",
        ...(speechLanguageMode === undefined ? {} : { speechLanguageMode }),
      });
      await runtime.start({
        batchJobId: prepared.job.batchJobId,
        languagePreference: "zh",
      });
      expect(harness.startSpeech).toHaveBeenCalledWith(
        expect.objectContaining({ requestedLanguageMode: expected }),
      );
    },
  );

  it("prefers the persisted per-item speech language mode over the append default", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "speech",
      speechLanguageMode: "zh",
    });
    await harness.repository.updateItem(
      createBatchItem({
        ...prepared.items[0],
        speechLanguageMode: "en",
      }),
    );
    await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });
    expect(harness.startSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ requestedLanguageMode: "en" }),
    );
  });

  it("passes the session speech routing mode to the speech client and defaults to balanced", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "speech",
    });
    await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      speechRoutingMode: "turbo-first",
    });
    expect(harness.startSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ routingMode: "turbo-first" }),
    );
  });

  it("persists a per-item speech language mode via setItemSpeechLanguage", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    const itemId = prepared.items[0].batchItemId;
    await runtime.setItemSpeechLanguage(
      prepared.job.batchJobId,
      itemId,
      "other",
    );
    expect(
      harness.repository
        .debugItems()
        .find((candidate) => candidate.batchItemId === itemId)
        ?.speechLanguageMode,
    ).toBe("other");
  });

  it("persists track origins into availableTracks after discovery", async () => {
    const tracksWithOrigin: readonly SubtitleTrackOption[] = [
      {
        language: "zh-CN",
        name: "中文",
        origin: "user-upload",
        source: "official",
        trackId: "track-zh",
      },
    ];
    const harness = createHarness(tracksWithOrigin, [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });
    expect(view.items[0].availableTracks?.[0]).toMatchObject({
      origin: "user-upload",
      trackId: "track-zh",
    });
    expect(
      harness.repository.debugItems()[0].availableTracks?.[0],
    ).toMatchObject({
      origin: "user-upload",
      trackId: "track-zh",
    });
  });
  it("does not treat a recorded direct network failure as an explicit no-subtitle speech candidate", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await harness.repository.updateItem(
      createBatchItem({
        ...prepared.items[0],
        acquisitionMethod: "direct",
        errorCode: "NETWORK_ERROR",
        retryable: true,
        status: "failed",
      }),
    );
    const completed = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      method: "speech",
    });

    expect(completed.items[0]).toMatchObject({
      errorCode: "NETWORK_ERROR",
      status: "failed",
    });
    expect(harness.startSpeech).not.toHaveBeenCalled();
  });

  it("retries a failed speech item through speech even when the job was originally prepared as direct", async () => {
    const harness = createHarness([], [1]);
    harness.statusSpeech
      .mockResolvedValueOnce({
        browserSessionId: "browser-1",
        checkpoint: null,
        createdAt: 1,
        errorCode: "SPEECH_TRANSCRIPTION_FAILED",
        owner: {
          acquisitionId: "speech-acquisition",
          draftBranchId: "speech-branch-1",
          expectedContextRevision: 1,
          expectedSelectionRevision: 0,
          sessionId: "session-1",
          taskId: "speech-task-1",
          videoKey: videoRef(1).videoKey,
        },
        parameters: {
          model: "whisper-large-v3",
          provider: "groq",
          requestedLanguageMode: "zh",
          routingMode: "balanced",
        },
        progress: { completedChunks: 0, stage: "transcribing", totalChunks: 1 },
        status: "failed",
        updatedAt: 2,
      })
      .mockResolvedValue({
        browserSessionId: "browser-1",
        checkpoint: null,
        createdAt: 3,
        errorCode: null,
        owner: {
          acquisitionId: "speech-acquisition",
          draftBranchId: "speech-branch-1",
          expectedContextRevision: 1,
          expectedSelectionRevision: 0,
          sessionId: "session-1",
          taskId: "speech-task-1",
          videoKey: videoRef(1).videoKey,
        },
        parameters: {
          model: "whisper-large-v3",
          provider: "groq",
          requestedLanguageMode: "zh",
          routingMode: "balanced",
        },
        progress: { completedChunks: 1, stage: "merging", totalChunks: 1 },
        status: "completed",
        updatedAt: 4,
      });
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });

    const failed = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      method: "speech",
    });
    expect(failed.items[0]).toMatchObject({
      errorCode: "SPEECH_TRANSCRIPTION_FAILED",
      status: "failed",
    });

    await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });
    expect(harness.startSpeech).toHaveBeenCalledTimes(2);
    expect(harness.startDirect).not.toHaveBeenCalled();
  });

  it("maps speech preparing/downloading byte progress (not chunk counts) into item progress", async () => {
    // 回归锚点:批量语音转录下载阶段显示 0MB/0MB。
    // 根因:runSpeechItem 把 completedChunks/totalChunks(下载阶段恒 0)当
    // 字节传给 progressLabel,而真实的字节进度在 record.progress.activity
    // (AsrMediaAcquisitionProgress.completedBytes) 与 audioPreparationBytes 里。
    const owner = persistedSpeechOwner("bytes-progress");
    const status = vi
      .fn()
      .mockResolvedValueOnce(
        Object.freeze({
          browserSessionId: "browser-1",
          checkpoint: null,
          createdAt: 1,
          errorCode: null,
          owner,
          parameters: Object.freeze({
            model: "whisper-large-v3",
            provider: "groq" as const,
            requestedLanguageMode: "zh" as const,
            routingMode: "balanced" as const,
          }),
          progress: Object.freeze({
            activity: Object.freeze({
              completedBytes: 12 * 1_048_576,
              phase: "downloading" as const,
              totalBytes: 48 * 1_048_576,
            }),
            completedChunks: 0,
            stage: "preparing" as const,
            totalChunks: 0,
          }),
          status: "running" as const,
          updatedAt: 2,
        }),
      )
      .mockResolvedValueOnce(
        Object.freeze({
          browserSessionId: "browser-1",
          checkpoint: null,
          createdAt: 1,
          errorCode: null,
          owner,
          parameters: Object.freeze({
            model: "whisper-large-v3",
            provider: "groq" as const,
            requestedLanguageMode: "zh" as const,
            routingMode: "balanced" as const,
          }),
          progress: Object.freeze({
            completedChunks: 3,
            stage: "transcribing" as const,
            totalChunks: 10,
          }),
          status: "running" as const,
          updatedAt: 3,
        }),
      )
      .mockResolvedValue(
        Object.freeze({
          browserSessionId: "browser-1",
          checkpoint: null,
          createdAt: 1,
          errorCode: null,
          owner,
          parameters: Object.freeze({
            model: "whisper-large-v3",
            provider: "groq" as const,
            requestedLanguageMode: "zh" as const,
            routingMode: "balanced" as const,
          }),
          progress: Object.freeze({
            completedChunks: 10,
            stage: "merging" as const,
            totalChunks: 10,
          }),
          status: "completed" as const,
          updatedAt: 4,
        }),
      );
    const updates: {
      readonly stage: string;
      readonly completed: number;
      readonly total: number;
      readonly unit?: string;
    }[] = [];
    const repository = createMemoryRepository();
    const runtime = createHarness([], [1]).createRuntime({
      onUpdate: (view) => {
        const progress = view.items[0]?.progress;
        if (progress !== null && progress !== undefined) {
          updates.push({
            completed: progress.completed,
            stage: progress.stage,
            total: progress.total,
            unit: progress.unit,
          });
        }
      },
      repository,
      speechClient: {
        cancel: vi.fn(async () => true),
        result: vi.fn(async () => ({
          language: "zh-CN",
          rows: [{ endMs: 1_000, startMs: 0, text: "语音字幕" }],
        })),
        start: vi.fn(async () => owner),
        status,
      },
    });
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      method: "speech",
    });

    // 下载阶段:completed/total 必须是字节(12MB/48MB),不是分片 0/0。
    const preparing = updates.find((u) => u.stage === "preparing");
    expect(preparing).not.toBeUndefined();
    expect(preparing!.completed).toBe(12 * 1_048_576);
    expect(preparing!.total).toBe(48 * 1_048_576);
    expect(preparing!.unit).toBe("bytes");
    // 转写阶段:保持分片语义(3/10)。
    const transcribing = updates.find((u) => u.stage === "transcribing");
    expect(transcribing).not.toBeUndefined();
    expect(transcribing!.completed).toBe(3);
    expect(transcribing!.total).toBe(10);
  });

  it("reconciles a persisted speech item from its independently committed BatchSubtitle without restarting or reading Session data", async () => {
    const owner = persistedSpeechOwner("recovered");
    const repository = createMemoryRepository();
    await repository.createJob(runningSpeechJob("job-recovered"), [
      runningSpeechItem("job-recovered", owner),
    ]);
    await repository.writeSubtitle!(
      createBatchSubtitle({
        batchItemId: "item-job-recovered",
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "恢复后的字幕" }],
        source: "speech",
        trackId: null,
        updatedAt: 3,
      }),
    );
    const start = vi.fn();
    const status = vi.fn(async () =>
      Object.freeze({
        browserSessionId: "browser-1",
        checkpoint: null,
        createdAt: 1,
        errorCode: null,
        owner,
        parameters: Object.freeze({
          model: "whisper-large-v3",
          provider: "groq" as const,
          requestedLanguageMode: "zh" as const,
          routingMode: "balanced" as const,
        }),
        progress: Object.freeze({
          completedChunks: 1,
          stage: "merging" as const,
          totalChunks: 1,
        }),
        status: "completed" as const,
        updatedAt: 3,
      }),
    );
    const readSubtitleRows = vi.fn(async () => ({
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "恢复后的字幕" }],
    }));
    const runtime = createHarness([], [1]).createRuntime({
      readSubtitleRows,
      repository,
      speechClient: {
        cancel: vi.fn(async () => true),
        result: vi.fn(async () => ({
          language: "zh-CN",
          rows: [{ endMs: 1_000, startMs: 0, text: "恢复后的字幕" }],
        })),
        start,
        status,
      },
    });

    await runtime.reconcile();
    const first = await runtime.read("job-recovered");
    const second = await runtime.read("job-recovered");

    expect(first?.items[0]).toMatchObject({ rowCount: 1, status: "succeeded" });
    expect(first?.items[0]).not.toHaveProperty("resultBranchId");
    expect(first?.items[0]).not.toHaveProperty("resultSessionId");
    expect(second?.items[0].status).toBe("succeeded");
    expect(start).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
    expect(readSubtitleRows).not.toHaveBeenCalled();
    await expect(
      repository.readSubtitle!(first!.items[0].batchItemId),
    ).resolves.toMatchObject({
      rows: [{ text: "恢复后的字幕" }],
      source: "speech",
    });
  });

  it("reconstructs persisted speech ownership before cancel and delete after a worker restart", async () => {
    const cancelOwner = persistedSpeechOwner("cancel");
    const cancelRepository = createMemoryRepository();
    await cancelRepository.createJob(runningSpeechJob("job-cancel"), [
      runningSpeechItem("job-cancel", cancelOwner),
    ]);
    const cancel = vi.fn(async () => true);
    const cancelRuntime = createHarness([], [1]).createRuntime({
      repository: cancelRepository,
      speechClient: {
        cancel: vi.fn(async () => true),
        cancelItem: cancel,
        start: vi.fn(),
        status: vi.fn(),
      },
    });

    await cancelRuntime.cancel("job-cancel");
    expect(cancel).toHaveBeenCalledWith("item-job-cancel");

    const deleteOwner = persistedSpeechOwner("delete");
    const deleteRepository = createMemoryRepository();
    await deleteRepository.createJob(runningSpeechJob("job-delete"), [
      runningSpeechItem("job-delete", deleteOwner),
    ]);
    const cancelBeforeDelete = vi.fn(async () => true);
    const deleteRuntime = createHarness([], [1]).createRuntime({
      repository: deleteRepository,
      speechClient: {
        cancel: vi.fn(async () => true),
        cancelItem: cancelBeforeDelete,
        start: vi.fn(),
        status: vi.fn(),
      },
    });

    await deleteRuntime.deleteJob("job-delete");
    expect(cancelBeforeDelete).toHaveBeenCalledWith("item-job-delete");
    await expect(deleteRepository.read("job-delete")).resolves.toBeNull();
  });

  it("marks an item failed without aborting the job when acquisition throws", async () => {
    const harness = createHarness(tracks, [1, 2]);
    harness.acquireDirect.mockImplementationOnce(async () => {
      throw new SubtitleGatewayError("NETWORK_ERROR", "boom", true);
    });
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });

    const view = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });

    expect(view.items[0]).toMatchObject({
      errorCode: "NETWORK_ERROR",
      status: "failed",
    });
    expect(view.items[1].status).toBe("succeeded");
  });

  it("cancels the active independent batch run while leaving not-started items resumable", async () => {
    const harness = createHarness(tracks, [1, 2]);
    const commitSubtitle = vi.fn(
      harness.repository.commitSubtitle!.bind(harness.repository),
    );
    let finishActive!: (value: unknown) => void;
    const activeResult = new Promise((resolve) => {
      finishActive = resolve;
    });
    harness.acquireDirect.mockImplementationOnce(async () => activeResult);
    const runtime = harness.createRuntime({
      repository: { ...harness.repository, commitSubtitle },
    });
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });

    const running = runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });
    await vi.waitFor(() =>
      expect(harness.acquireDirect).toHaveBeenCalledOnce(),
    );
    await runtime.cancel(prepared.job.batchJobId);
    finishActive({
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "行" }],
    });
    const cancelled = await running;

    expect(cancelled.job.status).toBe("cancelled");
    expect(commitSubtitle).not.toHaveBeenCalled();
    await expect(
      harness.repository.readSubtitle!(prepared.items[0].batchItemId),
    ).resolves.toBeNull();
    expect(cancelled.items[0]).toMatchObject({
      acquisitionMethod: "direct",
      retryable: true,
      status: "cancelled",
    });
    expect(cancelled.items[1].status).toBe("pending");

    const resumed = await runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });
    expect(resumed.items[1].status).toBe("succeeded");
  });

  it("aborts the in-flight gateway request on cancel and never commits the late response", async () => {
    const harness = createHarness(tracks, [1]);
    let finishActive!: (value: unknown) => void;
    const activeResult = new Promise((resolve) => {
      finishActive = resolve;
    });
    const receivedSignals: AbortSignal[] = [];
    harness.acquireDirect.mockImplementationOnce((async (
      _video: VideoRef,
      _trackId: string,
      options?: { readonly signal?: AbortSignal },
    ) => {
      receivedSignals.push(options?.signal as AbortSignal);
      return activeResult;
    }) as never);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    const running = runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });
    await vi.waitFor(() =>
      expect(harness.acquireDirect).toHaveBeenCalledOnce(),
    );
    await runtime.cancel(prepared.job.batchJobId);

    expect(receivedSignals[0]?.aborted).toBe(true);
    finishActive({
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "行" }],
    });
    const cancelled = await running;
    expect(cancelled.job.status).toBe("cancelled");
    expect(cancelled.items[0]).toMatchObject({
      retryable: true,
      status: "cancelled",
    });
    await expect(
      harness.repository.readSubtitle!(prepared.items[0].batchItemId),
    ).resolves.toBeNull();
  });

  it("deletes a running batch completely without leaving orphaned rows", async () => {
    const harness = createHarness(tracks, [1]);
    let finishActive!: (value: unknown) => void;
    const activeResult = new Promise((resolve) => {
      finishActive = resolve;
    });
    harness.acquireDirect.mockImplementationOnce(async () => activeResult);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    const running = runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "",
    });
    await vi.waitFor(() =>
      expect(harness.acquireDirect).toHaveBeenCalledOnce(),
    );
    await runtime.deleteJob(prepared.job.batchJobId);

    await expect(runtime.read(prepared.job.batchJobId)).resolves.toBeNull();
    await expect(runtime.listWorkspaceLists()).resolves.toEqual([]);
    finishActive({
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "行" }],
    });
    await expect(running).rejects.toThrow();
    expect(harness.repository.debugItems()).toHaveLength(0);
    await expect(
      harness.repository.readSubtitle!(prepared.items[0].batchItemId),
    ).resolves.toBeNull();
  });

  it("deletes a preparing batch completely while prepare is still parsing", async () => {
    const harness = createHarness(tracks, [1, 2]);
    let releaseResolve!: (video: VideoRef) => void;
    const pendingResolve = new Promise<VideoRef>((resolve) => {
      releaseResolve = resolve;
    });
    const runtime = harness.createRuntime({
      resolver: {
        resolve: async () => pendingResolve,
      } as unknown as CanonicalVideoResolver,
    });
    const preparing = runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    await vi.waitFor(async () => {
      expect((await harness.repository.listWorkspaceLists()).length).toBe(1);
    });
    const batchJobId = (await harness.repository.listWorkspaceLists())[0]!.job
      .batchJobId;

    await runtime.deleteJob(batchJobId);
    releaseResolve(videoRef(1));
    await expect(preparing).rejects.toThrow();
    await expect(runtime.read(batchJobId)).resolves.toBeNull();
    expect(harness.repository.debugItems()).toHaveLength(0);
  });

  it("settles a repeated delete without side effects", async () => {
    const harness = createHarness(tracks, [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    await runtime.deleteJob(prepared.job.batchJobId);
    await expect(
      runtime.deleteJob(prepared.job.batchJobId),
    ).resolves.toBeUndefined();
    await expect(runtime.read(prepared.job.batchJobId)).resolves.toBeNull();
    expect(harness.repository.debugItems()).toHaveLength(0);
  });

  it("stops parsing promptly when prepare is cancelled", async () => {
    const harness = createHarness(tracks, [1, 2, 3]);
    const resolvedPages: number[] = [];
    const runtime = harness.createRuntime({
      resolver: {
        resolve: async (input: CanonicalVideoResolveInput) => {
          if (input.kind !== "identifier") throw new Error("unexpected");
          const url = new URL(input.value);
          const page = Number(url.searchParams.get("p") ?? "1");
          resolvedPages.push(page);
          await new Promise((resolve) => setTimeout(resolve, 60));
          return videoRef(page);
        },
      } as unknown as CanonicalVideoResolver,
    });
    const preparing = runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    await vi.waitFor(() => expect(resolvedPages.length).toBeGreaterThan(0), {
      interval: 10,
      timeout: 2_000,
    });
    const batchJobId = (await harness.repository.listWorkspaceLists())[0]!.job
      .batchJobId;

    await runtime.cancel(batchJobId);
    const view = await preparing;
    expect(view.job.status).toBe("cancelled");
    expect(resolvedPages.length).toBeLessThan(3);
  });

  it("resets a stuck preparing job to ready on reconcile", async () => {
    const harness = createHarness(tracks, [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    // 模拟 SW 重启遗留：任务卡在 preparing。
    await harness.repository.updateJobStatus(
      prepared.job.batchJobId,
      "preparing",
    );
    await runtime.reconcile();
    const view = await runtime.read(prepared.job.batchJobId);
    expect(view?.job.status).toBe("ready");
  });
});
//
// D5：覆盖语义（skip/all）、refetchTrack、清除字幕、删除所选条目。
//
describe("D5 overwrite / refetch / clear / delete semantics", () => {
  const zhTrack: SubtitleTrackOption = {
    language: "zh-CN",
    name: "中文",
    source: "official",
    trackId: "track-zh",
  };
  const enTrack: SubtitleTrackOption = {
    language: "en-US",
    name: "English",
    source: "official",
    trackId: "track-en",
  };

  async function preparedWithSubtitle(
    harness: Harness,
    pages: readonly number[] = [1],
    subtitleTrackId = "track-zh",
    availableTracks: readonly SubtitleTrackOption[] = [zhTrack, enTrack],
  ): Promise<{
    readonly runtime: ReturnType<Harness["createRuntime"]>;
    readonly view: BatchJobView;
  }> {
    const runtime = harness.createRuntime();
    const view = await runtime.prepare({
      includeAllPages: pages.length > 1,
      input: bvid,
      method: "direct",
    });
    await harness.repository.writeSubtitle!(
      createBatchSubtitle({
        batchItemId: view.items[0].batchItemId,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "旧字幕" }],
        source: "official",
        trackId: subtitleTrackId,
        updatedAt: 2,
      }),
    );
    await harness.repository.updateItem(
      createBatchItem({
        ...view.items[0],
        acquisitionMethod: "direct",
        availableTracks: availableTracks.map((track) =>
          Object.freeze({ ...track }),
        ),
        rowCount: 1,
        status: "succeeded",
        trackId: subtitleTrackId,
      }),
    );
    return { runtime, view: (await runtime.read(view.job.batchJobId))! };
  }

  it("skips items that already own a subtitle under overwrite=skip", async () => {
    const harness = createHarness([zhTrack, enTrack], [1, 2]);
    const { runtime, view } = await preparedWithSubtitle(harness, [1, 2]);

    const finished = await runtime.start({
      batchJobId: view.job.batchJobId,
      languagePreference: "zh",
      method: "direct",
      overwrite: "skip",
    });

    expect(harness.acquireDirect).toHaveBeenCalledTimes(1);
    expect(finished.items[0]).toMatchObject({
      status: "succeeded",
      trackId: "track-zh",
    });
    expect(finished.items[1]).toMatchObject({ status: "succeeded" });
  });

  it("refetches every selected item including succeeded ones under overwrite=all", async () => {
    const harness = createHarness([zhTrack, enTrack], [1, 2]);
    const { runtime, view } = await preparedWithSubtitle(harness, [1, 2]);

    const finished = await runtime.start({
      batchJobId: view.job.batchJobId,
      languagePreference: "zh",
      method: "direct",
      overwrite: "all",
    });

    expect(harness.acquireDirect).toHaveBeenCalledTimes(2);
    await expect(
      harness.repository.readSubtitle!(view.items[0].batchItemId),
    ).resolves.toMatchObject({ rows: [{ text: "导出行" }] });
    expect(finished.items[0]).toMatchObject({
      status: "succeeded",
      trackId: "track-zh",
    });
  });

  it("keeps the authorized retry overwrite for failed/cancelled direct items without an explicit overwrite", async () => {
    const harness = createHarness([zhTrack], [1]);
    const { runtime, view } = await preparedWithSubtitle(harness, [1]);
    await harness.repository.updateItem(
      createBatchItem({
        ...view.items[0],
        errorCode: "NETWORK_ERROR",
        retryable: true,
        status: "failed",
      }),
    );

    const retried = await runtime.start({
      batchJobId: view.job.batchJobId,
      languagePreference: "zh",
    });

    expect(harness.acquireDirect).toHaveBeenCalledTimes(1);
    expect(retried.items[0]).toMatchObject({
      errorCode: null,
      status: "succeeded",
      trackId: "track-zh",
    });
  });

  it("still retries authorized failed direct items under an explicit overwrite=skip", async () => {
    const harness = createHarness([zhTrack], [1]);
    const { runtime, view } = await preparedWithSubtitle(harness, [1]);
    await harness.repository.updateItem(
      createBatchItem({
        ...view.items[0],
        errorCode: "NETWORK_ERROR",
        retryable: true,
        status: "failed",
      }),
    );

    const retried = await runtime.start({
      batchJobId: view.job.batchJobId,
      languagePreference: "zh",
      overwrite: "skip",
    });

    // 「重试所选」的「确定（跳过已有）」= skip：失败条目有旧字幕但 retryable，
    // 必须仍被重取（跳过的是成功条目，不是失败条目）。
    expect(harness.acquireDirect).toHaveBeenCalledTimes(1);
    expect(retried.items[0]).toMatchObject({
      errorCode: null,
      status: "succeeded",
      trackId: "track-zh",
    });
  });

  it("refetchTrack swaps the persisted subtitle and item track state on success", async () => {
    const harness = createHarness([zhTrack, enTrack], [1]);
    const { runtime, view } = await preparedWithSubtitle(harness, [1]);
    const item = view.items[0];

    const next = await runtime.refetchTrack(
      view.job.batchJobId,
      item.batchItemId,
      "track-en",
    );

    expect(harness.acquireDirect).toHaveBeenCalledWith(
      expect.anything(),
      "track-en",
    );
    expect(next?.items[0]).toMatchObject({
      rowCount: 1,
      selectedLanguage: null,
      selectedTrackId: "track-en",
      status: "succeeded",
      trackId: "track-en",
    });
    await expect(
      harness.repository.readSubtitle!(item.batchItemId),
    ).resolves.toMatchObject({
      language: "en-US",
      trackId: "track-en",
    });
  });

  it("refetchTrack falls back to the previous state and surfaces the error on failure", async () => {
    const harness = createHarness([zhTrack, enTrack], [1]);
    harness.acquireDirect.mockRejectedValueOnce(
      new SubtitleGatewayError("NETWORK_ERROR", "refetch failed", true),
    );
    const { runtime, view } = await preparedWithSubtitle(harness, [1]);
    const item = view.items[0];

    await expect(
      runtime.refetchTrack(view.job.batchJobId, item.batchItemId, "track-en"),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });

    expect(harness.repository.debugItems()).toHaveLength(1);
    expect(harness.repository.debugItems()[0]).toMatchObject({
      status: "succeeded",
      trackId: "track-zh",
    });
    await expect(
      harness.repository.readSubtitle!(item.batchItemId),
    ).resolves.toMatchObject({ trackId: "track-zh" });
  });

  it("refetchTrack refuses to commit after the job was cancelled (owner check)", async () => {
    const harness = createHarness([zhTrack, enTrack], [1]);
    const { runtime, view } = await preparedWithSubtitle(harness, [1]);
    const item = view.items[0];
    await runtime.cancel(view.job.batchJobId);

    await expect(
      runtime.refetchTrack(view.job.batchJobId, item.batchItemId, "track-en"),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(harness.repository.debugItems()[0]).toMatchObject({
      status: "succeeded",
      trackId: "track-zh",
    });
  });

  it("rejects a refetchTrack whose track does not belong to the item", async () => {
    const harness = createHarness([zhTrack, enTrack], [1]);
    const { runtime, view } = await preparedWithSubtitle(harness, [1]);

    await expect(
      runtime.refetchTrack(
        view.job.batchJobId,
        view.items[0].batchItemId,
        "no-such-track",
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    expect(harness.acquireDirect).not.toHaveBeenCalled();
  });

  it("clearSubtitles resets the item to a fresh unacquired state", async () => {
    const harness = createHarness([zhTrack], [1]);
    const { view } = await preparedWithSubtitle(harness, [1]);
    const item = view.items[0];
    const purgeItem = vi.fn(async () => undefined);
    const runtimeWithSpeech = harness.createRuntime({
      speechClient: {
        ...(harness.speechClient as unknown as object),
        purgeItem,
      } as unknown as BatchSpeechClient,
    });
    // 同一任务上补一个语音条目，验证 checkpoint 清理被触发。
    const speechItem = createBatchItem({
      ...item,
      acquisitionMethod: "speech",
      batchItemId: "item-speech",
      order: 1,
      title: "语音条目",
    });
    await harness.repository.updateItem(speechItem);
    await harness.repository.writeSubtitle!(
      createBatchSubtitle({
        batchItemId: "item-speech",
        language: "zh-CN",
        rows: [{ endMs: 1, startMs: 0, text: "语音字幕" }],
        source: "speech",
        trackId: null,
        updatedAt: 3,
      }),
    );

    const next = await runtimeWithSpeech.clearSubtitles(view.job.batchJobId, [
      item.batchItemId,
      "item-speech",
    ]);

    await expect(
      harness.repository.readSubtitle!(item.batchItemId),
    ).resolves.toBeNull();
    await expect(
      harness.repository.readSubtitle!("item-speech"),
    ).resolves.toBeNull();
    expect(purgeItem).toHaveBeenCalledWith("item-speech");
    expect(next?.items[0]).toMatchObject({
      acquisitionMethod: null,
      errorCode: null,
      retryable: false,
      rowCount: 0,
      selectedTrackId: null,
      status: "pending",
      trackId: null,
    });
  });

  it("deleteItems removes the chosen items, their subtitles and speech checkpoints", async () => {
    const harness = createHarness([zhTrack], [1, 2]);
    const runtime = harness.createRuntime();
    const view = await runtime.prepare({
      includeAllPages: true,
      input: bvid,
      method: "direct",
    });
    const [first, second] = view.items;
    await harness.repository.writeSubtitle!(
      createBatchSubtitle({
        batchItemId: first.batchItemId,
        language: "zh-CN",
        rows: [{ endMs: 1, startMs: 0, text: "字幕一" }],
        source: "official",
        trackId: "track-zh",
        updatedAt: 2,
      }),
    );
    await harness.repository.updateItem(
      createBatchItem({
        ...first,
        acquisitionMethod: "direct",
        rowCount: 1,
        status: "succeeded",
        trackId: "track-zh",
      }),
    );
    const purgeItem = vi.fn(async () => undefined);
    const runtimeWithSpeech = harness.createRuntime({
      speechClient: {
        ...(harness.speechClient as unknown as object),
        purgeItem,
      } as unknown as BatchSpeechClient,
    });

    const next = await runtimeWithSpeech.deleteItems(view.job.batchJobId, [
      first.batchItemId,
    ]);

    expect(next?.items.map((entry) => entry.batchItemId)).toEqual([
      second.batchItemId,
    ]);
    expect(harness.repository.debugItems()).toHaveLength(1);
    await expect(
      harness.repository.readSubtitle!(first.batchItemId),
    ).resolves.toBeNull();
    // 任务仍存在（空列表任务级删除不受影响）。
    expect((await runtime.listWorkspaceLists()).length).toBe(1);
    expect(purgeItem).not.toHaveBeenCalled();
  });

  it("deleteItems keeps the job as an empty list when every item is removed", async () => {
    const harness = createHarness([zhTrack], [1]);
    const { runtime, view } = await preparedWithSubtitle(harness, [1]);

    const next = await runtime.deleteItems(view.job.batchJobId, [
      view.items[0].batchItemId,
    ]);

    expect(next?.items).toEqual([]);
    expect(next?.job.status).toBe("ready");
    await expect(runtime.listWorkspaceLists()).resolves.toHaveLength(1);
  });
});

describe("v16 单一视频带分 P 地址（BV19E411D78Q?p=3）", () => {
  it("prepares exactly the requested part with its part title", async () => {
    const bvid3 = "BV19E411D78Q";
    const harness = createHarness([], []);
    const runtime = harness.createRuntime({
      resolver: {
        resolve: async (input: CanonicalVideoResolveInput) => {
          if (input.kind !== "identifier") throw new Error("unexpected");
          const url = new URL(input.value);
          const page = Number(url.searchParams.get("p") ?? "1");
          return createVideoRef({
            aid: 88_000_003,
            bvid: bvid3,
            canonicalUrl: `https://www.bilibili.com/video/${bvid3}?p=${page}`,
            cid: 30_000_000_000 + page,
            durationSec: 100,
            page,
            title: page === 3 ? "第三讲" : `P${page}`,
          });
        },
      } as unknown as CanonicalVideoResolver,
      sourceGateway: {
        list: async () => ({
          descriptor: {
            bvid: bvid3,
            kind: "single-video" as const,
            page: 3,
          },
          items: [
            {
              aid: 88_000_003,
              bvid: bvid3,
              cid: 30_000_000_003,
              page: 3,
              title: "第三讲",
            },
          ],
          title: "第三讲",
          total: 1,
          truncated: false,
        }),
      } as BatchSourceGateway,
    });

    const view = await runtime.prepare({
      includeAllPages: false,
      input: `https://www.bilibili.com/video/${bvid3}?p=3`,
      method: "direct",
    });

    expect(view.items).toHaveLength(1);
    expect(view.items[0]).toMatchObject({
      page: 3,
      title: "第三讲",
      videoKey: `bvid:${bvid3}:cid:30000000003:p:3`,
    });
    expect(view.job.sourceLabel).toBe("第三讲");
  });

  it("cancels a running list before archiving it and removes it from the workspace", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await harness.repository.placements.set(prepared.job.batchJobId, {
      order: prepared.job.createdAt,
      pinned: true,
    });
    // 运行中：archive 先取消（cancel 是幂等等待），再移动 placement。
    const started = runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
    });
    await runtime.archiveList(prepared.job.batchJobId);
    await started;
    expect(harness.lifecycleMoves[0]).toMatchObject({
      batchJobId: prepared.job.batchJobId,
      target: "archive",
    });
    expect(await runtime.listWorkspaceLists()).toHaveLength(0);
  });

  it("moves a stopped list to trash with workspace origin metadata", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await runtime.trashList(prepared.job.batchJobId);
    expect(harness.lifecycleMoves[0]).toMatchObject({
      batchJobId: prepared.job.batchJobId,
      target: "trash",
      meta: { trashOrigin: "workspace" },
    });
    expect(await runtime.listWorkspaceLists()).toHaveLength(0);
  });

  it("renames a list and keeps the user-entered name", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await runtime.renameList(prepared.job.batchJobId, "我的课程");
    const lists = await runtime.listWorkspaceLists();
    expect(lists[0]?.job.name).toBe("我的课程");
  });

  it("pins and unpins a workspace list", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await runtime.setPinned(prepared.job.batchJobId, true);
    expect(
      harness.repository.placements.get(prepared.job.batchJobId)?.pinned,
    ).toBe(true);
    await runtime.setPinned(prepared.job.batchJobId, false);
    expect(
      harness.repository.placements.get(prepared.job.batchJobId)?.pinned,
    ).toBe(false);
  });

  it("restores a trashed list to the workspace without auto-resuming a running job", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await runtime.trashList(prepared.job.batchJobId);
    // 置顶状态恢复保留。
    await harness.repository.placements.set(prepared.job.batchJobId, {
      order: prepared.job.createdAt,
      pinned: true,
    });
    await harness.repository.updateJobStatus(
      prepared.job.batchJobId,
      "running",
    );
    const restored = await runtime.restoreList(prepared.job.batchJobId);
    expect(restored?.job.status).toBe("ready");
    expect((await runtime.listWorkspaceLists())[0]?.pinned).toBe(true);
  });

  it("purges a trashed list and cancels first", async () => {
    const harness = createHarness([], [1]);
    const runtime = harness.createRuntime();
    const prepared = await runtime.prepare({
      includeAllPages: false,
      input: bvid,
      method: "direct",
    });
    await runtime.trashList(prepared.job.batchJobId);
    const cancelSpy = vi.spyOn(runtime, "cancel");
    await runtime.purgeList(prepared.job.batchJobId);
    expect(cancelSpy).toHaveBeenCalledWith(prepared.job.batchJobId);
    expect(await runtime.listTrashedLists()).toHaveLength(0);
    expect(await runtime.listWorkspaceLists()).toHaveLength(0);
  });
});
