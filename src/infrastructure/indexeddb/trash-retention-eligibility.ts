import type { BranchPlacement } from "../../domain";

export interface ExpiredTrashPlacement {
  readonly branchId: string;
  readonly purgeAfter: number;
  readonly sessionId: string;
}

export function selectExpiredTrashPlacements(
  placements: readonly BranchPlacement[],
  now: number,
): readonly ExpiredTrashPlacement[] {
  return Object.freeze(
    placements
      .flatMap((placement) =>
        placement.location === "trash" &&
        placement.purgeAfter !== null &&
        placement.purgeAfter <= now
          ? [
              Object.freeze({
                branchId: placement.branchId,
                purgeAfter: placement.purgeAfter,
                sessionId: placement.sessionId,
              }),
            ]
          : [],
      )
      .sort(
        (left, right) =>
          left.purgeAfter - right.purgeAfter ||
          left.branchId.localeCompare(right.branchId),
      ),
  );
}

export function selectNextTrashPurgeAt(
  placements: readonly BranchPlacement[],
): number | null {
  let next: number | null = null;
  for (const placement of placements) {
    if (placement.location !== "trash" || placement.purgeAfter === null) {
      continue;
    }
    if (next === null || placement.purgeAfter < next) {
      next = placement.purgeAfter;
    }
  }
  return next;
}
