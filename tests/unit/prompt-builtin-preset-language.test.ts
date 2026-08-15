import { describe, expect, it } from "vitest";

import { buildTaskPrompt } from "../../src/application/ai/prompt-builder";
import { PROMPT_LANGUAGE_PACKS } from "../../src/application/ai/prompt-language-pack";

const CONTEXT = {
  characterBudget: 4_000,
  chunks: [
    {
      endMs: 15_000,
      rowIndexes: [0, 1, 2],
      startMs: 0,
      text: "字幕参考内容",
    },
  ],
  explanation: "test",
  strategy: "full" as const,
};

const ROWS = [
  { endMs: 5_000, lineId: "l1", startMs: 0, text: "大家好" },
  { endMs: 10_000, lineId: "l2", startMs: 5_000, text: "介绍工具" },
  { endMs: 15_000, lineId: "l3", startMs: 10_000, text: "支持分段" },
];

const META = { bvid: "BV1xx411c7mD", durationSec: 15, title: "测试视频" };

/**
 * 等价于 sidepanel controlPromptFor(kind) 对内置预设的处理：
 * 选中内置预设时返回该模式输出语言的语言包内容。
 */
function builtInPromptFor(
  presetId:
    | "builtin-chat"
    | "builtin-segments"
    | "builtin-summary-concise"
    | "builtin-summary-balanced"
    | "builtin-summary-detailed",
  outputLanguage: "zh-Hans" | "zh-Hant" | "en" | "ja",
): string {
  return PROMPT_LANGUAGE_PACKS[outputLanguage].builtInPresets[presetId];
}

describe("内置预设语言化（生成链路证据）", () => {
  it("总结模式选中内置预设时，用户提示词层已替换为输出语言内容", () => {
    const userPrompt = builtInPromptFor("builtin-summary-balanced", "ja");
    const messages = buildTaskPrompt({
      contextPlan: CONTEXT,
      kind: "summary",
      meta: META,
      outputLanguage: "ja",
      question: "请现在开始输出。",
      rows: ROWS,
      userPrompt,
    });
    const content = messages.map((m) => m.content).join("\n");
    // 用户提示词层是日语内置预设（语言声明已从预设移除，由内核统一控制）
    expect(content).toContain("内容の進行順に主要な主張・重要事実・必要な背景");
    expect(content).not.toContain("默认使用中文输出");
    // 内核（元数据等）也是日语；档位语义由日语预设文本承担
    expect(content).toContain("【動画情報】");
  });

  it("英文总结模式下内置预设与内核均为英文", () => {
    const userPrompt = builtInPromptFor("builtin-summary-concise", "en");
    const messages = buildTaskPrompt({
      contextPlan: CONTEXT,
      kind: "summary",
      meta: META,
      outputLanguage: "en",
      question: "Start outputting now.",
      rows: ROWS,
      userPrompt,
    });
    const content = messages.map((m) => m.content).join("\n");
    expect(content).toContain("Default output language: English.");
    expect(content).toContain(
      "Extract the most important conclusions, facts and necessary background",
    );
    expect(content).not.toContain("默认使用中文输出");
  });

  it("map/reduce 阶段指令随输出语言切换（不再注入中文）", () => {
    const ja = PROMPT_LANGUAGE_PACKS.ja;
    expect(ja.chunkStageInstruction(1, 3)).toBe(
      "これは字幕の 1/3 番目のチャンクです。このチャンクだけを分析してください。",
    );
    expect(ja.reduceStageInstruction).toBe(
      "チャンクの草稿を統合して、1つの完全な最終結果にしてください。",
    );
    const en = PROMPT_LANGUAGE_PACKS.en;
    expect(en.chunkStageInstruction(2, 4)).toBe(
      "This is subtitle chunk 2/4; analyze only this chunk.",
    );
    expect(en.reduceStageInstruction).toBe(
      "Merge the chunk drafts into one complete final result.",
    );
  });

  it("内置预设不再包含语言声明（语言由内核规则统一控制，auto 时无强制）", () => {
    for (const lang of ["zh-Hans", "zh-Hant", "en", "ja"] as const) {
      const pack = PROMPT_LANGUAGE_PACKS[lang];
      for (const preset of Object.values(pack.builtInPresets)) {
        expect(preset).not.toContain("默认使用中文");
        expect(preset).not.toContain("預設使用繁體中文");
        expect(preset).not.toMatch(/Default output language/);
        expect(preset).not.toContain("デフォルトの出力言語");
      }
    }
    // 分段模式预设随语言切换（内容语言化，但无语言强制句）
    expect(builtInPromptFor("builtin-segments", "zh-Hant")).toContain(
      "廣告僅在證據和邊界均明確時標記",
    );
    expect(builtInPromptFor("builtin-segments", "ja")).toContain(
      "広告は証拠と境界の両方が明確な場合のみマーク",
    );
  });
});
