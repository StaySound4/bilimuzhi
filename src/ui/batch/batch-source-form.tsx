/**
 * BatchSourceForm — 批量来源输入 seam 子组件（Ticket 01 从 BatchWorkspace 抽离）。
 *
 * 这是 Ticket 03「解析并加入列表」Dialog 的来源契约：普通视频/多 P/
 * 合集/多链接/当前页的输入与校验语义在这里冻结；对话框化后只改变
 * 载体（Dialog），不改变本契约。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { useState } from "preact/hooks";
import type { Ref } from "preact";
import type { JSX } from "preact";
import {
  parseBatchSourceForKind,
  type BatchSourceKind,
} from "../../application/batch-source-contract";

export type BatchSourceChoice = BatchSourceKind | "auto";
export type SingleVideoPageSelection = "all" | "current";

export interface RecognizedSingleVideoPages {
  readonly currentPage: number;
  readonly totalPages: number;
}

export interface BatchSourceFormProps {
  readonly uiLanguage?: UiLanguage;
  /** 表单元素引用（Dialog 底部主按钮通过 requestSubmit 触发校验提交）。 */
  readonly formRef?: Ref<HTMLFormElement>;
  readonly input: string;
  readonly sourceKind?: BatchSourceChoice;
  readonly includeAllPages?: boolean;
  readonly recognizedSingleVideoPages?: RecognizedSingleVideoPages | null;
  readonly singleVideoPageSelection?: SingleVideoPageSelection;
  readonly busy?: boolean;
  readonly taskLocked?: boolean;
  readonly selectionPending?: boolean;
  readonly hasCurrentList: boolean;
  /** 运行/准备中控件不可用原因锚点（id 复用）。 */
  readonly controlsUnavailableId?: string;
  readonly onInputChange: (value: string) => void;
  readonly onPrepare: () => void;
  readonly onSourceKindChange?: (value: BatchSourceChoice) => void;
  readonly onIncludeAllPagesChange: (value: boolean) => void;
  readonly onSingleVideoPageSelectionChange?: (
    selection: SingleVideoPageSelection,
  ) => void;
  readonly onShowSourceHelp: () => void;
}

export function contextualSourceLabel(label: string, context: string): string {
  return label.includes(context) ? label : `${label}（${context}）`;
}

export function sourceChoices(lang: UiLanguage): readonly {
  readonly label: string;
  readonly value: BatchSourceChoice;
}[] {
  const labels: Record<Exclude<BatchSourceChoice, "auto">, string> = {
    "single-video": t(lang, "batch.sourceSingleVideo"),
    "user-space": t(lang, "batch.sourceUserSpace"),
    favorites: t(lang, "batch.sourceFavorites"),
    collection: t(lang, "batch.sourceCollection"),
    "video-pages": t(lang, "batch.sourceVideoPages"),
    search: t(lang, "batch.sourceSearch"),
  };
  return Object.freeze([
    { label: labels["single-video"], value: "single-video" },
    { label: labels["user-space"], value: "user-space" },
    { label: labels.favorites, value: "favorites" },
    {
      label: contextualSourceLabel(
        labels.collection,
        t(lang, "batch.sourceMultiple"),
      ),
      value: "collection",
    },
    {
      label: contextualSourceLabel(
        labels["video-pages"],
        t(lang, "batch.sourceSameVideo"),
      ),
      value: "video-pages",
    },
    { label: labels.search, value: "search" },
  ]);
}

