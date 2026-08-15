import { describe, expect, it } from "vitest";

import {
  calculateTrashPurgeAfter,
  createChatMessage,
  createChatThread,
  createGenerationRun,
  createSubtitleBranch,
  createTaskOwner,
  createTrashRetentionPolicy,
} from "../../src/domain";

const owner = {
  branchId: "branch-b",
  contextRevision: 1,
  expectedOwnerRevision: 2,
  kind: "chat" as const,
  sessionId: "session-b",
  subtitleId: "subtitle-b",
  targetId: "thread-b",
  taskId: "task-b",
};

describe("Wave B domain models", () => {
  it("freezes linear chat ownership and permits an empty streaming assistant", () => {
    const thread = createChatThread({
      branchId: "branch-b",
      chatThreadId: "thread-b",
      conversationRevision: 2,
      createdAt: 1,
      order: 0,
      sessionId: "session-b",
      subtitleId: "subtitle-b",
      title: null,
      updatedAt: 1,
    });
    const assistant = createChatMessage({
      chatThreadId: thread.chatThreadId,
      content: "",
      createdAt: 2,
      generationRunId: "run-b",
      messageId: "message-b",
      order: 1,
      role: "assistant",
      status: "streaming",
      updatedAt: 2,
    });

    expect(Object.isFrozen(thread)).toBe(true);
    expect(assistant).toMatchObject({ content: "", status: "streaming" });
    expect(() =>
      createChatMessage({
        ...assistant,
        content: "不能绑定 run 的用户消息",
        generationRunId: "run-b",
        role: "user",
      }),
    ).toThrow(/user messages cannot own/i);
  });

  it("binds generation output to the complete owner and rejects terminal-state contradictions", () => {
    const taskOwner = createTaskOwner(owner);
    const completed = createGenerationRun({
      ...taskOwner,
      browserSessionId: "browser-session-b",
      completionSequence: 3,
      createdAt: 3,
      errorCode: null,
      partialOutput: "完成输出",
      runId: "run-b",
      status: "completed",
      stopReason: null,
      updatedAt: 4,
    });

    expect(completed.completionSequence).toBe(3);
    expect(() =>
      createGenerationRun({ ...completed, completionSequence: null }),
    ).toThrow(/completion sequence/i);
    expect(() =>
      createTaskOwner({ ...owner, taskId: "https://unsafe" }),
    ).toThrow(/safe identifier/i);
  });

  it("models fixed-day and forever trash retention without calendar semantics", () => {
    expect(
      calculateTrashPurgeAfter(1_000, { durationDays: 30, kind: "duration" }),
    ).toBe(1_000 + 30 * 24 * 60 * 60 * 1_000);
    expect(calculateTrashPurgeAfter(1_000, { kind: "forever" })).toBeNull();
    expect(() =>
      createTrashRetentionPolicy({ durationDays: 0, kind: "duration" }),
    ).toThrow(/positive safe integer/i);
  });

  it("backfills zero unread counters for v2 branches and rejects inverted counters", () => {
    const base = {
      activeSubtitleId: "subtitle-b",
      branchId: "branch-b",
      contextRevision: 1,
      createdAt: 1,
      detectedLanguage: null,
      language: "zh-CN",
      lastOpenedAt: 1,
      lastSelectedAt: 1,
      requestedLanguageMode: null,
      sessionId: "session-b",
      source: "bilibili" as const,
      title: null,
      updatedAt: 1,
      videoKey: "bvid:BV1Q541167Qg:cid:30000000001:p:1" as const,
    };
    expect(createSubtitleBranch(base)).toMatchObject({
      completionSequence: 0,
      lastReadCompletionSequence: 0,
    });
    expect(() =>
      createSubtitleBranch({
        ...base,
        completionSequence: 1,
        lastReadCompletionSequence: 2,
      }),
    ).toThrow(/cannot exceed/i);
  });
});
