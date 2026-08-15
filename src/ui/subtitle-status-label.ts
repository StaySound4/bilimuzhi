import type { SubtitleTrackOrigin } from "../domain";
import { t } from "../i18n";
import type { UiLanguage } from "../i18n/languages";

/**
 * 状态槽「语言 · 字幕状态」文案：语言显示用户请求的语言
 * （zh/en/other/mixed → 中文/英文/其他/混合，null → 自动），
 * 字幕状态由字幕来源推导（bilibili → 官方字幕，groq-whisper → 语音字幕）。
 * 无字幕时只显示「无字幕」且不显示语言。
 */

export function requestedLanguageLabel(
  mode: "zh" | "en" | "other" | "mixed" | "ja" | null,
  lang: UiLanguage = "zh-Hans",
): string {
  switch (mode) {
    case "zh":
      return t(lang, "status.langZh");
    case "en":
      return t(lang, "status.langEn");
    case "other":
      return t(lang, "status.langOther");
    case "mixed":
      return t(lang, "status.langMixed");
    case null:
      return t(lang, "status.langAuto");
    case "ja":
      return t(lang, "status.langJa");
  }
}

/** 官方字幕来源细分（菜单详情用）；语音字幕与未知来源返回 null（不细分）。 */
export function officialSubtitleDetailLabel(
  trackOrigin: SubtitleTrackOrigin | null,
  lang: UiLanguage = "zh-Hans",
): string | null {
  switch (trackOrigin) {
    case "official-cc":
      return t(lang, "status.officialCc");
    case "ai":
      return t(lang, "status.aiSubtitle");
    case "user-upload":
      return t(lang, "status.userUpload");
    case null:
      return null;
  }
}

export function subtitleStatusLabel(input: {
  readonly languageMode: "zh" | "en" | "other" | "mixed" | "ja" | null;
  readonly source: "bilibili" | "groq-whisper";
  readonly trackOrigin: SubtitleTrackOrigin | null;
  lang?: UiLanguage;
}): string {
  const language = requestedLanguageLabel(input.languageMode, input.lang);
  return input.source === "groq-whisper"
    ? t(input.lang ?? "zh-Hans", "status.speechSubtitle", { lang: language })
    : t(input.lang ?? "zh-Hans", "status.officialSubtitle", { lang: language });
}

export function noSubtitleStatusLabel(lang: UiLanguage = "zh-Hans"): string {
  return t(lang, "status.noSubtitle");
}
