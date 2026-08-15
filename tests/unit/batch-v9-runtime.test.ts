import { describe, expect, it, vi } from "vitest";

import {
  createBatchRuntime,
  type BatchJobView,
  type BatchRepositoryPort,
  type BatchRuntimeDependencies,
  type BatchSpeechClient,
} from "../../src/application/batch-runtime";
import type { BatchSourceGateway } from "../../src/application/batch-source-contract";
import type { BranchSubtitleAcquisitionService } from "../../src/application/branch-subtitle-acquisition";
import type { SessionRepository } from "../../src/application/session-repository";
import type { DirectSubtitleGateway } from "../../src/application/subtitle-gateway";
import type { SubtitleRepository } from "../../src/application/subtitle-repository";
import type { CanonicalVideoResolver } from "../../src/application/video-gateway";
import {
  createBatchItem,
  createBatchJob,
  createSession,
  createVideoRef,
  type BatchItem,
  type BatchJob,
  type SubtitleRow,
  type VideoRef,
} from "../../src/domain";

const bvid = "BV1zt4y1z72D";
const rows: readonly SubtitleRow[] = Object.freeze([
  Object.freeze({ startMs: 0, endMs: 1_000, text: "独立批量字幕" }),
]);

interface BatchSubtitleRecord {
  readonly batchItemId: string;
  readonly language: string;
  readonly rows: readonly SubtitleRow[];
  readonly source: "ai" | "official" | "speech";
  readonly trackId: string | null;
  readonly updatedAt: number;
}

interface IndependentBatchRepository extends BatchRepositoryPort {
  readSubtitle(batchItemId: string): Promise<BatchSubtitleRecord | null>;
  writeSubtitle(record: BatchSubtitleRecord): Promise<BatchSubtitleRecord>;
}

function videoRef(page: number): VideoRef {
  return createVideoRef({
    aid: 88_000_001,
    bvid,
    canonicalUrl: `https://www.bilibili.com/video/${bvid}${page === 1 ? "" : `?p=${page}`}`,
    cid: 31_000_000_000 + page,
    durationSec: 60,
    page,
    title: `V9 P${page}`,
  });
}

function createMemoryRepository(): IndependentBatchRepository {
  const jobs = new Map<string, BatchJob>();
  const items = new Map<string, BatchItem>();
  const subtitles = new Map<string, BatchSubtitleRecord>();

  return {
    async createJob(job, list) {
      jobs.set(job.batchJobId, job);
      for (const item of list) items.set(item.batchItemId, item);
      return { job, items: list };
    },
    async deleteJob(batchJobId) {
      jobs.delete(batchJobId);
      for (const [itemId, item] of items) {
        if (item.batchJobId !== batchJobId) continue;
        items.delete(itemId);
        subtitles.delete(itemId);
      }
    },
    async listWorkspaceLists() {
      return [];
    },
    async renameList() {
      return null;
    },
    async setPinned() {
      return true;
    },
    async moveListToArchive() {},
    async moveListToTrash() {},
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
        job,
        items: [...items.values()]
          .filter((item) => item.batchJobId === batchJobId)
          .sort((left, right) => left.order - right.order),
      };
    },
    async readSubtitle(batchItemId) {
      return subtitles.get(batchItemId) ?? null;
    },
    async setSelection(batchJobId, selectedItemIds) {
      const selected = new Set(selectedItemIds);
      const updated: BatchItem[] = [];
      for (const [itemId, item] of items) {
        if (item.batchJobId !== batchJobId) continue;
        const next = createBatchItem({
          ...item,
          selected: selected.has(item.batchItemId),
        });
        items.set(itemId, next);
        updated.push(next);
      }
      return updated;
    },
    async updateItem(item) {
      items.set(item.batchItemId, item);
      return item;
    },
    async updateJobStatus(batchJobId, status) {
      const current = jobs.get(batchJobId);
      if (current === undefined) return null;
      const next = createBatchJob({ ...current, status });
      jobs.set(batchJobId, next);
      return next;
    },
    async writeSubtitle(record) {
      subtitles.set(record.batchItemId, record);
      return record;
    },
  };
}

