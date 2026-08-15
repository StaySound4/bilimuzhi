/**
 * 稳定错误 → 用户文案呈现（docs/i18n-spec.md §4）。
 *
 * 深模块：调用方传入任意 unknown 错误，得到不泄露内部细节的用户文案；
 * 错误分类、代码映射与文案措辞全部集中在此，UI 不再各自拼接。
 * 底层消息（ChromePlayerRuntimeError / ChatProtocolError 的 message）
 * 保持原文；UI 层映射按当前语言本地化。
 */
import { AiProviderError } from "../application/ai/provider-error";
import { BackupError } from "../application/backup";
import { generationFailureFor } from "../application/generation-runtime-contract";
import { StorageError } from "../application/storage";
import { VideoGatewayError } from "../application/video-gateway";
import type { ArtifactKind } from "../domain";
import { ChromePlayerRuntimeError } from "../infrastructure/chrome-player-runtime";
import { ChatProtocolError } from "../infrastructure/chrome-chat-runtime";
import { V12SettingsError } from "../infrastructure/provider-profile-settings";
import { t } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { UiLanguage } from "../i18n/languages";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeSessionActionMessage(
  error: unknown,
  lang: UiLanguage = "zh-Hans",
): string {
  if (error instanceof ChromePlayerRuntimeError) {
    return error.message;
  }
  if (error instanceof ChatProtocolError) {
    return error.message;
  }
  if (error instanceof VideoGatewayError) {
    switch (error.code) {
      case "VALIDATION_FAILED":
        return t(lang, "error.videoValidationFailed");
      case "VIDEO_NOT_BOUND":
        return t(lang, "error.videoNotBound");
      case "NETWORK_ERROR":
        return t(lang, "error.videoNetwork");
      case "UNSUPPORTED_CAPABILITY":
        return t(lang, "error.videoUnsupported");
    }
  }
  if (error instanceof AiProviderError) {
    const messages: Record<AiProviderError["code"], string> = {
      AUTHENTICATION_REQUIRED: t(lang, "error.aiAuthRequired"),
      BACKGROUND_RECOVERY_FAILED: t(lang, "error.aiBackgroundRecovery"),
      CONTENT_SAFETY_BLOCKED: t(lang, "error.aiContentSafety"),
      CONTEXT_TOO_LONG: t(lang, "error.aiContextTooLong"),
      INTERNAL_ERROR: t(lang, "error.aiInternal"),
      NETWORK_ERROR: t(lang, "error.aiNetwork"),
      OUTPUT_LIMIT_REACHED: t(lang, "error.aiOutputLimit"),
      PERMISSION_DENIED: t(lang, "error.aiPermissionDenied"),
      PERSISTENCE_FAILED: t(lang, "error.aiPersistence"),
      PROVIDER_BUSY: t(lang, "error.aiBusy"),
      PROVIDER_EARLY_END: t(lang, "error.aiEarlyEnd"),
      RATE_LIMITED: t(lang, "error.aiRateLimited"),
      STRUCTURED_OUTPUT_INVALID: t(lang, "error.aiStructuredOutput"),
      TIMEOUT: t(lang, "error.aiTimeout"),
      UNSUPPORTED_CAPABILITY: t(lang, "error.aiUnsupported"),
      USER_CANCELLED: t(lang, "error.aiUserCancelled"),
    };
    return messages[error.code];
  }
  if (error instanceof V12SettingsError || error instanceof BackupError) {
    return `${error.message}（${error.code}）`;
  }
  if (error instanceof StorageError) {
    const reason = isRecord(error) ? Reflect.get(error, "reason") : undefined;
    if (reason === "CONNECTION_INVALID") {
      return t(lang, "error.dbConnectionInvalid");
    }
    if (reason === "PERSISTED_DATA_INVALID") {
      return t(lang, "error.dbDataInvalid");
    }
    if (error.message.includes("no archivable branch")) {
      return t(lang, "error.noArchivableBranch");
    }
    if (error.message.includes("archive")) {
      return t(lang, "error.archiveFailed");
    }
    if (error.message.includes("trash") || error.message.includes("Trash")) {
      return t(lang, "error.trashFailed");
    }
    return error.retryable
      ? t(lang, "error.dbTempUnavailable")
      : t(lang, "error.dbTransactionIncomplete");
  }
  if (
    error instanceof Error &&
    (error.message.includes("image attachment owner") ||
      error.message.includes("image attachment selection"))
  ) {
    return t(lang, "error.imageInvalid");
  }
  if (error instanceof Error && error.message.includes("attachment support")) {
    return t(lang, "error.imageUnsupported");
  }
  return t(lang, "error.generic");
}

export function safeBackupExportMessage(
  error: unknown,
  lang: UiLanguage = "zh-Hans",
): string {
  if (error instanceof BackupError) {
    return `${error.message}（${error.code}）`;
  }
  const code = isRecord(error) ? Reflect.get(error, "code") : undefined;
  switch (code) {
    case "DOWNLOAD_START_FAILED":
      return t(lang, "error.backupDownloadStart");
    case "DOWNLOAD_STATUS_FAILED":
      return t(lang, "error.backupDownloadStatus");
    case "DOWNLOAD_STATUS_UNCONFIRMED":
      return t(lang, "error.backupDownloadUnconfirmed");
    case "DOWNLOAD_INTERRUPTED":
      return t(lang, "error.backupDownloadInterrupted");
    case "DOWNLOAD_ITEM_MISSING":
      return t(lang, "error.backupDownloadItemMissing");
    case "DOWNLOAD_PATH_MISSING":
      return t(lang, "error.backupDownloadPathMissing");
    case "DOWNLOAD_OPEN_FOLDER_FAILED":
      return t(lang, "error.backupOpenFolder");
    default:
      return t(lang, "error.backupGeneric");
  }
}
export {
  generationFailureFor,
  stableGenerationFailureCode,
} from "../application/generation-runtime-contract";

export function artifactFailureMessage(
  errorCode: string | null,
  kind: ArtifactKind,
  lang: UiLanguage = "zh-Hans",
): string {
  const presentation = generationFailureFor({
    errorCode,
    hasPartialOutput: false,
    hasPreviousArtifact: false,
    kind,
  });
  if (presentation !== null) {
    return `${presentation.code}：${t(lang, presentation.action as MessageKey)}。`;
  }
  switch (errorCode) {
    case "STOPPED_BY_USER":
      return t(lang, "error.generationStopped");
    case "AUTHENTICATION_REQUIRED":
      return t(lang, "error.generationAuth");
    case "CONTEXT_TOO_LONG":
      return t(lang, "error.generationContextTooLong");
    case "RATE_LIMITED":
      return t(lang, "error.generationRateLimited");
    case "TIMEOUT":
      return t(lang, "error.generationTimeout");
    case "NETWORK_ERROR":
      return t(lang, "error.generationNetwork");
    case "PERMISSION_DENIED":
      return t(lang, "error.generationPermissionDenied");
    case "UNSUPPORTED_CAPABILITY":
      return t(lang, "error.generationUnsupported");
    default:
      return t(lang, "error.generationIncomplete");
  }
}
