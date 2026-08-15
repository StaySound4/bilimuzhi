import type { VideoKey } from "./video";
import { isVideoKey } from "./video";
import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";

export type SubtitleSource = "bilibili" | "groq-whisper";
export type SubtitleSnapshotStatus = "staged" | "active";

export type SubtitleTrackOrigin = "official-cc" | "ai" | "user-upload";
export interface SubtitleRow {
  /** Stable source-line identity used by structured AI artifacts. */
  readonly lineId?: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

export interface SubtitleSnapshot {
  readonly subtitleId: string;
  readonly sessionId: string;
  readonly branchId: string;
  readonly videoKey: VideoKey;
  readonly source: SubtitleSource;
  readonly language: string;
  readonly trackOrigin?: SubtitleTrackOrigin;
  readonly contentHash: string;
  readonly rows: readonly SubtitleRow[];
  readonly status: SubtitleSnapshotStatus;
  readonly createdAt: number;
}

export interface CreateSubtitleSnapshotInput extends Omit<
  SubtitleSnapshot,
  "rows"
> {
  readonly rows: readonly SubtitleRow[];
}

function createSubtitleRow(
  input: SubtitleRow,
  previousStartMs: number,
): SubtitleRow {
  assertNonNegativeSafeInteger(input.startMs, "rows.startMs");
  assertNonNegativeSafeInteger(input.endMs, "rows.endMs");
  if (input.endMs <= input.startMs) {
    throw new DomainValidationError(
      "rows.endMs",
      "subtitle end must follow its start",
    );
  }
  if (input.startMs < previousStartMs) {
    throw new DomainValidationError(
      "rows",
      "subtitle rows must be sorted by startMs",
    );
  }
  assertNonEmptyString(input.text, "rows.text");
  if (input.lineId !== undefined) {
    assertNonEmptyString(input.lineId, "rows.lineId");
  }

  return Object.freeze({
    ...(input.lineId === undefined ? {} : { lineId: input.lineId.trim() }),
    startMs: input.startMs,
    endMs: input.endMs,
    text: input.text.trim(),
  });
}

export function createSubtitleSnapshot(
  input: CreateSubtitleSnapshotInput,
): SubtitleSnapshot {
  assertNonEmptyString(input.subtitleId, "subtitleId");
  assertNonEmptyString(input.sessionId, "sessionId");
  assertNonEmptyString(input.branchId, "branchId");
  if (!isVideoKey(input.videoKey)) {
    throw new DomainValidationError("videoKey", "videoKey must be canonical");
  }
  if (input.source !== "bilibili" && input.source !== "groq-whisper") {
    throw new DomainValidationError("source", "source is unsupported");
  }
  assertNonEmptyString(input.language, "language");
  if (
    input.trackOrigin !== undefined &&
    input.trackOrigin !== "official-cc" &&
    input.trackOrigin !== "ai" &&
    input.trackOrigin !== "user-upload"
  ) {
    throw new DomainValidationError(
      "trackOrigin",
      "trackOrigin is unsupported",
    );
  }
  assertNonEmptyString(input.contentHash, "contentHash");
  if (input.status !== "staged" && input.status !== "active") {
    throw new DomainValidationError("status", "status is unsupported");
  }
  assertNonNegativeSafeInteger(input.createdAt, "createdAt");
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new DomainValidationError(
      "rows",
      "subtitle snapshot must contain rows",
    );
  }

  let previousStartMs = -1;
  const rows = input.rows.map((row) => {
    const normalized = createSubtitleRow(row, previousStartMs);
    previousStartMs = normalized.startMs;
    return normalized;
  });

  return Object.freeze({
    subtitleId: input.subtitleId.trim(),
    sessionId: input.sessionId.trim(),
    branchId: input.branchId.trim(),
    videoKey: input.videoKey,
    source: input.source,
    language: input.language.trim(),
    ...(input.trackOrigin === undefined
      ? {}
      : { trackOrigin: input.trackOrigin }),
    contentHash: input.contentHash.trim(),
    rows: Object.freeze(rows),
    status: input.status,
    createdAt: input.createdAt,
  });
}
