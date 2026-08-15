import { describe, expect, it } from "vitest";

import {
  createAiGenerationRequest,
  createAiModelDescriptor,
} from "../../src/application/ai/provider-contract";

const model = {
  capabilities: {
    contextWindowCharacters: 4_000,
    maxOutputCharacters: 1_000,
    supportedReasoningEfforts: ["none"] as const,
    supportsAttachments: false,
    supportsReasoning: false,
    supportsStreaming: true,
    supportsWebSearch: false,
  },
  discoveredAt: 1,
  displayName: "Test model",
  modelId: "test-model",
  providerId: "test-provider",
};

describe("AI provider contract", () => {
  it("fails closed when image attachments are supplied to a model that did not declare support", () => {
    const request = {
      attachments: [
        {
          attachmentId: "attachment-image-1",
          currentTimeMs: 12_000,
          mimeType: "image/png",
          sizeBytes: 1_024,
          videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
        },
      ],
      kind: "chat",
      messages: [{ content: "解释这张图", role: "user" }],
      model,
      reasoningEffort: "auto",
    } as Parameters<typeof createAiGenerationRequest>[0];

    expect(() => createAiGenerationRequest(request)).toThrow(
      /model.*(?:image|attachment).*support/i,
    );
  });

  it("preserves only safe attachment handles when the model explicitly declares image support", () => {
    const request = createAiGenerationRequest({
      attachments: [
        {
          attachmentId: "attachment-image-1",
          currentTimeMs: 12_000,
          mimeType: "image/png",
          sizeBytes: 1_024,
          videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
        },
      ],
      kind: "chat",
      messages: [{ content: "解释这张图", role: "user" }],
      model: {
        ...model,
        capabilities: { ...model.capabilities, supportsAttachments: true },
      },
      reasoningEffort: "auto",
    } as Parameters<typeof createAiGenerationRequest>[0]);

    expect(Reflect.get(request, "attachments")).toEqual([
      {
        attachmentId: "attachment-image-1",
        currentTimeMs: 12_000,
        mimeType: "image/png",
        sizeBytes: 1_024,
        videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
      },
    ]);
    expect(JSON.stringify(request)).not.toMatch(/data:image|base64|blob:/i);
  });

  it("freezes only declared capabilities and requires actual streaming support", () => {
    expect(createAiModelDescriptor(model)).toEqual(model);
    expect(
      createAiGenerationRequest({
        kind: "chat",
        messages: [{ content: "你好", role: "user" }],
        model,
        reasoningEffort: "auto",
      }),
    ).toMatchObject({ kind: "chat", model: { modelId: "test-model" } });
    expect(() =>
      createAiGenerationRequest({
        kind: "chat",
        messages: [{ content: "你好", role: "user" }],
        model: {
          ...model,
          capabilities: { ...model.capabilities, supportsStreaming: false },
        },
        reasoningEffort: "auto",
      }),
    ).toThrow(/does not support streaming/i);
  });

  it("rejects URL-shaped identifiers and oversized prompt messages", () => {
    expect(() =>
      createAiModelDescriptor({ ...model, providerId: "https://provider" }),
    ).toThrow(/safe identifier/i);
    expect(() =>
      createAiGenerationRequest({
        kind: "chat",
        messages: [{ content: "x".repeat(4_001), role: "user" }],
        model,
        reasoningEffort: "auto",
      }),
    ).toThrow(/message is invalid/i);
  });

  it("accepts safe provider-namespaced model identifiers", () => {
    expect(
      createAiModelDescriptor({
        ...model,
        modelId: "openrouter/meta-llama/llama-3.1-8b-instruct",
      }).modelId,
    ).toBe("openrouter/meta-llama/llama-3.1-8b-instruct");
    expect(() =>
      createAiModelDescriptor({ ...model, modelId: "//provider/model" }),
    ).toThrow(/safe identifier/i);
    expect(() =>
      createAiModelDescriptor({ ...model, modelId: "provider\\model" }),
    ).toThrow(/safe identifier/i);
  });

  it("accepts only reasoning efforts explicitly supported by the selected model", () => {
    const reasoningModel = {
      ...model,
      capabilities: {
        ...model.capabilities,
        supportedReasoningEfforts: ["none", "low", "high"] as const,
        supportsReasoning: true,
      },
    };

    expect(
      createAiGenerationRequest({
        kind: "summary",
        messages: [{ content: "总结", role: "user" }],
        model: reasoningModel,
        reasoningEffort: "auto",
      }).reasoningEffort,
    ).toBe("auto");
    expect(
      createAiGenerationRequest({
        kind: "summary",
        messages: [{ content: "总结", role: "user" }],
        model: reasoningModel,
        reasoningEffort: "high",
      }).reasoningEffort,
    ).toBe("high");
    expect(() =>
      createAiGenerationRequest({
        kind: "summary",
        messages: [{ content: "总结", role: "user" }],
        model: reasoningModel,
        reasoningEffort: "medium",
      }),
    ).toThrow(/reasoning effort/i);
    expect(() =>
      createAiGenerationRequest({
        kind: "chat",
        messages: [{ content: "你好", role: "user" }],
        model,
        reasoningEffort: "high",
      }),
    ).toThrow(/reasoning effort/i);
  });

  it("passes user-defined custom reasoning efforts through without a support-set check", () => {
    const reasoningModel = {
      ...model,
      capabilities: {
        ...model.capabilities,
        supportedReasoningEfforts: ["none", "low", "high"] as const,
        supportsReasoning: true,
      },
    };
    // 自定义档位（如官网新出的 ultra）不在模型支持集中，仍原样透传。
    expect(
      createAiGenerationRequest({
        kind: "summary",
        messages: [{ content: "总结", role: "user" }],
        model: reasoningModel,
        reasoningEffort: "ultra",
      }).reasoningEffort,
    ).toBe("ultra");
    expect(
      createAiGenerationRequest({
        kind: "chat",
        messages: [{ content: "你好", role: "user" }],
        model: reasoningModel,
        reasoningEffort: "think-3",
      }).reasoningEffort,
    ).toBe("think-3");
    // 非法自定义值仍被拒绝。
    expect(() =>
      createAiGenerationRequest({
        kind: "chat",
        messages: [{ content: "你好", role: "user" }],
        model: reasoningModel,
        reasoningEffort: "ULTRA_MODE!",
      }),
    ).toThrow(/reasoning effort/i);
    expect(() =>
      createAiGenerationRequest({
        kind: "chat",
        messages: [{ content: "你好", role: "user" }],
        model: reasoningModel,
        reasoningEffort: "",
      }),
    ).toThrow(/reasoning effort/i);
  });

  it("keeps reasoning capabilities internally consistent and deeply frozen", () => {
    const descriptor = createAiModelDescriptor(model);
    expect(Object.isFrozen(descriptor.capabilities)).toBe(true);
    expect(
      Object.isFrozen(descriptor.capabilities.supportedReasoningEfforts),
    ).toBe(true);
    expect(() =>
      createAiModelDescriptor({
        ...model,
        capabilities: {
          ...model.capabilities,
          supportedReasoningEfforts: ["none", "high"],
        },
      }),
    ).toThrow(/reasoning/i);
    expect(() =>
      createAiModelDescriptor({
        ...model,
        capabilities: {
          ...model.capabilities,
          supportedReasoningEfforts: ["none"],
          supportsReasoning: true,
        },
      }),
    ).toThrow(/reasoning/i);
  });

  it("enforces aggregate context and message-count limits", () => {
    expect(() =>
      createAiGenerationRequest({
        kind: "chat",
        messages: [
          { content: "x".repeat(2_100), role: "user" },
          { content: "y".repeat(2_100), role: "assistant" },
        ],
        model,
        reasoningEffort: "none",
      }),
    ).toThrow(/context window/i);
    expect(() =>
      createAiGenerationRequest({
        kind: "chat",
        messages: Array.from({ length: 257 }, () => ({
          content: "x",
          role: "user" as const,
        })),
        model,
        reasoningEffort: "none",
      }),
    ).toThrow(/message count/i);
  });
});
