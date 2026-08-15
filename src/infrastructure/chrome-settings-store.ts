import type {
  AiModelDescriptor,
  AiReasoningEffort,
} from "../application/ai/provider-contract";
import { isCustomReasoningEffort } from "../application/ai/provider-contract";
import type { OutputLanguagePreference, UiLanguage } from "../i18n/languages";
import { AiProviderError } from "../application/ai/provider-error";
export { createV12BackupRuntime } from "../application/backup";
import type { SettingsRepository } from "../application/settings-repository";
import {
  MUZHI_SETTINGS_VERSION,
  createBilimuzhiSettings,
  type AiModelSelection,
  type AiProviderProtocol,
  type BilimuzhiSettings,
  type SettingsTheme,
} from "../application/settings-contract";
import { StorageError } from "../application/storage";
import {
  createTrashRetentionPolicy,
  type TrashRetentionApplyMode,
  type TrashRetentionPolicy,
} from "../domain";
import {
  createAiProviderGatewayFromSettings,
  type AiProviderConnection,
  type AiProviderGatewayFromSettingsDependencies,
} from "./ai/provider-gateway";
import type { AiProviderGateway } from "../application/ai/provider-contract";
import type {
  GroqRoutingMode,
  GroqWhisperProvider,
} from "../application/asr-contract";
import type { ChromeWorkspaceStorageArea } from "./chrome-workspace-state-store";
import {
  GroqWhisperError,
  createGroqWhisperProvider,
  type GroqWhisperProviderDependencies,
} from "./asr/groq-provider";
import {
  V12_SETTINGS_SECRET_STORAGE_KEY,
  V13_SETTINGS_SECRET_STORAGE_KEY,
  createProviderProfileSettingsStore,
  migrateLegacySettingsToV12,
  type ProviderProfileSettingsStore,
  type V12HostPermissions,
} from "./provider-profile-settings";

export const SETTINGS_STORAGE_KEY = "muzhi.settings.v1";
export const SETTINGS_SECRET_STORAGE_KEY = "muzhi.settings.secret.v1";
export const SETTINGS_UI_PREFERENCES_STORAGE_KEY =
  "muzhi.settings.ui-preferences.v1";
export const SETTINGS_TASK_MODELS_STORAGE_KEY = "muzhi.settings.task-models.v1";
export const SETTINGS_PROMPT_PRESETS_STORAGE_KEY =
  "muzhi.settings.prompt-presets.v1";
export const APPEARANCE_STORAGE_KEY = "muzhi.appearance.v1";
const SETTINGS_SECRET_VERSION = 2 as const;

export interface SettingsEditorState extends BilimuzhiSettings {
  readonly configuredProviderIds: readonly string[];
  readonly connection: AiProviderConnection;
  readonly speech: { readonly groqApiKeyConfigured: boolean };
}

export interface SettingsUiPreferences {
  readonly exportPreference: {
    readonly format: "markdown" | "srt" | "txt";
    readonly includeTimestamps: boolean;
  };
  readonly promptTemplate: string;
  readonly speechLanguage: "中文" | "英文" | "其他" | "混合";
  readonly speechRoutingMode: GroqRoutingMode;
  /** Per-mode user-owned prompt policies. Blank means "use the default". */
  readonly taskPrompts: Readonly<Record<BilimuzhiTaskKind, string>>;
  /** 界面语言（docs/i18n-spec.md §2）；读取失败回退 zh-Hans。 */
  readonly uiLanguage: "zh-Hans" | "zh-Hant" | "en" | "ja";
  /**
   * 各模式 AI 输出偏好（docs/i18n-spec.md §5）：对话/分段/总结独立，
   * 弱约束默认值；"auto" 表示不指定语言（不注入语言控制提示词）；
   * v5 及更早的全局 outputLanguage 在迁移时填充到三个模式。
   */
  readonly taskOutputLanguages: Readonly<
    Record<BilimuzhiTaskKind, OutputLanguagePreference>
  >;
  readonly version: 3 | 4 | 5 | 6 | 7;
}
export interface PromptPreset {
  readonly builtIn: boolean;
  readonly content: string;
  readonly id: string;
  readonly kind: BilimuzhiTaskKind;
  readonly name: string;
}

/**
 * State guaranteed to prompt mutation consumers that only manage the v14
 * chat and summary collections. The complete repository state below extends
 * this view and continues to require the legacy segments collection.
 */
export interface PromptPresetMutationState {
  readonly defaultPromptPresetIds: Readonly<
    Record<PromptPresetSelectableKind, string>
  >;
  readonly presets: readonly PromptPreset[];
  readonly selectedPromptPresetIds: Readonly<
    Record<PromptPresetSelectableKind, string>
  >;
  readonly version: number;
}

export interface PromptPresetState extends PromptPresetMutationState {
  readonly defaultPromptPresetIds: Readonly<Record<BilimuzhiTaskKind, string>>;
  readonly version: 1;
}

export type BilimuzhiTaskKind = "chat" | "segments" | "summary";
export type PromptPresetSelectableKind = "chat" | "summary";

export const MUZHI_TASK_KINDS: readonly BilimuzhiTaskKind[] = Object.freeze([
  "chat",
  "segments",
  "summary",
]);

/**
 * Per-task model overrides. `null` means "use the shared provider selection",
 * so an unconfigured segments or summary task keeps working after the user
 * only picks one model.
 */
export type BilimuzhiTaskModels = Readonly<
  Record<BilimuzhiTaskKind, AiModelSelection | null>
>;

export const EMPTY_TASK_MODELS: BilimuzhiTaskModels = Object.freeze({
  chat: null,
  segments: null,
  summary: null,
});

