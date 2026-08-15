import { DomainValidationError } from "../../domain";
import type { AiProviderErrorCode } from "./provider-error";

export type AiGenerationKind = "chat" | "segments" | "summary";
export type AiMessageRole = "assistant" | "system" | "user";
export type AiReasoningEffort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
/**
 * 推理档位偏好：内置七档之外的任意字符串为「用户自定义档位」
 * （校验：非空、≤24 字符、`[a-z0-9_-]`、大小写不敏感查重），
 * 传输层对自定义值原样透传，不套任何映射。
 */
export type AiReasoningPreference = "auto" | AiReasoningEffort | (string & {});

const AI_REASONING_EFFORTS = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly AiReasoningEffort[]);

export const CUSTOM_REASONING_EFFORT_MAX_LENGTH = 24;
/** 字符集含大小写（查重时折叠大小写，见 settings 存储层）。 */
const CUSTOM_REASONING_EFFORT_PATTERN = /^[A-Za-z0-9_-]+$/;

/** 自定义档位校验：非空、≤24 字符、`[a-z0-9_-]`，且不属于内置七档。 */
export function isCustomReasoningEffort(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= CUSTOM_REASONING_EFFORT_MAX_LENGTH &&
    CUSTOM_REASONING_EFFORT_PATTERN.test(value) &&
    !(AI_REASONING_EFFORTS as readonly string[]).includes(value)
  );
}

/** 是否内置档位（区别于自定义档位与 auto）。 */
export function isBuiltInReasoningEffort(
  value: AiReasoningPreference,
): value is AiReasoningEffort {
  return (AI_REASONING_EFFORTS as readonly string[]).includes(value);
}
export interface AiModelCapabilities {
  readonly contextWindowCharacters: number;
  readonly maxOutputCharacters: number;
  readonly supportedReasoningEfforts: readonly AiReasoningEffort[];
  readonly supportsAttachments: boolean;
  readonly supportsReasoning: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsWebSearch: boolean;
}

export interface AiModelDescriptor {
  readonly capabilities: AiModelCapabilities;
  readonly displayName: string;
  readonly modelId: string;
  readonly providerId: string;
  readonly discoveredAt: number;
}

export interface AiPromptMessage {
  readonly content: string;
  readonly role: AiMessageRole;
}

/**
 * A provider-facing attachment reference. It deliberately contains no Blob,
 * object URL, base64 body, filename, page URL, or provider payload. The
 * infrastructure boundary may resolve this local handle only after capability
 * and owner checks have succeeded.
 */
export interface AiImageAttachmentHandle {
  readonly attachmentId: string;
  readonly currentTimeMs: number;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly sizeBytes: number;
  readonly videoKey: string;
}

export type AiProviderImageMimeType = "image/jpeg" | "image/png" | "image/webp";

/**
 * A transient, untrusted Provider image reference. It must be processed by the
 * Service Worker image boundary before it can become a local attachment.
 */
export type AiProviderImageOutputDescriptor =
  | {
      readonly kind: "remote";
      readonly url: string;
    }
  | {
      readonly base64: string;
      readonly kind: "inline";
      readonly mimeType: AiProviderImageMimeType;
    };

export interface AiProviderImageOutputEvent {
  readonly descriptor: AiProviderImageOutputDescriptor;
  readonly type: "image-output";
}

export interface AiGenerationRequest {
  readonly attachments?: readonly AiImageAttachmentHandle[];
  readonly kind: AiGenerationKind;
  readonly messages: readonly AiPromptMessage[];
  readonly model: AiModelDescriptor;
  readonly reasoningEffort: AiReasoningPreference;
}

export type AiProviderStreamEvent =
  | { readonly type: "started" }
  | { readonly delta: string; readonly type: "delta" }
  | { readonly delta: string; readonly type: "reasoning" }
  | AiProviderImageOutputEvent
  | { readonly output: string; readonly type: "completed" }
  | {
      readonly code: AiProviderErrorCode;
      readonly retryable: boolean;
      readonly type: "failed";
    };

export interface AiProviderGateway {
  discoverModels(): Promise<readonly AiModelDescriptor[]>;
  stream(request: AiGenerationRequest): AsyncIterable<AiProviderStreamEvent>;
}

