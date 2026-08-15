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

function v12Seed(protocol: string): Record<string, unknown> {
  return {
    [V12_SETTINGS_STORAGE_KEY]: {
      appearance: { theme: "dark" },
      archivedSegmentPrompts: [],
      imageCapabilities: [],
      profiles: [
        {
          baseUrl: "https://api.example.test/v1",
          hostPermission: "granted",
          id: "profile-a",
          models: [
            {
              enabled: true,
              id: "gpt-5.6-sol",
              source: "discovered",
              verification: "verified",
            },
          ],
          name: "OpenAI",
          protocol,
        },
      ],
      promptPresets: [],
      speech: { groqApiKeyConfigured: false },
      taskSelections: {
        chat: {
          modelId: "gpt-5.6-sol",
          profileId: "profile-a",
          reasoningEffort: "provider-default",
        },
        segments: null,
        summary: null,
      },
      version: 12,
    },
    [V12_SETTINGS_SECRET_STORAGE_KEY]: {
      groqApiKey: null,
      providerApiKeys: { "profile-a": "provider-key-for-tests-4821" },
      removedProviderKeyIds: [],
      version: 12,
    },
  };
}

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

describe("v13 profile protocol wiring (ticket 07)", () => {
  it("routes openai-responses profiles through the Responses endpoint at the task gateway", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-5.6-sol" }] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return sseResponse([
        '{"type":"response.output_text.delta","delta":{"text":"总结"}}',
        '{"type":"response.completed"}',
      ]);
    });
    const { storage } = createStorage(v12Seed("openai-compatible"));
    const store = createProviderProfileSettingsStore({ storage, fetch });
    // v12 数据自动迁移：openai-compatible → openai-chat。
    const profiles = await store.loadProviderProfiles();
    expect(profiles[0]?.protocol).toBe("openai-chat");

    const gateway = await store.createTaskProviderGateway(
      "chat",
      { modelId: "gpt-5.6-sol", reasoningEffort: "auto" },
      { fetch, now: () => 1 },
    );
    await collect(
      gateway.stream({
        kind: "chat",
        messages: [
          { content: "你是助手", role: "system" },
          { content: "你好", role: "user" },
        ],
        model: (await gateway.discoverModels())[0],
        reasoningEffort: "high",
      }),
    );
    // openai-chat 默认走 chat/completions。
    expect(urls.at(-1)).toContain("/chat/completions");
  });

  it("routes an explicitly configured openai-responses profile through /v1/responses", async () => {
    const urls: string[] = [];
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "gpt-5.6-sol" }] }), {
          headers: { "content-type": "application/json" },
          status: 200,
        });
      }
      return sseResponse([
        '{"type":"response.output_text.delta","delta":{"text":"总结"}}',
        '{"type":"response.completed"}',
      ]);
    });
    const { storage, values } = createStorage(v12Seed("openai-responses"));
    const store = createProviderProfileSettingsStore({ storage, fetch });
    const profiles = await store.loadProviderProfiles();
    expect(profiles[0]?.protocol).toBe("openai-responses");

    const gateway = await store.createTaskProviderGateway(
      "chat",
      { modelId: "gpt-5.6-sol", reasoningEffort: "auto" },
      { fetch, now: () => 1 },
    );
    const models = await gateway.discoverModels();
    await collect(
      gateway.stream({
        kind: "chat",
        messages: [{ content: "你好", role: "user" }],
        model: models[0],
        reasoningEffort: "high",
      }),
    );
    expect(urls.at(-1)).toContain("/responses");
    expect(urls.at(-1)).not.toContain("/chat/completions");
    // v13 持久化协议字段。
    const v13Settings = values["muzhi.settings.v13"] as {
      readonly profiles: readonly { readonly protocol: string }[];
    };
    expect(v13Settings.profiles[0]?.protocol).toBe("openai-responses");
  });
});
