import {
  isVideoKey,
  isVideoRef,
  type VideoKey,
  type VideoRef,
} from "../domain";
import type { VideoResolveInput } from "./video-gateway";
import type { SubtitleTrackOption } from "./subtitle-gateway";
import type {
  SubtitleAcquisitionOwner,
  SubtitleLanguageMode,
} from "./subtitle-acquisition-contract";

export type { VideoResolveInput } from "./video-gateway";
export type {
  SubtitleTrackOption,
  SubtitleTrackSource,
} from "./subtitle-gateway";
export type {
  SubtitleAcquisitionMethod,
  SubtitleAcquisitionOwner,
  SubtitleLanguageMode,
} from "./subtitle-acquisition-contract";

export const RUNTIME_PROTOCOL_VERSION = 1 as const;
export const ACQUISITION_RUNTIME_PROTOCOL_VERSION = 2 as const;

export const EXTENSION_ERROR_CODES = [
  "VALIDATION_FAILED",
  "VIDEO_NOT_BOUND",
  "SUBTITLE_NOT_FOUND",
  "AUTHENTICATION_REQUIRED",
  "PERMISSION_DENIED",
  "CHARGED_CONTENT_UNSUPPORTED",
  "SUBTITLE_URL_EXPIRED",
  "SUBTITLE_REPLACEMENT_REQUIRED",
  "RATE_LIMITED",
  "TIMEOUT",
  "NETWORK_ERROR",
  "CONTEXT_TOO_LONG",
  "UNSUPPORTED_CAPABILITY",
  "TASK_ALREADY_RUNNING",
  "TASK_INTERRUPTED",
  "STORAGE_TRANSACTION_FAILED",
  "ASR_MEDIA_INCOMPLETE",
  "ASR_CHUNK_FAILED",
  "EXPORT_FAILED",
  "INTERNAL_ERROR",
] as const;

export type ExtensionErrorCode = (typeof EXTENSION_ERROR_CODES)[number];
export type ExtensionErrorDetailValue = string | number | boolean | null;

export interface ExtensionError {
  code: ExtensionErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, ExtensionErrorDetailValue>;
}

interface RuntimeEnvelope {
  protocolVersion: typeof RUNTIME_PROTOCOL_VERSION;
  requestId: string;
}

interface AcquisitionRuntimeEnvelope {
  readonly protocolVersion: typeof ACQUISITION_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
}

export type AcquisitionRuntimeCommand =
  | (AcquisitionRuntimeEnvelope & {
      readonly type: "muzhi.subtitle.tracks.list";
      readonly payload: SubtitleAcquisitionOwner;
    })
  | (AcquisitionRuntimeEnvelope & {
      readonly type: "muzhi.subtitle.acquire";
      readonly payload: SubtitleAcquisitionOwner & {
        readonly method: "direct";
        readonly trackId: string;
      };
    })
  | (AcquisitionRuntimeEnvelope & {
      readonly type: "muzhi.subtitle.acquire";
      readonly payload: SubtitleAcquisitionOwner & {
        readonly method: "speech";
        readonly requestedLanguageMode: SubtitleLanguageMode;
        readonly provider: string;
        readonly model: string;
        readonly mediaIdentity: string;
      };
    });

export type AcquisitionRuntimeEvent =
  | (AcquisitionRuntimeEnvelope & {
      readonly type: "muzhi.subtitle.tracks.listed";
      readonly payload: SubtitleAcquisitionOwner & {
        readonly tracks: readonly SubtitleTrackOption[];
      };
    })
  | (AcquisitionRuntimeEnvelope & {
      readonly type: "muzhi.subtitle.acquired";
      readonly payload: SubtitleAcquisitionOwner & {
        readonly branchId: string;
        readonly subtitleId: string;
        readonly rowCount: number;
      };
    })
  | (AcquisitionRuntimeEnvelope & {
      readonly type: "muzhi.acquisition.failed";
      readonly payload: SubtitleAcquisitionOwner;
      readonly error: ExtensionError;
    });
