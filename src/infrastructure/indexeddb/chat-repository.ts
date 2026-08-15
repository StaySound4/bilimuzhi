import type {
  ChatMutationCommit,
  ChatRepository,
  SanitizedProviderImageOutput,
  ChatThreadScope,
  ChatTruncationInput,
} from "../../application/chat-repository";
import type { AttachmentTurnBinding } from "../../application/attachment-repository";
import { createLinearChatTruncationPlan } from "../../application/chat-truncation-contract";
import { isGenerationRunNonTerminal } from "../../application/generation-runtime-contract";
import { StorageError } from "../../application/storage";
import {
  createBranchPlacement,
  createChatMessage,
  createChatThread,
  createGenerationRun,
  createImageAttachment,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  IMAGE_ATTACHMENT_MAX_COUNT,
  IMAGE_ATTACHMENT_MAX_TOTAL_BYTES,
  isImageAttachmentMimeType,
  type ChatMessage,
  type ChatThread,
  type GenerationRun,
  type ImageAttachment,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

export { createIndexedDbAttachmentRepository } from "./attachment-repository";

export interface IndexedDbChatRepositoryDependencies {
  readonly createAttachmentId?: () => string;
  readonly now: () => number;
}

function normalizeStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError("Unable to update the Bilimuzhi chat database");
}

function readThread(value: unknown): ChatThread | null {
  try {
    return createChatThread(value as ChatThread);
  } catch {
    return null;
  }
}

function readMessage(value: unknown): ChatMessage | null {
  try {
    return createChatMessage(value as ChatMessage);
  } catch {
    return null;
  }
}

function readRun(value: unknown): GenerationRun | null {
  try {
    return createGenerationRun(value as GenerationRun);
  } catch {
    return null;
  }
}

function readAttachment(value: unknown): ImageAttachment | null {
  try {
    return createImageAttachment(value as ImageAttachment);
  } catch {
    return null;
  }
}

function hasSameRunVersion(left: GenerationRun, right: GenerationRun): boolean {
  return (
    left.runId === right.runId &&
    left.taskId === right.taskId &&
    left.sessionId === right.sessionId &&
    left.branchId === right.branchId &&
    left.subtitleId === right.subtitleId &&
    left.contextRevision === right.contextRevision &&
    left.kind === right.kind &&
    left.targetId === right.targetId &&
    left.expectedOwnerRevision === right.expectedOwnerRevision &&
    left.browserSessionId === right.browserSessionId &&
    left.status === right.status &&
    left.partialOutput === right.partialOutput &&
    left.completionSequence === right.completionSequence &&
    left.stopReason === right.stopReason &&
    left.errorCode === right.errorCode &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt &&
    left.runRevision === right.runRevision &&
    left.conversationRevision === right.conversationRevision &&
    left.promptHash === right.promptHash &&
    left.modelHash === right.modelHash &&
    left.contextHash === right.contextHash
  );
}

function hasAuthoritativeScope(
  thread: ChatThread,
  storedSession: unknown,
  storedBranch: unknown,
  storedPlacement: unknown,
  storedSubtitle: unknown,
): boolean {
  try {
    const session = createSession(
      storedSession as Parameters<typeof createSession>[0],
    );
    const branch = createSubtitleBranch(
      storedBranch as Parameters<typeof createSubtitleBranch>[0],
    );
    const placement = createBranchPlacement(
      storedPlacement as Parameters<typeof createBranchPlacement>[0],
    );
    const subtitle = createSubtitleSnapshot(
      storedSubtitle as Parameters<typeof createSubtitleSnapshot>[0],
    );
    return (
      session.sessionId === thread.sessionId &&
      branch.sessionId === thread.sessionId &&
      branch.branchId === thread.branchId &&
      branch.activeSubtitleId === thread.subtitleId &&
      placement.sessionId === thread.sessionId &&
      placement.branchId === thread.branchId &&
      placement.location !== "trash" &&
      subtitle.sessionId === thread.sessionId &&
      subtitle.branchId === thread.branchId &&
      subtitle.subtitleId === thread.subtitleId &&
      subtitle.status === "active"
    );
  } catch {
    return false;
  }
}

async function deleteAttachmentsForMessages(
  attachments: IDBObjectStore,
  messageIds: readonly string[],
): Promise<void> {
  for (const messageId of messageIds) {
    const keys = await requestResult(
      attachments.index("byMessageId").getAllKeys(messageId),
    );
    for (const key of keys) attachments.delete(key);
  }
}

