import { describe, expect, it } from "vitest";

import { createLinearChatTruncationPlan } from "../../src/application/chat-truncation-contract";
import { createChatMessage, createChatThread } from "../../src/domain";

const thread = createChatThread({
  branchId: "branch-b",
  chatThreadId: "thread-b",
  conversationRevision: 6,
  createdAt: 1,
  order: 0,
  sessionId: "session-b",
  subtitleId: "subtitle-b",
  title: null,
  updatedAt: 1,
});

function message(input: {
  readonly generationRunId?: string | null;
  readonly id: string;
  readonly order: number;
  readonly role: "assistant" | "user";
}) {
  return createChatMessage({
    chatThreadId: thread.chatThreadId,
    content: input.role === "user" ? "用户问题" : "回答",
    createdAt: input.order + 1,
    generationRunId: input.generationRunId ?? null,
    messageId: input.id,
    order: input.order,
    role: input.role,
    status: "complete",
    updatedAt: input.order + 1,
  });
}

describe("linear chat truncation contract", () => {
  it("replaces an assistant branch by deleting it and every later turn", () => {
    const plan = createLinearChatTruncationPlan(
      thread,
      [
        message({ id: "user-1", order: 0, role: "user" }),
        message({
          generationRunId: "run-1",
          id: "assistant-1",
          order: 1,
          role: "assistant",
        }),
        message({ id: "user-2", order: 2, role: "user" }),
        message({
          generationRunId: "run-2",
          id: "assistant-2",
          order: 3,
          role: "assistant",
        }),
      ],
      "assistant-1",
      "regenerate-assistant",
    );

    expect(plan).toEqual({
      cancelledGenerationRunIds: ["run-1", "run-2"],
      chatThreadId: "thread-b",
      deletedMessageIds: ["assistant-1", "user-2", "assistant-2"],
      intent: "regenerate-assistant",
      nextConversationRevision: 7,
      targetMessageId: "assistant-1",
    });
  });

  it("rejects target-role confusion and non-linear message orders", () => {
    expect(() =>
      createLinearChatTruncationPlan(
        thread,
        [message({ id: "user-1", order: 0, role: "user" })],
        "user-1",
        "regenerate-assistant",
      ),
    ).toThrow(/does not match/i);
    expect(() =>
      createLinearChatTruncationPlan(
        thread,
        [
          message({ id: "user-1", order: 0, role: "user" }),
          message({ id: "user-2", order: 0, role: "user" }),
        ],
        "user-1",
        "edit-user",
      ),
    ).toThrow(/not linear/i);
  });
});
