import type { ArtifactKind, ArtifactSegment, SubtitleRow } from "../../domain";
import { createArtifactSegment } from "../../domain";
import type { SubtitleContextChunk, SubtitleContextPlan } from "./context-plan";
import type { AiPromptMessage } from "./provider-contract";
import { buildTaskPrompt } from "./prompt-builder";
import { ADVERTISEMENT_TITLE_KEYWORDS } from "./prompt-language-pack";

export type ArtifactPromptStage = "single" | "map" | "reduce";

export interface CreateArtifactPromptInput {
  readonly applicationMetadata: Readonly<
    Record<string, string | number | boolean>
  >;
  readonly kind: ArtifactKind;
  readonly reference: string;
  readonly stage: ArtifactPromptStage;
  readonly userInstruction: string | null;
}

function stageRequest(stage: ArtifactPromptStage): string {
  if (stage === "map") {
    return "只分析当前字幕分块，并输出可由同一严格校验器验证的分块结果。";
  }
  if (stage === "reduce") {
    return "把各分块草稿合并为一份完整、连续、不重叠的最终结果。";
  }
  return "请现在开始输出完整结果。";
}

/**
 * Compatibility facade for callers that still construct an artifact prompt
 * directly. It deliberately delegates to the one shared task-prompt runtime;
 * there is no independent artifact system prompt or permissive output path.
 */
export function createArtifactPrompt(
  input: CreateArtifactPromptInput,
): readonly AiPromptMessage[] {
  if (typeof input.reference !== "string" || input.reference.length === 0) {
    throw new Error("The artifact prompt reference is empty");
  }
  const extra = input.userInstruction?.trim() ?? "";
  // The compatibility echo remains inside the untrusted reference solely so
  // older diagnostics can identify the originating request. The executable
  // copy is the earlier one-shot request layer produced by buildTaskPrompt.
  const reference =
    extra.length === 0
      ? input.reference
      : `${input.reference}\n\n用户附加要求：\n${extra}`;
  const row: SubtitleRow = Object.freeze({
    endMs: 1,
    lineId: "line-0",
    startMs: 0,
    text: reference,
  });
  const chunk: SubtitleContextChunk = Object.freeze({
    endMs: row.endMs,
    rowIndexes: Object.freeze([0]),
    startMs: row.startMs,
    text: reference,
  });
  const contextPlan: SubtitleContextPlan = Object.freeze({
    characterBudget: Math.max(64, reference.length),
    chunks: Object.freeze([chunk]),
    explanation: "compatibility caller supplied an explicit reference",
    strategy: "full",
  });
  const metadata = input.applicationMetadata;
  const rawBvid = metadata.bvid;
  const rawDuration = metadata.durationSec;
  const rawTitle = metadata.videoTitle ?? metadata.title;
  return buildTaskPrompt({
    contextPlan,
    kind: input.kind,
    meta: {
      bvid:
        typeof rawBvid === "string" && /^BV[A-Za-z0-9]{10}$/.test(rawBvid)
          ? rawBvid
          : "BV1xx411c7mD",
      durationSec:
        typeof rawDuration === "number" && Number.isFinite(rawDuration)
          ? rawDuration
          : null,
      title:
        typeof rawTitle === "string" && rawTitle.trim().length > 0
          ? rawTitle.trim()
          : "视频字幕",
    },
    question: [extra, stageRequest(input.stage)]
      .filter((part) => part.length > 0)
      .join("\n"),
    rows: [row],
  });
}

export function formatChunkReference(
  chunks: readonly SubtitleContextChunk[],
): string {
  return chunks.map((chunk) => chunk.text).join("\n\n");
}

