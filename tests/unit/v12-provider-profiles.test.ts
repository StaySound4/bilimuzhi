import { describe, expect, it, vi } from "vitest";

import { createChromeSettingsStore } from "../../src/infrastructure/chrome-settings-store";
import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";

type TaskKind = "chat" | "segments" | "summary";
type ReasoningEffort = "high" | "low" | "provider-default";

interface ProviderModelProjection {
  readonly enabled: boolean;
  readonly id: string;
  readonly source: "discovered" | "manual";
  readonly verification: "unverified" | "verified";
}

interface ProviderProfileProjection {
  readonly apiKey: {
    readonly configured: boolean;
    readonly lastFour: string | null;
    readonly masked: string;
  };
  readonly baseUrl: string;
  readonly hostPermission: "granted" | "missing";
  readonly id: string;
  readonly models: readonly ProviderModelProjection[];
  readonly name: string;
}

interface TaskSelectionProjection {
  readonly modelId: string;
  readonly profileId: string;
  readonly reasoningEffort: ReasoningEffort;
  readonly reason?:
    | "API_KEY_REMOVED"
    | "HOST_PERMISSION_REVOKED"
    | "MODEL_DISABLED"
    | "MODEL_REMOVED"
    | "PROFILE_REMOVED";
  readonly state: "ready" | "needs-reselection";
}

interface V12SettingsStore {
  addManualProfileModel(
    profileId: string,
    modelId: string,
  ): Promise<ProviderProfileProjection>;
  createProviderProfile(input: {
    readonly baseUrl: string;
    readonly name?: string;
    readonly protocol: "openai-compatible";
  }): Promise<ProviderProfileProjection>;
  deleteProviderApiKey(profileId: string): Promise<{
    readonly affectedTasks: readonly TaskKind[];
  }>;
  deleteProviderProfile(profileId: string): Promise<void>;
  discoverProfileModels(profileId: string): Promise<ProviderProfileProjection>;
  ensureProfileHostPermission(
    profileId: string,
  ): Promise<ProviderProfileProjection>;
  loadProviderProfiles(): Promise<readonly ProviderProfileProjection[]>;
  loadTaskSelections(): Promise<
    Readonly<Record<TaskKind, TaskSelectionProjection | null>>
  >;
  recordTaskProviderFailure(
    kind: TaskKind,
    code: "NETWORK" | "RATE_LIMIT" | "TIMEOUT",
  ): Promise<TaskSelectionProjection>;
  moveProfileModel(
    profileId: string,
    modelId: string,
    toIndex: number,
  ): Promise<ProviderProfileProjection>;
  moveProviderProfile(
    profileId: string,
    toIndex: number,
  ): Promise<readonly ProviderProfileProjection[]>;
  reorderProfileModels(
    profileId: string,
    modelIds: readonly string[],
  ): Promise<ProviderProfileProjection>;
  reorderProviderProfiles(
    profileIds: readonly string[],
  ): Promise<readonly ProviderProfileProjection[]>;
  replaceProviderApiKey(input: {
    readonly apiKey: string;
    readonly profileId: string;
    readonly testBeforeSave: boolean;
  }): Promise<ProviderProfileProjection>;
  saveProviderApiKey(
    profileId: string,
    apiKey: string,
  ): Promise<ProviderProfileProjection>;
  saveTaskSelection(
    kind: TaskKind,
    selection: Omit<TaskSelectionProjection, "state">,
  ): Promise<Readonly<Record<TaskKind, TaskSelectionProjection | null>>>;
  setProfileModelEnabled(
    profileId: string,
    modelId: string,
    enabled: boolean,
  ): Promise<ProviderProfileProjection>;
  deleteProfileModel(
    profileId: string,
    modelId: string,
  ): Promise<ProviderProfileProjection>;
  renameProfileModel(
    profileId: string,
    modelId: string,
    nextModelId: string,
  ): Promise<ProviderProfileProjection>;
  updateProviderProfile(
    profileId: string,
    input: { readonly baseUrl: string; readonly name?: string },
  ): Promise<ProviderProfileProjection>;
}

interface HostPermissions {
  remove(input: { readonly origins: readonly string[] }): Promise<boolean>;
  request(input: { readonly origins: readonly string[] }): Promise<boolean>;
}

