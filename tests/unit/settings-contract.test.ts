import { describe, expect, it } from "vitest";

import type { AiModelDescriptor } from "../../src/application/ai/provider-contract";
import {
  createAiModelSelection,
  createBilimuzhiSettings,
  isBilimuzhiSettings,
} from "../../src/application/settings-contract";

const model: AiModelDescriptor = {
  capabilities: {
    contextWindowCharacters: 32_000,
    maxOutputCharacters: 8_000,
    supportedReasoningEfforts: ["none", "low", "high"],
    supportsAttachments: false,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsWebSearch: false,
  },
  discoveredAt: 10,
  displayName: "Dynamic reasoning model",
  modelId: "provider/dynamic-reasoning",
  providerId: "provider-a",
};

describe("Bilimuzhi settings contract", () => {
  it("keeps all API-key material out of the application DTO", () => {
    const settings = createBilimuzhiSettings({
      appearance: { theme: "dark" },
      provider: {
        apiKeyConfigured: true,
        protocol: "openai",
        providerId: "provider-a",
        selectedModel: null,
      },
      retention: {
        applyMode: "future-only",
        policy: { durationDays: 30, kind: "duration" },
      },
      version: 1,
    });

    expect(settings.provider).toEqual({
      apiKeyConfigured: true,
      protocol: "openai",
      providerId: "provider-a",
      selectedModel: null,
    });
    expect(JSON.stringify(settings)).not.toMatch(/secret|apiKeyMasked|apiKey"/);
    expect(isBilimuzhiSettings({ ...settings, apiKey: "provider-secret" })).toBe(
      false,
    );
    expect(Object.isFrozen(settings.provider)).toBe(true);
  });

  it("uses only the selected descriptor's actual reasoning efforts", () => {
    expect(createAiModelSelection(model, "high")).toEqual({
      modelId: "provider/dynamic-reasoning",
      reasoningEffort: "high",
    });
    expect(() => createAiModelSelection(model, "xhigh")).toThrow(
      /reasoning effort/i,
    );
  });

  it("accepts user-defined custom reasoning efforts and passes them through verbatim", () => {
    expect(createAiModelSelection(model, "ultra")).toEqual({
      modelId: "provider/dynamic-reasoning",
      reasoningEffort: "ultra",
    });
    const settings = createBilimuzhiSettings({
      appearance: { theme: "dark" },
      provider: {
        apiKeyConfigured: true,
        protocol: "openai",
        providerId: "provider-a",
        selectedModel: createAiModelSelection(model, "ultra"),
      },
      retention: { applyMode: "future-only", policy: { kind: "forever" } },
      version: 1,
    });
    expect(settings.provider.selectedModel?.reasoningEffort).toBe("ultra");
    // 非法自定义档位（空、超长、非法字符）仍被拒绝。
    expect(() => createAiModelSelection(model, "")).toThrow(
      /reasoning effort/i,
    );
    expect(() => createAiModelSelection(model, "a".repeat(25))).toThrow(
      /reasoning effort/i,
    );
    expect(() => createAiModelSelection(model, "ultra!")).toThrow(
      /reasoning effort/i,
    );
  });

  it("rejects missing fields, extra fields, and malformed versions", () => {
    const valid = createBilimuzhiSettings({
      appearance: { theme: "system" },
      provider: {
        apiKeyConfigured: false,
        protocol: "openai",
        providerId: "provider-a",
        selectedModel: null,
      },
      retention: {
        applyMode: "future-only",
        policy: { kind: "forever" },
      },
      version: 1,
    });
    expect(
      isBilimuzhiSettings({ ...valid, provider: { protocol: "openai" } }),
    ).toBe(false);
    expect(isBilimuzhiSettings({ ...valid, unexpected: true })).toBe(false);
    expect(isBilimuzhiSettings({ version: 2 })).toBe(false);
  });
});
