import { describe, expect, it } from "vitest";

import { t } from "../../src/i18n";
import { UI_LANGUAGES, isUiLanguage } from "../../src/i18n/languages";
import { MESSAGES } from "../../src/i18n/messages";

describe("i18n 文案表", () => {
  it("四种语言 key 集合完全一致（docs/i18n-spec.md §6）", () => {
    const zhKeys = Object.keys(MESSAGES["zh-Hans"]).sort();
    for (const language of UI_LANGUAGES) {
      const keys = Object.keys(MESSAGES[language]).sort();
      expect(keys).toEqual(zhKeys);
    }
  });

  it("t() 缺 key 回退 zh-Hans；参数插值生效", () => {
    expect(t("en", "common.cancel")).toBe("Cancel");
    // 插值
    expect(t("zh-Hans", "archive.tagUsage", { count: 3 })).toBe("标签 3/200");
    expect(t("en", "archive.archivedAt", { label: "2026/8/8 10:00" })).toBe(
      "Archived 2026/8/8 10:00",
    );
  });

  it("isUiLanguage 校验", () => {
    expect(isUiLanguage("zh-Hans")).toBe(true);
    expect(isUiLanguage("zh-Hant")).toBe(true);
    expect(isUiLanguage("fr")).toBe(false);
  });
});