export interface ChromeSettingsStore
  extends SettingsRepository, ProviderProfileSettingsStore {
  createGroqWhisperProvider(
    dependencies: Omit<GroqWhisperProviderDependencies, "apiKey">,
  ): Promise<GroqWhisperProvider>;
  createProviderGateway(
    dependencies: Omit<
      AiProviderGatewayFromSettingsDependencies,
      "apiKey" | "settings"
    >,
  ): Promise<AiProviderGateway>;
  loadEditorState(): Promise<SettingsEditorState>;
  loadTaskModels(): Promise<BilimuzhiTaskModels>;
  loadUiPreferences(): Promise<SettingsUiPreferences>;
  loadPromptPresets(): Promise<PromptPresetState>;
  createPromptPreset(input: {
    readonly content?: string;
    readonly kind: BilimuzhiTaskKind;
    readonly name: string;
  }): Promise<PromptPresetState>;
  updatePromptPreset(
    presetId: string,
    input: { readonly content: string; readonly name: string },
  ): Promise<PromptPresetState>;
  deletePromptPreset(presetId: string): Promise<PromptPresetState>;
  reorderPromptPresets(
    kind: BilimuzhiTaskKind,
    orderedPresetIds: readonly string[],
  ): Promise<PromptPresetMutationState>;
  selectPromptPreset(
    kind: PromptPresetSelectableKind,
    presetId: string,
  ): Promise<PromptPresetMutationState>;
  selectDefaultPromptPreset(
    kind: BilimuzhiTaskKind,
    presetId: string,
  ): Promise<PromptPresetState>;
  importPromptPresets(input: {
    readonly data: string;
    readonly format: "json" | "text";
    readonly kind?: BilimuzhiTaskKind;
    readonly name?: string;
  }): Promise<PromptPresetState>;
  exportPromptPresets(format: "json" | "text"): Promise<string>;
  saveTaskModel(
    kind: BilimuzhiTaskKind,
    selection: AiModelSelection | null,
  ): Promise<BilimuzhiTaskModels>;
  saveApiKey(apiKey: string | null): Promise<BilimuzhiSettings>;
  saveGroqApiKey(apiKey: string | null): Promise<BilimuzhiSettings>;
  saveProviderConfiguration(
    input: AiProviderConnection,
  ): Promise<BilimuzhiSettings>;
  saveUiPreferences(
    input: SettingsUiPreferences,
  ): Promise<SettingsUiPreferences>;
  selectDiscoveredModel(
    descriptor: AiModelDescriptor,
    selection: AiModelSelection,
  ): Promise<BilimuzhiSettings>;
}

interface StoredSettingsRecord {
  readonly appearance: { readonly theme: SettingsTheme };
  readonly provider: AiProviderConnection & {
    readonly selectedModel: AiModelSelection | null;
  };
  readonly retention: {
    readonly applyMode: TrashRetentionApplyMode;
    readonly policy: TrashRetentionPolicy;
  };
  readonly version: typeof MUZHI_SETTINGS_VERSION;
}

interface StoredSecretRecord {
  readonly groqApiKey: string | null;
  readonly providerApiKeys: Readonly<Record<string, string>>;
  readonly version: typeof SETTINGS_SECRET_VERSION;
}

const DEFAULT_SETTINGS: StoredSettingsRecord = Object.freeze({
  appearance: Object.freeze({ theme: "system" }),
  provider: Object.freeze({
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai",
    providerId: "openai",
    selectedModel: null,
  }),
  retention: Object.freeze({
    applyMode: "future-only",
    policy: Object.freeze({ durationDays: 7, kind: "duration" }),
  }),
  version: MUZHI_SETTINGS_VERSION,
});

const EMPTY_SECRET: StoredSecretRecord = Object.freeze({
  groqApiKey: null,
  providerApiKeys: Object.freeze({}),
  version: SETTINGS_SECRET_VERSION,
});

const DEFAULT_UI_PREFERENCES: SettingsUiPreferences = Object.freeze({
  exportPreference: Object.freeze({
    format: "markdown",
    includeTimestamps: true,
  }),
  promptTemplate: "",
  speechLanguage: "混合",
  speechRoutingMode: "balanced",
  taskPrompts: Object.freeze({ chat: "", segments: "", summary: "" }),
  uiLanguage: "zh-Hans",
  taskOutputLanguages: Object.freeze({
    chat: "zh-Hans",
    segments: "zh-Hans",
    summary: "zh-Hans",
  }),
  version: 7,
});

const BUILT_IN_PROMPT_PRESETS: readonly PromptPreset[] = Object.freeze([
  Object.freeze({
    builtIn: true,
    content:
      "只根据当前字幕和可信应用上下文回答；没有字幕证据时明确说明，并在观点附近保留可验证时间标记。除非用户另有要求，默认使用中文输出。",
    id: "builtin-chat",
    kind: "chat",
    name: "Bilimuzhi默认",
  }),
  Object.freeze({
    builtIn: true,
    content:
      "按真实字幕行生成连续分段卡片，广告仅在证据和边界均明确时标记。除非用户另有要求，分段输出默认使用中文。",
    id: "builtin-segments",
    kind: "segments",
    name: "Bilimuzhi默认",
  }),
  Object.freeze({
    builtIn: true,
    content:
      "提炼字幕中最重要的结论、事实与必要背景，删除重复信息，保持简洁，并为每个关键观点附上准确、可验证的时间标记。除非用户另有要求，默认使用中文输出。",
    id: "builtin-summary-concise",
    kind: "summary",
    name: "简要",
  }),
  Object.freeze({
    builtIn: true,
    content:
      "按照内容推进顺序总结主要观点、关键事实、必要背景和论证关系，在信息完整性与阅读长度之间保持平衡，并在相关观点附近保留准确时间标记。除非用户另有要求，默认使用中文输出。",
    id: "builtin-summary-balanced",
    kind: "summary",
    name: "平衡",
  }),
  Object.freeze({
    builtIn: true,
    content:
      "按章节详细总结字幕中的事实、概念背景、论证过程、重要例证、反例与最终结论，保留内容之间的因果关系，并为关键内容附上准确时间标记。除非用户另有要求，默认使用中文输出。",
    id: "builtin-summary-detailed",
    kind: "summary",
    name: "详细",
  }),
]);

const BUILT_IN_PROMPT_IDS = Object.freeze({
  chat: "builtin-chat",
  segments: "builtin-segments",
  summary: "builtin-summary-balanced",
});

const DEFAULT_PROMPT_PRESET_STATE: PromptPresetState = Object.freeze({
  defaultPromptPresetIds: BUILT_IN_PROMPT_IDS,
  presets: BUILT_IN_PROMPT_PRESETS,
  selectedPromptPresetIds: Object.freeze({
    chat: BUILT_IN_PROMPT_IDS.chat,
    summary: BUILT_IN_PROMPT_IDS.summary,
  }),
  version: 1,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function isTheme(value: unknown): value is SettingsTheme {
  return value === "light" || value === "dark" || value === "system";
}

function isProtocol(value: unknown): value is AiProviderProtocol {
  return (
    value === "openai" ||
    value === "openai-chat" ||
    value === "openai-responses" ||
    value === "claude" ||
    value === "gemini"
  );
}

function isProviderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isBaseUrl(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 2_048 ||
    value !== value.trim()
  ) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" &&
          (url.hostname === "localhost" || url.hostname === "127.0.0.1")))
    );
  } catch {
    return false;
  }
}

function isApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    value === value.trim()
  );
}

