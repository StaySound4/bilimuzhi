import {
  DomainValidationError,
  assertNonNegativeSafeInteger,
  assertPositiveSafeInteger,
} from "./validation";

export const TRASH_RETENTION_PRESET_DAYS = [7, 30, 365] as const;
export const DEFAULT_TRASH_RETENTION_POLICY: TrashRetentionPolicy =
  Object.freeze({ durationDays: 7, kind: "duration" });
export const TRASH_RETENTION_DAY_MS = 24 * 60 * 60 * 1_000;

export type TrashRetentionApplyMode = "apply-to-existing" | "future-only";

export type TrashRetentionPolicy =
  | { readonly kind: "duration"; readonly durationDays: number }
  | { readonly kind: "forever" };

export function createTrashRetentionPolicy(
  input: TrashRetentionPolicy,
): TrashRetentionPolicy {
  if (input.kind === "forever") {
    return Object.freeze({ kind: "forever" });
  }
  if (input.kind !== "duration") {
    throw new DomainValidationError(
      "kind",
      "trash retention kind is unsupported",
    );
  }
  assertPositiveSafeInteger(input.durationDays, "durationDays");
  return Object.freeze({ durationDays: input.durationDays, kind: "duration" });
}

export function calculateTrashPurgeAfter(
  retentionStartedAt: number,
  policy: TrashRetentionPolicy,
): number | null {
  assertNonNegativeSafeInteger(retentionStartedAt, "retentionStartedAt");
  const normalized = createTrashRetentionPolicy(policy);
  if (normalized.kind === "forever") return null;
  const durationMs = normalized.durationDays * TRASH_RETENTION_DAY_MS;
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new DomainValidationError(
      "durationDays",
      "trash retention duration is unsupported",
    );
  }
  const purgeAfter = retentionStartedAt + durationMs;
  if (!Number.isSafeInteger(purgeAfter)) {
    throw new DomainValidationError(
      "retentionStartedAt",
      "trash retention expiry is unsupported",
    );
  }
  return purgeAfter;
}
