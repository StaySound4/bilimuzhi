import { describe, expect, it } from "vitest";

import {
  projectActiveChatRunStatus,
  projectChatMessages,
  type ChatMessageProjection,
} from "../../src/application/chat-message-projection";
import { createChatMessage, createGenerationRun } from "../../src/domain";

const SNAPSHOT = Object.freeze({
  contextHash:
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  conversationRevision: 1,
  modelHash:
    "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  promptHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runRevision: 0,
});

const owner = {
  branchId: "branch-b",
  contextRevision: 1,
  expectedOwnerRevision: 1,
  kind: "chat" as const,
  sessionId: "session-b",
  subtitleId: "subtitle-b",
  targetId: "thread-b",
  taskId: "task-b",
};

function message(input: {
  readonly id: string;
  readonly role?: "assistant" | "user";
  readonly content?: string;
  readonly generationRunId?: string | null;
  readonly status?: "complete" | "failed" | "streaming";
}): ReturnType<typeof createChatMessage> {
  return createChatMessage({
    chatThreadId: "thread-b",
    content: input.content ?? (input.role === "user" ? "问题" : ""),
    createdAt: 1,
    generationRunId: input.generationRunId ?? null,
    messageId: input.id,
    order: 0,
    role: input.role ?? "assistant",
    status: input.status ?? "complete",
    updatedAt: 1,
  });
}

function run(input: {
  readonly runId: string;
  readonly status:
    | "queued"
    | "running"
    | "preparing"
    | "requesting"
    | "streaming"
    | "validating"
    | "saving"
    | "stopped"
    | "cancelled"
    | "completed"
    | "interrupted"
    | "failed";
  readonly partialOutput?: string;
  readonly errorCode?: string | null;
  readonly stopReason?: "owner-deleted" | "user" | null;
}): ReturnType<typeof createGenerationRun> {
  return createGenerationRun({
    ...owner,
    ...SNAPSHOT,
    browserSessionId: "browser-session-b",
    completionSequence: input.status === "completed" ? 0 : null,
    createdAt: 1,
    errorCode: input.errorCode ?? null,
    partialOutput: input.partialOutput ?? "",
    runId: input.runId,
    status: input.status,
    stopReason: input.stopReason ?? null,
    updatedAt: 2,
  });
}

const EMPTY = Object.freeze(new Map<string, never>());

function project(
  messages: readonly ReturnType<typeof createChatMessage>[],
  options: {
    readonly activeRun?: ReturnType<typeof createGenerationRun> | null;
    readonly runsByRunId?: ReadonlyMap<
      string,
      ReturnType<typeof createGenerationRun>
    >;
    readonly transientReasoningByRunId?: ReadonlyMap<string, string>;
  } = {},
): readonly ChatMessageProjection[] {
  return projectChatMessages({
    activeRun: options.activeRun ?? null,
    messages,
    runsByRunId: options.runsByRunId ?? EMPTY,
    transientReasoningByRunId: options.transientReasoningByRunId ?? EMPTY,
  });
}

