import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import * as settingsInfrastructure from "../../src/infrastructure/chrome-settings-store";
import {
  SETTINGS_PROMPT_PRESETS_STORAGE_KEY,
  SETTINGS_SECRET_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SETTINGS_TASK_MODELS_STORAGE_KEY,
  SETTINGS_UI_PREFERENCES_STORAGE_KEY,
  createChromeSettingsStore,
} from "../../src/infrastructure/chrome-settings-store";
import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";
import * as indexedDbInfrastructure from "../../src/infrastructure/indexeddb/muzhi-database";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";

type BackupGroup =
  "application-ai" | "archive" | "prompts" | "trash" | "workspace";

interface MigrationSnapshot {
  readonly archivedSegmentPrompts: readonly {
    readonly content: string;
    readonly name: string;
    readonly readOnly: true;
  }[];
  readonly profiles: readonly {
    readonly apiKeyConfigured: boolean;
    readonly baseUrl: string;
    readonly id: string;
    readonly models: readonly {
      readonly id: string;
      readonly source: "discovered" | "manual";
      readonly verification: "unverified" | "verified";
    }[];
    readonly name: string;
  }[];
  readonly promptPresets: readonly {
    readonly content: string;
    readonly id: string;
    readonly kind: "chat" | "summary";
    readonly name: string;
  }[];
  readonly speech: { readonly groqApiKeyConfigured: boolean };
  readonly taskSelections: Readonly<
    Record<
      "chat" | "segments" | "summary",
      {
        readonly modelId: string;
        readonly profileId: string;
        readonly reasoningEffort: "provider-default";
      }
    >
  >;
  readonly version: 12;
}

interface MigrationResult {
  readonly snapshot: MigrationSnapshot;
  readonly summary: {
    readonly archivedSegmentPromptCount: number;
    readonly createdProfileCount: number;
    readonly keyStatus: "provider-and-groq-preserved";
    readonly migratedPromptCount: number;
    readonly preservedModelCount: number;
  };
}

interface V12MigratingSettingsStore {
  loadV12Settings(): Promise<MigrationSnapshot>;
  migrateLegacySettingsToV12(): Promise<MigrationResult>;
}

interface BackupDataPort {
  commitImport(input: {
    readonly groups: Partial<Record<BackupGroup, unknown>>;
    readonly preserveLocalKeys: boolean;
  }): Promise<void>;
  inspectLocal(): Promise<{
    readonly placements: Readonly<
      Record<"archive" | "trash" | "workspace", readonly string[]>
    >;
    readonly statistics: Readonly<Record<BackupGroup, number>>;
  }>;
  readGroups(
    groups: readonly BackupGroup[],
  ): Promise<Partial<Record<BackupGroup, unknown>>>;
  readKeys(): Promise<{
    readonly groq: string | null;
    readonly providers: Readonly<Record<string, string>>;
  }>;
}

interface BackupPreview {
  readonly conflicts: readonly { readonly code: string }[];
  readonly selectedGroups: readonly BackupGroup[];
  readonly statistics: Readonly<
    Record<
      BackupGroup,
      { readonly incoming: number; readonly replaced: number }
    >
  >;
}

interface V12BackupRuntime {
  commitImport(input: {
    readonly confirmation: "replace-selected-groups";
    readonly preview: BackupPreview;
  }): Promise<void>;
  previewImport(input: {
    readonly groups: readonly BackupGroup[];
    readonly includeKeys?: boolean;
    readonly json: string;
    readonly password?: string;
  }): Promise<BackupPreview>;
}

type CreateV12BackupRuntime = (dependencies: {
  readonly crypto: Crypto;
  readonly data: BackupDataPort;
  readonly now: () => number;
  readonly randomUUID: () => string;
}) => V12BackupRuntime;

type CreateV12BackupDataPort = (dependencies: {
  readonly database: IDBDatabase;
  readonly settingsStorage: ChromeWorkspaceStorageArea;
}) => BackupDataPort;

const databaseNames: string[] = [];

function createStorage(
  seed: Record<string, unknown> = {},
  options: {
    readonly failWhen?: (items: Record<string, unknown>) => boolean;
  } = {},
) {
  const values = structuredClone(seed);
  const storage: ChromeWorkspaceStorageArea = {
    get: vi.fn(async (key: string) => ({
      [key]: structuredClone(values[key]),
    })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      if (options.failWhen?.(items)) {
        throw new Error("injected settings persistence failure");
      }
      Object.assign(values, structuredClone(items));
    }),
  };
  return { storage, values };
}

