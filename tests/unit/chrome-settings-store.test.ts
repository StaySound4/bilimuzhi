import { describe, expect, it, vi } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  SETTINGS_SECRET_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SETTINGS_UI_PREFERENCES_STORAGE_KEY,
  createChromeSettingsStore,
} from "../../src/infrastructure/chrome-settings-store";
import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";

function createStorage(seed: Record<string, unknown> = {}) {
  const values = { ...seed };
  const storage: ChromeWorkspaceStorageArea = {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    }),
  };
  return { storage, values };
}

describe("Chrome settings store", () => {
  it("migrates the existing appearance preference", async () => {
    const { storage, values } = createStorage({
      [APPEARANCE_STORAGE_KEY]: {
        appearance: { theme: "dark" },
        conversationPaneWidthPx: 220,
        version: 2,
      },
    });

    const settings = await createChromeSettingsStore(storage).load();

    expect(settings.appearance.theme).toBe("dark");
    expect(settings.provider.apiKeyConfigured).toBe(false);
    expect(values[SETTINGS_STORAGE_KEY]).toMatchObject({
      appearance: { theme: "dark" },
      version: 1,
    });
  });

  it("never returns the API key and uses it only inside the gateway", async () => {
    const { storage, values } = createStorage();
    const store = createChromeSettingsStore(storage);
    await store.saveProviderConfiguration({
      baseUrl: "https://api.example.test/v1",
      protocol: "openai",
      providerId: "provider-a",
    });
    await store.saveApiKey("provider-secret-9876");

    const settings = await store.load();
    expect(settings.provider.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(settings)).not.toContain("provider-secret-9876");
    expect(JSON.stringify(values[SETTINGS_SECRET_STORAGE_KEY])).not.toContain(
      '"apiKey"',
    );

    const fetch = vi.fn(async () => ({
      body: null,
      json: async () => ({ data: [{ id: "provider/unknown-live-model" }] }),
      ok: true,
      status: 200,
      text: async () => "",
    }));
    const gateway = await store.createProviderGateway({ fetch, now: () => 42 });
    const models = await gateway.discoverModels();
    expect(models[0]).toMatchObject({
      modelId: "provider/unknown-live-model",
      capabilities: { supportedReasoningEfforts: ["none"] },
    });
    const firstCall = fetch.mock.calls[0] as unknown as [
      string,
      { readonly headers: Record<string, string> },
    ];
    expect(firstCall[1].headers).toMatchObject({
      Authorization: "Bearer provider-secret-9876",
    });
  });

  it("keeps a separate chat key for every provider", async () => {
    const { storage } = createStorage();
    const store = createChromeSettingsStore(storage);
    await store.saveProviderConfiguration({
      baseUrl: "https://provider-a.example/v1",
      protocol: "openai",
      providerId: "provider-a",
    });
    await store.saveApiKey("provider-a-secret");
    await store.saveProviderConfiguration({
      baseUrl: "https://provider-b.example/v1",
      protocol: "openai",
      providerId: "provider-b",
    });
    await store.saveApiKey("provider-b-secret");

    const fetchB = vi.fn(async () => ({
      body: null,
      json: async () => ({ data: [] }),
      ok: true,
      status: 200,
      text: async () => "",
    }));
    await (
      await store.createProviderGateway({ fetch: fetchB, now: () => 1 })
    ).discoverModels();
    expect(
      (
        fetchB.mock.calls[0] as unknown as [
          string,
          { headers: Record<string, string> },
        ]
      )[1].headers.Authorization,
    ).toBe("Bearer provider-b-secret");

    await store.saveProviderConfiguration({
      baseUrl: "https://provider-a.example/v1",
      protocol: "openai",
      providerId: "provider-a",
    });
    const fetchA = vi.fn(async () => ({
      body: null,
      json: async () => ({ data: [] }),
      ok: true,
      status: 200,
      text: async () => "",
    }));
    await (
      await store.createProviderGateway({ fetch: fetchA, now: () => 2 })
    ).discoverModels();
    expect(
      (
        fetchA.mock.calls[0] as unknown as [
          string,
          { headers: Record<string, string> },
        ]
      )[1].headers.Authorization,
    ).toBe("Bearer provider-a-secret");
  });

  it("migrates the legacy single key without exposing or discarding it", async () => {
    const { storage, values } = createStorage({
      [SETTINGS_SECRET_STORAGE_KEY]: {
        apiKey: "legacy-provider-secret",
        version: 1,
      },
      [SETTINGS_STORAGE_KEY]: {
        appearance: { theme: "system" },
        provider: {
          baseUrl: "https://api.deepseek.com",
          protocol: "openai",
          providerId: "deepseek",
          selectedModel: null,
        },
        retention: {
          applyMode: "future-only",
          policy: { durationDays: 7, kind: "duration" },
        },
        version: 1,
      },
    });
    const store = createChromeSettingsStore(storage);

    await expect(store.loadEditorState()).resolves.toMatchObject({
      configuredProviderIds: ["deepseek"],
      provider: { apiKeyConfigured: true, providerId: "deepseek" },
    });
    expect(values[SETTINGS_SECRET_STORAGE_KEY]).toEqual({
      groqApiKey: null,
      providerApiKeys: { deepseek: "legacy-provider-secret" },
      version: 2,
    });
  });

  it("falls back safely for malformed records", async () => {
    const { storage } = createStorage({
      [SETTINGS_SECRET_STORAGE_KEY]: { apiKey: 9, version: 1 },
      [SETTINGS_STORAGE_KEY]: { provider: { apiKey: "leak" }, version: 99 },
    });
    await expect(
      createChromeSettingsStore(storage).load(),
    ).resolves.toMatchObject({
      appearance: { theme: "system" },
      provider: { apiKeyConfigured: false },
      retention: {
        applyMode: "future-only",
        policy: { durationDays: 7, kind: "duration" },
      },
    });
  });

  it("uses an independent Groq speech key without switching the chat provider", async () => {
    const { storage } = createStorage();
    const store = createChromeSettingsStore(storage);
    await store.saveProviderConfiguration({
      baseUrl: "https://api.openai.com/v1",
      protocol: "openai",
      providerId: "openai",
    });
    await store.saveApiKey("chat-secret-1234");
    await store.saveGroqApiKey("groq-secret-9876");
    await expect(store.loadEditorState()).resolves.toMatchObject({
      provider: { providerId: "openai" },
      speech: { groqApiKeyConfigured: true },
    });
    const fetch = vi.fn(async () => ({
      headers: { get: () => null },
      json: async () => ({
        language: "zh",
        segments: [{ end: 1, start: 0, text: "测试" }],
      }),
      ok: true,
      status: 200,
    }));
    const provider = await store.createGroqWhisperProvider({ fetch });
    await provider.transcribe({
      chunk: {
        bytes: new Uint8Array([1]),
        endMs: 1_000,
        index: 0,
        mimeType: "audio/mpeg",
        startMs: 0,
      },
      chunkCount: 1,
      model: "whisper-large-v3",
      requestedLanguageMode: "zh",
      title: "测试",
    });
    const call = fetch.mock.calls[0] as unknown as [
      string,
      { readonly headers: Readonly<Record<string, string>> },
    ];
    expect(call[1].headers.Authorization).toBe("Bearer groq-secret-9876");
  });

  it("reveals the saved Groq key only through the explicit reveal path", async () => {
    const { storage } = createStorage();
    const store = createChromeSettingsStore(storage);
    // 未配置:reveal 返回 null(不抛错)。
    await expect(store.revealGroqApiKey()).resolves.toBeNull();
    // 保存后:reveal 返回明文。
    await store.saveV12GroqApiKey("groq-secret-9876");
    await expect(store.revealGroqApiKey()).resolves.toBe("groq-secret-9876");
    // 投影仍然只含 masked,不含明文。
    const projection = await store.loadGroqApiKeyProjection();
    expect(projection.configured).toBe(true);
    expect(projection.lastFour).toBe("9876");
    expect(JSON.stringify(projection)).not.toContain("groq-secret-9876");
  });

  it("persists non-secret speech, export, and prompt preferences", async () => {
    const { storage, values } = createStorage();
    const store = createChromeSettingsStore(storage);
    await expect(store.loadUiPreferences()).resolves.toEqual({
      exportPreference: { format: "markdown", includeTimestamps: true },
      promptTemplate: "",
      speechLanguage: "混合",
      speechRoutingMode: "balanced",
      taskPrompts: { chat: "", segments: "", summary: "" },
      uiLanguage: "zh-Hans",
      taskOutputLanguages: {
        chat: "zh-Hans",
        segments: "zh-Hans",
        summary: "zh-Hans",
      },
      version: 7,
    });

    const saved = await store.saveUiPreferences({
      exportPreference: { format: "srt", includeTimestamps: false },
      promptTemplate: "只回答字幕中有证据的内容",
      speechLanguage: "英文",
      speechRoutingMode: "standard-first",
      taskPrompts: { chat: "只用字幕作答", segments: "", summary: "" },
      uiLanguage: "zh-Hans",
      taskOutputLanguages: {
        chat: "zh-Hans",
        segments: "zh-Hans",
        summary: "zh-Hans",
      },
      version: 7,
    });

    expect(saved).toEqual({
      exportPreference: { format: "srt", includeTimestamps: false },
      promptTemplate: "只回答字幕中有证据的内容",
      speechLanguage: "英文",
      speechRoutingMode: "standard-first",
      taskPrompts: { chat: "只用字幕作答", segments: "", summary: "" },
      uiLanguage: "zh-Hans",
      taskOutputLanguages: {
        chat: "zh-Hans",
        segments: "zh-Hans",
        summary: "zh-Hans",
      },
      version: 7,
    });
    expect(values[SETTINGS_UI_PREFERENCES_STORAGE_KEY]).toEqual(saved);
    await expect(store.loadUiPreferences()).resolves.toEqual(saved);
  });

  it("persists the most recent UI preferences without the removed summary detail field", async () => {
    const { storage } = createStorage();
    const store = createChromeSettingsStore(storage);
    const v11Store = store as unknown as {
      loadUiPreferences(): Promise<Record<string, unknown>>;
      saveUiPreferences(
        input: Record<string, unknown>,
      ): Promise<Record<string, unknown>>;
    };

    await expect(v11Store.loadUiPreferences()).resolves.toMatchObject({
      version: 7,
    });
    const saved = await v11Store.saveUiPreferences({
      exportPreference: { format: "markdown", includeTimestamps: true },
      promptTemplate: "",
      speechLanguage: "混合",
      speechRoutingMode: "balanced",
      taskPrompts: { chat: "", segments: "", summary: "" },
      uiLanguage: "zh-Hans",
      taskOutputLanguages: {
        chat: "zh-Hans",
        segments: "zh-Hans",
        summary: "zh-Hans",
      },
      version: 7,
    });
    expect(saved).toMatchObject({ version: 7 });
    expect(saved).not.toHaveProperty("summaryDetail");
    await expect(v11Store.loadUiPreferences()).resolves.toMatchObject({
      version: 7,
    });
  });

  it("migrates the legacy global outputLanguage into all three modes (v5 -> v7)", async () => {
    const { storage } = createStorage({
      [SETTINGS_UI_PREFERENCES_STORAGE_KEY]: {
        exportPreference: { format: "markdown", includeTimestamps: true },
        promptTemplate: "",
        speechLanguage: "混合",
        speechRoutingMode: "balanced",
        taskPrompts: { chat: "", segments: "", summary: "" },
        uiLanguage: "zh-Hans",
        outputLanguage: "en",
        version: 5,
      },
    });
    const store = createChromeSettingsStore(storage);
    await expect(store.loadUiPreferences()).resolves.toMatchObject({
      taskOutputLanguages: {
        chat: "en",
        segments: "en",
        summary: "en",
      },
      version: 7,
    });
  });

  it("persists and reloads the auto (no language preference) per-mode output language", async () => {
    const { storage } = createStorage();
    const store = createChromeSettingsStore(storage);
    const saved = await store.saveUiPreferences({
      exportPreference: { format: "markdown", includeTimestamps: true },
      promptTemplate: "",
      speechLanguage: "混合",
      speechRoutingMode: "balanced",
      taskPrompts: { chat: "", segments: "", summary: "" },
      taskOutputLanguages: {
        chat: "auto",
        segments: "ja",
        summary: "en",
      },
      uiLanguage: "zh-Hans",
      version: 7,
    });
    expect(saved.taskOutputLanguages).toEqual({
      chat: "auto",
      segments: "ja",
      summary: "en",
    });
    await expect(store.loadUiPreferences()).resolves.toMatchObject({
      taskOutputLanguages: {
        chat: "auto",
        segments: "ja",
        summary: "en",
      },
    });
  });
  it("exposes a versioned prompt-preset store for safe CRUD and text/JSON interchange", () => {
    const { storage } = createStorage();
    const store = createChromeSettingsStore(storage) as unknown as Record<
      string,
      unknown
    >;

    expect(store.loadPromptPresets).toBeTypeOf("function");
    expect(store.createPromptPreset).toBeTypeOf("function");
    expect(store.updatePromptPreset).toBeTypeOf("function");
    expect(store.deletePromptPreset).toBeTypeOf("function");
    expect(store.selectDefaultPromptPreset).toBeTypeOf("function");
    expect(store.importPromptPresets).toBeTypeOf("function");
    expect(store.exportPromptPresets).toBeTypeOf("function");
  });
});
