import { DEFAULT_UI_LANGUAGE, type UiLanguage } from "./languages";
import { MESSAGES, type MessageKey } from "./messages";

/** 取本地化文案；缺 key 回退 zh-Hans，再缺回退 key 本身。 */
export function t(
  language: UiLanguage,
  key: MessageKey,
  params?: Readonly<Record<string, string | number>>,
): string {
  const table = MESSAGES[language] ?? MESSAGES[DEFAULT_UI_LANGUAGE];
  let text = table[key] ?? MESSAGES[DEFAULT_UI_LANGUAGE][key] ?? key;
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

/**
 * UI 层错误映射（docs/i18n-spec.md §4）：错误码 → 本地化文本。
 * 未知错误码回退通用文案并附带原文；底层消息不在此转换。
 */
export function errorTextFor(
  language: UiLanguage,
  code: string,
  fallback: string,
): string {
  if (code === "STORAGE_ERROR") {
    return t(language, "toast.busy");
  }
  if (code === "INTERNAL_ERROR") {
    return t(language, "common.confirm");
  }
  return `${t(language, "common.cancel")} ${fallback}`;
}
