/**
 * BatchAcquireDialog — 批量获取字幕 Dialog seam 子组件
 * （Ticket 01 review 整改：补全 acquisition dialog 的 props 契约）。
 *
 * 只负责对冻结的 BatchItem 作用域获取字幕（官方/AI 或语音转录），
 * 与「解析并加入列表」Dialog（Ticket 03）严格分离。冻结的 itemIds
 * 由父组件在打开时捕获，本组件不读取当前 DOM 或选择状态。
 * 焦点圈定 / Escape / 遮罩关闭由 AppDialog 承载，行为与拆分前一致。
 *
 * Ticket 09：语音转录方法下提供语言设置（zh/en/other/mixed，默认由
 * 工作区传入）与「语言设置只是促进识别」说明；选择即作用域批量写入。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import type {
  BatchAcquisitionMethod,
  SubtitleLanguageMode,
} from "../../domain";
import { AppDialog } from "../dialogs/app-dialog";

export type BatchOverwriteChoice = "skip" | "all";

/**
 * 批量获取字幕对话框的语音转录语言作用域：
 * - "item"：每个条目按操作列设置的语言转写（未设置回退混合）；
 * - 具体语言：全部选中条目统一按该语言转写。
 */
export type BatchSpeechScope = SubtitleLanguageMode | "item";

export interface BatchAcquireDialogProps {
  readonly uiLanguage?: UiLanguage;
  readonly busy?: boolean;
  /** 冻结作用域的作用范围文案（父组件已格式化）。 */
  readonly scopeDescription: string;
  readonly existingCount: number;
  readonly allHaveSubtitles: boolean;
  readonly method: BatchAcquisitionMethod;
  /** 语音转录语言作用域（默认 mixed；"item" = 按对应视频项设置）。 */
  readonly speechScope: BatchSpeechScope;
  readonly onSpeechScopeChange: (scope: BatchSpeechScope) => void;
  readonly overwrite: BatchOverwriteChoice;
  readonly onMethodChange: (method: BatchAcquisitionMethod) => void;
  readonly onOverwriteChange: (overwrite: BatchOverwriteChoice) => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function BatchAcquireDialog({
  allHaveSubtitles,
  busy = false,
  existingCount,
  method,
  onCancel,
  onConfirm,
  onMethodChange,
  onOverwriteChange,
  onSpeechScopeChange,
  overwrite,
  scopeDescription,
  speechScope,
  uiLanguage,
}: BatchAcquireDialogProps) {
  const lang = uiLanguage ?? "zh-Hans";
  return (
    <AppDialog
      busy={busy}
      cancelLabel={t(lang, "batch.cancel")}
      confirmLabel={t(lang, "batch.confirmOverwriteStart")}
      description={`${scopeDescription} ${t(
        lang,
        "batch.acquireExistingCount",
        {
          count: existingCount,
        },
      )}`}
      onCancel={onCancel}
      onConfirm={() => onConfirm()}
      role="dialog"
      title={t(lang, "batch.acquireDialogTitle")}
      uiLanguage={lang}
    >
      <fieldset class="muzhi-batch__acquire-fieldset">
        <legend>{t(lang, "batch.acquireMethodAria")}</legend>
        <div class="muzhi-batch__acquire-options">
          {(
            [
              ["direct", "batch.fetchOfficialAi"],
              ["speech", "batch.acquireMethodSpeech"],
            ] as const
          ).map(([value, labelKey]) => (
            <label class="muzhi-batch__acquire-option" key={value}>
              <input
                aria-label={t(lang, labelKey)}
                checked={method === value}
                disabled={busy}
                name="muzhi-batch-acquire-method"
                onChange={() => onMethodChange(value)}
                type="radio"
                value={value}
              />
              <span class="muzhi-batch__acquire-option-body">
                <strong>{t(lang, labelKey)}</strong>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {method === "speech" ? (
        <fieldset class="muzhi-batch__acquire-fieldset">
          <legend>{t(lang, "batch.acquireLanguageAria")}</legend>
          <div class="muzhi-batch__acquire-options">
            {(
              [
                ["item", "batch.acquireUseItemLanguage"],
                ["mixed", "status.langMixed"],
                ["zh", "status.langZh"],
                ["en", "status.langEn"],
                ["ja", "status.langJa"],
                ["other", "status.langOther"],
              ] as const
            ).map(([scope, labelKey]) => (
              <label class="muzhi-batch__acquire-option" key={scope}>
                <input
                  aria-label={t(lang, labelKey)}
                  checked={speechScope === scope}
                  disabled={busy}
                  name="muzhi-batch-acquire-language"
                  onChange={() => onSpeechScopeChange(scope)}
                  type="radio"
                  value={scope}
                />
                <span class="muzhi-batch__acquire-option-body">
                  <strong>{t(lang, labelKey)}</strong>
                  {scope === "item" ? (
                    <small>{t(lang, "batch.acquireUseItemLanguageHint")}</small>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          <small class="muzhi-batch__acquire-hint">
            {t(lang, "batch.acquireLanguageHint")}
          </small>
        </fieldset>
      ) : null}
      <fieldset class="muzhi-batch__acquire-fieldset">
        <legend>{t(lang, "batch.acquireOverwriteAria")}</legend>
        <div class="muzhi-batch__acquire-options">
          {(
            [
              ["skip", "batch.acquireSkipExisting"],
              ["all", "batch.acquireReplaceExisting"],
            ] as const
          ).map(([value, labelKey]) => (
            <label class="muzhi-batch__acquire-option" key={value}>
              <input
                aria-label={t(lang, labelKey)}
                checked={overwrite === value}
                disabled={busy || (value === "skip" && allHaveSubtitles)}
                name="muzhi-batch-acquire-overwrite"
                onChange={() => onOverwriteChange(value)}
                type="radio"
                value={value}
              />
              <span class="muzhi-batch__acquire-option-body">
                <strong>{t(lang, labelKey)}</strong>
                {value === "skip" && allHaveSubtitles ? (
                  <small>{t(lang, "batch.acquireAllHaveSubtitles")}</small>
                ) : null}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </AppDialog>
  );
}
