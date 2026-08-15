import { describe, expect, it } from "vitest";
import {
  DEFAULT_SPEECH_LANGUAGE_MODE,
  SPEECH_LANGUAGE_MODES,
  SPEECH_PROMPT_POLICY,
  type SpeechPromptMapping,
} from "../../src/application/speech-prompt-policy";

/** 纯中文/日文（含假名）：不含任何 ASCII 字母。 */
const CJK_ONLY =
  /^[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u3040-\u30ff\u30fb\u30fc・ー，。；：！？、（）\s\d]+$/u;
/** 纯英文：不含任何 CJK 表意字符。 */
const ASCII_ONLY = /^[\x20-\x7e\s]+$/u;

describe("SPEECH_LANGUAGE_MODES（Ticket 09/10 五模式契约）", () => {
  it("五选项保留、默认 mixed", () => {
    expect(SPEECH_LANGUAGE_MODES).toEqual(["zh", "en", "other", "mixed", "ja"]);
    expect(DEFAULT_SPEECH_LANGUAGE_MODE).toBe("mixed");
  });

  it("五模式映射齐全且 languageParam 语义正确", () => {
    expect(Object.keys(SPEECH_PROMPT_POLICY).sort()).toEqual([
      "en",
      "ja",
      "mixed",
      "other",
      "zh",
    ]);
    const params: Record<string, "zh" | "en" | "ja" | null> = {
      zh: "zh",
      en: "en",
      ja: "ja",
      other: null,
      mixed: null,
    };
    for (const mode of SPEECH_LANGUAGE_MODES) {
      const mapping: SpeechPromptMapping = {
        ...SPEECH_PROMPT_POLICY[mode],
        prompt: "",
      };
      expect(mapping.mode).toBe(mode);
      expect(mapping.languageParam).toBe(params[mode]);
    }
  });
});

describe("SPEECH_PROMPT_POLICY prompt 文本（Ticket 09 纯语言要求）", () => {
  it("zh：纯中文 Prompt（无 ASCII 字母）", () => {
    const prompt = SPEECH_PROMPT_POLICY.zh.prompt;
    expect(CJK_ONLY.test(prompt)).toBe(true);
    expect(prompt).toMatch(/逐字|原样/u);
    expect(prompt).toMatch(/不翻译/u);
  });

  it("en：纯英文 Prompt（无 CJK 字符）", () => {
    const prompt = SPEECH_PROMPT_POLICY.en.prompt;
    expect(ASCII_ONLY.test(prompt)).toBe(true);
    expect(prompt).toMatch(/verbatim|word.for.word|exactly/u);
    expect(prompt).toMatch(/do not translate/iu);
  });

  it("other：纯英文中性 Prompt（不假设主语言）", () => {
    const prompt = SPEECH_PROMPT_POLICY.other.prompt;
    expect(ASCII_ONLY.test(prompt)).toBe(true);
    // 中性：不得点名 Chinese/English 或断言「非中非英」。
    expect(prompt).not.toMatch(/chinese|english/iu);
    expect(prompt).not.toMatch(/neither/iu);
    expect(prompt).toMatch(/verbatim|exactly/u);
    expect(prompt).toMatch(/do not translate/iu);
  });

  it("mixed：纯英文混合语言 Prompt（无 CJK）", () => {
    const prompt = SPEECH_PROMPT_POLICY.mixed.prompt;
    expect(ASCII_ONLY.test(prompt)).toBe(true);
    expect(prompt).toMatch(/multiple languages|mixed|various/iu);
    expect(prompt).toMatch(/verbatim|exactly/u);
    expect(prompt).toMatch(/do not translate/iu);
  });

  it("五种 prompt 互不相同（各自语义可区分）", () => {
    const prompts = SPEECH_LANGUAGE_MODES.map(
      (mode) => SPEECH_PROMPT_POLICY[mode].prompt,
    );
    expect(new Set(prompts).size).toBe(5);
  });

  it("ja：日文 Prompt（无 ASCII 字母）且固定 language=ja", () => {
    const prompt = SPEECH_PROMPT_POLICY.ja.prompt;
    expect(CJK_ONLY.test(prompt)).toBe(true);
    expect(prompt).toMatch(/文字起こし|転写/u);
    expect(prompt).toMatch(/翻訳/u);
    expect(SPEECH_PROMPT_POLICY.ja.languageParam).toBe("ja");
  });

  it("契约对象只包含 mode/languageParam/prompt 三字段（无探测/投票/锁定配置）", () => {
    for (const mode of SPEECH_LANGUAGE_MODES) {
      const mapping = SPEECH_PROMPT_POLICY[mode];
      expect(Object.keys(mapping).sort()).toEqual([
        "languageParam",
        "mode",
        "prompt",
      ]);
    }
  });
});
