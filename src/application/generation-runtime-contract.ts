import {
  createGenerationRun,
  createTaskOwner,
  type GenerationRun,
  type GenerationRunStatus,
  type GenerationStopReason,
  type TaskOwner,
} from "../domain";

export const GENERATION_FAILURE_CODES = Object.freeze([
  "USER_CANCELLED",
  "NETWORK_ERROR",
  "AUTHENTICATION_REQUIRED",
  "RATE_LIMITED",
  "PROVIDER_EARLY_END",
  "TIMEOUT",
  "CONTEXT_TOO_LONG",
  "OUTPUT_LIMIT_REACHED",
  "PROVIDER_BUSY",
  "CONTENT_SAFETY_BLOCKED",
  "STRUCTURED_OUTPUT_INVALID",
  "PERSISTENCE_FAILED",
  "BACKGROUND_RECOVERY_FAILED",
  "UNSUPPORTED_CAPABILITY",
] as const);

export type GenerationFailureCode = (typeof GENERATION_FAILURE_CODES)[number];
export type GenerationTargetKind = "chat" | "segments" | "summary";

export interface GenerationFailurePresentation {
  readonly action: string;
  readonly code: GenerationFailureCode;
  readonly incomplete: boolean;
  readonly placement: "artifact" | "chat-message";
  readonly preservePartial: boolean;
  readonly preservePreviousArtifact: boolean;
  readonly retryable: boolean;
}

const FAILURE_ACTIONS = Object.freeze({
  AUTHENTICATION_REQUIRED: "generationAction.auth",
  BACKGROUND_RECOVERY_FAILED: "generationAction.backgroundRecovery",
  CONTENT_SAFETY_BLOCKED: "generationAction.contentSafety",
  CONTEXT_TOO_LONG: "generationAction.contextTooLong",
  NETWORK_ERROR: "generationAction.network",
  OUTPUT_LIMIT_REACHED: "generationAction.outputLimit",
  PERSISTENCE_FAILED: "generationAction.persistence",
  PROVIDER_BUSY: "generationAction.providerBusy",
  PROVIDER_EARLY_END: "generationAction.earlyEnd",
  RATE_LIMITED: "generationAction.rateLimited",
  STRUCTURED_OUTPUT_INVALID: "generationAction.structuredOutput",
  TIMEOUT: "generationAction.timeout",
  UNSUPPORTED_CAPABILITY: "generationAction.unsupported",
  USER_CANCELLED: "generationAction.userCancelled",
} as const satisfies Readonly<Record<GenerationFailureCode, string>>);

const NON_RETRYABLE_FAILURES = new Set<GenerationFailureCode>([
  "USER_CANCELLED",
  "CONTENT_SAFETY_BLOCKED",
]);

export function describeGenerationFailure(input: {
  readonly code: GenerationFailureCode;
  readonly hasPartialOutput: boolean;
  readonly hasPreviousArtifact: boolean;
  readonly kind: GenerationTargetKind;
}): GenerationFailurePresentation {
  const artifact = input.kind !== "chat";
  const preservePartial = input.kind !== "segments" && input.hasPartialOutput;
  return Object.freeze({
    action: FAILURE_ACTIONS[input.code],
    code: input.code,
    incomplete: preservePartial,
    placement: artifact ? "artifact" : "chat-message",
    preservePartial,
    preservePreviousArtifact:
      artifact && input.hasPreviousArtifact && input.kind === "segments",
    retryable: !NON_RETRYABLE_FAILURES.has(input.code),
  });
}

/**
 * 把持久 run 的错误码/终态映射为稳定失败码；非终态或未知码返回 null。
 */
export function stableGenerationFailureCode(
  errorCode: string | null,
): GenerationFailureCode | null {
  return errorCode !== null &&
    (GENERATION_FAILURE_CODES as readonly string[]).includes(errorCode)
    ? (errorCode as GenerationFailureCode)
    : errorCode === "STOPPED_BY_USER"
      ? "USER_CANCELLED"
      : null;
}

/**
 * 从 run 的持久状态（errorCode/status/部分输出）派生用户可观察的失败投影。
 */