function createStorage(seed: Record<string, unknown> = {}) {
  const values = structuredClone(seed);
  const storage: ChromeWorkspaceStorageArea = {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
  };
  return { storage, values };
}

function createSubject(
  options: {
    readonly fetch?: typeof fetch;
    readonly permissions?: HostPermissions;
  } = {},
) {
  const { storage, values } = createStorage();
  const factory = createChromeSettingsStore as unknown as (
    storage: ChromeWorkspaceStorageArea,
    dependencies?: {
      readonly fetch?: typeof fetch;
      readonly permissions?: HostPermissions;
    },
  ) => V12SettingsStore;
  return { store: factory(storage, options), values };
}

function requireMethod<K extends keyof V12SettingsStore>(
  store: V12SettingsStore,
  name: K,
): V12SettingsStore[K] {
  expect(
    store[name],
    `A11 requires the v12 settings store method ${String(name)}`,
  ).toBeTypeOf("function");
  return store[name];
}

describe("v12 provider profiles and task choices (A11)", () => {
  it("supports multi-profile CRUD, fills the smallest 配置N name gap, and preserves explicit profile order", async () => {
    const { store } = createSubject();
    const create = requireMethod(store, "createProviderProfile").bind(store);

    const first = await create({
      baseUrl: "https://one.example.test/v1",
      protocol: "openai-compatible",
    });
    const third = await create({
      baseUrl: "https://three.example.test/v1",
      name: "配置3",
      protocol: "openai-compatible",
    });
    const second = await create({
      baseUrl: "https://two.example.test/v1",
      protocol: "openai-compatible",
    });

    expect([first.name, third.name, second.name]).toEqual([
      "配置1",
      "配置3",
      "配置2",
    ]);
    const ordered = await requireMethod(store, "reorderProviderProfiles").call(
      store,
      [third.id, first.id, second.id],
    );
    expect(ordered.map(({ id }) => id)).toEqual([
      third.id,
      first.id,
      second.id,
    ]);

    await requireMethod(store, "deleteProviderProfile").call(store, first.id);
    const reused = await create({
      baseUrl: "https://replacement.example.test/v1",
      protocol: "openai-compatible",
    });
    expect(reused.name).toBe("配置1");
  });

  it("keeps discovered and manual models, enablement, verification, and ordering under their owning profile", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: [{ id: "model-z" }, { id: "model-a" }] }),
          {
            status: 200,
          },
        ),
    );
    const { store } = createSubject({ fetch });
    const profile = await requireMethod(store, "createProviderProfile").call(
      store,
      {
        baseUrl: "https://models.example.test/v1",
        protocol: "openai-compatible",
      },
    );
    let updated = await requireMethod(store, "discoverProfileModels").call(
      store,
      profile.id,
    );
    expect(updated.models.map(({ id }) => id)).toEqual(["model-z", "model-a"]);
    expect(updated.models.every(({ source }) => source === "discovered")).toBe(
      true,
    );

    updated = await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "manual-preview",
    );
    expect(updated.models).toContainEqual(
      expect.objectContaining({
        enabled: true,
        id: "manual-preview",
        source: "manual",
        verification: "unverified",
      }),
    );
    updated = await requireMethod(store, "setProfileModelEnabled").call(
      store,
      profile.id,
      "model-a",
      false,
    );
    expect(updated.models.find(({ id }) => id === "model-a")?.enabled).toBe(
      false,
    );
    updated = await requireMethod(store, "reorderProfileModels").call(
      store,
      profile.id,
      ["manual-preview", "model-a", "model-z"],
    );
    expect(updated.models.map(({ id }) => id)).toEqual([
      "manual-preview",
      "model-a",
      "model-z",
    ]);
  });

  it("persists three independent profile+model+reasoning combinations without coupling or automatic fallback", async () => {
    const { store } = createSubject();
    const create = requireMethod(store, "createProviderProfile").bind(store);
    const alpha = await create({
      baseUrl: "https://alpha.example.test/v1",
      protocol: "openai-compatible",
    });
    const beta = await create({
      baseUrl: "https://beta.example.test/v1",
      protocol: "openai-compatible",
    });
    for (const [profileId, modelId] of [
      [alpha.id, "alpha-chat"],
      [alpha.id, "alpha-summary"],
      [beta.id, "beta-segments"],
    ] as const) {
      await requireMethod(store, "addManualProfileModel").call(
        store,
        profileId,
        modelId,
      );
    }

    const save = requireMethod(store, "saveTaskSelection").bind(store);
    await save("chat", {
      modelId: "alpha-chat",
      profileId: alpha.id,
      reasoningEffort: "high",
    });
    await save("summary", {
      modelId: "alpha-summary",
      profileId: alpha.id,
      reasoningEffort: "provider-default",
    });
    await save("segments", {
      modelId: "beta-segments",
      profileId: beta.id,
      reasoningEffort: "low",
    });

    const before = await requireMethod(store, "loadTaskSelections").call(store);
    expect(before).toMatchObject({
      chat: { modelId: "alpha-chat", profileId: alpha.id, state: "ready" },
      segments: {
        modelId: "beta-segments",
        profileId: beta.id,
        state: "ready",
      },
      summary: {
        modelId: "alpha-summary",
        profileId: alpha.id,
        // v13 语义：provider-default 规范化为 auto。
        reasoningEffort: "auto",
        state: "ready",
      },
    });

    await requireMethod(store, "setProfileModelEnabled").call(
      store,
      alpha.id,
      "alpha-summary",
      false,
    );
    const after = await requireMethod(store, "loadTaskSelections").call(store);
    expect(after.chat).toEqual(before.chat);
    expect(after.segments).toEqual(before.segments);
    expect(after.summary).toMatchObject({
      modelId: "alpha-summary",
      profileId: alpha.id,
      reason: "MODEL_DISABLED",
      state: "needs-reselection",
    });
    expect(after.summary?.modelId).not.toBe("alpha-chat");

    await expect(
      requireMethod(store, "recordTaskProviderFailure").call(
        store,
        "chat",
        "RATE_LIMIT",
      ),
    ).resolves.toEqual(before.chat);
  });

  it("requests only the exact optional host, retains a denied profile/base URL, and revokes the last unused origin", async () => {
    const request = vi
      .fn<HostPermissions["request"]>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    const remove = vi.fn<HostPermissions["remove"]>(async () => true);
    const { store } = createSubject({ permissions: { remove, request } });
    const create = requireMethod(store, "createProviderProfile").bind(store);

    const denied = await create({
      baseUrl: "https://denied.example.test/v1",
      protocol: "openai-compatible",
    });
    expect(request).toHaveBeenNthCalledWith(1, {
      origins: ["https://denied.example.test/*"],
    });
    expect(denied).toMatchObject({
      baseUrl: "https://denied.example.test/v1",
      hostPermission: "missing",
    });
    expect(JSON.stringify(request.mock.calls)).not.toContain("<all_urls>");

    const granted = await create({
      baseUrl: "https://old.example.test/v1",
      protocol: "openai-compatible",
    });
    request.mockResolvedValueOnce(false);
    await expect(
      requireMethod(store, "updateProviderProfile").call(store, granted.id, {
        baseUrl: "https://new.example.test/v1",
      }),
    ).rejects.toMatchObject({ code: "HOST_PERMISSION_DENIED" });
    const retained = await requireMethod(store, "loadProviderProfiles").call(
      store,
    );
    expect(retained.find(({ id }) => id === granted.id)?.baseUrl).toBe(
      "https://old.example.test/v1",
    );

    await requireMethod(store, "deleteProviderProfile").call(store, granted.id);
    expect(remove).toHaveBeenCalledWith({
      origins: ["https://old.example.test/*"],
    });
  });

  it("fails closed on cross-origin redirects and never sends credentials or API keys to the redirect target", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
      expect(init).toMatchObject({ credentials: "omit", redirect: "error" });
      expect(String(_input)).toContain("https://origin.example.test/");
      return new Response(null, {
        headers: { location: "https://redirect.example.test/v1/models" },
        status: 302,
      });
    });
    const permissions: HostPermissions = {
      remove: vi.fn(async () => true),
      request: vi.fn(async () => true),
    };
    const { store } = createSubject({ fetch, permissions });
    const profile = await requireMethod(store, "createProviderProfile").call(
      store,
      {
        baseUrl: "https://origin.example.test/v1",
        protocol: "openai-compatible",
      },
    );
    await requireMethod(store, "saveProviderApiKey").call(
      store,
      profile.id,
      "provider-key-for-tests-4821",
    );

    await expect(
      requireMethod(store, "discoverProfileModels").call(store, profile.id),
    ).rejects.toMatchObject({ code: "CROSS_ORIGIN_REDIRECT" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain(
      "redirect.example.test",
    );
  });

  it("projects only a stable last-four mask, atomically retains an old key on failed replacement, and reports deletion impact", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
      .mockRejectedValueOnce(new Error("test connection failed"));
    const { store, values } = createSubject({ fetch });
    const profile = await requireMethod(store, "createProviderProfile").call(
      store,
      {
        baseUrl: "https://keys.example.test/v1",
        protocol: "openai-compatible",
      },
    );
    const saved = await requireMethod(store, "saveProviderApiKey").call(
      store,
      profile.id,
      "provider-key-for-tests-4821",
    );
    expect(saved.apiKey).toEqual({
      configured: true,
      lastFour: "4821",
      masked: "•••• 4821",
    });
    expect(JSON.stringify(saved)).not.toContain("provider-key-for-tests-4821");

    await expect(
      requireMethod(store, "replaceProviderApiKey").call(store, {
        apiKey: "replacement-key-for-tests-9137",
        profileId: profile.id,
        testBeforeSave: true,
      }),
    ).rejects.toBeDefined();
    expect(JSON.stringify(values)).toContain("provider-key-for-tests-4821");
    expect(JSON.stringify(values)).not.toContain(
      "replacement-key-for-tests-9137",
    );

    await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "key-model",
    );
    await requireMethod(store, "saveTaskSelection").call(store, "chat", {
      modelId: "key-model",
      profileId: profile.id,
      reasoningEffort: "provider-default",
    });
    const deletion = await requireMethod(store, "deleteProviderApiKey").call(
      store,
      profile.id,
    );
    expect(deletion.affectedTasks).toEqual(["chat"]);
    await expect(
      requireMethod(store, "loadTaskSelections").call(store),
    ).resolves.toMatchObject({
      chat: { reason: "API_KEY_REMOVED", state: "needs-reselection" },
    });
  });
});

