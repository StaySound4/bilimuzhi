import { describe, expect, it, vi } from "vitest";

import { createAiProviderGatewayFromSettings } from "../../src/infrastructure/ai/provider-gateway";

function modelResponse(protocol: "claude" | "gemini" | "openai") {
  if (protocol === "claude") return { data: [{ id: "claude-live" }] };
  if (protocol === "gemini") {
    return { models: [{ name: "models/gemini-live" }] };
  }
  return { data: [{ id: "openai-live" }] };
}

describe("settings provider gateway facade", () => {
  it.each(["openai", "claude", "gemini"] as const)(
    "creates %s discovery gateways without leaking the key",
    async (protocol) => {
      const key = `${protocol}-secret`;
      const fetch = vi.fn(async () => ({
        body: null,
        json: async () => modelResponse(protocol),
        ok: true,
        status: 200,
        text: async () => "",
      }));
      const gateway = createAiProviderGatewayFromSettings({
        apiKey: key,
        fetch,
        now: () => 1,
        settings: {
          baseUrl: "https://api.example.test/v1",
          protocol,
          providerId: `${protocol}-provider`,
        },
      });

      const models = await gateway.discoverModels();
      expect(models).toHaveLength(1);
      expect(models[0]?.providerId).toBe(`${protocol}-provider`);
      expect(JSON.stringify(models)).not.toContain(key);
      const firstCall = fetch.mock.calls[0] as unknown as [string];
      expect(firstCall[0]).not.toContain(key);
    },
  );

  it("keeps unknown discovered models conservative", async () => {
    const gateway = createAiProviderGatewayFromSettings({
      apiKey: "secret",
      fetch: async () => ({
        body: null,
        json: async () => ({ data: [{ id: "provider/future-model" }] }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
      now: () => 1,
      settings: {
        baseUrl: "https://api.example.test",
        protocol: "openai",
        providerId: "custom-provider",
      },
    });

    await expect(gateway.discoverModels()).resolves.toMatchObject([
      {
        modelId: "provider/future-model",
        capabilities: {
          supportedReasoningEfforts: ["none"],
          supportsReasoning: false,
        },
      },
    ]);
  });

  it("detects every safe API model and exposes the full known reasoning scale", async () => {
    const gateway = createAiProviderGatewayFromSettings({
      apiKey: "secret",
      fetch: async () => ({
        body: null,
        json: async () => ({
          data: [
            { id: "gpt-5.2" },
            { id: "openai/gpt-5.2-codex" },
            { id: "provider/new-model" },
          ],
        }),
        ok: true,
        status: 200,
        text: async () => "",
      }),
      now: () => 1,
      settings: {
        baseUrl: "https://api.example.test",
        protocol: "openai",
        providerId: "provider-a",
      },
    });

    const models = await gateway.discoverModels();
    expect(models.map((model) => model.modelId)).toEqual([
      "gpt-5.2",
      "openai/gpt-5.2-codex",
      "provider/new-model",
    ]);
    expect(models[0]?.capabilities.supportedReasoningEfforts).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(models[1]?.capabilities.supportedReasoningEfforts).toEqual([
      "none",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
    ]);
    expect(models[2]?.capabilities.supportedReasoningEfforts).toEqual(["none"]);
  });

  it("uses the MiMo api-key header for discovery", async () => {
    const fetch = vi.fn(async () => ({
      body: null,
      json: async () => ({ data: [{ id: "mimo-v2.5-pro" }] }),
      ok: true,
      status: 200,
      text: async () => "",
    }));
    const gateway = createAiProviderGatewayFromSettings({
      apiKey: "mimo-secret",
      fetch,
      now: () => 1,
      settings: {
        baseUrl: "https://api.xiaomimimo.com/v1",
        protocol: "openai",
        providerId: "mimo",
      },
    });

    await gateway.discoverModels();
    const call = fetch.mock.calls[0] as unknown as [
      string,
      { readonly headers: Readonly<Record<string, string>> },
    ];
    expect(call[1].headers["api-key"]).toBe("mimo-secret");
    expect(call[1].headers.Authorization).toBeUndefined();
  });
});
