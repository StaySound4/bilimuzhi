import {
  BatchSourceError,
  describeBatchSource,
  parseBatchSource,
  parseBatchSourceForKind,
  type BatchSourceDescriptor,
  type BatchSourceGateway,
  type BatchSourceKind,
} from "./batch-source-contract";
import type { BranchSubtitleAcquisitionService } from "./branch-subtitle-acquisition";
import type { SpeechAcquisitionRecord } from "./asr/speech-acquisition-coordinator";
import type { GroqRoutingMode } from "./asr-contract";
import type { SubtitleAcquisitionOwner } from "./subtitle-acquisition-contract";
import type { SessionRepository } from "./session-repository";
import { StorageError } from "./storage";
import type { TrashRetentionApplyMode, TrashRetentionPolicy } from "../domain";
import {
  SubtitleGatewayError,
  type DirectSubtitleGateway,
  type SubtitleTrackOption,
} from "./subtitle-gateway";
import type { SubtitleRepository } from "./subtitle-repository";
import {
  VideoGatewayError,
  type CanonicalVideoResolveInput,
  type CanonicalVideoResolver,
} from "./video-gateway";
import {
  createBatchItem,
  createBatchJob,
  createBatchSourceHistoryEntry,
  nextBatchListName,
  createBatchSubtitle,
  type BatchAcquisitionMethod,
  type BatchItem,
  type BatchJob,
  type BatchSourceHistoryEntry,
  type BatchSpeechOwner,
  type BatchSubtitle,
  type SubtitleLanguageMode,
  type SubtitleRow,
  type VideoRef,
} from "../domain";

export interface BatchSpeechClient {
  start(input: {
    readonly batchItemId: string;
    readonly requestedLanguageMode: SubtitleLanguageMode;
    readonly routingMode: GroqRoutingMode;
    readonly videoKey: VideoRef["videoKey"];
  }): Promise<SubtitleAcquisitionOwner>;
  status(
    owner: SubtitleAcquisitionOwner,
  ): Promise<SpeechAcquisitionRecord | null>;
  cancel(owner: SubtitleAcquisitionOwner): Promise<boolean>;
  /** Cancels a recovered task without persisting Session-shaped ownership. */
  cancelItem?(batchItemId: string): Promise<boolean>;
  /** Permanently removes task/checkpoint storage owned by one batch item. */
  purgeItem?(batchItemId: string): Promise<void>;
  /** Independent clients return the final rows without exposing provider data. */
  result?(owner: SubtitleAcquisitionOwner): Promise<{
    readonly language: string;
    readonly rows: readonly SubtitleRow[];
  } | null>;
}

export interface BatchJobView {
  readonly addedCount?: number;
  readonly duplicateCount?: number;
  readonly items: readonly BatchItem[];
  readonly job: BatchJob;
  /** Number of selected rows that already own an independent subtitle. */
  readonly overwriteCount: number;
  readonly prepareOperationId?: string;
  readonly progress?: {
    readonly completed: number;
    readonly stage: string;
    readonly total: number;
  };
}

export interface BatchExportEntry {
  readonly bvid: string;
  readonly language: string;
  readonly page: number;
  readonly rows: readonly SubtitleRow[];
  readonly title: string;
}

