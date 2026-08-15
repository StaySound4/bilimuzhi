import { isVideoKey } from "../../domain";
import type { SubtitleAcquisitionOwner } from "../subtitle-acquisition-contract";
import type {
  SpeechAcquisitionParameters,
  SpeechAcquisitionRecord,
} from "./speech-acquisition-coordinator";
import { speechFailureFromCode } from "./speech-failure-presentation";

export const SPEECH_RUNTIME_PROTOCOL_VERSION = 1 as const;

interface SpeechRuntimeEnvelope {
  readonly protocolVersion: typeof SPEECH_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
}

export type SpeechRuntimeCommand =
  | (SpeechRuntimeEnvelope & {
      readonly type: "muzhi.speech.start";
      readonly payload: {
        readonly videoKey: SubtitleAcquisitionOwner["videoKey"];
        readonly requestedLanguageMode: SpeechAcquisitionParameters["requestedLanguageMode"];
        readonly routingMode: SpeechAcquisitionParameters["routingMode"];
      };
    })
  | (SpeechRuntimeEnvelope & {
      readonly type: "muzhi.speech.active";
      readonly payload: {
        readonly videoKey: SubtitleAcquisitionOwner["videoKey"];
      };
    })
  | (SpeechRuntimeEnvelope & {
      readonly type: "muzhi.speech.status" | "muzhi.speech.cancel";
      readonly payload: { readonly owner: SubtitleAcquisitionOwner };
    });

export type SpeechRuntimeEvent =
  | (SpeechRuntimeEnvelope & {
      readonly type: "muzhi.speech.started";
      readonly payload: { readonly owner: SubtitleAcquisitionOwner };
    })
  | (SpeechRuntimeEnvelope & {
      readonly type: "muzhi.speech.statused";
      readonly payload: { readonly record: SpeechAcquisitionRecord | null };
    })
  | (SpeechRuntimeEnvelope & {
      readonly type: "muzhi.speech.active-listed";
      readonly payload: {
        readonly records: readonly SpeechAcquisitionRecord[];
      };
    })
  | (SpeechRuntimeEnvelope & {
      readonly type: "muzhi.speech.cancelled";
      readonly payload: {
        readonly cancelled: boolean;
        readonly owner: SubtitleAcquisitionOwner;
      };
    })
  | (SpeechRuntimeEnvelope & {
      readonly type: "muzhi.speech.failed";
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      };
    });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

export function isSpeechOwner(
  value: unknown,
): value is SubtitleAcquisitionOwner {
  return (
    isRecord(value) &&
    isIdentifier(value.acquisitionId) &&
    isIdentifier(value.draftBranchId) &&
    isIdentifier(value.sessionId) &&
    isIdentifier(value.taskId) &&
    isVideoKey(value.videoKey) &&
    Number.isSafeInteger(value.expectedSelectionRevision) &&
    Number(value.expectedSelectionRevision) >= 0 &&
    Number.isSafeInteger(value.expectedContextRevision) &&
    Number(value.expectedContextRevision) >= 1
  );
}

export function isSpeechRuntimeCommand(
  value: unknown,
): value is SpeechRuntimeCommand {
  if (
    !isRecord(value) ||
    value.protocolVersion !== SPEECH_RUNTIME_PROTOCOL_VERSION ||
    !isIdentifier(value.requestId) ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  if (value.type === "muzhi.speech.start") {
    return (
      isVideoKey(value.payload.videoKey) &&
      (value.payload.requestedLanguageMode === "zh" ||
        value.payload.requestedLanguageMode === "en" ||
        value.payload.requestedLanguageMode === "other" ||
        value.payload.requestedLanguageMode === "mixed") &&
      (value.payload.routingMode === "balanced" ||
        value.payload.routingMode === "standard-first" ||
        value.payload.routingMode === "turbo-first")
    );
  }
  if (value.type === "muzhi.speech.active") {
    return isVideoKey(value.payload.videoKey);
  }
  return (
    (value.type === "muzhi.speech.status" ||
      value.type === "muzhi.speech.cancel") &&
    isSpeechOwner(value.payload.owner)
  );
}

export function safeSpeechRuntimeFailure(
  command: SpeechRuntimeCommand,
  error: unknown,
): SpeechRuntimeEvent {
  const code =
    isRecord(error) &&
    typeof error.code === "string" &&
    /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
      ? error.code
      : "SPEECH_TRANSCRIPTION_FAILED";
  const presentation = speechFailureFromCode(code);
  return Object.freeze({
    error: Object.freeze({
      code,
      message: presentation.message,
      retryable: presentation.retryable,
    }),
    protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    type: "muzhi.speech.failed",
  });
}