const legacySeed: Record<string, unknown> = {
  [SETTINGS_PROMPT_PRESETS_STORAGE_KEY]: {
    defaultPromptPresetIds: {
      chat: "legacy-chat",
      segments: "legacy-segments",
      summary: "legacy-summary",
    },
    presets: [
      {
        builtIn: false,
        content: "旧对话用户提示词",
        id: "legacy-chat",
        kind: "chat",
        name: "Bilimuzhi默认",
      },
      {
        builtIn: false,
        content: "旧总结用户提示词",
        id: "legacy-summary",
        kind: "summary",
        name: "团队总结",
      },
      {
        builtIn: false,
        content: "旧分段用户提示词",
        id: "legacy-segments",
        kind: "segments",
        name: "旧分段规范",
      },
    ],
    version: 1,
  },
  [SETTINGS_SECRET_STORAGE_KEY]: {
    groqApiKey: "groq-key-for-tests-5519",
    providerApiKeys: { deepseek: "provider-key-for-tests-4821" },
    version: 2,
  },
  [SETTINGS_STORAGE_KEY]: {
    appearance: { theme: "dark" },
    provider: {
      baseUrl: "https://api.deepseek.com/v1",
      protocol: "openai",
      providerId: "deepseek",
      selectedModel: {
        modelId: "deepseek-chat",
        reasoningEffort: "auto",
      },
    },
    retention: {
      applyMode: "future-only",
      policy: { durationDays: 7, kind: "duration" },
    },
    version: 1,
  },
  [SETTINGS_TASK_MODELS_STORAGE_KEY]: {
    chat: { modelId: "deepseek-chat", reasoningEffort: "auto" },
    segments: { modelId: "manual-segments", reasoningEffort: "auto" },
    summary: { modelId: "manual-summary", reasoningEffort: "auto" },
    version: 1,
  },
  [SETTINGS_UI_PREFERENCES_STORAGE_KEY]: {
    exportPreference: { format: "markdown", includeTimestamps: true },
    promptTemplate: "",
    speechLanguage: "混合",
    speechRoutingMode: "balanced",
    summaryDetail: "balanced",
    taskPrompts: {
      chat: "旧对话用户提示词",
      segments: "旧分段用户提示词",
      summary: "旧总结用户提示词",
    },
    version: 4,
  },
};

function asMigratingStore(
  storage: ChromeWorkspaceStorageArea,
): V12MigratingSettingsStore {
  return createChromeSettingsStore(
    storage,
  ) as unknown as V12MigratingSettingsStore;
}

function requireMigrationMethod<K extends keyof V12MigratingSettingsStore>(
  store: V12MigratingSettingsStore,
  name: K,
): V12MigratingSettingsStore[K] {
  expect(
    store[name],
    `A12 requires the transactional settings method ${String(name)}`,
  ).toBeTypeOf("function");
  return store[name];
}

function createBackupRuntime(data: BackupDataPort): V12BackupRuntime {
  const factory = (
    settingsInfrastructure as unknown as {
      readonly createV12BackupRuntime?: CreateV12BackupRuntime;
    }
  ).createV12BackupRuntime;
  expect(factory, "A13 requires createV12BackupRuntime").toBeTypeOf("function");
  return factory!({
    crypto: globalThis.crypto,
    data,
    now: () => 1_700_000_000_000,
    randomUUID: () => "integration-backup-id",
  });
}

function createBackupDataPort(
  database: IDBDatabase,
  settingsStorage: ChromeWorkspaceStorageArea,
): BackupDataPort {
  const factory = (
    indexedDbInfrastructure as unknown as {
      readonly createV12BackupDataPort?: CreateV12BackupDataPort;
    }
  ).createV12BackupDataPort;
  expect(
    factory,
    "A13 requires an IndexedDB-backed v12 backup transaction port",
  ).toBeTypeOf("function");
  return factory!({ database, settingsStorage });
}

async function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

async function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
    transaction.addEventListener("error", () => reject(transaction.error), {
      once: true,
    });
  });
}

async function putRecord(
  database: IDBDatabase,
  storeName: string,
  record: Record<string, unknown>,
): Promise<void> {
  const transaction = database.transaction(storeName, "readwrite");
  const done = transactionDone(transaction);
  transaction.objectStore(storeName).put(record);
  await done;
}