function readUiPreferences(value: unknown): SettingsUiPreferences | null {
  if (
    isRecord(value) &&
    value.version === 1 &&
    hasExactKeys(value, [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "version",
    ])
  ) {
    return readUiPreferences({
      ...value,
      speechRoutingMode: "balanced",
      version: 2,
    });
  }
  if (
    isRecord(value) &&
    value.version === 2 &&
    hasExactKeys(value, [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "speechRoutingMode",
      "version",
    ])
  ) {
    return readUiPreferences({
      ...value,
      taskPrompts: { chat: "", segments: "", summary: "" },
      version: 3,
    });
  }
  if (
    isRecord(value) &&
    value.version === 3 &&
    hasExactKeys(value, [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "speechRoutingMode",
      "taskPrompts",
      "version",
    ])
  ) {
    const upgraded = readUiPreferences({
      ...value,
      summaryDetail: "balanced",
      version: 4,
    });
    if (upgraded === null) return null;
    return Object.freeze({
      exportPreference: upgraded.exportPreference,
      promptTemplate: upgraded.promptTemplate,
      speechLanguage: upgraded.speechLanguage,
      speechRoutingMode: upgraded.speechRoutingMode,
      taskPrompts: upgraded.taskPrompts,
      uiLanguage: "zh-Hans",
      taskOutputLanguages: Object.freeze({
        chat: "zh-Hans",
        segments: "zh-Hans",
        summary: "zh-Hans",
      }),
      version: 7,
    });
  }
  if (
    isRecord(value) &&
    value.version === 4 &&
    hasExactKeys(value, [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "speechRoutingMode",
      "summaryDetail",
      "taskPrompts",
      "version",
    ])
  ) {
    // v4 数据含 summaryDetail 键；显式构造 v7 对象以丢弃该键。
    return readUiPreferences({
      exportPreference: value.exportPreference,
      promptTemplate: value.promptTemplate,
      speechLanguage: value.speechLanguage,
      speechRoutingMode: value.speechRoutingMode,
      taskPrompts: value.taskPrompts,
      uiLanguage: "zh-Hans",
      taskOutputLanguages: Object.freeze({
        chat: "zh-Hans",
        segments: "zh-Hans",
        summary: "zh-Hans",
      }),
      version: 7,
    });
  }
  if (isRecord(value) && value.version === 5) {
    const exactKeys = Object.keys(value).sort().join(",");
    const withoutSummary = [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "speechRoutingMode",
      "taskPrompts",
      "uiLanguage",
      "outputLanguage",
      "version",
    ]
      .sort()
      .join(",");
    const withSummary = [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "speechRoutingMode",
      "summaryDetail",
      "taskPrompts",
      "uiLanguage",
      "outputLanguage",
      "version",
    ]
      .sort()
      .join(",");
    if (exactKeys !== withoutSummary && exactKeys !== withSummary) {
      return null;
    }
    const legacy = value.outputLanguage;
    if (
      legacy !== "zh-Hans" &&
      legacy !== "zh-Hant" &&
      legacy !== "en" &&
      legacy !== "ja"
    ) {
      return null;
    }
    // v5 -> v7：旧全局 outputLanguage 填充三个模式；summaryDetail 键丢弃。
    // 显式构造以移除 outputLanguage 键，满足 v7 的精确键校验。
    return readUiPreferences({
      exportPreference: value.exportPreference,
      promptTemplate: value.promptTemplate,
      speechLanguage: value.speechLanguage,
      speechRoutingMode: value.speechRoutingMode,
      taskPrompts: value.taskPrompts,
      taskOutputLanguages: Object.freeze({
        chat: legacy,
        segments: legacy,
        summary: legacy,
      }),
      uiLanguage: value.uiLanguage,
      version: 7,
    });
  }
  if (
    isRecord(value) &&
    value.version === 6 &&
    hasExactKeys(value, [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "speechRoutingMode",
      "taskPrompts",
      "uiLanguage",
      "taskOutputLanguages",
      "version",
    ])
  ) {
    // v6 无 summaryDetail 键：直接提升到 v7。
    return readUiPreferences({ ...value, version: 7 });
  }
  if (
    isRecord(value) &&
    value.version === 6 &&
    hasExactKeys(value, [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "speechRoutingMode",
      "summaryDetail",
      "taskPrompts",
      "uiLanguage",
      "taskOutputLanguages",
      "version",
    ])
  ) {
    // v6 含 summaryDetail 键：丢弃该键后提升到 v7。
    const rest = Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "summaryDetail"),
    );
    return readUiPreferences({ ...rest, version: 7 });
  }
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "exportPreference",
      "promptTemplate",
      "speechLanguage",
      "speechRoutingMode",
      "taskPrompts",
      "uiLanguage",
      "taskOutputLanguages",
      "version",
    ]) ||
    value.version !== 7 ||
    !isRecord(value.taskPrompts) ||
    !hasExactKeys(value.taskPrompts, ["chat", "segments", "summary"]) ||
    Object.values(value.taskPrompts).some(
      (prompt) => typeof prompt !== "string" || prompt.length > 32_768,
    ) ||
    !isRecord(value.exportPreference) ||
    !hasExactKeys(value.exportPreference, ["format", "includeTimestamps"]) ||
    (value.exportPreference.format !== "markdown" &&
      value.exportPreference.format !== "srt" &&
      value.exportPreference.format !== "txt") ||
    typeof value.exportPreference.includeTimestamps !== "boolean" ||
    typeof value.promptTemplate !== "string" ||
    value.promptTemplate.length > 32_768 ||
    (value.speechLanguage !== "中文" &&
      value.speechLanguage !== "英文" &&
      value.speechLanguage !== "其他" &&
      value.speechLanguage !== "混合") ||
    (value.speechRoutingMode !== "balanced" &&
      value.speechRoutingMode !== "turbo-first" &&
      value.speechRoutingMode !== "standard-first") ||
    (value.uiLanguage !== "zh-Hans" &&
      value.uiLanguage !== "zh-Hant" &&
      value.uiLanguage !== "en" &&
      value.uiLanguage !== "ja") ||
    !isRecord(value.taskOutputLanguages) ||
    !hasExactKeys(value.taskOutputLanguages, ["chat", "segments", "summary"]) ||
    Object.values(value.taskOutputLanguages).some(
      (language) =>
        language !== "zh-Hans" &&
        language !== "zh-Hant" &&
        language !== "en" &&
        language !== "ja" &&
        language !== "auto",
    )
  ) {
    return null;
  }
  return Object.freeze({
    exportPreference: Object.freeze({
      format: value.exportPreference.format,
      includeTimestamps: value.exportPreference.includeTimestamps,
    }),
    promptTemplate: value.promptTemplate,
    speechLanguage: value.speechLanguage,
    speechRoutingMode: value.speechRoutingMode,
    uiLanguage: value.uiLanguage,
    taskOutputLanguages: Object.freeze({
      chat: value.taskOutputLanguages.chat as UiLanguage,
      segments: value.taskOutputLanguages.segments as UiLanguage,
      summary: value.taskOutputLanguages.summary as UiLanguage,
    }),
    taskPrompts: Object.freeze({
      chat: (value.taskPrompts as Record<string, string>).chat,
      segments: (value.taskPrompts as Record<string, string>).segments,
      summary: (value.taskPrompts as Record<string, string>).summary,
    }),
    version: value.version,
  });
}

