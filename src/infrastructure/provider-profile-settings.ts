import type { ChromeWorkspaceStorageArea } from "./chrome-workspace-state-store";
import type {
  AiProviderGateway,
  AiReasoningPreference,
} from "../application/ai/provider-contract";
import {
  CUSTOM_REASONING_EFFORT_MAX_LENGTH,
  isCustomReasoningEffort,
} from "../application/ai/provider-contract";
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError,
  type AiProviderErrorCode,
} from "../application/ai/provider-error";
import {
  createAiProviderGateway,
  type AiProviderGatewayDependencies,
} from "./ai/provider-gateway";

export const V12_SETTINGS_STORAGE_KEY = "muzhi.settings.v12";
export const V12_SETTINGS_SECRET_STORAGE_KEY = "muzhi.settings.secret.v12";
export const V13_SETTINGS_STORAGE_KEY = "muzhi.settings.v13";
export const V13_SETTINGS_SECRET_STORAGE_KEY = "muzhi.settings.secret.v13";

/** v13 profile 协议：OpenAI 兼容 chat/completions 或 Responses。 */
/**
 * v13 profile 协议：OpenAI 兼容 chat/completions 或 Responses；
 * "ollama-chat" 为 Ollama 端点类型预留扩展位（本切片 wire 仍走
 * OpenAI 兼容 /v1/chat/completions，原生 /api/chat + think 作为后续增强）。
 */
export type V13ProfileProtocol =
  "openai-chat" | "openai-responses" | "ollama-chat";

/** 每模型思考覆盖（按 profileId+modelId 复合键）。 */
export interface ModelReasoningOverride {
  readonly effort: string;
  readonly enabled: boolean;
}
export type V12TaskKind = "chat" | "segments" | "summary";
export type V12ReasoningEffort = "high" | "low" | "medium" | "provider-default";
export type ImageCapabilityState = "supported" | "unknown" | "unsupported";

export interface ImageCapabilityProjection {
  readonly modelId: string;
  readonly profileId: string;
  readonly state: ImageCapabilityState;
}

export type ImageCapabilityEvidence =
  | { readonly outcome: "success" }
  | {
      readonly classification?: "image-input" | "multimodal-content";
      readonly code: AiProviderErrorCode;
      readonly outcome: "failure";
    };

export interface ProviderModelProjection {
  readonly enabled: boolean;
  readonly id: string;
  readonly source: "discovered" | "manual";
  readonly verification: "unverified" | "verified";
}

export interface ProviderProfileProjection {
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
  readonly protocol: V13ProfileProtocol;
}

export interface TaskSelectionProjection {
  readonly modelId: string;
  readonly profileId: string;
  readonly reasoningEffort: AiReasoningPreference;
  readonly reason?:
    | "API_KEY_REMOVED"
    | "HOST_PERMISSION_REVOKED"
    | "MODEL_DISABLED"
    | "MODEL_REMOVED"
    | "PROFILE_REMOVED";
  readonly state: "ready" | "needs-reselection";
}

interface StoredV13Settings {
  appearance?: unknown;
  archivedSegmentPrompts: readonly {
    readonly content: string;
    readonly name: string;
    readonly readOnly: true;
  }[];
  imageCapabilities: readonly ImageCapabilityProjection[];
  modelReasoningOverrides: Readonly<Record<string, ModelReasoningOverride>>;
  profiles: readonly Omit<ProviderProfileProjection, "apiKey">[];
  promptPresets: readonly {
    readonly content: string;
    readonly id: string;
    readonly kind: "chat" | "summary";
    readonly name: string;
  }[];
  speech: { readonly groqApiKeyConfigured: boolean };
  taskSelections: Readonly<
    Record<
      V12TaskKind,
      Omit<TaskSelectionProjection, "reason" | "state"> | null
    >
  >;
  customReasoningEfforts: readonly string[];
  version: 13;
}

interface StoredV13Secrets {
  groqApiKey: string | null;
  providerApiKeys: Readonly<Record<string, string>>;
  removedProviderKeyIds: readonly string[];
  version: 13;
}

export interface V12HostPermissions {
  remove(input: { readonly origins: readonly string[] }): Promise<boolean>;
  request(input: { readonly origins: readonly string[] }): Promise<boolean>;
}

export class V12SettingsError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "V12SettingsError";
  }
}

const EMPTY_SELECTIONS: StoredV13Settings["taskSelections"] = Object.freeze({
  chat: null,
  segments: null,
  summary: null,
});

function emptySettings(): StoredV13Settings {
  return {
    archivedSegmentPrompts: [],
    customReasoningEfforts: [],
    imageCapabilities: [],
    modelReasoningOverrides: {},
    profiles: [],
    promptPresets: [],
    speech: { groqApiKeyConfigured: false },
    taskSelections: EMPTY_SELECTIONS,
    version: 13,
  };
}

function emptySecrets(): StoredV13Secrets {
  return {
    groqApiKey: null,
    providerApiKeys: {},
    removedProviderKeyIds: [],
    version: 13,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isImageCapabilityState(value: unknown): value is ImageCapabilityState {
  return (
    value === "supported" || value === "unknown" || value === "unsupported"
  );
}

function readImageCapabilities(value: unknown): ImageCapabilityProjection[] {
  if (!Array.isArray(value)) return [];
  const capabilities = new Map<string, ImageCapabilityProjection>();
  for (const candidate of value) {
    if (
      !isRecord(candidate) ||
      typeof candidate.profileId !== "string" ||
      candidate.profileId.length === 0 ||
      typeof candidate.modelId !== "string" ||
      candidate.modelId.length === 0 ||
      !isImageCapabilityState(candidate.state)
    ) {
      continue;
    }
    const projection: ImageCapabilityProjection = {
      modelId: candidate.modelId,
      profileId: candidate.profileId,
      state: candidate.state,
    };
    capabilities.set(
      JSON.stringify([projection.profileId, projection.modelId]),
      projection,
    );
  }
  return [...capabilities.values()];
}

/**
 * 协议旧值规范化：v12 的 "openai-compatible" 与更早的 "openai"
 * 一律规范为 "openai-chat"（OpenAI 兼容 chat/completions）。
 */
function normalizeProtocol(value: unknown): V13ProfileProtocol {
  if (value === "openai-responses" || value === "ollama-chat") return value;
  return "openai-chat";
}

/**
 * 档位语义规范化：v12 的 "provider-default" 对应新语义的 "auto"；
 * 其余值（内置档位/自定义档位）原样保留。
 */
function normalizeReasoningEffort(value: unknown): AiReasoningPreference {
  return typeof value === "string" && value !== "provider-default"
    ? value
    : "auto";
}

function normalizeProfiles(
  value: unknown,
): Omit<ProviderProfileProjection, "apiKey">[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isRecord(candidate)) return [];
    const protocol = normalizeProtocol(candidate.protocol);
    // 迁移期识别：手填 Ollama 本地端点的旧配置自动标记 ollama-chat
    // （端点类型预留位），使家族注册表能按 providerId=ollama 提供档位。
    const effectiveProtocol =
      protocol === "openai-chat" &&
      typeof candidate.baseUrl === "string" &&
      candidate.baseUrl.startsWith("http://localhost:11434")
        ? "ollama-chat"
        : protocol;
    return [
      {
        ...candidate,
        protocol: effectiveProtocol,
      } as unknown as Omit<ProviderProfileProjection, "apiKey">,
    ];
  });
}

