export interface TimeMarkerSubtitleRow {
  readonly endMs: number;
  readonly lineId?: string;
  readonly startMs: number;
}

export interface TimeMarkerValidationScope {
  readonly activeVideoKey: string;
  readonly subtitleVideoKey: string;
}

export interface ValidatedTimeMarker {
  readonly endSeconds: number;
  readonly kind: "point" | "range";
  readonly label: string;
  /** 导航始终使用起点；范围的完整文字由 label 保留。 */
  readonly seconds: number;
}

/**
 * 紧凑时间 token 的共享正则片段（如 1h2m3s / 3m48s / 25s），
 * 供 application 层验证解析与 UI 层渲染匹配复用，避免两处正则漂移。
 */
export const COMPACT_TIME_TOKEN_PATTERN = "(?:\\d+h)?(?:\\d+m)?\\d+s";

/** 紧凑时间范围 token：起点与可选的 [–-] 终点，如 5m38s–6m45s。 */
export const COMPACT_TIME_RANGE_PATTERN = `${COMPACT_TIME_TOKEN_PATTERN}(?:[–-]${COMPACT_TIME_TOKEN_PATTERN})?`;

/** 时钟时间范围 token：如 00:45 / 01:23–01:45 / 01:02:03（渲染归一化后文本）。 */
export const CLOCK_TIME_RANGE_PATTERN =
  "(?:(?:\\d{1,2}:)?\\d{1,2}:\\d{2})(?:[–-](?:(?:\\d{1,2}:)?\\d{1,2}:\\d{2}))?";

/**
 * 把秒数格式化为补零时钟标签（切片 9 渲染归一化）：
 * `<60s → 00:45`、`<3600s → 01:23`、`≥3600s → 01:02:03`，与播放器时间一致。
 * 解析侧保持紧凑 + 时钟双格式兼容（parseTimeSeconds），显示压缩由前端完成。
 */
