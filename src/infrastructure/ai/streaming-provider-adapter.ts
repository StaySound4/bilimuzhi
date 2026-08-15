import {
  createAiGenerationRequest,
  createAiModelDescriptor,
  type AiGenerationRequest,
  type AiModelCapabilities,
  type AiModelDescriptor,
  type AiProviderImageMimeType,
  type AiProviderGateway,
  type AiProviderStreamEvent,
} from "../../application/ai/provider-contract";
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError,
  type AiProviderErrorCode,
} from "../../application/ai/provider-error";

export interface UntrustedAiProviderTransport {
  discoverModels(): Promise<unknown>;
  stream(request: AiGenerationRequest): AsyncIterable<unknown>;
}

export interface StreamingProviderAdapterDependencies {
  readonly fallbackCapabilities: AiModelCapabilities;
  readonly now: () => number;
  readonly providerId: string;
  /** 仅 openai 协议参与推理能力探测；claude/gemini 不传推理参数。 */
  readonly protocol?: "claude" | "gemini" | "openai" | "openai-responses";
  /**
   * Applies capabilities the provider itself declared in its model listing.
   * Returning `null` keeps the known-model registry or conservative fallback.
   */
  readonly readDeclaredCapabilities?: (
    entry: unknown,
    providerId: string,
  ) => Partial<AiModelCapabilities> | null;
  readonly mergeCapabilities?: (
    base: AiModelCapabilities,
    declared: Partial<AiModelCapabilities> | null,
  ) => AiModelCapabilities;
  readonly resolveCapabilities: (
    modelId: string,
    providerId?: string,
  ) => AiModelCapabilities | null;
  /**
   * 命中已知家族（数据表）时，模型声明的泛化档位不覆盖官方档位集合。
   * 与 readDeclaredCapabilities 配合：家族数据优先，声明只补其余字段。
   */
  readonly resolveFamily?: (
    modelId: string,
    providerId?: string,
  ) => { readonly familyId: string } | null;
  readonly transport: UntrustedAiProviderTransport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeModelIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.startsWith("/") &&
    !value.includes("//") &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:+/-]+$/.test(value)
  );
}

const MODEL_LIST_KEYS = [
  "data",
  "models",
  "items",
  "available",
  "list",
] as const;

function extractModelList(
  value: unknown,
  depth = 0,
): readonly unknown[] | null {
  if (Array.isArray(value)) return value;
  if (!isRecord(value) || depth >= 2) return null;
  for (const key of MODEL_LIST_KEYS) {
    if (Array.isArray(value[key])) return value[key] as readonly unknown[];
  }
  return extractModelList(value.result, depth + 1);
}

function normalizeModelEntry(
  value: unknown,
): { readonly displayName: string; readonly modelId: string } | null {
  if (isSafeModelIdentifier(value)) {
    return { displayName: value, modelId: value };
  }
  if (!isRecord(value)) return null;
  const candidate = value.id ?? value.model ?? value.name;
  if (!isSafeModelIdentifier(candidate)) return null;
  const rawDisplayName =
    typeof value.name === "string" ? value.name.trim() : "";
  return {
    displayName:
      rawDisplayName.length > 0 && rawDisplayName.length <= 128
        ? rawDisplayName
        : candidate,
    modelId: candidate,
  };
}

function normalizeTransportError(error: unknown): AiProviderError {
  if (error instanceof AiProviderError) {
    const messages: Record<AiProviderErrorCode, string> = {
      AUTHENTICATION_REQUIRED: "The AI provider requires authentication",
      BACKGROUND_RECOVERY_FAILED: "The AI task could not be recovered",
      CONTENT_SAFETY_BLOCKED: "The AI provider blocked this content",
      CONTEXT_TOO_LONG: "The AI request exceeds the available context",
      INTERNAL_ERROR: "The AI provider returned an invalid response",
      NETWORK_ERROR: "The AI provider request could not be completed",
      OUTPUT_LIMIT_REACHED: "The AI provider reached its output limit",
      PERMISSION_DENIED: "The AI provider denied this request",
      PERSISTENCE_FAILED: "The AI output could not be saved",
      PROVIDER_BUSY: "The AI provider is temporarily short on resources",
      PROVIDER_EARLY_END: "The AI provider ended before completing output",
      RATE_LIMITED: "The AI provider is rate limited",
      STRUCTURED_OUTPUT_INVALID:
        "The AI provider returned invalid structured output",
      TIMEOUT: "The AI provider request timed out",
      USER_CANCELLED: "The AI request was cancelled",
      UNSUPPORTED_CAPABILITY:
        "The AI provider does not support this request configuration",
    };
    return new AiProviderError(
      error.code,
      messages[error.code],
      error.retryable,
    );
  }
  if (isRecord(error) && typeof error.status === "number") {
    if (error.status === 401) {
      return new AiProviderError(
        "AUTHENTICATION_REQUIRED",
        "The AI provider requires authentication",
        false,
      );
    }
    if (error.status === 403) {
      return new AiProviderError(
        "PERMISSION_DENIED",
        "The AI provider denied this request",
        false,
      );
    }
    if (error.status === 413 || error.status === 422) {
      return new AiProviderError(
        "CONTEXT_TOO_LONG",
        "The AI request exceeds the available context",
        false,
      );
    }
    if (error.status === 429) {
      return new AiProviderError(
        "RATE_LIMITED",
        "The AI provider is rate limited",
        true,
      );
    }
    if (error.status >= 500 && error.status <= 599) {
      return new AiProviderError(
        "NETWORK_ERROR",
        "The AI provider is temporarily unavailable",
        true,
      );
    }
  }
  return new AiProviderError(
    "NETWORK_ERROR",
    "The AI provider request could not be completed",
    true,
  );
}