export type RuntimeCommand =
  | (RuntimeEnvelope & {
      type: "muzhi.video.resolve";
      payload: { input: VideoResolveInput };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.subtitle.tracks.list";
      payload: { videoKey: VideoKey };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.subtitle.acquire";
      payload: {
        videoKey: VideoKey;
        method: "direct";
        trackId: string;
      };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.subtitle.acquire";
      payload: {
        videoKey: VideoKey;
        method: "speech";
        languageMode?: SubtitleLanguageMode;
      };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.video.seek";
      payload: { videoKey: VideoKey; seconds: number };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.video.time.read";
      payload: { videoKey: VideoKey };
    });

/**
 * 播放器 seek 中继协议的共享类型：relay（Service Worker 侧）与 bridge（页面侧）
 * 各自维护的重复定义收敛到这里，保证两侧对同一协议消息的判型一致。
 */
export interface SeekDispatchSequence {
  readonly sequence: number;
}

export type SeekCommand = Extract<RuntimeCommand, { type: "muzhi.video.seek" }>;

export type RelayedSeekCommand = SeekCommand & {
  readonly seekDispatch: SeekDispatchSequence;
};

export type SeekWatermarkCommand = {
  readonly type: "muzhi.video.seek.watermark";
  readonly seekDispatch: SeekDispatchSequence;
};

export type RuntimeEvent =
  | (RuntimeEnvelope & {
      type: "muzhi.video.resolved";
      payload: { video: VideoRef };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.subtitle.tracks.listed";
      payload: {
        videoKey: VideoKey;
        tracks: readonly SubtitleTrackOption[];
      };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.subtitle.acquired";
      payload: { videoKey: VideoKey; subtitleId: string; rowCount: number };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.video.seeked";
      payload: { videoKey: VideoKey; seconds: number };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.video.time.reported";
      payload: { currentTimeMs: number; videoKey: VideoKey };
    })
  | (RuntimeEnvelope & {
      type: "muzhi.command.failed";
      error: ExtensionError;
    });

const errorCodeSet = new Set<string>(EXTENSION_ERROR_CODES);
const subtitleMethods = new Set<string>(["direct", "speech"]);
const languageModes = new Set<string>(["zh", "en", "other", "mixed"]);
const subtitleTrackSources = new Set<string>(["official", "ai"]);
const subtitleTrackOrigins = new Set<string>([
  "user-upload",
  "official-cc",
  "ai",
]);
function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isBoundedTrimmedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim()
  );
}

function isSubtitleTrackId(value: unknown): value is string {
  return isBoundedTrimmedString(value, 128) && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isSafeOpaqueIdentifier(value: unknown): value is string {
  return (
    isBoundedTrimmedString(value, 128) &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isSubtitleTrackOption(value: unknown): value is SubtitleTrackOption {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["language", "name", "origin", "source", "trackId"]) &&
    isBoundedTrimmedString(value.language, 64) &&
    isBoundedTrimmedString(value.name, 128) &&
    isNonEmptyString(value.source) &&
    subtitleTrackSources.has(value.source) &&
    isSubtitleTrackId(value.trackId) &&
    (value.origin === undefined ||
      value.origin === null ||
      (isNonEmptyString(value.origin) &&
        subtitleTrackOrigins.has(value.origin)))
  );
}

function isSubtitleTrackOptions(
  value: unknown,
): value is readonly SubtitleTrackOption[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > 50 ||
    !value.every(isSubtitleTrackOption)
  ) {
    return false;
  }
  const trackIds = value.map((track) => track.trackId);
  return new Set(trackIds).size === trackIds.length;
}

function hasValidEnvelope(value: Record<string, unknown>): boolean {
  return (
    value.protocolVersion === RUNTIME_PROTOCOL_VERSION &&
    isNonEmptyString(value.requestId)
  );
}

function isExtensionErrorDetailValue(
  value: unknown,
): value is ExtensionErrorDetailValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function isExtensionError(value: unknown): value is ExtensionError {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["code", "message", "retryable", "details"])
  ) {
    return false;
  }

  if (
    !isNonEmptyString(value.code) ||
    !errorCodeSet.has(value.code) ||
    !isNonEmptyString(value.message) ||
    typeof value.retryable !== "boolean"
  ) {
    return false;
  }

  if (value.details === undefined) {
    return true;
  }

  return (
    isRecord(value.details) &&
    Object.values(value.details).every(isExtensionErrorDetailValue)
  );
}