export function compactTimeLabel(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainingSeconds = safe % 60;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(remainingSeconds)}`
    : `${pad(minutes)}:${pad(remainingSeconds)}`;
}

function parseCompactSeconds(value: string): number | null {
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(\d+)s$/u.exec(value);
  if (match === null) return null;
  const hasHours = match[1] !== undefined;
  const hasMinutes = match[2] !== undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3]);
  if (
    !Number.isSafeInteger(hours) ||
    !Number.isSafeInteger(minutes) ||
    !Number.isSafeInteger(seconds) ||
    seconds < 0 ||
    // 用户确认的语法：s/m 前面的数字不得大于 60，h 不限。
    seconds > 60 ||
    minutes < 0 ||
    minutes > 60 ||
    (hasHours && hours <= 0) ||
    (!hasHours && hasMinutes && minutes <= 0)
  ) {
    return null;
  }
  const total = hours * 3_600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) ? total : null;
}

function parseCompatibleClockSeconds(value: string): number | null {
  if (!/^(?:\d{1,2}:)?\d{1,2}:\d{2}$/u.test(value)) return null;
  const parts = value.split(":").map(Number);
  const seconds = parts.at(-1);
  const minutes = parts.at(-2);
  const hours = parts.length === 3 ? parts[0] : 0;
  if (
    seconds === undefined ||
    minutes === undefined ||
    !Number.isSafeInteger(hours) ||
    !Number.isSafeInteger(minutes) ||
    !Number.isSafeInteger(seconds) ||
    hours < 0 ||
    minutes < 0 ||
    seconds < 0 ||
    seconds >= 60 ||
    (parts.length === 3 && minutes >= 60)
  ) {
    return null;
  }
  const total = hours * 3_600 + minutes * 60 + seconds;
  return Number.isSafeInteger(total) ? total : null;
}

export function parseTimeSeconds(value: string): number | null {
  return parseCompactSeconds(value) ?? parseCompatibleClockSeconds(value);
}

/**
 * 从 Markdown/流式正文中提取已经闭合且由当前字幕范围证明的时间标记。
 * 未闭合尾片段不会参与匹配，因此跨 chunk 追加时不会与前一个标记黏连。
 */
export function deriveValidatedTimeMarkers(
  text: string,
  rows: readonly TimeMarkerSubtitleRow[],
  scope?: TimeMarkerValidationScope,
): readonly ValidatedTimeMarker[] {
  if (
    scope === undefined ||
    scope.activeVideoKey.length === 0 ||
    scope.subtitleVideoKey.length === 0 ||
    scope.activeVideoKey !== scope.subtitleVideoKey
  ) {
    return Object.freeze([]);
  }
  const validRows = rows.filter(
    (row) =>
      Number.isSafeInteger(row.startMs) &&
      Number.isSafeInteger(row.endMs) &&
      row.startMs >= 0 &&
      row.endMs >= row.startMs,
  );
  const withinSubtitleRange = (seconds: number): boolean => {
    const bucketStartMs = seconds * 1_000;
    const bucketEndMs = bucketStartMs + 1_000;
    return (
      Number.isSafeInteger(seconds) &&
      seconds >= 0 &&
      Number.isSafeInteger(bucketStartMs) &&
      Number.isSafeInteger(bucketEndMs) &&
      validRows.some(
        (row) => row.startMs < bucketEndMs && row.endMs > bucketStartMs,
      )
    );
  };
  const markers = new Map<string, ValidatedTimeMarker>();
  const occupiedRanges: Array<readonly [number, number]> = [];
  for (const match of text.matchAll(/\[([^\]\n]+)\](?!\()/gu)) {
    const label = match[1];
    occupiedRanges.push([match.index, match.index + match[0].length]);
    const line = validRows.find((row, index) => {
      const lineId = row.lineId?.trim() || `line-${index}`;
      return lineId === label;
    });
    if (line !== undefined) {
      const seconds = Math.floor(line.startMs / 1_000);
      markers.set(
        label,
        Object.freeze({
          endSeconds: seconds,
          kind: "point",
          label,
          seconds,
        }),
      );
      continue;
    }
    const range = /^(.+?)[–-](.+)$/u.exec(label);
    const start = parseTimeSeconds(range?.[1] ?? label);
    const end = range === null ? start : parseTimeSeconds(range[2]);
    if (
      start === null ||
      end === null ||
      end < start ||
      !withinSubtitleRange(start) ||
      !withinSubtitleRange(end)
    ) {
      continue;
    }
    markers.set(
      label,
      Object.freeze({
        endSeconds: end,
        kind: range === null ? "point" : "range",
        label,
        seconds: start,
      }),
    );
  }

  // 兼容 provider 输出省略方括号的裸时间标记：紧凑与时钟双格式
  // （契约 t34：解析侧保持双格式兼容）。先匹配范围再匹配单点，
  // 防止一个范围被拆成两个独立单点。
  const barePattern =
    /(?<![\p{L}\p{N}[])((?:(?:(?:\d+h)?(?:\d+m)?\d+s)|(?:(?:\d{1,2}:)?\d{1,2}:\d{2}))(?:[–-](?:(?:(?:\d+h)?(?:\d+m)?\d+s)|(?:(?:\d{1,2}:)?\d{1,2}:\d{2})))?)(?![\p{L}\p{N}\]])/gu;
  for (const match of text.matchAll(barePattern)) {
    const startIndex = match.index;
    const endIndex = startIndex + match[0].length;
    if (
      occupiedRanges.some(
        ([occupiedStart, occupiedEnd]) =>
          startIndex < occupiedEnd && endIndex > occupiedStart,
      )
    ) {
      continue;
    }
    const label = match[1];
    const range = /^(.+?)[–-](.+)$/u.exec(label);
    const start = parseTimeSeconds(range?.[1] ?? label);
    const end = range === null ? start : parseTimeSeconds(range[2]);
    if (
      start === null ||
      end === null ||
      end < start ||
      !withinSubtitleRange(start) ||
      !withinSubtitleRange(end)
    ) {
      continue;
    }
    markers.set(
      label,
      Object.freeze({
        endSeconds: end,
        kind: range === null ? "point" : "range",
        label,
        seconds: start,
      }),
    );
  }
  return Object.freeze([...markers.values()]);
}

/** 渲染侧消费的轻量时间链接：只保留 label 与导航起点。 */
export interface ValidatedMarkdownTimeLink {
  readonly label: string;
  readonly seconds: number;
}

export type MarkdownTimeLinkValidationScope = TimeMarkerValidationScope;

/**
 * 只把落在当前字幕时间线内的闭合时钟标记转换为可跳转句柄。
 * provider 产出的时钟在跨视频或离开所属时间线时绝不可信，
 * 未完成的流式标记保持普通文字。
 */
export function deriveValidatedMarkdownTimeLinks(
  text: string,
  rows: readonly TimeMarkerSubtitleRow[],
  scope?: MarkdownTimeLinkValidationScope,
): readonly ValidatedMarkdownTimeLink[] {
  return Object.freeze(
    deriveValidatedTimeMarkers(text, rows, scope).map(({ label, seconds }) =>
      Object.freeze({ label, seconds }),
    ),
  );
}
