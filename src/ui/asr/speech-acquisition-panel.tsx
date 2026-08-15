import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import type { SubtitleLanguageMode } from "../../application/subtitle-acquisition-contract";
import type {
  AsrProgressActivity,
  GroqRoutingMode,
} from "../../application/asr-contract";
import { useState } from "preact/hooks";

export type SpeechPanelPhase =
  "idle" | "preparing" | "transcribing" | "merging" | "error" | "success";

export interface SpeechAcquisitionPanelProps {
  readonly uiLanguage?: UiLanguage;
  /**
   * Fine-grained progress of the current preparation step. Media download and
   * FFmpeg chunking dominate the wall clock, so leaving them as one opaque
   * "preparing" state made the task look stuck.
   */
  readonly activity?: AsrProgressActivity;
  readonly completedChunks: number;
  readonly errorMessage?: string;
  readonly hasConfiguredKey: boolean;
  readonly hasExistingSubtitle: boolean;
  readonly languageMode: SubtitleLanguageMode;
  readonly onCancel: () => void;
  readonly onLanguageModeChange: (value: SubtitleLanguageMode) => void;
  readonly onRoutingModeChange: (value: GroqRoutingMode) => void;
  readonly onStart: () => void;
  readonly phase: SpeechPanelPhase;
  readonly routingMode: GroqRoutingMode;
  readonly reacquiring?: boolean;
  readonly rowCount?: number;
  readonly totalChunks: number;
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function boundedPercent(completed: number, total: number): number {
  if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0) {
    return 0;
  }
  return Math.round(Math.min(1, Math.max(0, completed / total)) * 100);
}

function activityMessage(
  activity: AsrProgressActivity,
  lang: UiLanguage,
): string {
  if ("currentChunk" in activity) {
    const chunk = t(lang, "speech.chunkLabel", {
      current: activity.currentChunk,
      total: Math.max(1, activity.totalChunks),
    });
    switch (activity.phase) {
      case "uploading":
        return t(lang, "speech.uploading", { chunk });
      case "waiting-response":
        return t(lang, "speech.waitingResponse", { chunk });
      case "switching-model":
        return t(lang, "speech.switchingModel", { chunk });
      case "rate-limited":
        return activity.retryAfterSeconds === undefined ||
          activity.retryAfterSeconds <= 0
          ? t(lang, "speech.rateLimitedRetry", { chunk })
          : t(lang, "speech.rateLimitedWait", {
              chunk,
              seconds: activity.retryAfterSeconds,
            });
    }
  }
  if ("completedBytes" in activity) {
    const completed = formatMegabytes(activity.completedBytes);
    const total =
      activity.totalBytes === null
        ? null
        : formatMegabytes(activity.totalBytes);
    switch (activity.phase) {
      case "entitlement":
        return t(lang, "speech.entitlement");
      case "metadata":
        return t(lang, "speech.metadata");
      case "downloading":
        return total === null
          ? t(lang, "speech.downloadingPartial", { completed })
          : t(lang, "speech.downloadingProgress", {
              completed,
              percent: boundedPercent(
                activity.completedBytes,
                activity.totalBytes ?? 0,
              ),
              total,
            });
      case "hashing":
        return t(lang, "speech.hashing");
      case "encoding":
        return activity.totalBytes === null
          ? t(lang, "speech.encodingPartial", { completed })
          : t(lang, "speech.encodingProgress", {
              completed,
              percent: boundedPercent(
                activity.completedBytes,
                activity.totalBytes ?? 0,
              ),
              total: total ?? "",
            });
    }
  }
  switch (activity.phase) {
    case "loading":
      return t(lang, "speech.loading");
    case "encoding": {
      // Current runs project this legacy processor activity to byte progress
      // before rendering. Retain a readable fallback only for older persisted
      // checkpoints that predate the byte projection.
      const totalUnits = Math.max(1, activity.totalUnits);
      const legacyUnitProgress = `${activity.completedUnits}/${totalUnits}`;
      return t(lang, "speech.splitting", { progress: legacyUnitProgress });
    }
    case "reading":
      return t(lang, "speech.reading", { count: activity.totalUnits });
  }
  return "";
}

function phaseMessage(
  props: SpeechAcquisitionPanelProps,
  lang: UiLanguage,
): string {
  if (props.phase === "preparing") {
    return props.activity === undefined
      ? t(lang, "speech.preparingAudio")
      : activityMessage(props.activity, lang);
  }
  if (
    props.phase === "transcribing" &&
    props.activity !== undefined &&
    "currentChunk" in props.activity
  ) {
    return activityMessage(props.activity, lang);
  }
  if (props.phase === "merging") return t(lang, "speech.merging");
  return t(lang, "speech.transcribing", {
    completed: props.completedChunks,
    total: Math.max(1, props.totalChunks),
  });
}

/** Determinate progress whenever the current step reports real units. */
function progressBounds(props: SpeechAcquisitionPanelProps): {
  readonly max: number;
  readonly value: number | undefined;
} {
  if (props.phase === "preparing") {
    const activity = props.activity;
    if (activity === undefined) return { max: 1, value: undefined };
    if ("currentChunk" in activity) {
      return {
        max: Math.max(1, activity.totalChunks),
        value: Math.max(0, activity.currentChunk - 1),
      };
    }
    if ("completedBytes" in activity) {
      return activity.totalBytes === null || activity.totalBytes <= 0
        ? { max: 1, value: undefined }
        : { max: activity.totalBytes, value: activity.completedBytes };
    }
    return activity.totalUnits <= 0
      ? { max: 1, value: undefined }
      : { max: activity.totalUnits, value: activity.completedUnits };
  }
  if (props.phase === "merging") return { max: 1, value: 1 };
  const max = Math.max(1, props.totalChunks);
  return { max, value: Math.min(props.completedChunks, max) };
}