function isVideoResolveInput(value: unknown): value is VideoResolveInput {
  if (!isRecord(value)) {
    return false;
  }

  if (value.kind === "current-tab") {
    return (
      hasOnlyKeys(value, ["kind", "tabId"]) && isPositiveInteger(value.tabId)
    );
  }

  return (
    value.kind === "identifier" &&
    hasOnlyKeys(value, ["kind", "value"]) &&
    isNonEmptyString(value.value)
  );
}

export function isRuntimeCommand(value: unknown): value is RuntimeCommand {
  if (
    !isRecord(value) ||
    !hasValidEnvelope(value) ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  switch (value.type) {
    case "muzhi.video.resolve":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        hasOnlyKeys(value.payload, ["input"]) &&
        isVideoResolveInput(value.payload.input)
      );
    case "muzhi.subtitle.tracks.list":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        hasOnlyKeys(value.payload, ["videoKey"]) &&
        isVideoKey(value.payload.videoKey)
      );
    case "muzhi.subtitle.acquire":
      if (
        !hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) ||
        !isVideoKey(value.payload.videoKey) ||
        !isNonEmptyString(value.payload.method) ||
        !subtitleMethods.has(value.payload.method)
      ) {
        return false;
      }
      if (value.payload.method === "direct") {
        return (
          hasOnlyKeys(value.payload, ["videoKey", "method", "trackId"]) &&
          isSubtitleTrackId(value.payload.trackId)
        );
      }
      return (
        hasOnlyKeys(value.payload, ["videoKey", "method", "languageMode"]) &&
        (value.payload.languageMode === undefined ||
          (isNonEmptyString(value.payload.languageMode) &&
            languageModes.has(value.payload.languageMode)))
      );
    case "muzhi.video.seek":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        hasOnlyKeys(value.payload, ["videoKey", "seconds"]) &&
        isVideoKey(value.payload.videoKey) &&
        isNonNegativeFiniteNumber(value.payload.seconds)
      );
    case "muzhi.video.time.read":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        hasOnlyKeys(value.payload, ["videoKey"]) &&
        isVideoKey(value.payload.videoKey)
      );
    default:
      return false;
  }
}

export function isRuntimeEvent(value: unknown): value is RuntimeEvent {
  if (!isRecord(value) || !hasValidEnvelope(value)) {
    return false;
  }

  switch (value.type) {
    case "muzhi.video.resolved":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        isRecord(value.payload) &&
        hasOnlyKeys(value.payload, ["video"]) &&
        isVideoRef(value.payload.video)
      );
    case "muzhi.subtitle.tracks.listed":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        isRecord(value.payload) &&
        hasOnlyKeys(value.payload, ["videoKey", "tracks"]) &&
        isVideoKey(value.payload.videoKey) &&
        isSubtitleTrackOptions(value.payload.tracks)
      );
    case "muzhi.subtitle.acquired":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        isRecord(value.payload) &&
        hasOnlyKeys(value.payload, ["videoKey", "subtitleId", "rowCount"]) &&
        isVideoKey(value.payload.videoKey) &&
        isNonEmptyString(value.payload.subtitleId) &&
        isPositiveInteger(value.payload.rowCount)
      );
    case "muzhi.video.seeked":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        isRecord(value.payload) &&
        hasOnlyKeys(value.payload, ["videoKey", "seconds"]) &&
        isVideoKey(value.payload.videoKey) &&
        isNonNegativeFiniteNumber(value.payload.seconds)
      );
    case "muzhi.video.time.reported":
      return (
        hasOnlyKeys(value, [
          "protocolVersion",
          "requestId",
          "type",
          "payload",
        ]) &&
        isRecord(value.payload) &&
        hasOnlyKeys(value.payload, ["currentTimeMs", "videoKey"]) &&
        isVideoKey(value.payload.videoKey) &&
        isNonNegativeSafeInteger(value.payload.currentTimeMs)
      );
    case "muzhi.command.failed":
      return (
        hasOnlyKeys(value, ["protocolVersion", "requestId", "type", "error"]) &&
        isExtensionError(value.error)
      );
    default:
      return false;
  }
}

const acquisitionOwnerKeys = [
  "acquisitionId",
  "taskId",
  "sessionId",
  "draftBranchId",
  "videoKey",
  "expectedSelectionRevision",
  "expectedContextRevision",
] as const;