describe("projectChatMessages 状态矩阵（切片 4 冻结契约）", () => {
  it("用户消息保持 complete 且不附加失败或推理投影", () => {
    const user = message({ id: "m-user", content: "问题", role: "user" });
    const [projection] = project([user]);
    expect(projection).toMatchObject({
      content: "问题",
      id: "m-user",
      role: "user",
      status: "complete",
    });
    expect(projection.failure).toBeUndefined();
    expect(projection.incomplete).toBeUndefined();
    expect(projection.reasoning).toBeUndefined();
  });

  it("当前 active run 的非终态消息投影为 streaming", () => {
    const assistant = message({
      content: "正在输出",
      generationRunId: "run-1",
      id: "m-1",
      status: "streaming",
    });
    const activeRun = run({ runId: "run-1", status: "streaming" });
    const [projection] = project([assistant], {
      activeRun,
      runsByRunId: new Map([["run-1", activeRun]]),
    });
    expect(projection.status).toBe("streaming");
    expect(projection.incomplete).toBeUndefined();
    expect(projection.failure).toBeUndefined();
  });

  it("completed run 的消息投影为 complete 且无失败标记", () => {
    const assistant = message({
      content: "完整回答",
      generationRunId: "run-1",
      id: "m-1",
      status: "complete",
    });
    const completedRun = run({
      runId: "run-1",
      status: "completed",
      partialOutput: "完整回答",
    });
    const [projection] = project([assistant], {
      runsByRunId: new Map([["run-1", completedRun]]),
    });
    expect(projection.status).toBe("complete");
    expect(projection.failure).toBeUndefined();
    expect(projection.incomplete).toBeUndefined();
  });

  it("failed run 无部分输出时投影为普通失败（可重试、无 incomplete）", () => {
    const assistant = message({
      generationRunId: "run-1",
      id: "m-1",
      status: "failed",
    });
    const failedRun = run({
      errorCode: "NETWORK_ERROR",
      runId: "run-1",
      status: "failed",
    });
    const [projection] = project([assistant], {
      runsByRunId: new Map([["run-1", failedRun]]),
    });
    expect(projection.status).toBe("failed");
    expect(projection.failure).toMatchObject({
      code: "NETWORK_ERROR",
      incomplete: false,
      retryable: true,
    });
    expect(projection.incomplete).toBe(false);
  });

  it("failed run 有部分输出时保留「不完整」标记", () => {
    const assistant = message({
      content: "写到一半的回答",
      generationRunId: "run-1",
      id: "m-1",
      status: "failed",
    });
    const failedRun = run({
      errorCode: "NETWORK_ERROR",
      partialOutput: "写到一半的回答",
      runId: "run-1",
      status: "failed",
    });
    const [projection] = project([assistant], {
      runsByRunId: new Map([["run-1", failedRun]]),
    });
    expect(projection.status).toBe("failed");
    expect(projection.incomplete).toBe(true);
    expect(projection.failure?.incomplete).toBe(true);
  });

  it("用户停止且有输出时投影为 USER_CANCELLED 且不可重试、保留不完整标记", () => {
    const assistant = message({
      content: "停止前的部分输出",
      generationRunId: "run-1",
      id: "m-1",
      status: "failed",
    });
    const stoppedRun = run({
      partialOutput: "停止前的部分输出",
      runId: "run-1",
      status: "stopped",
      stopReason: "user",
    });
    const [projection] = project([assistant], {
      runsByRunId: new Map([["run-1", stoppedRun]]),
    });
    expect(projection.status).toBe("failed");
    expect(projection.failure).toMatchObject({
      code: "USER_CANCELLED",
      incomplete: true,
      retryable: false,
    });
    expect(projection.incomplete).toBe(true);
  });

  it("后台中断投影为 BACKGROUND_RECOVERY_FAILED 且可重试", () => {
    const assistant = message({
      content: "中断前的输出",
      generationRunId: "run-1",
      id: "m-1",
      status: "failed",
    });
    const interruptedRun = run({
      partialOutput: "中断前的输出",
      runId: "run-1",
      status: "interrupted",
    });
    const [projection] = project([assistant], {
      runsByRunId: new Map([["run-1", interruptedRun]]),
    });
    expect(projection.status).toBe("failed");
    expect(projection.failure).toMatchObject({
      code: "BACKGROUND_RECOVERY_FAILED",
      retryable: true,
    });
  });

  it("孤儿 streaming（run 非终态且非 active）有输出时收口为 complete+incomplete", () => {
    const assistant = message({
      content: "已保留的部分正文",
      generationRunId: "run-1",
      id: "m-1",
      status: "streaming",
    });
    const orphanRun = run({
      partialOutput: "已保留的部分正文",
      runId: "run-1",
      status: "streaming",
    });
    const [projection] = project([assistant], {
      runsByRunId: new Map([["run-1", orphanRun]]),
    });
    expect(projection.status).toBe("complete");
    expect(projection.incomplete).toBe(true);
    expect(projection.failure).toBeUndefined();
  });

  it("孤儿 streaming 无输出时收口为 failed 且可重试", () => {
    const assistant = message({
      generationRunId: "run-1",
      id: "m-1",
      status: "streaming",
    });
    const orphanRun = run({ runId: "run-1", status: "preparing" });
    const [projection] = project([assistant], {
      runsByRunId: new Map([["run-1", orphanRun]]),
    });
    expect(projection.status).toBe("failed");
    expect(projection.failure).toMatchObject({
      code: "BACKGROUND_RECOVERY_FAILED",
      incomplete: false,
      retryable: true,
    });
  });

  it("run 记录缺失的 streaming 消息同样收口（防御旧数据）", () => {
    const withOutput = message({
      content: "有输出",
      generationRunId: "run-gone-1",
      id: "m-1",
      status: "streaming",
    });
    const withoutOutput = message({
      generationRunId: "run-gone-2",
      id: "m-2",
      status: "streaming",
    });
    const [a, b] = project([withOutput, withoutOutput]);
    expect(a.status).toBe("complete");
    expect(a.incomplete).toBe(true);
    expect(b.status).toBe("failed");
    expect(b.failure?.retryable).toBe(true);
  });

  it("非当前 run 的历史失败消息保留自己的失败投影（不依赖 active run）", () => {
    const first = message({
      generationRunId: "run-old",
      id: "m-1",
      status: "failed",
    });
    const second = message({
      generationRunId: "run-active",
      id: "m-2",
      status: "failed",
    });
    const activeRun = run({
      errorCode: "TIMEOUT",
      runId: "run-active",
      status: "failed",
    });
    const oldRun = run({
      errorCode: "RATE_LIMITED",
      runId: "run-old",
      status: "failed",
    });
    const projections = project([first, second], {
      activeRun,
      runsByRunId: new Map([
        ["run-active", activeRun],
        ["run-old", oldRun],
      ]),
    });
    expect(projections[0].failure?.code).toBe("RATE_LIMITED");
    expect(projections[1].failure?.code).toBe("TIMEOUT");
  });

  it("run 记录缺失的历史失败消息保持 failed 且不伪造失败详情", () => {
    const assistant = message({
      generationRunId: "run-gone",
      id: "m-1",
      status: "failed",
    });
    const [projection] = project([assistant]);
    expect(projection.status).toBe("failed");
    expect(projection.failure).toBeUndefined();
    expect(projection.retryable).toBeUndefined();
  });

  it("transient reasoning 只绑定精确 run 的消息，其他 run 的推理不附到当前消息", () => {
    const current = message({
      content: "正文",
      generationRunId: "run-current",
      id: "m-current",
      status: "complete",
    });
    const other = message({
      content: "别轮正文",
      generationRunId: "run-other",
      id: "m-other",
      status: "complete",
    });
    const projections = project([current, other], {
      runsByRunId: new Map([
        [
          "run-current",
          run({
            runId: "run-current",
            status: "completed",
            partialOutput: "正文",
          }),
        ],
        [
          "run-other",
          run({
            runId: "run-other",
            status: "completed",
            partialOutput: "别轮正文",
          }),
        ],
      ]),
      transientReasoningByRunId: new Map([
        ["run-current", "当前轮的思考"],
        ["run-other", "别轮的思考"],
        ["run-ghost", "孤儿推理"],
      ]),
    });
    expect(projections[0].reasoning).toBe("当前轮的思考");
    expect(projections[1].reasoning).toBe("别轮的思考");
  });

  it("用户消息永远不附加推理", () => {
    const user = message({ content: "问题", id: "m-user", role: "user" });
    const [projection] = project([user], {
      transientReasoningByRunId: new Map([["run-1", "推理"] as const]),
    });
    expect(projection.reasoning).toBeUndefined();
  });

  it("followingTurnCount 按轮数递减", () => {
    const messages = [
      message({ id: "m-user-1", role: "user" }),
      message({ id: "m-ai-1" }),
      message({ id: "m-user-2", role: "user" }),
      message({ id: "m-ai-2" }),
      message({ id: "m-user-3", role: "user" }),
      message({ id: "m-ai-3" }),
    ];
    const projections = project(messages);
    expect(projections.map((item) => item.followingTurnCount)).toEqual([
      2, 2, 1, 1, 0, 0,
    ]);
  });
});

describe("projectActiveChatRunStatus", () => {
  it("把 run 状态映射到可停的 ActiveChatGenerationRun 状态", () => {
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "queued" })),
    ).toBe("preparing");
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "preparing" })),
    ).toBe("preparing");
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "running" })),
    ).toBe("requesting");
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "requesting" })),
    ).toBe("requesting");
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "validating" })),
    ).toBe("requesting");
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "saving" })),
    ).toBe("requesting");
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "streaming" })),
    ).toBe("streaming");
  });

  it("终态 run 不可停", () => {
    expect(
      projectActiveChatRunStatus(
        run({ runId: "r", status: "stopped", stopReason: "user" }),
      ),
    ).toBeNull();
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "cancelled" })),
    ).toBeNull();
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "completed" })),
    ).toBeNull();
    expect(
      projectActiveChatRunStatus(run({ runId: "r", status: "interrupted" })),
    ).toBeNull();
    expect(
      projectActiveChatRunStatus(
        run({ runId: "r", status: "failed", errorCode: "TIMEOUT" }),
      ),
    ).toBeNull();
    expect(projectActiveChatRunStatus(null)).toBeNull();
  });
});