const TIME_RANGE_PATTERN =
  /\[(\d{1,2}):(\d{2})(?::(\d{2}))?\s*-\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*([^\n]*)/;

// 宽松变体：部分模型输出 `**时间：00:00:00–00:00:05**`（Markdown 风格），
// 只提取时间范围本身，标题取上一非空行。
const LOOSE_TIME_LINE_PATTERN = /^\s*\*{0,2}\s*时间\s*[:：]/;
const LOOSE_TIME_RANGE_PATTERN =
  /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*[–-]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/;
function parseTimeToken(
  first: string,
  second: string,
  third: string | null | undefined,
): number {
  // 无秒组时按 mm:ss（first 分钟、second 秒）；有秒组按 hh:mm:ss。
  if (third === undefined || third === null) {
    const m = Number(first);
    const s = Number(second);
    if (!Number.isSafeInteger(m) || !Number.isSafeInteger(s) || s > 59) {
      return -1;
    }
    return (m * 60 + s) * 1_000;
  }
  const h = Number(first);
  const m = Number(second);
  const s = Number(third);
  if (
    !Number.isSafeInteger(h) ||
    !Number.isSafeInteger(m) ||
    !Number.isSafeInteger(s) ||
    m > 59 ||
    s > 59
  ) {
    return -1;
  }
  return ((h * 60 + m) * 60 + s) * 1_000;
}

function nearestRowIndex(
  targetMs: number,
  rows: readonly SubtitleRow[],
  toleranceMs: number,
  fromIndex: number,
  useRowEnd = false,
): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = fromIndex; index < rows.length; index += 1) {
    const boundary = useRowEnd ? rows[index].endMs : rows[index].startMs;
    const distance = Math.abs(boundary - targetMs);
    if (distance > toleranceMs) {
      if (best >= 0) break;
      continue;
    }
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * 分段输出契约（切片 9）：每段两行结构——
 * `[hh:mm:ss-hh:mm:ss] 标题` 与正文；时间区间为统一 `hh:mm:ss`（全程补零，
 * 模型从字幕参考原样复制、零换算）。解析器宽松：容忍围栏代码块与前后说明
 * 文字；接受 `hh:mm:ss` 与 `mm:ss` 两种时间区间；时间区间在本地字幕时间轴
 * ±2 秒内就近匹配字幕行；段落按时间顺序排列并归并空隙/重叠；无行 ID 回显。
 *
 * 解析失败时降级：原文按空行分段直接渲染为分段卡片（不抛错、不触发失败态）。
 * 仅空输出由调用方判定失败。
 */
export function parseStructuredArtifactSegments(
  output: string,
  rows: readonly SubtitleRow[],
): readonly ArtifactSegment[] {
  if (typeof output !== "string" || rows.length === 0) {
    return fallbackParagraphSegments(output);
  }
  const toleranceMs = 2_000;
  const blocks: {
    readonly detail: string;
    readonly endMs: number;
    readonly startMs: number;
    readonly title: string;
  }[] = [];
  const lines = output.split(/\n?\n/);
  let index = 0;
  while (index < lines.length) {
    let match = lines[index].match(TIME_RANGE_PATTERN);
    let title = "";
    if (match === null && LOOSE_TIME_LINE_PATTERN.test(lines[index])) {
      // `**时间：00:00:00–00:00:05**` 风格：标题取上一非空行。
      const loose = lines[index].match(LOOSE_TIME_RANGE_PATTERN);
      if (loose !== null) {
        for (let back = index - 1; back >= 0; back -= 1) {
          const candidate = lines[back].trim();
          if (candidate.length === 0) break;
          title = candidate
            .replace(/^#{1,6}\s*/, "")
            .replace(/\*\*/g, "")
            .trim();
          break;
        }
        match = loose;
      }
    }
    if (match === null) {
      index += 1;
      continue;
    }
    const startMs = parseTimeToken(match[1], match[2], match[3]);
    const endMs = parseTimeToken(match[4], match[5], match[6]);
    if (startMs < 0 || endMs <= startMs) {
      index += 1;
      continue;
    }
    const blockTitle = title || match[7].trim() || "分段";
    const detailLines: string[] = [];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim().length > 0 &&
      lines[index].match(TIME_RANGE_PATTERN) === null &&
      !LOOSE_TIME_LINE_PATTERN.test(lines[index]) &&
      !/^\s*#{1,6}\s/.test(lines[index])
    ) {
      detailLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({
      detail: detailLines.join("\n").trim(),
      endMs,
      startMs,
      title: blockTitle,
    });
  }
  if (blocks.length === 0) {
    return fallbackParagraphSegments(output);
  }

  // 时间排序 + 就近匹配字幕行（±2s）+ 重叠归并（行索引推进）。
  blocks.sort((left, right) => left.startMs - right.startMs);
  const segments: ArtifactSegment[] = [];
  let nextRowIndex = 0;
  for (const block of blocks) {
    const startIndex = nearestRowIndex(
      block.startMs,
      rows,
      toleranceMs,
      nextRowIndex,
    );
    const endIndex =
      startIndex < 0
        ? -1
        : nearestRowIndex(block.endMs, rows, toleranceMs, startIndex, true);
    if (startIndex < 0 || endIndex < 0) {
      continue;
    }
    const isAdvertisement = isAdvertisementTitle(block.title);
    segments.push(
      createArtifactSegment({
        detail: block.detail,
        endLineId: rows[endIndex].lineId,
        endMs: rows[endIndex].endMs,
        isAdvertisement,
        startLineId: rows[startIndex].lineId,
        startMs: rows[startIndex].startMs,
        title: block.title,
        type: isAdvertisement ? "advertisement" : "content",
      }),
    );
    nextRowIndex = endIndex + 1;
  }
  if (segments.length === 0) {
    return fallbackParagraphSegments(output);
  }
  return Object.freeze(segments);
}

/**
 * 降级路径：原文按空行分段直接渲染为分段卡片（不丢结果）。
 * 无时间区间时显示为按出现顺序标记的无时间卡。
 */
/**
 * 广告段判定（跨语言）：标题命中任一语言广告关键词即视为广告段。
 * 英文单独匹配 "ad" 时用词边界避免误伤 "advanced" 等词。
 */
function isAdvertisementTitle(title: string): boolean {
  const normalized = title.toLowerCase();
  return ADVERTISEMENT_TITLE_KEYWORDS.some((keyword) => {
    if (keyword === "ad") return /(?:^|[^a-z])ad(?:[^a-z]|$)/i.test(normalized);
    return normalized.includes(keyword);
  });
}

function fallbackParagraphSegments(output: string): readonly ArtifactSegment[] {
  const paragraphs = String(output)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  if (paragraphs.length === 0) return Object.freeze([]);
  return Object.freeze(
    paragraphs.slice(0, 2_000).map((paragraph, index) => {
      const isAdvertisement = isAdvertisementTitle(paragraph);
      return createArtifactSegment({
        detail: paragraph,
        endMs: 0,
        isAdvertisement,
        startMs: 0,
        title: `分段 ${index + 1}`,
        type: isAdvertisement ? "advertisement" : "content",
      });
    }),
  );
}

/** @deprecated Use parseStructuredArtifactSegments. */
export const parseArtifactSegments = parseStructuredArtifactSegments;
