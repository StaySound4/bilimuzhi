import { describe, expect, it, vi } from "vitest";

import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";
import {
  V12_SETTINGS_SECRET_STORAGE_KEY,
  V12_SETTINGS_STORAGE_KEY,
  V13_SETTINGS_SECRET_STORAGE_KEY,
  V13_SETTINGS_STORAGE_KEY,
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

const v12Seed: Record<string, unknown> = {
  [V12_SETTINGS_STORAGE_KEY]: {
    appearance: { theme: "dark" },
    archivedSegmentPrompts: [],
    imageCapabilities: [],
    profiles: [
      {
        baseUrl: "https://api.deepseek.com/v1",
        hostPermission: "granted",
        id: "profile-deepseek",
        models: [
          {
            enabled: true,
            id: "deepseek-chat",
            source: "discovered",
            verification: "verified",
          },
        ],
        name: "DeepSeek",
        protocol: "openai-compatible",
      },
    ],
    promptPresets: [],
    speech: { groqApiKeyConfigured: true },
    taskSelections: {
      chat: {
        modelId: "deepseek-chat",
        profileId: "profile-deepseek",
        reasoningEffort: "provider-default",
      },
      segments: {
        modelId: "deepseek-chat",
        profileId: "profile-deepseek",
        reasoningEffort: "high",
      },
      summary: {
        modelId: "deepseek-chat",
        profileId: "profile-deepseek",
        reasoningEffort: "medium",
      },
    },
    version: 12,
  },
  [V12_SETTINGS_SECRET_STORAGE_KEY]: {
    groqApiKey: "groq-key-for-tests-5519",
    providerApiKeys: { "profile-deepseek": "provider-key-for-tests-4821" },
    removedProviderKeyIds: [],
    version: 12,
  },
};

describe("v12 → v13 settings migration", () => {
  it("migrates v12 data on first read, normalizes efforts and protocol, and keeps the v12 backup", async () => {
    const { storage, values } = createStorage(v12Seed);
    const store = createProviderProfileSettingsStore({ storage });

    const profiles = await store.loadProviderProfiles();
    expect(profiles[0]).toMatchObject({
      id: "profile-deepseek",
      protocol: "openai-chat",
    });

    const selections = await store.loadTaskSelections();
    expect(selections.chat?.reasoningEffort).toBe("auto");
    expect(selections.segments?.reasoningEffort).toBe("high");
    expect(selections.summary?.reasoningEffort).toBe("medium");

    const v13Settings = values[V13_SETTINGS_STORAGE_KEY] as Record<
      string,
      unknown
    >;
    expect(v13Settings.version).toBe(13);
    expect(v13Settings.modelReasoningOverrides).toEqual({});
    expect(v13Settings.customReasoningEfforts).toEqual([]);
    // v12 原数据保留（备份），secrets 同步迁移。
    expect(values[V12_SETTINGS_STORAGE_KEY]).toMatchObject({ version: 12 });
    expect(values[V13_SETTINGS_SECRET_STORAGE_KEY]).toMatchObject({
      groqApiKey: "groq-key-for-tests-5519",
      providerApiKeys: { "profile-deepseek": "provider-key-for-tests-4821" },
    });
  });

  it("normalizes legacy protocol values openai and openai-compatible to openai-chat", async () => {
    const seed = structuredClone(v12Seed);
    const settings = seed[V12_SETTINGS_STORAGE_KEY] as Record<string, unknown>;
    const profiles = settings.profiles as Record<string, unknown>[];
    profiles[0].protocol = "openai";
    const { storage } = createStorage(seed);
    const store = createProviderProfileSettingsStore({ storage });

    const result = await store.loadProviderProfiles();
    expect(result[0]?.protocol).toBe("openai-chat");
  });

  it("is idempotent: an existing v13 record is read without touching v12", async () => {
    const { storage, values } = createStorage({
      ...structuredClone(v12Seed),
      [V13_SETTINGS_STORAGE_KEY]: {
        ...(v12Seed[V12_SETTINGS_STORAGE_KEY] as Record<string, unknown>),
        customReasoningEfforts: ["ultra"],
        modelReasoningOverrides: {
          "profile-deepseek\u0000deepseek-chat": {
            effort: "high",
            enabled: true,
          },
        },
        version: 13,
      },
    });
    const store = createProviderProfileSettingsStore({ storage });
    await store.loadProviderProfiles();
    const setCalls = (storage.set as ReturnType<typeof vi.fn>).mock.calls;
    expect(setCalls.some(([items]) => V13_SETTINGS_STORAGE_KEY in items)).toBe(
      false,
    );
    expect(values[V12_SETTINGS_STORAGE_KEY]).toMatchObject({ version: 12 });
  });

  it("persists per-model reasoning overrides keyed by profile+model", async () => {
    const { storage, values } = createStorage(structuredClone(v12Seed));
    const store = createProviderProfileSettingsStore({ storage });
    await store.loadProviderProfiles();

    await store.saveModelReasoningOverride(
      "profile-deepseek",
      "deepseek-chat",
      {
        effort: "max",
        enabled: true,
      },
    );
    await expect(
      store.loadModelReasoningOverride("profile-deepseek", "deepseek-chat"),
    ).resolves.toEqual({ effort: "max", enabled: true });
    await store.removeModelReasoningOverride(
      "profile-deepseek",
      "deepseek-chat",
    );
    await expect(
      store.loadModelReasoningOverride("profile-deepseek", "deepseek-chat"),
    ).resolves.toBeNull();
    const settings = values[V13_SETTINGS_STORAGE_KEY] as Record<
      string,
      unknown
    >;
    expect(
      (settings.modelReasoningOverrides as Record<string, unknown>)[
        "profile-deepseek\u0000deepseek-chat"
      ],
    ).toBeUndefined();
  });

  it("keeps custom reasoning efforts ordered with case-insensitive duplicate rejection", async () => {
    const { storage } = createStorage(structuredClone(v12Seed));
    const store = createProviderProfileSettingsStore({ storage });
    await store.loadProviderProfiles();

    await store.saveCustomReasoningEfforts(["ultra", "think-3"]);
    await expect(store.loadCustomReasoningEfforts()).resolves.toEqual([
      "ultra",
      "think-3",
    ]);
    // 大小写不敏感查重：ULTRA 与已有 ultra 冲突。
    await expect(
      store.saveCustomReasoningEfforts(["ultra", "ULTRA"]),
    ).rejects.toThrow(/重复/);
    // 非法值（空、超长、非法字符、内置档位）拒绝。
    await expect(
      store.saveCustomReasoningEfforts(["", "valid"]),
    ).rejects.toThrow();
    await expect(
      store.saveCustomReasoningEfforts(["a".repeat(25)]),
    ).rejects.toThrow();
    await expect(store.saveCustomReasoningEfforts(["high"])).rejects.toThrow();
    await expect(
      store.saveCustomReasoningEfforts(["bad value!"]),
    ).rejects.toThrow();
  });
});
