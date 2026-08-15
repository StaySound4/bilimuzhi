import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";
import { isVideoKey, type VideoKey } from "./video";
import type { SubtitleLanguageMode } from "./branch";
import type { SubtitleTrackOrigin } from "./subtitle";

export type BatchJobStatus =
  "preparing" | "ready" | "running" | "completed" | "cancelled" | "failed";

export type BatchItemStatus =
  "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type BatchAcquisitionMethod = "direct" | "speech";

export interface BatchTrackOption {
  readonly language: string;
  readonly name: string;
  readonly source: "ai" | "official";
  readonly trackId: string;
  /** v16 D3：用户上传 > 官方 CC > AI；旧数据缺失时按 source 推导。 */
  readonly origin?: SubtitleTrackOrigin | null;
}
/**
 * A deliberately small progress projection. Batch persistence must never hold
 * media URLs, provider responses, transcript bodies, or credentials.
 */
export interface BatchItemProgress {
  readonly completed: number;
  readonly stage: string;
  readonly total: number;
  /** 进度单位:字节(下载/编码)或计数(分片/准备步骤)。缺省按计数处理。 */
  readonly unit?: "bytes" | "count";
}

/** Persistable ownership only; deliberately excludes media/provider payloads. */
export interface BatchSpeechOwner {
  readonly acquisitionId: string;
  readonly taskId: string;
  readonly videoKey: VideoKey;
}