function isTaskKind(value: unknown): value is BilimuzhiTaskKind {
  return (
    typeof value === "string" &&
    (MUZHI_TASK_KINDS as readonly string[]).includes(value)
  );
}

function isPromptText(value: unknown): value is string {
  return typeof value === "string" && value.length <= 32_768;
}

function isPromptName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 128
  );
}

function isPresetId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function freezePromptPresetState(input: {
  readonly defaultPromptPresetIds: Readonly<Record<BilimuzhiTaskKind, string>>;
  readonly presets: readonly PromptPreset[];
  readonly selectedPromptPresetIds: Readonly<
    Record<PromptPresetSelectableKind, string>
  >;
}): PromptPresetState {
  return Object.freeze({
    defaultPromptPresetIds: Object.freeze({
      chat: input.defaultPromptPresetIds.chat,
      segments: input.defaultPromptPresetIds.segments,
      summary: input.defaultPromptPresetIds.summary,
    }),
    presets: Object.freeze(
      input.presets.map((preset) => Object.freeze({ ...preset })),
    ),
    selectedPromptPresetIds: Object.freeze({
      chat: input.selectedPromptPresetIds.chat,
      summary: input.selectedPromptPresetIds.summary,
    }),
    version: 1,
  });
}

function isSelectablePromptKind(
  value: unknown,
): value is PromptPresetSelectableKind {
  return value === "chat" || value === "summary";
}

function builtInPromptId(kind: BilimuzhiTaskKind): string {
  return BUILT_IN_PROMPT_IDS[kind];
}

function orderedPromptPresets(
  presets: readonly PromptPreset[],
  value: unknown,
): readonly PromptPreset[] | null {
  if (value === undefined) return presets;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["chat", "segments", "summary"])
  ) {
    return null;
  }
  const ordered: PromptPreset[] = [];
  for (const kind of MUZHI_TASK_KINDS) {
    const expected = presets.filter((preset) => preset.kind === kind);
    const candidateIds = value[kind];
    if (
      !Array.isArray(candidateIds) ||
      candidateIds.some((id) => !isPresetId(id))
    ) {
      return null;
    }
    const seen = new Set<string>();
    for (const id of candidateIds) {
      if (seen.has(id)) return null;
      const preset = expected.find((candidate) => candidate.id === id);
      if (!preset) continue;
      seen.add(id);
      ordered.push(preset);
    }
    ordered.push(...expected.filter(({ id }) => !seen.has(id)));
  }
  return ordered;
}

function readPromptPresetState(value: unknown): PromptPresetState | null {
  if (value === undefined) return DEFAULT_PROMPT_PRESET_STATE;
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.defaultPromptPresetIds) ||
    !hasExactKeys(value.defaultPromptPresetIds, [
      "chat",
      "segments",
      "summary",
    ]) ||
    !Array.isArray(value.presets)
  ) {
    return null;
  }
  const custom: PromptPreset[] = [];
  const seen = new Set(BUILT_IN_PROMPT_PRESETS.map((preset) => preset.id));
  for (const candidate of value.presets) {
    const candidateKeys = isRecord(candidate) ? Object.keys(candidate) : [];
    if (
      !isRecord(candidate) ||
      !(
        hasExactKeys(candidate, ["content", "id", "kind", "name"]) ||
        (hasExactKeys(candidate, [
          "builtIn",
          "content",
          "id",
          "kind",
          "name",
        ]) &&
          candidate.builtIn === false)
      ) ||
      candidateKeys.length < 4 ||
      !isPresetId(candidate.id) ||
      seen.has(candidate.id) ||
      !isTaskKind(candidate.kind) ||
      !isPromptName(candidate.name) ||
      !isPromptText(candidate.content)
    ) {
      return null;
    }
    seen.add(candidate.id);
    custom.push(
      Object.freeze({
        builtIn: false,
        content: candidate.content,
        id: candidate.id,
        kind: candidate.kind,
        name: candidate.name,
      }),
    );
  }
  const defaults = value.defaultPromptPresetIds as Record<string, unknown>;
  const normalizedDefaults: Record<BilimuzhiTaskKind, string> = {
    ...BUILT_IN_PROMPT_IDS,
  };
  for (const kind of MUZHI_TASK_KINDS) {
    const presetId =
      defaults[kind] === "builtin-summary"
        ? BUILT_IN_PROMPT_IDS.summary
        : defaults[kind];
    const preset = [...BUILT_IN_PROMPT_PRESETS, ...custom].find(
      (candidate) => candidate.id === presetId && candidate.kind === kind,
    );
    if (preset) normalizedDefaults[kind] = preset.id;
  }
  const available = [...BUILT_IN_PROMPT_PRESETS, ...custom];
  const ordered = orderedPromptPresets(available, value.presetOrder);
  if (!ordered) return null;
  const selected = isRecord(value.selectedPromptPresetIds)
    ? value.selectedPromptPresetIds
    : {};
  const selectedPromptPresetIds: Record<PromptPresetSelectableKind, string> = {
    chat: BUILT_IN_PROMPT_IDS.chat,
    summary: BUILT_IN_PROMPT_IDS.summary,
  };
  for (const kind of ["chat", "summary"] as const) {
    let presetId = selected[kind];
    // 产品默认修正：总结预设默认档位从「简要」改为「平衡」。
    // 持久化选中值仍停留在旧默认「简要」的用户随本次修正迁移到「平衡」；
    // 显式改选过其他档位的用户不受影响。
    if (kind === "summary" && presetId === "builtin-summary-concise") {
      presetId = "builtin-summary-balanced";
    }
    if (
      isPresetId(presetId) &&
      ordered.some(
        (candidate) => candidate.id === presetId && candidate.kind === kind,
      )
    ) {
      selectedPromptPresetIds[kind] = presetId;
    }
  }
  return freezePromptPresetState({
    defaultPromptPresetIds: normalizedDefaults,
    presets: ordered,
    selectedPromptPresetIds,
  });
}

function storedPromptPresetState(state: PromptPresetState): unknown {
  return Object.freeze({
    defaultPromptPresetIds: state.defaultPromptPresetIds,
    presetOrder: Object.freeze(
      Object.fromEntries(
        MUZHI_TASK_KINDS.map((kind) => [
          kind,
          Object.freeze(
            state.presets
              .filter((preset) => preset.kind === kind)
              .map((preset) => preset.id),
          ),
        ]),
      ),
    ),
    presets: Object.freeze(
      state.presets
        .filter((preset) => !preset.builtIn)
        .map((preset) =>
          Object.freeze({
            content: preset.content,
            id: preset.id,
            kind: preset.kind,
            name: preset.name,
          }),
        ),
    ),
    selectedPromptPresetIds: state.selectedPromptPresetIds,
    version: 1,
  });
}

