import { describe, expect, it } from "vitest";

import type { SubtitleContextPlan } from "../../src/application/ai/context-plan";
import {
  buildTaskPrompt,
  type BuildPromptInput,
} from "../../src/application/ai/prompt-builder";
import {
  canApplyGenerationRuntimeEvent,
  isGenerationRunNonTerminal,
  type GenerationRuntimeEvent,
} from "../../src/application/generation-runtime-contract";
import {
  createGenerationRun,
  type GenerationRun,
  type TaskOwner,
} from "../../src/domain";

const rows = [
  { endMs: 5_000, lineId: "line-1", startMs: 0, text: "开场事实" },
  { endMs: 10_000, lineId: "line-2", startMs: 5_000, text: "结尾事实" },
] as const;

const contextPlan: SubtitleContextPlan = {
  characterBudget: 1_000,
  chunks: [
    {
      endMs: 10_000,
      rowIndexes: [0, 1],
      startMs: 0,
      text: "开场事实\n结尾事实",
    },
  ],
  explanation: "v12 contract fixture",
  strategy: "full",
};

const owner: TaskOwner = {
  branchId: "branch-v12",
  contextRevision: 4,
  expectedOwnerRevision: 9,
  kind: "summary",
  sessionId: "session-v12",
  subtitleId: "subtitle-v12",
  targetId: "artifact-v12",
  taskId: "task-v12",
};

function promptInput(
  overrides: Partial<BuildPromptInput> = {},
): BuildPromptInput {
  return {
    contextPlan,
    kind: "summary",
    meta: { bvid: "BV1Q541167Qg", durationSec: 10, title: "V12 视频" },
    question: "请总结",
    rows,
    userPrompt: null,
    ...overrides,
  };
}

function run(status: GenerationRun["status"]): GenerationRun {
  return createGenerationRun({
    ...owner,
    browserSessionId: "browser-v12",
    completionSequence: status === "completed" ? 1 : null,
    contextHash: `sha256:${"c".repeat(64)}`,
    conversationRevision: 9,
    createdAt: 1,
    errorCode: status === "failed" ? "NETWORK_ERROR" : null,
    modelHash: `sha256:${"b".repeat(64)}`,
    partialOutput: "已确认的部分输出",
    promptHash: `sha256:${"a".repeat(64)}`,
    runId: "run-v12",
    runRevision: 2,
    status,
    stopReason: status === "stopped" ? "user" : null,
    updatedAt: 2,
  });
}

function delta(
  overrides: Partial<GenerationRuntimeEvent> = {},
): GenerationRuntimeEvent {
  return {
    ...owner,
    contextHash: `sha256:${"c".repeat(64)}`,
    conversationRevision: 9,
    modelHash: `sha256:${"b".repeat(64)}`,
    payload: { delta: "迟到 token" },
    promptHash: `sha256:${"a".repeat(64)}`,
    protocolVersion: 1,
    requestId: "request-v12",
    runRevision: 2,
    type: "muzhi.generation.delta",
    ...overrides,
  } as GenerationRuntimeEvent;
}

describe("v12 prompt and generation contract", () => {
  it("keeps summary detail semantics exclusively in the user-controlled preset layer", () => {
    const defaultContract = buildTaskPrompt(promptInput())
      .map((message) => message.content)
      .join("\n");
    const conciseContract = buildTaskPrompt(
      promptInput({ userPrompt: "【总结档位：简要】只输出核心观点。" }),
    )
      .map((message) => message.content)
      .join("\n");
    const balancedContract = buildTaskPrompt(
      promptInput({ userPrompt: "【总结档位：平衡】充分解释重要内容。" }),
    )
      .map((message) => message.content)
      .join("\n");
    const detailedContract = buildTaskPrompt(
      promptInput({ userPrompt: "【总结档位：详细】完整覆盖全部内容。" }),
    )
      .map((message) => message.content)
      .join("\n");

    expect(defaultContract).not.toContain("总结档位：");
    expect(conciseContract).toContain("总结档位：简要");
    expect(balancedContract).toContain("总结档位：平衡");
    expect(detailedContract).toContain("总结档位：详细");
    expect(
      new Set([conciseContract, balancedContract, detailedContract]).size,
    ).toBe(3);
    // 档位规则不会重复注入：每个契约中「总结档位」只出现一次。
    expect(conciseContract.match(/总结档位：/gu)).toHaveLength(1);
    expect(balancedContract.match(/总结档位：/gu)).toHaveLength(1);
  });

  it("never gives the fixed segment protocol a user-controlled prompt channel", () => {
    const messages = buildTaskPrompt(
      promptInput({ kind: "segments", userPrompt: "USER_SEGMENT_OVERRIDE" }),
    );

    expect(messages.map((message) => message.content).join("\n")).not.toContain(
      "USER_SEGMENT_OVERRIDE",
    );
  });

  it("treats every declared generation execution phase as non-terminal", () => {
    expect(
      [
        "queued",
        "running",
        "preparing",
        "requesting",
        "streaming",
        "validating",
        "saving",
      ].every((status) =>
        isGenerationRunNonTerminal(status as GenerationRun["status"]),
      ),
    ).toBe(true);
  });

  it("preserves partial output on interruption and rejects a late event from a changed revision/hash", () => {
    const interrupted = run("interrupted");
    expect(interrupted.partialOutput).toBe("已确认的部分输出");
    expect(canApplyGenerationRuntimeEvent(interrupted, delta())).toBe(false);
    expect(
      canApplyGenerationRuntimeEvent(
        run("streaming"),
        delta({ runRevision: 3 }),
      ),
    ).toBe(false);
  });
});
