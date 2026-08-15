import { t } from "../../i18n";
import type { UiLanguage } from "../../i18n/languages";
import type { SpeechAcquisitionRecord } from "./speech-acquisition-coordinator";

export interface SpeechFailurePresentation {
  readonly message: string;
  readonly retryable: boolean;
  readonly title?: string;
}

type SpeechFailureRecord = Pick<
  SpeechAcquisitionRecord,
  "errorCode" | "status"
>;

const FAILURE_MESSAGE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  AUTHENTICATION_REQUIRED: "speechError.auth",
  CANCELLED: "speechError.cancelled",
  MEDIA_IDENTITY_CHANGED: "speechError.mediaIdentityChanged",
  MEDIA_INCOMPLETE: "speechError.mediaIncomplete",
  MEDIA_URL_EXPIRED: "speechError.mediaUrlExpired",
  NETWORK_ERROR: "speechError.network",
  PERMISSION_DENIED: "speechError.permissionDenied",
  RATE_LIMITED: "speechError.rateLimited",
  SPEECH_TRANSCRIPTION_FAILED: "speechError.transcriptionFailed",
  TIMESTAMPS_UNAVAILABLE: "speechError.timestampsUnavailable",
  TIMEOUT: "speechError.timeout",
  UNSUPPORTED_CAPABILITY: "speechError.unsupported",
  VALIDATION_FAILED: "speechError.validationFailed",
  VIDEO_NOT_BOUND: "speechError.videoNotBound",
});

const RETRYABLE_CODES = new Set([
  "MEDIA_URL_EXPIRED",
  "NETWORK_ERROR",
  "RATE_LIMITED",
  "TIMEOUT",
]);

export function speechFailureFromCode(
  inputCode: string | null | undefined,
  lang: UiLanguage = "zh-Hans",
): SpeechFailurePresentation {
  const code =
    typeof inputCode === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(inputCode)
      ? inputCode
      : "SPEECH_TRANSCRIPTION_FAILED";
  if (code === "FILE_TOO_LARGE") {
    return Object.freeze({
      message: t(lang, "speechError.fileTooLarge"),
      retryable: true,
      title: t(lang, "speechError.fileTooLargeTitle"),
    });
  }
  return Object.freeze({
    message:
      FAILURE_MESSAGE_KEYS[code] === undefined
        ? t(lang, "speechError.transcriptionFailed")
        : t(lang, FAILURE_MESSAGE_KEYS[code] as Parameters<typeof t>[1]),
    retryable: RETRYABLE_CODES.has(code),
  });
}

export function speechFailurePresentation(
  record: SpeechFailureRecord,
  lang: UiLanguage = "zh-Hans",
): SpeechFailurePresentation {
  if (record.status === "interrupted") {
    return Object.freeze({
      message: t(lang, "speechError.interrupted"),
      retryable: false,
    });
  }
  return speechFailureFromCode(record.errorCode, lang);
}