describe("v15 step5 profile editing, uniqueness, and model removal (A11-s5)", () => {
  it("rejects duplicate profile names, blank names, and names longer than 30 characters on create", async () => {
    const { store } = createSubject();
    const create = requireMethod(store, "createProviderProfile").bind(store);
    await create({
      baseUrl: "https://one.example.test/v1",
      name: "  现有配置  ",
      protocol: "openai-compatible",
    });

    await expect(
      create({
        baseUrl: "https://two.example.test/v1",
        name: "  现有配置  ",
        protocol: "openai-compatible",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_PROFILE_NAME" });

    await expect(
      create({
        baseUrl: "https://three.example.test/v1",
        name: "   ",
        protocol: "openai-compatible",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROFILE_NAME" });

    await expect(
      create({
        baseUrl: "https://four.example.test/v1",
        name: "超长配置名称".repeat(6),
        protocol: "openai-compatible",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROFILE_NAME" });
  });

  it("renames a profile and rejects a duplicate rename while keeping the original name intact", async () => {
    const { store } = createSubject();
    const create = requireMethod(store, "createProviderProfile").bind(store);
    const alpha = await create({
      baseUrl: "https://alpha.example.test/v1",
      name: "Alpha",
      protocol: "openai-compatible",
    });
    const beta = await create({
      baseUrl: "https://beta.example.test/v1",
      name: "Beta",
      protocol: "openai-compatible",
    });

    const renamed = await requireMethod(store, "updateProviderProfile").call(
      store,
      alpha.id,
      { baseUrl: alpha.baseUrl, name: "Alpha 新名" },
    );
    expect(renamed.name).toBe("Alpha 新名");

    await expect(
      requireMethod(store, "updateProviderProfile").call(store, alpha.id, {
        baseUrl: alpha.baseUrl,
        name: "Beta",
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_PROFILE_NAME" });

    await expect(
      requireMethod(store, "updateProviderProfile").call(store, alpha.id, {
        baseUrl: alpha.baseUrl,
        name: "   ",
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROFILE_NAME" });

    const retained = await requireMethod(store, "loadProviderProfiles").call(
      store,
    );
    expect(retained.find(({ id }) => id === alpha.id)?.name).toBe("Alpha 新名");
    expect(retained.find(({ id }) => id === beta.id)?.name).toBe("Beta");
  });

  it("deletes a model and sends referencing tasks into needs-reselection without automatic fallback", async () => {
    const { store } = createSubject();
    const create = requireMethod(store, "createProviderProfile").bind(store);
    const profile = await create({
      baseUrl: "https://models.example.test/v1",
      protocol: "openai-compatible",
    });
    await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "model-to-keep",
    );
    await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "model-to-delete",
    );
    await requireMethod(store, "saveTaskSelection").call(store, "chat", {
      modelId: "model-to-delete",
      profileId: profile.id,
      reasoningEffort: "provider-default",
    });

    const updated = await requireMethod(store, "deleteProfileModel").call(
      store,
      profile.id,
      "model-to-delete",
    );
    expect(updated.models.map(({ id }) => id)).toEqual(["model-to-keep"]);

    const selections = await requireMethod(store, "loadTaskSelections").call(
      store,
    );
    expect(selections.chat).toMatchObject({
      modelId: "model-to-delete",
      profileId: profile.id,
      reason: "MODEL_REMOVED",
      state: "needs-reselection",
    });
  });
});

describe("v15 step5 model rename", () => {
  it("renames a model within its profile and rejects a blank or duplicate target", async () => {
    const { store } = createSubject();
    const create = requireMethod(store, "createProviderProfile").bind(store);
    const profile = await create({
      baseUrl: "https://models.example.test/v1",
      protocol: "openai-compatible",
    });
    await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "model-a",
    );
    await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "model-b",
    );

    const renamed = await requireMethod(store, "renameProfileModel").call(
      store,
      profile.id,
      "model-a",
      "model-renamed",
    );
    expect(renamed.models.map(({ id }) => id).sort()).toEqual([
      "model-b",
      "model-renamed",
    ]);

    await expect(
      requireMethod(store, "renameProfileModel").call(
        store,
        profile.id,
        "model-b",
        "  ",
      ),
    ).rejects.toMatchObject({ code: "INVALID_MODEL" });

    await expect(
      requireMethod(store, "renameProfileModel").call(
        store,
        profile.id,
        "model-b",
        "model-renamed",
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_MODEL_NAME" });

    const retained = await requireMethod(store, "loadProviderProfiles").call(
      store,
    );
    expect(retained[0]?.models.map(({ id }) => id).sort()).toEqual([
      "model-b",
      "model-renamed",
    ]);
  });

  it("sends tasks referencing the old model id into needs-reselection after rename", async () => {
    const { store } = createSubject();
    const create = requireMethod(store, "createProviderProfile").bind(store);
    const profile = await create({
      baseUrl: "https://models.example.test/v1",
      protocol: "openai-compatible",
    });
    await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "model-old",
    );
    await requireMethod(store, "saveTaskSelection").call(store, "chat", {
      modelId: "model-old",
      profileId: profile.id,
      reasoningEffort: "provider-default",
    });

    await requireMethod(store, "renameProfileModel").call(
      store,
      profile.id,
      "model-old",
      "model-new",
    );

    const selections = await requireMethod(store, "loadTaskSelections").call(
      store,
    );
    expect(selections.chat).toMatchObject({
      modelId: "model-old",
      profileId: profile.id,
      reason: "MODEL_REMOVED",
      state: "needs-reselection",
    });
  });
});

describe("v15 step5 bugfix: delete/reorder persist consistency (A11-s5-fix)", () => {
  it("moves a profile by id+index against the latest persisted order and clamps out-of-range indexes", async () => {
    const { store } = createSubject();
    const create = requireMethod(store, "createProviderProfile").bind(store);
    const move = requireMethod(store, "moveProviderProfile").bind(store);
    const a = await create({
      baseUrl: "https://a.example.test/v1",
      name: "A",
      protocol: "openai-compatible",
    });
    const b = await create({
      baseUrl: "https://b.example.test/v1",
      name: "B",
      protocol: "openai-compatible",
    });
    const c = await create({
      baseUrl: "https://c.example.test/v1",
      name: "C",
      protocol: "openai-compatible",
    });

    const moved = await move(c.id, 0);
    expect(moved.map(({ id }) => id)).toEqual([c.id, a.id, b.id]);

    const clamped = await move(c.id, 99);
    expect(clamped.map(({ id }) => id)).toEqual([a.id, b.id, c.id]);

    await expect(move("profile-missing", 0)).rejects.toMatchObject({
      code: "PROFILE_NOT_FOUND",
    });
  });

  it("moves a model by id+index against the latest persisted model list", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), {
          status: 200,
        }),
    );
    const { store } = createSubject({ fetch });
    const profile = await requireMethod(store, "createProviderProfile").call(
      store,
      {
        baseUrl: "https://models.example.test/v1",
        protocol: "openai-compatible",
      },
    );
    await requireMethod(store, "discoverProfileModels").call(store, profile.id);
    await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "manual-extra",
    );

    const updated = await requireMethod(store, "moveProfileModel").call(
      store,
      profile.id,
      "manual-extra",
      0,
    );
    expect(updated.models.map(({ id }) => id)).toEqual([
      "manual-extra",
      "m1",
      "m2",
    ]);
    await expect(
      requireMethod(store, "moveProfileModel").call(
        store,
        profile.id,
        "missing-model",
        0,
      ),
    ).rejects.toMatchObject({ code: "MODEL_NOT_FOUND" });
  });

  it("still deletes successfully when revoking the origin host permission fails", async () => {
    const permissions = {
      request: vi.fn(async () => true),
      remove: vi.fn(async () => {
        throw new Error("permission revocation failed");
      }),
    };
    const { store } = createSubject({ permissions });
    const profile = await requireMethod(store, "createProviderProfile").call(
      store,
      {
        baseUrl: "https://revoke.example.test/v1",
        protocol: "openai-compatible",
      },
    );
    await expect(
      requireMethod(store, "deleteProviderProfile").call(store, profile.id),
    ).resolves.toBeUndefined();
    expect(
      await requireMethod(store, "loadProviderProfiles").call(store),
    ).toEqual([]);
  });
});

describe("v15 step5 bugfix: model discovery append semantics (A11-s5-discovery)", () => {
  it("appends newly discovered models at the end and keeps existing order, enablement, and source on re-discovery", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "model-z" }, { id: "model-a" }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ data: [{ id: "model-a" }, { id: "model-new" }] }),
          { status: 200 },
        ),
      );
    const { store } = createSubject({ fetch });
    const profile = await requireMethod(store, "createProviderProfile").call(
      store,
      {
        baseUrl: "https://append.example.test/v1",
        protocol: "openai-compatible",
      },
    );
    await requireMethod(store, "discoverProfileModels").call(store, profile.id);
    await requireMethod(store, "addManualProfileModel").call(
      store,
      profile.id,
      "manual-extra",
    );
    await requireMethod(store, "setProfileModelEnabled").call(
      store,
      profile.id,
      "model-a",
      false,
    );

    const updated = await requireMethod(store, "discoverProfileModels").call(
      store,
      profile.id,
    );
    // 原列表位置与顺序不变，重名跳过，新模型顺延追加到末尾。
    expect(updated.models.map(({ id }) => id)).toEqual([
      "model-z",
      "model-a",
      "manual-extra",
      "model-new",
    ]);
    expect(updated.models.find(({ id }) => id === "model-a")).toMatchObject({
      enabled: false,
      verification: "verified",
    });
    expect(
      updated.models.find(({ id }) => id === "manual-extra"),
    ).toMatchObject({
      source: "manual",
      verification: "unverified",
    });
    expect(updated.models.find(({ id }) => id === "model-new")).toMatchObject({
      enabled: true,
      source: "discovered",
      verification: "verified",
    });
  });

  it("grants and persists the exact host permission on demand and rejects when denied", async () => {
    const permissions = {
      request: vi.fn(async () => false),
      remove: vi.fn(async () => true),
    };
    const { store } = createSubject({ permissions });
    const profile = await requireMethod(store, "createProviderProfile").call(
      store,
      {
        baseUrl: "https://perm.example.test/v1",
        protocol: "openai-compatible",
      },
    );
    expect(profile.hostPermission).toBe("missing");

    await expect(
      requireMethod(store, "ensureProfileHostPermission").call(
        store,
        profile.id,
      ),
    ).rejects.toMatchObject({ code: "HOST_PERMISSION_DENIED" });

    permissions.request.mockResolvedValueOnce(true);
    const updated = await requireMethod(
      store,
      "ensureProfileHostPermission",
    ).call(store, profile.id);
    expect(updated.hostPermission).toBe("granted");
    expect(
      await requireMethod(store, "loadProviderProfiles").call(store),
    ).toContainEqual(
      expect.objectContaining({ id: profile.id, hostPermission: "granted" }),
    );
  });
});
