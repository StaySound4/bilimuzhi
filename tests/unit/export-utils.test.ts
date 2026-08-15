import { describe, expect, it } from "vitest";

import {
  artifactMarkdown,
  chatThreadMarkdown,
} from "../../src/ui/export-utils";
import type { Artifact, ChatMessage } from "../../src/domain";

describe("artifactMarkdown", () => {
  it("renders a summary artifact as a plain heading plus content", () => {
    const artifact: Artifact = {
      artifactId: "a1",
      kind: "summary",
      sessionId: "s1",
      branchId: "b1",
      subtitleId: "sub1",
      contextRevision: 1,
      artifactRevision: 1,
      status: "ready",
      content: "核心结论",
      segments: [],
      modelId: null,
      errorCode: null,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(artifactMarkdown(artifact, "测试视频")).toBe(
      "# 测试视频 · 总结\n\n核心结论\n",
    );
  });

  it("renders a segments artifact with clock ranges for each validated segment", () => {
    const artifact: Artifact = {
      artifactId: "a2",
      kind: "segments",
      sessionId: "s1",
      branchId: "b1",
      subtitleId: "sub1",
      contextRevision: 1,
      artifactRevision: 1,
      status: "ready",
      content: "",
      modelId: "m",
      errorCode: null,
      segments: [
        {
          startMs: 0,
          endMs: 65_000,
          title: "开头",
          detail: "介绍",
          isAdvertisement: false,
        },
        {
          startMs: 3_600_000,
          endMs: 3_661_000,
          title: "高潮",
          detail: "冲突",
          isAdvertisement: true,
        },
      ],
      createdAt: 1,
      updatedAt: 2,
    };
    const output = artifactMarkdown(artifact, "测试视频");
    expect(output).toContain("# 测试视频 · 分段");
    expect(output).toContain("## [00:00:00 - 00:01:05] 开头");
    expect(output).toContain("## [01:00:00 - 01:01:01] 高潮");
    expect(output).toContain("介绍");
  });

  it("renders a segments artifact with an empty segment list as plain content", () => {
    const artifact: Artifact = {
      artifactId: "a3",
      kind: "segments",
      sessionId: "s1",
      branchId: "b1",
      subtitleId: "sub1",
      contextRevision: 1,
      artifactRevision: 1,
      status: "ready",
      content: "没有卡片时的正文",
      segments: [],
      modelId: null,
      errorCode: null,
      createdAt: 1,
      updatedAt: 2,
    };
    expect(artifactMarkdown(artifact, "测试视频")).toBe(
      "# 测试视频 · 分段\n\n没有卡片时的正文\n",
    );
  });
});

describe("chatThreadMarkdown", () => {
  it("labels user and assistant turns with stable role markers", () => {
    const messages: readonly ChatMessage[] = [
      {
        messageId: "m1",
        chatThreadId: "t1",
        role: "user",
        status: "complete",
        content: "问题",
        order: 0,
        generationRunId: null,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        messageId: "m2",
        chatThreadId: "t1",
        role: "assistant",
        status: "complete",
        content: "回答",
        order: 1,
        generationRunId: "r1",
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    const output = chatThreadMarkdown("我的对话", messages);
    expect(output).toBe("# 我的对话\n\n\n\n## 用户\n\n问题\n\n## Bilimuzhi\n\n回答");
  });

  it("joins multiple turns in creation order", () => {
    const messages: readonly ChatMessage[] = [
      {
        messageId: "m1",
        chatThreadId: "t1",
        role: "user",
        status: "complete",
        content: "一",
        order: 0,
        generationRunId: null,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        messageId: "m2",
        chatThreadId: "t1",
        role: "assistant",
        status: "complete",
        content: "二",
        order: 1,
        generationRunId: "r1",
        createdAt: 2,
        updatedAt: 2,
      },
      {
        messageId: "m3",
        chatThreadId: "t1",
        role: "user",
        status: "complete",
        content: "三",
        order: 2,
        generationRunId: null,
        createdAt: 3,
        updatedAt: 3,
      },
    ];
    const output = chatThreadMarkdown("t", messages);
    expect(output.indexOf("一")).toBeLessThan(output.indexOf("二"));
    expect(output.indexOf("二")).toBeLessThan(output.indexOf("三"));
  });
});
