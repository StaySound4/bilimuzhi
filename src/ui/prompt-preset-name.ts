import { t } from "../i18n";
import type { MessageKey } from "../i18n/messages";
import type { OutputLanguagePreference, UiLanguage } from "../i18n/languages";
import { PROMPT_LANGUAGE_PACKS } from "../application/ai/prompt-language-pack";

/**
 * 内置提示词预设的显示名映射（docs/i18n-spec.md §3）。
 *
 * 预设名是持久化数据（chrome-settings-store 的 BUILT_IN_PROMPT_PRESETS），
 * 保持中文原值不变；UI 显示层按预设 id 映射为当前界面语言。
 * 用户自建预设显示用户输入的原名。
 */
const BUILT_IN_PRESET_CONTENT_KEYS: Readonly<Record<string, MessageKey>> =
  Object.freeze({
    "builtin-chat": "prompts.builtinContentChat",
    "builtin-segments": "prompts.builtinContentSegments",
    "builtin-summary-concise": "prompts.builtinContentSummaryConcise",
    "builtin-summary-balanced": "prompts.builtinContentSummaryBalanced",
    "builtin-summary-detailed": "prompts.builtinContentSummaryDetailed",
  });

const BUILT_IN_PRESET_NAME_KEYS: Readonly<Record<string, MessageKey>> =
  Object.freeze({
    "builtin-chat": "presets.builtinChat",
    "builtin-segments": "presets.builtinSegments",
    "builtin-summary-concise": "presets.builtinSummaryConcise",
    "builtin-summary-balanced": "presets.builtinSummaryBalanced",
    "builtin-summary-detailed": "presets.builtinSummaryDetailed",
  });

export function displayPresetName(
  preset: {
    readonly builtIn: boolean;
    readonly id: string;
    readonly name: string;
  },
  lang: UiLanguage,
): string {
  if (!preset.builtIn) return preset.name;
  const key = BUILT_IN_PRESET_NAME_KEYS[preset.id];
  return key === undefined ? preset.name : t(lang, key);
}

/**
 * 内置预设正文的显示层映射：持久化 content 保持中文原文（AI 稳定性），
 * UI 展示与复制按当前界面语言输出翻译文本。
 */
export function displayPresetContent(
  preset: {
    readonly builtIn: boolean;
    readonly id: string;
    readonly content: string;
  },
  lang: UiLanguage,
  outputLanguage?: OutputLanguagePreference,
): string {
  if (!preset.builtIn) return preset.content;
  if (outputLanguage !== undefined && outputLanguage !== "auto") {
    const pack =
      PROMPT_LANGUAGE_PACKS[outputLanguage].builtInPresets[
        preset.id as keyof typeof PROMPT_LANGUAGE_PACKS.en.builtInPresets
      ];
    if (pack !== undefined) return pack;
  }
  const key = BUILT_IN_PRESET_CONTENT_KEYS[preset.id];
  return key === undefined ? preset.content : t(lang, key);
}
