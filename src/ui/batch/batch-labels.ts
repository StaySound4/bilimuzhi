/**
 * Ticket 01 拆分出的批量 UI 共享标签/格式化纯函数。
 *
 * 拆分前这些函数位于 batch-workspace.tsx 内部；拆分后由
 * BatchJobsList / BatchSourceForm / BatchItemTable / BatchWorkspace
 * 共用，保持与拆分前完全一致的文案与格式输出。
 */
import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import { speechFailureFromCode } from "../../application/asr/speech-failure-presentation";
import type { BatchItem, BatchJob, SubtitleLanguageMode } from "../../domain";
import type { BatchColumnId } from "./batch-column-layout";

export function jobStatusLabel(
  lang: UiLanguage,
  status: BatchJob["status"],
): string {
  const labels: Record<BatchJob["status"], string> = {
    cancelled: t(lang, "batch.jobCancelled"),
    completed: t(lang, "batch.jobCompleted"),
    failed: t(lang, "batch.jobFailed"),
    preparing: t(lang, "batch.jobPreparing"),
    ready: t(lang, "batch.jobReady"),
    running: t(lang, "batch.jobRunning"),
  };
  return labels[status];
}

/** canonical 列 ID → 表头文案（colgroup/thead/resizer 共用同一映射）。 */
export function columnLabel(lang: UiLanguage, columnId: BatchColumnId): string {
  switch (columnId) {
    case "index":
      return t(lang, "batch.colIndex");
    case "status":
      return t(lang, "batch.colSubtitleStatus");
    case "title":
      return t(lang, "batch.colTitle");
    case "author":
      return t(lang, "batch.colAuthor");
    case "published":
      return t(lang, "batch.colPublished");
    case "identity":
      return t(lang, "batch.colIdentity");
    case "actions":
      return t(lang, "batch.colOperations");
  }
}

export function speechLanguageLabel(
  lang: UiLanguage,
  mode: SubtitleLanguageMode,
): string {
  switch (mode) {
    case "zh":
      return t(lang, "status.langZh");
    case "en":
      return t(lang, "status.langEn");
    case "other":
      return t(lang, "status.langOther");
    case "mixed":
      return t(lang, "status.langMixed");
    case "ja":
      return t(lang, "status.langJa");
  }
}

export function itemStatusText(
  lang: UiLanguage,
  status: BatchItem["status"],
): string {
  const labels: Record<BatchItem["status"], string> = {
    cancelled: t(lang, "batch.jobCancelled"),
    failed: t(lang, "batch.jobFailed"),
    pending: t(lang, "batch.itemPending"),
    running: t(lang, "batch.itemRunning"),
    succeeded: t(lang, "batch.itemSucceeded"),
  };
  return labels[status];
}

export function itemErrorLabel(
  lang: UiLanguage,
  item: Pick<BatchItem, "acquisitionMethod" | "errorCode">,
): string {
  const code = item.errorCode;
  if (code === null) return "";
  // 语音转字幕的错误码与 B 站字幕共用 AUTHENTICATION_REQUIRED 等码，
  // 但语义不同：语音语境下指 Groq 密钥/提供商认证，复用会话模式语音映射，
  // 避免把 Groq 密钥问题误导为「需要登录 B 站」。
  if (item.acquisitionMethod === "speech") {
    return speechFailureFromCode(code, lang).message;
  }
  const labels: Readonly<Record<string, string>> = {
    AUTHENTICATION_REQUIRED: t(lang, "batch.errorAuthRequired"),
    BACKGROUND_RECOVERY_FAILED: t(lang, "batch.errorBackgroundRecovery"),
    CANCELLED: t(lang, "batch.errorCancelled"),
    INTERNAL_ERROR: t(lang, "batch.errorInternal"),
    NETWORK_ERROR: t(lang, "batch.errorNetwork"),
    PERMISSION_DENIED: t(lang, "batch.errorPermissionDenied"),
    SPEECH_RUNTIME_UNAVAILABLE: t(lang, "batch.errorSpeechUnavailable"),
    SPEECH_TRANSCRIPTION_FAILED: t(lang, "batch.errorSpeechTranscription"),
    STORAGE_TRANSACTION_FAILED: t(lang, "batch.errorStorage"),
    SUBTITLE_NOT_FOUND: t(lang, "batch.errorSubtitleNotFound"),
    SUBTITLE_URL_EXPIRED: t(lang, "batch.errorSubtitleUrlExpired"),
    VALIDATION_FAILED: t(lang, "batch.errorValidation"),
    VIDEO_NOT_BOUND: t(lang, "batch.errorVideoNotBound"),
  };
  return labels[code] ?? t(lang, "batch.errorGeneric");
}

