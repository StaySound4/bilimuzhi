import type {
  GroqRoutingMode,
  GroqWhisperModel,
} from "../../application/asr-contract";

const TURBO: GroqWhisperModel = "whisper-large-v3-turbo";
const STANDARD: GroqWhisperModel = "whisper-large-v3";

export function getGroqRoutingCandidates(input: {
  readonly blockedUntilByModel?: Readonly<
    Partial<Record<GroqWhisperModel, number>>
  >;
  readonly chunkIndex: number;
  readonly mode: GroqRoutingMode;
  readonly now: number;
}): readonly GroqWhisperModel[] {
  const ordered =
    input.mode === "standard-first"
      ? [STANDARD, TURBO]
      : input.mode === "balanced" && input.chunkIndex % 2 === 1
        ? [STANDARD, TURBO]
        : [TURBO, STANDARD];
  return Object.freeze(
    ordered.filter(
      (model) => (input.blockedUntilByModel?.[model] ?? 0) <= input.now,
    ),
  );
}

export function parseRetryAfterSeconds(value: string | null): number {
  const text = value?.trim() ?? "";
  if (!text) return 0;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) return Math.ceil(numeric);
  let total = 0;
  for (const match of text.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*(ms|s|m|h)/gi)) {
    const amount = Number(match[1]);
    const unit = match[2]?.toLowerCase();
    total +=
      unit === "ms"
        ? amount / 1_000
        : unit === "m"
          ? amount * 60
          : unit === "h"
            ? amount * 3_600
            : amount;
  }
  return total > 0 ? Math.ceil(total) : 0;
}
