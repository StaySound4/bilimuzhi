import { describe, expect, it } from "vitest";

import {
  buildTaskPrompt,
  type BuildPromptInput,
} from "../../src/application/ai/prompt-builder";
import type { SubtitleContextPlan } from "../../src/application/ai/context-plan";

const rows = [{ endMs: 5_000, startMs: 0, text: "SUBTITLE_MARKER 第一条字幕" }];

const contextPlan: SubtitleContextPlan = {
  characterBudget: 1_000,
  chunks: [
    {
      endMs: 5_000,
      rowIndexes: [0],
      startMs: 0,
      text: "SUBTITLE_MARKER 第一条字幕",
    },
  ],
  explanation: "test",
  strategy: "full",
};

function baseInput(
  overrides: Partial<BuildPromptInput> = {},
): BuildPromptInput {
  return {
    contextPlan,
    kind: "summary",
    meta: { bvid: "BV1xx411c7mD", durationSec: 5, title: "TITLE_MARKER" },
    rows,
    ...overrides,
  };
}

describe("输出语言指令与内核语言化（docs/i18n-spec.md §5）", () => {
  it("未设置 outputLanguage 时不注入语言规则，内核回退 zh-Hans", () => {
    const messages = buildTaskPrompt(baseInput());
    const content = messages.map((m) => m.content).join("\n");
    expect(content).not.toContain("输出默认语言");
    // 内核仍为简体中文（角色行 + 内置规则）。
    expect(content).toContain("你是一个视频内容总结助手");
  });

  it("设置日语时内核整体日文化并注入语言规则", () => {
    const messages = buildTaskPrompt(baseInput({ outputLanguage: "ja" }));
    const content = messages.map((m) => m.content).join("\n");
    // 语言规则随语言包使用目标语言书写。
    expect(content).toContain(
      "出力は必ず日本語で書くこと。出力は必ず日本語で書くこと。出力は必ず日本語で書くこと。",
    );
    // 内核整体日文化：角色行、系统规则、元数据（档位语义由预设层承担）。
    expect(content).toContain("あなたは動画内容の要約アシスタントです");
    expect(content).toContain("信頼されたシステムとユーザーの意図");
    expect(content).toContain("【動画情報】");
    // 字幕参考保持原文（事实数据不翻译）。
    expect(content).toContain("SUBTITLE_MARKER 第一条字幕");
  });

  it("设置英语时内核整体英文化", () => {
    const messages = buildTaskPrompt(baseInput({ outputLanguage: "en" }));
    const content = messages.map((m) => m.content).join("\n");
    expect(content).toContain("Default output language: English");
    expect(content).toContain("You are a video content summary assistant");
    expect(content).toContain("【Video info】");
  });

  it("三个模式（chat/segments/summary）均注入对应语言的内核", () => {
    for (const kind of ["chat", "segments", "summary"] as const) {
      const messages = buildTaskPrompt(
        baseInput({ kind, outputLanguage: "zh-Hant" }),
      );
      const content = messages.map((m) => m.content).join("\n");
      expect(content).toContain("輸出預設語言：繁體中文");
      expect(content).toContain("你是一個");
      if (kind === "segments") {
        expect(content).toContain("分段列表");
      }
      if (kind === "summary") {
        // 档位语义由用户预设层承担；内核注入时间链接义务。
        expect(content).toContain("每個重要觀點或事實");
      }
    }
  });
});
