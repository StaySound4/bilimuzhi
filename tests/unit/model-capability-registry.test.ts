import { describe, expect, it } from "vitest";

import {
  nearestSupportedEffort,
  resolveKnownModelCapabilities,
  resolveKnownModelFamilies,
  resolveKnownModelFamily,
} from "../../src/infrastructure/ai/model-capability-registry";

describe("model capability registry family table", () => {
  it("maps gpt-5.6-sol to its official effort list with medium default", () => {
    expect(resolveKnownModelCapabilities("gpt-5.6-sol")).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
      supportsReasoning: true,
    });
    expect(resolveKnownModelCapabilities("openai/gpt-5.6-sol")).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
    });
    const family = resolveKnownModelFamily("gpt-5.6-sol");
    expect(family?.defaultReasoningEffort).toBe("medium");
    expect(family?.sourceUrl).toMatch(/platform\.openai\.com/);
  });

  it("maps deepseek-pro into the DeepSeek family without medium/xhigh", () => {
    // deepseek-pro 此前因正则漏匹配落入全档位兜底；现在必须归入 DeepSeek 家族。
    for (const modelId of [
      "deepseek-pro",
      "deepseek-chat",
      "deepseek-reasoner",
      "deepseek-v4-flash",
      "deepseek/deepseek-chat",
    ]) {
      expect(resolveKnownModelCapabilities(modelId), modelId).toMatchObject({
        supportedReasoningEfforts: ["none", "low", "high", "max"],
        supportsReasoning: true,
      });
    }
    const family = resolveKnownModelFamily("deepseek-pro");
    expect(family?.defaultReasoningEffort).toBe("high");
    expect(family?.sourceUrl).toMatch(/api-docs\.deepseek\.com/);
    // 未识别 deepseek 前缀外的模型不落入家族。
    expect(resolveKnownModelCapabilities("deepseek-not-a-model")).toBeNull();
  });

  it("recognizes the Anthropic family with its official effort list", () => {
    for (const modelId of [
      "claude-opus-4-7",
      "claude-sonnet-4-5",
      "anthropic/claude-opus-4-7",
    ]) {
      expect(resolveKnownModelCapabilities(modelId), modelId).toMatchObject({
        supportedReasoningEfforts: [
          "none",
          "low",
          "medium",
          "high",
          "xhigh",
          "max",
        ],
        supportsReasoning: true,
      });
    }
    const family = resolveKnownModelFamily("claude-opus-4-7");
    expect(family?.defaultReasoningEffort).toBe("high");
    expect(family?.sourceUrl).toMatch(/docs\.claude\.com/);
  });

  it("recognizes the OpenRouter family by provider id", () => {
    expect(
      resolveKnownModelCapabilities("deepseek/deepseek-chat", "openrouter"),
    ).toMatchObject({
      supportedReasoningEfforts: [
        "xhigh",
        "high",
        "medium",
        "low",
        "minimal",
        "none",
      ],
      supportsReasoning: true,
    });
    const family = resolveKnownModelFamily("openai/gpt-5.6-sol", "openrouter");
    expect(family?.familyId).toBe("openrouter");
    expect(family?.sourceUrl).toMatch(/openrouter\.ai/);
  });

  it("recognizes the Ollama family by provider id with its effort list", () => {
    expect(
      resolveKnownModelCapabilities("llama3.1:8b", "ollama"),
    ).toMatchObject({
      supportedReasoningEfforts: ["high", "medium", "low", "max", "none"],
      supportsReasoning: true,
    });
    const family = resolveKnownModelFamily("qwen2.5:7b", "ollama");
    expect(family?.familyId).toBe("ollama");
    expect(family?.sourceUrl).toMatch(/docs\.ollama\.com/);
  });

  it("recognizes the Gemini family with budget-tier efforts", () => {
    expect(resolveKnownModelCapabilities("gemini-2.5-pro")).toMatchObject({
      supportedReasoningEfforts: ["none", "low", "medium", "high"],
      supportsReasoning: true,
    });
    const family = resolveKnownModelFamily("gemini-3-pro");
    expect(family?.defaultReasoningEffort).toBe("medium");
    expect(family?.sourceUrl).toMatch(/google/);
  });

  it("keeps GLM and Kimi K3 family entries", () => {
    expect(resolveKnownModelCapabilities("glm-5")).toMatchObject({
      supportedReasoningEfforts: [
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ],
    });
    expect(resolveKnownModelCapabilities("kimi-k3")).toMatchObject({
      supportedReasoningEfforts: ["low", "high", "max"],
    });
  });

  it("falls back to null for unrecognized models", () => {
    expect(resolveKnownModelCapabilities("unknown-live-model")).toBeNull();
    expect(resolveKnownModelFamily("unknown-live-model")).toBeNull();
  });

  it("carries a source URL on every family entry", () => {
    for (const family of resolveKnownModelFamilies()) {
      expect(family.sourceUrl, family.familyId).toMatch(/^https?:\/\//);
      expect(family.defaultReasoningEffort.length).toBeGreaterThan(0);
      expect(family.supportedReasoningEfforts.length).toBeGreaterThan(0);
    }
  });

  it("exposes the official DeepSeek server-side effort mapping table", () => {
    // 官方映射：medium→high、xhigh→high（服务端按 high 处理）。
    expect(resolveKnownModelFamily("deepseek-chat")?.effortMappings).toEqual({
      medium: "high",
      xhigh: "high",
    });
  });

  it("maps an unsupported built-in effort to the nearest supported one", () => {
    // 无映射表的家族按档位顺序（none<minimal<low<medium<high<xhigh<max）就近映射。
    expect(
      nearestSupportedEffort("medium", ["none", "low", "high", "max"]),
    ).toBe("low");
    expect(
      nearestSupportedEffort("xhigh", ["none", "low", "high", "max"]),
    ).toBe("high");
    expect(nearestSupportedEffort("high", ["none", "low", "high", "max"])).toBe(
      "high",
    );
    // 自定义档位不参与就近映射：调用方对自定义值直接原样透传。
    expect(nearestSupportedEffort("low", ["none"])).toBe("none");
  });
});