export function progressStageLabel(lang: UiLanguage, stage: string): string {
  const labels: Readonly<Record<string, string>> = {
    acquiring: t(lang, "batch.progressAcquiring"),
    completed: t(lang, "batch.progressCompleted"),
    discovering: t(lang, "batch.progressDiscovering"),
    discovered: t(lang, "batch.progressDiscovered"),
    downloading: t(lang, "batch.progressDownloading"),
    listed: t(lang, "batch.progressListed"),
    listing: t(lang, "batch.progressListing"),
    "listing-failed": t(lang, "batch.progressListingFailed"),
    merging: t(lang, "batch.progressMerging"),
    preparing: t(lang, "batch.progressPreparing"),
    resolved: t(lang, "batch.progressResolved"),
    resolving: t(lang, "batch.progressResolving"),
    saved: t(lang, "batch.progressSaved"),
    transcribing: t(lang, "batch.progressTranscribing"),
  };
  return labels[stage] ?? stage;
}

const DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function publishedAtLabel(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return DATE_FORMATTER.format(new Date(value * 1_000));
}

function formatMegabytes(bytes: number): string {
  const safeBytes = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  return `${(safeBytes / 1_048_576).toFixed(1)} MB`;
}

export function progressLabel(
  lang: UiLanguage,
  item: BatchItem,
): string | null {
  if (!item.progress) return null;
  const stage = progressStageLabel(lang, item.progress.stage);
  if (item.acquisitionMethod === "speech" && item.progress.unit === "bytes") {
    // 字节进度(下载音频/编码):MB + 百分比。
    const completed = formatMegabytes(item.progress.completed);
    if (item.progress.total <= 0) {
      return t(lang, "batch.progressBytes", { stage, completed });
    }
    const total = formatMegabytes(item.progress.total);
    const percent = Math.min(
      100,
      Math.max(
        0,
        Math.round((item.progress.completed / item.progress.total) * 100),
      ),
    );
    return `${stage} ${completed} / ${total} · ${percent}%`;
  }
  // 计数进度(loading/reading/转写分片/合并):x/y。
  return item.progress.total > 0
    ? `${stage} ${item.progress.completed}/${item.progress.total}`
    : stage;
}

export function itemStatusBadge(
  lang: UiLanguage,
  item: BatchItem,
): { readonly label: string; readonly trackName: string | null } {
  if (item.status !== "succeeded") {
    return { label: itemStatusText(lang, item.status), trackName: null };
  }
  if (item.acquisitionMethod === "speech") {
    return { label: t(lang, "batch.statusHasSpeech"), trackName: null };
  }
  const track = item.availableTracks?.find(
    (candidate) => candidate.trackId === item.trackId,
  );
  const label =
    track?.origin === "user-upload"
      ? t(lang, "batch.statusHasUserUpload")
      : track?.origin === "official-cc" || track?.source === "official"
        ? t(lang, "batch.statusHasOfficial")
        : track?.origin === "ai" || track?.source === "ai"
          ? t(lang, "batch.statusHasAi")
          : t(lang, "batch.statusHasBatch");
  return { label, trackName: track?.name ?? null };
}
