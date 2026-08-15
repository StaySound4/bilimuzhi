import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  createV12BackupRuntime,
  type BackupDataPort,
  type BackupGroup,
} from "../../src/application/backup";
import {
  createChromeSettingsStore,
  type ChromeSettingsStore,
} from "../../src/infrastructure/chrome-settings-store";
import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";

type PromptKind = "chat" | "summary";

interface V14PromptPreset {
  readonly builtIn: boolean;
  readonly content: string;
  readonly id: string;
  readonly kind: PromptKind;
  readonly name: string;
}

interface V14PromptPresetState {
  readonly defaultPromptPresetIds: Readonly<Record<PromptKind, string>>;
  readonly presets: readonly V14PromptPreset[];
  readonly selectedPromptPresetIds: Readonly<Record<PromptKind, string>>;
  readonly version: number;
}

interface V14PromptSettingsStore extends Omit<
  ChromeSettingsStore,
  | "createPromptPreset"
  | "deletePromptPreset"
  | "loadPromptPresets"
  | "selectDefaultPromptPreset"
> {
  createPromptPreset(input: {
    readonly content?: string;
    readonly kind: PromptKind;
    readonly name: string;
  }): Promise<V14PromptPresetState>;
  deletePromptPreset(presetId: string): Promise<V14PromptPresetState>;
  loadPromptPresets(): Promise<V14PromptPresetState>;
  reorderPromptPresets(
    kind: PromptKind,
    orderedPresetIds: readonly string[],
  ): Promise<V14PromptPresetState>;
  selectDefaultPromptPreset(
    kind: PromptKind,
    presetId: string,
  ): Promise<V14PromptPresetState>;
  selectPromptPreset(
    kind: PromptKind,
    presetId: string,
  ): Promise<V14PromptPresetState>;
}

interface DownloadDelta {
  readonly id: number;
  readonly error?: { readonly current?: string };
  readonly state?: { readonly current?: "complete" | "in_progress" };
}

interface ChromeBackupDownloadDependencies {
  readonly createObjectURL: (blob: Blob) => string;
  readonly downloads: {
    download(options: {
      readonly filename: string;
      readonly saveAs: true;
      readonly url: string;
    }): Promise<number | undefined>;
    readonly onChanged: {
      addListener(listener: (delta: DownloadDelta) => void): void;
      removeListener(listener: (delta: DownloadDelta) => void): void;
    };
    search(query: { readonly id: number }): Promise<
      readonly {
        readonly filename: string;
        readonly id: number;
        readonly state: "complete" | "in_progress" | "interrupted";
      }[]
    >;
    show(downloadId: number): Promise<void>;
  };
  readonly revokeObjectURL: (url: string) => void;
}

interface ChromeBackupDownloadRuntime {
  exportJson(input: {
    readonly fileName: string;
    readonly json: string;
  }): Promise<
    | { readonly cancelled: true }
    | {
        readonly cancelled: false;
        readonly downloadId: number;
        readonly filename: string;
      }
  >;
  openContainingFolder(downloadId: number): Promise<void>;
}

type CreateChromeBackupDownloadRuntime = (
  dependencies: ChromeBackupDownloadDependencies,
) => ChromeBackupDownloadRuntime;

const downloadModulePath = "../../src/infrastructure/chrome-backup-download";

