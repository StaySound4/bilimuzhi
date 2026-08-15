import { createGenerationRun, isInFlightGenerationStatus } from "../../domain";
import type { GenerationRun } from "../../domain";

/**
 * Stops a queued or running generation run with the owner-deleted semantics:
 * the owning session/branch was removed (trash or archive), so the run cannot
 * continue and must not count as a completion. Runs in any other status are
 * left untouched.
 */
export function stopActiveGenerationRun(
  value: unknown,
  now: number,
): GenerationRun | null {
  try {
    const run = createGenerationRun(value as GenerationRun);
    if (!isInFlightGenerationStatus(run.status)) return null;
    return createGenerationRun({
      ...run,
      completionSequence: null,
      errorCode: null,
      status: "stopped",
      stopReason: "owner-deleted",
      updatedAt: Math.max(now, run.updatedAt),
    });
  } catch {
    // Legacy subtitle-acquisition runs have a separate contract and can only
    // create a branch after they have already completed.
    return null;
  }
}
