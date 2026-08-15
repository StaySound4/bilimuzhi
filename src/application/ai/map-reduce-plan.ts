import type { SubtitleContextPlan } from "./context-plan";

export interface MapReduceRecoveryPlan {
  readonly completedChunkIndexes: readonly number[];
  readonly pendingChunkIndexes: readonly number[];
  readonly readyToReduce: boolean;
}

export function createMapReduceRecoveryPlan(
  contextPlan: SubtitleContextPlan,
  completedChunkIndexes: readonly number[],
): MapReduceRecoveryPlan {
  if (contextPlan.strategy !== "map-reduce") {
    throw new Error("Map-reduce recovery requires a map-reduce context plan");
  }
  const completed = new Set<number>();
  for (const index of completedChunkIndexes) {
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= contextPlan.chunks.length ||
      completed.has(index)
    ) {
      throw new Error("The completed map-reduce chunk index is invalid");
    }
    completed.add(index);
  }
  const completedSorted = [...completed].sort((left, right) => left - right);
  const pending = contextPlan.chunks.flatMap((_, index) =>
    completed.has(index) ? [] : [index],
  );
  return Object.freeze({
    completedChunkIndexes: Object.freeze(completedSorted),
    pendingChunkIndexes: Object.freeze(pending),
    readyToReduce: pending.length === 0,
  });
}