async function getRecord(
  database: IDBDatabase,
  storeName: string,
  key: IDBValidKey,
): Promise<unknown> {
  const transaction = database.transaction(storeName, "readonly");
  const result = await requestResult(
    transaction.objectStore(storeName).get(key),
  );
  await transactionDone(transaction);
  return result;
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

describe("v12 settings migration and backup transaction (A12-A13)", () => {
  it("migrates the single Provider, Groq, three task choices, chat/summary prompts, and read-only segment archive exactly once", async () => {
    const { storage } = createStorage(legacySeed);
    const store = asMigratingStore(storage);
    const migrate = requireMigrationMethod(
      store,
      "migrateLegacySettingsToV12",
    ).bind(store);

    const first = await migrate();
    expect(first.snapshot.version).toBe(12);
    expect(first.snapshot.profiles).toHaveLength(1);
    expect(first.snapshot.profiles[0]).toMatchObject({
      apiKeyConfigured: true,
      baseUrl: "https://api.deepseek.com/v1",
      name: "AI 配置",
    });
    const serializedUserVisibleProfileNames = JSON.stringify(
      first.snapshot.profiles.map(({ name }) => ({ name })),
    );
    expect(serializedUserVisibleProfileNames).toBe('[{"name":"AI 配置"}]');
    expect(serializedUserVisibleProfileNames).not.toMatch(/旧配置|原有配置/);
    expect(first.snapshot.profiles[0]?.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "deepseek-chat" }),
        {
          id: "manual-segments",
          source: "manual",
          verification: "unverified",
        },
        {
          id: "manual-summary",
          source: "manual",
          verification: "unverified",
        },
      ]),
    );
    for (const kind of ["chat", "segments", "summary"] as const) {
      expect(first.snapshot.taskSelections[kind]).toMatchObject({
        profileId: first.snapshot.profiles[0]?.id,
        reasoningEffort: "provider-default",
      });
    }
    expect(first.snapshot.speech.groqApiKeyConfigured).toBe(true);
    expect(first.snapshot.promptPresets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: "旧对话用户提示词",
          kind: "chat",
        }),
        expect.objectContaining({
          content: "旧总结用户提示词",
          kind: "summary",
          name: "团队总结",
        }),
      ]),
    );
    expect(
      first.snapshot.promptPresets.find(
        ({ content }) => content === "旧对话用户提示词",
      )?.name,
    ).not.toBe("Bilimuzhi默认");
    expect(first.snapshot.archivedSegmentPrompts).toEqual([
      {
        content: "旧分段用户提示词",
        name: "旧分段规范",
        readOnly: true,
      },
    ]);
    expect(JSON.stringify(first.snapshot)).not.toContain(
      "provider-key-for-tests-4821",
    );
    expect(JSON.stringify(first.snapshot)).not.toContain(
      "groq-key-for-tests-5519",
    );
    expect(first.summary).toMatchObject({
      archivedSegmentPromptCount: 1,
      createdProfileCount: 1,
      keyStatus: "provider-and-groq-preserved",
      migratedPromptCount: 2,
      preservedModelCount: 3,
    });

    const second = await migrate();
    expect(second.snapshot).toEqual(first.snapshot);
    expect(second.summary.createdProfileCount).toBe(0);
    expect(
      second.snapshot.profiles.filter(({ name }) => name === "AI 配置"),
    ).toHaveLength(1);
  });

  it("rolls back every legacy setting when validation or persistence fails and remains retryable/idempotent", async () => {
    const before = structuredClone(legacySeed);
    const { storage, values } = createStorage(legacySeed, {
      failWhen: (items) =>
        Object.keys(items).some((key) => key.includes("settings.v1")),
    });
    const store = asMigratingStore(storage);

    await expect(
      requireMigrationMethod(store, "migrateLegacySettingsToV12").call(store),
    ).rejects.toMatchObject({ code: "SETTINGS_MIGRATION_FAILED" });
    expect(values).toEqual(before);
    expect(JSON.stringify(values)).toContain("provider-key-for-tests-4821");
    expect(JSON.stringify(values)).toContain("groq-key-for-tests-5519");
  });

  it("previews with zero writes, then atomically rolls back selected IndexedDB groups when settings persistence fails", async () => {
    const name = `muzhi-v12-backup-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    await putRecord(database, "sessions", {
      createdAt: 1,
      lastActivityAt: 1,
      sessionId: "session-local-workspace",
      subtitleContextRevision: 1,
      title: "本机会话",
      videoKey: "bvid:BV1LOCAL:cid:1:p:1",
    });
    await putRecord(database, "workspaceSessionPlacements", {
      order: 0,
      pinned: false,
      sessionId: "session-local-workspace",
    });
    await putRecord(database, "sessions", {
      createdAt: 2,
      lastActivityAt: 2,
      sessionId: "session-local-archive",
      subtitleContextRevision: 1,
      title: "本机归档",
      videoKey: "bvid:BV1ARCHIVE:cid:2:p:1",
    });
    await putRecord(database, "archiveSessionPlacements", {
      folderId: "archive-root",
      order: 0,
      pinned: false,
      sessionId: "session-local-archive",
    });

    const { storage, values } = createStorage(
      {
        "muzhi.settings.v12": {
          appearance: { theme: "dark" },
          profiles: [{ id: "local-profile", name: "本机配置" }],
          version: 12,
        },
        "muzhi.settings.secret.v12": {
          groqApiKey: "groq-key-for-tests-5519",
          providerApiKeys: {
            "local-profile": "provider-key-for-tests-4821",
          },
          version: 12,
        },
      },
      {
        failWhen: (items) =>
          Object.keys(items).some((key) => key.includes("settings.v1")) &&
          JSON.stringify(items).includes("incoming-profile"),
      },
    );
    const beforeSettings = structuredClone(values);
    const data = createBackupDataPort(database, storage);
    const runtime = createBackupRuntime(data);
    const preview = await runtime.previewImport({
      groups: ["application-ai", "workspace"],
      json: JSON.stringify({
        groups: {
          "application-ai": {
            appearance: { theme: "light" },
            profiles: [{ id: "incoming-profile", name: "导入配置" }],
          },
          workspace: {
            sessions: [
              {
                createdAt: 3,
                lastActivityAt: 3,
                placement: "workspace",
                sessionId: "session-incoming-workspace",
                subtitleContextRevision: 1,
                title: "导入会话",
                videoKey: "bvid:BV1INCOMING:cid:3:p:1",
              },
            ],
          },
        },
        version: 1,
      }),
    });

    expect(preview.conflicts).toEqual([]);
    expect(
      await getRecord(database, "sessions", "session-local-workspace"),
    ).toBeDefined();
    expect(
      await getRecord(database, "sessions", "session-incoming-workspace"),
    ).toBeUndefined();
    expect(values).toEqual(beforeSettings);

    await expect(
      runtime.commitImport({
        confirmation: "replace-selected-groups",
        preview,
      }),
    ).rejects.toMatchObject({ code: "BACKUP_IMPORT_TRANSACTION_FAILED" });

    expect(
      await getRecord(database, "sessions", "session-local-workspace"),
    ).toBeDefined();
    expect(
      await getRecord(database, "sessions", "session-incoming-workspace"),
    ).toBeUndefined();
    expect(
      await getRecord(database, "sessions", "session-local-archive"),
    ).toBeDefined();
    expect(values).toEqual(beforeSettings);
    expect(JSON.stringify(values)).toContain("provider-key-for-tests-4821");
    expect(JSON.stringify(values)).toContain("groq-key-for-tests-5519");
    expect(JSON.stringify(values)).toContain('"theme":"dark"');
    database.close();
  });

  it("imports only API keys without clearing application settings", async () => {
    const name = `muzhi-v12-backup-keys-only-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    const localSettings = {
      appearance: { theme: "dark" },
      archivedSegmentPrompts: [],
      imageCapabilities: [],
      profiles: [{ id: "local-profile", name: "本机配置" }],
      promptPresets: [{ id: "local-prompt", name: "本机提示词" }],
      speech: { groqApiKeyConfigured: false },
      taskSelections: { chat: null, segments: null, summary: null },
      version: 12,
    };
    const { storage, values } = createStorage({
      "muzhi.settings.v12": localSettings,
      "muzhi.settings.secret.v12": {
        groqApiKey: null,
        providerApiKeys: {},
        removedProviderKeyIds: [],
        version: 12,
      },
    });
    const runtime = createBackupRuntime(
      createBackupDataPort(database, storage),
    );
    const preview = await runtime.previewImport({
      groups: [],
      includeKeys: true,
      json: JSON.stringify({
        groups: { "application-ai": { profiles: [] } },
        secrets: {
          groq: "incoming-groq-key",
          providers: { "local-profile": "incoming-provider-key" },
        },
        version: 1,
      }),
    });
    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    expect(values["muzhi.settings.v13"]).toEqual({
      ...localSettings,
      customReasoningEfforts: [],
      modelReasoningOverrides: {},
      speech: { groqApiKeyConfigured: true },
      version: 13,
    });
    expect(values["muzhi.settings.secret.v13"]).toEqual({
      groqApiKey: "incoming-groq-key",
      providerApiKeys: { "local-profile": "incoming-provider-key" },
      removedProviderKeyIds: [],
      version: 13,
    });
    database.close();
  });

  it("fully replaces application settings without allowing them to overwrite unselected prompts", async () => {
    const name = `muzhi-v12-backup-settings-boundary-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    const { storage, values } = createStorage({
      "muzhi.settings.v12": {
        appearance: { theme: "dark" },
        archivedSegmentPrompts: [{ content: "local", name: "local" }],
        imageCapabilities: [
          { modelId: "local", profileId: "local", state: "supported" },
        ],
        profiles: [{ id: "local-profile", name: "本机配置" }],
        promptPresets: [{ id: "local-prompt", name: "本机提示词" }],
        speech: { groqApiKeyConfigured: false },
        taskSelections: { chat: null, segments: null, summary: null },
        version: 12,
      },
    });
    const runtime = createBackupRuntime(
      createBackupDataPort(database, storage),
    );
    const preview = await runtime.previewImport({
      groups: ["application-ai"],
      json: JSON.stringify({
        groups: {
          "application-ai": {
            profiles: [{ id: "incoming-profile", name: "导入配置" }],
            promptPresets: [{ id: "injected-prompt", name: "不应导入" }],
          },
        },
        version: 1,
      }),
    });
    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    const settings = values["muzhi.settings.v13"] as Record<string, unknown>;
    expect(settings).toMatchObject({
      appearance: { theme: "dark" },
      archivedSegmentPrompts: [],
      imageCapabilities: [],
      profiles: [{ id: "incoming-profile", name: "导入配置" }],
      promptPresets: [{ id: "local-prompt", name: "本机提示词" }],
      speech: { groqApiKeyConfigured: false },
      taskSelections: { chat: null, segments: null, summary: null },
      version: 13,
    });
    expect(JSON.stringify(settings)).not.toContain("injected-prompt");
    database.close();
  });

  it("replaces only selected placements, keeps unselected archive/trash and appearance, and preserves local keys for a keyless backup", async () => {
    const name = `muzhi-v12-backup-success-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    const { storage, values } = createStorage({
      "muzhi.settings.v12": {
        appearance: { theme: "dark" },
        profiles: [{ id: "local-profile", name: "本机配置" }],
        version: 12,
      },
      "muzhi.settings.secret.v12": {
        groqApiKey: "groq-key-for-tests-5519",
        providerApiKeys: {
          "local-profile": "provider-key-for-tests-4821",
        },
        version: 12,
      },
    });
    await putRecord(database, "sessions", {
      createdAt: 1,
      lastActivityAt: 1,
      sessionId: "session-local-workspace",
      subtitleContextRevision: 1,
      title: "本机会话",
      videoKey: "bvid:BV1LOCAL:cid:1:p:1",
    });
    await putRecord(database, "workspaceSessionPlacements", {
      order: 0,
      pinned: false,
      sessionId: "session-local-workspace",
    });
    await putRecord(database, "sessions", {
      createdAt: 2,
      lastActivityAt: 2,
      sessionId: "session-local-archive",
      subtitleContextRevision: 1,
      title: "本机归档",
      videoKey: "bvid:BV1ARCHIVE:cid:2:p:1",
    });
    await putRecord(database, "archiveSessionPlacements", {
      folderId: "archive-root",
      order: 0,
      pinned: false,
      sessionId: "session-local-archive",
    });

    const runtime = createBackupRuntime(
      createBackupDataPort(database, storage),
    );
    const preview = await runtime.previewImport({
      groups: ["application-ai", "workspace"],
      json: JSON.stringify({
        groups: {
          "application-ai": {
            profiles: [{ id: "incoming-profile", name: "导入配置" }],
          },
          workspace: {
            sessions: [
              {
                createdAt: 3,
                lastActivityAt: 3,
                placement: "workspace",
                sessionId: "session-incoming-workspace",
                subtitleContextRevision: 1,
                title: "导入会话",
                videoKey: "bvid:BV1INCOMING:cid:3:p:1",
              },
            ],
          },
        },
        version: 1,
      }),
    });
    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    expect(
      await getRecord(database, "sessions", "session-local-workspace"),
    ).toBeUndefined();
    expect(
      await getRecord(database, "sessions", "session-incoming-workspace"),
    ).toBeDefined();
    expect(
      await getRecord(database, "sessions", "session-local-archive"),
    ).toBeDefined();
    expect(JSON.stringify(values)).toContain("incoming-profile");
    expect(JSON.stringify(values)).toContain("provider-key-for-tests-4821");
    expect(JSON.stringify(values)).toContain("groq-key-for-tests-5519");
    expect(JSON.stringify(values)).toContain('"theme":"dark"');
    database.close();
  });
});