function assertSafeIdentifier(
  value: unknown,
  field: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value !== value.trim() ||
    value.includes("://") ||
    !/^[A-Za-z0-9._:-]+$/.test(value)
  ) {
    throw new DomainValidationError(field, `${field} is not a safe identifier`);
  }
}

function assertSafeModelIdentifier(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    value !== value.trim() ||
    value.startsWith("/") ||
    value.includes("//") ||
    value.includes("://") ||
    !/^[A-Za-z0-9._:+/-]+$/.test(value)
  ) {
    throw new DomainValidationError(
      "modelId",
      "modelId is not a safe identifier",
    );
  }
}

function assertPositiveSafeInteger(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new DomainValidationError(
      field,
      `${field} must be a positive safe integer`,
    );
  }
}

function normalizeReasoningEfforts(
  value: unknown,
): readonly AiReasoningEffort[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainValidationError(
      "supportedReasoningEfforts",
      "supported reasoning efforts are required",
    );
  }
  const efforts: AiReasoningEffort[] = [];
  for (const effort of value) {
    if (
      typeof effort !== "string" ||
      !(AI_REASONING_EFFORTS as readonly string[]).includes(effort)
    ) {
      throw new DomainValidationError(
        "supportedReasoningEfforts",
        "supported reasoning effort is invalid",
      );
    }
    if (!efforts.includes(effort as AiReasoningEffort)) {
      efforts.push(effort as AiReasoningEffort);
    }
  }
  return Object.freeze(efforts);
}

export function createAiModelDescriptor(
  input: AiModelDescriptor,
): AiModelDescriptor {
  assertSafeIdentifier(input.providerId, "providerId");
  assertSafeModelIdentifier(input.modelId);
  if (
    typeof input.displayName !== "string" ||
    input.displayName.trim().length === 0 ||
    input.displayName.length > 128
  ) {
    throw new DomainValidationError("displayName", "displayName is invalid");
  }
  assertPositiveSafeInteger(
    input.capabilities.contextWindowCharacters,
    "contextWindowCharacters",
  );
  assertPositiveSafeInteger(
    input.capabilities.maxOutputCharacters,
    "maxOutputCharacters",
  );
  if (
    typeof input.capabilities.supportsAttachments !== "boolean" ||
    typeof input.capabilities.supportsReasoning !== "boolean" ||
    typeof input.capabilities.supportsStreaming !== "boolean" ||
    typeof input.capabilities.supportsWebSearch !== "boolean"
  ) {
    throw new DomainValidationError("capabilities", "capability is invalid");
  }
  const supportedReasoningEfforts = normalizeReasoningEfforts(
    input.capabilities.supportedReasoningEfforts,
  );
  const hasConcreteReasoningEffort = supportedReasoningEfforts.some(
    (effort) => effort !== "none",
  );
  if (
    (!input.capabilities.supportsReasoning &&
      (supportedReasoningEfforts.length !== 1 ||
        supportedReasoningEfforts[0] !== "none")) ||
    (input.capabilities.supportsReasoning && !hasConcreteReasoningEffort)
  ) {
    throw new DomainValidationError(
      "supportedReasoningEfforts",
      "reasoning capability and supported reasoning efforts are inconsistent",
    );
  }
  if (!Number.isSafeInteger(input.discoveredAt) || input.discoveredAt < 0) {
    throw new DomainValidationError("discoveredAt", "discoveredAt is invalid");
  }
  return Object.freeze({
    capabilities: Object.freeze({
      ...input.capabilities,
      supportedReasoningEfforts,
    }),
    discoveredAt: input.discoveredAt,
    displayName: input.displayName.trim(),
    modelId: input.modelId,
    providerId: input.providerId,
  });
}