function isSelection(value: unknown): value is AiModelSelection | null {
  if (value === null) return true;
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["modelId", "reasoningEffort"])
  ) {
    return false;
  }
  return (
    typeof value.modelId === "string" &&
    value.modelId.length > 0 &&
    value.modelId.length <= 128 &&
    value.modelId === value.modelId.trim() &&
    !value.modelId.startsWith("/") &&
    !value.modelId.includes("//") &&
    !value.modelId.includes("://") &&
    /^[A-Za-z0-9._:+/-]+$/.test(value.modelId) &&
    (value.reasoningEffort === "auto" ||
      value.reasoningEffort === "none" ||
      value.reasoningEffort === "minimal" ||
      value.reasoningEffort === "low" ||
      value.reasoningEffort === "medium" ||
      value.reasoningEffort === "high" ||
      value.reasoningEffort === "xhigh")
  );
}

function readTaskModels(value: unknown): BilimuzhiTaskModels {
  if (!isRecord(value) || value.version !== 1) return EMPTY_TASK_MODELS;
  const next: Record<BilimuzhiTaskKind, AiModelSelection | null> = {
    chat: null,
    segments: null,
    summary: null,
  };
  for (const kind of MUZHI_TASK_KINDS) {
    const candidate = value[kind];
    if (candidate !== undefined && isSelection(candidate)) {
      next[kind] = candidate;
    }
  }
  return Object.freeze(next);
}

function isRetention(
  value: unknown,
): value is StoredSettingsRecord["retention"] {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["applyMode", "policy"]) ||
    (value.applyMode !== "apply-to-existing" &&
      value.applyMode !== "future-only")
  ) {
    return false;
  }
  try {
    createTrashRetentionPolicy(value.policy as TrashRetentionPolicy);
    return true;
  } catch {
    return false;
  }
}

function freezeStoredSettings(
  input: StoredSettingsRecord,
): StoredSettingsRecord {
  return Object.freeze({
    appearance: Object.freeze({ theme: input.appearance.theme }),
    provider: Object.freeze({
      baseUrl: input.provider.baseUrl,
      protocol: input.provider.protocol,
      providerId: input.provider.providerId,
      selectedModel:
        input.provider.selectedModel === null
          ? null
          : Object.freeze({ ...input.provider.selectedModel }),
    }),
    retention: Object.freeze({
      applyMode: input.retention.applyMode,
      policy: createTrashRetentionPolicy(input.retention.policy),
    }),
    version: MUZHI_SETTINGS_VERSION,
  });
}

function readSettingsRecord(value: unknown): StoredSettingsRecord | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["appearance", "provider", "retention", "version"]) ||
    value.version !== MUZHI_SETTINGS_VERSION ||
    !isRecord(value.appearance) ||
    !hasExactKeys(value.appearance, ["theme"]) ||
    !isTheme(value.appearance.theme) ||
    !isRecord(value.provider) ||
    !hasExactKeys(value.provider, [
      "baseUrl",
      "protocol",
      "providerId",
      "selectedModel",
    ]) ||
    !isBaseUrl(value.provider.baseUrl) ||
    !isProtocol(value.provider.protocol) ||
    !isProviderId(value.provider.providerId) ||
    !isSelection(value.provider.selectedModel) ||
    !isRetention(value.retention)
  ) {
    return null;
  }
  return freezeStoredSettings(value as unknown as StoredSettingsRecord);
}

function freezeSecret(input: {
  readonly groqApiKey: string | null;
  readonly providerApiKeys: Readonly<Record<string, string>>;
}): StoredSecretRecord {
  return Object.freeze({
    groqApiKey: input.groqApiKey,
    providerApiKeys: Object.freeze({ ...input.providerApiKeys }),
    version: SETTINGS_SECRET_VERSION,
  });
}

function readSecretRecord(
  value: unknown,
  legacyProviderId: string,
): { readonly migrated: boolean; readonly secret: StoredSecretRecord } {
  if (
    isRecord(value) &&
    hasExactKeys(value, ["groqApiKey", "providerApiKeys", "version"]) &&
    value.version === SETTINGS_SECRET_VERSION &&
    (value.groqApiKey === null || isApiKey(value.groqApiKey)) &&
    isRecord(value.providerApiKeys) &&
    Object.keys(value.providerApiKeys).length <= 64 &&
    Object.entries(value.providerApiKeys).every(
      ([providerId, apiKey]) => isProviderId(providerId) && isApiKey(apiKey),
    )
  ) {
    return {
      migrated: false,
      secret: freezeSecret({
        groqApiKey: value.groqApiKey as string | null,
        providerApiKeys: value.providerApiKeys as Record<string, string>,
      }),
    };
  }
  if (
    isRecord(value) &&
    hasExactKeys(value, ["apiKey", "version"]) &&
    value.version === 1 &&
    (value.apiKey === null || isApiKey(value.apiKey))
  ) {
    const legacyKey = value.apiKey as string | null;
    return {
      migrated: true,
      secret: freezeSecret({
        groqApiKey: legacyProviderId === "groq" ? legacyKey : null,
        providerApiKeys:
          legacyKey === null ? {} : { [legacyProviderId]: legacyKey },
      }),
    };
  }
  return { migrated: false, secret: EMPTY_SECRET };
}

function legacyTheme(value: unknown): SettingsTheme | null {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !isRecord(value.appearance)
  ) {
    return null;
  }
  return isTheme(value.appearance.theme) ? value.appearance.theme : null;
}

function toPublicSettings(
  record: StoredSettingsRecord,
  secret: StoredSecretRecord,
): BilimuzhiSettings {
  return createBilimuzhiSettings({
    appearance: record.appearance,
    provider: {
      apiKeyConfigured:
        secret.providerApiKeys[record.provider.providerId] !== undefined,
      protocol: record.provider.protocol,
      providerId: record.provider.providerId,
      selectedModel: record.provider.selectedModel,
    },
    retention: record.retention,
    version: MUZHI_SETTINGS_VERSION,
  });
}

function normalizeStorageError(error: unknown, message: string): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError(message, true);
}