export function SpeechAcquisitionPanel(props: SpeechAcquisitionPanelProps) {
  const lang = props.uiLanguage ?? "zh-Hans";
  const [confirmingReplacement, setConfirmingReplacement] = useState(false);
  const busy =
    props.phase === "preparing" ||
    props.phase === "transcribing" ||
    props.phase === "merging";
  const requestStart = () => {
    if (props.hasExistingSubtitle && !props.reacquiring) {
      setConfirmingReplacement(true);
      return;
    }
    props.onStart();
  };

  if (busy) {
    const bounds = progressBounds(props);
    const stepLabel =
      props.phase === "preparing"
        ? t(lang, "speech.stepPreparing")
        : props.phase === "transcribing"
          ? t(lang, "speech.stepTranscribing")
          : t(lang, "speech.stepMerging");
    return (
      <section
        aria-labelledby="speech-acquisition-title"
        class="speech-acquisition"
      >
        <p class="subtitle-acquisition__eyebrow">
          {t(lang, "speech.title")} · {stepLabel}
        </p>
        <h2 id="speech-acquisition-title">{t(lang, "speech.runningTitle")}</h2>
        <p aria-live="polite" role="status">
          {phaseMessage(props, lang)}
          {t(lang, "speech.runningHint")}
        </p>
        <progress
          aria-label={t(lang, "speech.progressAria")}
          max={bounds.max}
          {...(bounds.value === undefined ? {} : { value: bounds.value })}
        />
        {props.errorMessage ? <p role="alert">{props.errorMessage}</p> : null}
        <button onClick={props.onCancel} type="button">
          {t(lang, "speech.stop")}
        </button>
      </section>
    );
  }

  if (confirmingReplacement) {
    return (
      <section
        aria-labelledby="speech-replacement-title"
        class="speech-acquisition subtitle-acquisition--confirmation"
      >
        <p class="subtitle-acquisition__eyebrow">
          {t(lang, "speech.replaceEyebrow")}
        </p>
        <h2 id="speech-replacement-title">{t(lang, "speech.replaceTitle")}</h2>
        <p class="subtitle-acquisition__warning">
          {t(lang, "speech.replaceWarning")}
        </p>
        <p>{t(lang, "speech.replaceSafe")}</p>
        <div class="subtitle-acquisition__actions">
          <button
            class="subtitle-acquisition__danger-action"
            onClick={() => {
              setConfirmingReplacement(false);
              props.onStart();
            }}
            type="button"
          >
            {t(lang, "speech.confirmAndStart")}
          </button>
          <button onClick={() => setConfirmingReplacement(false)} type="button">
            {t(lang, "common.cancel")}
          </button>
        </div>
      </section>
    );
  }

  if (props.phase === "error") {
    return (
      <section
        aria-labelledby="speech-acquisition-title"
        class="speech-acquisition"
      >
        <p class="subtitle-acquisition__eyebrow">{t(lang, "speech.title")}</p>
        <h2 id="speech-acquisition-title">{t(lang, "speech.failedTitle")}</h2>
        <p role="alert">
          {props.errorMessage ?? t(lang, "speech.failedGeneric")}
        </p>
        <button
          disabled={!props.hasConfiguredKey}
          onClick={requestStart}
          type="button"
        >
          {t(lang, "speech.retry")}
        </button>
      </section>
    );
  }

  if (props.phase === "success") {
    return (
      <section
        aria-label={t(lang, "speech.resultAria")}
        class="speech-acquisition"
      >
        <p role="status">
          {t(lang, "speech.resultStatus", { count: props.rowCount ?? 0 })}
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="speech-acquisition-title"
      class="speech-acquisition"
    >
      <p class="subtitle-acquisition__eyebrow">
        {props.reacquiring
          ? t(lang, "shell.reacquireSubtitle")
          : props.hasExistingSubtitle
            ? t(lang, "speech.replaceEyebrow")
            : t(lang, "speech.noSubtitle")}
      </p>
      <h2 id="speech-acquisition-title">{t(lang, "speech.title")}</h2>
      <p>{t(lang, "speech.description")}</p>
      <label>
        {t(lang, "speech.requestLanguage")}
        <select
          aria-label={t(lang, "speech.requestLanguageAria")}
          onInput={(event) =>
            props.onLanguageModeChange(
              event.currentTarget.value as SubtitleLanguageMode,
            )
          }
          value={props.languageMode}
        >
          <option value="mixed">{t(lang, "status.langMixed")}</option>
          <option value="zh">{t(lang, "status.langZh")}</option>
          <option value="en">{t(lang, "status.langEn")}</option>
          <option value="ja">{t(lang, "status.langJa")}</option>
          <option value="other">{t(lang, "status.langOther")}</option>
        </select>
      </label>
      <label>
        {t(lang, "speech.modelStrategy")}
        <select
          aria-label={t(lang, "speech.modelStrategyAria")}
          onInput={(event) =>
            props.onRoutingModeChange(
              event.currentTarget.value as GroqRoutingMode,
            )
          }
          value={props.routingMode}
        >
          <option value="balanced">{t(lang, "speech.strategyBalanced")}</option>
          <option value="turbo-first">{t(lang, "speech.strategyTurbo")}</option>
          <option value="standard-first">
            {t(lang, "speech.strategyStandard")}
          </option>
        </select>
      </label>
      {!props.hasConfiguredKey ? (
        <p role="status">{t(lang, "speech.needGroqKey")}</p>
      ) : null}
      <button
        disabled={!props.hasConfiguredKey}
        onClick={requestStart}
        type="button"
      >
        {t(lang, "speech.start")}
      </button>
    </section>
  );
}
