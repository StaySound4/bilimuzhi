import { describe, expect, it } from "vitest";

import type {
  AiGenerationRequest,
  AiModelCapabilities,
  AiProviderStreamEvent,
} from "../../src/application/ai/provider-contract";
import { AiProviderError } from "../../src/application/ai/provider-error";
import { StreamingProviderAdapter } from "../../src/infrastructure/ai/streaming-provider-adapter";
import { mergeModelCapabilities } from "../../src/infrastructure/ai/model-capability-registry";
const capabilities: AiModelCapabilities = {
  contextWindowCharacters: 4_000,
  maxOutputCharacters: 1_000,
  supportedReasoningEfforts: ["none"],
  supportsAttachments: false,
  supportsReasoning: false,
  supportsStreaming: true,
  supportsWebSearch: false,
};

const fallbackCapabilities: AiModelCapabilities = {
  ...capabilities,
  contextWindowCharacters: 2_000,
  maxOutputCharacters: 500,
};

const request: AiGenerationRequest = {
  kind: "chat",
  messages: [{ content: "你好", role: "user" }],
  model: {
    capabilities,
    discoveredAt: 1,
    displayName: "Known",
    modelId: "known-model",
    providerId: "provider-b",
  },
  reasoningEffort: "auto",
};

function createAdapter(input: {
  readonly discoverModels?: () => Promise<unknown>;
  readonly readDeclaredCapabilities?: (
    entry: unknown,
    providerId: string,
  ) => Partial<AiModelCapabilities> | null;
  readonly resolveCapabilities?: (
    modelId: string,
  ) => AiModelCapabilities | null;
  readonly resolveFamily?: (
    modelId: string,
    providerId?: string,
  ) => { readonly familyId: string } | null;
  readonly stream?: (request: AiGenerationRequest) => AsyncIterable<unknown>;
}) {
  return new StreamingProviderAdapter({
    fallbackCapabilities,
    mergeCapabilities: mergeModelCapabilities,
    now: () => 10,
    providerId: "provider-b",
    readDeclaredCapabilities: input.readDeclaredCapabilities,
    resolveCapabilities:
      input.resolveCapabilities ??
      ((modelId) => (modelId === "known-model" ? capabilities : null)),
    resolveFamily: input.resolveFamily,
    transport: {
      discoverModels:
        input.discoverModels ?? (async () => [{ id: "known-model" }]),
      stream:
        input.stream ??
        async function* () {
          yield { type: "started" };
          yield { delta: "部分", type: "delta" };
          yield { output: "完成", type: "completed" };
        },
    },
  });
}

async function collect(
  source: AsyncIterable<AiProviderStreamEvent>,
): Promise<AiProviderStreamEvent[]> {
  const events: AiProviderStreamEvent[] = [];
  for await (const event of source) events.push(event);
  return events;
}