export interface BatchRepositoryPort {
  createJob(
    job: BatchJob,
    items: readonly BatchItem[],
  ): Promise<{ readonly items: readonly BatchItem[]; readonly job: BatchJob }>;
  createList?(input: {
    readonly batchJobId: string;
    readonly browserSessionId: string;
    readonly createdAt: number;
  }): Promise<{ readonly items: readonly BatchItem[]; readonly job: BatchJob }>;
  appendSource?(
    batchJobId: string,
    items: readonly BatchItem[],
    history: BatchSourceHistoryEntry,
    requirePreparing?: boolean,
  ): Promise<{
    readonly addedCount: number;
    readonly duplicateCount: number;
    readonly items: readonly BatchItem[];
    readonly job: BatchJob;
  }>;
  listWorkspaceLists(): Promise<
    readonly { readonly job: BatchJob; readonly pinned: boolean }[]
  >;
  renameList(batchJobId: string, name: string): Promise<BatchJob | null>;
  setPinned(batchJobId: string, pinned: boolean): Promise<boolean>;
  moveListToArchive(batchJobId: string, archivedAt: number): Promise<void>;
  moveListToTrash(
    batchJobId: string,
    meta: {
      readonly deletionReason: string;
      readonly purgeAfter: number | null;
      readonly retentionStartedAt: number;
      readonly trashedAt: number;
      readonly trashOrigin: "workspace" | "archive";
    },
  ): Promise<void>;
  listArchivedLists(): Promise<
    readonly {
      readonly archivedAt: number;
      readonly job: BatchJob;
      readonly order: number;
      readonly pinned: boolean;
    }[]
  >;
  listTrashedLists(): Promise<
    readonly {
      readonly deletionReason: string;
      readonly job: BatchJob;
      readonly order: number;
      readonly pinned: boolean;
      readonly purgeAfter: number | null;
      readonly retentionStartedAt: number;
      readonly trashedAt: number;
      readonly trashOrigin: "workspace" | "archive";
    }[]
  >;
  restoreList(batchJobId: string): Promise<boolean>;
  purgeList(batchJobId: string): Promise<void>;
  getRetentionPolicy(): Promise<TrashRetentionPolicy>;
  updateRetentionPolicy(
    policy: TrashRetentionPolicy,
    applyMode: TrashRetentionApplyMode,
  ): Promise<void>;
  permanentlyDeleteExpiredBatchTrash(now: number): Promise<readonly string[]>;
  permanentlyDeleteExpiredBatchTrash(now: number): Promise<readonly string[]>;
  read(batchJobId: string): Promise<{
    readonly items: readonly BatchItem[];
    readonly job: BatchJob;
  } | null>;
  updateJobStatus(
    batchJobId: string,
    status: BatchJob["status"],
  ): Promise<BatchJob | null>;
  updateItem(item: BatchItem): Promise<BatchItem | null>;
  setSelection(
    batchJobId: string,
    selectedItemIds: readonly string[],
  ): Promise<readonly BatchItem[]>;
  deleteJob(batchJobId: string): Promise<void>;
  readSubtitle?(batchItemId: string): Promise<BatchSubtitle | null>;
  writeSubtitle?(subtitle: BatchSubtitle): Promise<BatchSubtitle>;
  /** 删除单个条目的持久化字幕（D5 清除字幕）。 */
  deleteSubtitle?(batchItemId: string): Promise<void>;
  /** 删除任务内指定条目及其字幕（D5 删除所选）。 */
  deleteItems?(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<void>;
  commitSubtitle?(
    item: BatchItem,
    subtitle: BatchSubtitle,
  ): Promise<{ readonly item: BatchItem; readonly subtitle: BatchSubtitle }>;
}

export interface BatchRuntimeDependencies {
  readonly branchAcquisition?: BranchSubtitleAcquisitionService;
  readonly browserSessionId: string;
  readonly createId: () => string;
  readonly gateway: DirectSubtitleGateway;
  readonly now: () => number;
  readonly onUpdate?: (view: BatchJobView) => void;
  readonly readSubtitleRows?: (input: {
    readonly branchId: string;
    readonly sessionId: string;
  }) => Promise<{
    readonly language: string;
    readonly rows: readonly SubtitleRow[];
  } | null>;
  readonly repository: BatchRepositoryPort;
  readonly resolver: CanonicalVideoResolver;
  readonly sessionRepository?: SessionRepository;
  readonly speechClient?: BatchSpeechClient;
  readonly sourceGateway: BatchSourceGateway;
  readonly subtitleRepository?: SubtitleRepository;
}

export interface BatchPrepareInput {
  readonly batchJobId?: string;
  readonly operationId?: string;
  readonly includeAllPages: boolean;
  readonly input: string;
  readonly limit?: number;
  readonly method: BatchAcquisitionMethod;
  readonly sourceKind?: BatchSourceKind | "auto";
  /** 会话模式语音默认请求语言；追加的新条目写入此值。 */
  readonly speechLanguageMode?: SubtitleLanguageMode;
}

export interface BatchStartInput {
  readonly batchJobId: string;
  readonly languagePreference: string;
  readonly method?: BatchAcquisitionMethod;
  /** v16 D5：skip = 已有字幕的条目跳过；all = 选中条目全部按当前方法重取（含 succeeded）。默认 skip。 */
  readonly overwrite?: "skip" | "all";
  /** 会话模式语音模型策略；默认 balanced。 */
  readonly speechRoutingMode?: GroqRoutingMode;
  /**
   * 批量语音转录语言作用域：
   * - "item"：每个条目按操作列设置的语言转写，未设置回退混合；
   * - 具体语言：全部选中条目统一按该语言转写（覆盖条目设置）。
   * 默认 "mixed"（统一混合）。
   */
  readonly speechLanguageScope?: SubtitleLanguageMode | "item";
}

export interface BatchRuntime {
  createList?(): Promise<BatchJobView>;
  prepare(input: BatchPrepareInput): Promise<BatchJobView>;
  start(input: BatchStartInput): Promise<BatchJobView>;
  cancel(batchJobId: string): Promise<BatchJobView | null>;
  read(batchJobId: string): Promise<BatchJobView | null>;
  /** 仅工作区列表（含置顶状态），pinned 置顶 + placement order 排序。 */
  listWorkspaceLists(): Promise<
    readonly { readonly job: BatchJob; readonly pinned: boolean }[]
  >;
  renameList(batchJobId: string, name: string): Promise<BatchJobView | null>;
  setPinned(batchJobId: string, pinned: boolean): Promise<BatchJobView | null>;
  /** 运行中先取消并等待稳定，再移入批量归档；停止失败则 placement 不变。 */
  archiveList(batchJobId: string): Promise<BatchJobView | null>;
  /** 运行中先取消并等待稳定，再移入批量回收站；停止失败则 placement 不变。 */
  trashList(batchJobId: string): Promise<BatchJobView | null>;
  listArchivedLists(): Promise<
    readonly {
      readonly archivedAt: number;
      readonly job: BatchJob;
      readonly order: number;
      readonly pinned: boolean;
    }[]
  >;
  listTrashedLists(): Promise<
    readonly {
      readonly deletionReason: string;
      readonly job: BatchJob;
      readonly order: number;
      readonly pinned: boolean;
      readonly purgeAfter: number | null;
      readonly retentionStartedAt: number;
      readonly trashedAt: number;
      readonly trashOrigin: "workspace" | "archive";
    }[]
  >;
  restoreList(batchJobId: string): Promise<BatchJobView | null>;
  purgeList(batchJobId: string): Promise<void>;
  getRetentionPolicy(): Promise<TrashRetentionPolicy>;
  updateRetentionPolicy(
    policy: TrashRetentionPolicy,
    applyMode: TrashRetentionApplyMode,
  ): Promise<void>;
  permanentlyDeleteExpiredBatchTrash(now: number): Promise<readonly string[]>;
  setSelection(
    batchJobId: string,
    selectedItemIds: readonly string[],
  ): Promise<BatchJobView | null>;
  /** v16 D5：轨道选择框切换即重取；成功刷新状态，失败回退旧状态并抛错。 */
  refetchTrack(
    batchJobId: string,
    batchItemId: string,
    trackId: string,
  ): Promise<BatchJobView | null>;
  setItemSpeechLanguage(
    batchJobId: string,
    batchItemId: string,
    speechLanguageMode: SubtitleLanguageMode,
  ): Promise<BatchJobView | null>;
  /** v16 D5：清除条目字幕并复位为「未获取」（列表级/行级共用）。 */
  clearSubtitles(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<BatchJobView | null>;
  /** v16 D5：从任务删除所选条目及其字幕（含语音 checkpoint）；任务保留。 */
  deleteItems(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<BatchJobView | null>;
  /** 条目语言偏好（D4 ③ 列）：持久化 selectedLanguage，并同步重钉同语言最高优先级轨道。 */
  deleteJob(batchJobId: string): Promise<void>;
  collectExport(
    batchJobId: string,
    batchItemIds?: readonly string[],
  ): Promise<readonly BatchExportEntry[]>;
  reconcile(): Promise<void>;
}

function canonicalUrl(bvid: string, page: number): string {
  return `https://www.bilibili.com/video/${bvid}${page === 1 ? "" : `?p=${page}`}`;
}

function failureCode(error: unknown): string {
  if (error instanceof SubtitleGatewayError) return error.code;
  if (error instanceof VideoGatewayError) return error.code;
  if (error instanceof BatchSourceError) return error.code;
  if (error instanceof StorageError) return "STORAGE_TRANSACTION_FAILED";
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
  ) {
    return error.code;
  }
  return "INTERNAL_ERROR";
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * 轨道优先级（v16 D3 冻结）：user-upload > official-cc > ai；旧数据按 source 推导。
 */
function trackRank(track: {
  readonly origin?: "user-upload" | "official-cc" | "ai" | null;
  readonly source: "ai" | "official";
}): number {
  return track.origin === "user-upload"
    ? 0
    : track.source === "official"
      ? 1
      : 2;
}

/**
 * 批量直接获取的自动轨道选择（v16 D3 冻结原型）：
 * 同语言内 user-upload > official-cc > ai，同档按 trackId 稳定排序；
 * 请求语言（前缀匹配）无命中时回退 zh；仍无命中返回 null（SUBTITLE_NOT_FOUND）。
 * 语言为空（自动）时维持既有兜底语义：不限语言、按优先级排序取第一条。
 * 无 origin 的旧轨道按 source 推导档位（official → 官方 CC 档，ai → AI 档）。
 */
export function selectBatchTrack(
  tracks: readonly SubtitleTrackOption[],
  requestedLanguage: string,
): SubtitleTrackOption | null {
  const byLanguage = (language: string): readonly SubtitleTrackOption[] =>
    [...tracks]
      .filter((track) => track.language.toLowerCase().startsWith(language))
      .sort(
        (left, right) =>
          trackRank(left) - trackRank(right) ||
          left.trackId.localeCompare(right.trackId),
      );
  const language = requestedLanguage.trim().toLowerCase();
  const preferred =
    language.length === 0
      ? (byLanguage("")[0] ?? null)
      : (byLanguage(language)[0] ?? null);
  if (preferred !== null) return preferred;
  if (language === "" || language === "zh") return null;
  return byLanguage("zh")[0] ?? null;
}

const SPEECH_BLOCKING_DIRECT_ERRORS = new Set([
  "AUTHENTICATION_REQUIRED",
  "PERMISSION_DENIED",
  "SUBTITLE_URL_EXPIRED",
  "NETWORK_ERROR",
  "VALIDATION_FAILED",
  "VIDEO_NOT_BOUND",
]);

async function sourceHistoryKey(
  descriptor: BatchSourceDescriptor,
): Promise<string> {
  switch (descriptor.kind) {
    case "single-video":
      return `single-video:${descriptor.bvid}:p:${descriptor.page}`;
    case "video-pages":
      return `video-pages:${descriptor.bvid}`;
    case "collection":
      return `collection:${descriptor.mid}:${descriptor.seasonId}:${descriptor.series ? "series" : "season"}`;
    case "favorites":
      return `favorites:${descriptor.mediaId}`;
    case "user-space":
      return `user-space:${descriptor.mid}`;
    case "search": {
      const bytes = new TextEncoder().encode(descriptor.keyword.trim());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hex = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      return `search:sha256:${hex}`;
    }
  }
}

class DefaultBatchRuntime implements BatchRuntime {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly cancelled = new Set<string>();
  private readonly running = new Set<string>();
  private readonly activeCancellation = new Map<string, () => Promise<void>>();
  private readonly activeAppend = new Map<string, symbol>();

  constructor(private readonly dependencies: BatchRuntimeDependencies) {}

  private resolutionInput(item: BatchItem): CanonicalVideoResolveInput {
    return Object.freeze({
      kind: "identifier" as const,
      value: canonicalUrl(item.bvid, item.page),
    });
  }

  private async resolveExactVideo(
    item: BatchItem,
    constraints: {
      readonly aid?: number | null;
      readonly cid?: number | null;
      readonly page?: number | null;
    } = item,
  ): Promise<VideoRef> {
    const video = await this.dependencies.resolver.resolve(
      this.resolutionInput(item),
    );
    if (video.bvid !== item.bvid) {
      throw new VideoGatewayError(
        "VALIDATION_FAILED",
        "The batch source and resolved archive identify different videos",
      );
    }
    if (
      constraints.aid !== null &&
      constraints.aid !== undefined &&
      video.aid !== constraints.aid
    ) {
      throw new VideoGatewayError(
        "VALIDATION_FAILED",
        "The batch source and resolved archive identify different videos",
      );
    }
    if (
      constraints.cid !== null &&
      constraints.cid !== undefined &&
      video.cid !== constraints.cid
    ) {
      throw new VideoGatewayError(
        "VALIDATION_FAILED",
        "The batch source and resolved part identify different videos",
      );
    }
    if (
      constraints.page !== null &&
      constraints.page !== undefined &&
      video.page !== constraints.page
    ) {
      throw new VideoGatewayError(
        "VALIDATION_FAILED",
        "The batch source and resolved page identify different videos",
      );
    }
    return video;
  }

  private async assertCommitAllowed(
    batchJobId: string,
    batchItemId: string,
  ): Promise<void> {
    const stored = await this.dependencies.repository.read(batchJobId);
    const persistedItem = stored?.items.find(
      (candidate) => candidate.batchItemId === batchItemId,
    );
    if (
      this.cancelled.has(batchJobId) ||
      stored === null ||
      stored.job.status === "cancelled" ||
      persistedItem === undefined ||
      persistedItem.status === "cancelled"
    ) {
      throw Object.assign(
        new Error("The batch item was cancelled before its result committed"),
        { code: "CANCELLED" },
      );
    }
  }

  private async readSubtitle(
    batchItemId: string,
  ): Promise<BatchSubtitle | null> {
    const read = this.dependencies.repository.readSubtitle;
    if (read === undefined) return null;
    return read.call(this.dependencies.repository, batchItemId);
  }

  private async writeSubtitle(
    item: BatchItem,
    subtitle: BatchSubtitle,
  ): Promise<BatchItem> {
    const normalizedItem = createBatchItem(item);
    const normalizedSubtitle = createBatchSubtitle(subtitle);
    const commit = this.dependencies.repository.commitSubtitle;
    if (commit !== undefined) {
      return (
        await commit.call(
          this.dependencies.repository,
          normalizedItem,
          normalizedSubtitle,
        )
      ).item;
    }
    const write = this.dependencies.repository.writeSubtitle;
    if (write === undefined) {
      throw new StorageError(
        "The independent batch subtitle store is unavailable",
      );
    }
    await write.call(this.dependencies.repository, normalizedSubtitle);
    await this.dependencies.repository.updateItem(normalizedItem);
    return normalizedItem;
  }

  private async project(
    stored: {
      readonly items: readonly BatchItem[];
      readonly job: BatchJob;
    },
    progress?: BatchJobView["progress"],
    prepareOperationId?: string,
  ): Promise<BatchJobView> {
    let overwriteCount = 0;
    for (const item of stored.items) {
      if (
        item.selected &&
        (await this.readSubtitle(item.batchItemId)) !== null
      ) {
        overwriteCount += 1;
      }
    }
    return Object.freeze({
      items: stored.items,
      job: stored.job,
      overwriteCount,
      ...(prepareOperationId === undefined ? {} : { prepareOperationId }),
      ...(progress === undefined ? {} : { progress: Object.freeze(progress) }),
    });
  }

  async createList(): Promise<BatchJobView> {
    const now = this.dependencies.now();
    const batchJobId = this.dependencies.createId();
    const stored = this.dependencies.repository.createList
      ? await this.dependencies.repository.createList({
          batchJobId,
          browserSessionId: this.dependencies.browserSessionId,
          createdAt: now,
        })
      : await (async () => {
          const lists = await this.dependencies.repository.listWorkspaceLists();
          const jobs = lists.map((entry) => entry.job);
          const job = createBatchJob({
            batchJobId,
            browserSessionId: this.dependencies.browserSessionId,
            createdAt: now,
            name: nextBatchListName(
              jobs.map((candidate) => candidate.name ?? ""),
            ),
            status: "ready",
            updatedAt: now,
          });
          return this.dependencies.repository.createJob(job, []);
        })();
    const view = await this.project(stored);
    this.dependencies.onUpdate?.(view);
    return view;
  }

  async prepare(input: BatchPrepareInput): Promise<BatchJobView> {
    if (input.batchJobId !== undefined)
      return this.appendPreparedSource({
        ...input,
        batchJobId: input.batchJobId,
      });
    const descriptor: BatchSourceDescriptor =
      input.sourceKind === undefined || input.sourceKind === "auto"
        ? parseBatchSource(input.input, {
            includeAllPages: input.includeAllPages,
          })
        : parseBatchSourceForKind(input.input, input.sourceKind);
    const listed = await this.dependencies.sourceGateway.list(descriptor, {
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
    const now = this.dependencies.now();
    const batchJobId = this.dependencies.createId();
    const job = createBatchJob({
      batchJobId,
      browserSessionId: this.dependencies.browserSessionId,
      createdAt: now,
      method: input.method,
      sourceKind: descriptor.kind,
      sourceLabel: listed.title || describeBatchSource(descriptor),
      status: "preparing",
      updatedAt: now,
    });
    const defaultSpeechMode = input.speechLanguageMode ?? "mixed";
    const items = listed.items.map((item, index) =>
      createBatchItem(
        {
          aid: item.aid ?? null,
          batchItemId: this.dependencies.createId(),
          batchJobId,
          author: item.author ?? "",
          availableTracks: Object.freeze([]),
          bvid: item.bvid,
          cid: item.cid ?? null,
          errorCode: null,
          order: index,
          page: item.page ?? 1,
          progress: Object.freeze({ completed: 0, stage: "listing", total: 1 }),
          publishedAt: item.publishedAt ?? null,
          rowCount: 0,
          selected: true,
          selectedLanguage: null,
          selectedTrackId: null,
          status: "pending",
          title: item.title,
          trackId: null,
          tracksDiscovered: false,
          retryable: false,
          updatedAt: now,
          videoKey: null,
        },
        defaultSpeechMode,
      ),
    );
    let stored = await this.dependencies.repository.createJob(job, items);
    this.dependencies.onUpdate?.(
      await this.project(stored, {
        completed: 0,
        stage: "listing",
        total: items.length,
      }),
    );

    let completed = 0;
    for (const [index, item] of items.entries()) {
      if (this.cancelled.has(batchJobId)) break;
      let next: BatchItem;
      try {
        const sourceItem = listed.items[index];
        const video = await this.resolveExactVideo(item, {
          aid: sourceItem.aid,
          cid: sourceItem.cid,
          page: sourceItem.page,
        });
        next = createBatchItem({
          ...item,
          aid: video.aid,
          cid: video.cid,
          errorCode: null,
          page: video.page,
          progress: Object.freeze({ completed: 1, stage: "listed", total: 1 }),
          retryable: false,
          status: "pending",
          updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
          videoKey: video.videoKey,
        });
      } catch (error) {
        next = createBatchItem({
          ...item,
          errorCode: failureCode(error),
          progress: Object.freeze({
            completed: 1,
            stage: "listing-failed",
            total: 1,
          }),
          retryable: true,
          status: "failed",
          updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
          videoKey: null,
        });
      }
      // 解析期间可能已被取消或删除：取消后不再写回，避免孤儿数据。
      if (this.cancelled.has(batchJobId)) break;
      await this.dependencies.repository.updateItem(next);
      completed += 1;
      stored = (await this.dependencies.repository.read(batchJobId)) ?? stored;
      this.dependencies.onUpdate?.(
        await this.project(stored, {
          completed,
          stage: "listing",
          total: items.length,
        }),
      );
    }
    // 取消后保持 cancelled 状态，不得把任务翻回 ready。
    if (!this.cancelled.has(batchJobId)) {
      await this.dependencies.repository.updateJobStatus(batchJobId, "ready");
    }
    const view = await this.read(batchJobId);
    if (view === null) throw new StorageError("The batch job was not stored");
    this.dependencies.onUpdate?.(view);
    return view;
  }

  private async appendPreparedSource(
    input: BatchPrepareInput & { readonly batchJobId: string },
  ): Promise<BatchJobView> {
    const descriptor: BatchSourceDescriptor =
      input.sourceKind === undefined || input.sourceKind === "auto"
        ? parseBatchSource(input.input, {
            includeAllPages: input.includeAllPages,
          })
        : parseBatchSourceForKind(input.input, input.sourceKind);
    const batchJobId = input.batchJobId;
    const current = await this.dependencies.repository.read(batchJobId);
    if (current === null)
      throw new StorageError("The batch list does not exist");
    if (this.activeAppend.has(batchJobId)) return this.project(current);
    const operationId = input.operationId ?? this.dependencies.createId();

    const operation = Symbol(batchJobId);
    this.activeAppend.set(batchJobId, operation);
    await this.dependencies.repository.updateJobStatus(batchJobId, "preparing");
    const preparing = await this.read(batchJobId);
    if (preparing !== null) {
      this.dependencies.onUpdate?.(
        Object.freeze({ ...preparing, prepareOperationId: operationId }),
      );
    }

    const isCurrent = (): boolean =>
      this.activeAppend.get(batchJobId) === operation;
    try {
      const listed = await this.dependencies.sourceGateway.list(descriptor, {
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      });
      if (!isCurrent()) return (await this.read(batchJobId))!;
      const now = this.dependencies.now();
      const defaultSpeechMode = input.speechLanguageMode ?? "mixed";
      const items = listed.items.map((item, index) =>
        createBatchItem(
          {
            aid: item.aid ?? null,
            batchItemId: this.dependencies.createId(),
            batchJobId,
            author: item.author ?? "",
            availableTracks: Object.freeze([]),
            bvid: item.bvid,
            cid: item.cid ?? null,
            errorCode: null,
            order: current.items.length + index,
            page: item.page ?? 1,
            progress: Object.freeze({
              completed: 0,
              stage: "listing",
              total: 1,
            }),
            publishedAt: item.publishedAt ?? null,
            rowCount: 0,
            selected: false,
            selectedLanguage: null,
            selectedTrackId: null,
            status: "pending",
            title: item.title,
            trackId: null,
            tracksDiscovered: false,
            retryable: false,
            updatedAt: now,
            videoKey: null,
          },
          defaultSpeechMode,
        ),
      );
      if (this.dependencies.repository.appendSource === undefined) {
        throw new StorageError("The batch list append store is unavailable");
      }
      const resolved: BatchItem[] = [];
      let completed = 0;
      for (const [index, item] of items.entries()) {
        if (!isCurrent()) break;
        let next: BatchItem;
        try {
          const sourceItem = listed.items[index];
          const video = await this.resolveExactVideo(item, {
            aid: sourceItem.aid,
            cid: sourceItem.cid,
            page: sourceItem.page,
          });
          next = createBatchItem({
            ...item,
            aid: video.aid,
            cid: video.cid,
            errorCode: null,
            page: video.page,
            progress: Object.freeze({
              completed: 1,
              stage: "listed",
              total: 1,
            }),
            retryable: false,
            status: "pending",
            updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
            videoKey: video.videoKey,
          });
        } catch (error) {
          next = createBatchItem({
            ...item,
            errorCode: failureCode(error),
            progress: Object.freeze({
              completed: 1,
              stage: "listing-failed",
              total: 1,
            }),
            retryable: true,
            status: "failed",
            updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
            videoKey: null,
          });
        }
        if (!isCurrent()) break;
        resolved.push(next);
        completed += 1;
        this.dependencies.onUpdate?.(
          await this.project(
            {
              items: Object.freeze([...current.items, ...resolved]),
              job: createBatchJob({ ...current.job, status: "preparing" }),
            },
            { completed, stage: "listing", total: items.length },
            operationId,
          ),
        );
      }
      if (!isCurrent()) return (await this.read(batchJobId))!;
      const stored = await this.dependencies.repository.appendSource(
        batchJobId,
        resolved,
        createBatchSourceHistoryEntry({
          addedAt: now,
          addedCount: 0,
          batchJobId,
          duplicateCount: 0,
          sourceHistoryId: this.dependencies.createId(),
          sourceKey: await sourceHistoryKey(descriptor),
          sourceKind: descriptor.kind,
        }),
        true,
      );
      if (!isCurrent()) return (await this.read(batchJobId))!;
      const view = await this.project(stored);
      const result = Object.freeze({
        ...view,
        addedCount: stored.addedCount,
        duplicateCount: stored.duplicateCount,
      });
      this.dependencies.onUpdate?.(
        Object.freeze({ ...result, prepareOperationId: operationId }),
      );
      return result;
    } finally {
      if (isCurrent()) {
        this.activeAppend.delete(batchJobId);
        const stored = await this.dependencies.repository.read(batchJobId);
        if (stored?.job.status === "preparing") {
          await this.dependencies.repository.updateJobStatus(
            batchJobId,
            "ready",
          );
          const ready = await this.read(batchJobId);
          if (ready !== null) this.dependencies.onUpdate?.(ready);
        }
      }
    }
  }

  async read(batchJobId: string): Promise<BatchJobView | null> {
    const stored = await this.dependencies.repository.read(batchJobId);
    return stored === null ? null : this.project(stored);
  }

  listWorkspaceLists(): Promise<
    readonly { readonly job: BatchJob; readonly pinned: boolean }[]
  > {
    return this.dependencies.repository.listWorkspaceLists();
  }

  async renameList(
    batchJobId: string,
    name: string,
  ): Promise<BatchJobView | null> {
    await this.dependencies.repository.renameList(batchJobId, name);
    return this.read(batchJobId);
  }

  async setPinned(
    batchJobId: string,
    pinned: boolean,
  ): Promise<BatchJobView | null> {
    await this.dependencies.repository.setPinned(batchJobId, pinned);
    return this.read(batchJobId);
  }

  /** 运行中先取消并等待稳定（含语音 checkpoint 清理），再移动 placement。 */
  private async settleBeforeMove(
    batchJobId: string,
  ): Promise<BatchJobView | null> {
    const stored = await this.dependencies.repository.read(batchJobId);
    if (stored === null) return null;
    const running =
      stored.job.status === "running" || stored.job.status === "preparing";
    if (running) {
      await this.cancel(batchJobId);
    }
    return this.read(batchJobId);
  }

  async archiveList(batchJobId: string): Promise<BatchJobView | null> {
    const settled = await this.settleBeforeMove(batchJobId);
    if (settled === null) return null;
    await this.dependencies.repository.moveListToArchive(
      batchJobId,
      this.dependencies.now(),
    );
    return this.read(batchJobId);
  }

  async trashList(batchJobId: string): Promise<BatchJobView | null> {
    const settled = await this.settleBeforeMove(batchJobId);
    if (settled === null) return null;
    const archived = await this.dependencies.repository
      .listArchivedLists()
      .then((lists) =>
        lists.some((list) => list.job.batchJobId === batchJobId),
      );
    const now = this.dependencies.now();
    await this.dependencies.repository.moveListToTrash(batchJobId, {
      deletionReason: "user-delete",
      purgeAfter: null,
      retentionStartedAt: now,
      trashedAt: now,
      trashOrigin: archived ? "archive" : "workspace",
    });
    return this.read(batchJobId);
  }

  async listArchivedLists() {
    return this.dependencies.repository.listArchivedLists();
  }

  async listTrashedLists() {
    return this.dependencies.repository.listTrashedLists();
  }

  async restoreList(batchJobId: string): Promise<BatchJobView | null> {
    const restored = await this.dependencies.repository.restoreList(batchJobId);
    if (!restored) return this.read(batchJobId);
    // 恢复到工作区后运行态规范化：不自动续跑。
    const stored = await this.dependencies.repository.read(batchJobId);
    if (stored !== null && stored.job.status === "running") {
      await this.dependencies.repository.updateJobStatus(batchJobId, "ready");
    }
    return this.read(batchJobId);
  }

  async purgeList(batchJobId: string): Promise<void> {
    const stored = await this.dependencies.repository.read(batchJobId);
    await this.cancel(batchJobId);
    if (stored !== null && this.dependencies.speechClient?.purgeItem) {
      for (const item of stored.items) {
        await this.dependencies.speechClient.purgeItem(item.batchItemId);
      }
    }
    await this.dependencies.repository.purgeList(batchJobId);
  }

  async getRetentionPolicy(): Promise<TrashRetentionPolicy> {
    return this.dependencies.repository.getRetentionPolicy();
  }

  async updateRetentionPolicy(
    policy: TrashRetentionPolicy,
    applyMode: TrashRetentionApplyMode,
  ): Promise<void> {
    await this.dependencies.repository.updateRetentionPolicy(policy, applyMode);
  }

  async permanentlyDeleteExpiredBatchTrash(
    now: number,
  ): Promise<readonly string[]> {
    return this.dependencies.repository.permanentlyDeleteExpiredBatchTrash(now);
  }

  async reconcile(): Promise<void> {
    const lists = await this.dependencies.repository.listWorkspaceLists();
    const jobs = lists.map((entry) => entry.job);
    for (const job of jobs) {
      if (job.status === "preparing") {
        // SW 中断遗留：卡在准备中的任务重置为 ready，已解析条目保留现状。
        await this.dependencies.repository.updateJobStatus(
          job.batchJobId,
          "ready",
        );
        const recovered = await this.read(job.batchJobId);
        if (recovered !== null) this.dependencies.onUpdate?.(recovered);
        continue;
      }
      if (job.status !== "running") continue;
      const stored = await this.dependencies.repository.read(job.batchJobId);
      if (stored === null) continue;
      let anySucceeded = false;
      for (const item of stored.items) {
        if (item.status !== "running") {
          anySucceeded ||= item.status === "succeeded";
          continue;
        }
        const subtitle = await this.readSubtitle(item.batchItemId);
        await this.dependencies.repository.updateItem(
          createBatchItem({
            ...item,
            errorCode: subtitle === null ? "BACKGROUND_RECOVERY_FAILED" : null,
            progress:
              subtitle === null
                ? item.progress
                : Object.freeze({ completed: 1, stage: "saved", total: 1 }),
            retryable: subtitle === null,
            rowCount: subtitle?.rows.length ?? item.rowCount,
            speechOwner: null,
            status: subtitle === null ? "failed" : "succeeded",
            updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
          }),
        );
        anySucceeded ||= subtitle !== null;
      }
      await this.dependencies.repository.updateJobStatus(
        job.batchJobId,
        anySucceeded ? "completed" : "failed",
      );
      const view = await this.read(job.batchJobId);
      if (view !== null) this.dependencies.onUpdate?.(view);
    }
  }

  async setSelection(
    batchJobId: string,
    selectedItemIds: readonly string[],
  ): Promise<BatchJobView | null> {
    await this.dependencies.repository.setSelection(
      batchJobId,
      selectedItemIds,
    );
    return this.read(batchJobId);
  }

  async setItemSpeechLanguage(
    batchJobId: string,
    batchItemId: string,
    speechLanguageMode: SubtitleLanguageMode,
  ): Promise<BatchJobView | null> {
    const stored = await this.dependencies.repository.read(batchJobId);
    if (stored === null || stored.job.status === "running") {
      return this.read(batchJobId);
    }
    const item = stored.items.find(
      (candidate) => candidate.batchItemId === batchItemId,
    );
    if (item === undefined) return this.read(batchJobId);
    await this.dependencies.repository.updateItem(
      createBatchItem({
        ...item,
        speechLanguageMode,
        updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
      }),
    );
    return this.read(batchJobId);
  }

  /**
   * v16 D5：轨道切换即重取。按条目精确身份解析 → 发现 → 获取该轨道正文 →
   * owner 校验后原子提交；成功刷新状态，失败回退旧状态并抛出错误（UI 显示）。
   * 单条目、无确认弹窗、强制覆盖该条目；语音条目不显示选择框故不进入此路径。
   */
  async refetchTrack(
    batchJobId: string,
    batchItemId: string,
    trackId: string,
  ): Promise<BatchJobView | null> {
    const stored = await this.dependencies.repository.read(batchJobId);
    if (stored === null || stored.job.status === "running") {
      return this.read(batchJobId);
    }
    const item = stored.items.find(
      (candidate) => candidate.batchItemId === batchItemId,
    );
    if (item === undefined) return this.read(batchJobId);
    const track = (item.availableTracks ?? []).find(
      (candidate) => candidate.trackId === trackId,
    );
    if (track === undefined) {
      throw new BatchSourceError(
        "VALIDATION_FAILED",
        "所选字幕轨道不属于该批量条目。",
      );
    }
    const video = await this.resolveExactVideo(item);
    if (item.videoKey !== null && video.videoKey !== item.videoKey) {
      throw new SubtitleGatewayError(
        "VALIDATION_FAILED",
        "The batch item identity changed before acquisition",
      );
    }
    const tracks = await this.dependencies.gateway.listTracks(video);
    const discovered = tracks.find(
      (candidate) => candidate.trackId === trackId,
    );
    if (discovered === undefined) {
      throw new SubtitleGatewayError(
        "SUBTITLE_NOT_FOUND",
        "No batch track matched the requested language",
      );
    }
    const acquired = await this.dependencies.gateway.acquire(
      video,
      discovered.trackId,
    );
    // 与 start 相同：迟到/取消的响应不得提交（owner 校验）。
    await this.assertCommitAllowed(batchJobId, batchItemId);
    const next = createBatchItem({
      ...item,
      availableTracks: tracks.map((trackOption) =>
        Object.freeze({ ...trackOption }),
      ),
      errorCode: null,
      progress: Object.freeze({ completed: 1, stage: "saved", total: 1 }),
      retryable: false,
      rowCount: acquired.rows.length,
      selectedTrackId: discovered.trackId,
      status: "succeeded",
      trackId: discovered.trackId,
      tracksDiscovered: true,
      updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
    });
    await this.writeSubtitle(
      next,
      createBatchSubtitle({
        batchItemId: item.batchItemId,
        language: acquired.language,
        rows: acquired.rows,
        source: discovered.source,
        trackId: discovered.trackId,
        updatedAt: this.dependencies.now(),
      }),
    );
    return this.read(batchJobId);
  }

  /**
   * v16 D5：清除字幕（列表级/行级共用）。删除持久化 subtitle 并复位
   * trackId/selectedTrackId/rowCount/errorCode/status/acquisitionMethod/retryable。
   */
  async clearSubtitles(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<BatchJobView | null> {
    const stored = await this.dependencies.repository.read(batchJobId);
    if (stored === null || stored.job.status === "running") {
      return this.read(batchJobId);
    }
    const target = new Set(batchItemIds);
    for (const item of stored.items) {
      if (!target.has(item.batchItemId)) continue;
      if (
        item.acquisitionMethod === "speech" &&
        this.dependencies.speechClient?.purgeItem !== undefined
      ) {
        try {
          await this.dependencies.speechClient.purgeItem(item.batchItemId);
        } catch {
          // 清除以本地持久化状态为准，checkpoint 清理失败不阻断。
        }
      }
      await this.dependencies.repository.deleteSubtitle?.(item.batchItemId);
      await this.dependencies.repository.updateItem(
        createBatchItem({
          ...item,
          acquisitionMethod: null,
          errorCode: null,
          progress: null,
          retryable: false,
          rowCount: 0,
          selectedLanguage: null,
          selectedTrackId: null,
          speechOwner: null,
          status: "pending",
          trackId: null,
          updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
        }),
      );
    }
    const view = await this.read(batchJobId);
    if (view !== null) this.dependencies.onUpdate?.(view);
    return view;
  }

  /**
   * v16 D5：删除所选条目及其字幕（含语音 checkpoint）；任务保留为空列表。
   */
  async deleteItems(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<BatchJobView | null> {
    const stored = await this.dependencies.repository.read(batchJobId);
    if (stored === null) return null;
    const target = new Set(batchItemIds);
    for (const item of stored.items) {
      if (!target.has(item.batchItemId)) continue;
      if (
        item.acquisitionMethod === "speech" &&
        this.dependencies.speechClient?.purgeItem !== undefined
      ) {
        try {
          await this.dependencies.speechClient.purgeItem(item.batchItemId);
        } catch {
          // 删除以本地持久化状态为准。
        }
      }
    }
    await this.dependencies.repository.deleteItems?.(batchJobId, batchItemIds);
    const view = await this.read(batchJobId);
    if (view !== null) this.dependencies.onUpdate?.(view);
    return view;
  }

  async cancel(batchJobId: string): Promise<BatchJobView | null> {
    if (this.activeAppend.has(batchJobId)) {
      this.activeAppend.delete(batchJobId);
      await this.dependencies.repository.updateJobStatus(batchJobId, "ready");
      const view = await this.read(batchJobId);
      if (view !== null) this.dependencies.onUpdate?.(view);
      return view;
    }
    this.cancelled.add(batchJobId);
    const controller = this.abortControllers.get(batchJobId);
    if (controller !== undefined) {
      this.abortControllers.delete(batchJobId);
      controller.abort();
    }
    try {
      await this.activeCancellation.get(batchJobId)?.();
    } catch {
      // The persisted cancelled state remains authoritative.
    }
    const stored = await this.dependencies.repository.read(batchJobId);
    if (stored !== null) {
      for (const item of stored.items) {
        if (item.status !== "running") continue;
        if (
          item.acquisitionMethod === "speech" &&
          this.dependencies.speechClient?.cancelItem !== undefined
        ) {
          try {
            await this.dependencies.speechClient.cancelItem(item.batchItemId);
          } catch {
            // Continue applying the authoritative local cancellation state.
          }
        }
        await this.dependencies.repository.updateItem(
          createBatchItem({
            ...item,
            errorCode: null,
            retryable: true,
            speechOwner: null,
            status: "cancelled",
            updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
          }),
        );
      }
    }
    await this.dependencies.repository.updateJobStatus(batchJobId, "cancelled");
    const view = await this.read(batchJobId);
    if (view !== null) this.dependencies.onUpdate?.(view);
    return view;
  }

  async deleteJob(batchJobId: string): Promise<void> {
    const stored = await this.dependencies.repository.read(batchJobId);
    await this.cancel(batchJobId);
    if (stored !== null && this.dependencies.speechClient?.purgeItem) {
      for (const item of stored.items) {
        await this.dependencies.speechClient.purgeItem(item.batchItemId);
      }
    }
    await this.dependencies.repository.deleteJob(batchJobId);
  }

  async collectExport(
    batchJobId: string,
    batchItemIds?: readonly string[],
  ): Promise<readonly BatchExportEntry[]> {
    const stored = await this.dependencies.repository.read(batchJobId);
    if (stored === null) return Object.freeze([]);
    const explicitScope =
      batchItemIds === undefined ? null : new Set(batchItemIds);
    const entries: BatchExportEntry[] = [];
    for (const item of stored.items) {
      if (
        explicitScope === null
          ? !item.selected
          : !explicitScope.has(item.batchItemId)
      ) {
        continue;
      }
      const subtitle = await this.readSubtitle(item.batchItemId);
      if (subtitle === null) continue;
      entries.push(
        Object.freeze({
          bvid: item.bvid,
          language: subtitle.language,
          page: item.page,
          rows: subtitle.rows,
          title: item.title,
        }),
      );
    }
    return Object.freeze(entries);
  }

  async start(input: BatchStartInput): Promise<BatchJobView> {
    const initial = await this.read(input.batchJobId);
    if (initial === null)
      throw new StorageError("The batch job no longer exists");
    if (this.running.has(input.batchJobId)) return initial;
    this.running.add(input.batchJobId);
    this.cancelled.delete(input.batchJobId);
    const controller = new AbortController();
    this.abortControllers.set(input.batchJobId, controller);
    try {
      await this.dependencies.repository.updateJobStatus(
        input.batchJobId,
        "running",
      );
      // 任务开始运行立即推送:UI 需要马上显示"运行中"转圈,
      // 否则从 prepare 到首个 item 完成之间仍是事件真空。
      const started = await this.read(input.batchJobId);
      if (started !== null) this.dependencies.onUpdate?.(started);
      const runSelectedItems = async (
        gateway: DirectSubtitleGateway,
      ): Promise<void> => {
        for (const item of initial.items) {
          if (this.cancelled.has(input.batchJobId)) break;
          if (!item.selected) continue;
          const itemMethod =
            input.method ??
            item.acquisitionMethod ??
            initial.job.method ??
            "direct";
          const existing = await this.readSubtitle(item.batchItemId);
          // v16 D5：overwrite 显式控制覆盖语义；默认 skip（已有字幕跳过）。
          // 授权重试覆盖不受 skip 影响：retryable 的 direct 失败/取消条目
          // 在 skip 与缺省下都重取（旧字幕作为回退底稿保留），避免「重试所选」
          // 的「确定（跳过已有）」把失败条目也跳过。
          const authorizedRetryOverwrite =
            existing !== null &&
            itemMethod === "direct" &&
            item.acquisitionMethod === "direct" &&
            item.retryable === true &&
            (item.status === "failed" || item.status === "cancelled");
          if (
            existing !== null &&
            input.overwrite !== "all" &&
            !authorizedRetryOverwrite
          ) {
            continue;
          }
          if (
            itemMethod === "speech" &&
            item.acquisitionMethod === "direct" &&
            item.errorCode !== null &&
            SPEECH_BLOCKING_DIRECT_ERRORS.has(item.errorCode)
          ) {
            continue;
          }
          // 语音转录作用域：
          // - undefined（重试/旧路径）：逐项读取持久化请求语言（操作列设置），
          //   未设置回退混合——保持原行为；
          // - "item"（对话框选「按对应视频项设置」）：同上；
          // - 具体语言（对话框显式选择）：全部选中条目统一按该语言转写。
          const speechScope = input.speechLanguageScope;
          await this.runItem(
            item,
            // 直接字幕：条目语言预设优先，未设置时回退表级偏好。
            item.selectedLanguage ?? input.languagePreference,
            speechScope === undefined || speechScope === "item"
              ? (item.speechLanguageMode ?? "mixed")
              : speechScope,
            input.speechRoutingMode ?? "balanced",
            itemMethod,
            gateway,
            controller.signal,
          );
          const progress = await this.read(input.batchJobId);
          if (progress !== null) this.dependencies.onUpdate?.(progress);
        }
      };
      // 批量直接获取复用会话模式同一个共享 gateway：其注入的 fetch 已是
      // 「精确视频页优先 → Cookie/DNR 离页授权」且不创建任何新标签页。
      await runSelectedItems(this.dependencies.gateway);
      const finished = await this.dependencies.repository.read(
        input.batchJobId,
      );
      const cancelled =
        this.cancelled.has(input.batchJobId) ||
        finished?.job.status === "cancelled";
      const anySucceeded =
        finished?.items.some((item) => item.status === "succeeded") ?? false;
      await this.dependencies.repository.updateJobStatus(
        input.batchJobId,
        cancelled ? "cancelled" : anySucceeded ? "completed" : "failed",
      );
      const view = await this.read(input.batchJobId);
      if (view === null) throw new StorageError("The batch job was removed");
      this.dependencies.onUpdate?.(view);
      return view;
    } finally {
      this.running.delete(input.batchJobId);
      this.cancelled.delete(input.batchJobId);
      this.abortControllers.delete(input.batchJobId);
    }
  }

  private async runItem(
    item: BatchItem,
    languagePreference: string,
    speechLanguageMode: SubtitleLanguageMode,
    speechRoutingMode: GroqRoutingMode,
    method: BatchAcquisitionMethod,
    gateway: DirectSubtitleGateway,
    signal?: AbortSignal,
  ): Promise<void> {
    let current = item;
    const mark = async (patch: Partial<BatchItem>): Promise<void> => {
      current = createBatchItem({
        ...current,
        ...patch,
        updatedAt: Math.max(this.dependencies.now(), current.updatedAt),
      });
      await this.dependencies.repository.updateItem(current);
      // 实时推送:运行中的每个阶段变化(discovering/acquiring/transcribing/
      // 下载字节进度等)都要让 UI 立即看到转圈与进度文字。
      // 此前仅在 item 完成后推送一次,导致获取过程中 UI 无任何事件。
      const view = await this.read(item.batchJobId);
      if (view !== null) this.dependencies.onUpdate?.(view);
    };
    await mark({
      acquisitionMethod: method,
      errorCode: null,
      progress: Object.freeze({
        completed: 0,
        stage: method === "direct" ? "discovering" : "preparing-media",
        total: 1,
      }),
      retryable: false,
      status: "running",
    });
    try {
      const video = await this.resolveExactVideo(item);
      if (item.videoKey !== null && video.videoKey !== item.videoKey) {
        throw new SubtitleGatewayError(
          "VALIDATION_FAILED",
          "The batch item identity changed before acquisition",
        );
      }
      if (method === "speech") {
        await this.runSpeechItem(
          current,
          video,
          speechLanguageMode,
          speechRoutingMode,
          mark,
        );
        return;
      }
      const tracks = await gateway.listTracks(video, {
        ...(signal === undefined ? {} : { signal }),
      });
      await mark({
        availableTracks: tracks.map((track) => Object.freeze({ ...track })),
        progress: Object.freeze({
          completed: 1,
          stage: "discovered",
          total: 1,
        }),
        tracksDiscovered: true,
      });
      const track =
        current.selectedTrackId === null ||
        current.selectedTrackId === undefined
          ? selectBatchTrack(tracks, languagePreference)
          : (tracks.find(
              (candidate) => candidate.trackId === current.selectedTrackId,
            ) ?? null);
      if (track === null) {
        throw new SubtitleGatewayError(
          "SUBTITLE_NOT_FOUND",
          "No batch track matched the requested language",
        );
      }
      await mark({
        progress: Object.freeze({ completed: 0, stage: "acquiring", total: 1 }),
      });
      const acquired = await gateway.acquire(video, track.trackId, {
        ...(signal === undefined ? {} : { signal }),
      });
      // A direct gateway may outlive its Side Panel or cancellation request.
      // Re-read persisted state after that await and before the atomic result
      // commit so a late response cannot resurrect a cancelled item.
      await this.assertCommitAllowed(item.batchJobId, item.batchItemId);
      const next = createBatchItem({
        ...current,
        errorCode: null,
        progress: Object.freeze({ completed: 1, stage: "saved", total: 1 }),
        retryable: false,
        rowCount: acquired.rows.length,
        selectedLanguage: track.language,
        selectedTrackId: track.trackId,
        status: "succeeded",
        trackId: track.trackId,
        updatedAt: Math.max(this.dependencies.now(), current.updatedAt),
      });
      current = await this.writeSubtitle(
        next,
        createBatchSubtitle({
          batchItemId: item.batchItemId,
          language: acquired.language,
          rows: acquired.rows,
          source: track.source,
          trackId: track.trackId,
          updatedAt: this.dependencies.now(),
        }),
      );
    } catch (error) {
      if (
        this.cancelled.has(item.batchJobId) ||
        failureCode(error) === "CANCELLED"
      ) {
        // 任务可能已被删除：不再写回任何条目，避免孤儿数据。
        const stored = await this.dependencies.repository.read(item.batchJobId);
        if (stored === null) return;
        await mark({
          errorCode: null,
          retryable: true,
          speechOwner: null,
          status: "cancelled",
        });
        return;
      }
      const code = failureCode(error);
      await mark({
        errorCode: code,
        retryable: code !== "CHARGED_CONTENT_UNSUPPORTED",
        speechOwner: null,
        status: "failed",
      });
    }
  }

  private async runSpeechItem(
    item: BatchItem,
    video: VideoRef,
    speechLanguageMode: SubtitleLanguageMode,
    speechRoutingMode: GroqRoutingMode,
    mark: (patch: Partial<BatchItem>) => Promise<void>,
  ): Promise<void> {
    const client = this.dependencies.speechClient;
    if (client === undefined) {
      throw Object.assign(new Error("Speech runtime is unavailable"), {
        code: "SPEECH_RUNTIME_UNAVAILABLE",
      });
    }
    const owner = await client.start({
      batchItemId: item.batchItemId,
      requestedLanguageMode: speechLanguageMode,
      routingMode: speechRoutingMode,
      videoKey: video.videoKey,
    });
    await mark({
      acquisitionMethod: "speech",
      speechOwner: owner as BatchSpeechOwner,
    });
    const cancel = async (): Promise<void> => {
      await client.cancel(owner);
    };
    this.activeCancellation.set(item.batchJobId, cancel);
    try {
      for (;;) {
        const record = await client.status(owner);
        if (record === null) {
          throw Object.assign(new Error("Speech task state was lost"), {
            code: "BACKGROUND_RECOVERY_FAILED",
          });
        }
        const total = Math.max(record.progress.totalChunks, 1);
        // 字节进度:preparing(下载/编码)阶段的真实进度在 activity 与
        // audioPreparationBytes 里(AsrMediaAcquisitionProgress.completedBytes /
        // AsrAudioBytePreparationProgress)。此前只取分片数(下载阶段恒 0),
        // 导致批量语音显示 0MB/0MB。转写/合并阶段保持分片语义。
        const activity = record.progress.activity;
        const byteProgress =
          activity !== undefined && "completedBytes" in activity
            ? {
                completed: activity.completedBytes,
                total: activity.totalBytes ?? 0,
              }
            : record.progress.audioPreparationBytes !== undefined
              ? {
                  completed:
                    record.progress.audioPreparationBytes.completedBytes,
                  total: record.progress.audioPreparationBytes.totalBytes,
                }
              : null;
        // 计数进度:loading/reading 等准备步骤是 units(无字节),按计数显示。
        const unitProgress =
          activity !== undefined && "completedUnits" in activity
            ? {
                completed: activity.completedUnits,
                total: activity.totalUnits,
              }
            : null;
        await mark({
          progress: Object.freeze({
            completed:
              byteProgress !== null
                ? byteProgress.completed
                : unitProgress !== null
                  ? unitProgress.completed
                  : Math.min(record.progress.completedChunks, total),
            stage: record.progress.stage,
            total:
              byteProgress !== null
                ? byteProgress.total
                : unitProgress !== null
                  ? unitProgress.total
                  : total,
            ...(byteProgress !== null ? { unit: "bytes" as const } : {}),
          }),
        });
        if (record.status === "completed") {
          const result = await client.result?.(owner);
          if (result === undefined || result === null) {
            throw Object.assign(
              new Error("Independent speech result is unavailable"),
              {
                code: "BACKGROUND_RECOVERY_FAILED",
              },
            );
          }
          const next = createBatchItem({
            ...item,
            acquisitionMethod: "speech",
            errorCode: null,
            progress: Object.freeze({
              completed: total,
              stage: "saved",
              total,
            }),
            retryable: false,
            rowCount: result.rows.length,
            speechOwner: null,
            status: "succeeded",
            updatedAt: Math.max(this.dependencies.now(), item.updatedAt),
          });
          await this.writeSubtitle(
            next,
            createBatchSubtitle({
              batchItemId: item.batchItemId,
              language: result.language,
              rows: result.rows,
              source: "speech",
              trackId: null,
              updatedAt: this.dependencies.now(),
            }),
          );
          return;
        }
        if (record.status === "cancelled" || record.status === "interrupted") {
          throw Object.assign(new Error("Speech task was cancelled"), {
            code:
              record.status === "cancelled"
                ? "CANCELLED"
                : "BACKGROUND_RECOVERY_FAILED",
          });
        }
        if (record.status === "failed") {
          throw Object.assign(new Error("Speech transcription failed"), {
            code: record.errorCode ?? "SPEECH_TRANSCRIPTION_FAILED",
          });
        }
        if (this.cancelled.has(item.batchJobId)) {
          await cancel();
          throw Object.assign(new Error("Speech task was cancelled"), {
            code: "CANCELLED",
          });
        }
        await wait(350);
      }
    } finally {
      this.activeCancellation.delete(item.batchJobId);
    }
  }
}

export function createBatchRuntime(
  dependencies: BatchRuntimeDependencies,
): BatchRuntime {
  return new DefaultBatchRuntime(dependencies);
}