async function deleteAttachmentsForThread(
  attachments: IDBObjectStore,
  chatThreadId: string,
): Promise<void> {
  const keys = await requestResult(
    attachments.index("byThreadId").getAllKeys(chatThreadId),
  );
  for (const key of keys) attachments.delete(key);
}

function frozenCommit(input: {
  readonly thread: ChatThread | null;
  readonly deletedMessageIds: readonly string[];
  readonly cancelledRuns: readonly GenerationRun[];
  readonly replacementMessage: ChatMessage | null;
}): ChatMutationCommit {
  return Object.freeze({
    cancelledRuns: Object.freeze([...input.cancelledRuns]),
    deletedMessageIds: Object.freeze([...input.deletedMessageIds]),
    replacementMessage: input.replacementMessage,
    thread: input.thread,
  });
}

export class IndexedDbChatRepository implements ChatRepository {
  private readonly createAttachmentId: () => string;

  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: IndexedDbChatRepositoryDependencies,
  ) {
    this.createAttachmentId =
      dependencies.createAttachmentId ?? (() => crypto.randomUUID());
  }

  async listThreads(scope: ChatThreadScope): Promise<readonly ChatThread[]> {
    try {
      const transaction = this.database.transaction("chatThreads", "readonly");
      const stored = await requestResult(
        transaction.objectStore("chatThreads").getAll(),
      );
      const threads = (stored as readonly unknown[])
        .map(readThread)
        .filter(
          (thread): thread is ChatThread =>
            thread !== null &&
            thread.sessionId === scope.sessionId &&
            thread.branchId === scope.branchId &&
            thread.subtitleId === scope.subtitleId,
        )
        .sort(
          (left, right) =>
            left.order - right.order ||
            left.chatThreadId.localeCompare(right.chatThreadId),
        );
      await transactionDone(transaction);
      return Object.freeze(threads);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async getThread(chatThreadId: string): Promise<ChatThread | null> {
    try {
      const transaction = this.database.transaction("chatThreads", "readonly");
      const thread = readThread(
        await requestResult(
          transaction.objectStore("chatThreads").get(chatThreadId),
        ),
      );
      await transactionDone(transaction);
      return thread;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async listMessages(chatThreadId: string): Promise<readonly ChatMessage[]> {
    try {
      const transaction = this.database.transaction("chatMessages", "readonly");
      const stored = await requestResult(
        transaction.objectStore("chatMessages").getAll(),
      );
      const messages = (stored as readonly unknown[])
        .map(readMessage)
        .filter(
          (message): message is ChatMessage =>
            message !== null && message.chatThreadId === chatThreadId,
        )
        .sort(
          (left, right) =>
            left.order - right.order ||
            left.messageId.localeCompare(right.messageId),
        );
      await transactionDone(transaction);
      return Object.freeze(messages);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async listRuns(runIds: readonly string[]): Promise<readonly GenerationRun[]> {
    const uniqueIds = [...new Set(runIds)];
    if (uniqueIds.length === 0) return Object.freeze([]);
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction("generationRuns", "readonly");
      done = transactionDone(transaction);
      const store = transaction.objectStore("generationRuns");
      const runs: GenerationRun[] = [];
      for (const runId of uniqueIds) {
        const run = readRun(await requestResult(store.get(runId)));
        if (run !== null) runs.push(run);
      }
      await done;
      return Object.freeze(runs);
    } catch (error) {
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // 事务失败以当前异常为准。
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async createThread(inputThread: ChatThread): Promise<ChatThread> {
    let thread: ChatThread;
    try {
      thread = createChatThread(inputThread);
    } catch {
      throw new StorageError("The Bilimuzhi chat thread is invalid");
    }
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction(
        [
          "branchPlacements",
          "chatThreads",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readwrite",
      );
      done = transactionDone(transaction);
      const [session, branch, placement, subtitle] = await Promise.all([
        requestResult(
          transaction.objectStore("sessions").get(thread.sessionId),
        ),
        requestResult(
          transaction.objectStore("subtitleBranches").get(thread.branchId),
        ),
        requestResult(
          transaction.objectStore("branchPlacements").get(thread.branchId),
        ),
        requestResult(
          transaction.objectStore("subtitleSnapshots").get(thread.subtitleId),
        ),
      ]);
      if (
        !hasAuthoritativeScope(thread, session, branch, placement, subtitle)
      ) {
        throw new StorageError(
          "The Bilimuzhi chat owner is no longer authoritative",
        );
      }
      transaction.objectStore("chatThreads").add(thread);
      await done;
      return thread;
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A request error can already have closed the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the safe boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async renameThread(
    chatThreadId: string,
    title: string | null,
  ): Promise<ChatThread> {
    try {
      const transaction = this.database.transaction("chatThreads", "readwrite");
      const store = transaction.objectStore("chatThreads");
      const existing = readThread(await requestResult(store.get(chatThreadId)));
      if (existing === null) {
        throw new StorageError("The Bilimuzhi chat thread does not exist");
      }
      const updated = createChatThread({
        ...existing,
        title,
        updatedAt: Math.max(this.dependencies.now(), existing.updatedAt),
      });
      store.put(updated);
      await transactionDone(transaction);
      return updated;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async appendMessage(inputMessage: ChatMessage): Promise<ChatMessage> {
    let message: ChatMessage;
    try {
      message = createChatMessage(inputMessage);
    } catch {
      throw new StorageError("The Bilimuzhi chat message is invalid");
    }
    try {
      const transaction = this.database.transaction(
        ["chatMessages", "chatThreads"],
        "readwrite",
      );
      const threads = transaction.objectStore("chatThreads");
      const thread = readThread(
        await requestResult(threads.get(message.chatThreadId)),
      );
      if (thread === null) {
        throw new StorageError("The Bilimuzhi chat thread does not exist");
      }
      transaction.objectStore("chatMessages").add(message);
      threads.put(
        createChatThread({
          ...thread,
          updatedAt: Math.max(thread.updatedAt, message.updatedAt),
        }),
      );
      await transactionDone(transaction);
      return message;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async appendTurn(
    inputUser: ChatMessage,
    inputAssistant: ChatMessage,
    attachmentBinding?: AttachmentTurnBinding,
  ): Promise<readonly [ChatMessage, ChatMessage]> {
    let user: ChatMessage;
    let assistant: ChatMessage;
    try {
      user = createChatMessage(inputUser);
      assistant = createChatMessage(inputAssistant);
    } catch {
      throw new StorageError("The Bilimuzhi chat turn is invalid");
    }
    if (
      user.role !== "user" ||
      assistant.role !== "assistant" ||
      user.chatThreadId !== assistant.chatThreadId ||
      assistant.order !== user.order + 1
    ) {
      throw new StorageError("The Bilimuzhi chat turn relationship is invalid");
    }
    try {
      const transaction = this.database.transaction(
        [
          ...(attachmentBinding === undefined ? [] : ["attachments"]),
          "chatMessages",
          "chatThreads",
          "generationRuns",
        ],
        "readwrite",
      );
      const threads = transaction.objectStore("chatThreads");
      const thread = readThread(
        await requestResult(threads.get(user.chatThreadId)),
      );
      const run =
        assistant.generationRunId === null
          ? null
          : readRun(
              await requestResult(
                transaction
                  .objectStore("generationRuns")
                  .get(assistant.generationRunId),
              ),
            );
      if (
        thread === null ||
        run === null ||
        run.targetId !== thread.chatThreadId ||
        run.expectedOwnerRevision !== thread.conversationRevision ||
        !isGenerationRunNonTerminal(run.status)
      ) {
        throw new StorageError("The Bilimuzhi chat generation is no longer active");
      }
      if (attachmentBinding !== undefined) {
        const ids = [...new Set(attachmentBinding.attachmentIds)];
        if (
          ids.length !== attachmentBinding.attachmentIds.length ||
          ids.length > 6 ||
          attachmentBinding.owner.chatThreadId !== thread.chatThreadId ||
          attachmentBinding.owner.sessionId !== thread.sessionId ||
          attachmentBinding.owner.branchId !== thread.branchId ||
          attachmentBinding.owner.subtitleId !== thread.subtitleId
        ) {
          throw new StorageError(
            "The Bilimuzhi image attachment binding is invalid",
          );
        }
        const attachmentsStore = transaction.objectStore("attachments");
        for (const attachmentId of ids) {
          const attachment = readAttachment(
            await requestResult(attachmentsStore.get(attachmentId)),
          );
          if (
            attachment === null ||
            attachment.messageId !== null ||
            attachment.sessionId !== attachmentBinding.owner.sessionId ||
            attachment.branchId !== attachmentBinding.owner.branchId ||
            attachment.subtitleId !== attachmentBinding.owner.subtitleId ||
            attachment.subtitleContextRevision !==
              attachmentBinding.owner.subtitleContextRevision ||
            attachment.chatThreadId !== attachmentBinding.owner.chatThreadId
          ) {
            throw new StorageError(
              "The Bilimuzhi image attachment owner is no longer authoritative",
            );
          }
          attachmentsStore.put(
            createImageAttachment({ ...attachment, messageId: user.messageId }),
          );
        }
      }
      const messages = transaction.objectStore("chatMessages");
      messages.add(user);
      messages.add(assistant);
      threads.put(
        createChatThread({
          ...thread,
          updatedAt: Math.max(thread.updatedAt, assistant.updatedAt),
        }),
      );
      await transactionDone(transaction);
      return Object.freeze([user, assistant]);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async applyAssistantRun(
    inputRun: GenerationRun,
  ): Promise<ChatMessage | null> {
    let run: GenerationRun;
    try {
      run = createGenerationRun(inputRun);
    } catch {
      throw new StorageError("The Bilimuzhi generation run is invalid");
    }
    try {
      const transaction = this.database.transaction(
        ["chatMessages", "chatThreads", "generationRuns"],
        "readwrite",
      );
      const storedRun = readRun(
        await requestResult(
          transaction.objectStore("generationRuns").get(run.runId),
        ),
      );
      if (storedRun === null || !hasSameRunVersion(storedRun, run)) {
        await transactionDone(transaction);
        return null;
      }
      const messagesStore = transaction.objectStore("chatMessages");
      const messages = (
        (await requestResult(messagesStore.getAll())) as readonly unknown[]
      )
        .map(readMessage)
        .filter((message): message is ChatMessage => message !== null);
      const assistant = messages.find(
        (message) =>
          message.role === "assistant" &&
          message.generationRunId === run.runId &&
          message.chatThreadId === run.targetId,
      );
      if (assistant === undefined) {
        await transactionDone(transaction);
        return null;
      }
      const thread = readThread(
        await requestResult(
          transaction.objectStore("chatThreads").get(assistant.chatThreadId),
        ),
      );
      if (
        thread === null ||
        thread.sessionId !== run.sessionId ||
        thread.branchId !== run.branchId ||
        thread.subtitleId !== run.subtitleId ||
        thread.conversationRevision !== run.expectedOwnerRevision
      ) {
        await transactionDone(transaction);
        return null;
      }
      const status = isGenerationRunNonTerminal(run.status)
        ? "streaming"
        : run.status === "completed"
          ? "complete"
          : "failed";
      const updated = createChatMessage({
        ...assistant,
        content: run.partialOutput,
        status,
        updatedAt: Math.max(assistant.updatedAt, run.updatedAt),
      });
      messagesStore.put(updated);
      transaction.objectStore("chatThreads").put(
        createChatThread({
          ...thread,
          updatedAt: Math.max(thread.updatedAt, updated.updatedAt),
        }),
      );
      await transactionDone(transaction);
      return updated;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async commitAssistantImageOutputs(input: {
    readonly images: readonly SanitizedProviderImageOutput[];
    readonly messageId: string;
    readonly run: GenerationRun;
  }): Promise<readonly ImageAttachment[] | null> {
    let run: GenerationRun;
    try {
      run = createGenerationRun(input.run);
    } catch {
      throw new StorageError("The Bilimuzhi Provider image owner is invalid");
    }
    if (
      run.kind !== "chat" ||
      run.status !== "completed" ||
      !Array.isArray(input.images) ||
      input.images.length === 0 ||
      input.images.length > IMAGE_ATTACHMENT_MAX_COUNT ||
      typeof input.messageId !== "string" ||
      input.messageId.trim().length === 0
    ) {
      throw new StorageError("The Bilimuzhi Provider image commit is invalid");
    }
    let aggregateBytes = 0;
    for (const image of input.images) {
      if (
        !(image.blob instanceof Blob) ||
        !isImageAttachmentMimeType(image.mimeType) ||
        image.blob.type !== image.mimeType ||
        image.blob.size <= 0 ||
        !(image.thumbnailBlob instanceof Blob) ||
        image.thumbnailBlob.size <= 0 ||
        !isImageAttachmentMimeType(image.thumbnailBlob.type) ||
        !Number.isSafeInteger(image.width) ||
        image.width <= 0 ||
        !Number.isSafeInteger(image.height) ||
        image.height <= 0
      ) {
        throw new StorageError("The Bilimuzhi Provider image output is invalid");
      }
      aggregateBytes += image.blob.size;
    }
    if (aggregateBytes > IMAGE_ATTACHMENT_MAX_TOTAL_BYTES) {
      throw new StorageError("The Bilimuzhi Provider image output is too large");
    }

    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction(
        [
          "attachments",
          "branchPlacements",
          "chatMessages",
          "chatThreads",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readwrite",
      );
      done = transactionDone(transaction);
      const storedRun = readRun(
        await requestResult(
          transaction.objectStore("generationRuns").get(run.runId),
        ),
      );
      const message = readMessage(
        await requestResult(
          transaction.objectStore("chatMessages").get(input.messageId),
        ),
      );
      const thread = readThread(
        await requestResult(
          transaction.objectStore("chatThreads").get(run.targetId),
        ),
      );
      if (
        storedRun === null ||
        !hasSameRunVersion(storedRun, run) ||
        message === null ||
        message.role !== "assistant" ||
        message.chatThreadId !== run.targetId ||
        message.generationRunId !== run.runId ||
        thread === null ||
        thread.sessionId !== run.sessionId ||
        thread.branchId !== run.branchId ||
        thread.subtitleId !== run.subtitleId ||
        thread.conversationRevision !== run.expectedOwnerRevision ||
        run.conversationRevision !== thread.conversationRevision
      ) {
        await done;
        return null;
      }
      const [session, branch, placement, subtitle] = await Promise.all([
        requestResult(
          transaction.objectStore("sessions").get(thread.sessionId),
        ),
        requestResult(
          transaction.objectStore("subtitleBranches").get(thread.branchId),
        ),
        requestResult(
          transaction.objectStore("branchPlacements").get(thread.branchId),
        ),
        requestResult(
          transaction.objectStore("subtitleSnapshots").get(thread.subtitleId),
        ),
      ]);
      if (
        !hasAuthoritativeScope(thread, session, branch, placement, subtitle)
      ) {
        await done;
        return null;
      }
      const authoritativeBranch = createSubtitleBranch(
        branch as Parameters<typeof createSubtitleBranch>[0],
      );
      if (authoritativeBranch.contextRevision !== run.contextRevision) {
        await done;
        return null;
      }
      const attachments = input.images.map((image) =>
        createImageAttachment({
          attachmentId: this.createAttachmentId(),
          blob: image.blob,
          branchId: run.branchId,
          chatThreadId: run.targetId,
          currentTimeMs: 0,
          height: image.height,
          messageId: message.messageId,
          mimeType: image.mimeType,
          sessionId: run.sessionId,
          subtitleContextRevision: run.contextRevision,
          subtitleId: run.subtitleId,
          thumbnailBlob: image.thumbnailBlob,
          videoKey: authoritativeBranch.videoKey,
          width: image.width,
        }),
      );
      if (
        new Set(attachments.map((attachment) => attachment.attachmentId))
          .size !== attachments.length
      ) {
        throw new StorageError(
          "The Bilimuzhi Provider image identifiers are invalid",
        );
      }
      const store = transaction.objectStore("attachments");
      for (const attachment of attachments) store.add(attachment);
      await done;
      return Object.freeze(attachments);
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A failed request may already have closed the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the public boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async truncate(input: ChatTruncationInput): Promise<ChatMutationCommit> {
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction(
        ["attachments", "chatMessages", "chatThreads", "generationRuns"],
        "readwrite",
      );
      done = transactionDone(transaction);
      const threads = transaction.objectStore("chatThreads");
      const messagesStore = transaction.objectStore("chatMessages");
      const runsStore = transaction.objectStore("generationRuns");
      const thread = readThread(
        await requestResult(threads.get(input.chatThreadId)),
      );
      if (
        thread === null ||
        thread.conversationRevision !== input.expectedConversationRevision
      ) {
        throw new StorageError("The Bilimuzhi chat revision has changed");
      }
      const messages = (
        (await requestResult(messagesStore.getAll())) as readonly unknown[]
      )
        .map(readMessage)
        .filter(
          (message): message is ChatMessage =>
            message !== null && message.chatThreadId === thread.chatThreadId,
        )
        .sort(
          (left, right) =>
            left.order - right.order ||
            left.messageId.localeCompare(right.messageId),
        );
      const plan = createLinearChatTruncationPlan(
        thread,
        messages,
        input.targetMessageId,
        input.intent,
      );
      const target = messages.find(
        (message) => message.messageId === plan.targetMessageId,
      );
      if (target === undefined) {
        throw new StorageError("The Bilimuzhi chat target does not exist");
      }
      let replacementMessage: ChatMessage | null = null;
      if (input.intent === "edit-user") {
        if (
          typeof input.editedContent !== "string" ||
          input.editedContent.trim().length === 0
        ) {
          throw new StorageError("The edited Bilimuzhi chat message is empty");
        }
        replacementMessage = createChatMessage({
          ...target,
          content: input.editedContent.trim(),
          generationRunId: null,
          status: "complete",
          updatedAt: Math.max(this.dependencies.now(), target.updatedAt),
        });
      }

      const cancelledRuns: GenerationRun[] = [];
      for (const runId of plan.cancelledGenerationRunIds) {
        const run = readRun(await requestResult(runsStore.get(runId)));
        if (run !== null) cancelledRuns.push(run);
      }
      await deleteAttachmentsForMessages(
        transaction.objectStore("attachments"),
        plan.deletedMessageIds,
      );
      for (const messageId of plan.deletedMessageIds) {
        messagesStore.delete(messageId);
      }
      for (const run of cancelledRuns) runsStore.delete(run.runId);
      if (replacementMessage !== null) messagesStore.put(replacementMessage);
      const updatedThread = createChatThread({
        ...thread,
        conversationRevision: plan.nextConversationRevision,
        updatedAt: Math.max(this.dependencies.now(), thread.updatedAt),
      });
      threads.put(updatedThread);
      await done;
      return frozenCommit({
        cancelledRuns,
        deletedMessageIds: plan.deletedMessageIds,
        replacementMessage,
        thread: updatedThread,
      });
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A request error can already have closed the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the safe boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async deleteThread(chatThreadId: string): Promise<ChatMutationCommit> {
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction(
        ["attachments", "chatMessages", "chatThreads", "generationRuns"],
        "readwrite",
      );
      done = transactionDone(transaction);
      const threads = transaction.objectStore("chatThreads");
      const thread = readThread(await requestResult(threads.get(chatThreadId)));
      if (thread === null) {
        await done;
        return frozenCommit({
          cancelledRuns: [],
          deletedMessageIds: [],
          replacementMessage: null,
          thread: null,
        });
      }
      const messagesStore = transaction.objectStore("chatMessages");
      const messages = (
        (await requestResult(messagesStore.getAll())) as readonly unknown[]
      )
        .map(readMessage)
        .filter(
          (message): message is ChatMessage =>
            message !== null && message.chatThreadId === thread.chatThreadId,
        )
        .sort(
          (left, right) =>
            left.order - right.order ||
            left.messageId.localeCompare(right.messageId),
        );
      const deletedMessageIds = messages.map((message) => message.messageId);
      const branchRuns = (await requestResult(
        transaction
          .objectStore("generationRuns")
          .index("byBranchId")
          .getAll(thread.branchId),
      )) as readonly unknown[];
      const cancelledRuns = branchRuns
        .map(readRun)
        .filter(
          (run): run is GenerationRun =>
            run !== null && run.targetId === thread.chatThreadId,
        )
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt ||
            left.runId.localeCompare(right.runId),
        );
      await deleteAttachmentsForThread(
        transaction.objectStore("attachments"),
        thread.chatThreadId,
      );
      // Legacy v7 records created before the exact thread owner was required
      // can still be reached by their bound message. Delete both key sets in
      // the same transaction while the compatibility data remains supported.
      await deleteAttachmentsForMessages(
        transaction.objectStore("attachments"),
        deletedMessageIds,
      );
      for (const messageId of deletedMessageIds) {
        messagesStore.delete(messageId);
      }
      for (const run of cancelledRuns) {
        transaction.objectStore("generationRuns").delete(run.runId);
      }
      threads.delete(thread.chatThreadId);
      await done;
      return frozenCommit({
        cancelledRuns,
        deletedMessageIds,
        replacementMessage: null,
        thread: null,
      });
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A request error can already have closed the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the safe boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }
}
