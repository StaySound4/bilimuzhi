/** 界面/输出语言枚举（docs/i18n-spec.md §1） */
export const UI_LANGUAGES = ["zh-Hans", "zh-Hant", "en", "ja"] as const;

export type UiLanguage = (typeof UI_LANGUAGES)[number];

/**
 * 各模式输出语言偏好：具体语言或 "auto"（不指定语言）。
 * "auto" 时不注入任何语言控制提示词，让模型跟随用户在同一对话中自由切换。
 */
export type OutputLanguagePreference = UiLanguage | "auto";

export const DEFAULT_UI_LANGUAGE: UiLanguage = "zh-Hans";

export interface UiLanguageMeta {
  /** 本语言自称（用于提示词注入与语言选择下拉）。 */
  readonly nativeName: string;
  readonly label: string;
}

export const UI_LANGUAGE_META: Readonly<Record<UiLanguage, UiLanguageMeta>> =
  Object.freeze({
    "zh-Hans": Object.freeze({ nativeName: "简体中文", label: "中文（简体）" }),
    "zh-Hant": Object.freeze({ nativeName: "繁體中文", label: "中文（繁體）" }),
    en: Object.freeze({ nativeName: "English", label: "English" }),
    ja: Object.freeze({ nativeName: "日本語", label: "日本語" }),
  });

export function isUiLanguage(value: string): value is UiLanguage {
  return (UI_LANGUAGES as readonly string[]).includes(value);
}