export interface BatchJob {
  readonly batchJobId: string;
  readonly browserSessionId: string;
  readonly method?: BatchAcquisitionMethod;
  /** Expand phase: user-owned list name; legacy records fall back to sourceLabel. */
  readonly name?: string;
  readonly sourceKind?: string;
  readonly sourceLabel?: string;
  readonly status: BatchJobStatus;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface BatchItem {
  readonly acquisitionMethod?: BatchAcquisitionMethod | null;
  /** Source-provided archive identity used to validate later resolution. */
  readonly aid?: number | null;
  readonly author?: string;
  readonly availableTracks?: readonly BatchTrackOption[];
  readonly batchItemId: string;
  readonly batchJobId: string;
  readonly bvid: string;
  /** Source-provided exact part identity used for canonical selection. */
  readonly cid?: number | null;
  readonly errorCode: string | null;
  readonly order: number;
  readonly page: number;
  readonly progress?: BatchItemProgress | null;
  readonly publishedAt?: number | null;
  /** @deprecated v9 batch subtitles never own Session or branch references. */
  readonly resultBranchId?: string | null;
  /** @deprecated v9 batch subtitles never own Session or branch references. */
  readonly resultSessionId?: string | null;
  readonly rowCount: number;
  readonly selected: boolean;
  readonly selectedLanguage?: string | null;
  readonly selectedTrackId?: string | null;
  /** Speech recognition request language, independent from direct subtitle tracks. */
  readonly speechLanguageMode?: SubtitleLanguageMode;
  readonly speechOwner?: BatchSpeechOwner | null;
  readonly status: BatchItemStatus;
  readonly title: string;
  readonly trackId: string | null;
  readonly tracksDiscovered?: boolean;
  readonly retryable?: boolean;
  readonly updatedAt: number;
  readonly videoKey: VideoKey | null;
}

const JOB_STATUSES: readonly BatchJobStatus[] = Object.freeze([
  "preparing",
  "ready",
  "running",
  "completed",
  "cancelled",
  "failed",
]);

const ITEM_STATUSES: readonly BatchItemStatus[] = Object.freeze([
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

function assertNullableNonEmptyString(value: unknown, field: string): void {
  if (value !== null) assertNonEmptyString(value, field);
}

function normalizeTrackOptions(value: unknown): readonly BatchTrackOption[] {
  if (!Array.isArray(value)) return Object.freeze([]);
  const tracks: BatchTrackOption[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const track = candidate as Partial<BatchTrackOption>;
    const origin =
      track.origin === undefined || track.origin === null ? null : track.origin;
    if (
      typeof track.trackId !== "string" ||
      track.trackId.trim().length === 0 ||
      typeof track.language !== "string" ||
      track.language.trim().length === 0 ||
      typeof track.name !== "string" ||
      track.name.trim().length === 0 ||
      (track.source !== "official" && track.source !== "ai") ||
      (origin !== null &&
        origin !== "user-upload" &&
        origin !== "official-cc" &&
        origin !== "ai")
    ) {
      continue;
    }
    const trackId = track.trackId.trim().slice(0, 200);
    if (seen.has(trackId)) continue;
    seen.add(trackId);
    tracks.push(
      Object.freeze({
        language: track.language.trim().slice(0, 32),
        name: track.name.trim().slice(0, 100),
        source: track.source,
        trackId,
        ...(origin === null ? {} : { origin }),
      }),
    );
  }
  return Object.freeze(tracks);
}

function normalizeProgress(value: unknown): BatchItemProgress | null {
  if (typeof value !== "object" || value === null) return null;
  const progress = value as Partial<BatchItemProgress>;
  if (
    typeof progress.stage !== "string" ||
    progress.stage.trim().length === 0 ||
    !Number.isSafeInteger(progress.completed) ||
    (progress.completed ?? -1) < 0 ||
    !Number.isSafeInteger(progress.total) ||
    (progress.total ?? -1) < 0 ||
    (progress.completed ?? 0) > (progress.total ?? 0) ||
    (progress.unit !== undefined &&
      progress.unit !== "bytes" &&
      progress.unit !== "count")
  ) {
    return null;
  }
  return Object.freeze({
    completed: progress.completed as number,
    stage: progress.stage.trim().slice(0, 64),
    total: progress.total as number,
    ...(progress.unit === undefined ? {} : { unit: progress.unit }),
  });
}

function normalizeSpeechOwner(value: unknown): BatchSpeechOwner | null {
  if (typeof value !== "object" || value === null) return null;
  const owner = value as Partial<BatchSpeechOwner>;
  const identifiers = [owner.acquisitionId, owner.taskId];
  if (
    identifiers.some(
      (identifier) =>
        typeof identifier !== "string" ||
        identifier.length === 0 ||
        identifier.length > 128 ||
        !/^[A-Za-z0-9._:-]+$/.test(identifier),
    ) ||
    !isVideoKey(owner.videoKey)
  ) {
    return null;
  }
  return Object.freeze({
    acquisitionId: owner.acquisitionId as string,
    taskId: owner.taskId as string,
    videoKey: owner.videoKey as VideoKey,
  });
}

export function createBatchJob(input: BatchJob): BatchJob {
  assertNonEmptyString(input.batchJobId, "batchJobId");
  assertNonEmptyString(input.browserSessionId, "browserSessionId");
  if (
    input.method !== undefined &&
    input.method !== "direct" &&
    input.method !== "speech"
  ) {
    throw new DomainValidationError("method", "batch method is unsupported");
  }
  if (input.sourceKind !== undefined)
    assertNonEmptyString(input.sourceKind, "sourceKind");
  if (input.sourceLabel !== undefined)
    assertNonEmptyString(input.sourceLabel, "sourceLabel");
  const name = input.name ?? input.sourceLabel;
  assertNonEmptyString(name, "name");
  if (!JOB_STATUSES.includes(input.status)) {
    throw new DomainValidationError(
      "status",
      "batch job status is unsupported",
    );
  }
  assertNonNegativeSafeInteger(input.createdAt, "createdAt");
  assertNonNegativeSafeInteger(input.updatedAt, "updatedAt");
  if (input.updatedAt < input.createdAt) {
    throw new DomainValidationError(
      "updatedAt",
      "updatedAt cannot precede createdAt",
    );
  }
  return Object.freeze({
    batchJobId: input.batchJobId.trim(),
    browserSessionId: input.browserSessionId.trim(),
    createdAt: input.createdAt,
    ...(input.method === undefined ? {} : { method: input.method }),
    name: name.trim().slice(0, 200),
    ...(input.sourceKind === undefined
      ? {}
      : { sourceKind: input.sourceKind.trim() }),
    ...(input.sourceLabel === undefined
      ? {}
      : { sourceLabel: input.sourceLabel.trim().slice(0, 200) }),
    status: input.status,
    updatedAt: input.updatedAt,
  });
}

function legacySpeechLanguage(
  selectedLanguage: string | null | undefined,
): SubtitleLanguageMode {
  const normalized = selectedLanguage?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("zh")) return "zh";
  if (normalized.startsWith("en")) return "en";
  if (normalized === "other") return "other";
  return "mixed";
}

export function createBatchItem(
  input: BatchItem,
  defaultSpeechLanguageMode: SubtitleLanguageMode = "mixed",
): BatchItem {
  assertNonEmptyString(input.batchItemId, "batchItemId");
  assertNonEmptyString(input.batchJobId, "batchJobId");
  if (!/^BV[0-9A-Za-z]{10}$/.test(input.bvid)) {
    throw new DomainValidationError("bvid", "batch item bvid is invalid");
  }
  if (
    input.aid !== undefined &&
    input.aid !== null &&
    (!Number.isSafeInteger(input.aid) || input.aid <= 0)
  ) {
    throw new DomainValidationError("aid", "batch item aid is invalid");
  }
  if (
    input.cid !== undefined &&
    input.cid !== null &&
    (!Number.isSafeInteger(input.cid) || input.cid <= 0)
  ) {
    throw new DomainValidationError("cid", "batch item cid is invalid");
  }
  assertNullableNonEmptyString(input.errorCode, "errorCode");
  assertNonNegativeSafeInteger(input.order, "order");
  if (!Number.isSafeInteger(input.page) || input.page <= 0) {
    throw new DomainValidationError("page", "batch item page is invalid");
  }
  assertNonNegativeSafeInteger(input.rowCount, "rowCount");
  if (typeof input.selected !== "boolean") {
    throw new DomainValidationError("selected", "batch selection is invalid");
  }
  if (!ITEM_STATUSES.includes(input.status)) {
    throw new DomainValidationError(
      "status",
      "batch item status is unsupported",
    );
  }
  assertNonEmptyString(input.title, "title");
  assertNullableNonEmptyString(input.trackId, "trackId");
  if (input.author !== undefined && typeof input.author !== "string") {
    throw new DomainValidationError("author", "batch item author is invalid");
  }
  if (
    input.publishedAt !== undefined &&
    input.publishedAt !== null &&
    (!Number.isSafeInteger(input.publishedAt) || input.publishedAt < 0)
  ) {
    throw new DomainValidationError(
      "publishedAt",
      "batch item publication time is invalid",
    );
  }
  assertNullableNonEmptyString(
    input.selectedLanguage === undefined ? null : input.selectedLanguage,
    "selectedLanguage",
  );
  assertNullableNonEmptyString(
    input.selectedTrackId === undefined ? null : input.selectedTrackId,
    "selectedTrackId",
  );
  if (
    input.speechLanguageMode !== undefined &&
    input.speechLanguageMode !== "zh" &&
    input.speechLanguageMode !== "en" &&
    input.speechLanguageMode !== "other" &&
    input.speechLanguageMode !== "mixed" &&
    input.speechLanguageMode !== "ja"
  ) {
    throw new DomainValidationError(
      "speechLanguageMode",
      "batch speech language mode is invalid",
    );
  }
  if (input.retryable !== undefined && typeof input.retryable !== "boolean") {
    throw new DomainValidationError(
      "retryable",
      "batch item retry state is invalid",
    );
  }
  if (
    input.acquisitionMethod !== undefined &&
    input.acquisitionMethod !== null &&
    input.acquisitionMethod !== "direct" &&
    input.acquisitionMethod !== "speech"
  ) {
    throw new DomainValidationError(
      "acquisitionMethod",
      "batch item acquisition method is invalid",
    );
  }
  if (
    input.tracksDiscovered !== undefined &&
    typeof input.tracksDiscovered !== "boolean"
  ) {
    throw new DomainValidationError(
      "tracksDiscovered",
      "batch item discovery state is invalid",
    );
  }
  assertNonNegativeSafeInteger(input.updatedAt, "updatedAt");
  if (input.videoKey !== null && !isVideoKey(input.videoKey)) {
    throw new DomainValidationError("videoKey", "videoKey must be canonical");
  }
  if (input.status !== "failed" && input.errorCode !== null) {
    throw new DomainValidationError(
      "errorCode",
      "only a failed batch item has an error code",
    );
  }
  if (input.status === "failed" && input.errorCode === null) {
    throw new DomainValidationError(
      "errorCode",
      "a failed batch item requires an error code",
    );
  }
  const speechOwner = normalizeSpeechOwner(input.speechOwner);
  if (
    speechOwner !== null &&
    input.videoKey !== null &&
    speechOwner.videoKey !== input.videoKey
  ) {
    throw new DomainValidationError(
      "speechOwner",
      "speech owner must match the batch item identity",
    );
  }
  return Object.freeze({
    acquisitionMethod: input.acquisitionMethod ?? null,
    aid: input.aid ?? null,
    author: input.author?.trim().slice(0, 100) ?? "",
    availableTracks: normalizeTrackOptions(input.availableTracks),
    batchItemId: input.batchItemId.trim(),
    batchJobId: input.batchJobId.trim(),
    bvid: input.bvid,
    cid: input.cid ?? null,
    errorCode: input.errorCode?.trim() ?? null,
    order: input.order,
    page: input.page,
    progress: normalizeProgress(input.progress),
    publishedAt: input.publishedAt ?? null,
    rowCount: input.rowCount,
    selected: input.selected,
    selectedLanguage: input.selectedLanguage?.trim().slice(0, 32) ?? null,
    selectedTrackId: input.selectedTrackId?.trim().slice(0, 200) ?? null,
    speechLanguageMode:
      input.speechLanguageMode ??
      (input.selectedLanguage
        ? legacySpeechLanguage(input.selectedLanguage)
        : defaultSpeechLanguageMode),
    speechOwner,
    status: input.status,
    title: input.title.trim().slice(0, 200),
    trackId: input.trackId?.trim() ?? null,
    tracksDiscovered: input.tracksDiscovered ?? false,
    retryable: input.retryable ?? input.status === "failed",
    updatedAt: input.updatedAt,
    videoKey: input.videoKey,
  });
}

/**
 * Reads a persisted BatchItem during the expand phase. Selection is command UI
 * state and must not survive reload; the legacy language is mapped once to the
 * explicit speech request language and then retired: it no longer drives the
 * direct-subtitle track preference (spec §8).
 */
export function readBatchItemFromStored(
  value: unknown,
  defaultSpeechLanguageMode: SubtitleLanguageMode = "mixed",
): BatchItem {
  const stored = value as Partial<BatchItem>;
  const legacy = stored.selectedLanguage;
  const speechLanguageMode =
    stored.speechLanguageMode ??
    (legacy === undefined || legacy === null
      ? defaultSpeechLanguageMode
      : legacySpeechLanguage(legacy));
  return createBatchItem(
    {
      ...(value as BatchItem),
      selected: false,
      selectedLanguage: null,
      speechLanguageMode,
    },
    defaultSpeechLanguageMode,
  );
}