export function BatchSourceForm({
  busy = false,
  formRef,
  controlsUnavailableId,
  hasCurrentList,
  includeAllPages,
  input,
  onIncludeAllPagesChange,
  onInputChange,
  onPrepare,
  onShowSourceHelp,
  onSingleVideoPageSelectionChange,
  onSourceKindChange,
  recognizedSingleVideoPages,
  selectionPending = false,
  singleVideoPageSelection,
  sourceKind,
  taskLocked = false,
  uiLanguage,
}: BatchSourceFormProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [localSourceKind, setLocalSourceKind] =
    useState<BatchSourceChoice>("single-video");
  const [sourceValidationMessage, setSourceValidationMessage] = useState<
    string | null
  >(null);

  const selectedSourceKind = sourceKind ?? localSourceKind;
  const recognizedMultiPageVideo =
    recognizedSingleVideoPages === null ||
    recognizedSingleVideoPages === undefined ||
    !Number.isSafeInteger(recognizedSingleVideoPages.currentPage) ||
    !Number.isSafeInteger(recognizedSingleVideoPages.totalPages) ||
    recognizedSingleVideoPages.currentPage < 1 ||
    recognizedSingleVideoPages.currentPage >
      recognizedSingleVideoPages.totalPages ||
    recognizedSingleVideoPages.totalPages <= 1
      ? null
      : recognizedSingleVideoPages;
  const selectedSingleVideoPages =
    singleVideoPageSelection ?? (includeAllPages ? "all" : "current");
  const controlsUnavailable =
    !hasCurrentList || busy || taskLocked || selectionPending;

  const submit = (event: JSX.TargetedSubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setSourceValidationMessage(null);
    if (selectedSourceKind !== "auto") {
      try {
        // 按所选来源类型显式解析（单一视频接受带分 P 的地址），不做自动类型猜测。
        parseBatchSourceForKind(input, selectedSourceKind);
      } catch {
        setSourceValidationMessage(t(lang, "batch.sourceMismatchGeneric"));
        return;
      }
    }
    onPrepare();
  };

  const changeSourceKind = (next: BatchSourceChoice): void => {
    setLocalSourceKind(next);
    setSourceValidationMessage(null);
    onSourceKindChange?.(next);
    if (next === "video-pages" && !includeAllPages) {
      onIncludeAllPagesChange(true);
    } else if (next === "single-video" && includeAllPages) {
      onIncludeAllPagesChange(false);
    }
  };

  const changeSingleVideoPageSelection = (
    next: SingleVideoPageSelection,
  ): void => {
    onSingleVideoPageSelectionChange?.(next);
    onIncludeAllPagesChange(next === "all");
  };

  return (
    <form class="muzhi-batch__form" onSubmit={submit} ref={formRef}>
      <div class="muzhi-batch__source-row">
        <label class="muzhi-batch__field muzhi-batch__field--source-kind">
          <select
            aria-label={t(lang, "batch.sourceKindAria")}
            aria-describedby={controlsUnavailableId}
            disabled={controlsUnavailable}
            onInput={(event) =>
              changeSourceKind(
                (event.currentTarget as HTMLSelectElement)
                  .value as BatchSourceChoice,
              )
            }
            value={selectedSourceKind}
          >
            {sourceChoices(lang).map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label class="muzhi-batch__field muzhi-batch__field--source-input">
          <input
            aria-label={t(lang, "batch.sourceInputAria")}
            aria-describedby={controlsUnavailableId}
            disabled={controlsUnavailable}
            onInput={(event) => {
              setSourceValidationMessage(null);
              onInputChange(event.currentTarget.value);
            }}
            placeholder={t(lang, "batch.sourcePlaceholder")}
            value={input}
          />
        </label>
        <button
          aria-label={t(lang, "batch.sourceHelpAria")}
          class="muzhi-batch__source-help"
          onClick={onShowSourceHelp}
          title={t(lang, "batch.sourceHelpTitle", {
            labels: sourceChoices(lang)
              .map((choice) => choice.label)
              .join(" · "),
          })}
          type="button"
        >
          ?
        </button>
      </div>
      {sourceValidationMessage ? (
        <p class="muzhi-batch__inline-error" role="alert">
          {sourceValidationMessage}
        </p>
      ) : null}
      <p class="muzhi-batch__inline-hint">{t(lang, "batch.stabilityHint")}</p>
      <div class="muzhi-batch__form-row">
        {recognizedMultiPageVideo ? (
          <fieldset class="muzhi-batch__page-selection">
            <legend>
              {t(lang, "batch.pageRecognition", {
                total: recognizedMultiPageVideo.totalPages,
                current: recognizedMultiPageVideo.currentPage,
              })}
            </legend>
            <label>
              <input
                checked={selectedSingleVideoPages === "current"}
                aria-describedby={controlsUnavailableId}
                disabled={controlsUnavailable}
                name="single-video-page-selection"
                onChange={() => changeSingleVideoPageSelection("current")}
                type="radio"
                value="current"
              />
              {t(lang, "batch.onlyCurrentPage")}
            </label>
            <label>
              <input
                checked={selectedSingleVideoPages === "all"}
                aria-describedby={controlsUnavailableId}
                disabled={controlsUnavailable}
                name="single-video-page-selection"
                onChange={() => changeSingleVideoPageSelection("all")}
                type="radio"
                value="all"
              />
              {t(lang, "batch.includeAllParts")}
            </label>
          </fieldset>
        ) : null}
      </div>
    </form>
  );
}