function normalizeTaskSelections(
  value: unknown,
): StoredV13Settings["taskSelections"] {
  const readOne = (
    kind: V12TaskKind,
  ): Omit<TaskSelectionProjection, "reason" | "state"> | null => {
    const selection = isRecord(value) ? value[kind] : null;
    if (
      !isRecord(selection) ||
      typeof selection.modelId !== "string" ||
      typeof selection.profileId !== "string"
    ) {
      return null;
    }
    return {
      modelId: selection.modelId,
      profileId: selection.profileId,
      reasoningEffort: normalizeReasoningEffort(selection.reasoningEffort),
    };
  };
  return Object.freeze({
    chat: readOne("chat"),
    segments: readOne("segments"),
    summary: readOne("summary"),
  });
}

function asSettings(value: unknown): StoredV13Settings {
  if (
    !isRecord(value) ||
    value.version !== 13 ||
    !Array.isArray(value.profiles)
  ) {
    return emptySettings();
  }
  return {
    ...(value as unknown as StoredV13Settings),
    customReasoningEfforts: readCustomReasoningEfforts(
      value.customReasoningEfforts,
    ),
    imageCapabilities: readImageCapabilities(value.imageCapabilities),
    modelReasoningOverrides: readModelReasoningOverrides(
      value.modelReasoningOverrides,
    ),
    profiles: normalizeProfiles(value.profiles),
    taskSelections: normalizeTaskSelections(value.taskSelections),
  };
}

function asSecrets(value: unknown): StoredV13Secrets {
  if (
    !isRecord(value) ||
    !(value.version === 13 || value.version === 12) ||
    !isRecord(value.providerApiKeys)
  ) {
    return emptySecrets();
  }
  return {
    groqApiKey: typeof value.groqApiKey === "string" ? value.groqApiKey : null,
    providerApiKeys: value.providerApiKeys as Record<string, string>,
    removedProviderKeyIds: Array.isArray(value.removedProviderKeyIds)
      ? value.removedProviderKeyIds.filter(
          (candidate): candidate is string => typeof candidate === "string",
        )
      : [],
    version: 13,
  };
}

function readModelReasoningOverrides(
  value: unknown,
): Readonly<Record<string, ModelReasoningOverride>> {
  if (!isRecord(value)) return {};
  const result: Record<string, ModelReasoningOverride> = {};
  for (const [key, override] of Object.entries(value)) {
    if (
      key.length > 0 &&
      isRecord(override) &&
      typeof override.enabled === "boolean" &&
      typeof override.effort === "string" &&
      override.effort.length > 0
    ) {
      result[key] = Object.freeze({
        effort: override.effort,
        enabled: override.enabled,
      });
    }
  }
  return result;
}

function readCustomReasoningEfforts(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (candidate): candidate is string =>
      typeof candidate === "string" && isCustomReasoningEffort(candidate),
  );
}

function exactOriginPattern(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        (url.hostname === "localhost" || url.hostname === "127.0.0.1")
      ))
  ) {
    throw new V12SettingsError("INVALID_PROVIDER_URL", "Provider URL 不安全。");
  }
  return `${url.origin}/*`;
}

function apiKeyProjection(apiKey: string | undefined) {
  if (apiKey === undefined) {
    return { configured: false, lastFour: null, masked: "未保存" } as const;
  }
  const lastFour = apiKey.slice(-4);
  return { configured: true, lastFour, masked: `•••• ${lastFour}` } as const;
}

function uniqueOrder<T extends { readonly id: string }>(
  values: readonly T[],
  ids: readonly string[],
): T[] {
  if (
    ids.length !== values.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !values.some((value) => value.id === id))
  ) {
    throw new V12SettingsError("INVALID_ORDER", "排序必须完整且不能重复。");
  }
  return ids.map((id) => values.find((value) => value.id === id)!);
}

function modelReasoningOverrideKey(profileId: string, modelId: string): string {
  return `${profileId}\u0000${modelId}`;
}

/**
 * 自定义档位清单校验：每项必须通过 isCustomReasoningEffort
 * （非空、≤24 字符、[a-z0-9_-]、非内置档位），大小写不敏感查重，
 * 顺序按传入列表保留（排序由 UI 控制）。
 */
function normalizeCustomReasoningEfforts(
  efforts: readonly string[],
): readonly string[] {
  const seen = new Set<string>();
  for (const effort of efforts) {
    if (!isCustomReasoningEffort(effort)) {
      throw new V12SettingsError(
        "INVALID_REASONING_EFFORT",
        `自定义档位需为 1-${CUSTOM_REASONING_EFFORT_MAX_LENGTH} 个字符，且只允许小写字母、数字、下划线与连字符。`,
      );
    }
    const folded = effort.toLowerCase();
    if (seen.has(folded)) {
      throw new V12SettingsError(
        "DUPLICATE_REASONING_EFFORT",
        "自定义档位不能重复（忽略大小写）。",
      );
    }
    seen.add(folded);
  }
  return Object.freeze([...efforts]);
}

function nextProfileName(
  profiles: readonly { readonly name: string }[],
): string {
  const used = new Set(profiles.map(({ name }) => name));
  for (let index = 1; ; index += 1) {
    const candidate = `配置${index}`;
    if (!used.has(candidate)) return candidate;
  }
}

function validateProfileName(
  profiles: readonly { readonly id: string; readonly name: string }[],
  name: string,
  options?: { readonly exceptProfileId?: string },
): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 30) {
    throw new V12SettingsError(
      "INVALID_PROFILE_NAME",
      "配置名称必须为非空且不超过 30 个字符。",
    );
  }
  const duplicate = profiles.some(
    (profile) =>
      profile.id !== options?.exceptProfileId && profile.name === normalized,
  );
  if (duplicate) {
    throw new V12SettingsError(
      "DUPLICATE_PROFILE_NAME",
      "配置名称已存在，请换一个名称。",
    );
  }
  return normalized;
}

