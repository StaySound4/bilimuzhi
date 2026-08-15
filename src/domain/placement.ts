import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";

export type BranchLocation = "workspace" | "archive" | "trash";
export type TrashOrigin = "workspace" | "archive";

export interface BranchPlacement {
  readonly branchId: string;
  readonly sessionId: string;
  readonly location: BranchLocation;
  readonly trashOrigin: TrashOrigin | null;
  readonly trashOriginFolderId: string | null;
  readonly trashOriginPathSnapshot: string | null;
  readonly trashedAt: number | null;
  readonly retentionStartedAt: number | null;
  readonly purgeAfter: number | null;
  readonly deletionReason: string | null;
  readonly order: number;
}

export interface WorkspaceSessionPlacement {
  readonly sessionId: string;
  readonly pinned: boolean;
  readonly order: number;
}

export interface ArchiveSessionPlacement {
  readonly sessionId: string;
  readonly folderId: string;
  readonly pinned: boolean;
  readonly order: number;
  /** 归档时间戳（毫秒）；旧数据缺失时回退为 order。 */
  readonly archivedAt: number;
}

/**
 * Session-level trash metadata is used only when a workspace session has no
 * subtitle context yet. Sessions with subtitles continue to derive trash
 * ownership from their branch placement so content deletion remains atomic.
 */
export interface TrashSessionPlacement {
  readonly deletionReason: string;
  readonly order: number;
  readonly pinned: boolean;
  readonly purgeAfter: number | null;
  readonly retentionStartedAt: number;
  readonly sessionId: string;
  readonly trashedAt: number;
  readonly trashOrigin: "workspace" | "archive";
}

export interface ArchiveFolder {
  readonly folderId: string;
  readonly parentFolderId: string | null;
  readonly title: string;
  readonly order: number;
}

function assertBoolean(value: unknown, field: string): void {
  if (typeof value !== "boolean") {
    throw new DomainValidationError(field, `${field} must be boolean`);
  }
}

function assertNullableString(value: unknown, field: string): void {
  if (value !== null) {
    assertNonEmptyString(value, field);
  }
}

function assertNullableTimestamp(value: unknown, field: string): void {
  if (value !== null) {
    assertNonNegativeSafeInteger(value, field);
  }
}

export function createBranchPlacement(input: BranchPlacement): BranchPlacement {
  assertNonEmptyString(input.branchId, "branchId");
  assertNonEmptyString(input.sessionId, "sessionId");
  if (!(["workspace", "archive", "trash"] as const).includes(input.location)) {
    throw new DomainValidationError("location", "location is unsupported");
  }
  assertNullableString(input.trashOriginFolderId, "trashOriginFolderId");
  assertNullableString(
    input.trashOriginPathSnapshot,
    "trashOriginPathSnapshot",
  );
  assertNullableTimestamp(input.trashedAt, "trashedAt");
  assertNullableTimestamp(input.retentionStartedAt, "retentionStartedAt");
  assertNullableTimestamp(input.purgeAfter, "purgeAfter");
  assertNullableString(input.deletionReason, "deletionReason");
  assertNonNegativeSafeInteger(input.order, "order");

  if (input.location !== "trash") {
    if (
      input.trashOrigin !== null ||
      input.trashOriginFolderId !== null ||
      input.trashOriginPathSnapshot !== null ||
      input.trashedAt !== null ||
      input.retentionStartedAt !== null ||
      input.purgeAfter !== null ||
      input.deletionReason !== null
    ) {
      throw new DomainValidationError(
        "trashMetadata",
        "non-trash placement cannot retain trash metadata",
      );
    }
  } else if (
    (input.trashOrigin !== "workspace" && input.trashOrigin !== "archive") ||
    input.trashedAt === null ||
    input.retentionStartedAt === null ||
    input.deletionReason === null ||
    input.retentionStartedAt < input.trashedAt ||
    (input.purgeAfter !== null && input.purgeAfter < input.retentionStartedAt)
  ) {
    throw new DomainValidationError(
      "trashMetadata",
      "trash placement lifetime metadata is incomplete or non-monotonic",
    );
  }
  if (
    input.location === "trash" &&
    ((input.trashOrigin === "workspace" &&
      (input.trashOriginFolderId !== null ||
        input.trashOriginPathSnapshot !== null)) ||
      (input.trashOrigin === "archive" &&
        (input.trashOriginFolderId === null ||
          input.trashOriginPathSnapshot === null)))
  ) {
    throw new DomainValidationError(
      "trashOrigin",
      "trash origin metadata does not match the source location",
    );
  }

  return Object.freeze({
    branchId: input.branchId.trim(),
    deletionReason: input.deletionReason?.trim() ?? null,
    location: input.location,
    order: input.order,
    purgeAfter: input.purgeAfter,
    retentionStartedAt: input.retentionStartedAt,
    sessionId: input.sessionId.trim(),
    trashedAt: input.trashedAt,
    trashOrigin: input.trashOrigin,
    trashOriginFolderId: input.trashOriginFolderId?.trim() ?? null,
    trashOriginPathSnapshot: input.trashOriginPathSnapshot?.trim() ?? null,
  });
}