function normalizeStreamEvent(value: unknown): AiProviderStreamEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  if (value.type === "started") return { type: "started" };
  if (
    (value.type === "delta" || value.type === "reasoning") &&
    typeof value.delta === "string" &&
    value.delta.length <= 2_000_000
  ) {
    return { delta: value.delta, type: value.type };
  }
  if (value.type === "image-output" && isRecord(value.descriptor)) {
    const descriptor = value.descriptor;
    if (
      descriptor.kind === "remote" &&
      typeof descriptor.url === "string" &&
      descriptor.url.length > 0 &&
      descriptor.url.length <= 2_048 &&
      !/[\r\n]/.test(descriptor.url)
    ) {
      return {
        descriptor: { kind: "remote", url: descriptor.url },
        type: "image-output",
      };
    }
    const mimeTypes = ["image/jpeg", "image/png", "image/webp"] as const;
    const maxEncodedBytes = Math.ceil((5 * 1_024 * 1_024 * 4) / 3) + 4;
    if (
      descriptor.kind === "inline" &&
      typeof descriptor.base64 === "string" &&
      descriptor.base64.length > 0 &&
      descriptor.base64.length <= maxEncodedBytes &&
      typeof descriptor.mimeType === "string" &&
      (mimeTypes as readonly string[]).includes(descriptor.mimeType) &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(descriptor.base64)
    ) {
      return {
        descriptor: {
          base64: descriptor.base64,
          kind: "inline",
          mimeType: descriptor.mimeType as AiProviderImageMimeType,
        },
        type: "image-output",
      };
    }
  }
  if (
    value.type === "completed" &&
    typeof value.output === "string" &&
    value.output.length <= 2_000_000
  ) {
    return { output: value.output, type: "completed" };
  }
  if (
    value.type === "failed" &&
    typeof value.code === "string" &&
    (AI_PROVIDER_ERROR_CODES as readonly string[]).includes(value.code) &&
    typeof value.retryable === "boolean"
  ) {
    return {
      code: value.code as AiProviderErrorCode,
      retryable: value.retryable,
      type: "failed",
    };
  }
  return null;
}

const REASONING_PROBE_PROMPT =
  "请一步一步思考后回答：17 乘以 23 等于多少？（只需给出数字）";
