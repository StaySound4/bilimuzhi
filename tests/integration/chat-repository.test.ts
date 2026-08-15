import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  createChatMessage,
  createChatThread,
  createGenerationRun,
  createSubtitleSnapshot,
  createVideoRef,
  type TaskOwner,
} from "../../src/domain";
import { IndexedDbChatRepository } from "../../src/infrastructure/indexeddb/chat-repository";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-chat-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

async function createFixture() {
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: createDatabaseName(),
  });
  const video = createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=3",
    cid: 30_000_000_003,
    page: 3,
    title: "chat repository",
  });
  const session = await new IndexedDbSessionRepository(database, {
    createSessionId: () => "chat-session",
    now: () => 100,
  }).create(video);
  const acquisition = {
    acquisitionId: "chat-acquisition",
    draftBranchId: "chat-branch",
    expectedContextRevision: 1,
    expectedSelectionRevision: 0,
    sessionId: session.sessionId,
    taskId: "chat-acquisition-task",
    videoKey: video.videoKey,
  };
  const subtitles = new IndexedDbSubtitleRepository(database, {
    now: () => 200,
  });
  await subtitles.beginAcquisition(acquisition, {
    method: "direct",
    trackId: "official:zh:1",
  });
  await subtitles.commitAcquisition(
    acquisition,
    createSubtitleSnapshot({
      branchId: acquisition.draftBranchId,
      contentHash: "sha256:chat",
      createdAt: 200,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "chat" }],
      sessionId: acquisition.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "chat-subtitle",
      videoKey: acquisition.videoKey,
    }),
  );
  const thread = createChatThread({
    branchId: acquisition.draftBranchId,
    chatThreadId: "chat-thread",
    conversationRevision: 0,
    createdAt: 300,
    order: 0,
    sessionId: acquisition.sessionId,
    subtitleId: "chat-subtitle",
    title: null,
    updatedAt: 300,
  });
  const repository = new IndexedDbChatRepository(database, { now: () => 500 });
  await repository.createThread(thread);
  return { database, repository, thread };
}

function message(
  threadId: string,
  input: {
    readonly id: string;
    readonly order: number;
    readonly role: "assistant" | "user";
    readonly content: string;
    readonly generationRunId?: string | null;
    readonly status?: "complete" | "failed" | "streaming";
  },
) {
  return createChatMessage({
    chatThreadId: threadId,
    content: input.content,
    createdAt: 400 + input.order,
    generationRunId: input.generationRunId ?? null,
    messageId: input.id,
    order: input.order,
    role: input.role,
    status: input.status ?? "complete",
    updatedAt: 400 + input.order,
  });
}

