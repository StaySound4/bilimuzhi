import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import type { BatchJobView } from "../../application/batch-runtime";
import type { GroqRoutingMode } from "../../application/asr-contract";
import type {
  BatchAcquisitionMethod,
  BatchItem,
  SubtitleLanguageMode,
} from "../../domain";
import { parseBatchColumnLayout } from "./batch-column-layout";
import {
  defaultBatchColumnLayoutV2,
  defaultBatchColumnLayoutV2Storage,
  migrateBatchColumnLayoutV1,
  parseBatchColumnLayoutV2,
  toggleForceFullTextV2,
  type BatchColumnLayoutV2,
  type BatchColumnLayoutV2Storage,
} from "./batch-column-layout-v2";
import {
  filterBatchItems,
  statusFilterCounts,
  type BatchStatusFilter,
} from "./batch-filter";
import { CompactActionMenu } from "../primitives/compact-action-menu";
import {
  freezeBatchActionScope,
  type FrozenBatchActionScope,
} from "./batch-action-scope";
import { AppDialog } from "../dialogs/app-dialog";
import {
  sourceChoices,
  type RecognizedSingleVideoPages,
  type BatchSourceChoice,
  type SingleVideoPageSelection,
} from "./batch-source-form";
import { BatchSourceDialog } from "./batch-source-dialog";
import { BatchColumnSettingsDialog } from "./batch-column-settings-dialog";
import { BatchItemTable } from "./batch-item-table";
import { BatchListEmptyState } from "./batch-empty-state";
import {
  BatchAcquireDialog,
  type BatchOverwriteChoice,
  type BatchSpeechScope,
} from "./batch-acquire-dialog";
import { itemStatusText, jobStatusLabel } from "./batch-labels";
import "./batch-workspace.css";

export type BatchExportFormat = "txt" | "srt" | "markdown";
export interface BatchExportOptions {
  readonly includeTimestamps?: boolean;
  /** 多选导出时是否打包 ZIP；缺省打包。 */
  readonly zip?: boolean;
}
export type {
  BatchSourceChoice,
  SingleVideoPageSelection,
} from "./batch-source-form";
export type {
  BatchOverwriteChoice,
  BatchSpeechScope,
} from "./batch-acquire-dialog";
export type { BatchJobSummary } from "./batch-jobs-list";

interface FrozenBatchExportScope extends FrozenBatchActionScope {
  readonly exportableIds: readonly string[];
}

export interface BatchWorkspaceProps {
  readonly uiLanguage?: UiLanguage;
  readonly busy?: boolean;
  readonly errorMessage?: string;
  readonly includeAllPages: boolean;
  readonly input: string;
  /** 是否已存在至少一个 Batch List（无列表/有列表空态区分）。 */
  readonly hasLists: boolean;
  readonly onCancel: () => void;
  readonly onCreateList?: () => void;
  readonly onExport: (
    format: BatchExportFormat,
    batchItemIds?: readonly string[],
    options?: BatchExportOptions,
  ) => void;
  readonly onIncludeAllPagesChange: (value: boolean) => void;
  readonly onInputChange: (value: string) => void;
  /** v16 D5：轨道选择框切换即重取（单条目、无确认，强制覆盖该条目）。 */
  readonly onRefetchTrack?: (batchItemId: string, trackId: string) => void;
  readonly onItemSpeechLanguageChange?: (
    batchItemId: string,
    speechLanguageMode: SubtitleLanguageMode,
  ) => void;
  /** 获取字幕 Dialog 内批量设置语音请求语言作用域（具体语言写入作用域内全部条目；"item" 不写入）。 */
  readonly onSpeechLanguageChange?: (
    speechScope: BatchSpeechScope,
    batchItemIds: readonly string[],
  ) => void;
  readonly onSpeechRoutingModeChange?: (value: GroqRoutingMode) => void;
  /** 会话模式语音默认请求语言（行级设置未持久化时展示）。 */
  readonly speechLanguageMode: SubtitleLanguageMode;
  /** 会话模式语音模型策略（行级设置 Dialog 可调整）。 */
  readonly speechRoutingMode: GroqRoutingMode;
  /** Groq 密钥是否已配置（复用会话模式提示）。 */
  readonly speechConfigured: boolean;
  readonly onClearItem?: (batchItemId: string) => void;
  /** v16 D5：删除所选条目（确认后调用）。 */
  readonly onDeleteItems?: (batchItemIds: readonly string[]) => void;
  readonly onLanguagePreferenceChange: (value: string) => void;
  /** 列表级多选激活时暂停右侧修改动作（选择域隔离）。 */
  readonly listSelectionActive?: boolean;
  /** 顶栏帮助问号（Ticket 06 六语境入口的前身）。 */
  readonly onHelpClick?: () => void;
  /** 布局持久化注入（组件测试用内存实现）；缺省为 chrome.storage.local。 */
  readonly layoutStorage?: BatchColumnLayoutV2Storage;
  /** @deprecated v9 batch results are independent and never render Session actions. */
  readonly onOpenSession?: (sessionId: string) => void;
  readonly onPrepare: () => void;
  readonly onSelectionChange: (
    selectedItemIds: readonly string[],
  ) => void | Promise<void>;
  readonly onSingleVideoPageSelectionChange?: (
    selection: SingleVideoPageSelection,
  ) => void;
  readonly onSourceKindChange?: (value: BatchSourceChoice) => void;
  readonly onStart: (
    method?: BatchAcquisitionMethod,
    batchItemIds?: readonly string[],
    overwrite?: BatchOverwriteChoice,
    speechScope?: BatchSpeechScope,
  ) => void;
  readonly onFetchByCurrentPage?: () =>
    boolean | void | Promise<boolean | void>;
  readonly preparing?: boolean;
  readonly recognizedSingleVideoPages?: RecognizedSingleVideoPages;
  readonly singleVideoPageSelection?: SingleVideoPageSelection;
  readonly sourceKind?: BatchSourceChoice;
  readonly statusMessage?: string;
  readonly view?: BatchJobView;
}

