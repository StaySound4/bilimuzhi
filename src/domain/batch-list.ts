import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";

export type BatchPlacementLocation = "workspace" | "archive" | "trash";

export interface WorkspaceBatchPlacement {
  readonly batchJobId: string;
  readonly order: number;
  readonly pinned: boolean;
}

export interface ArchiveBatchPlacement extends WorkspaceBatchPlacement {
  readonly archivedAt: number;
}

export interface TrashBatchPlacement extends WorkspaceBatchPlacement {
  readonly deletionReason: string;
  readonly purgeAfter: number | null;
  readonly retentionStartedAt: number;
  readonly trashedAt: number;
  readonly trashOrigin: "workspace" | "archive";
}

export interface BatchSourceHistoryEntry {
  readonly sourceHistoryId: string;
  readonly addedAt: number;
  readonly addedCount: number;
  readonly batchJobId: string;
  readonly duplicateCount: number;
  readonly sourceKey: string;
  readonly sourceKind: string;
}

function assertBoolean(value: unknown, field: string): void {
  if (typeof value !== "boolean") {
    throw new DomainValidationError(field, `${field} must be boolean`);
  }
}

function placementBase(
  input: WorkspaceBatchPlacement,
): WorkspaceBatchPlacement {
  assertNonEmptyString(input.batchJobId, "batchJobId");
  assertNonNegativeSafeInteger(input.order, "order");
  assertBoolean(input.pinned, "pinned");
  return Object.freeze({
    batchJobId: input.batchJobId.trim(),
    order: input.order,
    pinned: input.pinned,
  });
}

export function createWorkspaceBatchPlacement(
  input: WorkspaceBatchPlacement,
): WorkspaceBatchPlacement {
  return placementBase(input);
}

export function createArchiveBatchPlacement(
  input: ArchiveBatchPlacement,
): ArchiveBatchPlacement {
  const base = placementBase(input);
  assertNonNegativeSafeInteger(input.archivedAt, "archivedAt");
  return Object.freeze({ ...base, archivedAt: input.archivedAt });
}

export function createTrashBatchPlacement(
  input: TrashBatchPlacement,
): TrashBatchPlacement {
  const base = placementBase(input);
  assertNonEmptyString(input.deletionReason, "deletionReason");
  assertNonNegativeSafeInteger(input.trashedAt, "trashedAt");
  assertNonNegativeSafeInteger(input.retentionStartedAt, "retentionStartedAt");
  if (
    input.retentionStartedAt < input.trashedAt ||
    (input.purgeAfter !== null &&
      (!Number.isSafeInteger(input.purgeAfter) ||
        input.purgeAfter < input.retentionStartedAt))
  ) {
    throw new DomainValidationError(
      "trashMetadata",
      "batch trash lifetime metadata is invalid",
    );
  }
  return Object.freeze({
    ...base,
    deletionReason: input.deletionReason.trim(),
    purgeAfter: input.purgeAfter,
    retentionStartedAt: input.retentionStartedAt,
    trashedAt: input.trashedAt,
    trashOrigin: input.trashOrigin,
  });
}

export function createBatchSourceHistoryEntry(
  input: BatchSourceHistoryEntry,
): BatchSourceHistoryEntry {
  assertNonEmptyString(input.sourceHistoryId, "sourceHistoryId");
  assertNonEmptyString(input.batchJobId, "batchJobId");
  assertNonEmptyString(input.sourceKind, "sourceKind");
  assertNonEmptyString(input.sourceKey, "sourceKey");
  assertNonNegativeSafeInteger(input.addedAt, "addedAt");
  assertNonNegativeSafeInteger(input.addedCount, "addedCount");
  assertNonNegativeSafeInteger(input.duplicateCount, "duplicateCount");
  const sourceKey = input.sourceKey.trim();
  if (
    /(?:https?:\/\/|data:|file:|cookie|sessdata|bearer|token|authorization|[?&](?:access_key|auth|signature|token)=)/i.test(
      sourceKey,
    ) ||
    sourceKey.length > 200
  ) {
    throw new DomainValidationError(
      "sourceKey",
      "batch source history requires a stable non-URL key",
    );
  }
  return Object.freeze({
    sourceHistoryId: input.sourceHistoryId.trim(),
    addedAt: input.addedAt,
    addedCount: input.addedCount,
    batchJobId: input.batchJobId.trim(),
    duplicateCount: input.duplicateCount,
    sourceKey,
    sourceKind: input.sourceKind.trim().slice(0, 64),
  });
}

export function nextBatchListName(names: readonly string[]): string {
  const occupied = new Set<number>();
  for (const name of names) {
    const match = /^新建列表([1-9]\d*)$/.exec(name.trim());
    if (match) occupied.add(Number(match[1]));
  }
  let suffix = 1;
  while (occupied.has(suffix)) suffix += 1;
  return `新建列表${suffix}`;
}