export function generationFailureFor(input: {
  readonly errorCode: string | null;
  readonly hasPartialOutput: boolean;
  readonly hasPreviousArtifact: boolean;
  readonly kind: GenerationTargetKind;
  readonly status?: GenerationRunStatus;
}): GenerationFailurePresentation | null {
  const code =
    stableGenerationFailureCode(input.errorCode) ??
    (input.status === "cancelled" || input.status === "stopped"
      ? "USER_CANCELLED"
      : input.status === "interrupted"
        ? "BACKGROUND_RECOVERY_FAILED"
        : null);
  return code === null
    ? null
    : describeGenerationFailure({
        code,
        hasPartialOutput: input.hasPartialOutput,
        hasPreviousArtifact: input.hasPreviousArtifact,
        kind: input.kind,
      });
}

export const GENERATION_RUNTIME_PROTOCOL_VERSION = 1 as const;

export type GenerationRuntimePhase =
  | "queued"
  | "running"
  | "preparing"
  | "requesting"
  | "streaming"
  | "validating"
  | "saving";

const NON_TERMINAL_GENERATION_STATUSES = Object.freeze([
  "queued",
  "running",
  "preparing",
  "requesting",
  "streaming",
  "validating",
  "saving",
] as const satisfies readonly GenerationRuntimePhase[]);

export function isGenerationRunNonTerminal(
  status: GenerationRunStatus,
): status is GenerationRuntimePhase {
  return (NON_TERMINAL_GENERATION_STATUSES as readonly string[]).includes(
    status,
  );
}

function canonicalSnapshotValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalSnapshotValue);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalSnapshotValue(entry)]),
  );
}

/**
 * Produces the only form of prompt/model/context identity that may cross the
 * durable generation boundary. The source value is never returned or stored.
 */
export async function createGenerationSnapshotHash(
  value: unknown,
): Promise<string> {
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonicalSnapshotValue(value)),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

export interface GenerationTaskContext extends TaskOwner {
  readonly protocolVersion: typeof GENERATION_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly promptHash?: string | null;
  readonly modelHash?: string | null;
  readonly contextHash?: string | null;
  readonly conversationRevision?: number;
  readonly runRevision?: number;
}

interface GenerationRuntimeEnvelope extends GenerationTaskContext {
  readonly type: string;
}

export type GenerationRuntimeEvent =
  | (GenerationRuntimeEnvelope & {
      readonly type: "muzhi.generation.started";
      readonly payload: Record<never, never>;
    })
  | (GenerationRuntimeEnvelope & {
      readonly type: "muzhi.generation.status";
      readonly payload: { readonly status: GenerationRuntimePhase };
    })
  | (GenerationRuntimeEnvelope & {
      readonly type: "muzhi.generation.reasoning";
      readonly payload: { readonly text: string };
    })
  | (GenerationRuntimeEnvelope & {
      readonly type: "muzhi.generation.delta";
      readonly payload: { readonly delta: string };
    })
  | (GenerationRuntimeEnvelope & {
      readonly type: "muzhi.generation.completed";
      readonly payload: {
        readonly completionSequence: number;
        readonly output: string;
      };
    })
  | (GenerationRuntimeEnvelope & {
      readonly type: "muzhi.generation.stopped";
      readonly payload: { readonly reason: GenerationStopReason };
    })
  | (GenerationRuntimeEnvelope & {
      readonly type: "muzhi.generation.interrupted";
      readonly payload: Record<never, never>;
    })
  | (GenerationRuntimeEnvelope & {
      readonly type: "muzhi.generation.failed";
      readonly payload: { readonly errorCode: string };
    });

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNullableSnapshotHash(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value))
  );
}

function hasValidTaskContext(value: Record<string, unknown>): boolean {
  try {
    if (
      value.protocolVersion !== GENERATION_RUNTIME_PROTOCOL_VERSION ||
      !isSafeIdentifier(value.requestId)
    ) {
      return false;
    }
    for (const field of ["promptHash", "modelHash", "contextHash"] as const) {
      if (field in value && !isNullableSnapshotHash(value[field])) return false;
    }
    for (const field of ["conversationRevision", "runRevision"] as const) {
      if (field in value && !isNonNegativeSafeInteger(value[field]))
        return false;
    }
    createTaskOwner(value as unknown as TaskOwner);
    return true;
  } catch {
    return false;
  }
}

