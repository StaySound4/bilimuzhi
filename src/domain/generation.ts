import { createContentOwner, type ContentOwner } from "./ownership";
import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";

export type GenerationKind = "chat" | "segments" | "summary";
export type GenerationRunStatus =
  | "queued"
  | "running"
  | "preparing"
  | "requesting"
  | "streaming"
  | "validating"
  | "saving"
  | "stopped"
  | "cancelled"
  | "completed"
  | "interrupted"
  | "failed";
export type GenerationStopReason = "owner-deleted" | "user";

/**
 * 生成任务的进行中状态：队列/准备/请求/流式/校验/保存均算运行中，
 * 删除或归档所属会话时必须终止；stopped/cancelled/completed/interrupted/failed 为终态。
 */
export function isInFlightGenerationStatus(
  status: GenerationRunStatus,
): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "preparing" ||
    status === "requesting" ||
    status === "streaming" ||
    status === "validating" ||
    status === "saving"
  );
}

export interface TaskOwner extends ContentOwner {
  readonly taskId: string;
  readonly targetId: string;
  readonly kind: GenerationKind;
  readonly expectedOwnerRevision: number;
}

export interface GenerationRun extends TaskOwner {
  readonly runId: string;
  readonly browserSessionId: string;
  readonly status: GenerationRunStatus;
  readonly partialOutput: string;
  readonly errorCode: string | null;
  readonly stopReason: GenerationStopReason | null;
  readonly completionSequence: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  /**
   * Safe, one-way snapshot identities used to reject late events from a
   * different prompt/model/context revision. Legacy records omit these fields
   * and are normalized by createGenerationRun.
   */
  readonly promptHash?: string | null;
  readonly modelHash?: string | null;
  readonly contextHash?: string | null;
  readonly conversationRevision?: number;
  readonly runRevision?: number;
}

function assertSafeIdentifier(value: unknown, field: string): void {
  assertNonEmptyString(value, field);
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    value !== value.trim() ||
    value.includes("://") ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new DomainValidationError(field, `${field} is not a safe identifier`);
  }
}

function assertNullableIdentifier(value: unknown, field: string): void {
  if (value !== null) assertSafeIdentifier(value, field);
}

function assertNullableSnapshotHash(value: unknown, field: string): void {
  if (value === null) return;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new DomainValidationError(
      field,
      `${field} must be a SHA-256 snapshot identity`,
    );
  }
}

export function createTaskOwner(input: TaskOwner): TaskOwner {
  const contentOwner = createContentOwner(input);
  assertSafeIdentifier(input.taskId, "taskId");
  assertSafeIdentifier(input.targetId, "targetId");
  if (
    input.kind !== "chat" &&
    input.kind !== "segments" &&
    input.kind !== "summary"
  ) {
    throw new DomainValidationError("kind", "generation kind is unsupported");
  }
  assertNonNegativeSafeInteger(
    input.expectedOwnerRevision,
    "expectedOwnerRevision",
  );
  return Object.freeze({
    ...contentOwner,
    expectedOwnerRevision: input.expectedOwnerRevision,
    kind: input.kind,
    targetId: input.targetId,
    taskId: input.taskId,
  });
}

export function createGenerationRun(input: GenerationRun): GenerationRun {
  const owner = createTaskOwner(input);
  assertSafeIdentifier(input.runId, "runId");
  assertSafeIdentifier(input.browserSessionId, "browserSessionId");
  if (
    input.status !== "queued" &&
    input.status !== "running" &&
    input.status !== "preparing" &&
    input.status !== "requesting" &&
    input.status !== "streaming" &&
    input.status !== "validating" &&
    input.status !== "saving" &&
    input.status !== "stopped" &&
    input.status !== "cancelled" &&
    input.status !== "completed" &&
    input.status !== "interrupted" &&
    input.status !== "failed"
  ) {
    throw new DomainValidationError(
      "status",
      "generation status is unsupported",
    );
  }
  if (
    typeof input.partialOutput !== "string" ||
    input.partialOutput.length > 2_000_000
  ) {
    throw new DomainValidationError(
      "partialOutput",
      "generation output is invalid",
    );
  }
  assertNullableIdentifier(input.errorCode, "errorCode");
  if (
    input.stopReason !== null &&
    input.stopReason !== "owner-deleted" &&
    input.stopReason !== "user"
  ) {
    throw new DomainValidationError(
      "stopReason",
      "generation stop reason is unsupported",
    );
  }
  if (input.completionSequence !== null) {
    assertNonNegativeSafeInteger(
      input.completionSequence,
      "completionSequence",
    );
  }
  if (input.status === "completed" && input.completionSequence === null) {
    throw new DomainValidationError(
      "completionSequence",
      "completed generation requires a completion sequence",
    );
  }
  if (input.status !== "completed" && input.completionSequence !== null) {
    throw new DomainValidationError(
      "completionSequence",
      "only completed generation has a completion sequence",
    );
  }
  if (input.status !== "stopped" && input.stopReason !== null) {
    throw new DomainValidationError(
      "stopReason",
      "only stopped generation has a stop reason",
    );
  }
  if (input.status === "stopped" && input.stopReason === null) {
    throw new DomainValidationError(
      "stopReason",
      "stopped generation requires a stop reason",
    );
  }
  if (input.status !== "failed" && input.errorCode !== null) {
    throw new DomainValidationError(
      "errorCode",
      "only failed generation has an error code",
    );
  }
  if (input.status === "failed" && input.errorCode === null) {
    throw new DomainValidationError(
      "errorCode",
      "failed generation requires an error code",
    );
  }
  assertNonNegativeSafeInteger(input.createdAt, "createdAt");
  assertNonNegativeSafeInteger(input.updatedAt, "updatedAt");
  if (input.updatedAt < input.createdAt) {
    throw new DomainValidationError(
      "updatedAt",
      "updatedAt cannot precede createdAt",
    );
  }
  const promptHash = input.promptHash ?? null;
  const modelHash = input.modelHash ?? null;
  const contextHash = input.contextHash ?? null;
  const conversationRevision =
    input.conversationRevision ?? owner.expectedOwnerRevision;
  const runRevision = input.runRevision ?? 0;
  assertNullableSnapshotHash(promptHash, "promptHash");
  assertNullableSnapshotHash(modelHash, "modelHash");
  assertNullableSnapshotHash(contextHash, "contextHash");
  assertNonNegativeSafeInteger(conversationRevision, "conversationRevision");
  assertNonNegativeSafeInteger(runRevision, "runRevision");
  const userCancelled =
    input.status === "stopped" &&
    input.stopReason === "user" &&
    input.partialOutput.length > 0;
  return Object.freeze({
    ...owner,
    browserSessionId: input.browserSessionId,
    completionSequence: input.completionSequence,
    contextHash,
    conversationRevision,
    createdAt: input.createdAt,
    errorCode: input.errorCode,
    modelHash,
    partialOutput: input.partialOutput,
    promptHash,
    runId: input.runId,
    runRevision,
    status: userCancelled ? "cancelled" : input.status,
    stopReason: userCancelled ? null : input.stopReason,
    updatedAt: input.updatedAt,
  });
}