const MAX_PROBED_MODELS = 24;
const PROBE_CONCURRENCY = 4;
const PROBE_TIMEOUT_MS = 8_000;
const PROBED_REASONING_EFFORTS = Object.freeze([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const);

/**
 * 对未知模型发一次极小请求探测推理参数是否被接受：
 * 只要流中出现 reasoning 事件即认为支持（transport 的降级重试
 * 会让不支持模型以无思考参数成功，因此以事件而非状态码为准）。
 */
async function probeReasoningSupport(
  transport: UntrustedAiProviderTransport,
  modelId: string,
  providerId: string,
  now: () => number,
): Promise<boolean> {
  let descriptor: AiModelDescriptor;
  try {
    descriptor = createAiModelDescriptor({
      capabilities: {
        contextWindowCharacters: 32_000,
        maxOutputCharacters: 8_000,
        supportedReasoningEfforts: ["none", "low"],
        supportsAttachments: false,
        supportsReasoning: true,
        supportsStreaming: true,
        supportsWebSearch: false,
      },
      discoveredAt: now(),
      displayName: modelId,
      modelId,
      providerId,
    });
  } catch {
    return false;
  }
  let request: AiGenerationRequest;
  try {
    request = createAiGenerationRequest({
      kind: "chat",
      messages: [{ content: REASONING_PROBE_PROMPT, role: "user" }],
      model: descriptor,
      reasoningEffort: "low",
    });
  } catch {
    return false;
  }
  const timeout = new Promise<false>((resolve) => {
    globalThis.setTimeout(() => resolve(false), PROBE_TIMEOUT_MS);
  });
  const attempt = (async () => {
    try {
      for await (const raw of transport.stream(request)) {
        const event = normalizeStreamEvent(raw);
        if (event === null) continue;
        if (event.type === "reasoning") return true;
        if (event.type === "failed" || event.type === "completed") {
          return false;
        }
      }
      return false;
    } catch {
      return false;
    }
  })();
  return Promise.race([attempt, timeout]);
}

async function runReasoningProbes(
  candidates: ReadonlyArray<{
    readonly descriptor: AiModelDescriptor;
    readonly index: number;
  }>,
  transport: UntrustedAiProviderTransport,
  providerId: string,
  now: () => number,
): Promise<readonly boolean[]> {
  const results = new Array<boolean>(candidates.length).fill(false);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(PROBE_CONCURRENCY, candidates.length) },
    async () => {
      while (cursor < candidates.length) {
        const offset = cursor;
        cursor += 1;
        results[offset] = await probeReasoningSupport(
          transport,
          candidates[offset].descriptor.modelId,
          providerId,
          now,
        );
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export class StreamingProviderAdapter implements AiProviderGateway {
  constructor(
    private readonly dependencies: StreamingProviderAdapterDependencies,
  ) {}

  async discoverModels(): Promise<readonly AiModelDescriptor[]> {
    try {
      const rawModels = await this.dependencies.transport.discoverModels();
      const rawModelList = extractModelList(rawModels);
      if (rawModelList === null) {
        throw new AiProviderError(
          "INTERNAL_ERROR",
          "The AI provider returned an invalid model list",
          false,
        );
      }
      const seen = new Set<string>();
      let modelIndex = 0;
      const probeCandidates: Array<{
        descriptor: AiModelDescriptor;
        index: number;
      }> = [];
      const models = rawModelList.flatMap((raw) => {
        const normalized = normalizeModelEntry(raw);
        if (normalized === null) return [];
        const dedupeKey = `${this.dependencies.providerId}\u0000${normalized.modelId}`;
        if (seen.has(dedupeKey)) return [];
        const baseCapabilities =
          this.dependencies.resolveCapabilities(
            normalized.modelId,
            this.dependencies.providerId,
          ) ?? this.dependencies.fallbackCapabilities;
        const rawDeclared =
          this.dependencies.readDeclaredCapabilities?.(
            raw,
            this.dependencies.providerId,
          ) ?? null;
        // 已知家族（数据表）优先：命中家族时声明的泛化档位不覆盖
        // 官方档位集合（如 DeepSeek 只显示 none/low/high/max），
        // 其余声明字段（上下文/输出上限/附件等）仍然保留。
        const family =
          this.dependencies.resolveFamily?.(
            normalized.modelId,
            this.dependencies.providerId,
          ) ?? null;
        const declared =
          family !== null && rawDeclared !== null
            ? Object.freeze({
                ...rawDeclared,
                supportedReasoningEfforts: undefined,
              })
            : rawDeclared;
        const capabilities =
          this.dependencies.mergeCapabilities === undefined
            ? baseCapabilities
            : this.dependencies.mergeCapabilities(baseCapabilities, declared);
        try {
          const descriptor = createAiModelDescriptor({
            capabilities,
            discoveredAt: this.dependencies.now(),
            displayName: normalized.displayName,
            modelId: normalized.modelId,
            providerId: this.dependencies.providerId,
          });
          seen.add(dedupeKey);
          const knownCapabilities =
            this.dependencies.resolveCapabilities(
              normalized.modelId,
              this.dependencies.providerId,
            ) !== null;
          const declaredReasoning =
            declared === null ? undefined : declared.supportsReasoning;
          if (
            this.dependencies.protocol !== "claude" &&
            this.dependencies.protocol !== "gemini" &&
            !knownCapabilities &&
            declaredReasoning === undefined &&
            probeCandidates.length < MAX_PROBED_MODELS
          ) {
            probeCandidates.push({ descriptor, index: modelIndex });
          }
          modelIndex += 1;
          return [descriptor];
        } catch {
          return [];
        }
      });
      if (probeCandidates.length > 0) {
        const probed = await runReasoningProbes(
          probeCandidates,
          this.dependencies.transport,
          this.dependencies.providerId,
          this.dependencies.now,
        );
        for (const [offset, candidate] of probeCandidates.entries()) {
          if (!probed[offset]) continue;
          models[candidate.index] = createAiModelDescriptor({
            capabilities: {
              ...candidate.descriptor.capabilities,
              supportedReasoningEfforts: PROBED_REASONING_EFFORTS,
              supportsReasoning: true,
            },
            discoveredAt: candidate.descriptor.discoveredAt,
            displayName: candidate.descriptor.displayName,
            modelId: candidate.descriptor.modelId,
            providerId: candidate.descriptor.providerId,
          });
        }
      }
      models.sort((left, right) => left.modelId.localeCompare(right.modelId));
      return Object.freeze(models);
    } catch (error) {
      throw normalizeTransportError(error);
    }
  }

  async *stream(
    input: AiGenerationRequest,
  ): AsyncIterable<AiProviderStreamEvent> {
    let completed = false;
    try {
      const request = createAiGenerationRequest(input);
      for await (const raw of this.dependencies.transport.stream(request)) {
        const event = normalizeStreamEvent(raw);
        if (event === null) continue;
        yield event;
        if (event.type === "completed" || event.type === "failed") {
          completed = true;
          return;
        }
      }
      if (!completed) {
        yield {
          code: "PROVIDER_EARLY_END",
          retryable: true,
          type: "failed",
        };
      }
    } catch (error) {
      const normalized = normalizeTransportError(error);
      yield {
        code: normalized.code,
        retryable: normalized.retryable,
        type: "failed",
      };
    }
  }
}