describe("IndexedDbChatRepository", () => {
  it("creates, lists, renames, and appends a linear thread", async () => {
    const { database, repository, thread } = await createFixture();
    try {
      await repository.appendMessage(
        message(thread.chatThreadId, {
          content: "问题",
          id: "message-user",
          order: 0,
          role: "user",
        }),
      );
      await repository.appendMessage(
        message(thread.chatThreadId, {
          content: "回答",
          id: "message-assistant",
          order: 1,
          role: "assistant",
        }),
      );
      await expect(repository.listThreads(thread)).resolves.toEqual([
        expect.objectContaining({ chatThreadId: thread.chatThreadId }),
      ]);
      await expect(
        repository.renameThread(thread.chatThreadId, "课程问题"),
      ).resolves.toMatchObject({ title: "课程问题", updatedAt: 500 });
      await expect(
        repository.listMessages(thread.chatThreadId),
      ).resolves.toEqual([
        expect.objectContaining({ messageId: "message-user", order: 0 }),
        expect.objectContaining({ messageId: "message-assistant", order: 1 }),
      ]);
    } finally {
      database.close();
    }
  });

  it("atomically appends a generated turn and rejects stale run mirrors", async () => {
    const { database, repository, thread } = await createFixture();
    const owner: TaskOwner = {
      branchId: thread.branchId,
      contextRevision: 1,
      expectedOwnerRevision: 0,
      kind: "chat",
      sessionId: thread.sessionId,
      subtitleId: thread.subtitleId,
      targetId: thread.chatThreadId,
      taskId: "stream-task",
    };
    try {
      const queued = createGenerationRun({
        ...owner,
        browserSessionId: "browser-stream",
        completionSequence: null,
        createdAt: 400,
        errorCode: null,
        partialOutput: "",
        runId: "stream-run",
        status: "queued",
        stopReason: null,
        updatedAt: 400,
      });
      const seed = database.transaction("generationRuns", "readwrite");
      seed.objectStore("generationRuns").put(queued);
      await transactionDone(seed);

      await expect(
        repository.appendTurn(
          message(thread.chatThreadId, {
            content: "问题",
            id: "stream-user",
            order: 0,
            role: "user",
          }),
          message(thread.chatThreadId, {
            content: "",
            generationRunId: queued.runId,
            id: "stream-assistant",
            order: 1,
            role: "assistant",
            status: "streaming",
          }),
        ),
      ).resolves.toHaveLength(2);

      const running = createGenerationRun({
        ...queued,
        partialOutput: "可见正文",
        status: "running",
        updatedAt: 401,
      });
      const update = database.transaction("generationRuns", "readwrite");
      update.objectStore("generationRuns").put(running);
      await transactionDone(update);

      await expect(repository.applyAssistantRun(queued)).resolves.toBeNull();
      await expect(
        repository.applyAssistantRun(running),
      ).resolves.toMatchObject({
        content: "可见正文",
        status: "streaming",
      });
      await expect(
        repository.listMessages(thread.chatThreadId),
      ).resolves.toEqual([
        expect.objectContaining({ messageId: "stream-user" }),
        expect.objectContaining({
          content: "可见正文",
          messageId: "stream-assistant",
        }),
      ]);
    } finally {
      database.close();
    }
  });

  it("atomically edits and resends a user message, cascading later attachments and generation runs", async () => {
    const { database, repository, thread } = await createFixture();
    const owner: TaskOwner = {
      branchId: thread.branchId,
      contextRevision: 1,
      expectedOwnerRevision: 0,
      kind: "chat",
      sessionId: thread.sessionId,
      subtitleId: thread.subtitleId,
      targetId: thread.chatThreadId,
      taskId: "chat-run-task",
    };
    try {
      const messages = [
        message(thread.chatThreadId, {
          content: "第一问",
          id: "message-0",
          order: 0,
          role: "user",
        }),
        message(thread.chatThreadId, {
          content: "第一答",
          generationRunId: "run-complete",
          id: "message-1",
          order: 1,
          role: "assistant",
        }),
        message(thread.chatThreadId, {
          content: "旧问题",
          id: "message-2",
          order: 2,
          role: "user",
        }),
        message(thread.chatThreadId, {
          content: "生成中",
          generationRunId: "run-late",
          id: "message-3",
          order: 3,
          role: "assistant",
          status: "streaming",
        }),
      ];
      for (const value of messages) await repository.appendMessage(value);
      const seed = database.transaction(
        ["attachments", "generationRuns"],
        "readwrite",
      );
      seed.objectStore("attachments").put({
        attachmentId: "attachment-late",
        branchId: thread.branchId,
        messageId: "message-3",
        sessionId: thread.sessionId,
      });
      seed.objectStore("generationRuns").put(
        createGenerationRun({
          ...owner,
          browserSessionId: "browser-a",
          completionSequence: 1,
          createdAt: 401,
          errorCode: null,
          partialOutput: "第一答",
          runId: "run-complete",
          status: "completed",
          stopReason: null,
          updatedAt: 401,
        }),
      );
      seed.objectStore("generationRuns").put(
        createGenerationRun({
          ...owner,
          browserSessionId: "browser-a",
          completionSequence: null,
          createdAt: 403,
          errorCode: null,
          partialOutput: "生成中",
          runId: "run-late",
          status: "running",
          stopReason: null,
          taskId: "chat-run-task-late",
          updatedAt: 403,
        }),
      );
      await transactionDone(seed);

      await expect(
        repository.truncate({
          chatThreadId: thread.chatThreadId,
          editedContent: "新问题",
          expectedConversationRevision: 0,
          intent: "edit-user",
          targetMessageId: "message-2",
        }),
      ).resolves.toMatchObject({
        cancelledRuns: [expect.objectContaining({ runId: "run-late" })],
        deletedMessageIds: ["message-2", "message-3"],
        replacementMessage: {
          content: "新问题",
          generationRunId: null,
          messageId: "message-2",
          status: "complete",
        },
        thread: { conversationRevision: 1 },
      });
      await expect(
        repository.listMessages(thread.chatThreadId),
      ).resolves.toEqual([
        expect.objectContaining({ messageId: "message-0" }),
        expect.objectContaining({ messageId: "message-1" }),
        expect.objectContaining({ content: "新问题", messageId: "message-2" }),
      ]);

      const read = database.transaction(
        ["attachments", "generationRuns"],
        "readonly",
      );
      await expect(
        requestResult(read.objectStore("attachments").get("attachment-late")),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(read.objectStore("generationRuns").get("run-late")),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(read.objectStore("generationRuns").get("run-complete")),
      ).resolves.toBeDefined();
      await transactionDone(read);

      await expect(
        repository.truncate({
          chatThreadId: thread.chatThreadId,
          editedContent: "stale",
          expectedConversationRevision: 0,
          intent: "edit-user",
          targetMessageId: "message-2",
        }),
      ).rejects.toThrow("revision");
    } finally {
      database.close();
    }
  });

  it("atomically regenerates an assistant message and removes the remaining linear tail", async () => {
    const { database, repository, thread } = await createFixture();
    const owner: TaskOwner = {
      branchId: thread.branchId,
      contextRevision: 1,
      expectedOwnerRevision: 0,
      kind: "chat",
      sessionId: thread.sessionId,
      subtitleId: thread.subtitleId,
      targetId: thread.chatThreadId,
      taskId: "regenerate-task",
    };
    try {
      for (const value of [
        message(thread.chatThreadId, {
          content: "第一问",
          id: "regenerate-user",
          order: 0,
          role: "user",
        }),
        message(thread.chatThreadId, {
          content: "第一答",
          generationRunId: "regenerate-run",
          id: "regenerate-assistant",
          order: 1,
          role: "assistant",
        }),
        message(thread.chatThreadId, {
          content: "后续问题",
          id: "regenerate-tail",
          order: 2,
          role: "user",
        }),
      ]) {
        await repository.appendMessage(value);
      }
      const seed = database.transaction("generationRuns", "readwrite");
      seed.objectStore("generationRuns").put(
        createGenerationRun({
          ...owner,
          browserSessionId: "browser-regenerate",
          completionSequence: 1,
          createdAt: 401,
          errorCode: null,
          partialOutput: "第一答",
          runId: "regenerate-run",
          status: "completed",
          stopReason: null,
          updatedAt: 401,
        }),
      );
      await transactionDone(seed);

      await expect(
        repository.truncate({
          chatThreadId: thread.chatThreadId,
          expectedConversationRevision: 0,
          intent: "regenerate-assistant",
          targetMessageId: "regenerate-assistant",
        }),
      ).resolves.toMatchObject({
        cancelledRuns: [expect.objectContaining({ runId: "regenerate-run" })],
        deletedMessageIds: ["regenerate-assistant", "regenerate-tail"],
        replacementMessage: null,
        thread: { conversationRevision: 1 },
      });
      await expect(
        repository.listMessages(thread.chatThreadId),
      ).resolves.toEqual([
        expect.objectContaining({ messageId: "regenerate-user" }),
      ]);
    } finally {
      database.close();
    }
  });

  it("deletes a thread with its messages, attachments, and generation runs in one transaction", async () => {
    const { database, repository, thread } = await createFixture();
    const owner: TaskOwner = {
      branchId: thread.branchId,
      contextRevision: 1,
      expectedOwnerRevision: 0,
      kind: "chat",
      sessionId: thread.sessionId,
      subtitleId: thread.subtitleId,
      targetId: thread.chatThreadId,
      taskId: "delete-thread-task",
    };
    try {
      await repository.appendMessage(
        message(thread.chatThreadId, {
          content: "删除问题",
          id: "delete-user",
          order: 0,
          role: "user",
        }),
      );
      await repository.appendMessage(
        message(thread.chatThreadId, {
          content: "生成中",
          generationRunId: "delete-run",
          id: "delete-assistant",
          order: 1,
          role: "assistant",
          status: "streaming",
        }),
      );
      const seed = database.transaction(
        ["attachments", "generationRuns"],
        "readwrite",
      );
      seed.objectStore("attachments").put({
        attachmentId: "delete-attachment",
        branchId: thread.branchId,
        messageId: "delete-assistant",
        sessionId: thread.sessionId,
      });
      seed.objectStore("generationRuns").put(
        createGenerationRun({
          ...owner,
          browserSessionId: "browser-delete",
          completionSequence: null,
          createdAt: 401,
          errorCode: null,
          partialOutput: "生成中",
          runId: "delete-run",
          status: "running",
          stopReason: null,
          updatedAt: 401,
        }),
      );
      await transactionDone(seed);

      await expect(
        repository.deleteThread(thread.chatThreadId),
      ).resolves.toMatchObject({
        cancelledRuns: [expect.objectContaining({ runId: "delete-run" })],
        deletedMessageIds: ["delete-user", "delete-assistant"],
        replacementMessage: null,
        thread: null,
      });
      await expect(
        repository.getThread(thread.chatThreadId),
      ).resolves.toBeNull();
      await expect(
        repository.listMessages(thread.chatThreadId),
      ).resolves.toEqual([]);

      const read = database.transaction(
        ["attachments", "generationRuns"],
        "readonly",
      );
      await expect(
        requestResult(read.objectStore("attachments").get("delete-attachment")),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(read.objectStore("generationRuns").get("delete-run")),
      ).resolves.toBeUndefined();
      await transactionDone(read);
    } finally {
      database.close();
    }
  });

  it("lists persisted runs by exact run ids (history failure projection source)", async () => {
    const { database, repository, thread } = await createFixture();
    const owner: TaskOwner = {
      branchId: thread.branchId,
      contextRevision: 1,
      expectedOwnerRevision: 0,
      kind: "chat",
      sessionId: thread.sessionId,
      subtitleId: thread.subtitleId,
      targetId: thread.chatThreadId,
      taskId: "history-task",
    };
    try {
      const seed = database.transaction("generationRuns", "readwrite");
      seed.objectStore("generationRuns").put(
        createGenerationRun({
          ...owner,
          browserSessionId: "browser-history",
          completionSequence: null,
          createdAt: 400,
          errorCode: "NETWORK_ERROR",
          partialOutput: "部分输出",
          runId: "history-run-1",
          status: "failed",
          stopReason: null,
          updatedAt: 401,
        }),
      );
      seed.objectStore("generationRuns").put(
        createGenerationRun({
          ...owner,
          browserSessionId: "browser-history",
          completionSequence: 0,
          createdAt: 402,
          errorCode: null,
          partialOutput: "完整输出",
          runId: "history-run-2",
          status: "completed",
          stopReason: null,
          taskId: "history-task-2",
          updatedAt: 403,
        }),
      );
      await transactionDone(seed);

      await expect(
        repository.listRuns(["history-run-1", "history-run-2", "missing-run"]),
      ).resolves.toEqual([
        expect.objectContaining({
          errorCode: "NETWORK_ERROR",
          runId: "history-run-1",
        }),
        expect.objectContaining({
          runId: "history-run-2",
          status: "completed",
        }),
      ]);
      await expect(repository.listRuns([])).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });
});