export function isGenerationRuntimeEvent(
  value: unknown,
): value is GenerationRuntimeEvent {
  if (
    !isRecord(value) ||
    !hasValidTaskContext(value) ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  const envelopeKeys = [
    "protocolVersion",
    "requestId",
    "taskId",
    "sessionId",
    "branchId",
    "subtitleId",
    "contextRevision",
    "kind",
    "targetId",
    "expectedOwnerRevision",
    "promptHash",
    "modelHash",
    "contextHash",
    "conversationRevision",
    "runRevision",
    "type",
    "payload",
  ] as const;
  if (!hasOnlyKeys(value, envelopeKeys)) return false;

  switch (value.type) {
    case "muzhi.generation.started":
    case "muzhi.generation.interrupted":
      return hasOnlyKeys(value.payload, []);
    case "muzhi.generation.status":
      return (
        hasOnlyKeys(value.payload, ["status"]) &&
        typeof value.payload.status === "string" &&
        (NON_TERMINAL_GENERATION_STATUSES as readonly string[]).includes(
          value.payload.status,
        )
      );
    case "muzhi.generation.reasoning":
      return (
        hasOnlyKeys(value.payload, ["text"]) &&
        typeof value.payload.text === "string" &&
        value.payload.text.length <= 2_000_000
      );
    case "muzhi.generation.delta":
      return (
        hasOnlyKeys(value.payload, ["delta"]) &&
        typeof value.payload.delta === "string" &&
        value.payload.delta.length <= 2_000_000
      );
    case "muzhi.generation.completed":
      return (
        hasOnlyKeys(value.payload, ["completionSequence", "output"]) &&
        isNonNegativeSafeInteger(value.payload.completionSequence) &&
        typeof value.payload.output === "string" &&
        value.payload.output.length <= 2_000_000
      );
    case "muzhi.generation.stopped":
      return (
        hasOnlyKeys(value.payload, ["reason"]) &&
        (value.payload.reason === "owner-deleted" ||
          value.payload.reason === "user")
      );
    case "muzhi.generation.failed":
      return (
        hasOnlyKeys(value.payload, ["errorCode"]) &&
        isSafeIdentifier(value.payload.errorCode)
      );
    default:
      return false;
  }
}

function hasSameOwner(
  run: GenerationRun,
  context: GenerationTaskContext,
): boolean {
  return (
    run.taskId === context.taskId &&
    run.sessionId === context.sessionId &&
    run.branchId === context.branchId &&
    run.subtitleId === context.subtitleId &&
    run.contextRevision === context.contextRevision &&
    run.kind === context.kind &&
    run.targetId === context.targetId &&
    run.expectedOwnerRevision === context.expectedOwnerRevision
  );
}

function hasSameSnapshot(
  run: GenerationRun,
  context: GenerationTaskContext,
): boolean {
  return (
    (context.promptHash === undefined ||
      context.promptHash === (run.promptHash ?? null)) &&
    (context.modelHash === undefined ||
      context.modelHash === (run.modelHash ?? null)) &&
    (context.contextHash === undefined ||
      context.contextHash === (run.contextHash ?? null)) &&
    (context.conversationRevision === undefined ||
      context.conversationRevision ===
        (run.conversationRevision ?? run.expectedOwnerRevision)) &&
    (context.runRevision === undefined ||
      context.runRevision === (run.runRevision ?? 0))
  );
}

export function canApplyGenerationRuntimeEvent(
  run: GenerationRun,
  event: GenerationRuntimeEvent,
): boolean {
  return (
    isGenerationRunNonTerminal(run.status) &&
    hasSameOwner(run, event) &&
    hasSameSnapshot(run, event)
  );
}

export function reconcileGenerationRunAfterBackgroundStart(
  run: GenerationRun,
  input: {
    readonly browserSessionId: string;
    readonly hasLiveExecutor: boolean;
    readonly now: number;
  },
): GenerationRun {
  if (
    !isGenerationRunNonTerminal(run.status) ||
    (run.browserSessionId === input.browserSessionId && input.hasLiveExecutor)
  ) {
    return run;
  }
  return createGenerationRun({
    ...run,
    completionSequence: null,
    errorCode: null,
    status: "interrupted",
    stopReason: null,
    updatedAt: Math.max(input.now, run.updatedAt),
  });
}
