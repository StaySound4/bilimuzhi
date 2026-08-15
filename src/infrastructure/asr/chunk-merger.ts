import type { SubtitleRow } from "../../domain";
import {
  ASR_BOUNDARY_MERGE_GAP_MS,
  ASR_PLAIN_TEXT_DEDUP_WINDOW,
} from "../../application/asr-contract";

function normalizeText(value: string): string {
  return value
    .replace(/\s+/g, "")
    .replace(/[。！？!?；;，,、…"'“”‘’（）()【】《》<>]/g, "")
    .replace(/[[\]]/g, "")
    .trim()
    .toLowerCase();
}

export function mergeTimestampedChunkRows(
  existingRows: readonly SubtitleRow[],
  chunkRows: readonly SubtitleRow[],
  chunkStartMs: number,
  overlapMs: number,
): readonly SubtitleRow[] {
  const merged = existingRows.map((row) => ({ ...row }));
  for (const row of chunkRows) {
    if (chunkStartMs > 0 && row.endMs <= overlapMs) continue;
    const relativeStart =
      chunkStartMs > 0 ? Math.max(row.startMs, overlapMs) : row.startMs;
    const relativeEnd =
      chunkStartMs > 0 ? Math.max(row.endMs, overlapMs) : row.endMs;
    const next = {
      endMs: chunkStartMs + Math.max(relativeStart + 1, relativeEnd),
      startMs: chunkStartMs + Math.max(0, relativeStart),
      text: row.text.trim(),
    };
    if (!next.text) continue;
    const previous = merged.at(-1);
    if (
      previous &&
      normalizeText(previous.text) === normalizeText(next.text) &&
      Math.abs(previous.endMs - next.startMs) <= ASR_BOUNDARY_MERGE_GAP_MS
    ) {
      previous.endMs = Math.max(previous.endMs, next.endMs);
      continue;
    }
    merged.push(next);
  }
  return Object.freeze(merged.map((row) => Object.freeze(row)));
}

export function mergePlainTextRows(
  existingParagraphs: readonly string[],
  incomingParagraphs: readonly string[],
): readonly string[] {
  const maximum = Math.min(
    ASR_PLAIN_TEXT_DEDUP_WINDOW,
    existingParagraphs.length,
    incomingParagraphs.length,
  );
  let overlap = 0;
  for (let size = maximum; size >= 1; size -= 1) {
    const tail = existingParagraphs.slice(-size).map(normalizeText);
    const head = incomingParagraphs.slice(0, size).map(normalizeText);
    if (tail.every((text, index) => text.length > 0 && text === head[index])) {
      overlap = size;
      break;
    }
  }
  return Object.freeze([
    ...existingParagraphs,
    ...incomingParagraphs.slice(overlap),
  ]);
}