function cloneSettings(settings: StoredV13Settings): StoredV13Settings {
  return structuredClone(settings);
}

function cloneSecrets(secrets: StoredV13Secrets): StoredV13Secrets {
  return structuredClone(secrets);
}

export function createProviderProfileSettingsStore(dependencies: {
  readonly fetch?: typeof globalThis.fetch;
  readonly permissions?: V12HostPermissions;
  readonly storage: ChromeWorkspaceStorageArea;
}) {
  const requestFetch = dependencies.fetch ?? globalThis.fetch;
  const permissions: V12HostPermissions = dependencies.permissions ?? {
    remove: async () => true,
    request: async () => true,
  };

  async function read(): Promise<{
    settings: StoredV13Settings;
    secrets: StoredV13Secrets;
  }> {
    const settingsResult = await dependencies.storage.get(
      V13_SETTINGS_STORAGE_KEY,
    );
    const stored = settingsResult[V13_SETTINGS_STORAGE_KEY];
    if (isRecord(stored) && stored.version === 13) {
      const secretsResult = await dependencies.storage.get(
        V13_SETTINGS_SECRET_STORAGE_KEY,
      );
      return {
        settings: asSettings(stored),
        secrets: asSecrets(secretsResult[V13_SETTINGS_SECRET_STORAGE_KEY]),
      };
    }
    // 无 v13 记录：尝试从 v12 无感迁移（v12 原数据保留作备份）。
    return migrateV12SettingsToV13(dependencies.storage);
  }

  async function persist(
    settings: StoredV13Settings,
    secrets?: StoredV13Secrets,
  ): Promise<void> {
    await dependencies.storage.set({
      [V13_SETTINGS_STORAGE_KEY]: settings,
      ...(secrets === undefined
        ? {}
        : { [V13_SETTINGS_SECRET_STORAGE_KEY]: secrets }),
    });
  }

  function projectProfile(
    profile: Omit<ProviderProfileProjection, "apiKey">,
    secrets: StoredV13Secrets,
  ): ProviderProfileProjection {
    return {
      ...structuredClone(profile),
      apiKey: apiKeyProjection(secrets.providerApiKeys[profile.id]),
    };
  }

  function requireProfile(
    settings: StoredV13Settings,
    id: string,
  ): Omit<ProviderProfileProjection, "apiKey"> {
    const profile = settings.profiles.find((candidate) => candidate.id === id);
    if (!profile) {
      throw new V12SettingsError("PROFILE_NOT_FOUND", "语言模型配置不存在。");
    }
    return profile;
  }

  function requireProfileModel(
    settings: StoredV13Settings,
    profileId: string,
    modelId: string,
  ): void {
    const profile = requireProfile(settings, profileId);
    if (!profile.models.some((model) => model.id === modelId)) {
      throw new V12SettingsError("MODEL_NOT_FOUND", "模型不存在。");
    }
  }

  function projectImageCapability(
    settings: StoredV13Settings,
    profileId: string,
    modelId: string,
  ): ImageCapabilityProjection {
    const state =
      settings.imageCapabilities.find(
        (candidate) =>
          candidate.profileId === profileId && candidate.modelId === modelId,
      )?.state ?? "unknown";
    return { modelId, profileId, state };
  }

  function resetProfileImageCapabilities(
    settings: StoredV13Settings,
    profileId: string,
  ): void {
    settings.imageCapabilities = settings.imageCapabilities.filter(
      (candidate) => candidate.profileId !== profileId,
    );
  }

  function resetModelImageCapability(
    settings: StoredV13Settings,
    profileId: string,
    modelId: string,
  ): void {
    settings.imageCapabilities = settings.imageCapabilities.filter(
      (candidate) =>
        candidate.profileId !== profileId || candidate.modelId !== modelId,
    );
  }

  function setImageCapability(
    settings: StoredV13Settings,
    projection: ImageCapabilityProjection,
  ): void {
    resetModelImageCapability(
      settings,
      projection.profileId,
      projection.modelId,
    );
    if (projection.state !== "unknown") {
      settings.imageCapabilities = [...settings.imageCapabilities, projection];
    }
  }

  function projectSelection(
    kind: V12TaskKind,
    settings: StoredV13Settings,
    secrets: StoredV13Secrets,
  ): TaskSelectionProjection | null {
    const selection = settings.taskSelections[kind];
    if (selection === null) return null;
    const profile = settings.profiles.find(
      (candidate) => candidate.id === selection.profileId,
    );
    if (!profile) {
      return {
        ...selection,
        reason: "PROFILE_REMOVED",
        state: "needs-reselection",
      };
    }
    const model = profile.models.find(({ id }) => id === selection.modelId);
    if (!model) {
      return {
        ...selection,
        reason: "MODEL_REMOVED",
        state: "needs-reselection",
      };
    }
    if (!model.enabled) {
      return {
        ...selection,
        reason: "MODEL_DISABLED",
        state: "needs-reselection",
      };
    }
    if (profile.hostPermission === "missing") {
      return {
        ...selection,
        reason: "HOST_PERMISSION_REVOKED",
        state: "needs-reselection",
      };
    }
    if (secrets.removedProviderKeyIds.includes(profile.id)) {
      return {
        ...selection,
        reason: "API_KEY_REMOVED",
        state: "needs-reselection",
      };
    }
    return { ...selection, state: "ready" };
  }

  async function testConnection(
    profile: Omit<ProviderProfileProjection, "apiKey">,
    apiKey: string | undefined,
  ): Promise<Response> {
    const baseUrl = profile.baseUrl.replace(/\/+$/, "");
    const response = await requestFetch(`${baseUrl}/models`, {
      credentials: "omit",
      headers:
        apiKey === undefined ? {} : { Authorization: `Bearer ${apiKey}` },
      redirect: "error",
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location !== null) {
      const target = new URL(location, profile.baseUrl);
      if (target.origin !== new URL(profile.baseUrl).origin) {
        throw new V12SettingsError(
          "CROSS_ORIGIN_REDIRECT",
          "Provider 跨来源重定向已被拒绝。",
        );
      }
    }
    if (!response.ok) {
      throw new V12SettingsError(
        "PROVIDER_TEST_FAILED",
        "Provider 连接测试失败。",
      );
    }
    return response;
  }

  return {
    async addManualProfileModel(profileId: string, modelId: string) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      const normalized = modelId.trim();
      if (!normalized)
        throw new V12SettingsError("INVALID_MODEL", "模型 ID 不能为空。");
      const models = profile.models.some(({ id }) => id === normalized)
        ? profile.models
        : [
            ...profile.models,
            {
              enabled: true,
              id: normalized,
              source: "manual" as const,
              verification: "unverified" as const,
            },
          ];
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId ? { ...candidate, models } : candidate,
      );
      await persist(settings);
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },
    async renameProfileModel(
      profileId: string,
      modelId: string,
      nextModelId: string,
    ) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      requireProfileModel(state.settings, profileId, modelId);
      const normalized = nextModelId.trim();
      if (!normalized) {
        throw new V12SettingsError("INVALID_MODEL", "模型 ID 不能为空。");
      }
      if (
        normalized !== modelId &&
        profile.models.some(({ id }) => id === normalized)
      ) {
        throw new V12SettingsError(
          "DUPLICATE_MODEL_NAME",
          "模型 ID 已存在，请换一个。",
        );
      }
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId
          ? {
              ...candidate,
              models: candidate.models.map((model) =>
                model.id === modelId ? { ...model, id: normalized } : model,
              ),
            }
          : candidate,
      );
      resetModelImageCapability(settings, profileId, modelId);
      await persist(settings);
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },
    async createProviderProfile(input: {
      readonly baseUrl: string;
      readonly name?: string;
      readonly protocol?: V13ProfileProtocol | "openai" | "openai-compatible";
    }) {
      if (
        input.protocol !== undefined &&
        !(
          input.protocol === "openai-chat" ||
          input.protocol === "openai-responses" ||
          input.protocol === "ollama-chat" ||
          input.protocol === "openai" ||
          input.protocol === "openai-compatible"
        )
      ) {
        throw new V12SettingsError(
          "INVALID_PROTOCOL",
          "不支持的 Provider 协议。",
        );
      }
      const origin = exactOriginPattern(input.baseUrl);
      const state = await read();
      const granted = await permissions.request({ origins: [origin] });
      const id = `profile-${globalThis.crypto.randomUUID()}`;
      const name =
        input.name === undefined
          ? nextProfileName(state.settings.profiles)
          : validateProfileName(state.settings.profiles, input.name);
      const profile: Omit<ProviderProfileProjection, "apiKey"> = {
        baseUrl: input.baseUrl,
        hostPermission: granted ? "granted" : "missing",
        id,
        models: [],
        name,
        protocol: normalizeProtocol(input.protocol ?? "openai-compatible"),
      };
      const settings = cloneSettings(state.settings);
      settings.profiles = [...settings.profiles, profile];
      await persist(settings);
      return projectProfile(profile, state.secrets);
    },

    async deleteProviderApiKey(profileId: string) {
      const state = await read();
      requireProfile(state.settings, profileId);
      const affectedTasks = (["chat", "segments", "summary"] as const).filter(
        (kind) => state.settings.taskSelections[kind]?.profileId === profileId,
      );
      const secrets = cloneSecrets(state.secrets);
      const providerApiKeys = { ...secrets.providerApiKeys };
      delete providerApiKeys[profileId];
      secrets.providerApiKeys = providerApiKeys;
      secrets.removedProviderKeyIds = Array.from(
        new Set([...secrets.removedProviderKeyIds, profileId]),
      );
      const settings = cloneSettings(state.settings);
      resetProfileImageCapabilities(settings, profileId);
      await persist(settings, secrets);
      return { affectedTasks };
    },

    async deleteProviderProfile(profileId: string) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.filter(
        ({ id }) => id !== profileId,
      );
      resetProfileImageCapabilities(settings, profileId);
      const secrets = cloneSecrets(state.secrets);
      const providerApiKeys = { ...secrets.providerApiKeys };
      delete providerApiKeys[profileId];
      secrets.providerApiKeys = providerApiKeys;
      await persist(settings, secrets);
      const stillUsed = settings.profiles.some(
        (candidate) =>
          new URL(candidate.baseUrl).origin === new URL(profile.baseUrl).origin,
      );
      if (!stillUsed && profile.hostPermission === "granted") {
        try {
          await permissions.remove({
            origins: [exactOriginPattern(profile.baseUrl)],
          });
        } catch {
          // 权限撤销是尽力而为的清理：删除本身已持久化，撤销失败不能把
          // 成功删除报成操作失败，否则界面会显示错误而配置实际已删除。
        }
      }
    },

    async discoverProfileModels(profileId: string) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      const response = await testConnection(
        profile,
        state.secrets.providerApiKeys[profileId],
      );
      const payload = (await response.json()) as unknown;
      const ids =
        isRecord(payload) && Array.isArray(payload.data)
          ? payload.data.flatMap((candidate) =>
              isRecord(candidate) && typeof candidate.id === "string"
                ? [candidate.id]
                : [],
            )
          : [];
      // 顺延追加语义：已有模型保持原位置与启用状态（探测确认后标记已验证），
      // 新发现的模型追加到列表末尾，与已有 ID 重名则跳过。
      const previousIds = new Set(profile.models.map((model) => model.id));
      const merged = profile.models.map((model) =>
        ids.includes(model.id)
          ? { ...model, verification: "verified" as const }
          : model,
      );
      for (const id of ids) {
        if (!previousIds.has(id)) {
          merged.push({
            enabled: true,
            id,
            source: "discovered" as const,
            verification: "verified" as const,
          });
        }
      }
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId
          ? { ...candidate, models: merged }
          : candidate,
      );
      resetProfileImageCapabilities(settings, profileId);
      await persist(settings);
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },
    /**
     * 检测可用性：当前 Base URL 已有权限则直接确认；没有则请求精确主机权限，
     * 拒绝时明确报错且不保存任何改动。
     */
    async ensureProfileHostPermission(profileId: string) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      if (profile.hostPermission === "granted") {
        return projectProfile(profile, state.secrets);
      }
      const granted = await permissions.request({
        origins: [exactOriginPattern(profile.baseUrl)],
      });
      if (!granted) {
        throw new V12SettingsError(
          "HOST_PERMISSION_DENIED",
          "主机权限请求被拒绝，无法检测该 Provider 的可用性。",
        );
      }
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId
          ? { ...candidate, hostPermission: "granted" as const }
          : candidate,
      );
      await persist(settings);
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },

    async loadImageCapability(input: {
      readonly modelId: string;
      readonly profileId: string;
    }): Promise<ImageCapabilityProjection> {
      const state = await read();
      requireProfileModel(state.settings, input.profileId, input.modelId);
      return projectImageCapability(
        state.settings,
        input.profileId,
        input.modelId,
      );
    },

    async loadProviderProfiles() {
      const state = await read();
      return state.settings.profiles.map((profile) =>
        projectProfile(profile, state.secrets),
      );
    },

    async loadTaskSelections() {
      const state = await read();
      return {
        chat: projectSelection("chat", state.settings, state.secrets),
        segments: projectSelection("segments", state.settings, state.secrets),
        summary: projectSelection("summary", state.settings, state.secrets),
      };
    },

    async loadModelReasoningOverrides() {
      const state = await read();
      return state.settings.modelReasoningOverrides;
    },

    async loadModelReasoningOverride(profileId: string, modelId: string) {
      const state = await read();
      requireProfileModel(state.settings, profileId, modelId);
      return (
        state.settings.modelReasoningOverrides[
          modelReasoningOverrideKey(profileId, modelId)
        ] ?? null
      );
    },

    async saveModelReasoningOverride(
      profileId: string,
      modelId: string,
      override: ModelReasoningOverride,
    ) {
      const state = await read();
      requireProfileModel(state.settings, profileId, modelId);
      const key = modelReasoningOverrideKey(profileId, modelId);
      const settings = cloneSettings(state.settings);
      settings.modelReasoningOverrides = {
        ...settings.modelReasoningOverrides,
        [key]: {
          effort: override.effort,
          enabled: override.enabled,
        },
      };
      await persist(settings);
      return settings.modelReasoningOverrides[key];
    },

    async removeModelReasoningOverride(profileId: string, modelId: string) {
      const state = await read();
      requireProfileModel(state.settings, profileId, modelId);
      const key = modelReasoningOverrideKey(profileId, modelId);
      if (!(key in state.settings.modelReasoningOverrides)) return;
      const settings = cloneSettings(state.settings);
      const next = { ...settings.modelReasoningOverrides };
      delete next[key];
      settings.modelReasoningOverrides = next;
      await persist(settings);
    },

    async loadCustomReasoningEfforts() {
      const state = await read();
      return state.settings.customReasoningEfforts;
    },

    async saveCustomReasoningEfforts(efforts: readonly string[]) {
      const state = await read();
      const normalized = normalizeCustomReasoningEfforts(efforts);
      const settings = cloneSettings(state.settings);
      settings.customReasoningEfforts = normalized;
      await persist(settings);
      return normalized;
    },

    async loadGroqApiKeyProjection() {
      const state = await read();
      return apiKeyProjection(state.secrets.groqApiKey ?? undefined);
    },

    /**
     * This is the only explicit UI reveal path. Normal profile projections
     * never contain the credential value.
     */
    async revealProviderApiKey(profileId: string): Promise<string> {
      const state = await read();
      requireProfile(state.settings, profileId);
      const apiKey = state.secrets.providerApiKeys[profileId];
      if (apiKey === undefined) {
        throw new V12SettingsError(
          "API_KEY_NOT_CONFIGURED",
          "该语言模型配置尚未保存 API Key。",
        );
      }
      return apiKey;
    },

    /**
     * Groq 语音密钥的唯一 UI 明文读取路径:仅在用户主动点击眼睛按钮时
     * 由设置抽屉调用;正常投影(groqKeyProjection)从不包含明文。
     * 未配置时返回 null,调用方据此降级为普通 toggle。
     */
    async revealGroqApiKey(): Promise<string | null> {
      const state = await read();
      return state.secrets.groqApiKey;
    },

    async saveV12GroqApiKey(apiKey: string | null) {
      const normalized = apiKey?.trim() || null;
      const state = await read();
      const settings = cloneSettings(state.settings);
      settings.speech = { groqApiKeyConfigured: normalized !== null };
      const secrets = cloneSecrets(state.secrets);
      secrets.groqApiKey = normalized;
      await persist(settings, secrets);
      return apiKeyProjection(normalized ?? undefined);
    },

    /**
     * Resolves the exact task-owned profile at the infrastructure boundary.
     * The caller must supply the model identity already frozen into the
     * generation request; any stale/mismatched selection fails closed rather
     * than falling back to another profile or model.
     */
    async createTaskProviderGateway(
      kind: V12TaskKind,
      expected: {
        readonly modelId: string;
        readonly reasoningEffort: AiReasoningPreference;
      },
      gatewayDependencies: Omit<
        AiProviderGatewayDependencies,
        "apiKey" | "baseUrl" | "protocol" | "providerId"
      >,
    ): Promise<AiProviderGateway> {
      const state = await read();
      const selection = projectSelection(kind, state.settings, state.secrets);
      if (selection === null || selection.state !== "ready") {
        throw new V12SettingsError(
          "TASK_NOT_CONFIGURED",
          "当前任务没有可用的语言模型配置。",
        );
      }
      if (selection.modelId !== expected.modelId) {
        throw new V12SettingsError(
          "TASK_CONFIGURATION_STALE",
          "任务模型配置已变化，请重新发起生成。",
        );
      }
      const expectedReasoning =
        selection.reasoningEffort === "provider-default"
          ? "auto"
          : selection.reasoningEffort;
      if (expectedReasoning !== expected.reasoningEffort) {
        throw new V12SettingsError(
          "TASK_CONFIGURATION_STALE",
          "任务推理强度已变化，请重新发起生成。",
        );
      }
      const profile = requireProfile(state.settings, selection.profileId);
      const apiKey = state.secrets.providerApiKeys[profile.id];
      if (apiKey === undefined) {
        throw new AiProviderError(
          "AUTHENTICATION_REQUIRED",
          "An AI provider key has not been configured",
          false,
        );
      }
      return createAiProviderGateway({
        ...gatewayDependencies,
        apiKey,
        baseUrl: profile.baseUrl,
        protocol:
          profile.protocol === "openai-responses"
            ? "openai-responses"
            : "openai",
        // ollama-chat 端点类型：wire 仍走 OpenAI 兼容端点，
        // providerId 用 "ollama" 供家族注册表识别（档位 high/medium/low/max/none）。
        providerId: profile.protocol === "ollama-chat" ? "ollama" : profile.id,
      });
    },

    async recordTaskProviderFailure(kind: V12TaskKind, code: string) {
      void code;
      const state = await read();
      const selection = projectSelection(kind, state.settings, state.secrets);
      if (selection === null) {
        throw new V12SettingsError("TASK_NOT_CONFIGURED", "任务尚未配置模型。");
      }
      return selection;
    },

    async reorderProfileModels(profileId: string, modelIds: readonly string[]) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      const models = uniqueOrder(profile.models, modelIds);
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId ? { ...candidate, models } : candidate,
      );
      await persist(settings);
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },

    async reorderProviderProfiles(profileIds: readonly string[]) {
      const state = await read();
      const settings = cloneSettings(state.settings);
      settings.profiles = uniqueOrder(settings.profiles, profileIds);
      await persist(settings);
      return settings.profiles.map((profile) =>
        projectProfile(profile, state.secrets),
      );
    },
    /**
     * 排序操作基于最新持久化状态执行：调用方快照过期时仍按存储中的真实
     * 列表定位并移动，避免「创建后立即排序」命中过期快照报错。
     */
    async moveProviderProfile(profileId: string, toIndex: number) {
      const state = await read();
      requireProfile(state.settings, profileId);
      const ids = state.settings.profiles.map(({ id }) => id);
      const fromIndex = ids.indexOf(profileId);
      ids.splice(fromIndex, 1);
      ids.splice(Math.min(Math.max(0, toIndex), ids.length), 0, profileId);
      const settings = cloneSettings(state.settings);
      settings.profiles = uniqueOrder(settings.profiles, ids);
      await persist(settings);
      return settings.profiles.map((profile) =>
        projectProfile(profile, state.secrets),
      );
    },
    /** 同上：模型排序按最新持久化模型列表移动单个模型。 */
    async moveProfileModel(
      profileId: string,
      modelId: string,
      toIndex: number,
    ) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      requireProfileModel(state.settings, profileId, modelId);
      const ids = profile.models.map(({ id }) => id);
      const fromIndex = ids.indexOf(modelId);
      ids.splice(fromIndex, 1);
      ids.splice(Math.min(Math.max(0, toIndex), ids.length), 0, modelId);
      const models = uniqueOrder(profile.models, ids);
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId ? { ...candidate, models } : candidate,
      );
      await persist(settings);
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },

    async replaceProviderApiKey(input: {
      readonly apiKey: string;
      readonly profileId: string;
      readonly testBeforeSave: boolean;
    }) {
      const state = await read();
      const profile = requireProfile(state.settings, input.profileId);
      if (input.testBeforeSave) {
        // Prove that the configured route still resolves, then prove the new
        // credential. Neither request mutates local key ownership.
        await testConnection(
          profile,
          state.secrets.providerApiKeys[input.profileId],
        );
        await testConnection(profile, input.apiKey);
      }
      const secrets = cloneSecrets(state.secrets);
      secrets.providerApiKeys = {
        ...secrets.providerApiKeys,
        [input.profileId]: input.apiKey,
      };
      secrets.removedProviderKeyIds = secrets.removedProviderKeyIds.filter(
        (id) => id !== input.profileId,
      );
      const settings = cloneSettings(state.settings);
      resetProfileImageCapabilities(settings, input.profileId);
      await persist(settings, secrets);
      return projectProfile(profile, secrets);
    },

    async recordImageCapabilityEvidence(input: {
      readonly evidence: ImageCapabilityEvidence;
      readonly modelId: string;
      readonly profileId: string;
    }): Promise<ImageCapabilityProjection> {
      const state = await read();
      requireProfileModel(state.settings, input.profileId, input.modelId);
      const current = projectImageCapability(
        state.settings,
        input.profileId,
        input.modelId,
      );
      const evidence = input.evidence;
      let nextState = current.state;
      if (evidence.outcome === "success") {
        nextState = "supported";
      } else {
        if (
          !(AI_PROVIDER_ERROR_CODES as readonly string[]).includes(
            evidence.code,
          ) ||
          (evidence.classification !== undefined &&
            evidence.classification !== "image-input" &&
            evidence.classification !== "multimodal-content")
        ) {
          throw new V12SettingsError(
            "INVALID_IMAGE_CAPABILITY_EVIDENCE",
            "图片能力证据无效。",
          );
        }
        if (
          evidence.code === "UNSUPPORTED_CAPABILITY" &&
          (evidence.classification === "image-input" ||
            evidence.classification === "multimodal-content")
        ) {
          nextState = "unsupported";
        }
      }
      if (nextState === current.state) return current;
      const settings = cloneSettings(state.settings);
      const projection: ImageCapabilityProjection = {
        modelId: input.modelId,
        profileId: input.profileId,
        state: nextState,
      };
      setImageCapability(settings, projection);
      await persist(settings);
      return projection;
    },

    async saveProviderApiKey(profileId: string, apiKey: string) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      const secrets = cloneSecrets(state.secrets);
      secrets.providerApiKeys = {
        ...secrets.providerApiKeys,
        [profileId]: apiKey,
      };
      secrets.removedProviderKeyIds = secrets.removedProviderKeyIds.filter(
        (id) => id !== profileId,
      );
      const settings = cloneSettings(state.settings);
      resetProfileImageCapabilities(settings, profileId);
      await persist(settings, secrets);
      return projectProfile(profile, secrets);
    },

    async saveTaskSelection(
      kind: V12TaskKind,
      selection: Omit<TaskSelectionProjection, "state">,
    ) {
      const state = await read();
      const profile = requireProfile(state.settings, selection.profileId);
      if (!profile.models.some(({ id }) => id === selection.modelId)) {
        throw new V12SettingsError("MODEL_NOT_FOUND", "模型不存在。");
      }
      const settings = cloneSettings(state.settings);
      settings.taskSelections = {
        ...settings.taskSelections,
        [kind]: {
          modelId: selection.modelId,
          profileId: selection.profileId,
          reasoningEffort: selection.reasoningEffort,
        },
      };
      await persist(settings);
      return {
        chat: projectSelection("chat", settings, state.secrets),
        segments: projectSelection("segments", settings, state.secrets),
        summary: projectSelection("summary", settings, state.secrets),
      };
    },

    async setProfileModelEnabled(
      profileId: string,
      modelId: string,
      enabled: boolean,
    ) {
      const state = await read();
      requireProfileModel(state.settings, profileId, modelId);
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId
          ? {
              ...candidate,
              models: candidate.models.map((model) =>
                model.id === modelId ? { ...model, enabled } : model,
              ),
            }
          : candidate,
      );
      resetModelImageCapability(settings, profileId, modelId);
      await persist(settings);
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },

    async resetImageCapability(input: {
      readonly modelId: string;
      readonly profileId: string;
      readonly reason: "manual-retry" | "reprobe";
    }): Promise<ImageCapabilityProjection> {
      if (input.reason !== "manual-retry" && input.reason !== "reprobe") {
        throw new V12SettingsError(
          "INVALID_IMAGE_CAPABILITY_RESET",
          "图片能力复位原因无效。",
        );
      }
      const state = await read();
      requireProfileModel(state.settings, input.profileId, input.modelId);
      const settings = cloneSettings(state.settings);
      resetModelImageCapability(settings, input.profileId, input.modelId);
      await persist(settings);
      return projectImageCapability(settings, input.profileId, input.modelId);
    },

    async updateProviderProfile(
      profileId: string,
      input: {
        readonly baseUrl: string;
        readonly name?: string;
        readonly protocol?: V13ProfileProtocol;
      },
    ) {
      const state = await read();
      const profile = requireProfile(state.settings, profileId);
      const nextName =
        input.name === undefined
          ? profile.name
          : validateProfileName(state.settings.profiles, input.name, {
              exceptProfileId: profileId,
            });
      const nextPattern = exactOriginPattern(input.baseUrl);
      const previousPattern = exactOriginPattern(profile.baseUrl);
      const requested = await permissions.request({ origins: [nextPattern] });
      // Re-check through the same narrowly scoped adapter before committing.
      // In Chrome an already granted origin resolves without a second prompt;
      // an adapter that observes a revocation between request and commit keeps
      // the previous URL intact.
      const stillGranted =
        requested && (await permissions.request({ origins: [nextPattern] }));
      if (!stillGranted) {
        throw new V12SettingsError(
          "HOST_PERMISSION_DENIED",
          "新的 Provider 主机权限被拒绝。",
        );
      }
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId
          ? {
              ...candidate,
              baseUrl: input.baseUrl,
              hostPermission: "granted",
              name: nextName,
              ...(input.protocol === undefined
                ? {}
                : { protocol: input.protocol }),
            }
          : candidate,
      );
      resetProfileImageCapabilities(settings, profileId);
      await persist(settings);
      if (
        previousPattern !== nextPattern &&
        !settings.profiles.some(
          (candidate) =>
            candidate.id !== profileId &&
            exactOriginPattern(candidate.baseUrl) === previousPattern,
        )
      ) {
        try {
          await permissions.remove({ origins: [previousPattern] });
        } catch {
          // 旧来源权限撤销是尽力而为的清理：更新本身已持久化，
          // 撤销失败不能把成功更新报成操作失败。
        }
      }
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },
    async deleteProfileModel(profileId: string, modelId: string) {
      const state = await read();
      requireProfileModel(state.settings, profileId, modelId);
      const settings = cloneSettings(state.settings);
      settings.profiles = settings.profiles.map((candidate) =>
        candidate.id === profileId
          ? {
              ...candidate,
              models: candidate.models.filter(({ id }) => id !== modelId),
            }
          : candidate,
      );
      resetModelImageCapability(settings, profileId, modelId);
      await persist(settings);
      return projectProfile(requireProfile(settings, profileId), state.secrets);
    },
  };
}

