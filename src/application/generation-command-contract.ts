import { createTaskOwner, type TaskOwner } from "../domain";
import {
  createAiGenerationRequest,
  type AiGenerationRequest,
} from "./ai/provider-contract";
import {
  GENERATION_RUNTIME_PROTOCOL_VERSION,
  type GenerationTaskContext,
} from "./generation-runtime-contract";

export type GenerationStartCommand = GenerationTaskContext & {
  readonly type: "muzhi.generation.start";
  readonly payload: { readonly request: AiGenerationRequest };
};

export type GenerationStopCommand = GenerationTaskContext & {
  readonly type: "muzhi.generation.stop";
  readonly payload: Record<never, never>;
};

export type GenerationRuntimeCommand =
  GenerationStartCommand | GenerationStopCommand;

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === allowed.length && keys.every((key) => allowed.includes(key))
  );
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

function isGenerationTaskContext(value: Record<string, unknown>): boolean {
  if (
    value.protocolVersion !== GENERATION_RUNTIME_PROTOCOL_VERSION ||
    !isSafeIdentifier(value.requestId)
  ) {
    return false;
  }
  try {
    createTaskOwner(value as unknown as TaskOwner);
    return true;
  } catch {
    return false;
  }
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
  "type",
  "payload",
] as const;

export function isGenerationRuntimeCommand(
  value: unknown,
): value is GenerationRuntimeCommand {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, envelopeKeys) ||
    !isGenerationTaskContext(value) ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  if (value.type === "muzhi.generation.stop") {
    return hasOnlyKeys(value.payload, []);
  }
  if (
    value.type !== "muzhi.generation.start" ||
    !hasOnlyKeys(value.payload, ["request"])
  ) {
    return false;
  }
  try {
    const request = createAiGenerationRequest(
      value.payload.request as AiGenerationRequest,
    );
    return request.kind === value.kind;
  } catch {
    return false;
  }
}

function assertGenerationTaskContext(context: GenerationTaskContext): void {
  if (!isGenerationTaskContext(context as unknown as Record<string, unknown>)) {
    throw new Error("The generation command context is invalid");
  }
}

export function createGenerationStartCommand(input: {
  readonly context: GenerationTaskContext;
  readonly request: AiGenerationRequest;
}): GenerationStartCommand {
  assertGenerationTaskContext(input.context);
  const request = createAiGenerationRequest(input.request);
  if (request.kind !== input.context.kind) {
    throw new Error("The generation request kind does not match its owner");
  }
  return Object.freeze({
    ...input.context,
    payload: Object.freeze({ request }),
    type: "muzhi.generation.start" as const,
  });
}

export function createGenerationStopCommand(
  context: GenerationTaskContext,
): GenerationStopCommand {
  assertGenerationTaskContext(context);
  return Object.freeze({
    ...context,
    payload: Object.freeze({}),
    type: "muzhi.generation.stop" as const,
  });
}