describe("streaming AI provider adapter", () => {
  it("keeps safe dynamically discovered models, deduplicates, and uses conservative fallback capabilities", async () => {
    const adapter = createAdapter({
      discoverModels: async () => [
        { id: "known-model", name: "Known model" },
        { id: "unknown-model", name: "Dynamic model" },
        { id: "unknown-model", name: "Duplicate" },
        { id: "https://raw-provider-url" },
        { id: "x".repeat(129) },
      ],
    });
    await expect(adapter.discoverModels()).resolves.toEqual([
      {
        capabilities,
        discoveredAt: 10,
        displayName: "Known model",
        modelId: "known-model",
        providerId: "provider-b",
      },
      {
        capabilities: fallbackCapabilities,
        discoveredAt: 10,
        displayName: "Dynamic model",
        modelId: "unknown-model",
        providerId: "provider-b",
      },
    ]);
    await expect(collect(adapter.stream(request))).resolves.toEqual([
      { type: "started" },
      { delta: "部分", type: "delta" },
      { output: "完成", type: "completed" },
    ]);
  });

  it("normalizes safe model arrays from common proxy response wrappers", async () => {
    for (const response of [
      { data: [{ id: "model-data" }] },
      { models: [{ id: "model-models" }] },
      { items: [{ id: "model-items" }] },
      { available: ["model-available"] },
      { list: [{ name: "model-list" }] },
      { result: { models: [{ model: "model-result" }] } },
    ]) {
      const adapter = createAdapter({ discoverModels: async () => response });
      const models = await adapter.discoverModels();
      expect(models).toHaveLength(1);
      expect(models[0].modelId).toMatch(/^model-/);
    }
  });

  it("publishes bounded reasoning separately and stops at the first terminal event", async () => {
    const adapter = createAdapter({
      stream: async function* () {
        yield { type: "started" };
        yield { delta: "思考", type: "reasoning" };
        yield { delta: "x".repeat(2_000_001), type: "reasoning" };
        yield { delta: "回答", type: "delta" };
        yield { output: "完成", type: "completed" };
        yield { delta: "不应出现", type: "delta" };
      },
    });

    await expect(collect(adapter.stream(request))).resolves.toEqual([
      { type: "started" },
      { delta: "思考", type: "reasoning" },
      { delta: "回答", type: "delta" },
      { output: "完成", type: "completed" },
    ]);
  });

  it("normalizes invalid raw frames and provider failures without exposing raw errors", async () => {
    const adapter = createAdapter({
      stream: async function* () {
        yield { rawResponse: "secret", type: "delta" };
        yield { code: "vendor_secret", retryable: false, type: "failed" };
        throw { message: "provider secret", status: 429 };
      },
    });
    await expect(collect(adapter.stream(request))).resolves.toEqual([
      { code: "RATE_LIMITED", retryable: true, type: "failed" },
    ]);
  });

  it("classifies a provider that ends after confirmed output as an early end instead of a network guess", async () => {
    const adapter = createAdapter({
      stream: async function* () {
        yield { type: "started" };
        yield { delta: "confirmed partial output", type: "delta" };
      },
    });

    await expect(collect(adapter.stream(request))).resolves.toEqual([
      { type: "started" },
      { delta: "confirmed partial output", type: "delta" },
      { code: "PROVIDER_EARLY_END", retryable: true, type: "failed" },
    ]);
  });

  it.each([
    ["OUTPUT_LIMIT_REACHED", true],
    ["CONTENT_SAFETY_BLOCKED", false],
  ] as const)(
    "preserves the safe %s terminal category from the provider boundary",
    async (code, retryable) => {
      const adapter = createAdapter({
        stream: async function* () {
          yield { type: "started" };
          yield { delta: "confirmed partial output", type: "delta" };
          yield { code, retryable, type: "failed" };
        },
      });

      await expect(collect(adapter.stream(request))).resolves.toEqual([
        { type: "started" },
        { delta: "confirmed partial output", type: "delta" },
        { code, retryable, type: "failed" },
      ]);
    },
  );

  it("redacts prebuilt provider errors and preserves safe namespaced model IDs", async () => {
    const models = await createAdapter({
      discoverModels: async () => ["Qwen/Qwen2.5-72B-Instruct"],
    }).discoverModels();
    expect(models[0]?.modelId).toBe("Qwen/Qwen2.5-72B-Instruct");

    const adapter = createAdapter({
      discoverModels: async () => {
        throw new AiProviderError(
          "NETWORK_ERROR",
          "Authorization: Bearer provider-secret",
          true,
        );
      },
    });
    await expect(adapter.discoverModels()).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "The AI provider request could not be completed",
    });
    await expect(adapter.discoverModels()).rejects.not.toThrow(
      /provider-secret/,
    );
  });

  it("probes unknown openai models and upgrades capabilities when reasoning appears in the stream", async () => {
    const streamed: AiGenerationRequest[] = [];
    const adapter = createAdapter({
      discoverModels: async () => [{ id: "mystery-model-v1" }],
      stream: async function* (request) {
        streamed.push(request);
        yield { type: "started" };
        yield { delta: "先思考", type: "reasoning" };
        yield { delta: "391", type: "delta" };
        yield { output: "391", type: "completed" };
      },
    });
    const models = await adapter.discoverModels();
    expect(models[0]).toMatchObject({
      modelId: "mystery-model-v1",
      capabilities: {
        supportsReasoning: true,
        supportedReasoningEfforts: [
          "none",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ],
      },
    });
    expect(streamed).toHaveLength(1);
    expect(streamed[0].model.modelId).toBe("mystery-model-v1");
    expect(streamed[0].reasoningEffort).toBe("low");
  });

  it("keeps the conservative fallback when the probe stream shows no reasoning", async () => {
    const adapter = createAdapter({
      discoverModels: async () => [{ id: "plain-model" }],
    });
    const models = await adapter.discoverModels();
    expect(models[0]?.capabilities.supportsReasoning).toBe(false);
    expect(models[0]?.capabilities.supportedReasoningEfforts).toEqual(["none"]);
  });

  it("does not probe known registry models or declared non-reasoning models", async () => {
    const streamed: AiGenerationRequest[] = [];
    const adapter = createAdapter({
      discoverModels: async () => [
        { id: "known-model" },
        {
          id: "declared-plain",
          supported_parameters: ["max_tokens"],
        },
      ],
      readDeclaredCapabilities: (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        "supported_parameters" in entry
          ? { supportsReasoning: false }
          : null,
      stream: async function* (request) {
        streamed.push(request);
        yield { type: "started" };
        yield { delta: "思考", type: "reasoning" };
        yield { output: "x", type: "completed" };
      },
    });
    const models = await adapter.discoverModels();
    expect(streamed).toHaveLength(0);
    expect(models[0]?.capabilities.supportsReasoning).toBe(false);
    expect(models[1]?.capabilities.supportsReasoning).toBe(false);
  });

  it("keeps family-table efforts when the provider declares generic reasoning parameters", async () => {
    // 生产环境 providerId 是 profile-<uuid>，readDeclaredModelCapabilities
    // 的 "deepseek" 字符串保护不生效；家族表必须优先于声明档位，
    // 避免 DeepSeek 模型在 UI 上出现官方不存在的 medium/xhigh。
    const adapter = createAdapter({
      discoverModels: async () => [
        {
          id: "deepseek-chat",
          supported_parameters: ["reasoning", "thinking"],
        },
      ],
      readDeclaredCapabilities: () => ({
        contextWindowCharacters: 60_000,
        supportsReasoning: true,
        supportedReasoningEfforts: [
          "none",
          "minimal",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ],
      }),
      resolveCapabilities: () => ({
        ...capabilities,
        supportedReasoningEfforts: ["none", "low", "high", "max"],
        supportsReasoning: true,
      }),
      resolveFamily: () => ({ familyId: "deepseek" }),
    });
    const models = await adapter.discoverModels();
    expect(models[0]?.capabilities.supportedReasoningEfforts).toEqual([
      "none",
      "low",
      "high",
      "max",
    ]);
    // 家族保护只挡档位集合，其余声明字段仍生效。
    expect(models[0]?.capabilities.contextWindowCharacters).toBe(60_000);
  });

  it("lets provider declarations override efforts for models outside any family", async () => {
    const adapter = createAdapter({
      discoverModels: async () => [
        { id: "unknown-model", supported_parameters: ["reasoning"] },
      ],
      readDeclaredCapabilities: () => ({
        supportsReasoning: true,
        supportedReasoningEfforts: ["none", "high"],
      }),
    });
    const models = await adapter.discoverModels();
    expect(models[0]?.capabilities.supportedReasoningEfforts).toEqual([
      "none",
      "high",
    ]);
  });
});
