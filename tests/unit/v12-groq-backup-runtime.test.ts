import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import { createV12BackupRuntime } from "../../src/application/backup";
import {
  SETTINGS_PROMPT_PRESETS_STORAGE_KEY,
  SETTINGS_SECRET_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SETTINGS_TASK_MODELS_STORAGE_KEY,
  SETTINGS_UI_PREFERENCES_STORAGE_KEY,
  createChromeSettingsStore,
} from "../../src/infrastructure/chrome-settings-store";
import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";
import {
  V12_SETTINGS_SECRET_STORAGE_KEY,
  V12_SETTINGS_STORAGE_KEY,
  V13_SETTINGS_SECRET_STORAGE_KEY,
} from "../../src/infrastructure/provider-profile-settings";
import {
  createV12BackupDataPort,
  openBilimuzhiDatabase,
} from "../../src/infrastructure/indexeddb/muzhi-database";

const databaseNames: string[] = [];

interface V12SettingsRuntime {
  loadV12Settings(): Promise<unknown>;
  migrateLegacySettingsToV12(): Promise<unknown>;
}

function v12Runtime(
  store: ReturnType<typeof createChromeSettingsStore>,
): V12SettingsRuntime {
  return store as unknown as V12SettingsRuntime;
}

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

function v12Settings(profileId = "profile-test") {
  return {
    archivedSegmentPrompts: [],
    imageCapabilities: [],
    profiles: [
      {
        apiKeyConfigured: false,
        baseUrl: "https://example.test/v1",
        hostPermission: "granted",
        id: profileId,
        models: [],
        name: "测试配置",
        protocol: "openai-compatible",
      },
    ],
    promptPresets: [],
    speech: { groqApiKeyConfigured: true },
    taskSelections: { chat: null, segments: null, summary: null },
    version: 12,
  };
}

function v12Secrets(groqApiKey: string) {
  return {
    groqApiKey,
    providerApiKeys: {},
    removedProviderKeyIds: [],
    version: 12,
  };
}

