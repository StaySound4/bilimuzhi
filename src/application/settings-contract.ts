import {
  createTrashRetentionPolicy,
  type TrashRetentionApplyMode,
  type TrashRetentionPolicy,
} from "../domain";
import type {
  AiModelDescriptor,
  AiReasoningEffort,
  AiReasoningPreference,
} from "./ai/provider-contract";
import { isCustomReasoningEffort } from "./ai/provider-contract";
export const TRASH_RETENTION_SETTING_KEY = "trashRetention" as const;
export const MUZHI_SETTINGS_VERSION = 1 as const;
export const SETTINGS_THEMES = ["light", "dark", "system"] as const;

export type SettingsTheme = (typeof SETTINGS_THEMES)[number];
export type AiProviderProtocol =
  "claude" | "gemini" | "openai-chat" | "openai-responses" | "openai";

export interface TrashRetentionSetting {
  readonly key: typeof TRASH_RETENTION_SETTING_KEY;
  readonly policy: TrashRetentionPolicy;
  readonly updatedAt: number;
}

export interface AiModelSelection {
  readonly modelId: string;
  readonly reasoningEffort: AiReasoningPreference;
}

/** Credential-free settings projection safe for application and UI state. */
export interface AiProviderSettings {
  readonly apiKeyConfigured: boolean;
  readonly protocol: AiProviderProtocol;
  readonly providerId: string;
  readonly selectedModel: AiModelSelection | null;
}

export interface BilimuzhiSettings {
  readonly appearance: { readonly theme: SettingsTheme };
  readonly provider: AiProviderSettings;
  readonly retention: {
    readonly applyMode: TrashRetentionApplyMode;
    readonly policy: TrashRetentionPolicy;
  };
  readonly version: typeof MUZHI_SETTINGS_VERSION;
}

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

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function isSafeModelIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.startsWith("/") &&
    !value.includes("//") &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:+/-]+$/.test(value)
  );
}

function isReasoningPreference(value: unknown): value is AiReasoningPreference {
  return (
    typeof value === "string" &&
    (value === "auto" ||
      value === "none" ||
      value === "minimal" ||
      value === "low" ||
      value === "medium" ||
      value === "high" ||
      value === "xhigh" ||
      value === "max" ||
      isCustomReasoningEffort(value))
  );
}

function isRetentionPolicy(value: unknown): value is TrashRetentionPolicy {
  try {
    createTrashRetentionPolicy(value as TrashRetentionPolicy);
    return true;
  } catch {
    return false;
  }
}

function freezeSelection(selection: AiModelSelection): AiModelSelection {
  return Object.freeze({
    modelId: selection.modelId,
    reasoningEffort: selection.reasoningEffort,
  });
}

export function createTrashRetentionSetting(
  input: TrashRetentionSetting,
): TrashRetentionSetting {
  if (input.key !== TRASH_RETENTION_SETTING_KEY) {
    throw new Error("The trash retention setting key is unsupported");
  }
  if (!Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0) {
    throw new Error("The trash retention setting timestamp is invalid");
  }
  return Object.freeze({
    key: TRASH_RETENTION_SETTING_KEY,
    policy: createTrashRetentionPolicy(input.policy),
    updatedAt: input.updatedAt,
  });
}

export function createAiModelSelection(
  descriptor: AiModelDescriptor,
  reasoningEffort: AiReasoningPreference,
): AiModelSelection {
  if (!isSafeModelIdentifier(descriptor.modelId)) {
    throw new Error("The selected AI model is invalid");
  }
  if (
    !isReasoningPreference(reasoningEffort) ||
    // 自定义档位原样透传，不检查模型支持集；内置档位必须在支持集内。
    (reasoningEffort !== "auto" &&
      !isCustomReasoningEffort(reasoningEffort) &&
      !descriptor.capabilities.supportedReasoningEfforts.includes(
        reasoningEffort as AiReasoningEffort,
      ))
  ) {
    throw new Error(
      "The reasoning effort is unsupported by the selected model",
    );
  }
  return freezeSelection({ modelId: descriptor.modelId, reasoningEffort });
}

export function isBilimuzhiSettings(value: unknown): value is BilimuzhiSettings {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["appearance", "provider", "retention", "version"]) ||
    value.version !== MUZHI_SETTINGS_VERSION ||
    !isRecord(value.appearance) ||
    !hasExactKeys(value.appearance, ["theme"]) ||
    !SETTINGS_THEMES.includes(value.appearance.theme as SettingsTheme) ||
    !isRecord(value.provider) ||
    !hasExactKeys(value.provider, [
      "apiKeyConfigured",
      "protocol",
      "providerId",
      "selectedModel",
    ]) ||
    typeof value.provider.apiKeyConfigured !== "boolean" ||
    (value.provider.protocol !== "openai" &&
      value.provider.protocol !== "openai-chat" &&
      value.provider.protocol !== "openai-responses" &&
      value.provider.protocol !== "claude" &&
      value.provider.protocol !== "gemini") ||
    !isSafeIdentifier(value.provider.providerId) ||
    !isRecord(value.retention) ||
    !hasExactKeys(value.retention, ["applyMode", "policy"]) ||
    (value.retention.applyMode !== "apply-to-existing" &&
      value.retention.applyMode !== "future-only") ||
    !isRetentionPolicy(value.retention.policy)
  ) {
    return false;
  }
  if (value.provider.selectedModel === null) return true;
  return (
    isRecord(value.provider.selectedModel) &&
    hasExactKeys(value.provider.selectedModel, [
      "modelId",
      "reasoningEffort",
    ]) &&
    isSafeModelIdentifier(value.provider.selectedModel.modelId) &&
    isReasoningPreference(value.provider.selectedModel.reasoningEffort)
  );
}

export function createBilimuzhiSettings(input: BilimuzhiSettings): BilimuzhiSettings {
  if (!isBilimuzhiSettings(input)) {
    throw new Error("The Bilimuzhi settings record is invalid");
  }
  return Object.freeze({
    appearance: Object.freeze({ theme: input.appearance.theme }),
    provider: Object.freeze({
      apiKeyConfigured: input.provider.apiKeyConfigured,
      protocol: input.provider.protocol,
      providerId: input.provider.providerId,
      selectedModel:
        input.provider.selectedModel === null
          ? null
          : freezeSelection(input.provider.selectedModel),
    }),
    retention: Object.freeze({
      applyMode: input.retention.applyMode,
      policy: createTrashRetentionPolicy(input.retention.policy),
    }),
    version: MUZHI_SETTINGS_VERSION,
  });
}
