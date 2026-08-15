/**
 * BatchSourceDialog — 解析并加入列表 Dialog（Ticket 03，Dialog A）。
 *
 * 只负责来源追加：普通视频、指定分P、全部分P、合集、多种链接型来源
 * （视频/合集/收藏夹/主页，由 parseBatchSource 统一解析，一次解析一个
 * 来源）与当前页面。不放字幕获取方式或语音语言设置。
 *
 * - 解析进度与「取消解析」只影响当前 append operation（父级 onCancel
 *   走既有 suppressed/generation 协议，不破坏列表刷新恢复）；
 * - 精确 VideoKey 去重摘要（新增/重复）来自父级 view 投影；
 * - 关闭 Dialog 不改变列表；Escape / 遮罩 / 焦点圈定与 AppDialog 一致。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { useEffect, useRef } from "preact/hooks";

import {
  BatchSourceForm,
  type BatchSourceChoice,
  type RecognizedSingleVideoPages,
  type SingleVideoPageSelection,
} from "./batch-source-form";

export interface BatchSourceDialogProps {
  readonly uiLanguage?: UiLanguage;
  readonly input: string;
  readonly sourceKind?: BatchSourceChoice;
  readonly includeAllPages: boolean;
  readonly recognizedSingleVideoPages?: RecognizedSingleVideoPages | null;
  readonly singleVideoPageSelection?: SingleVideoPageSelection;
  readonly busy?: boolean;
  readonly taskLocked?: boolean;
  readonly selectionPending?: boolean;
  /** 当前 append operation 正在解析。 */
  readonly preparing: boolean;
  readonly preparationProgress?: {
    readonly completed: number;
    readonly total: number;
  } | null;
  readonly errorMessage?: string | null;
  /** 最近一次 append 的去重摘要（新增/重复）。 */
  readonly lastAppendSummary?: {
    readonly added: number;
    readonly duplicate: number;
  } | null;
  readonly onCancel: () => void;
  readonly onClose: () => void;
  readonly onInputChange: (value: string) => void;
  readonly onPrepare: () => void;
  readonly onSourceKindChange?: (value: BatchSourceChoice) => void;
  readonly onIncludeAllPagesChange: (value: boolean) => void;
  readonly onSingleVideoPageSelectionChange?: (
    selection: SingleVideoPageSelection,
  ) => void;
  readonly onFetchByCurrentPage?: () => void;
  readonly onShowSourceHelp: () => void;
}

export function BatchSourceDialog({
  busy = false,
  errorMessage,
  includeAllPages,
  input,
  lastAppendSummary,
  onCancel,
  onClose,
  onIncludeAllPagesChange,
  onInputChange,
  onPrepare,
  onShowSourceHelp,
  onSingleVideoPageSelectionChange,
  onSourceKindChange,
  onFetchByCurrentPage,
  preparing,
  preparationProgress,
  recognizedSingleVideoPages,
  selectionPending = false,
  singleVideoPageSelection,
  sourceKind,
  taskLocked = false,
  uiLanguage,
}: BatchSourceDialogProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const hasInput = input.trim().length > 0;
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusTarget =
      dialogRef.current?.querySelector<HTMLElement>(
        "input:not([disabled]), select:not([disabled]), button:not([disabled])",
      ) ?? null;
    focusTarget?.focus();
    return () => previousFocus.current?.focus();
  }, []);

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      if (busy || preparing) return;
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled])",
      ),
    ];
    if (focusable.length === 0) return;
    const current = document.activeElement as HTMLElement | null;
    if (event.shiftKey && current === focusable[0]) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && current === focusable[focusable.length - 1]) {
      event.preventDefault();
      focusable[0].focus();
    }
  };

  return (
    <div
      class="muzhi-batch__overlay"
      onClick={(event) => {
        if (event.currentTarget === event.target && !busy && !preparing) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby="muzhi-batch-parse-title"
        aria-modal="true"
        class="muzhi-batch__dialog muzhi-batch__parse-dialog"
        onKeyDown={onKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <h3 id="muzhi-batch-parse-title">
          {t(lang, "batch.parseDialogTitle")}
        </h3>
        <p class="muzhi-batch__inline-hint">
          {t(lang, "batch.parseDialogHint")}
        </p>
        <p class="muzhi-batch__inline-hint muzhi-batch__multilink-hint">
          {t(lang, "batch.sourceMultiLinkHint")}
        </p>
        <BatchSourceForm
          busy={busy || preparing}
          formRef={formRef}
          controlsUnavailableId={undefined}
          hasCurrentList
          includeAllPages={includeAllPages}
          input={input}
          onIncludeAllPagesChange={onIncludeAllPagesChange}
          onInputChange={onInputChange}
          onPrepare={onPrepare}
          onShowSourceHelp={onShowSourceHelp}
          onSingleVideoPageSelectionChange={onSingleVideoPageSelectionChange}
          onSourceKindChange={onSourceKindChange}
          recognizedSingleVideoPages={recognizedSingleVideoPages}
          selectionPending={selectionPending}
          singleVideoPageSelection={singleVideoPageSelection}
          sourceKind={sourceKind}
          taskLocked={taskLocked}
          uiLanguage={lang}
        />
        {errorMessage ? (
          <p class="muzhi-batch__inline-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {preparing ? (
          <div class="muzhi-batch__parse-progress">
            <progress
              aria-label={t(lang, "batch.prepareProgressAria")}
              class="muzhi-batch__prepare-progress"
              {...(preparationProgress
                ? {
                    max: preparationProgress.total,
                    value: preparationProgress.completed,
                  }
                : {})}
            />
            <button
              onClick={() => {
                onCancel();
                onClose();
              }}
              type="button"
            >
              {t(lang, "batch.cancelResolve")}
            </button>
          </div>
        ) : lastAppendSummary !== null && lastAppendSummary !== undefined ? (
          <p class="muzhi-batch__append-summary" role="status">
            {t(lang, "batch.appendSummary", {
              added: lastAppendSummary.added,
              duplicate: lastAppendSummary.duplicate,
            })}
          </p>
        ) : null}
        <div class="muzhi-batch__dialog-actions">
          <button
            class="muzhi-batch__dialog-action"
            disabled={
              busy || preparing || !hasInput || taskLocked || selectionPending
            }
            onClick={() => formRef.current?.requestSubmit()}
            type="button"
          >
            {t(lang, "batch.fetchByInput")}
          </button>
          <button
            class="muzhi-batch__dialog-action"
            disabled={busy || preparing || taskLocked || selectionPending}
            onClick={() => {
              onFetchByCurrentPage?.();
              onClose();
            }}
            type="button"
          >
            {t(lang, "batch.fetchByCurrentPage")}
          </button>
          <button
            class="muzhi-batch__dialog-action"
            disabled={busy || preparing}
            onClick={onClose}
            type="button"
          >
            {t(lang, "batch.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