export function createChromeSettingsStore(
  storage: ChromeWorkspaceStorageArea,
  v12Dependencies: {
    readonly fetch?: typeof globalThis.fetch;
    readonly permissions?: V12HostPermissions;
  } = {},
): ChromeSettingsStore {
  async function getValue(key: string): Promise<unknown> {
    return (await storage.get(key))[key];
  }

  async function read(): Promise<{
    readonly record: StoredSettingsRecord;
    readonly secret: StoredSecretRecord;
  }> {
    try {
      const [settingsValue, secretValue, appearanceValue] = await Promise.all([
        getValue(SETTINGS_STORAGE_KEY),
        getValue(SETTINGS_SECRET_STORAGE_KEY),
        getValue(APPEARANCE_STORAGE_KEY),
      ]);
      const stored = readSettingsRecord(settingsValue);
      const record = stored ?? DEFAULT_SETTINGS;
      const secretResult = readSecretRecord(
        secretValue,
        record.provider.providerId,
      );
      if (secretResult.migrated) {
        await storage.set({
          [SETTINGS_SECRET_STORAGE_KEY]: secretResult.secret,
        });
      }
      if (stored !== null)
        return { record: stored, secret: secretResult.secret };
      const theme = legacyTheme(appearanceValue);
      const migrated = freezeStoredSettings({
        ...DEFAULT_SETTINGS,
        appearance: { theme: theme ?? DEFAULT_SETTINGS.appearance.theme },
      });
      if (theme !== null) {
        await storage.set({ [SETTINGS_STORAGE_KEY]: migrated });
      }
      return { record: migrated, secret: secretResult.secret };
    } catch (error) {
      throw normalizeStorageError(error, "Unable to read the Bilimuzhi settings");
    }
  }

  async function write(
    record: StoredSettingsRecord,
    secret: StoredSecretRecord,
    persistSecret = false,
  ): Promise<BilimuzhiSettings> {
    try {
      const items: Record<string, unknown> = {
        [SETTINGS_STORAGE_KEY]: record,
      };
      if (persistSecret) {
        items[SETTINGS_SECRET_STORAGE_KEY] = secret;
      }
      await storage.set(items);
      return toPublicSettings(record, secret);
    } catch (error) {
      throw normalizeStorageError(error, "Unable to save the Bilimuzhi settings");
    }
  }

  async function loadPromptState(): Promise<PromptPresetState> {
    try {
      return (
        readPromptPresetState(
          await getValue(SETTINGS_PROMPT_PRESETS_STORAGE_KEY),
        ) ?? DEFAULT_PROMPT_PRESET_STATE
      );
    } catch (error) {
      throw normalizeStorageError(
        error,
        "Unable to read the Bilimuzhi prompt presets",
      );
    }
  }

  async function savePromptState(
    state: PromptPresetState,
  ): Promise<PromptPresetState> {
    try {
      await storage.set({
        [SETTINGS_PROMPT_PRESETS_STORAGE_KEY]: storedPromptPresetState(state),
      });
      return state;
    } catch (error) {
      throw normalizeStorageError(
        error,
        "Unable to save the Bilimuzhi prompt presets",
      );
    }
  }

  function createPresetId(existing: readonly PromptPreset[]): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = `preset-${globalThis.crypto.randomUUID()}`;
      if (!existing.some((preset) => preset.id === id)) return id;
    }
    throw new StorageError("Unable to allocate a prompt preset identifier");
  }

  const providerProfiles = createProviderProfileSettingsStore({
    ...v12Dependencies,
    storage,
  });

  return Object.freeze({
    ...providerProfiles,
    async loadV12Settings() {
      const result = await storage.get("muzhi.settings.v12");
      return result["muzhi.settings.v12"];
    },
    async migrateLegacySettingsToV12() {
      return migrateLegacySettingsToV12(storage, {
        promptPresets: SETTINGS_PROMPT_PRESETS_STORAGE_KEY,
        secrets: SETTINGS_SECRET_STORAGE_KEY,
        settings: SETTINGS_STORAGE_KEY,
        taskModels: SETTINGS_TASK_MODELS_STORAGE_KEY,
        uiPreferences: SETTINGS_UI_PREFERENCES_STORAGE_KEY,
      });
    },
    async createGroqWhisperProvider(
      dependencies: Omit<GroqWhisperProviderDependencies, "apiKey">,
    ) {
      // v13 优先（迁移后的活动数据），回退 v12 旧快照与 read()。
      const [v13Secret, v12Secret] = await Promise.all([
        getValue(V13_SETTINGS_SECRET_STORAGE_KEY),
        getValue(V12_SETTINGS_SECRET_STORAGE_KEY),
      ]);
      const legacyKey =
        (isRecord(v13Secret) && typeof v13Secret.groqApiKey === "string"
          ? v13Secret.groqApiKey
          : null) ??
        (isRecord(v12Secret) && v12Secret.version === 12
          ? typeof v12Secret.groqApiKey === "string"
            ? v12Secret.groqApiKey
            : null
          : null);
      const apiKey =
        legacyKey !== null ? legacyKey : (await read()).secret.groqApiKey;
      if (apiKey == null) {
        throw new GroqWhisperError(
          "AUTHENTICATION_REQUIRED",
          "尚未配置 Groq 密钥。",
          false,
        );
      }
      return createGroqWhisperProvider({
        ...dependencies,
        apiKey,
      });
    },
    async load(): Promise<BilimuzhiSettings> {
      const state = await read();
      return toPublicSettings(state.record, state.secret);
    },
    async loadEditorState(): Promise<SettingsEditorState> {
      const state = await read();
      return Object.freeze({
        ...toPublicSettings(state.record, state.secret),
        configuredProviderIds: Object.freeze(
          Object.keys(state.secret.providerApiKeys).sort(),
        ),
        connection: Object.freeze({
          baseUrl: state.record.provider.baseUrl,
          protocol: state.record.provider.protocol,
          providerId: state.record.provider.providerId,
        }),
        speech: Object.freeze({
          groqApiKeyConfigured: state.secret.groqApiKey !== null,
        }),
      });
    },
    async loadPromptPresets(): Promise<PromptPresetState> {
      return loadPromptState();
    },
    async createPromptPreset(input: {
      readonly content?: string;
      readonly kind: BilimuzhiTaskKind;
      readonly name: string;
    }): Promise<PromptPresetState> {
      if (
        !isTaskKind(input.kind) ||
        !isPromptName(input.name) ||
        !isPromptText(input.content ?? "")
      ) {
        throw new StorageError("The Bilimuzhi prompt preset is invalid");
      }
      const current = await loadPromptState();
      return savePromptState(
        freezePromptPresetState({
          defaultPromptPresetIds: current.defaultPromptPresetIds,
          presets: [
            ...current.presets,
            {
              builtIn: false,
              content: input.content ?? "",
              id: createPresetId(current.presets),
              kind: input.kind,
              name: input.name,
            },
          ],
          selectedPromptPresetIds: current.selectedPromptPresetIds,
        }),
      );
    },
    async updatePromptPreset(
      presetId: string,
      input: { readonly content: string; readonly name: string },
    ): Promise<PromptPresetState> {
      if (
        !isPresetId(presetId) ||
        !isPromptName(input.name) ||
        !isPromptText(input.content)
      ) {
        throw new StorageError("The Bilimuzhi prompt preset update is invalid");
      }
      const current = await loadPromptState();
      const target = current.presets.find((preset) => preset.id === presetId);
      if (!target || target.builtIn) {
        throw new StorageError("Built-in prompt originals are read-only");
      }
      return savePromptState(
        freezePromptPresetState({
          defaultPromptPresetIds: current.defaultPromptPresetIds,
          presets: current.presets.map((preset) =>
            preset.id === presetId
              ? { ...preset, content: input.content, name: input.name }
              : preset,
          ),
          selectedPromptPresetIds: current.selectedPromptPresetIds,
        }),
      );
    },
    async deletePromptPreset(presetId: string): Promise<PromptPresetState> {
      if (!isPresetId(presetId)) {
        throw new StorageError("The Bilimuzhi prompt preset identifier is invalid");
      }
      const current = await loadPromptState();
      const target = current.presets.find((preset) => preset.id === presetId);
      if (!target || target.builtIn) {
        throw new StorageError("Built-in prompt originals cannot be deleted");
      }
      const defaults = { ...current.defaultPromptPresetIds };
      if (defaults[target.kind] === target.id) {
        defaults[target.kind] = builtInPromptId(target.kind);
      }
      const selectedPromptPresetIds = {
        ...current.selectedPromptPresetIds,
      };
      if (
        isSelectablePromptKind(target.kind) &&
        selectedPromptPresetIds[target.kind] === target.id
      ) {
        selectedPromptPresetIds[target.kind] = builtInPromptId(target.kind);
      }
      return savePromptState(
        freezePromptPresetState({
          defaultPromptPresetIds: defaults,
          presets: current.presets.filter((preset) => preset.id !== presetId),
          selectedPromptPresetIds,
        }),
      );
    },
    async reorderPromptPresets(
      kind: BilimuzhiTaskKind,
      orderedPresetIds: readonly string[],
    ): Promise<PromptPresetState> {
      if (
        !isTaskKind(kind) ||
        !Array.isArray(orderedPresetIds) ||
        orderedPresetIds.some((presetId) => !isPresetId(presetId)) ||
        new Set(orderedPresetIds).size !== orderedPresetIds.length
      ) {
        throw new StorageError("The prompt preset order is invalid");
      }
      const current = await loadPromptState();
      const currentForKind = current.presets.filter(
        (preset) => preset.kind === kind,
      );
      if (
        orderedPresetIds.length !== currentForKind.length ||
        orderedPresetIds.some(
          (presetId) =>
            !currentForKind.some((preset) => preset.id === presetId),
        )
      ) {
        throw new StorageError("The prompt preset order is incomplete");
      }
      const orderedForKind = orderedPresetIds.map((presetId) =>
        currentForKind.find((preset) => preset.id === presetId)!,
      );
      const presets: PromptPreset[] = [];
      let inserted = false;
      for (const preset of current.presets) {
        if (preset.kind === kind) {
          if (!inserted) {
            presets.push(...orderedForKind);
            inserted = true;
          }
          continue;
        }
        presets.push(preset);
      }
      return savePromptState(
        freezePromptPresetState({
          defaultPromptPresetIds: current.defaultPromptPresetIds,
          presets,
          selectedPromptPresetIds: current.selectedPromptPresetIds,
        }),
      );
    },
    async selectPromptPreset(
      kind: PromptPresetSelectableKind,
      presetId: string,
    ): Promise<PromptPresetState> {
      if (!isSelectablePromptKind(kind) || !isPresetId(presetId)) {
        throw new StorageError("The selected prompt preset is invalid");
      }
      const current = await loadPromptState();
      if (
        !current.presets.some(
          (preset) => preset.id === presetId && preset.kind === kind,
        )
      ) {
        throw new StorageError("The selected prompt preset does not exist");
      }
      return savePromptState(
        freezePromptPresetState({
          defaultPromptPresetIds: current.defaultPromptPresetIds,
          presets: current.presets,
          selectedPromptPresetIds: {
            ...current.selectedPromptPresetIds,
            [kind]: presetId,
          },
        }),
      );
    },
    async selectDefaultPromptPreset(
      kind: BilimuzhiTaskKind,
      presetId: string,
    ): Promise<PromptPresetState> {
      if (!isTaskKind(kind) || !isPresetId(presetId)) {
        throw new StorageError("The default prompt preset is invalid");
      }
      const current = await loadPromptState();
      if (
        !current.presets.some(
          (preset) => preset.id === presetId && preset.kind === kind,
        )
      ) {
        throw new StorageError("The default prompt preset does not exist");
      }
      return savePromptState(
        freezePromptPresetState({
          defaultPromptPresetIds: {
            ...current.defaultPromptPresetIds,
            [kind]: presetId,
          },
          presets: current.presets,
          selectedPromptPresetIds: current.selectedPromptPresetIds,
        }),
      );
    },
    async importPromptPresets(input: {
      readonly data: string;
      readonly format: "json" | "text";
      readonly kind?: BilimuzhiTaskKind;
      readonly name?: string;
    }): Promise<PromptPresetState> {
      if (
        (input.format !== "json" && input.format !== "text") ||
        typeof input.data !== "string" ||
        input.data.length === 0 ||
        input.data.length > 262_144
      ) {
        throw new StorageError("The imported prompt preset payload is invalid");
      }
      const imported: Array<{
        content: string;
        kind: BilimuzhiTaskKind;
        name: string;
      }> = [];
      if (input.format === "text") {
        if (
          !isTaskKind(input.kind) ||
          !isPromptName(input.name ?? "导入的提示词") ||
          !isPromptText(input.data)
        ) {
          throw new StorageError("Text prompt import requires one task kind");
        }
        imported.push({
          content: input.data,
          kind: input.kind,
          name: input.name ?? "导入的提示词",
        });
      } else {
        let decoded: unknown;
        try {
          decoded = JSON.parse(input.data) as unknown;
        } catch {
          throw new StorageError("The prompt preset JSON is invalid");
        }
        if (
          !isRecord(decoded) ||
          !hasExactKeys(decoded, ["presets", "version"]) ||
          decoded.version !== 1 ||
          !Array.isArray(decoded.presets)
        ) {
          throw new StorageError("The prompt preset JSON schema is invalid");
        }
        for (const value of decoded.presets) {
          if (
            !isRecord(value) ||
            !hasExactKeys(value, ["content", "kind", "name"]) ||
            !isTaskKind(value.kind) ||
            !isPromptName(value.name) ||
            !isPromptText(value.content)
          ) {
            throw new StorageError("The prompt preset JSON schema is invalid");
          }
          imported.push({
            content: value.content,
            kind: value.kind,
            name: value.name,
          });
        }
      }
      const current = await loadPromptState();
      const presets = [...current.presets];
      for (const value of imported) {
        presets.push({
          builtIn: false,
          ...value,
          id: createPresetId(presets),
        });
      }
      return savePromptState(
        freezePromptPresetState({
          defaultPromptPresetIds: current.defaultPromptPresetIds,
          presets,
          selectedPromptPresetIds: current.selectedPromptPresetIds,
        }),
      );
    },
    async exportPromptPresets(format: "json" | "text"): Promise<string> {
      if (format !== "json" && format !== "text") {
        throw new StorageError("The prompt preset export format is invalid");
      }
      const current = await loadPromptState();
      const custom = current.presets.filter((preset) => !preset.builtIn);
      if (format === "text") {
        return custom
          .map(
            (preset) => `# ${preset.kind}: ${preset.name}\n\n${preset.content}`,
          )
          .join("\n\n---\n\n");
      }
      return JSON.stringify({
        presets: custom.map(({ content, kind, name }) => ({
          content,
          kind,
          name,
        })),
        version: 1,
      });
    },
    async loadTaskModels(): Promise<BilimuzhiTaskModels> {
      try {
        return readTaskModels(await getValue(SETTINGS_TASK_MODELS_STORAGE_KEY));
      } catch (error) {
        throw normalizeStorageError(
          error,
          "Unable to read the Bilimuzhi task model settings",
        );
      }
    },
    async saveTaskModel(
      kind: BilimuzhiTaskKind,
      selection: AiModelSelection | null,
    ): Promise<BilimuzhiTaskModels> {
      if (!MUZHI_TASK_KINDS.includes(kind) || !isSelection(selection)) {
        throw new StorageError("The Bilimuzhi task model selection is invalid");
      }
      try {
        const current = readTaskModels(
          await getValue(SETTINGS_TASK_MODELS_STORAGE_KEY),
        );
        const next: BilimuzhiTaskModels = Object.freeze({
          ...current,
          [kind]: selection,
        });
        await storage.set({
          [SETTINGS_TASK_MODELS_STORAGE_KEY]: Object.freeze({
            ...next,
            version: 1,
          }),
        });
        return next;
      } catch (error) {
        throw normalizeStorageError(
          error,
          "Unable to save the Bilimuzhi task model settings",
        );
      }
    },
    async loadUiPreferences(): Promise<SettingsUiPreferences> {
      try {
        return (
          readUiPreferences(
            await getValue(SETTINGS_UI_PREFERENCES_STORAGE_KEY),
          ) ?? DEFAULT_UI_PREFERENCES
        );
      } catch (error) {
        throw normalizeStorageError(
          error,
          "Unable to read the Bilimuzhi UI preferences",
        );
      }
    },
    async save(settings: BilimuzhiSettings): Promise<BilimuzhiSettings> {
      const normalized = createBilimuzhiSettings(settings);
      const state = await read();
      return write(
        freezeStoredSettings({
          appearance: normalized.appearance,
          provider: {
            ...state.record.provider,
            protocol: normalized.provider.protocol,
            providerId: normalized.provider.providerId,
            selectedModel: normalized.provider.selectedModel,
          },
          retention: normalized.retention,
          version: MUZHI_SETTINGS_VERSION,
        }),
        state.secret,
      );
    },
    async updateRetention(input: {
      readonly applyMode: TrashRetentionApplyMode;
      readonly policy: TrashRetentionPolicy;
    }): Promise<BilimuzhiSettings> {
      if (
        input.applyMode !== "apply-to-existing" &&
        input.applyMode !== "future-only"
      ) {
        throw new StorageError("The Bilimuzhi retention apply mode is invalid");
      }
      const state = await read();
      return write(
        freezeStoredSettings({
          ...state.record,
          retention: {
            applyMode: input.applyMode,
            policy: createTrashRetentionPolicy(input.policy),
          },
        }),
        state.secret,
      );
    },
    async selectModel(selection: AiModelSelection): Promise<BilimuzhiSettings> {
      if (!isSelection(selection) || selection === null) {
        throw new StorageError("The selected AI model is invalid");
      }
      const state = await read();
      return write(
        freezeStoredSettings({
          ...state.record,
          provider: { ...state.record.provider, selectedModel: selection },
        }),
        state.secret,
      );
    },
    async selectDiscoveredModel(
      descriptor: AiModelDescriptor,
      selection: AiModelSelection,
    ): Promise<BilimuzhiSettings> {
      if (
        descriptor.modelId !== selection.modelId ||
        (selection.reasoningEffort !== "auto" &&
          !isCustomReasoningEffort(selection.reasoningEffort) &&
          !descriptor.capabilities.supportedReasoningEfforts.includes(
            selection.reasoningEffort as AiReasoningEffort,
          ))
      ) {
        throw new StorageError("The selected AI model capability is invalid");
      }
      return this.selectModel(selection);
    },
    async saveProviderConfiguration(
      input: AiProviderConnection,
    ): Promise<BilimuzhiSettings> {
      if (
        !isBaseUrl(input.baseUrl) ||
        !isProtocol(input.protocol) ||
        !isProviderId(input.providerId)
      ) {
        throw new StorageError("The AI provider configuration is invalid");
      }
      const state = await read();
      return write(
        freezeStoredSettings({
          ...state.record,
          provider: { ...input, selectedModel: null },
        }),
        state.secret,
      );
    },
    async saveUiPreferences(
      input: SettingsUiPreferences,
    ): Promise<SettingsUiPreferences> {
      const normalized = readUiPreferences(input);
      if (normalized === null) {
        throw new StorageError("The Bilimuzhi UI preferences are invalid");
      }
      try {
        await storage.set({
          [SETTINGS_UI_PREFERENCES_STORAGE_KEY]: normalized,
        });
        return normalized;
      } catch (error) {
        throw normalizeStorageError(
          error,
          "Unable to save the Bilimuzhi UI preferences",
        );
      }
    },
    async saveApiKey(apiKey: string | null): Promise<BilimuzhiSettings> {
      if (apiKey !== null && !isApiKey(apiKey)) {
        throw new StorageError("The AI provider key is invalid");
      }
      const state = await read();
      const providerApiKeys = { ...state.secret.providerApiKeys };
      if (apiKey === null) {
        delete providerApiKeys[state.record.provider.providerId];
      } else {
        providerApiKeys[state.record.provider.providerId] = apiKey;
      }
      const secret = freezeSecret({
        groqApiKey: state.secret.groqApiKey,
        providerApiKeys,
      });
      return write(state.record, secret, true);
    },
    async saveGroqApiKey(apiKey: string | null): Promise<BilimuzhiSettings> {
      if (apiKey !== null && !isApiKey(apiKey)) {
        throw new StorageError("The Groq speech key is invalid");
      }
      const state = await read();
      return write(
        state.record,
        freezeSecret({
          groqApiKey: apiKey,
          providerApiKeys: state.secret.providerApiKeys,
        }),
        true,
      );
    },
    async createProviderGateway(
      dependencies: Omit<
        AiProviderGatewayFromSettingsDependencies,
        "apiKey" | "settings"
      >,
    ): Promise<AiProviderGateway> {
      const state = await read();
      const apiKey =
        state.secret.providerApiKeys[state.record.provider.providerId];
      if (apiKey === undefined) {
        throw new AiProviderError(
          "AUTHENTICATION_REQUIRED",
          "An AI provider key has not been configured",
          false,
        );
      }
      return createAiProviderGatewayFromSettings({
        ...dependencies,
        apiKey,
        settings: state.record.provider,
      });
    },
  });
}
