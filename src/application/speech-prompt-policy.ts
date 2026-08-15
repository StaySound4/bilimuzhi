/**
 * 语音语言模式与 Prompt 策略（Ticket 09，spec §8）。
 *
 * zh/en/other/mixed/ja 五选项，默认 mixed。语言设置只能促进识别，
 * 不能保证最终字幕语言，也不会翻译。
 * 放在 application 层（非 src/ui）：提示词是运行时行为契约，不是 UI 文案；
 * check-i18n 不扫描本目录。
 */
import type { SubtitleLanguageMode } from "../domain";

export const SPEECH_LANGUAGE_MODES: readonly SubtitleLanguageMode[] =
  Object.freeze(["zh", "en", "other", "mixed", "ja"]);

export const DEFAULT_SPEECH_LANGUAGE_MODE: SubtitleLanguageMode = "mixed";

/**
 * 语音 Prompt 映射契约（spec §8；Ticket 09 实现真实 Prompt 文本）：
 * - zh：纯中文 Prompt，发送 `language=zh`；
 * - en：纯英文 Prompt，发送 `language=en`；
 * - other：纯英文中性 Prompt，不固定 `language`；
 * - mixed：纯英文混合语言 Prompt，不固定 `language`。
 * 禁止引入语言探测、投票、主语言锁定、音轨扫描或额外网络请求。
 */
export interface SpeechPromptMapping {
  readonly mode: SubtitleLanguageMode;
  readonly prompt: string;
  /** 发送给转写请求的 `language` 参数；null 表示不固定输入语言。 */
  readonly languageParam: "zh" | "en" | "ja" | null;
}

export const SPEECH_PROMPT_POLICY: Readonly<
  Record<SubtitleLanguageMode, SpeechPromptMapping>
> = Object.freeze({
  zh: Object.freeze({
    languageParam: "zh",
    mode: "zh",
    prompt:
      "逐字转写语音内容，不翻译、不总结、不补全；保留原始语言，输出带时间戳的分段。",
  }),
  en: Object.freeze({
    languageParam: "en",
    mode: "en",
    prompt:
      "Transcribe the speech verbatim. Do not translate, summarize, or fill in gaps. Keep the original language and output timestamped segments.",
  }),
  other: Object.freeze({
    languageParam: null,
    mode: "other",
    prompt:
      "Transcribe the speech verbatim in its original language. Do not translate, summarize, or fill in gaps. Output timestamped segments.",
  }),
  mixed: Object.freeze({
    languageParam: null,
    mode: "mixed",
    prompt:
      "This audio contains multiple languages. Transcribe each utterance verbatim in its original language. Do not translate, summarize, or fill in gaps. Output timestamped segments.",
  }),
  ja: Object.freeze({
    languageParam: "ja",
    mode: "ja",
    prompt:
      "音声を逐語で文字起こししてください。翻訳・要約・補完はしないでください。元の言語を維持し、タイムスタンプ付きのセグメントで出力してください。",
  }),
});