export type ProviderProfileSettingsStore = ReturnType<
  typeof createProviderProfileSettingsStore
>;

export interface LegacyMigrationKeys {
  readonly promptPresets: string;
  readonly secrets: string;
  readonly settings: string;
  readonly taskModels: string;
  readonly uiPreferences: string;
}

/** v12 存储快照（迁移函数的输入/备份形态）。 */
interface LegacyV12Snapshot {
  readonly archivedSegmentPrompts: readonly unknown[];
  readonly imageCapabilities: readonly unknown[];
  readonly profiles: readonly unknown[];
  readonly promptPresets: readonly unknown[];
  readonly speech: { readonly groqApiKeyConfigured: boolean };
  readonly taskSelections: Readonly<
    Record<
      V12TaskKind,
      {
        readonly modelId: string;
        readonly profileId: string;
        readonly reasoningEffort: string;
      } | null
    >
  >;
  readonly version: 12;
}

interface LegacyV12Secrets {
  readonly groqApiKey: string | null;
  readonly providerApiKeys: Readonly<Record<string, string>>;
  readonly removedProviderKeyIds: readonly string[];
  readonly version: 12;
}

/**
 * v12 → v13 无感迁移：复制 v12 数据到 v13 key，升级语义
 * （provider-default→auto、openai-compatible/openai→openai-chat、
 * 新增 modelReasoningOverrides/customReasoningEfforts 空默认）。
 * v12 原数据保留作备份；幂等（v13 已存在则原样返回）。
 */