function hasValidAcquisitionEnvelope(value: Record<string, unknown>): boolean {
  return (
    value.protocolVersion === ACQUISITION_RUNTIME_PROTOCOL_VERSION &&
    isSafeOpaqueIdentifier(value.requestId)
  );
}

function hasValidAcquisitionOwner(value: Record<string, unknown>): boolean {
  return (
    isSafeOpaqueIdentifier(value.acquisitionId) &&
    isSafeOpaqueIdentifier(value.taskId) &&
    isSafeOpaqueIdentifier(value.sessionId) &&
    isSafeOpaqueIdentifier(value.draftBranchId) &&
    isVideoKey(value.videoKey) &&
    isNonNegativeFiniteNumber(value.expectedSelectionRevision) &&
    Number.isSafeInteger(value.expectedSelectionRevision) &&
    isNonNegativeFiniteNumber(value.expectedContextRevision) &&
    Number.isSafeInteger(value.expectedContextRevision)
  );
}

export function isAcquisitionRuntimeCommand(
  value: unknown,
): value is AcquisitionRuntimeCommand {
  if (
    !isRecord(value) ||
    !hasValidAcquisitionEnvelope(value) ||
    !hasOnlyKeys(value, ["protocolVersion", "requestId", "type", "payload"]) ||
    !isRecord(value.payload) ||
    !hasValidAcquisitionOwner(value.payload)
  ) {
    return false;
  }

  if (value.type === "muzhi.subtitle.tracks.list") {
    return hasOnlyKeys(value.payload, acquisitionOwnerKeys);
  }
  if (value.type !== "muzhi.subtitle.acquire") {
    return false;
  }
  if (value.payload.method === "direct") {
    return (
      hasOnlyKeys(value.payload, [
        ...acquisitionOwnerKeys,
        "method",
        "trackId",
      ]) && isSubtitleTrackId(value.payload.trackId)
    );
  }
  return (
    value.payload.method === "speech" &&
    hasOnlyKeys(value.payload, [
      ...acquisitionOwnerKeys,
      "method",
      "requestedLanguageMode",
      "provider",
      "model",
      "mediaIdentity",
    ]) &&
    typeof value.payload.requestedLanguageMode === "string" &&
    languageModes.has(value.payload.requestedLanguageMode) &&
    isSafeOpaqueIdentifier(value.payload.provider) &&
    isSafeOpaqueIdentifier(value.payload.model) &&
    isSafeOpaqueIdentifier(value.payload.mediaIdentity)
  );
}

export function isAcquisitionRuntimeEvent(
  value: unknown,
): value is AcquisitionRuntimeEvent {
  if (
    !isRecord(value) ||
    !hasValidAcquisitionEnvelope(value) ||
    !isRecord(value.payload) ||
    !hasValidAcquisitionOwner(value.payload)
  ) {
    return false;
  }

  if (value.type === "muzhi.subtitle.tracks.listed") {
    return (
      hasOnlyKeys(value, ["protocolVersion", "requestId", "type", "payload"]) &&
      hasOnlyKeys(value.payload, [...acquisitionOwnerKeys, "tracks"]) &&
      isSubtitleTrackOptions(value.payload.tracks)
    );
  }
  if (value.type === "muzhi.subtitle.acquired") {
    return (
      hasOnlyKeys(value, ["protocolVersion", "requestId", "type", "payload"]) &&
      hasOnlyKeys(value.payload, [
        ...acquisitionOwnerKeys,
        "branchId",
        "subtitleId",
        "rowCount",
      ]) &&
      isSafeOpaqueIdentifier(value.payload.branchId) &&
      value.payload.branchId === value.payload.draftBranchId &&
      isSafeOpaqueIdentifier(value.payload.subtitleId) &&
      isPositiveInteger(value.payload.rowCount)
    );
  }
  return (
    value.type === "muzhi.acquisition.failed" &&
    hasOnlyKeys(value, [
      "protocolVersion",
      "requestId",
      "type",
      "payload",
      "error",
    ]) &&
    hasOnlyKeys(value.payload, acquisitionOwnerKeys) &&
    isExtensionError(value.error)
  );
}
