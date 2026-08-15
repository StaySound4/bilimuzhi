import type { SubtitleRow } from "./subtitle";
import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";

export type BatchSubtitleSource = "official" | "ai" | "speech";

/**
 * The independently-owned subtitle payload for one batch item. Deliberately
 * excludes Session/branch ownership, credentials, media URLs and provider
 * responses.
 */
export interface BatchSubtitle {
  readonly batchItemId: string;
  readonly language: string;
  readonly rows: readonly SubtitleRow[];
  readonly source: BatchSubtitleSource;
  readonly trackId: string | null;
  readonly updatedAt: number;
}

function normalizeRows(value: unknown): readonly SubtitleRow[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainValidationError(
      "rows",
      "a batch subtitle requires at least one row",
    );
  }
  let previousStart = -1;
  return Object.freeze(
    value.map((candidate, index) => {
      if (typeof candidate !== "object" || candidate === null) {
        throw new DomainValidationError(
          "rows",
          "batch subtitle row is invalid",
        );
      }
      const row = candidate as Partial<SubtitleRow>;
      if (
        !Number.isSafeInteger(row.startMs) ||
        !Number.isSafeInteger(row.endMs) ||
        (row.startMs ?? -1) < 0 ||
        (row.endMs ?? -1) <= (row.startMs ?? -1) ||
        typeof row.text !== "string" ||
        row.text.trim().length === 0 ||
        (row.startMs as number) < previousStart
      ) {
        throw new DomainValidationError(
          `rows[${index}]`,
          "batch subtitle row is invalid",
        );
      }
      previousStart = row.startMs as number;
      return Object.freeze({
        endMs: row.endMs as number,
        startMs: row.startMs as number,
        text: row.text.trim(),
      });
    }),
  );
}

export function createBatchSubtitle(input: BatchSubtitle): BatchSubtitle {
  assertNonEmptyString(input.batchItemId, "batchItemId");
  assertNonEmptyString(input.language, "language");
  if (
    input.source !== "official" &&
    input.source !== "ai" &&
    input.source !== "speech"
  ) {
    throw new DomainValidationError(
      "source",
      "batch subtitle source is unsupported",
    );
  }
  if (input.trackId !== null) assertNonEmptyString(input.trackId, "trackId");
  if (input.source === "speech" && input.trackId !== null) {
    throw new DomainValidationError(
      "trackId",
      "a speech batch subtitle cannot own a remote track",
    );
  }
  if (input.source !== "speech" && input.trackId === null) {
    throw new DomainValidationError(
      "trackId",
      "a direct batch subtitle requires a stable track",
    );
  }
  assertNonNegativeSafeInteger(input.updatedAt, "updatedAt");
  return Object.freeze({
    batchItemId: input.batchItemId.trim(),
    language: input.language.trim().slice(0, 32),
    rows: normalizeRows(input.rows),
    source: input.source,
    trackId: input.trackId?.trim().slice(0, 200) ?? null,
    updatedAt: input.updatedAt,
  });
}