interface Harness {
  readonly acquireDirect: ReturnType<typeof vi.fn>;
  readonly branchDirect: ReturnType<typeof vi.fn>;
  readonly listTracks: ReturnType<typeof vi.fn>;
  readonly readSessionSubtitle: ReturnType<typeof vi.fn>;
  readonly repository: IndependentBatchRepository;
  readonly sessionCreate: ReturnType<typeof vi.fn>;
  readonly speechStart: ReturnType<typeof vi.fn>;
  readonly updates: BatchJobView[];
  readonly runtime: ReturnType<typeof createBatchRuntime>;
}

function createHarness(pages: readonly number[] = [1, 2]): Harness {
  const repository = createMemoryRepository();
  const updates: BatchJobView[] = [];
  const listTracks = vi.fn(async () => [
    {
      language: "zh-CN",
      name: "中文（中国）",
      source: "official" as const,
      trackId: "official-zh-CN",
    },
  ]);
  const acquireDirect = vi.fn(async () => ({ language: "zh-CN", rows }));
  const sessionCreate = vi.fn(async (video: VideoRef) =>
    createSession({
      activeBranchId: null,
      createdAt: 1,
      customTitle: false,
      lastActivityAt: 1,
      selectionRevision: 0,
      sessionId: `legacy-session-${video.page}`,
      title: video.title,
      updatedAt: 1,
      videoKey: video.videoKey,
    }),
  );
  const branchDirect = vi.fn(async ({ videoKey }: { videoKey: string }) => ({
    cancel: async () => undefined,
    owner: {
      acquisitionId: "legacy-acquisition",
      draftBranchId: "legacy-branch",
      expectedContextRevision: 1,
      expectedSelectionRevision: 0,
      sessionId: "legacy-session",
      taskId: "legacy-task",
      videoKey,
    },
    result: Promise.resolve({
      branch: { branchId: "legacy-branch" },
      placement: {},
      session: await sessionCreate(videoRef(1)),
      subtitle: { rows },
    }),
  }));
  sessionCreate.mockClear();
  const speechOwner = {
    acquisitionId: "speech-acquisition",
    draftBranchId: "speech-draft",
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: "legacy-speech-session",
    taskId: "speech-task",
    videoKey: videoRef(1).videoKey,
  };
  const speechStart = vi.fn(async () => speechOwner);
  const speechStatus = vi.fn(async () => ({
    browserSessionId: "browser-v9",
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
  const readSessionSubtitle = vi.fn(async () => ({
    language: "zh-CN",
    rows,
  }));
  let id = 0;

  const dependencies = {
    branchAcquisition: {
      startDirect: branchDirect,
    } as unknown as BranchSubtitleAcquisitionService,
    browserSessionId: "browser-v9",
    createId: () => `batch-v9-${++id}`,
    gateway: { acquire: acquireDirect, listTracks } as DirectSubtitleGateway,
    now: () => 1_721_000_000_000,
    onUpdate: (view: BatchJobView) => updates.push(view),
    readSubtitleRows: readSessionSubtitle,
    repository,
    resolver: {
      resolve: async (input: {
        readonly kind: string;
        readonly value?: string;
      }) => {
        if (input.kind !== "identifier" || input.value === undefined) {
          throw new Error("unexpected resolver input");
        }
        const url = new URL(input.value);
        return videoRef(Number(url.searchParams.get("p") ?? "1"));
      },
    } as CanonicalVideoResolver,
    sessionRepository: {
      create: sessionCreate,
    } as unknown as SessionRepository,
    speechClient: {
      cancel: vi.fn(async () => true),
      start: speechStart,
      status: speechStatus,
    } as unknown as BatchSpeechClient,
    sourceGateway: {
      list: async (descriptor: unknown) => ({
        descriptor,
        items: pages.map((page) => ({ bvid, page, title: `V9 P${page}` })),
        title: "V9 来源",
        total: pages.length,
        truncated: false,
      }),
    } as BatchSourceGateway,
    subtitleRepository: {
      readAcquisitionContext: vi.fn(async () => null),
    } as unknown as SubtitleRepository,
  } as unknown as BatchRuntimeDependencies;

  return {
    acquireDirect,
    branchDirect,
    listTracks,
    readSessionSubtitle,
    repository,
    runtime: createBatchRuntime(dependencies),
    sessionCreate,
    speechStart,
    updates,
  };
}

async function prepare(
  harness: Harness,
  method: "direct" | "speech" = "direct",
) {
  return harness.runtime.prepare({
    includeAllPages: true,
    input: bvid,
    method,
  });
}

describe("v9 独立批量运行时", () => {
  it("解析只加入精确视频条目并报告列表计数，不发现或获取字幕，也不创建会话", async () => {
    const harness = createHarness([1, 4]);

    const view = await prepare(harness);

    expect(view.items.map((item) => item.videoKey)).toEqual([
      `bvid:${bvid}:cid:31000000001:p:1`,
      `bvid:${bvid}:cid:31000000004:p:4`,
    ]);
    expect(harness.listTracks).not.toHaveBeenCalled();
    expect(harness.acquireDirect).not.toHaveBeenCalled();
    expect(harness.branchDirect).not.toHaveBeenCalled();
    expect(harness.sessionCreate).not.toHaveBeenCalled();

    const listingProgress = harness.updates
      .map(
        (update) =>
          (
            update as BatchJobView & {
              readonly progress?: {
                readonly completed: number;
                readonly stage: string;
                readonly total: number;
              };
            }
          ).progress,
      )
      .filter((progress) => progress?.stage === "listing");
    expect(listingProgress.at(-1)).toEqual({
      completed: 2,
      stage: "listing",
      total: 2,
    });
  });

  it("direct 原子保存为 BatchSubtitle，全程不写 Session 或旧分支获取链", async () => {
    const harness = createHarness([1]);
    const prepared = await prepare(harness);
    harness.listTracks.mockClear();

    const completed = await harness.runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      method: "direct",
    });

    expect(harness.acquireDirect).toHaveBeenCalledTimes(1);
    expect(harness.sessionCreate).not.toHaveBeenCalled();
    expect(harness.branchDirect).not.toHaveBeenCalled();
    await expect(
      harness.repository.readSubtitle(completed.items[0].batchItemId),
    ).resolves.toMatchObject({
      batchItemId: completed.items[0].batchItemId,
      language: "zh-CN",
      rows,
      source: "official",
      trackId: "official-zh-CN",
    });
    expect(completed.items[0]).not.toHaveProperty("resultSessionId");
    expect(completed.items[0]).not.toHaveProperty("resultBranchId");
  });

  it("导出严格读取当时选中的 BatchSubtitle，不读取 Session 字幕", async () => {
    const harness = createHarness([1, 2]);
    const prepared = await prepare(harness);
    const completed = await harness.runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      method: "direct",
    });
    await harness.runtime.setSelection(completed.job.batchJobId, [
      completed.items[0].batchItemId,
    ]);
    harness.readSessionSubtitle.mockClear();

    const exported = await harness.runtime.collectExport(
      completed.job.batchJobId,
    );

    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ bvid, page: 1, rows });
    expect(harness.readSessionSubtitle).not.toHaveBeenCalled();
  });

  it("speech 无需先执行 direct；即使视频存在官方轨，只要没有 BatchSubtitle 也允许选中项直接转写", async () => {
    const harness = createHarness([1]);
    const prepared = await prepare(harness, "speech");
    harness.listTracks.mockClear();

    await harness.runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      method: "speech",
    });

    expect(harness.speechStart).toHaveBeenCalledTimes(1);
    expect(harness.listTracks).not.toHaveBeenCalled();
    expect(harness.sessionCreate).not.toHaveBeenCalled();
  });

  it("direct 的网络/鉴权类失败不会被后续 speech 当成明确无字幕", async () => {
    const harness = createHarness([1]);
    const prepared = await prepare(harness);
    const item = prepared.items[0];
    await harness.repository.updateItem(
      createBatchItem({
        ...item,
        acquisitionMethod: "direct",
        errorCode: "NETWORK_ERROR",
        retryable: true,
        status: "failed",
      }),
    );
    await harness.runtime.start({
      batchJobId: prepared.job.batchJobId,
      languagePreference: "zh",
      method: "speech",
    });

    expect(harness.speechStart).not.toHaveBeenCalled();
  });
});