function sourcePreparationProgress(
  message: string | undefined,
): { readonly completed: number; readonly total: number } | null {
  const match = /(?:^|\D)(\d+)\s*\/\s*(\d+)(?:\D|$)/.exec(message ?? "");
  if (!match) return null;
  const completed = Number(match[1]);
  const total = Number(match[2]);
  if (
    !Number.isSafeInteger(completed) ||
    !Number.isSafeInteger(total) ||
    completed < 0 ||
    total <= 0 ||
    completed > total
  ) {
    return null;
  }
  return Object.freeze({ completed, total });
}

export function BatchWorkspace({
  busy = false,
  errorMessage,
  includeAllPages,
  input,
  hasLists,
  onCancel,
  onCreateList,
  onExport,
  onIncludeAllPagesChange,
  onInputChange,
  onItemSpeechLanguageChange,
  onSpeechLanguageChange,
  onSpeechRoutingModeChange,
  speechConfigured,
  speechLanguageMode,
  speechRoutingMode,
  onClearItem,
  onDeleteItems,
  onRefetchTrack,
  onLanguagePreferenceChange,
  listSelectionActive = false,
  layoutStorage,
  onPrepare,
  onSelectionChange,
  onSingleVideoPageSelectionChange,
  onSourceKindChange,
  onStart,
  onFetchByCurrentPage,
  preparing,
  recognizedSingleVideoPages,
  singleVideoPageSelection,
  sourceKind,
  statusMessage,
  uiLanguage,
  view,
}: BatchWorkspaceProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [selectionPending, setSelectionPending] = useState(false);
  const [localSelectedIds, setLocalSelectedIds] = useState<
    readonly string[] | null
  >(null);
  /** 统一「批量获取字幕」Dialog：冻结作用域 + 已有字幕计数 + 是否全部已有。 */
  const [acquireDialog, setAcquireDialog] = useState<{
    readonly scope: FrozenBatchActionScope;
    readonly existingCount: number;
    readonly allHaveSubtitles: boolean;
  } | null>(null);
  const [acquireMethod, setAcquireMethod] =
    useState<BatchAcquisitionMethod>("direct");
  const [acquireOverwrite, setAcquireOverwrite] =
    useState<BatchOverwriteChoice>("skip");
  /** 获取字幕 Dialog 内语音转录语言作用域（本地状态，不随外部 prop 弹回）。 */
  const [acquireSpeechScope, setAcquireSpeechScope] =
    useState<BatchSpeechScope>("mixed");
  /** 「解析并加入列表」Dialog 开关。 */
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  /** 本次 Dialog 会话内的去重摘要（关闭即清空，避免陈旧展示）。 */
  const [appendSummary, setAppendSummary] = useState<{
    readonly added: number;
    readonly duplicate: number;
  } | null>(null);
  /** 来源类型帮助 Dialog。 */
  const [showingSourceHelp, setShowingSourceHelp] = useState(false);
  /** 「调整列」Dialog 开关。 */
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  /** 行级「从列表中删除」确认：冻结单个条目 ID。 */
  const [confirmingDeleteItemId, setConfirmingDeleteItemId] = useState<
    string | null
  >(null);
  /** 行级「设置语音转录与语言」Dialog：当前条目 ID。 */
  const [speechSettingsItemId, setSpeechSettingsItemId] = useState<
    string | null
  >(null);
  const [choosingExport, setChoosingExport] = useState(false);
  const [frozenExportScope, setFrozenExportScope] =
    useState<FrozenBatchExportScope | null>(null);
  const [exportIncludeTimestamps, setExportIncludeTimestamps] = useState(true);
  const [exportZip, setExportZip] = useState(true);
  const [layout, setLayout] = useState<BatchColumnLayoutV2>(
    defaultBatchColumnLayoutV2,
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const activeLayoutStorage =
    layoutStorage ?? defaultBatchColumnLayoutV2Storage;
  const dialogConfirmRef = useRef<HTMLButtonElement>(null);
  // dialogConfirmRef 仅用于导出 Dialog 聚焦 TXT 安全默认；其余 Dialog 由 AppDialog 管理焦点。
  const items = view?.items ?? [];
  // Region 3：状态筛选（只改变 UI 投影，不改数据/不触发 refetch）。
  const [statusFilter, setStatusFilter] = useState<BatchStatusFilter>("all");
  const visibleItems = filterBatchItems(items, statusFilter);
  const filteredCounts = statusFilterCounts(items);
  const persistedSelectedIds = items
    .filter((item) => item.selected)
    .map((item) => item.batchItemId);
  const selectedIds = localSelectedIds ?? persistedSelectedIds;
  const filterLabel = (filter: BatchStatusFilter): string =>
    filter === "all"
      ? t(lang, "batch.filterAll")
      : itemStatusText(lang, filter);
  const actionScopeText = (scope: FrozenBatchActionScope): string =>
    t(lang, "batch.actionScope", {
      filter: filterLabel(scope.filter),
      count: scope.itemIds.length,
    });
  const freezeCurrentActionScope = (): FrozenBatchActionScope =>
    freezeBatchActionScope(statusFilter, selectedIds);
  const publishSelection = (nextIds: readonly string[]): void => {
    if (selectionPending) return;
    const frozenNextIds = Object.freeze([...nextIds]);
    const persistence = onSelectionChange(frozenNextIds);
    if (
      persistence === undefined ||
      typeof (persistence as PromiseLike<void>).then !== "function"
    ) {
      return;
    }
    setLocalSelectedIds(frozenNextIds);
    setSelectionPending(true);
    Promise.resolve(persistence).then(
      () => {
        setLocalSelectedIds(null);
        setSelectionPending(false);
      },
      () => {
        setLocalSelectedIds(null);
        setSelectionPending(false);
      },
    );
  };
  /** 切换一组 IDs 的选择状态：全部已选则移除，否则并入。 */
  const toggleSelection = (ids: readonly string[]): void => {
    const allSelected = ids.every((id) => selectedIds.includes(id));
    publishSelection(
      allSelected
        ? selectedIds.filter((id) => !ids.includes(id))
        : [...new Set([...selectedIds, ...ids])],
    );
  };
  const running = view?.job.status === "running";
  const taskLocked = running || view?.job.status === "preparing";
  const controlsUnavailableMessage = listSelectionActive
    ? t(lang, "batch.listSelectionPaused")
    : taskLocked
      ? t(lang, "batch.controlsLockedRunning")
      : selectionPending
        ? t(lang, "batch.selectionUpdating")
        : busy
          ? t(lang, "batch.controlsBusy")
          : null;
  const controlsUnavailableId =
    controlsUnavailableMessage === null
      ? undefined
      : "muzhi-batch-controls-note";
  const { succeeded, failed, cancelled } = filteredCounts;
  const exportable = items.filter(
    (item) => item.selected && item.status === "succeeded" && item.rowCount > 0,
  ).length;
  const exportableIds = items
    .filter(
      (item) =>
        item.selected && item.status === "succeeded" && item.rowCount > 0,
    )
    .map((item) => item.batchItemId);

  useEffect(() => {
    let cancelled = false;
    const resolve = (stored: unknown): BatchColumnLayoutV2 => {
      const v2 = parseBatchColumnLayoutV2(stored);
      if (v2 !== null) return v2;
      // 仅当确实是合法旧 v1 布局时才迁移并写回 v2（避免覆盖后续保存）。
      if (parseBatchColumnLayout(stored) !== null) {
        const migrated = migrateBatchColumnLayoutV1(stored);
        void activeLayoutStorage.save(migrated).catch(() => undefined);
        return migrated;
      }
      return defaultBatchColumnLayoutV2();
    };
    void activeLayoutStorage
      .load()
      .then((stored) => {
        if (cancelled) return;
        setLayout(resolve(stored));
      })
      .catch(() => {
        if (!cancelled) setLayout(defaultBatchColumnLayoutV2());
      });
    return () => {
      cancelled = true;
    };
  }, [activeLayoutStorage]);

  // 切换 BatchJob 时清空视频行选择（列表级/筛选切换的选择清理在各自入口）。
  const currentJobId = view?.job.batchJobId;
  const previousJobIdRef = useRef(currentJobId);
  useEffect(() => {
    const previousJobId = previousJobIdRef.current;
    previousJobIdRef.current = currentJobId;
    if (
      previousJobId !== undefined &&
      previousJobId !== currentJobId &&
      selectedIds.length > 0
    ) {
      publishSelection(Object.freeze([]));
    }
  }, [currentJobId]);

  const persistLayout = (next: BatchColumnLayoutV2): void => {
    setLayout(next);
    void activeLayoutStorage.save(next).catch(() => undefined);
  };

  const hasCurrentList = view !== undefined;
  const sourcePreparing =
    preparing === true ||
    view?.job.status === "preparing" ||
    (busy && view === undefined);
  const preparationProgress =
    view?.progress ?? sourcePreparationProgress(statusMessage);
  const visibleStatusMessage =
    statusMessage ??
    (sourcePreparing
      ? preparationProgress
        ? t(lang, "batch.preparingProgress", {
            completed: preparationProgress.completed,
            total: preparationProgress.total,
            added: preparationProgress.completed,
            failed: 0,
          })
        : t(lang, "batch.preparingSource")
      : undefined);
  const acquisitionRunnable =
    view !== undefined &&
    !taskLocked &&
    selectedIds.length > 0 &&
    items.some((item) => item.selected && item.videoKey !== null);

  useEffect(() => {
    if (
      acquireDialog === null &&
      !sourceDialogOpen &&
      !columnSettingsOpen &&
      confirmingDeleteItemId === null &&
      speechSettingsItemId === null &&
      !choosingExport
    )
      return;
    // 仅 export dialog 需要手动聚焦安全默认（TXT）；其余由 AppDialog 管理。
    if (choosingExport) {
      dialogConfirmRef.current?.focus();
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      setAcquireDialog(null);
      setSourceDialogOpen(false);
      setColumnSettingsOpen(false);
      setConfirmingDeleteItemId(null);
      setSpeechSettingsItemId(null);
      setChoosingExport(false);
      setFrozenExportScope(null);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    busy,
    acquireDialog,
    choosingExport,
    columnSettingsOpen,
    confirmingDeleteItemId,
    sourceDialogOpen,
    speechSettingsItemId,
  ]);

  useEffect(() => {
    if (!sourceDialogOpen) {
      setAppendSummary(null);
      return;
    }
    if (
      view !== undefined &&
      (view.addedCount !== undefined || view.duplicateCount !== undefined)
    ) {
      setAppendSummary({
        added: view.addedCount ?? 0,
        duplicate: view.duplicateCount ?? 0,
      });
    }
  }, [sourceDialogOpen, view]);

  const toggle = (batchItemId: string, selected: boolean): void => {
    publishSelection(
      selected
        ? [...new Set([...selectedIds, batchItemId])]
        : selectedIds.filter((id) => id !== batchItemId),
    );
  };

  const openAcquireDialog = (): void => {
    if (!view || selectedIds.length === 0) return;
    const scope = freezeCurrentActionScope();
    const existingCount = view.overwriteCount;
    const allHaveSubtitles = existingCount >= scope.itemIds.length;
    setAcquireDialog(
      Object.freeze({
        scope,
        existingCount,
        allHaveSubtitles,
      }),
    );
    setAcquireMethod("direct");
    // 全部已有时「跳过」不可选，默认「重新获取并替换」。
    setAcquireOverwrite(allHaveSubtitles ? "all" : "skip");
    // 语音转录语言作用域默认混合（不继承工作区设置）。
    setAcquireSpeechScope("mixed");
  };

  const toggleFromRow = (
    event: JSX.TargetedMouseEvent<HTMLTableRowElement>,
    item: BatchItem,
  ): void => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        "button, input, select, textarea, a, [role='button'], [role='link']",
      )
    ) {
      return;
    }
    if (busy || taskLocked || selectionPending) return;
    toggle(item.batchItemId, !item.selected);
  };

  /** 已有字幕时切换轨道：先确认替换（spec §7）。 */
  const [confirmingTrackSwitch, setConfirmingTrackSwitch] = useState<{
    readonly itemId: string;
    readonly trackId: string;
  } | null>(null);
  const changeTrack = (item: BatchItem, trackId: string): void => {
    if (!trackId) return;
    if (item.status === "succeeded" && onRefetchTrack) {
      setConfirmingTrackSwitch(
        Object.freeze({ itemId: item.batchItemId, trackId }),
      );
      return;
    }
    // v16 D5：无字幕时轨道选择即重取（单条目、无确认）。
    if (onRefetchTrack) {
      onRefetchTrack(item.batchItemId, trackId);
      return;
    }
    const track = item.availableTracks?.find(
      (candidate) => candidate.trackId === trackId,
    );
    if (!track) {
      onLanguagePreferenceChange("");
      return;
    }
    onLanguagePreferenceChange(track.language);
  };

  const resetExportOptions = (): void => {
    setExportIncludeTimestamps(true);
    setExportZip(true);
  };

  const publishExport = (
    format: BatchExportFormat,
    batchItemIds?: readonly string[],
  ): void => {
    onExport(format, batchItemIds, {
      includeTimestamps: exportIncludeTimestamps,
      zip: exportZip,
    });
  };

  const exportOptionFields = (
    <fieldset class="muzhi-batch__export-fields">
      <legend>{t(lang, "batch.exportOptions")}</legend>
      <label>
        <input
          checked={exportIncludeTimestamps}
          onChange={(event) =>
            setExportIncludeTimestamps(event.currentTarget.checked)
          }
          type="checkbox"
        />
        {t(lang, "batch.exportTimestamps")}
      </label>
      {frozenExportScope !== null &&
      frozenExportScope.exportableIds.length > 1 ? (
        <label>
          <input
            checked={exportZip}
            onChange={(event) => setExportZip(event.currentTarget.checked)}
            type="checkbox"
          />
          {t(lang, "batch.exportZip")}
        </label>
      ) : null}
    </fieldset>
  );
  const speechSettingsItem =
    speechSettingsItemId === null
      ? undefined
      : (items.find(
          (candidate) => candidate.batchItemId === speechSettingsItemId,
        ) ?? undefined);
  const confirmingDeleteItem =
    confirmingDeleteItemId === null
      ? undefined
      : (items.find(
          (candidate) => candidate.batchItemId === confirmingDeleteItemId,
        ) ?? undefined);
  const trackSwitchItem =
    confirmingTrackSwitch === null
      ? undefined
      : (items.find(
          (candidate) => candidate.batchItemId === confirmingTrackSwitch.itemId,
        ) ?? undefined);
  const trackSwitchOption = trackSwitchItem?.availableTracks?.find(
    (candidate) => candidate.trackId === confirmingTrackSwitch?.trackId,
  );

  return (
    <div class="muzhi-batch">
      {!hasCurrentList ? (
        <BatchListEmptyState
          busy={busy}
          onCreateList={onCreateList}
          uiLanguage={lang}
          variant={hasLists ? "select-list" : "no-lists"}
        />
      ) : (
        <>
          <header class="muzhi-batch__topbar">
            <div class="muzhi-batch__topbar-title">
              <h2>
                {view?.job.name ??
                  view?.job.sourceLabel ??
                  t(lang, "batch.jobsTitle")}
              </h2>
            </div>
            <button
              class="muzhi-batch__primary-action muzhi-btn muzhi-btn--primary"
              aria-describedby={controlsUnavailableId}
              disabled={
                busy || taskLocked || selectionPending || listSelectionActive
              }
              onClick={() => setSourceDialogOpen(true)}
              type="button"
            >
              {t(lang, "batch.parseDialogTitle")}
            </button>
          </header>

          {view !== undefined && items.length === 0 ? (
            <BatchListEmptyState
              onOpenSource={() => setSourceDialogOpen(true)}
              uiLanguage={lang}
              variant="list-empty"
            />
          ) : null}

          {errorMessage ? (
            <p class="muzhi-batch__error" role="alert">
              {errorMessage}
            </p>
          ) : null}
          {visibleStatusMessage ? (
            <p class="muzhi-batch__status" role="status">
              {visibleStatusMessage}
            </p>
          ) : null}
          {sourcePreparing ? (
            <progress
              aria-label={t(lang, "batch.prepareProgressAria")}
              aria-valuemax={preparationProgress?.total}
              aria-valuenow={preparationProgress?.completed}
              class="muzhi-batch__prepare-progress"
              {...(preparationProgress
                ? {
                    max: preparationProgress.total,
                    value: preparationProgress.completed,
                  }
                : {})}
            />
          ) : null}
        </>
      )}

      {view && items.length > 0 ? (
        <section
          class="muzhi-batch__result"
          aria-label={t(lang, "batch.itemsAria")}
        >
          <div class="muzhi-batch__result-header">
            <div>
              <h3>{view.job.sourceLabel}</h3>
              <p class="muzhi-batch__result-meta" aria-live="polite">
                {t(lang, "batch.resultMeta", {
                  status: jobStatusLabel(lang, view.job.status),
                  total: items.length,
                  selected: selectedIds.length,
                  succeeded,
                  failed,
                  cancelled,
                })}
              </p>
            </div>
            <button
              aria-pressed={layout.forceFullText}
              class={`muzhi-batch__force-full-text${
                layout.forceFullText ? " is-active" : ""
              }`}
              onClick={() =>
                persistLayout(toggleForceFullTextV2(layoutRef.current))
              }
              type="button"
            >
              {t(lang, "batch.forceFullText")}
            </button>
            <button
              aria-describedby={controlsUnavailableId}
              disabled={
                busy ||
                taskLocked ||
                selectionPending ||
                listSelectionActive ||
                visibleItems.length === 0
              }
              onClick={() =>
                toggleSelection(visibleItems.map((item) => item.batchItemId))
              }
              type="button"
            >
              {t(lang, "batch.selectAllFiltered", {
                count: visibleItems.length,
              })}
            </button>
            <button
              class="muzhi-batch__column-settings-open"
              disabled={busy || listSelectionActive}
              onClick={() => setColumnSettingsOpen(true)}
              type="button"
            >
              {t(lang, "batch.columnSettingsTitle")}
            </button>
          </div>

          {controlsUnavailableMessage ? (
            <p
              class="muzhi-batch__controls-note"
              id="muzhi-batch-controls-note"
              role="status"
            >
              {controlsUnavailableMessage}
            </p>
          ) : null}

          <div class="muzhi-batch__list-toolbar">
            <CompactActionMenu
              align="start"
              ariaLabel={t(lang, "batch.filterAria")}
              items={(
                ["all", "pending", "succeeded", "failed", "cancelled"] as const
              ).map((status) => ({
                accessibleName: `${
                  status === "all"
                    ? t(lang, "batch.filterAll")
                    : itemStatusText(lang, status)
                } ${filteredCounts[status]}`,
                kind: "item" as const,
                label: `${
                  status === "all"
                    ? t(lang, "batch.filterAll")
                    : itemStatusText(lang, status)
                } · ${filteredCounts[status]}`,
                onSelect: () => {
                  setStatusFilter(status);
                  if (selectedIds.length > 0) {
                    publishSelection(Object.freeze([]));
                  }
                },
              }))}
            />
            <span
              aria-live="polite"
              class="muzhi-batch__filter-summary"
              role="status"
            >
              {t(lang, "batch.filterActiveAria", {
                filter:
                  statusFilter === "all"
                    ? t(lang, "batch.filterAll")
                    : itemStatusText(lang, statusFilter),
                count: visibleItems.length,
              })}
            </span>
            <span class="muzhi-batch__running-summary">
              {t(lang, "batch.runningSummary", {
                count: filteredCounts.running,
              })}
            </span>
          </div>
          {visibleItems.length === 0 && items.length > 0 ? (
            <p class="muzhi-batch__filter-empty" role="status">
              {t(lang, "batch.filterEmpty")}
            </p>
          ) : null}

          <div
            class={`muzhi-batch__actions${selectedIds.length > 0 ? " is-contextual" : " is-idle"}`}
            aria-label={t(lang, "batch.actionsAria")}
            aria-live="polite"
            role="group"
          >
            {taskLocked ? (
              // Region 4：运行/准备中只显示停止获取与清空并删除任务例外。
              <>
                <button
                  class="muzhi-batch__danger-action"
                  onClick={onCancel}
                  type="button"
                >
                  {t(lang, "batch.stopBatch")}
                </button>
              </>
            ) : selectedIds.length > 0 ? (
              <>
                <strong>{actionScopeText(freezeCurrentActionScope())}</strong>
                <button
                  aria-describedby={controlsUnavailableId}
                  disabled={busy || selectionPending || listSelectionActive}
                  onClick={() => publishSelection(Object.freeze([]))}
                  type="button"
                >
                  {t(lang, "batch.clearSelection")}
                </button>
                <button
                  class="muzhi-batch__primary-action"
                  aria-describedby={controlsUnavailableId}
                  disabled={
                    busy ||
                    selectionPending ||
                    listSelectionActive ||
                    !acquisitionRunnable
                  }
                  onClick={openAcquireDialog}
                  type="button"
                >
                  {t(lang, "batch.acquireDialogTitle")}
                </button>
                <button
                  disabled={busy || listSelectionActive || exportable === 0}
                  onClick={() => {
                    resetExportOptions();
                    const scope = freezeCurrentActionScope();
                    setFrozenExportScope(
                      Object.freeze({
                        ...scope,
                        exportableIds: Object.freeze([...exportableIds]),
                      }),
                    );
                    setChoosingExport(true);
                  }}
                  type="button"
                >
                  {t(lang, "batch.export")}
                </button>
              </>
            ) : null}
          </div>

          <BatchItemTable
            busy={busy}
            controlsUnavailableId={controlsUnavailableId}
            hasCurrentList={hasCurrentList}
            items={visibleItems}
            layout={layout}
            onChangeTrack={changeTrack}
            onClearItem={(batchItemId) => onClearItem?.(batchItemId)}
            onExportItem={(item) => {
              resetExportOptions();
              setFrozenExportScope(
                Object.freeze({
                  filter: statusFilter,
                  itemIds: Object.freeze([item.batchItemId]),
                  exportableIds: Object.freeze([item.batchItemId]),
                }),
              );
              setChoosingExport(true);
            }}
            onLayoutChange={persistLayout}
            onRemoveItemRequest={setConfirmingDeleteItemId}
            onSpeechSettingsRequest={setSpeechSettingsItemId}
            onToggleFromRow={toggleFromRow}
            onToggleItem={toggle}
            selectionPending={selectionPending}
            speechLanguageMode={speechLanguageMode}
            taskLocked={taskLocked || listSelectionActive}
            uiLanguage={lang}
          />
        </section>
      ) : null}

      {showingSourceHelp ? (
        <AppDialog
          confirmLabel={t(lang, "common.close")}
          description={t(lang, "batch.sourceHelpTitle", {
            labels: sourceChoices(lang)
              .map((choice) => choice.label)
              .join(" · "),
          })}
          onCancel={() => setShowingSourceHelp(false)}
          onConfirm={() => setShowingSourceHelp(false)}
          role="dialog"
          title={t(lang, "batch.sourceHelpDialogTitle")}
          uiLanguage={lang}
        />
      ) : null}

      {acquireDialog ? (
        <BatchAcquireDialog
          allHaveSubtitles={acquireDialog.allHaveSubtitles}
          busy={busy}
          existingCount={acquireDialog.existingCount}
          method={acquireMethod}
          onCancel={() => setAcquireDialog(null)}
          onConfirm={() => {
            const frozen = acquireDialog;
            setAcquireDialog(null);
            onStart(
              acquireMethod,
              frozen.scope.itemIds,
              acquireOverwrite,
              acquireSpeechScope,
            );
          }}
          onMethodChange={setAcquireMethod}
          onOverwriteChange={setAcquireOverwrite}
          onSpeechScopeChange={(scope) => {
            setAcquireSpeechScope(scope);
            if (scope !== "item") {
              onSpeechLanguageChange?.(scope, acquireDialog.scope.itemIds);
            }
          }}
          overwrite={acquireOverwrite}
          scopeDescription={actionScopeText(acquireDialog.scope)}
          speechScope={acquireSpeechScope}
          uiLanguage={lang}
        />
      ) : null}

      {sourceDialogOpen ? (
        <BatchSourceDialog
          busy={busy}
          errorMessage={errorMessage}
          includeAllPages={includeAllPages}
          input={input}
          lastAppendSummary={appendSummary}
          onCancel={onCancel}
          onClose={() => setSourceDialogOpen(false)}
          onIncludeAllPagesChange={onIncludeAllPagesChange}
          onInputChange={onInputChange}
          onPrepare={() => {
            // Dialog 保持打开以展示解析进度与去重摘要；完成后由用户关闭。
            onPrepare();
          }}
          onShowSourceHelp={() => setShowingSourceHelp(true)}
          onSingleVideoPageSelectionChange={onSingleVideoPageSelectionChange}
          onSourceKindChange={onSourceKindChange}
          onFetchByCurrentPage={onFetchByCurrentPage}
          preparing={sourcePreparing}
          preparationProgress={preparationProgress}
          recognizedSingleVideoPages={recognizedSingleVideoPages}
          selectionPending={selectionPending}
          singleVideoPageSelection={singleVideoPageSelection}
          sourceKind={sourceKind}
          taskLocked={taskLocked}
          uiLanguage={lang}
        />
      ) : null}

      {columnSettingsOpen ? (
        <BatchColumnSettingsDialog
          busy={busy}
          layout={layout}
          onApply={(next) => {
            persistLayout(next);
            setColumnSettingsOpen(false);
          }}
          onCancel={() => setColumnSettingsOpen(false)}
          uiLanguage={lang}
        />
      ) : null}

      {choosingExport && frozenExportScope ? (
        <div
          class="muzhi-batch__overlay"
          onClick={(event) => {
            if (event.currentTarget === event.target && !busy) {
              setChoosingExport(false);
              setFrozenExportScope(null);
            }
          }}
        >
          <div
            aria-labelledby="muzhi-batch-export-title"
            aria-modal="true"
            class="muzhi-batch__dialog"
            role="dialog"
          >
            <h3 id="muzhi-batch-export-title">
              {t(lang, "batch.exportTitle")}
            </h3>
            <p>
              {actionScopeText(frozenExportScope)}{" "}
              {t(lang, "batch.exportBody", {
                selected: frozenExportScope.itemIds.length,
                exportable: frozenExportScope.exportableIds.length,
                skipped:
                  frozenExportScope.itemIds.length -
                  frozenExportScope.exportableIds.length,
              })}
              {frozenExportScope.exportableIds.length > 1
                ? t(lang, "batch.exportZipHint")
                : t(lang, "batch.exportSingleHint")}
            </p>
            {exportOptionFields}
            <div class="muzhi-batch__export-options">
              {(
                [
                  ["TXT", "txt"],
                  ["SRT", "srt"],
                  ["Markdown", "markdown"],
                ] as const
              ).map(([label, format]) => (
                <button
                  disabled={false}
                  key={format}
                  onClick={() => {
                    const liveScopeUnchanged =
                      exportableIds.length ===
                        frozenExportScope.exportableIds.length &&
                      exportableIds.every(
                        (id, index) =>
                          id === frozenExportScope.exportableIds[index],
                      );
                    setChoosingExport(false);
                    setFrozenExportScope(null);
                    publishExport(
                      format,
                      liveScopeUnchanged
                        ? undefined
                        : frozenExportScope.exportableIds,
                    );
                  }}
                  ref={format === "txt" ? dialogConfirmRef : undefined}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div class="muzhi-batch__dialog-actions">
              <button
                onClick={() => {
                  setChoosingExport(false);
                  setFrozenExportScope(null);
                }}
                type="button"
              >
                {t(lang, "batch.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmingDeleteItem ? (
        <AppDialog
          // 不传 busy：任务运行中确认仍可执行（与 job 删除可打断合同一致）。
          cancelLabel={t(lang, "batch.cancel")}
          confirmLabel={t(lang, "batch.confirmDeleteItem")}
          danger
          description={t(lang, "batch.confirmDeleteItemBody", {
            title: confirmingDeleteItem.title,
          })}
          onCancel={() => setConfirmingDeleteItemId(null)}
          onConfirm={() => {
            const frozen = confirmingDeleteItemId;
            setConfirmingDeleteItemId(null);
            if (frozen !== null) onDeleteItems?.([frozen]);
          }}
          title={t(lang, "batch.confirmDeleteItemTitle")}
          uiLanguage={lang}
        />
      ) : null}

      {confirmingTrackSwitch && trackSwitchItem && trackSwitchOption ? (
        <AppDialog
          cancelLabel={t(lang, "batch.cancel")}
          confirmLabel={t(lang, "batch.confirmReplaceTrack")}
          danger
          description={t(lang, "batch.confirmReplaceTrackBody", {
            title: trackSwitchItem.title,
            track: `${trackSwitchOption.name} · ${trackSwitchOption.language}`,
          })}
          onCancel={() => setConfirmingTrackSwitch(null)}
          onConfirm={() => {
            const frozen = confirmingTrackSwitch;
            setConfirmingTrackSwitch(null);
            onRefetchTrack?.(frozen.itemId, frozen.trackId);
          }}
          title={t(lang, "batch.confirmReplaceTrackTitle")}
          uiLanguage={lang}
        />
      ) : null}

      {speechSettingsItem ? (
        <AppDialog
          cancelLabel={t(lang, "common.close")}
          confirmLabel={t(lang, "common.close")}
          onCancel={() => setSpeechSettingsItemId(null)}
          onConfirm={() => setSpeechSettingsItemId(null)}
          role="dialog"
          title={t(lang, "batch.speechSettingsTitle")}
          uiLanguage={lang}
        >
          <div class="muzhi-batch__speech-settings">
            <label class="muzhi-dialog__field">
              <span>{t(lang, "speech.requestLanguage")}</span>
              <select
                aria-label={t(lang, "speech.requestLanguageAria")}
                value={
                  speechSettingsItem.speechLanguageMode ?? speechLanguageMode
                }
                onInput={(event) =>
                  onItemSpeechLanguageChange?.(
                    speechSettingsItem.batchItemId,
                    event.currentTarget.value as SubtitleLanguageMode,
                  )
                }
              >
                <option value="mixed">{t(lang, "status.langMixed")}</option>
                <option value="zh">{t(lang, "status.langZh")}</option>
                <option value="en">{t(lang, "status.langEn")}</option>
                <option value="ja">{t(lang, "status.langJa")}</option>
                <option value="other">{t(lang, "status.langOther")}</option>
              </select>
            </label>
            <label class="muzhi-dialog__field">
              <span>{t(lang, "speech.modelStrategy")}</span>
              <select
                aria-label={t(lang, "speech.modelStrategyAria")}
                value={speechRoutingMode}
                onInput={(event) =>
                  onSpeechRoutingModeChange?.(
                    event.currentTarget.value as GroqRoutingMode,
                  )
                }
              >
                <option value="balanced">
                  {t(lang, "speech.strategyBalanced")}
                </option>
                <option value="turbo-first">
                  {t(lang, "speech.strategyTurbo")}
                </option>
                <option value="standard-first">
                  {t(lang, "speech.strategyStandard")}
                </option>
              </select>
            </label>
            {!speechConfigured ? (
              <p role="status">{t(lang, "speech.needGroqKey")}</p>
            ) : null}
            <p class="muzhi-batch__speech-settings-note">
              {t(lang, "batch.speechSettingsNote")}
            </p>
          </div>
        </AppDialog>
      ) : null}
    </div>
  );
}
