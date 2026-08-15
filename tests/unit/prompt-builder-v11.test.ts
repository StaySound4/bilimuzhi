import { describe, expect, it } from "vitest";

import {
  buildTaskPrompt,
  type BuildPromptInput,
} from "../../src/application/ai/prompt-builder";
import type { SubtitleContextPlan } from "../../src/application/ai/context-plan";

const rows = [
  { endMs: 5_000, startMs: 0, text: "SUBTITLE_MARKER 第一条字幕" },
  { endMs: 10_000, startMs: 5_000, text: "第二条字幕" },
] as const;

const contextPlan: SubtitleContextPlan = {
  characterBudget: 1_000,
  chunks: [
    {
      endMs: 10_000,
      rowIndexes: [0, 1],
      startMs: 0,
      text: rows.map((row) => row.text).join("\n"),
    },
  ],
  explanation: "complete test context",
  strategy: "full",
};

function summaryInput(userPrompt = "CONTROL_MARKER"): BuildPromptInput {
  return {
    contextPlan,
    kind: "summary",
    meta: {
      bvid: "BV1Q541167Qg",
      durationSec: 10,
      title: "META_MARKER",
    },
    rows,
    userPrompt,
  } as BuildPromptInput;
}

describe("v11 prompt builder", () => {
  it("keeps four trusted layers ordered before metadata and the final untrusted reference", () => {
    const messages = buildTaskPrompt({
      contextPlan,
      kind: "chat",
      meta: {
        bvid: "BV1Q541167Qg",
        durationSec: 10,
        title: "META_MARKER",
      },
      question: "REQUEST_MARKER",
      rows,
      userPrompt: "CONTROL_MARKER",
    });
    const indexOf = (marker: string) =>
      messages.findIndex((message) => message.content.includes(marker));
    const indexes = [
      indexOf("不可信数据"),
      indexOf("内置定位与链接规则"),
      indexOf("CONTROL_MARKER"),
      indexOf("REQUEST_MARKER"),
      indexOf("META_MARKER"),
      indexOf("SUBTITLE_MARKER"),
    ];

    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(new Set(indexes).size).toBe(indexes.length);
    expect(indexes.at(-1)).toBe(messages.length - 1);
    expect(messages.at(-1)?.content).toContain(
      "<untrusted_subtitle_reference>",
    );
  });

  it("要求每个段落或标题最多一个时间标记，并用范围表达段落跨度", () => {
    const contract = buildTaskPrompt(summaryInput())
      .map((message) => message.content)
      .join("\n");

    expect(contract).toContain("每个段落或标题最多放一个时间标记");
    expect(contract).toContain("hh:mm:ss");
    expect(contract).toContain("00:05:38–00:06:45");
  });
  it("keeps the user-controlled preset as the only source of summary detail semantics", () => {
    const concise = buildTaskPrompt(
      summaryInput("【总结档位：简要】只输出核心观点。"),
    )
      .map((message) => message.content)
      .join("\n");
    const balanced = buildTaskPrompt(
      summaryInput("【总结档位：平衡】充分解释重要内容。"),
    )
      .map((message) => message.content)
      .join("\n");
    const detailed = buildTaskPrompt(
      summaryInput("【总结档位：详细】完整覆盖全部内容。"),
    )
      .map((message) => message.content)
      .join("\n");

    expect(concise).toContain("【用户控制提示词预设】");
    expect(concise).toContain("只输出核心观点");
    expect(balanced).toContain("充分解释重要内容");
    expect(detailed).toContain("完整覆盖全部内容");
    expect(new Set([concise, balanced, detailed]).size).toBe(3);
    // 内核层不再注入与预设并行的固定档位规则：档位语义只出现一次。
    expect(concise).not.toContain("总结档位：平衡");
    expect(balanced.match(/总结档位：/gu)).toHaveLength(1);
  });

  it.each(["chat", "summary", "segments"] as const)(
    "applies the v12 trusted-layer and user-control boundary to %s requests",
    (kind) => {
      const messages = buildTaskPrompt({
        contextPlan,
        kind,
        meta: {
          bvid: "BV1Q541167Qg",
          durationSec: 10,
          title: "TRUSTED_METADATA_MARKER",
        },
        question: "ONE_SHOT_REQUEST_MARKER",
        rows,
        userPrompt: "CONTROL_PRESET_MARKER",
      });
      const flattened = messages.map((message) => message.content);
      const indexOf = (marker: string) =>
        flattened.findIndex((content) => content.includes(marker));
      const builtInMarker =
        kind === "chat"
          ? "内置定位与链接规则"
          : kind === "summary"
            ? "内置定位与链接规则"
            : "内置输出格式";
      const orderedIndexes = [
        indexOf("不可信数据"),
        indexOf(builtInMarker),
        ...(kind === "segments" ? [] : [indexOf("CONTROL_PRESET_MARKER")]),
        indexOf("ONE_SHOT_REQUEST_MARKER"),
        indexOf("TRUSTED_METADATA_MARKER"),
        indexOf("SUBTITLE_MARKER"),
      ];

      if (kind === "segments") {
        const contract = flattened.join("\n");
        expect(contract).not.toContain("CONTROL_PRESET_MARKER");
        expect(contract).toContain("[hh:mm:ss-hh:mm:ss] 标题");
        expect(contract).toContain("只输出分段列表");
        expect(contract).toMatch(/商业恰饭|广告|推广|赞助|带货/);
      }
      expect(orderedIndexes.every((index) => index >= 0)).toBe(true);
      expect(orderedIndexes).toEqual(
        [...orderedIndexes].sort((left, right) => left - right),
      );
      expect(new Set(orderedIndexes).size).toBe(orderedIndexes.length);
      expect(orderedIndexes.at(-1)).toBe(messages.length - 1);
      expect(messages.at(-1)?.content).toMatch(
        /^<untrusted_subtitle_reference>[\s\S]*<\/untrusted_subtitle_reference>$/,
      );
    },
  );

  it("requires every important summary fact to carry a nearby verifiable time link", () => {
    const contract = buildTaskPrompt(summaryInput())
      .map((message) => message.content)
      .join("\n");

    expect(contract).toMatch(
      /每个重要(?:观点|事实)[\s\S]{0,80}(?:就近|附近)[\s\S]{0,80}(?:可验证|真实)[\s\S]{0,80}(?:时间链接|跳转链接)/,
    );
    expect(contract).toContain("BV1Q541167Qg");
  });
});