function createStorage(seed: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = structuredClone(seed);
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

function promptStore(
  storage: ChromeWorkspaceStorageArea,
): V14PromptSettingsStore {
  return createChromeSettingsStore(
    storage,
  ) as unknown as V14PromptSettingsStore;
}

function requirePromptMethod<K extends keyof V14PromptSettingsStore>(
  store: V14PromptSettingsStore,
  name: K,
): V14PromptSettingsStore[K] {
  expect(
    store[name],
    `A6 requires the persisted prompt repository method ${String(name)}`,
  ).toBeTypeOf("function");
  return store[name];
}

async function loadDownloadFactory(): Promise<CreateChromeBackupDownloadRuntime> {
  let module: Record<string, unknown>;
  try {
    module = await vi.importActual<Record<string, unknown>>(downloadModulePath);
  } catch (error) {
    expect.fail(
      `A8 requires the public Chrome backup download runtime at ${downloadModulePath}: ${String(error)}`,
    );
  }
  const factory = module!.createChromeBackupDownloadRuntime;
  expect(factory, "A8 requires createChromeBackupDownloadRuntime").toBeTypeOf(
    "function",
  );
  return factory as CreateChromeBackupDownloadRuntime;
}

function backupDataPort(
  overrides: Partial<BackupDataPort> = {},
): BackupDataPort & {
  readonly validateImport: NonNullable<BackupDataPort["validateImport"]>;
} {
  const statistics: Record<BackupGroup, number> = {
    "application-ai": 1,
    archive: 0,
    "batch-archive": 0,
    "batch-trash": 0,
    "batch-workspace": 0,
    prompts: 2,
    trash: 0,
    workspace: 1,
  };
  const validateImport =
    overrides.validateImport ?? vi.fn(async () => undefined);
  return {
    commitImport: vi.fn(async () => undefined),
    inspectLocal: vi.fn(async () => ({
      placements: { archive: [], trash: [], workspace: [] },
      statistics,
    })),
    readGroups: vi.fn(async () => ({
      prompts: { userPresets: [] },
      workspace: { sessions: [] },
    })),
    readKeys: vi.fn(async () => ({ groq: null, providers: {} })),
    ...overrides,
    validateImport,
  };
}

describe("v14 A6 prompt preset persistence", () => {
  it("ships independent Chat and three complete, distinct Summary built-ins", async () => {
    const { storage } = createStorage();
    const state = await promptStore(storage).loadPromptPresets();
    const chat = state.presets.filter(({ kind }) => kind === "chat");
    const summary = state.presets.filter(({ kind }) => kind === "summary");

    expect(chat.map(({ name }) => name)).toContain("Bilimuzhi默认");
    expect(summary.map(({ name }) => name)).toEqual(["简要", "平衡", "详细"]);
    expect(summary.every(({ builtIn }) => builtIn)).toBe(true);
    expect(summary.every(({ content }) => content.trim().length >= 32)).toBe(
      true,
    );
    expect(new Set(summary.map(({ content }) => content)).size).toBe(3);
    expect(state.defaultPromptPresetIds.chat).not.toBe(
      state.defaultPromptPresetIds.summary,
    );
    expect(state.selectedPromptPresetIds).toEqual({
      chat: state.defaultPromptPresetIds.chat,
      summary: state.defaultPromptPresetIds.summary,
    });
  });

  it("persists a separate selectedPresetId per mode and falls back only when that selected custom preset is deleted", async () => {
    const { storage } = createStorage();
    const first = promptStore(storage);
    await first.createPromptPreset({
      content: "自定义对话正文",
      kind: "chat",
      name: "对话 A",
    });
    const state = await first.createPromptPreset({
      content: "自定义总结正文",
      kind: "summary",
      name: "总结 B",
    });
    const chatId = state.presets.find(({ name }) => name === "对话 A")!.id;
    const summaryId = state.presets.find(({ name }) => name === "总结 B")!.id;

    const select = requirePromptMethod(first, "selectPromptPreset");
    await select.call(first, "chat", chatId);
    await select.call(first, "summary", summaryId);

    const reopened = promptStore(storage);
    expect(
      (await reopened.loadPromptPresets()).selectedPromptPresetIds,
    ).toEqual({ chat: chatId, summary: summaryId });

    await reopened.deletePromptPreset(summaryId);
    const afterDelete = await promptStore(storage).loadPromptPresets();
    expect(afterDelete.selectedPromptPresetIds.chat).toBe(chatId);
    expect(afterDelete.selectedPromptPresetIds.summary).toBe(
      afterDelete.defaultPromptPresetIds.summary,
    );
  });

  it("persists the complete visible order, including movable locked built-ins", async () => {
    const { storage } = createStorage();
    const store = promptStore(storage);
    let state = await store.createPromptPreset({
      kind: "summary",
      name: "总结末项",
    });
    const summary = state.presets.filter(({ kind }) => kind === "summary");
    const custom = summary.find(({ name }) => name === "总结末项")!;
    const desired = [
      custom.id,
      ...summary.filter(({ id }) => id !== custom.id).map(({ id }) => id),
    ];

    const reorder = requirePromptMethod(store, "reorderPromptPresets");
    state = await reorder.call(store, "summary", desired);
    expect(
      state.presets
        .filter(({ kind }) => kind === "summary")
        .map(({ id }) => id),
    ).toEqual(desired);
    expect(
      (await promptStore(storage).loadPromptPresets()).presets
        .filter(({ kind }) => kind === "summary")
        .map(({ id }) => id),
    ).toEqual(desired);
  });

  it("rejects editing and deleting the Chat built-in at the real repository boundary", async () => {
    const { storage } = createStorage();
    const store = promptStore(storage);
    const state = await store.loadPromptPresets();
    const builtIn = state.presets.find(
      ({ builtIn, kind }) => builtIn && kind === "chat",
    )!;

    await expect(
      store.updatePromptPreset(builtIn.id, {
        content: "不应覆盖内置正文",
        name: "覆盖",
      }),
    ).rejects.toThrow(/read-only|内置|只读/i);
    await expect(store.deletePromptPreset(builtIn.id)).rejects.toThrow(
      /cannot be deleted|内置|删除/i,
    );
    expect(
      (await promptStore(storage).loadPromptPresets()).presets.find(
        ({ id }) => id === builtIn.id,
      )?.content,
    ).toBe(builtIn.content);
  });

  it("wires copy to navigator.clipboard without calling the preset creation path", async () => {
    const source = await readFile(
      new URL(
        "../../src/entries/sidepanel.tsx",
        import.meta.url,
      ) as unknown as string,
      "utf8",
    );
    const copyHandler = source.slice(
      source.indexOf("const copyPromptPreset ="),
      source.indexOf("const deletePromptPreset ="),
    );

    expect(copyHandler).toMatch(
      /navigator\.clipboard\.writeText\(\s*displayPresetContent\(\s*source,\s*uiLanguage,\s*concreteOutputLanguage\(/u,
    );
    expect(copyHandler).not.toContain("settingsStore.createPromptPreset");
    expect(copyHandler).not.toContain("askDialog");
  });
});

describe("v14 A8 backup persistence and Chrome save-as boundary", () => {
  it("keeps import as preflight-only until an explicit replacement confirmation", async () => {
    const data = backupDataPort();
    const runtime = createV12BackupRuntime({
      crypto: globalThis.crypto,
      data,
      now: () => 1_700_000_000_000,
      randomUUID: () => "v14-backup-preview",
    });
    const preview = await runtime.previewImport({
      groups: ["prompts", "workspace"],
      json: JSON.stringify({
        groups: {
          prompts: { userPresets: [{ id: "prompt-v14" }] },
          workspace: { sessions: [{ sessionId: "session-v14" }] },
        },
        version: 1,
      }),
    });

    expect(preview.selectedGroups).toEqual(["prompts", "workspace"]);
    expect(data.validateImport).toHaveBeenCalledOnce();
    expect(data.commitImport).not.toHaveBeenCalled();

    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });
    expect(data.commitImport).toHaveBeenCalledOnce();
  });

  it("uses downloads.download(saveAs), waits for completion, then queries the final filename and opens its folder", async () => {
    const factory = await loadDownloadFactory();
    let changeListener: ((delta: DownloadDelta) => void) | undefined;
    const download = vi.fn(async () => 41);
    const search = vi.fn(async () => [
      {
        filename: "D:\\备份\\Bilimuzhi-v14-final.json",
        id: 41,
        state: "complete" as const,
      },
    ]);
    const show = vi.fn(async () => undefined);
    const revokeObjectURL = vi.fn();
    const runtime = factory({
      createObjectURL: vi.fn(() => "blob:chrome-extension://muzhi/backup-v14"),
      downloads: {
        download,
        onChanged: {
          addListener: vi.fn((listener) => {
            changeListener = listener;
          }),
          removeListener: vi.fn(),
        },
        search,
        show,
      },
      revokeObjectURL,
    });

    const pending = runtime.exportJson({
      fileName: "muzhi-v14.json",
      json: '{"version":14}',
    });
    await vi.waitFor(() =>
      expect(changeListener).toEqual(expect.any(Function)),
    );
    changeListener!({ id: 41, state: { current: "complete" } });
    const result = await pending;

    expect(download).toHaveBeenCalledWith({
      filename: "muzhi-v14.json",
      saveAs: true,
      url: "blob:chrome-extension://muzhi/backup-v14",
    });
    expect(search).toHaveBeenCalledWith({ id: 41 });
    expect(result).toEqual({
      cancelled: false,
      downloadId: 41,
      filename: "D:\\备份\\Bilimuzhi-v14-final.json",
    });
    expect(revokeObjectURL).toHaveBeenCalledWith(
      "blob:chrome-extension://muzhi/backup-v14",
    );

    await runtime.openContainingFolder(41);
    expect(show).toHaveBeenCalledWith(41);
  });

  it("treats a cancelled system save picker as cancellation, not a successful export", async () => {
    const factory = await loadDownloadFactory();
    const search = vi.fn();
    const runtime = factory({
      createObjectURL: vi.fn(() => "blob:chrome-extension://muzhi/cancelled"),
      downloads: {
        download: vi.fn(async () => undefined),
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        search,
        show: vi.fn(),
      },
      revokeObjectURL: vi.fn(),
    });

    await expect(
      runtime.exportJson({ fileName: "cancelled.json", json: "{}" }),
    ).resolves.toEqual({ cancelled: true });
    expect(search).not.toHaveBeenCalled();
  });
});