export function createWorkspaceSessionPlacement(
  input: WorkspaceSessionPlacement,
): WorkspaceSessionPlacement {
  assertNonEmptyString(input.sessionId, "sessionId");
  assertBoolean(input.pinned, "pinned");
  assertNonNegativeSafeInteger(input.order, "order");
  return Object.freeze({
    order: input.order,
    pinned: input.pinned,
    sessionId: input.sessionId.trim(),
  });
}

/**
 * 从持久化记录读取归档会话放置：旧数据没有 archivedAt 字段时
 * 回退为 order（历史归档曾用时间戳或序号作为 order）。
 */
export function readArchivePlacementFromStored(
  value: unknown,
): ArchiveSessionPlacement {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (record.archivedAt === undefined) {
      return createArchiveSessionPlacement({
        ...(record as unknown as ArchiveSessionPlacement),
        archivedAt: typeof record.order === "number" ? record.order : 0,
      });
    }
  }
  return createArchiveSessionPlacement(value as ArchiveSessionPlacement);
}

export function createArchiveSessionPlacement(
  input: ArchiveSessionPlacement,
): ArchiveSessionPlacement {
  assertNonEmptyString(input.sessionId, "sessionId");
  assertNonEmptyString(input.folderId, "folderId");
  assertBoolean(input.pinned, "pinned");
  assertNonNegativeSafeInteger(input.order, "order");
  assertNonNegativeSafeInteger(input.archivedAt, "archivedAt");
  return Object.freeze({
    archivedAt: input.archivedAt,
    folderId: input.folderId.trim(),
    order: input.order,
    pinned: input.pinned,
    sessionId: input.sessionId.trim(),
  });
}

export function createTrashSessionPlacement(
  input: TrashSessionPlacement,
): TrashSessionPlacement {
  assertNonEmptyString(input.sessionId, "sessionId");
  assertNonEmptyString(input.deletionReason, "deletionReason");
  assertBoolean(input.pinned, "pinned");
  assertNonNegativeSafeInteger(input.order, "order");
  assertNonNegativeSafeInteger(input.trashedAt, "trashedAt");
  assertNonNegativeSafeInteger(input.retentionStartedAt, "retentionStartedAt");
  assertNullableTimestamp(input.purgeAfter, "purgeAfter");
  if (
    (input.trashOrigin !== "workspace" && input.trashOrigin !== "archive") ||
    input.retentionStartedAt < input.trashedAt ||
    (input.purgeAfter !== null && input.purgeAfter < input.retentionStartedAt)
  ) {
    throw new DomainValidationError(
      "trashSessionMetadata",
      "trash session lifetime metadata is invalid",
    );
  }
  return Object.freeze({
    deletionReason: input.deletionReason.trim(),
    order: input.order,
    pinned: input.pinned,
    purgeAfter: input.purgeAfter,
    retentionStartedAt: input.retentionStartedAt,
    sessionId: input.sessionId.trim(),
    trashedAt: input.trashedAt,
    trashOrigin: input.trashOrigin,
  });
}

export function createArchiveFolder(input: ArchiveFolder): ArchiveFolder {
  assertNonEmptyString(input.folderId, "folderId");
  assertNullableString(input.parentFolderId, "parentFolderId");
  assertNonEmptyString(input.title, "title");
  assertNonNegativeSafeInteger(input.order, "order");
  const folderId = input.folderId.trim();
  const parentFolderId = input.parentFolderId?.trim() ?? null;
  if (folderId === parentFolderId) {
    throw new DomainValidationError(
      "parentFolderId",
      "archive folder cannot be its own parent",
    );
  }
  return Object.freeze({
    folderId,
    order: input.order,
    parentFolderId,
    title: input.title.trim(),
  });
}