export async function migrateV12SettingsToV13(
  storage: ChromeWorkspaceStorageArea,
): Promise<{
  readonly settings: StoredV13Settings;
  readonly secrets: StoredV13Secrets;
  readonly migrated: boolean;
}> {
  const [v13Result, v12Result, v12SecretResult] = await Promise.all([
    storage.get(V13_SETTINGS_STORAGE_KEY),
    storage.get(V12_SETTINGS_STORAGE_KEY),
    storage.get(V12_SETTINGS_SECRET_STORAGE_KEY),
  ]);
  const existing = v13Result[V13_SETTINGS_STORAGE_KEY];
  if (isRecord(existing) && existing.version === 13) {
    const secretResult = await storage.get(V13_SETTINGS_SECRET_STORAGE_KEY);
    return {
      migrated: false,
      secrets: asSecrets(secretResult[V13_SETTINGS_SECRET_STORAGE_KEY]),
      settings: asSettings(existing),
    };
  }
  const v12Settings = v12Result[V12_SETTINGS_STORAGE_KEY];
  if (!isRecord(v12Settings) || v12Settings.version !== 12) {
    return {
      migrated: false,
      secrets: emptySecrets(),
      settings: emptySettings(),
    };
  }
  const migratedSettings: StoredV13Settings = {
    ...(isRecord(v12Settings.appearance)
      ? { appearance: v12Settings.appearance }
      : {}),
    archivedSegmentPrompts: Array.isArray(v12Settings.archivedSegmentPrompts)
      ? v12Settings.archivedSegmentPrompts
      : [],
    customReasoningEfforts: [],
    imageCapabilities: readImageCapabilities(v12Settings.imageCapabilities),
    modelReasoningOverrides: {},
    profiles: normalizeProfiles(v12Settings.profiles),
    promptPresets: Array.isArray(v12Settings.promptPresets)
      ? v12Settings.promptPresets
      : [],
    speech: {
      groqApiKeyConfigured:
        isRecord(v12Settings.speech) &&
        v12Settings.speech.groqApiKeyConfigured === true,
    },
    taskSelections: normalizeTaskSelections(v12Settings.taskSelections),
    version: 13,
  };
  const migratedSecrets: StoredV13Secrets = asSecrets(
    v12SecretResult[V12_SETTINGS_SECRET_STORAGE_KEY],
  );
  await storage.set({
    [V13_SETTINGS_SECRET_STORAGE_KEY]: migratedSecrets,
    [V13_SETTINGS_STORAGE_KEY]: migratedSettings,
  });
  return {
    migrated: true,
    secrets: migratedSecrets,
    settings: migratedSettings,
  };
}
export async function migrateLegacySettingsToV12(
  storage: ChromeWorkspaceStorageArea,
  keys: LegacyMigrationKeys,
) {
  const existingResult = await storage.get(V12_SETTINGS_STORAGE_KEY);
  const existing = existingResult[V12_SETTINGS_STORAGE_KEY];
  if (isRecord(existing) && existing.version === 12) {
    return {
      snapshot: existing,
      summary: {
        archivedSegmentPromptCount: Array.isArray(
          existing.archivedSegmentPrompts,
        )
          ? existing.archivedSegmentPrompts.length
          : 0,
        createdProfileCount: 0,
        keyStatus: "provider-and-groq-preserved" as const,
        migratedPromptCount: Array.isArray(existing.promptPresets)
          ? existing.promptPresets.length
          : 0,
        preservedModelCount:
          Array.isArray(existing.profiles) &&
          isRecord(existing.profiles[0]) &&
          Array.isArray(existing.profiles[0].models)
            ? existing.profiles[0].models.length
            : 0,
      },
    };
  }

  const values = Object.fromEntries(
    await Promise.all(
      Object.values(keys).map(async (key) => [
        key,
        (await storage.get(key))[key],
      ]),
    ),
  );
  const legacySettings = isRecord(values[keys.settings])
    ? values[keys.settings]
    : {};
  const legacyProvider = isRecord(legacySettings.provider)
    ? legacySettings.provider
    : {};
  const legacySecrets = isRecord(values[keys.secrets])
    ? values[keys.secrets]
    : {};
  const legacyTaskModels = isRecord(values[keys.taskModels])
    ? values[keys.taskModels]
    : {};
  const legacyPrompts = isRecord(values[keys.promptPresets])
    ? values[keys.promptPresets]
    : {};
  const providerId =
    typeof legacyProvider.providerId === "string"
      ? legacyProvider.providerId
      : "legacy-provider";
  const profileId = `legacy-${providerId}`;
  const taskModelIds = (["chat", "segments", "summary"] as const).map(
    (kind) => {
      const selection = isRecord(legacyTaskModels[kind])
        ? legacyTaskModels[kind]
        : kind === "chat" && isRecord(legacyProvider.selectedModel)
          ? legacyProvider.selectedModel
          : {};
      return typeof selection.modelId === "string"
        ? selection.modelId
        : `${kind}-model`;
    },
  );
  const uniqueModels = Array.from(new Set(taskModelIds));
  const rawPresets: Record<string, unknown>[] = Array.isArray(
    legacyPrompts.presets,
  )
    ? legacyPrompts.presets.filter(
        (candidate: unknown): candidate is Record<string, unknown> =>
          isRecord(candidate),
      )
    : [];
  const promptPresets = rawPresets
    .filter((preset) => preset.kind === "chat" || preset.kind === "summary")
    .map((preset, index) => ({
      content: typeof preset.content === "string" ? preset.content : "",
      id:
        typeof preset.id === "string"
          ? preset.id
          : `legacy-prompt-${index + 1}`,
      kind: preset.kind as "chat" | "summary",
      name:
        preset.builtIn === false && preset.name === "Bilimuzhi默认"
          ? `自定义${preset.kind === "chat" ? "对话" : "总结"}提示词${index + 1}`
          : typeof preset.name === "string"
            ? preset.name
            : `提示词${index + 1}`,
    }));
  const archivedSegmentPrompts = rawPresets
    .filter((preset) => preset.kind === "segments")
    .map((preset) => ({
      content: typeof preset.content === "string" ? preset.content : "",
      name: typeof preset.name === "string" ? preset.name : "分段提示词",
      readOnly: true as const,
    }));
  const providerApiKeys = isRecord(legacySecrets.providerApiKeys)
    ? (legacySecrets.providerApiKeys as Record<string, string>)
    : {};
  const groqApiKey =
    typeof legacySecrets.groqApiKey === "string"
      ? legacySecrets.groqApiKey
      : null;
  const profile = {
    apiKeyConfigured: providerApiKeys[providerId] !== undefined,
    baseUrl:
      typeof legacyProvider.baseUrl === "string"
        ? legacyProvider.baseUrl
        : "https://api.openai.com/v1",
    hostPermission: "granted" as const,
    id: profileId,
    models: uniqueModels.map((id, index) => ({
      id,
      source: index === 0 ? ("discovered" as const) : ("manual" as const),
      verification:
        index === 0 ? ("verified" as const) : ("unverified" as const),
    })),
    name: "AI 配置",
    protocol: "openai-compatible" as const,
  };
  const snapshot: LegacyV12Snapshot = {
    ...(isRecord(legacySettings.appearance)
      ? { appearance: legacySettings.appearance }
      : {}),
    archivedSegmentPrompts,
    imageCapabilities: [],
    profiles: [profile as unknown as Omit<ProviderProfileProjection, "apiKey">],
    promptPresets,
    speech: { groqApiKeyConfigured: groqApiKey !== null },
    taskSelections: {
      chat: {
        modelId: taskModelIds[0],
        profileId,
        reasoningEffort: "provider-default",
      },
      segments: {
        modelId: taskModelIds[1],
        profileId,
        reasoningEffort: "provider-default",
      },
      summary: {
        modelId: taskModelIds[2],
        profileId,
        reasoningEffort: "provider-default",
      },
    },
    version: 12,
  };
  const secrets: LegacyV12Secrets = {
    groqApiKey,
    providerApiKeys:
      providerApiKeys[providerId] === undefined
        ? {}
        : { [profileId]: providerApiKeys[providerId] },
    removedProviderKeyIds: [],
    version: 12,
  };
  try {
    await storage.set({
      [V12_SETTINGS_SECRET_STORAGE_KEY]: secrets,
      [V12_SETTINGS_STORAGE_KEY]: snapshot,
    });
  } catch {
    throw new V12SettingsError(
      "SETTINGS_MIGRATION_FAILED",
      "设置更新失败，数据未更改。",
    );
  }
  return {
    snapshot,
    summary: {
      archivedSegmentPromptCount: archivedSegmentPrompts.length,
      createdProfileCount: 1,
      keyStatus: "provider-and-groq-preserved" as const,
      migratedPromptCount: promptPresets.length,
      preservedModelCount: uniqueModels.length,
    },
  };
}
