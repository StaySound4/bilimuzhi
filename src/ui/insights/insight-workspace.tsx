import { t } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";
import type {
  OutputLanguagePreference,
  UiLanguage,
} from "../../i18n/languages";
import { useState } from "preact/hooks";

import type { GenerationFailurePresentation } from "../../application/generation-runtime-contract";
import type { ArtifactKind, ArtifactSegment } from "../../domain";
import {
  deriveValidatedMarkdownTimeLinks,
  Markdown,
  type MarkdownSubtitleRow,
  type MarkdownTimeLinkValidationScope,
  type RemoteMarkdownImageRequest,
  type RemoteMarkdownImageResult,
  type ValidatedMarkdownTimeLink,
} from "../markdown";
import { BilimuzhiIcon } from "../icons";
import { AppDialog } from "../dialogs/app-dialog";
import { TaskContextInspector } from "../primitives/task-context-inspector";
import { taskContextSummaryParts } from "../task-model/task-context-summary";
import { WorkspaceEmptyState } from "../primitives/workspace-empty-state";
import {
  TaskModelPicker,
  type TaskModelProfileOption,
  type TaskModelSelection,
  type TaskModelSelectionInput,
} from "../task-model/task-model-picker";
import "../primitives/task-context-inspector.css";
import "../primitives/workspace-empty-state.css";
import "./insight-workspace.css";

export type InsightPhase = "idle" | "running" | "ready" | "failed";

export interface InsightProgress {
  readonly completedChunks: number;
  readonly stage: "planning" | "mapping" | "reducing";
  readonly totalChunks: number;
}

export interface InsightWorkspaceProps {
  readonly uiLanguage?: UiLanguage;
  readonly busy?: boolean;
  readonly availability?: "no-subtitle" | "no-video" | "ready";
  readonly content: string;
  readonly errorMessage?: string;
  readonly failure?: GenerationFailurePresentation;
  readonly hasSubtitle: boolean;
  readonly generationStatus?:
    | "preparing"
    | "requesting"
    | "streaming"
    | "validating"
    | "saving"
    | "interrupted"
    | "failed"
    | "cancelled";
  readonly incomplete?: boolean;
  readonly instruction: string;
  readonly kind: ArtifactKind;
  readonly modelLabel?: string;
  readonly onClear: () => void;
  readonly onExport: () => void;
  readonly onGenerate: () => void;
  readonly onInstructionChange: (value: string) => void;
  readonly onLoadRemoteImage?: (
    request: RemoteMarkdownImageRequest,
  ) => Promise<RemoteMarkdownImageResult>;
  readonly onSeek?: (seconds: number) => void;
  readonly onCopyContent?: () => void;
  readonly onCopyReasoning?: () => void;
  readonly onStop: () => void;
  readonly phase: InsightPhase;
  readonly progress?: InsightProgress;
  readonly segments: readonly ArtifactSegment[];
  readonly subtitleRows?: readonly MarkdownSubtitleRow[];
  readonly timeLinkScope?: MarkdownTimeLinkValidationScope;
  readonly onManageSummaryPresets?: () => void;
  readonly summaryPromptPresetOptions?: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly selectedSummaryPromptPresetId?: string;
  readonly onSelectSummaryPromptPreset?: (
    presetId: string,
  ) => void | Promise<unknown>;
  readonly taskContextError?: string;
  readonly taskContextPending?: boolean;
  readonly taskModelProfiles?: readonly TaskModelProfileOption[];
  readonly taskModelSelection?: TaskModelSelection | null;
  readonly onTaskModelChange?: (next: TaskModelSelectionInput) => void;
  /** 输出语言偏好（per-mode 弱约束默认值）；"auto" 表示不指定。 */
  readonly outputLanguage?: OutputLanguagePreference;
  readonly onOutputLanguageChange?: (
    language: OutputLanguagePreference,
  ) => void;
  readonly reasoning?: string;
  readonly updatedAtLabel?: string;
  readonly validatedTimeLinks?: readonly ValidatedMarkdownTimeLink[];
}

