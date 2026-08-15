import { describe, expect, it, vi } from "vitest";

import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";
import {
  V12_SETTINGS_SECRET_STORAGE_KEY,
  V12_SETTINGS_STORAGE_KEY,
  createProviderProfileSettingsStore,
} from "../../src/infrastructure/provider-profile-settings";

function createStorage(seed: Record<string, unknown> = {}) {
  const values = structuredClone(seed);
  const storage: ChromeWorkspaceStorageArea = {
    get: vi.fn(async (key: string) => ({
      [key]: structuredClone(values[key]),
    })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
  };
  return { storage, values };
}

const ollamaSeed: Record<string, unknown> = {
  [V12_SETTINGS_STORAGE_KEY]: {
    appearance: { theme: "dark" },
    archivedSegmentPrompts: [],
    imageCapabilities: [],
    profiles: [
      {
        baseUrl: "http://localhost:11434/v1",
        hostPermission: "granted",
        id: "profile-ollama",
        models: [
          {
            enabled: true,
            id: "llama3.1:8b",
            source: "discovered",
            verification: "verified",
          },
        ],
        name: "Ollama",
        protocol: "openai-compatible",
      },
    ],
    promptPresets: [],
    speech: { groqApiKeyConfigured: false },
    taskSelections: {
      chat: {
        modelId: "llama3.1:8b",
        profileId: "profile-ollama",
        reasoningEffort: "provider-default",
      },
      segments: null,
      summary: null,
    },
    version: 12,
  },
  [V12_SETTINGS_SECRET_STORAGE_KEY]: {
    groqApiKey: null,
    providerApiKeys: { "profile-ollama": "ollama" },
    removedProviderKeyIds: [],
    version: 12,
  },
};

async function collect(source: AsyncIterable<unknown>) {
  const events: unknown[] = [];
  for await (const event of source) events.push(event);
  return events;
}

function sseResponse(events: readonly string[]) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

describe("Ollama provider wiring (ticket 08)", () => {
  it("creates an Ollama profile with a placeholder key and discovers localhost models", async () => {
    const { storage, values } = createStorage({});
    const store = createProviderProfileSettingsStore({
      permissions: { remove: async () => true, request: async () => true },
      storage,
    });
    const profile = await store.createProviderProfile({
      baseUrl: "http://localhost:11434/v1",
      name: "Ollama",
      protocol: "openai-chat",
    });
    expect(profile.baseUrl).toBe("http://localhost:11434/v1");
    expect(profile.hostPermission).toBe("granted");

    await store.saveProviderApiKey(profile.id, "ollama");
    const projected = (await store.loadProviderProfiles())[0];
    expect(projected?.apiKey.configured).toBe(true);
    expect(values["muzhi.settings.v13"]).toBeDefined();
  });

  it("discovers models from /v1/models and sends reasoning_effort on the chat path", async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    const fetch = vi.fn(
      async (input: URL | RequestInfo, init?: RequestInit) => {
        const url = String(input);
        urls.push(url);
        if (url.endsWith("/models")) {
          return new Response(
            JSON.stringify({ data: [{ id: "llama3.1:8b" }] }),
            {
              headers: { "content-type": "application/json" },
              status: 200,
            },
          );
        }
        bodies.push(String(init?.body ?? ""));
        return sseResponse([
          '{"choices":[{"delta":{"content":"你好"},"finish_reason":"stop"}]}',
          "[DONE]",
        ]);
      },
    );
    const { storage } = createStorage(structuredClone(ollamaSeed));
    const store = createProviderProfileSettingsStore({ storage, fetch });
    const gateway = await store.createTaskProviderGateway(
      "chat",
      { modelId: "llama3.1:8b", reasoningEffort: "auto" },
      { fetch, now: () => 1 },
    );
    const models = await gateway.discoverModels();
    expect(models[0]?.modelId).toBe("llama3.1:8b");
    // Ollama 家族档位（ticket 01 数据）：high/medium/low/max/none。
    expect(models[0]?.capabilities.supportedReasoningEfforts).toEqual([
      "high",
      "medium",
      "low",
      "max",
      "none",
    ]);

    await collect(
      gateway.stream({
        kind: "chat",
        messages: [{ content: "你好", role: "user" }],
        model: models[0],
        reasoningEffort: "high",
      }),
    );
    expect(urls.at(-1)).toContain("/chat/completions");
    expect(urls.at(-1)).toContain("localhost:11434");
    const body = JSON.parse(bodies[0]) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("high");
  });
});
