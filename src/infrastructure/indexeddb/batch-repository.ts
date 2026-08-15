import {
  DEFAULT_TRASH_RETENTION_POLICY,
  calculateTrashPurgeAfter,
  createTrashRetentionPolicy,
  type TrashRetentionApplyMode,
  type TrashRetentionPolicy,
} from "../../domain";
import type { SubtitleLanguageMode } from "../../domain";
import { StorageError } from "../../application/storage";
import {
  createArchiveBatchPlacement,
  createBatchItem,
  createWorkspaceBatchPlacement,
  createBatchJob,
  createBatchSourceHistoryEntry,
  createTrashBatchPlacement,
  nextBatchListName,
  readBatchItemFromStored,
  createBatchSubtitle,
  type BatchItem,
  type BatchJob,
  type BatchSourceHistoryEntry,
  type BatchSubtitle,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

/** 批量回收站保留期限设置键（独立于会话 trashRetention，schema 一致）。 */
export const BATCH_TRASH_RETENTION_SETTING_KEY = "batchTrashRetention";

export interface BatchRepositoryDependencies {
  readonly now: () => number;
  readonly defaultSpeechLanguageMode?: SubtitleLanguageMode;
}

export interface BatchJobView {
  readonly items: readonly BatchItem[];
  readonly job: BatchJob;
}

export interface BatchRepository {
  createJob(job: BatchJob, items: readonly BatchItem[]): Promise<BatchJobView>;
  createList(input: {
    readonly batchJobId: string;
    readonly browserSessionId: string;
    readonly createdAt: number;
  }): Promise<BatchJobView>;
  appendSource(
    batchJobId: string,
    items: readonly BatchItem[],
    history: BatchSourceHistoryEntry,
    requirePreparing?: boolean,
  ): Promise<
    BatchJobView & {
      readonly addedCount: number;
      readonly duplicateCount: number;
    }
  >;
  /** 仅工作区列表，按 pinned 置顶 + placement order 排序。 */
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
  /** trash/archive → workspace：保留 order/pinned，不自动续跑（运行态由 runtime 规范化）。 */
  restoreList(batchJobId: string): Promise<boolean>;
  /** 永久删除完整列表（同 deleteJob 级联，不可恢复）。 */
  purgeList(batchJobId: string): Promise<void>;
  read(batchJobId: string): Promise<BatchJobView | null>;
  updateJobStatus(
    batchJobId: string,
    status: BatchJob["status"],
  ): Promise<BatchJob | null>;
  updateItem(item: BatchItem): Promise<BatchItem | null>;
  setSelection(
    batchJobId: string,
    selectedItemIds: readonly string[],
  ): Promise<readonly BatchItem[]>;
  readSubtitle(batchItemId: string): Promise<BatchSubtitle | null>;
  writeSubtitle(subtitle: BatchSubtitle): Promise<BatchSubtitle>;
  commitSubtitle?(
    item: BatchItem,
    subtitle: BatchSubtitle,
  ): Promise<{ readonly item: BatchItem; readonly subtitle: BatchSubtitle }>;
  /** Deletes the independently-owned job, items and batch subtitles only. */
  deleteJob(batchJobId: string): Promise<void>;
  /** 删除单个条目的持久化字幕（D5 清除字幕）。 */
  deleteSubtitle(batchItemId: string): Promise<void>;
  /** 删除任务内指定条目及其字幕（D5 删除所选）。 */
  deleteItems(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<void>;
}

function normalizeStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError("Unable to update the Bilimuzhi batch database");
}

function readJob(value: unknown): BatchJob | null {
  try {
    return createBatchJob(value as BatchJob);
  } catch {
    return null;
  }
}

function readItem(
  value: unknown,
  defaultSpeechLanguageMode: SubtitleLanguageMode = "mixed",
): BatchItem | null {
  try {
    return readBatchItemFromStored(value, defaultSpeechLanguageMode);
  } catch {
    return null;
  }
}

function exactBatchItemIdentity(item: BatchItem): string {
  return `${item.bvid}:${item.aid ?? ""}:${item.cid ?? ""}:${item.page}`;
}

function sortItems(items: readonly BatchItem[]): readonly BatchItem[] {
  return Object.freeze(
    [...items].sort((left, right) => left.order - right.order),
  );
}

export class IndexedDbBatchRepository implements BatchRepository {
  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: BatchRepositoryDependencies,
  ) {}

  private readonly selectionByJob = new Map<string, ReadonlySet<string>>();

  private applySelection(item: BatchItem): BatchItem {
    const selected = this.selectionByJob.get(item.batchJobId);
    return selected === undefined
      ? item
      : createBatchItem(
          { ...item, selected: selected.has(item.batchItemId) },
          this.dependencies.defaultSpeechLanguageMode,
        );
  }

  private forStorage(item: BatchItem): BatchItem {
    return createBatchItem(
      { ...item, selected: false },
      this.dependencies.defaultSpeechLanguageMode,
    );
  }

  async createJob(
    job: BatchJob,
    items: readonly BatchItem[],
  ): Promise<BatchJobView> {
    try {
      const normalizedJob = createBatchJob(job);
      const normalizedItems = items.map((item) => this.forStorage(item));
      if (
        normalizedItems.some(
          (item) => item.batchJobId !== normalizedJob.batchJobId,
        )
      ) {
        throw new StorageError("The batch item does not belong to the job");
      }
      const transaction = this.database.transaction(
        ["batchJobs", "batchItems", "workspaceBatchPlacements"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      transaction.objectStore("batchJobs").put(normalizedJob);
      transaction.objectStore("workspaceBatchPlacements").put({
        batchJobId: normalizedJob.batchJobId,
        order: normalizedJob.createdAt,
        pinned: false,
      });
      const store = transaction.objectStore("batchItems");
      for (const item of normalizedItems) store.put(item);
      await done;
      return Object.freeze({
        items: sortItems(
          normalizedItems.map((item) => this.applySelection(item)),
        ),
        job: normalizedJob,
      });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async createList(input: {
    readonly batchJobId: string;
    readonly browserSessionId: string;
    readonly createdAt: number;
  }): Promise<BatchJobView> {
    try {
      const transaction = this.database.transaction(
        ["batchJobs", "workspaceBatchPlacements"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const jobs = transaction.objectStore("batchJobs");
      const stored = (await requestResult(jobs.getAll())) as readonly unknown[];
      const names = stored
        .map(readJob)
        .filter((job): job is BatchJob => job !== null)
        .map((job) => job.name ?? "");
      const job = createBatchJob({
        ...input,
        name: nextBatchListName(names),
        status: "ready",
        updatedAt: input.createdAt,
      });
      jobs.add(job);
      transaction.objectStore("workspaceBatchPlacements").add({
        batchJobId: job.batchJobId,
        order: job.createdAt,
        pinned: false,
      });
      await done;
      return Object.freeze({ items: Object.freeze([]), job });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async appendSource(
    batchJobId: string,
    items: readonly BatchItem[],
    history: BatchSourceHistoryEntry,
    requirePreparing = false,
  ): Promise<
    BatchJobView & {
      readonly addedCount: number;
      readonly duplicateCount: number;
    }
  > {
    try {
      const normalizedHistory = createBatchSourceHistoryEntry(history);
      if (normalizedHistory.batchJobId !== batchJobId) {
        throw new StorageError(
          "The batch source history does not belong to the job",
        );
      }
      const transaction = this.database.transaction(
        ["batchJobs", "batchItems", "batchSourceHistory"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const jobs = transaction.objectStore("batchJobs");
      const job = readJob(await requestResult(jobs.get(batchJobId)));
      if (job === null) {
        transaction.abort();
        throw new StorageError("The batch list does not exist");
      }
      if (requirePreparing && job.status !== "preparing") {
        transaction.abort();
        throw new StorageError("The batch list append is no longer active");
      }
      const itemStore = transaction.objectStore("batchItems");
      const stored = (await requestResult(
        itemStore
          .index("byJobOrder")
          .getAll(
            IDBKeyRange.bound(
              [batchJobId, 0],
              [batchJobId, Number.MAX_SAFE_INTEGER],
            ),
          ),
      )) as readonly unknown[];
      const existing = stored
        .map((value) =>
          readItem(value, this.dependencies.defaultSpeechLanguageMode),
        )
        .filter((item): item is BatchItem => item !== null);
      const identities = new Set(existing.map(exactBatchItemIdentity));
      const appended: BatchItem[] = [];
      let duplicateCount = 0;
      for (const candidate of items) {
        const normalized = this.forStorage(
          createBatchItem(
            {
              ...candidate,
              batchJobId,
              order: existing.length + appended.length,
              selected: false,
            },
            this.dependencies.defaultSpeechLanguageMode,
          ),
        );
        const identity = exactBatchItemIdentity(normalized);
        if (identities.has(identity)) {
          duplicateCount += 1;
          continue;
        }
        identities.add(identity);
        appended.push(normalized);
        itemStore.put(normalized);
      }
      const addedCount = appended.length;
      transaction.objectStore("batchSourceHistory").put(
        createBatchSourceHistoryEntry({
          ...normalizedHistory,
          addedCount,
          duplicateCount,
        }),
      );
      jobs.put(
        createBatchJob({
          ...job,
          status: "ready",
          updatedAt: Math.max(this.dependencies.now(), job.updatedAt),
        }),
      );
      await done;
      return Object.freeze({
        addedCount,
        duplicateCount,
        items: sortItems(
          [...existing, ...appended].map((item) => this.applySelection(item)),
        ),
        job: createBatchJob({
          ...job,
          status: "ready",
          updatedAt: Math.max(this.dependencies.now(), job.updatedAt),
        }),
      });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async listWorkspaceLists(): Promise<
    readonly { readonly job: BatchJob; readonly pinned: boolean }[]
  > {
    try {
      const transaction = this.database.transaction(
        ["batchJobs", "workspaceBatchPlacements"],
        "readonly",
      );
      const done = transactionDone(transaction);
      const [stored, placements] = await Promise.all([
        requestResult(transaction.objectStore("batchJobs").getAll()),
        requestResult(
          transaction.objectStore("workspaceBatchPlacements").getAll(),
        ),
      ]);
      await done;
      const byId = new Map<
        string,
        { readonly order: number; readonly pinned: boolean }
      >();
      for (const placement of placements as readonly {
        readonly batchJobId: string;
        readonly order: number;
        readonly pinned: boolean;
      }[]) {
        byId.set(placement.batchJobId, placement);
      }
      return Object.freeze(
        (stored as readonly unknown[])
          .map(readJob)
          .filter(
            (job): job is BatchJob => job !== null && byId.has(job.batchJobId),
          )
          .sort((left, right) => {
            const leftPinned = byId.get(left.batchJobId)?.pinned ?? false;
            const rightPinned = byId.get(right.batchJobId)?.pinned ?? false;
            if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
            return (
              (byId.get(left.batchJobId)?.order ?? left.createdAt) -
              (byId.get(right.batchJobId)?.order ?? right.createdAt)
            );
          })
          .map((job) =>
            Object.freeze({
              job,
              pinned: byId.get(job.batchJobId)?.pinned ?? false,
            }),
          ),
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async renameList(batchJobId: string, name: string): Promise<BatchJob | null> {
    try {
      const normalized = name.trim().slice(0, 200);
      if (normalized.length === 0) return null;
      const transaction = this.database.transaction("batchJobs", "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore("batchJobs");
      const stored = await requestResult(store.get(batchJobId));
      const job = readJob(stored);
      if (job === null) {
        transaction.abort();
        return null;
      }
      const next = createBatchJob({
        ...job,
        name: normalized,
        updatedAt: Math.max(this.dependencies.now(), job.updatedAt),
      });
      store.put(next);
      await done;
      return next;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async setPinned(batchJobId: string, pinned: boolean): Promise<boolean> {
    try {
      const transaction = this.database.transaction(
        "workspaceBatchPlacements",
        "readwrite",
      );
      const done = transactionDone(transaction);
      const store = transaction.objectStore("workspaceBatchPlacements");
      const stored = (await requestResult(store.get(batchJobId))) as
        { readonly order: number } | undefined;
      if (stored === undefined) {
        transaction.abort();
        return false;
      }
      store.put({
        batchJobId,
        order: stored.order,
        pinned,
      });
      await done;
      return true;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async moveListToArchive(
    batchJobId: string,
    archivedAt: number,
  ): Promise<void> {
    try {
      const transaction = this.database.transaction(
        ["archiveBatchPlacements", "workspaceBatchPlacements"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const workspace = transaction.objectStore("workspaceBatchPlacements");
      const stored = (await requestResult(workspace.get(batchJobId))) as
        { readonly order: number; readonly pinned: boolean } | undefined;
      if (stored === undefined) {
        transaction.abort();
        throw new StorageError("The batch list is not in the workspace");
      }
      transaction.objectStore("archiveBatchPlacements").put(
        createArchiveBatchPlacement({
          archivedAt,
          batchJobId,
          order: stored.order,
          pinned: stored.pinned,
        }),
      );
      workspace.delete(batchJobId);
      await done;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async moveListToTrash(
    batchJobId: string,
    meta: {
      readonly deletionReason: string;
      readonly purgeAfter: number | null;
      readonly retentionStartedAt: number;
      readonly trashedAt: number;
      readonly trashOrigin: "workspace" | "archive";
    },
  ): Promise<void> {
    try {
      const transaction = this.database.transaction(
        [
          "archiveBatchPlacements",
          "trashBatchPlacements",
          "workspaceBatchPlacements",
        ],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const workspace = transaction.objectStore("workspaceBatchPlacements");
      const archive = transaction.objectStore("archiveBatchPlacements");
      const stored =
        ((await requestResult(workspace.get(batchJobId))) as
          { readonly order: number; readonly pinned: boolean } | undefined) ??
        ((await requestResult(archive.get(batchJobId))) as
          { readonly order: number; readonly pinned: boolean } | undefined);
      if (stored === undefined) {
        transaction.abort();
        throw new StorageError("The batch list is not in the workspace");
      }
      transaction.objectStore("trashBatchPlacements").put(
        createTrashBatchPlacement({
          batchJobId,
          deletionReason: meta.deletionReason,
          order: stored.order,
          pinned: stored.pinned,
          purgeAfter: meta.purgeAfter,
          retentionStartedAt: meta.retentionStartedAt,
          trashedAt: meta.trashedAt,
          trashOrigin: meta.trashOrigin,
        }),
      );
      workspace.delete(batchJobId);
      archive.delete(batchJobId);
      await done;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async read(batchJobId: string): Promise<BatchJobView | null> {
    try {
      const transaction = this.database.transaction(
        ["batchJobs", "batchItems"],
        "readonly",
      );
      const done = transactionDone(transaction);
      const [storedJob, storedItems] = await Promise.all([
        requestResult(transaction.objectStore("batchJobs").get(batchJobId)),
        requestResult(
          transaction
            .objectStore("batchItems")
            .index("byJobOrder")
            .getAll(
              IDBKeyRange.bound(
                [batchJobId, 0],
                [batchJobId, Number.MAX_SAFE_INTEGER],
              ),
            ),
        ),
      ]);
      await done;
      const job = readJob(storedJob);
      if (job === null) return null;
      return Object.freeze({
        items: sortItems(
          (storedItems as readonly unknown[])
            .map((value) =>
              readItem(value, this.dependencies.defaultSpeechLanguageMode),
            )
            .filter((item): item is BatchItem => item !== null)
            .map((item) => this.applySelection(item)),
        ),
        job,
      });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async updateJobStatus(
    batchJobId: string,
    status: BatchJob["status"],
  ): Promise<BatchJob | null> {
    try {
      const transaction = this.database.transaction("batchJobs", "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore("batchJobs");
      const current = readJob(await requestResult(store.get(batchJobId)));
      if (current === null) {
        await done;
        return null;
      }
      const next = createBatchJob({
        ...current,
        status,
        updatedAt: Math.max(this.dependencies.now(), current.updatedAt),
      });
      store.put(next);
      await done;
      return next;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async updateItem(item: BatchItem): Promise<BatchItem | null> {
    try {
      const normalized = createBatchItem(
        item,
        this.dependencies.defaultSpeechLanguageMode,
      );
      const transaction = this.database.transaction(
        ["batchItems", "batchJobs"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const jobs = transaction.objectStore("batchJobs");
      const job = readJob(await requestResult(jobs.get(normalized.batchJobId)));
      if (job === null) {
        transaction.abort();
        return null;
      }
      transaction.objectStore("batchItems").put(this.forStorage(normalized));
      await done;
      return this.applySelection(normalized);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async setSelection(
    batchJobId: string,
    selectedItemIds: readonly string[],
  ): Promise<readonly BatchItem[]> {
    try {
      const selected = new Set(selectedItemIds);
      const transaction = this.database.transaction("batchItems", "readonly");
      const done = transactionDone(transaction);
      const store = transaction.objectStore("batchItems");
      const stored = (await requestResult(
        store
          .index("byJobOrder")
          .getAll(
            IDBKeyRange.bound(
              [batchJobId, 0],
              [batchJobId, Number.MAX_SAFE_INTEGER],
            ),
          ),
      )) as readonly unknown[];
      this.selectionByJob.set(batchJobId, selected);
      const next = stored
        .map((value) =>
          readItem(value, this.dependencies.defaultSpeechLanguageMode),
        )
        .filter((item): item is BatchItem => item !== null)
        .map((item) => this.applySelection(item));
      await done;
      return sortItems(next);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async readSubtitle(batchItemId: string): Promise<BatchSubtitle | null> {
    try {
      const transaction = this.database.transaction(
        "batchSubtitles",
        "readonly",
      );
      const done = transactionDone(transaction);
      const stored = await requestResult(
        transaction.objectStore("batchSubtitles").get(batchItemId),
      );
      await done;
      if (stored === undefined) return null;
      return createBatchSubtitle(stored as BatchSubtitle);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async writeSubtitle(subtitle: BatchSubtitle): Promise<BatchSubtitle> {
    try {
      const normalized = createBatchSubtitle(subtitle);
      const transaction = this.database.transaction(
        ["batchItems", "batchSubtitles"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const item = await requestResult(
        transaction.objectStore("batchItems").get(normalized.batchItemId),
      );
      if (readItem(item) === null) {
        transaction.abort();
        throw new StorageError("The batch subtitle owner does not exist");
      }
      transaction.objectStore("batchSubtitles").put(normalized);
      await done;
      return normalized;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async commitSubtitle(
    item: BatchItem,
    subtitle: BatchSubtitle,
  ): Promise<{ readonly item: BatchItem; readonly subtitle: BatchSubtitle }> {
    try {
      const normalizedItem = createBatchItem(item);
      const normalizedSubtitle = createBatchSubtitle(subtitle);
      if (normalizedSubtitle.batchItemId !== normalizedItem.batchItemId) {
        throw new StorageError("The batch subtitle owner is inconsistent");
      }
      const transaction = this.database.transaction(
        ["batchJobs", "batchItems", "batchSubtitles"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const job = readJob(
        await requestResult(
          transaction.objectStore("batchJobs").get(normalizedItem.batchJobId),
        ),
      );
      if (job === null) {
        transaction.abort();
        throw new StorageError("The batch subtitle job does not exist");
      }
      transaction.objectStore("batchSubtitles").put(normalizedSubtitle);
      transaction
        .objectStore("batchItems")
        .put(this.forStorage(normalizedItem));
      await done;
      return Object.freeze({
        item: this.applySelection(normalizedItem),
        subtitle: normalizedSubtitle,
      });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async deleteJob(batchJobId: string): Promise<void> {
    try {
      const transaction = this.database.transaction(
        [
          "archiveBatchPlacements",
          "batchJobs",
          "batchItems",
          "batchSourceHistory",
          "batchSubtitles",
          "trashBatchPlacements",
          "workspaceBatchPlacements",
        ],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const items = transaction.objectStore("batchItems");
      const subtitles = transaction.objectStore("batchSubtitles");
      const keys = await requestResult(
        items
          .index("byJobOrder")
          .getAllKeys(
            IDBKeyRange.bound(
              [batchJobId, 0],
              [batchJobId, Number.MAX_SAFE_INTEGER],
            ),
          ),
      );
      for (const key of keys) {
        items.delete(key);
        subtitles.delete(key);
      }
      transaction.objectStore("batchJobs").delete(batchJobId);
      transaction.objectStore("workspaceBatchPlacements").delete(batchJobId);
      transaction.objectStore("archiveBatchPlacements").delete(batchJobId);
      transaction.objectStore("trashBatchPlacements").delete(batchJobId);
      const history = transaction.objectStore("batchSourceHistory");
      const historyKeys = await requestResult(
        history
          .index("byJobAddedAt")
          .getAllKeys(
            IDBKeyRange.bound(
              [batchJobId, 0],
              [batchJobId, Number.MAX_SAFE_INTEGER],
            ),
          ),
      );
      for (const key of historyKeys) history.delete(key);
      await done;
      this.selectionByJob.delete(batchJobId);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async deleteSubtitle(batchItemId: string): Promise<void> {
    try {
      const transaction = this.database.transaction(
        "batchSubtitles",
        "readwrite",
      );
      const done = transactionDone(transaction);
      transaction.objectStore("batchSubtitles").delete(batchItemId);
      await done;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async deleteItems(
    batchJobId: string,
    batchItemIds: readonly string[],
  ): Promise<void> {
    try {
      const transaction = this.database.transaction(
        ["batchItems", "batchSubtitles"],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const items = transaction.objectStore("batchItems");
      const subtitles = transaction.objectStore("batchSubtitles");
      for (const batchItemId of batchItemIds) {
        items.delete(batchItemId);
        subtitles.delete(batchItemId);
      }
      await done;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async listArchivedLists() {
    try {
      const transaction = this.database.transaction(
        ["archiveBatchPlacements", "batchJobs"],
        "readonly",
      );
      const done = transactionDone(transaction);
      const [jobs, placements] = await Promise.all([
        requestResult(transaction.objectStore("batchJobs").getAll()),
        requestResult(
          transaction.objectStore("archiveBatchPlacements").getAll(),
        ),
      ]);
      await done;
      const jobsById = new Map<string, BatchJob>();
      for (const value of jobs as readonly unknown[]) {
        const job = readJob(value);
        if (job !== null) jobsById.set(job.batchJobId, job);
      }
      return Object.freeze(
        (
          placements as readonly {
            readonly archivedAt: number;
            readonly batchJobId: string;
            readonly order: number;
            readonly pinned: boolean;
          }[]
        )
          .filter((placement) => jobsById.has(placement.batchJobId))
          .sort((left, right) => left.order - right.order)
          .map((placement) =>
            Object.freeze({
              archivedAt: placement.archivedAt,
              job: jobsById.get(placement.batchJobId)!,
              order: placement.order,
              pinned: placement.pinned,
            }),
          ),
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async listTrashedLists() {
    try {
      const transaction = this.database.transaction(
        ["batchJobs", "trashBatchPlacements"],
        "readonly",
      );
      const done = transactionDone(transaction);
      const [jobs, placements] = await Promise.all([
        requestResult(transaction.objectStore("batchJobs").getAll()),
        requestResult(transaction.objectStore("trashBatchPlacements").getAll()),
      ]);
      await done;
      const jobsById = new Map<string, BatchJob>();
      for (const value of jobs as readonly unknown[]) {
        const job = readJob(value);
        if (job !== null) jobsById.set(job.batchJobId, job);
      }
      return Object.freeze(
        (
          placements as readonly {
            readonly batchJobId: string;
            readonly deletionReason: string;
            readonly order: number;
            readonly pinned: boolean;
            readonly purgeAfter: number | null;
            readonly retentionStartedAt: number;
            readonly trashedAt: number;
            readonly trashOrigin: "workspace" | "archive";
          }[]
        )
          .filter((placement) => jobsById.has(placement.batchJobId))
          .sort((left, right) => left.trashedAt - right.trashedAt)
          .map((placement) =>
            Object.freeze({
              deletionReason: placement.deletionReason,
              job: jobsById.get(placement.batchJobId)!,
              order: placement.order,
              pinned: placement.pinned,
              purgeAfter: placement.purgeAfter,
              retentionStartedAt: placement.retentionStartedAt,
              trashedAt: placement.trashedAt,
              trashOrigin: placement.trashOrigin,
            }),
          ),
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  /**
   * 恢复列表到工作区：回收站 placement 优先，其次归档 placement。
   * 归档区「恢复列表至工作区」与回收站恢复共用同一命令，
   * 因此这里必须同时处理两种 placement（2026-08-13 切片 Ticket 01）。
   */
  async restoreList(batchJobId: string): Promise<boolean> {
    try {
      const transaction = this.database.transaction(
        [
          "archiveBatchPlacements",
          "trashBatchPlacements",
          "workspaceBatchPlacements",
        ],
        "readwrite",
      );
      const done = transactionDone(transaction);
      const trash = transaction.objectStore("trashBatchPlacements");
      const archive = transaction.objectStore("archiveBatchPlacements");
      const stored =
        ((await requestResult(trash.get(batchJobId))) as
          { readonly order: number; readonly pinned: boolean } | undefined) ??
        ((await requestResult(archive.get(batchJobId))) as
          { readonly order: number; readonly pinned: boolean } | undefined);
      if (stored === undefined) {
        await done;
        return false;
      }
      transaction.objectStore("workspaceBatchPlacements").put(
        createWorkspaceBatchPlacement({
          batchJobId,
          order: stored.order,
          pinned: stored.pinned,
        }),
      );
      trash.delete(batchJobId);
      archive.delete(batchJobId);
      await done;
      return true;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async purgeList(batchJobId: string): Promise<void> {
    try {
      const transaction = this.database.transaction(
        [
          "archiveBatchPlacements",
          "batchJobs",
          "batchItems",
          "batchSourceHistory",
          "batchSubtitles",
          "trashBatchPlacements",
          "workspaceBatchPlacements",
        ],
        "readwrite",
      );
      const done = transactionDone(transaction);
      // 前置检查（Ticket 05 review）：仅当列表仍处于回收站时才级联删除。
      // 防止到期清理扫描与用户恢复之间的竞态把已恢复的列表误删。
      const trashPlacements = transaction.objectStore("trashBatchPlacements");
      const trashStored = await requestResult(trashPlacements.get(batchJobId));
      if (trashStored === undefined) {
        await done;
        return;
      }
      const items = transaction.objectStore("batchItems");
      const subtitles = transaction.objectStore("batchSubtitles");
      const keys = await requestResult(
        items
          .index("byJobOrder")
          .getAllKeys(
            IDBKeyRange.bound(
              [batchJobId, 0],
              [batchJobId, Number.MAX_SAFE_INTEGER],
            ),
          ),
      );
      for (const key of keys) {
        items.delete(key);
        subtitles.delete(key);
      }
      transaction.objectStore("batchJobs").delete(batchJobId);
      transaction.objectStore("workspaceBatchPlacements").delete(batchJobId);
      transaction.objectStore("archiveBatchPlacements").delete(batchJobId);
      trashPlacements.delete(batchJobId);
      const history = transaction.objectStore("batchSourceHistory");
      const historyKeys = await requestResult(
        history
          .index("byJobAddedAt")
          .getAllKeys(
            IDBKeyRange.bound(
              [batchJobId, 0],
              [batchJobId, Number.MAX_SAFE_INTEGER],
            ),
          ),
      );
      for (const key of historyKeys) history.delete(key);
      await done;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  /** 批量回收站保留期限（独立键 batchTrashRetention，schema 与 trashRetention 一致）。 */
  async getRetentionPolicy(): Promise<TrashRetentionPolicy> {
    try {
      const transaction = this.database.transaction("settings", "readonly");
      const stored = await requestResult(
        transaction
          .objectStore("settings")
          .get(BATCH_TRASH_RETENTION_SETTING_KEY),
      );
      await transactionDone(transaction);
      if (stored === undefined) return DEFAULT_TRASH_RETENTION_POLICY;
      const policy = (stored as { readonly policy?: unknown }).policy;
      try {
        return createTrashRetentionPolicy(policy as TrashRetentionPolicy);
      } catch {
        return DEFAULT_TRASH_RETENTION_POLICY;
      }
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async updateRetentionPolicy(
    inputPolicy: TrashRetentionPolicy,
    applyMode: TrashRetentionApplyMode,
  ): Promise<void> {
    const policy = createTrashRetentionPolicy(inputPolicy);
    if (applyMode !== "apply-to-existing" && applyMode !== "future-only") {
      throw new StorageError("The batch retention apply mode is invalid");
    }
    let transaction: IDBTransaction | undefined;
    try {
      const now = this.dependencies.now();
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new StorageError("The batch retention clock is invalid");
      }
      transaction = this.database.transaction(
        ["settings", "trashBatchPlacements"],
        "readwrite",
      );
      transaction.objectStore("settings").put({
        key: BATCH_TRASH_RETENTION_SETTING_KEY,
        policy,
        updatedAt: now,
      });
      if (applyMode === "future-only") {
        await transactionDone(transaction);
        return;
      }
      const placements = transaction.objectStore("trashBatchPlacements");
      const stored = (await requestResult(placements.getAll())) as readonly {
        readonly batchJobId: string;
        readonly order: number;
        readonly pinned: boolean;
      }[];
      const purgeAfter = calculateTrashPurgeAfter(now, policy);
      for (const placement of stored) {
        placements.put({
          ...placement,
          purgeAfter,
          retentionStartedAt: now,
        });
      }
      await transactionDone(transaction);
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // A completed transaction has no work left to roll back.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  /** 到期自动清理（对齐会话 alarm 机制）：永久删除到期批量回收站条目。 */
  async permanentlyDeleteExpiredBatchTrash(
    now: number,
  ): Promise<readonly string[]> {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new StorageError("The batch retention clock is invalid");
    }
    const transaction = this.database.transaction(
      ["trashBatchPlacements", "batchJobs"],
      "readonly",
    );
    const stored = (await requestResult(
      transaction.objectStore("trashBatchPlacements").getAll(),
    )) as readonly {
      readonly batchJobId: string;
      readonly purgeAfter: number | null;
    }[];
    await transactionDone(transaction);
    const expired = stored
      .filter(
        (placement) =>
          placement.purgeAfter !== null && placement.purgeAfter <= now,
      )
      .map((placement) => placement.batchJobId)
      .sort();
    for (const batchJobId of expired) {
      await this.purgeList(batchJobId);
    }
    return Object.freeze(expired);
  }
}