async function openDatabase(label: string): Promise<IDBDatabase> {
  const name = `muzhi-v12-groq-backup-${label}-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
}

function backupRuntime(
  database: IDBDatabase,
  storage: ChromeWorkspaceStorageArea,
) {
  return createV12BackupRuntime({
    crypto: globalThis.crypto,
    data: createV12BackupDataPort({ database, settingsStorage: storage }),
    now: () => 1_700_000_000_000,
    randomUUID: () => "groq-runtime",
  });
}

async function exerciseGroqRuntime(
  storage: ChromeWorkspaceStorageArea,
  expectedCredential: string,
): Promise<void> {
  let usedExpectedCredential = false;
  const settingsStore = createChromeSettingsStore(storage);
  const provider = await settingsStore.createGroqWhisperProvider({
    fetch: async (_url, init) => {
      usedExpectedCredential =
        init.headers.Authorization === `Bearer ${expectedCredential}`;
      return {
        headers: { get: () => null },
        json: async () => ({
          language: "zh",
          segments: [{ end: 1, start: 0, text: "测试字幕" }],
        }),
        ok: true,
        status: 200,
      };
    },
  });
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
    title: "运行时凭据核对",
  });
  expect(usedExpectedCredential).toBe(true);
}

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = fakeIndexedDB.deleteDatabase(name);
          request.addEventListener("success", () => resolve(), { once: true });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        }),
    ),
  );
});

describe("v12 Groq backup and Service Worker runtime authority (A12)", () => {
  it("uses the imported v12 Groq secret at the actual provider boundary", async () => {
    const sourceDatabase = await openDatabase("secret-source");
    const destinationDatabase = await openDatabase("secret-destination");
    const importedCredential = "test-only-imported-groq-4207";
    const staleLegacyCredential = "test-only-stale-legacy-1138";
    const source = createStorage({
      [V12_SETTINGS_SECRET_STORAGE_KEY]: v12Secrets(importedCredential),
      [V12_SETTINGS_STORAGE_KEY]: v12Settings("incoming-profile"),
    });
    const destination = createStorage({
      [SETTINGS_SECRET_STORAGE_KEY]: {
        groqApiKey: staleLegacyCredential,
        providerApiKeys: {},
        version: 2,
      },
      [V12_SETTINGS_SECRET_STORAGE_KEY]: v12Secrets(
        "test-only-local-groq-9921",
      ),
      [V12_SETTINGS_STORAGE_KEY]: v12Settings("local-profile"),
    });
    const exported = await backupRuntime(
      sourceDatabase,
      source.storage,
    ).exportBackup({
      confirmPlaintextSecrets: true,
      groups: ["application-ai"],
      includeKeys: true,
    });
    const destinationRuntime = backupRuntime(
      destinationDatabase,
      destination.storage,
    );
    const preview = await destinationRuntime.previewImport({
      groups: ["application-ai"],
      json: exported.json,
    });
    await destinationRuntime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    await exerciseGroqRuntime(destination.storage, importedCredential);
    expect(
      (
        destination.values[V13_SETTINGS_SECRET_STORAGE_KEY] as Record<
          string,
          unknown
        >
      ).groqApiKey,
    ).toBe(importedCredential);
    sourceDatabase.close();
    destinationDatabase.close();
  });

  it("keeps the local v12 Groq secret when a keyless settings backup is imported", async () => {
    const sourceDatabase = await openDatabase("keyless-source");
    const destinationDatabase = await openDatabase("keyless-destination");
    const localCredential = "test-only-local-preserved-7354";
    const source = createStorage({
      [V12_SETTINGS_STORAGE_KEY]: v12Settings("incoming-profile"),
    });
    const destination = createStorage({
      [V12_SETTINGS_SECRET_STORAGE_KEY]: v12Secrets(localCredential),
      [V12_SETTINGS_STORAGE_KEY]: v12Settings("local-profile"),
    });
    const exported = await backupRuntime(
      sourceDatabase,
      source.storage,
    ).exportBackup({
      groups: ["application-ai"],
      includeKeys: false,
    });
    const destinationRuntime = backupRuntime(
      destinationDatabase,
      destination.storage,
    );
    const preview = await destinationRuntime.previewImport({
      groups: ["application-ai"],
      json: exported.json,
    });
    await destinationRuntime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    await exerciseGroqRuntime(destination.storage, localCredential);
    expect(
      (
        destination.values[V12_SETTINGS_SECRET_STORAGE_KEY] as Record<
          string,
          unknown
        >
      ).groqApiKey,
    ).toBe(localCredential);
    sourceDatabase.close();
    destinationDatabase.close();
  });

  it("migrates the legacy Groq slot once, then runs only from the controlled v12 slot", async () => {
    const migratedCredential = "test-only-migrated-groq-6842";
    const { storage, values } = createStorage({
      [SETTINGS_PROMPT_PRESETS_STORAGE_KEY]: { presets: [], version: 1 },
      [SETTINGS_SECRET_STORAGE_KEY]: {
        groqApiKey: migratedCredential,
        providerApiKeys: {},
        version: 2,
      },
      [SETTINGS_STORAGE_KEY]: {
        provider: {
          baseUrl: "https://example.test/v1",
          providerId: "legacy-test",
          selectedModel: { modelId: "legacy-model" },
        },
        version: 1,
      },
      [SETTINGS_TASK_MODELS_STORAGE_KEY]: {},
      [SETTINGS_UI_PREFERENCES_STORAGE_KEY]: {},
    });
    const store = createChromeSettingsStore(storage);
    const migration = v12Runtime(store);

    await migration.migrateLegacySettingsToV12();
    const firstSettings = structuredClone(values[V12_SETTINGS_STORAGE_KEY]);
    const firstSecrets = structuredClone(
      values[V12_SETTINGS_SECRET_STORAGE_KEY],
    );
    await migration.migrateLegacySettingsToV12();
    expect(values[V12_SETTINGS_STORAGE_KEY]).toEqual(firstSettings);
    expect(values[V12_SETTINGS_SECRET_STORAGE_KEY]).toEqual(firstSecrets);

    delete values[SETTINGS_SECRET_STORAGE_KEY];
    await exerciseGroqRuntime(storage, migratedCredential);
  });

  it("keeps normal UI projections secret-free and leaves provider creation wired through the settings boundary", async () => {
    const credential = "test-only-ui-hidden-groq-2468";
    const { storage } = createStorage({
      [V12_SETTINGS_SECRET_STORAGE_KEY]: v12Secrets(credential),
      [V12_SETTINGS_STORAGE_KEY]: v12Settings(),
    });
    const store = createChromeSettingsStore(storage);

    const projection = await store.loadGroqApiKeyProjection();
    const settingsProjection = await v12Runtime(store).loadV12Settings();
    expect(projection).toMatchObject({
      configured: true,
      lastFour: "2468",
    });
    expect(JSON.stringify(projection).includes(credential)).toBe(false);
    expect(JSON.stringify(settingsProjection).includes(credential)).toBe(false);
  });
});