export function createAiGenerationRequest(
  input: AiGenerationRequest,
): AiGenerationRequest {
  if (
    input.kind !== "chat" &&
    input.kind !== "segments" &&
    input.kind !== "summary"
  ) {
    throw new DomainValidationError("kind", "generation kind is unsupported");
  }
  const model = createAiModelDescriptor(input.model);
  if (!model.capabilities.supportsStreaming) {
    throw new DomainValidationError(
      "model.capabilities.supportsStreaming",
      "model does not support streaming",
    );
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    throw new DomainValidationError("messages", "messages are required");
  }
  const attachmentInput = input.attachments ?? [];
  if (!Array.isArray(attachmentInput) || attachmentInput.length > 6) {
    throw new DomainValidationError(
      "attachments",
      "image attachment count cannot exceed 6",
    );
  }
  if (attachmentInput.length > 0 && !model.capabilities.supportsAttachments) {
    throw new DomainValidationError(
      "model.capabilities.supportsAttachments",
      "selected model image attachment support is unavailable",
    );
  }
  let aggregateAttachmentBytes = 0;
  const attachments = attachmentInput.map((attachment) => {
    assertSafeIdentifier(attachment.attachmentId, "attachmentId");
    if (
      attachment.mimeType !== "image/png" &&
      attachment.mimeType !== "image/jpeg" &&
      attachment.mimeType !== "image/webp"
    ) {
      throw new DomainValidationError(
        "mimeType",
        "image attachment type is unsupported",
      );
    }
    assertPositiveSafeInteger(attachment.sizeBytes, "sizeBytes");
    if (attachment.sizeBytes > 5 * 1_024 * 1_024) {
      throw new DomainValidationError(
        "sizeBytes",
        "image attachment exceeds the 5 MiB limit",
      );
    }
    if (
      !Number.isSafeInteger(attachment.currentTimeMs) ||
      attachment.currentTimeMs < 0
    ) {
      throw new DomainValidationError(
        "currentTimeMs",
        "image attachment time is invalid",
      );
    }
    if (
      typeof attachment.videoKey !== "string" ||
      attachment.videoKey.length === 0 ||
      attachment.videoKey.length > 512 ||
      attachment.videoKey !== attachment.videoKey.trim() ||
      /(?:\b(?:https?|javascript|data|blob):|[\r\n])/i.test(attachment.videoKey)
    ) {
      throw new DomainValidationError(
        "videoKey",
        "image attachment VideoKey is invalid",
      );
    }
    aggregateAttachmentBytes += attachment.sizeBytes;
    return Object.freeze({
      attachmentId: attachment.attachmentId,
      currentTimeMs: attachment.currentTimeMs,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      videoKey: attachment.videoKey,
    });
  });
  if (aggregateAttachmentBytes > 20 * 1_024 * 1_024) {
    throw new DomainValidationError(
      "attachments",
      "image attachments exceed the 20 MiB aggregate limit",
    );
  }
  if (input.messages.length > 256) {
    throw new DomainValidationError(
      "messages",
      "message count cannot exceed 256",
    );
  }
  if (
    input.reasoningEffort !== "auto" &&
    // 自定义档位（用户自建值）原样透传，不检查模型支持集；
    // 内置档位必须在该模型支持集内。
    !isCustomReasoningEffort(input.reasoningEffort) &&
    (!(AI_REASONING_EFFORTS as readonly string[]).includes(
      input.reasoningEffort,
    ) ||
      !model.capabilities.supportedReasoningEfforts.includes(
        input.reasoningEffort as AiReasoningEffort,
      ))
  ) {
    throw new DomainValidationError(
      "reasoningEffort",
      "reasoning effort is not supported by the selected model",
    );
  }
  let aggregateCharacters = 0;
  const messages = input.messages.map((message) => {
    if (
      (message.role !== "system" &&
        message.role !== "user" &&
        message.role !== "assistant") ||
      typeof message.content !== "string" ||
      message.content.length > model.capabilities.contextWindowCharacters ||
      // 图片-only 消息允许空正文（附件随请求携带）；
      // 无附件时的空消息仍属无效。
      (message.content.length === 0 && attachmentInput.length === 0)
    ) {
      throw new DomainValidationError("messages", "message is invalid");
    }
    aggregateCharacters += message.content.length;
    return Object.freeze({ content: message.content, role: message.role });
  });
  if (aggregateCharacters > model.capabilities.contextWindowCharacters) {
    throw new DomainValidationError(
      "messages",
      "messages exceed the model context window",
    );
  }
  return Object.freeze({
    ...(attachments.length > 0
      ? { attachments: Object.freeze(attachments) }
      : {}),
    kind: input.kind,
    messages: Object.freeze(messages),
    model,
    reasoningEffort: input.reasoningEffort,
  });
}