const KIND_KEYS: Record<
  ArtifactKind,
  {
    readonly empty: MessageKey;
    readonly eyebrow: MessageKey;
    readonly generate: MessageKey;
    readonly title: MessageKey;
  }
> = {
  segments: {
    empty: "insights.segmentsEmpty",
    eyebrow: "insights.segmentsEyebrow",
    generate: "insights.segmentsGenerate",
    title: "insights.segmentsTitle",
  },
  summary: {
    empty: "insights.summaryEmpty",
    eyebrow: "insights.summaryEyebrow",
    generate: "insights.summaryGenerate",
    title: "insights.summaryTitle",
  },
};

export function formatClock(totalMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(totalMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function progressText(lang: UiLanguage, progress: InsightProgress): string {
  if (progress.stage === "planning") return t(lang, "insights.planning");
  if (progress.stage === "mapping") {
    return t(lang, "insights.mapping", {
      completed: progress.completedChunks,
      total: progress.totalChunks,
    });
  }
  return progress.totalChunks > 1
    ? t(lang, "insights.reducing")
    : t(lang, "insights.generating");
}

export function InsightWorkspace({
  uiLanguage,
  availability = "ready",
  busy = false,
  content,
  errorMessage,
  failure,
  generationStatus,
  hasSubtitle,
  incomplete = false,
  kind,
  modelLabel,
  onClear,
  onExport,
  onGenerate,
  onLoadRemoteImage,
  onCopyContent,
  onCopyReasoning,
  onManageSummaryPresets,
  onSelectSummaryPromptPreset,
  onSeek,
  taskModelProfiles = [],
  taskModelSelection = null,
  taskContextError,
  taskContextPending = false,
  onTaskModelChange,
  outputLanguage = "zh-Hans",
  onOutputLanguageChange,
  onStop,
  phase,
  progress,
  segments,
  selectedSummaryPromptPresetId,
  subtitleRows = [],
  summaryPromptPresetOptions = [],
  reasoning,
  timeLinkScope,
  updatedAtLabel,
  validatedTimeLinks = [],
}: InsightWorkspaceProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const text = KIND_KEYS[kind];
  const running =
    phase === "running" ||
    generationStatus === "preparing" ||
    generationStatus === "requesting" ||
    generationStatus === "streaming" ||
    generationStatus === "validating" ||
    generationStatus === "saving";
  const hasResult =
    (phase === "ready" || incomplete) &&
    (content.trim().length > 0 || segments.length > 0);
  const statusText =
    generationStatus === "preparing"
      ? t(lang, "insights.preparing")
      : generationStatus === "requesting"
        ? t(lang, "insights.requesting")
        : generationStatus === "streaming"
          ? t(lang, "insights.generating")
          : generationStatus === "validating"
            ? t(lang, "insights.validating")
            : generationStatus === "saving"
              ? t(lang, "insights.saving")
              : progress
                ? progressText(lang, progress)
                : t(lang, "insights.generating");

  if (!hasSubtitle) {
    return (
      <div class="muzhi-insight" data-kind={kind}>
        <p class="muzhi-insight__eyebrow">{t(lang, text.eyebrow)}</p>
        <h2>{t(lang, text.title)}</h2>
        <WorkspaceEmptyState
          description={
            availability === "no-video"
              ? t(lang, "workspaceEmpty.noVideoDescription")
              : t(
                  lang,
                  kind === "segments"
                    ? "workspaceEmpty.segmentsNoSubtitle"
                    : "workspaceEmpty.summaryNoSubtitle",
                )
          }
          title={t(
            lang,
            availability === "no-video"
              ? "workspaceEmpty.noVideoTitle"
              : "workspaceEmpty.noSubtitleTitle",
          )}
          variant={availability === "no-video" ? "no-video" : "no-subtitle"}
        />
      </div>
    );
  }

  if (confirmingRegenerate) {
    return (
      <section
        aria-labelledby="muzhi-insight-regenerate-title"
        class="muzhi-insight muzhi-insight--confirmation"
        data-kind={kind}
        role="alertdialog"
      >
        <p class="muzhi-insight__eyebrow">
          {t(lang, "insights.regenerateEyebrow", {
            title: t(lang, text.title),
          })}
        </p>
        <h2 id="muzhi-insight-regenerate-title">
          {t(lang, "insights.regenerateTitle")}
        </h2>
        <p class="muzhi-insight__warning">
          {t(lang, "insights.regenerateWarning", {
            title: t(lang, text.title),
          })}
        </p>
        <div class="muzhi-insight__actions">
          <button
            class="muzhi-insight__danger-action"
            disabled={busy}
            onClick={() => {
              setConfirmingRegenerate(false);
              onGenerate();
            }}
            type="button"
          >
            {t(lang, "insights.confirmRegenerate")}
          </button>
          <button
            disabled={busy}
            onClick={() => setConfirmingRegenerate(false)}
            type="button"
          >
            {t(lang, "common.cancel")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div
      class="muzhi-insight"
      data-generation-active={running ? "true" : undefined}
      data-kind={kind}
    >
      <div class="muzhi-insight__header">
        <div>
          <p class="muzhi-insight__eyebrow">{t(lang, text.eyebrow)}</p>
          <h2>{t(lang, text.title)}</h2>
        </div>
        <div class="muzhi-insight__actions">
          {running ? (
            <button
              class="muzhi-insight__secondary-action"
              onClick={onStop}
              type="button"
            >
              {t(lang, "insights.stop")}
            </button>
          ) : (
            <button
              class={
                hasResult
                  ? "muzhi-insight__secondary-action"
                  : "muzhi-insight__primary-action"
              }
              disabled={busy}
              onClick={() =>
                hasResult ? setConfirmingRegenerate(true) : onGenerate()
              }
              type="button"
            >
              {hasResult
                ? t(lang, "insights.regenerateWithAction", {
                    action: t(lang, text.generate),
                  })
                : t(lang, text.generate)}
            </button>
          )}
          {hasResult && !running ? (
            <>
              <button
                class="muzhi-insight__secondary-action"
                onClick={onExport}
                type="button"
              >
                {t(lang, "insights.exportMarkdown")}
              </button>
              <button
                class="muzhi-insight__danger-action"
                disabled={busy}
                onClick={() => setConfirmingClear(true)}
                type="button"
              >
                {t(lang, "common.clear")}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {taskModelProfiles.length > 0 && onTaskModelChange ? (
        <TaskContextInspector
          configureLabel={t(lang, "chat.configureModel")}
          status={
            taskContextError ??
            (taskContextPending
              ? t(lang, "taskModel.saving")
              : taskModelSelection?.state === "needs-reselection"
                ? t(lang, "chat.needsReselection")
                : running
                  ? statusText
                  : busy
                    ? t(lang, "taskModel.workspaceBusy")
                    : phase === "failed"
                      ? (errorMessage ??
                        t(lang, "insights.generateFailed", {
                          title: t(lang, text.title),
                        }))
                      : undefined)
          }
          summary={[
            ...taskContextSummaryParts(
              lang,
              taskModelProfiles,
              taskModelSelection,
              outputLanguage,
            ),
            ...(kind === "summary"
              ? [
                  summaryPromptPresetOptions.find(
                    ({ id }) => id === selectedSummaryPromptPresetId,
                  )?.name ?? t(lang, "taskModel.notConfigured"),
                ]
              : []),
          ].join(" · ")}
        >
          <div class="muzhi-insight__task-model">
            <TaskModelPicker
              uiLanguage={uiLanguage}
              busy={busy || running}
              label={
                kind === "summary"
                  ? t(lang, "insights.summaryModel")
                  : t(lang, "insights.segmentsModel")
              }
              onChange={onTaskModelChange}
              outputLanguage={outputLanguage}
              onOutputLanguageChange={onOutputLanguageChange}
              profiles={taskModelProfiles}
              selection={taskModelSelection}
            />
          </div>
          {kind === "summary" ? (
            <div class="muzhi-insight__summary-preferences">
              {summaryPromptPresetOptions.length > 0 ? (
                <label class="muzhi-insight__summary-detail">
                  <span>{t(lang, "insights.summaryPreset")}</span>
                  <select
                    aria-label={t(lang, "insights.summaryPreset")}
                    disabled={busy || running}
                    onInput={(event) =>
                      onSelectSummaryPromptPreset?.(event.currentTarget.value)
                    }
                    value={selectedSummaryPromptPresetId ?? ""}
                  >
                    {summaryPromptPresetOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {onManageSummaryPresets ? (
                <button
                  class="muzhi-insight__secondary-action"
                  disabled={busy || running}
                  onClick={onManageSummaryPresets}
                  type="button"
                >
                  {t(lang, "insights.manageSummaryPresets")}
                </button>
              ) : null}
            </div>
          ) : null}
        </TaskContextInspector>
      ) : null}

      {running ? (
        <p class="muzhi-insight__progress" role="status">
          <span aria-hidden="true" class="muzhi-insight__spinner" />
          {statusText}
        </p>
      ) : null}

      {incomplete && failure === undefined ? (
        <p class="muzhi-insight__incomplete" role="status">
          {t(lang, "insights.incomplete")}
        </p>
      ) : null}

      {phase === "failed" && failure === undefined ? (
        <p class="muzhi-insight__error" role="alert">
          {errorMessage ??
            t(lang, "insights.generateFailed", { title: t(lang, text.title) })}
        </p>
      ) : null}

      {hasResult || running || failure !== undefined ? (
        <div
          class="muzhi-insight__result"
          data-streaming={running ? "true" : "false"}
        >
          {failure ? (
            <div
              class="muzhi-insight__failure"
              data-generation-failure-code={failure.code}
            >
              <p>
                {failure.code}：{t(lang, failure.action as MessageKey)}。
              </p>
              {incomplete || failure.incomplete ? (
                <p>{t(lang, "insights.incomplete")}</p>
              ) : null}
              {failure.retryable ? (
                <button
                  class="muzhi-insight__retry-action"
                  disabled={busy}
                  onClick={onGenerate}
                  type="button"
                >
                  {t(lang, "insights.retryGenerate")}
                </button>
              ) : (
                <p>{t(lang, "insights.notRetryable")}</p>
              )}
            </div>
          ) : null}
          {updatedAtLabel && !running ? (
            <p class="muzhi-insight__meta">
              {t(lang, "insights.updatedAt", { label: updatedAtLabel })}
              {modelLabel ? ` · ${modelLabel}` : ""}
            </p>
          ) : null}
          {reasoning?.trim() ? (
            <details
              aria-label={t(lang, "insights.reasoning")}
              class="muzhi-insight__reasoning"
              open={running ? true : undefined}
              role="group"
            >
              <summary>{t(lang, "insights.reasoning")}</summary>
              <div class="muzhi-insight__reasoning-body">
                <Markdown
                  className="muzhi-markdown"
                  uiLanguage={uiLanguage}
                  onLoadRemoteImage={onLoadRemoteImage}
                  onSeek={onSeek}
                  text={reasoning.trim()}
                />
                {onCopyReasoning ? (
                  <button
                    aria-label={t(lang, "insights.copyReasoning")}
                    class="muzhi-insight__reasoning-copy"
                    onClick={onCopyReasoning}
                    title={t(lang, "insights.copyReasoning")}
                    type="button"
                  >
                    <BilimuzhiIcon
                      name="copy"
                      title={t(lang, "insights.copyReasoning")}
                    />
                  </button>
                ) : null}
              </div>
            </details>
          ) : null}
          {kind === "summary" && content.trim() && onCopyContent ? (
            <div class="muzhi-insight__content-actions">
              <span>{t(lang, "insights.summaryBody")}</span>
              <button
                aria-label={t(lang, "insights.copySummary")}
                class="muzhi-insight__icon-action"
                onClick={onCopyContent}
                title={t(lang, "insights.copySummary")}
                type="button"
              >
                <BilimuzhiIcon
                  name="copy"
                  title={t(lang, "insights.copySummary")}
                />
              </button>
            </div>
          ) : null}
          {kind === "segments" && segments.length > 0 && !running ? (
            <ol class="muzhi-insight__segments">
              {segments.map((segment, index) => {
                const segmentId = `${segment.startLineId ?? index}-${segment.endLineId ?? index}-${segment.startMs}-${segment.endMs}`;
                const advertisement =
                  segment.isAdvertisement || segment.type === "advertisement";
                const typeLabel = advertisement
                  ? t(lang, "insights.advertisement")
                  : t(lang, "insights.content");
                return (
                  <li
                    aria-label={t(lang, "insights.segmentAria", {
                      title: segment.title,
                      type: typeLabel,
                    })}
                    class={`muzhi-insight__segment${
                      advertisement ? " muzhi-insight__segment--ad" : ""
                    }`}
                    key={segmentId}
                    onClick={() => onSeek?.(segment.startMs / 1_000)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      event.preventDefault();
                      onSeek?.(segment.startMs / 1_000);
                    }}
                    role={onSeek === undefined ? undefined : "button"}
                    tabIndex={onSeek === undefined ? undefined : 0}
                  >
                    <span class="muzhi-insight__segment-time">
                      {formatClock(segment.startMs)}
                    </span>
                    <h3 class="muzhi-insight__segment-title">
                      {advertisement ? (
                        <span class="muzhi-insight__segment-badge">
                          {t(lang, "insights.advertisement")}
                        </span>
                      ) : null}
                      {segment.title}
                    </h3>
                    <p class="muzhi-insight__segment-detail">
                      {segment.detail}
                    </p>
                  </li>
                );
              })}
            </ol>
          ) : (
            <Markdown
              className="muzhi-markdown"
              uiLanguage={uiLanguage}
              onLoadRemoteImage={onLoadRemoteImage}
              onSeek={onSeek}
              streaming={running}
              timeLinkGroupPolicy={kind === "summary" ? "one-per-block" : "all"}
              text={content}
              validatedTimeLinks={
                validatedTimeLinks.length > 0
                  ? validatedTimeLinks
                  : deriveValidatedMarkdownTimeLinks(
                      content,
                      subtitleRows,
                      timeLinkScope,
                    )
              }
            />
          )}
        </div>
      ) : phase === "idle" ? (
        <WorkspaceEmptyState
          description={t(
            lang,
            kind === "segments"
              ? "workspaceEmpty.segmentsNoContent"
              : "workspaceEmpty.summaryNoContent",
          )}
          meta={modelLabel}
          title={t(
            lang,
            kind === "segments"
              ? "workspaceEmpty.segmentsNoContentTitle"
              : "workspaceEmpty.summaryNoContentTitle",
          )}
          variant="no-content"
        />
      ) : null}
      {confirmingClear ? (
        <AppDialog
          uiLanguage={uiLanguage}
          cancelLabel={t(lang, "common.cancel")}
          confirmLabel={t(lang, "common.clear")}
          danger
          description={t(lang, text.empty)}
          onCancel={() => setConfirmingClear(false)}
          onConfirm={() => {
            setConfirmingClear(false);
            onClear();
          }}
          title={t(lang, "common.clear")}
        />
      ) : null}
    </div>
  );
}
