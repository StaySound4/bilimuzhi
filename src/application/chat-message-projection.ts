/**
 * 聊天消息投影：把持久消息、GenerationRun、transient reasoning 投影为
 * 稳定的对话 UI 数据（切片 4 冻结契约，见
 * `.scratch/muzhi-v15-stepwise-rework/wayfinder/01-step4-chat-contract.md`）。
 *
 * 组合根（sidepanel）不得再临时拼接 failure/incomplete/retryable 到消息；
 * 本模块是这些投影状态的唯一 selector。
 */
import type { ChatMessage, GenerationRun } from "../domain";
import {
  generationFailureFor,
  type GenerationFailurePresentation,
} from "./generation-runtime-contract";

/** 可停的对话 run 状态（与 UI ActiveChatGenerationRun.status 一致）。 */
export type ChatActiveRunStatus = "preparing" | "requesting" | "streaming";

export interface ChatMessageProjectionInput {
  /** 内存中唯一可停/可展示的 run；重载后为 null。 */
  readonly activeRun: GenerationRun | null;
  readonly messages: readonly ChatMessage[];
  /** 持久化 run 状态（含历史失败消息所属 run）。 */
  readonly runsByRunId: ReadonlyMap<string, GenerationRun>;
  /** transient reasoning（内存态，重载后为空）。 */
  readonly transientReasoningByRunId: ReadonlyMap<string, string>;
}

export interface ChatMessageProjection {
  readonly id: string;
  readonly role: ChatMessage["role"];
  readonly content: string;
  /** 该消息之后剩余的对话轮数（编辑/重新生成的截断确认用）。 */
  readonly followingTurnCount: number;
  readonly reasoning?: string;
  readonly retryable?: boolean;
  readonly failure?: GenerationFailurePresentation;
  readonly incomplete?: boolean;
  readonly status: "complete" | "failed" | "streaming";
}

/** 终态 run 集合：不参与「当前流式」判定。 */
const TERMINAL_RUN_STATUSES = new Set<GenerationRun["status"]>([
  "stopped",
  "cancelled",
  "completed",
  "interrupted",
  "failed",
]);

function hasVisibleOutput(
  content: string,
  reasoning: string | undefined,
): boolean {
  return content.trim().length > 0 || Boolean(reasoning?.trim());
}

/**
 * 孤儿流式收口：run 非终态但已无执行器（Side Panel 重载/后台中断残留）。
 * 冻结契约：有输出 → 收口为带「不完整」标记的普通消息；无输出 → 失败可重试。
 */
function projectOrphan(
  content: string,
  reasoning: string | undefined,
): Pick<
  ChatMessageProjection,
  "failure" | "incomplete" | "retryable" | "status"
> {
  if (hasVisibleOutput(content, reasoning)) {
    return Object.freeze({
      incomplete: true,
      status: "complete" as const,
    });
  }
  const failure = generationFailureFor({
    errorCode: null,
    hasPartialOutput: false,
    hasPreviousArtifact: false,
    kind: "chat",
    status: "interrupted",
  });
  return Object.freeze({
    failure: failure ?? undefined,
    incomplete: failure?.incomplete,
    retryable: failure?.retryable,
    status: "failed" as const,
  });
}

function projectAssistant(
  message: ChatMessage,
  run: GenerationRun | undefined,
  activeRun: GenerationRun | null,
  reasoning: string | undefined,
): Pick<
  ChatMessageProjection,
  "failure" | "incomplete" | "reasoning" | "retryable" | "status"
> {
  const base = {
    reasoning: reasoning?.trim() ? reasoning : undefined,
  };
  if (run === undefined) {
    // run 记录缺失（旧数据/防御）：按消息自身状态投影；残留 streaming 收口。
    if (message.status === "streaming") {
      return Object.freeze({
        ...base,
        ...projectOrphan(message.content, base.reasoning),
      });
    }
    return Object.freeze({
      ...base,
      status: message.status,
    });
  }
  if (!TERMINAL_RUN_STATUSES.has(run.status)) {
    if (run.runId === activeRun?.runId) {
      // 当前唯一可停 run：正常流式投影。
      return Object.freeze({ ...base, status: "streaming" });
    }
    // 孤儿流式（重载/后台残留）：立即收口，不再保留「正在生成」外观。
    return Object.freeze({
      ...base,
      ...projectOrphan(message.content, base.reasoning),
    });
  }
  if (run.status === "completed") {
    return Object.freeze({ ...base, status: "complete" });
  }
  const failure = generationFailureFor({
    errorCode: run.errorCode,
    hasPartialOutput: run.partialOutput.length > 0,
    hasPreviousArtifact: false,
    kind: "chat",
    status: run.status,
  });
  return Object.freeze({
    ...base,
    failure: failure ?? undefined,
    incomplete: failure?.incomplete,
    retryable: failure?.retryable,
    status: "failed",
  });
}

/**
 * 投影完整消息列表。输入顺序即对话顺序；输出保持同顺序。
 */
export function projectChatMessages(
  input: ChatMessageProjectionInput,
): readonly ChatMessageProjection[] {
  const count = input.messages.length;
  return Object.freeze(
    input.messages.map((message, index) => {
      const followingTurnCount = Math.floor((count - index - 1) / 2);
      const run =
        message.generationRunId === null
          ? undefined
          : input.runsByRunId.get(message.generationRunId);
      const reasoning =
        message.generationRunId === null
          ? undefined
          : input.transientReasoningByRunId.get(message.generationRunId);
      if (message.role === "user") {
        return Object.freeze({
          content: message.content,
          followingTurnCount,
          id: message.messageId,
          role: "user" as const,
          status: "complete" as const,
        });
      }
      return Object.freeze({
        content: message.content,
        followingTurnCount,
        id: message.messageId,
        role: "assistant" as const,
        ...projectAssistant(message, run, input.activeRun, reasoning),
      });
    }),
  );
}

/**
 * run 状态 → 可停状态映射。停止按钮的唯一权威是内存 run：
 * 只有映射结果非 null 时组合根才构造 ActiveChatGenerationRun。
 */
export function projectActiveChatRunStatus(
  run: GenerationRun | null,
): ChatActiveRunStatus | null {
  if (run === null) return null;
  switch (run.status) {
    case "queued":
    case "preparing":
      return "preparing";
    case "running":
    case "requesting":
    case "validating":
    case "saving":
      return "requesting";
    case "streaming":
      return "streaming";
    default:
      return null;
  }
}
