import type { SubtitleRow } from "../../domain";

export type SubtitleContextStrategy = "full" | "map-reduce" | "retrieval";

export interface SubtitleContextChunk {
  readonly endMs: number;
  readonly rowIndexes: readonly number[];
  readonly startMs: number;
  readonly text: string;
}

export interface SubtitleContextPlan {
  readonly characterBudget: number;
  readonly chunks: readonly SubtitleContextChunk[];
  readonly explanation: string;
  readonly strategy: SubtitleContextStrategy;
}

export interface CreateSubtitleContextPlanInput {
  readonly characterBudget: number;
  readonly kind: "chat" | "segments" | "summary";
  readonly query: string | null;
  readonly rows: readonly SubtitleRow[];
}

function assertInput(input: CreateSubtitleContextPlanInput): void {
  if (
    !Number.isSafeInteger(input.characterBudget) ||
    input.characterBudget < 64
  ) {
    throw new Error("The subtitle context character budget is invalid");
  }
  if (
    input.kind !== "chat" &&
    input.kind !== "segments" &&
    input.kind !== "summary"
  ) {
    throw new Error("The subtitle context kind is unsupported");
  }
  if (input.query !== null && typeof input.query !== "string") {
    throw new Error("The subtitle context query is invalid");
  }
  if (!Array.isArray(input.rows) || input.rows.length === 0) {
    throw new Error("Subtitle context requires rows");
  }
}

function formatRow(row: SubtitleRow): string {
  return `[${formatClock(row.startMs)}-${formatClock(row.endMs)}] ${row.text}`;
}

export function formatClock(totalMs: number): string {
  const seconds = Math.max(0, Math.floor(totalMs / 1_000));
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3_600))}:${pad(
    Math.floor((seconds % 3_600) / 60),
  )}:${pad(seconds % 60)}`;
}

function textLength(rows: readonly SubtitleRow[]): number {
  return rows.reduce((total, row) => total + formatRow(row).length + 1, 0);
}

function termsFor(value: string): readonly string[] {
  const normalized = value.toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const cjkRuns = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  const bigrams = cjkRuns.flatMap((run) =>
    Array.from({ length: Math.max(0, run.length - 1) }, (_, index) =>
      run.slice(index, index + 2),
    ),
  );
  return Object.freeze([
    ...new Set([...words, ...bigrams].filter((term) => term.length > 0)),
  ]);
}

function createChunk(
  rows: readonly SubtitleRow[],
  indexes: readonly number[],
): SubtitleContextChunk {
  const selected = indexes.map((index) => rows[index]);
  return Object.freeze({
    endMs: selected.at(-1)?.endMs ?? 0,
    rowIndexes: Object.freeze([...indexes]),
    startMs: selected[0]?.startMs ?? 0,
    text: selected.map(formatRow).join("\n"),
  });
}

function createContiguousChunks(
  rows: readonly SubtitleRow[],
  characterBudget: number,
): readonly SubtitleContextChunk[] {
  const chunks: SubtitleContextChunk[] = [];
  let current: number[] = [];
  let currentLength = 0;
  for (const [index, row] of rows.entries()) {
    const nextLength = formatRow(row).length + 1;
    if (current.length > 0 && currentLength + nextLength > characterBudget) {
      chunks.push(createChunk(rows, current));
      current = [];
      currentLength = 0;
    }
    current.push(index);
    currentLength += nextLength;
  }
  if (current.length > 0) chunks.push(createChunk(rows, current));
  return Object.freeze(chunks);
}

function createRetrievalChunks(
  rows: readonly SubtitleRow[],
  query: string,
  characterBudget: number,
): readonly SubtitleContextChunk[] {
  const terms = termsFor(query);
  const ranked = rows
    .map((row, index) => ({
      index,
      score: terms.reduce(
        (score, term) =>
          score + Number(row.text.toLocaleLowerCase().includes(term)),
        0,
      ),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) => right.score - left.score || left.index - right.index,
    );
  const selected = new Set<number>();
  let selectedLength = 0;
  for (const match of ranked) {
    for (const index of [match.index - 1, match.index, match.index + 1]) {
      if (index < 0 || index >= rows.length || selected.has(index)) continue;
      const nextLength = formatRow(rows[index]).length + 1;
      if (selectedLength + nextLength > characterBudget) continue;
      selected.add(index);
      selectedLength += nextLength;
    }
  }
  if (selected.size === 0) {
    return Object.freeze([createChunk(rows, [0])]);
  }
  const sorted = [...selected].sort((left, right) => left - right);
  const chunks: SubtitleContextChunk[] = [];
  let current: number[] = [];
  for (const index of sorted) {
    if (current.length > 0 && index !== current.at(-1)! + 1) {
      chunks.push(createChunk(rows, current));
      current = [];
    }
    current.push(index);
  }
  if (current.length > 0) chunks.push(createChunk(rows, current));
  return Object.freeze(chunks);
}

export function createSubtitleContextPlan(
  input: CreateSubtitleContextPlanInput,
): SubtitleContextPlan {
  assertInput(input);
  if (textLength(input.rows) <= input.characterBudget) {
    return Object.freeze({
      characterBudget: input.characterBudget,
      chunks: Object.freeze([
        createChunk(
          input.rows,
          input.rows.map((_, index) => index),
        ),
      ]),
      explanation: "full subtitle fits the conservative character budget",
      strategy: "full",
    });
  }
  if (input.kind === "chat") {
    return Object.freeze({
      characterBudget: input.characterBudget,
      chunks: createRetrievalChunks(
        input.rows,
        input.query ?? "",
        input.characterBudget,
      ),
      explanation: "query-relevant subtitle rows include adjacent time context",
      strategy: "retrieval",
    });
  }
  return Object.freeze({
    characterBudget: input.characterBudget,
    chunks: createContiguousChunks(input.rows, input.characterBudget),
    explanation:
      "ordered chunks can be persisted and retried independently before reduction",
    strategy: "map-reduce",
  });
}
