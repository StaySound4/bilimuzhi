import {
  createAiGenerationRequest,
  type AiGenerationRequest,
  type AiImageAttachmentHandle,
  type AiProviderGateway,
  type AiProviderImageOutputDescriptor,
  type AiProviderStreamEvent,
} from "./ai/provider-contract";
import { AiProviderError, type AiProviderErrorCode } from "./ai/provider-error";
import type { AttachmentRepository } from "./attachment-repository";
import type {
  ChatMutationCommit,
  ChatRepository,
  SanitizedProviderImageOutput,
  ChatThreadScope,
} from "./chat-repository";
import {
  GENERATION_FAILURE_CODES,
  type GenerationRuntimeEvent,
  type GenerationTaskContext,
} from "./generation-runtime-contract";
import { createGenerationSnapshotHash } from "./generation-runtime-contract";
import type { GenerationTaskCoordinator } from "./task";
import { createSubtitleContextPlan } from "./ai/context-plan";
import { buildTaskPrompt, type PromptVideoMeta } from "./ai/prompt-builder";
import type { UiLanguage } from "../i18n/languages";
import type { SubtitleRow } from "../domain";
import {
  createChatMessage,
  createChatThread,
  createGenerationRun,
  createTaskOwner,
  type ChatMessage,
  type ChatThread,
  type GenerationRun,
  IMAGE_ATTACHMENT_MAX_COUNT,
  IMAGE_ATTACHMENT_MAX_TOTAL_BYTES,
  type TaskOwner,
} from "../domain";

/** The exact active subtitle a chat thread is grounded in. */
export interface ChatSubtitleContext {
  readonly meta: PromptVideoMeta;
  readonly rows: readonly SubtitleRow[];
}

export interface ChatRuntimeScope extends ChatThreadScope {
  readonly contextRevision: number;
  readonly expectedOwnerRevision: number;
}

export type ChatGenerationOptions = Pick<
  AiGenerationRequest,
  "model" | "reasoningEffort"
>;

export interface ChatReasoningUpdate {
  readonly runId: string;
  readonly text: string;
  readonly threadId: string;
}

export interface ChatGenerationResult {
  readonly assistant: ChatMessage;
  readonly run: GenerationRun | null;
}

export interface ChatAssistantUpdate {
  readonly message: ChatMessage;
  readonly run: GenerationRun;
  readonly threadId: string;
}

export interface ChatGenerationHandle {
  readonly assistant: ChatMessage;
  readonly completion: Promise<ChatGenerationResult>;
  readonly run: GenerationRun;
  readonly user: ChatMessage;
  stop(): Promise<ChatMessage | null>;
}

export interface ChatRuntimeDependencies {
  /** Called only after a truncate/delete transaction has committed. */
  readonly abortCancelledRun?: (run: GenerationRun) => Promise<void> | void;
  readonly attachmentRepository?: Pick<AttachmentRepository, "resolveById">;
  readonly createMessageId: () => string;
  readonly createTaskId: () => string;
  readonly createThreadId: () => string;
  readonly now: () => number;
  /**
   * AI 输出默认语言（docs/i18n-spec.md §5）：per-mode 弱约束默认值，
   * 每次生成前按任务模式读取；对话模式固定 kind="chat"。
   */
  readonly outputLanguage?: (
    kind: "chat",
  ) => UiLanguage | Promise<UiLanguage | undefined> | undefined;
  readonly onAssistantUpdate?: (update: ChatAssistantUpdate) => void;
  readonly processImageOutput?: (
    descriptor: AiProviderImageOutputDescriptor,
  ) => Promise<SanitizedProviderImageOutput>;
  readonly provider: AiProviderGateway;
  /** Reads the exact subtitle backing a scope so every turn stays grounded. */
  readonly readSubtitleContext?: (
    scope: ChatRuntimeScope,
  ) => Promise<ChatSubtitleContext | null>;
  readonly readUserPrompt?: () => Promise<string | null>;
  readonly repository: ChatRepository;
  readonly tasks: GenerationTaskCoordinator;
}

export interface ChatRuntime {
  load(scope: ChatThreadScope): Promise<readonly ChatThread[]>;
  loadMessages(
    threadId: string,
    scope: ChatRuntimeScope,
  ): Promise<readonly ChatMessage[]>;
  /** 按精确 runId 读取持久化 run（历史失败消息的投影来源）。 */
  listRuns(runIds: readonly string[]): Promise<readonly GenerationRun[]>;
  createThread(input: {
    readonly scope: ChatRuntimeScope;
    readonly title?: string | null;
  }): Promise<ChatThread>;
  renameThread(input: {
    readonly scope: ChatRuntimeScope;
    readonly threadId: string;
    readonly title: string | null;
  }): Promise<ChatThread>;
  deleteThread(input: {
    readonly scope: ChatRuntimeScope;
    readonly threadId: string;
  }): Promise<ChatMutationCommit>;
  send(input: ChatSendInput): Promise<ChatGenerationHandle>;
  editAndResend(
    input: ChatMutationGenerationInput & {
      readonly content: string;
    },
  ): Promise<ChatGenerationHandle>;
  regenerate(input: ChatMutationGenerationInput): Promise<ChatGenerationHandle>;
  retry(input: ChatMutationGenerationInput): Promise<ChatGenerationHandle>;
  /**
   * Stops an exact durable run. Unlike ChatGenerationHandle.stop(), this
   * entry point remains usable after a Service Worker restart has discarded
   * listener-local handles.
   */
  stop(run: GenerationRun): Promise<ChatMessage | null>;
}

export interface ChatSendInput {
  readonly attachmentIds?: readonly string[];
  readonly content: string;
  readonly generation: ChatGenerationOptions;
  readonly onReasoning?: (update: ChatReasoningUpdate) => void;
  readonly scope: ChatRuntimeScope;
  /** One-shot control layer; never persisted in messages or task metadata. */
  readonly temporaryControlPrompt?: string;
  readonly threadId: string;
}

interface ChatMutationGenerationInput {
  readonly generation: ChatGenerationOptions;
  readonly onReasoning?: (update: ChatReasoningUpdate) => void;
  readonly scope: ChatRuntimeScope;
  readonly targetMessageId: string;
  readonly threadId: string;
}

function assertThreadInScope(
  thread: ChatThread | null,
  scope: ChatRuntimeScope,
): asserts thread is ChatThread {
  if (
    thread === null ||
    thread.sessionId !== scope.sessionId ||
    thread.branchId !== scope.branchId ||
    thread.subtitleId !== scope.subtitleId ||
    thread.conversationRevision !== scope.expectedOwnerRevision
  ) {
    throw new Error("The Bilimuzhi chat thread is no longer authoritative");
  }
}

function nextMessageOrder(messages: readonly ChatMessage[]): number {
  return (
    messages.reduce(
      (highest, message) => Math.max(highest, message.order),
      -1,
    ) + 1
  );
}

function hasUnsafeControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (
      (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
      code === 0x7f
    );
  });
}

function createOwner(
  thread: ChatThread,
  scope: ChatRuntimeScope,
  taskId: string,
): TaskOwner {
  return createTaskOwner({
    branchId: scope.branchId,
    contextRevision: scope.contextRevision,
    expectedOwnerRevision: scope.expectedOwnerRevision,
    kind: "chat",
    sessionId: scope.sessionId,
    subtitleId: scope.subtitleId,
    targetId: thread.chatThreadId,
    taskId,
  });
}

/**
 * Builds the provider request for a chat turn.
 *
 * The subtitle reference is what makes this a *video* assistant rather than a
 * free-form chatbot, so when the runtime can read the session's subtitle it is
 * always grounded. Only if no subtitle context is available does the request
 * fall back to the bare conversation.
 */
async function createRequest(
  messages: readonly ChatMessage[],
  generation: ChatGenerationOptions,
  context: ChatSubtitleContext | null,
  userPrompt: string | null,
  attachments: readonly AiImageAttachmentHandle[],
  outputLanguage: UiLanguage | undefined,
): Promise<AiGenerationRequest> {
  // 过滤空的 assistant 消息壳（删除/停止任务时可能残留 content 为空、
  // status=streaming 的占位消息）；空消息会让 Provider 请求校验失败。
  const history = messages
    .filter(
      (message) => message.role === "user" || message.content.trim().length > 0,
    )
    .map((message) => ({
      content: message.content,
      role: message.role,
    }));
  if (context === null || context.rows.length === 0) {
    return createAiGenerationRequest({
      ...(attachments.length > 0 ? { attachments } : {}),
      kind: "chat",
      messages: history,
      model: generation.model,
      reasoningEffort: generation.reasoningEffort,
    });
  }
  const question = history.at(-1)?.content ?? "";
  const budget = Math.max(
    2_000,
    Math.floor(generation.model.capabilities.contextWindowCharacters * 0.5),
  );
  return createAiGenerationRequest({
    ...(attachments.length > 0 ? { attachments } : {}),
    kind: "chat",
    messages: buildTaskPrompt({
      contextPlan: createSubtitleContextPlan({
        characterBudget: budget,
        kind: "chat",
        query: question,
        rows: context.rows,
      }),
      history: history.slice(0, -1).slice(-8),
      kind: "chat",
      meta: context.meta,
      outputLanguage,
      question,
      rows: context.rows,
      userPrompt,
    }),
    model: generation.model,
    reasoningEffort: generation.reasoningEffort,
  });
}

function eventContext(run: GenerationRun): GenerationTaskContext {
  return Object.freeze({
    branchId: run.branchId,
    contextRevision: run.contextRevision,
    expectedOwnerRevision: run.expectedOwnerRevision,
    kind: run.kind,
    protocolVersion: 1,
    requestId: run.taskId,
    sessionId: run.sessionId,
    subtitleId: run.subtitleId,
    targetId: run.targetId,
    taskId: run.taskId,
    promptHash: run.promptHash ?? null,
    modelHash: run.modelHash ?? null,
    contextHash: run.contextHash ?? null,
    conversationRevision: run.conversationRevision ?? run.expectedOwnerRevision,
    runRevision: run.runRevision ?? 0,
  });
}

function toRuntimeEvent(
  run: GenerationRun,
  event: AiProviderStreamEvent,
): GenerationRuntimeEvent | null {
  const context = eventContext(run);
  switch (event.type) {
    case "started":
      return { ...context, payload: {}, type: "muzhi.generation.started" };
    case "delta":
      return {
        ...context,
        payload: { delta: event.delta },
        type: "muzhi.generation.delta",
      };
    case "completed":
      return {
        ...context,
        payload: { completionSequence: 0, output: event.output },
        type: "muzhi.generation.completed",
      };
    case "failed":
      return {
        ...context,
        payload: { errorCode: event.code },
        type: "muzhi.generation.failed",
      };
    case "reasoning":
      return null;
    case "image-output":
      return null;
  }
}

class DefaultChatRuntime implements ChatRuntime {
  constructor(private readonly dependencies: ChatRuntimeDependencies) {}

  private async groundedRequest(
    messages: readonly ChatMessage[],
    generation: ChatGenerationOptions,
    scope: ChatRuntimeScope,
    attachments: readonly AiImageAttachmentHandle[] = [],
    temporaryControlPrompt?: string,
  ): Promise<AiGenerationRequest> {
    let context: ChatSubtitleContext | null = null;
    let userPrompt: string | null;
    try {
      context = (await this.dependencies.readSubtitleContext?.(scope)) ?? null;
    } catch {
      // A grounding read failure must not block the conversation; the turn
      // degrades to an ungrounded answer rather than failing outright.
    }
    if (temporaryControlPrompt !== undefined) {
      userPrompt = temporaryControlPrompt;
    } else {
      try {
        userPrompt = (await this.dependencies.readUserPrompt?.()) ?? null;
      } catch {
        userPrompt = null;
      }
    }
    return createRequest(
      messages,
      generation,
      context,
      userPrompt,
      attachments,
      await this.dependencies.outputLanguage?.("chat"),
    );
  }

  private async resolveAttachmentHandles(
    attachmentIds: readonly string[],
    thread: ChatThread,
    scope: ChatRuntimeScope,
  ): Promise<readonly AiImageAttachmentHandle[]> {
    if (attachmentIds.length === 0) return Object.freeze([]);
    if (
      attachmentIds.length > 6 ||
      new Set(attachmentIds).size !== attachmentIds.length ||
      this.dependencies.attachmentRepository === undefined
    ) {
      throw new Error("The Bilimuzhi image attachment selection is invalid");
    }
    const handles: AiImageAttachmentHandle[] = [];
    for (const attachmentId of attachmentIds) {
      const attachment =
        await this.dependencies.attachmentRepository.resolveById(attachmentId);
      if (
        attachment === null ||
        attachment.messageId !== null ||
        attachment.sessionId !== scope.sessionId ||
        attachment.branchId !== scope.branchId ||
        attachment.subtitleId !== scope.subtitleId ||
        attachment.subtitleContextRevision !== scope.contextRevision ||
        attachment.chatThreadId !== thread.chatThreadId
      ) {
        throw new Error(
          "The Bilimuzhi image attachment owner is no longer authoritative",
        );
      }
      handles.push(
        Object.freeze({
          attachmentId: attachment.attachmentId,
          currentTimeMs: attachment.currentTimeMs,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.blob.size,
          videoKey: attachment.videoKey,
        }),
      );
    }
    return Object.freeze(handles);
  }

  load(scope: ChatThreadScope): Promise<readonly ChatThread[]> {
    return this.dependencies.repository.listThreads(scope);
  }

  async loadMessages(
    threadId: string,
    scope: ChatRuntimeScope,
  ): Promise<readonly ChatMessage[]> {
    assertThreadInScope(
      await this.dependencies.repository.getThread(threadId),
      scope,
    );
    return this.dependencies.repository.listMessages(threadId);
  }

  async listRuns(runIds: readonly string[]): Promise<readonly GenerationRun[]> {
    return this.dependencies.repository.listRuns(runIds);
  }

  async createThread(input: {
    readonly scope: ChatRuntimeScope;
    readonly title?: string | null;
  }): Promise<ChatThread> {
    const threads = await this.dependencies.repository.listThreads(input.scope);
    const now = this.dependencies.now();
    return this.dependencies.repository.createThread(
      createChatThread({
        branchId: input.scope.branchId,
        chatThreadId: this.dependencies.createThreadId(),
        conversationRevision: input.scope.expectedOwnerRevision,
        createdAt: now,
        order:
          threads.reduce(
            (highest, thread) => Math.max(highest, thread.order),
            -1,
          ) + 1,
        sessionId: input.scope.sessionId,
        subtitleId: input.scope.subtitleId,
        title: input.title ?? null,
        updatedAt: now,
      }),
    );
  }

  async renameThread(input: {
    readonly scope: ChatRuntimeScope;
    readonly threadId: string;
    readonly title: string | null;
  }): Promise<ChatThread> {
    assertThreadInScope(
      await this.dependencies.repository.getThread(input.threadId),
      input.scope,
    );
    return this.dependencies.repository.renameThread(
      input.threadId,
      input.title,
    );
  }

  async deleteThread(input: {
    readonly scope: ChatRuntimeScope;
    readonly threadId: string;
  }): Promise<ChatMutationCommit> {
    assertThreadInScope(
      await this.dependencies.repository.getThread(input.threadId),
      input.scope,
    );
    const commit = await this.dependencies.repository.deleteThread(
      input.threadId,
    );
    await this.abortAfterCommittedCancellation(commit.cancelledRuns);
    return commit;
  }

  async send(input: ChatSendInput): Promise<ChatGenerationHandle> {
    const thread = await this.dependencies.repository.getThread(input.threadId);
    assertThreadInScope(thread, input.scope);
    const messages = await this.dependencies.repository.listMessages(
      thread.chatThreadId,
    );
    const now = this.dependencies.now();
    const user = createChatMessage({
      chatThreadId: thread.chatThreadId,
      content: input.content.trim(),
      createdAt: now,
      generationRunId: null,
      messageId: this.dependencies.createMessageId(),
      order: nextMessageOrder(messages),
      role: "user",
      status: "complete",
      updatedAt: now,
    });
    const attachmentIds = Object.freeze([...(input.attachmentIds ?? [])]);
    let temporaryControlPrompt: string | undefined;
    if (input.temporaryControlPrompt !== undefined) {
      if (
        typeof input.temporaryControlPrompt !== "string" ||
        input.temporaryControlPrompt.length > 20_000 ||
        input.temporaryControlPrompt.trim().length === 0 ||
        hasUnsafeControlCharacter(input.temporaryControlPrompt)
      ) {
        throw new Error("The temporary Bilimuzhi control prompt is invalid");
      }
      temporaryControlPrompt = input.temporaryControlPrompt.trim();
    }
    const attachments = await this.resolveAttachmentHandles(
      attachmentIds,
      thread,
      input.scope,
    );
    const request = await this.groundedRequest(
      [...messages, user],
      input.generation,
      input.scope,
      attachments,
      temporaryControlPrompt,
    );
    return this.startForUser({
      onReasoning: input.onReasoning,
      request,
      scope: input.scope,
      thread,
      user,
      writeUser: true,
      ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
    });
  }

  async stop(inputRun: GenerationRun): Promise<ChatMessage | null> {
    const run = createGenerationRun(inputRun);
    if (run.kind !== "chat") {
      throw new Error("The generation run is not a chat task");
    }
    const stopped = await this.dependencies.tasks.stop(run);
    if (stopped === null) return null;
    const message =
      await this.dependencies.repository.applyAssistantRun(stopped);
    if (message !== null) {
      try {
        this.dependencies.onAssistantUpdate?.({
          message,
          run: stopped,
          threadId: stopped.targetId,
        });
      } catch {
        // Durable stop state cannot be rolled back by a UI notification error.
      }
    }
    return message;
  }

  async editAndResend(
    input: ChatMutationGenerationInput & { readonly content: string },
  ): Promise<ChatGenerationHandle> {
    const thread = await this.dependencies.repository.getThread(input.threadId);
    assertThreadInScope(thread, input.scope);
    const commit = await this.dependencies.repository.truncate({
      chatThreadId: thread.chatThreadId,
      editedContent: input.content,
      expectedConversationRevision: input.scope.expectedOwnerRevision,
      intent: "edit-user",
      targetMessageId: input.targetMessageId,
    });
    await this.abortAfterCommittedCancellation(commit.cancelledRuns);
    if (commit.thread === null || commit.replacementMessage === null) {
      throw new Error("The Bilimuzhi chat edit could not be committed");
    }
    const nextScope = {
      ...input.scope,
      expectedOwnerRevision: commit.thread.conversationRevision,
    };
    const messages = await this.dependencies.repository.listMessages(
      thread.chatThreadId,
    );
    return this.startForUser({
      onReasoning: input.onReasoning,
      request: await this.groundedRequest(
        messages,
        input.generation,
        nextScope,
      ),
      scope: nextScope,
      thread: commit.thread,
      user: commit.replacementMessage,
      writeUser: false,
    });
  }

  async regenerate(
    input: ChatMutationGenerationInput,
  ): Promise<ChatGenerationHandle> {
    const thread = await this.dependencies.repository.getThread(input.threadId);
    assertThreadInScope(thread, input.scope);
    const before = await this.dependencies.repository.listMessages(
      thread.chatThreadId,
    );
    const targetIndex = before.findIndex(
      (message) => message.messageId === input.targetMessageId,
    );
    const user = targetIndex > 0 ? before[targetIndex - 1] : undefined;
    if (user?.role !== "user") {
      throw new Error("The Bilimuzhi chat regenerate prompt does not exist");
    }
    const commit = await this.dependencies.repository.truncate({
      chatThreadId: thread.chatThreadId,
      expectedConversationRevision: input.scope.expectedOwnerRevision,
      intent: "regenerate-assistant",
      targetMessageId: input.targetMessageId,
    });
    await this.abortAfterCommittedCancellation(commit.cancelledRuns);
    if (commit.thread === null) {
      throw new Error("The Bilimuzhi chat regeneration could not be committed");
    }
    const nextScope = {
      ...input.scope,
      expectedOwnerRevision: commit.thread.conversationRevision,
    };
    const messages = await this.dependencies.repository.listMessages(
      thread.chatThreadId,
    );
    return this.startForUser({
      onReasoning: input.onReasoning,
      request: await this.groundedRequest(
        messages,
        input.generation,
        nextScope,
      ),
      scope: nextScope,
      thread: commit.thread,
      user,
      writeUser: false,
    });
  }

  retry(input: ChatMutationGenerationInput): Promise<ChatGenerationHandle> {
    return this.regenerate(input);
  }

  private async startForUser(input: {
    readonly attachmentIds?: readonly string[];
    readonly onReasoning?: (update: ChatReasoningUpdate) => void;
    readonly request: AiGenerationRequest;
    readonly scope: ChatRuntimeScope;
    readonly thread: ChatThread;
    readonly user: ChatMessage;
    readonly writeUser: boolean;
  }): Promise<ChatGenerationHandle> {
    const owner = createOwner(
      input.thread,
      input.scope,
      this.dependencies.createTaskId(),
    );
    const [promptHash, modelHash, contextHash] = await Promise.all([
      createGenerationSnapshotHash(input.request.messages),
      createGenerationSnapshotHash({
        model: input.request.model,
        reasoningEffort: input.request.reasoningEffort,
      }),
      createGenerationSnapshotHash({
        attachments: input.request.attachments ?? [],
        kind: input.request.kind,
        scope: input.scope,
        threadId: input.thread.chatThreadId,
      }),
    ]);
    const run = await this.dependencies.tasks.start({
      ...owner,
      contextHash,
      conversationRevision: input.thread.conversationRevision,
      modelHash,
      promptHash,
      runRevision: 0,
    });
    try {
      const existing = await this.dependencies.repository.listMessages(
        input.thread.chatThreadId,
      );
      const now = this.dependencies.now();
      const assistant = createChatMessage({
        chatThreadId: input.thread.chatThreadId,
        content: "",
        createdAt: now,
        generationRunId: run.runId,
        messageId: this.dependencies.createMessageId(),
        order: nextMessageOrder(existing) + (input.writeUser ? 1 : 0),
        role: "assistant",
        status: "streaming",
        updatedAt: now,
      });
      if (input.writeUser) {
        await this.dependencies.repository.appendTurn(
          input.user,
          assistant,
          input.attachmentIds === undefined
            ? undefined
            : {
                attachmentIds: input.attachmentIds,
                owner: {
                  branchId: input.scope.branchId,
                  chatThreadId: input.thread.chatThreadId,
                  sessionId: input.scope.sessionId,
                  subtitleContextRevision: input.scope.contextRevision,
                  subtitleId: input.scope.subtitleId,
                },
              },
        );
      } else {
        await this.dependencies.repository.appendMessage(assistant);
      }
      let latestAssistant = assistant;
      const updateAssistant = async (
        updatedRun: GenerationRun,
      ): Promise<ChatMessage | null> => {
        const updated =
          await this.dependencies.repository.applyAssistantRun(updatedRun);
        if (updated !== null) {
          latestAssistant = updated;
          try {
            this.dependencies.onAssistantUpdate?.({
              message: updated,
              run: updatedRun,
              threadId: input.thread.chatThreadId,
            });
          } catch {
            // UI/runtime notifications cannot affect durable execution.
          }
        }
        return updated;
      };
      let executionRun = run;
      for (const status of ["preparing", "requesting"] as const) {
        const persisted = await this.dependencies.tasks.applyEvent({
          ...eventContext(run),
          payload: { status },
          type: "muzhi.generation.status",
        });
        if (persisted !== null) {
          executionRun = persisted;
          await updateAssistant(persisted);
        }
      }
      const completion = this.consumeStream({
        onReasoning: input.onReasoning,
        readLatestAssistant: () => latestAssistant,
        request: input.request,
        run: executionRun,
        threadId: input.thread.chatThreadId,
        updateAssistant,
      });
      return Object.freeze({
        assistant,
        completion,
        run,
        user: input.user,
        stop: async () => {
          const stopped = await this.dependencies.tasks.stop(run);
          return stopped === null ? null : updateAssistant(stopped);
        },
      });
    } catch (error) {
      await this.dependencies.tasks.stop(run);
      throw error;
    }
  }

  private async consumeStream(input: {
    readonly onReasoning?: (update: ChatReasoningUpdate) => void;
    readonly readLatestAssistant: () => ChatMessage;
    readonly request: AiGenerationRequest;
    readonly run: GenerationRun;
    readonly threadId: string;
    readonly updateAssistant: (
      run: GenerationRun,
    ) => Promise<ChatMessage | null>;
  }): Promise<ChatGenerationResult> {
    let terminal = false;
    let failureCode = "INTERNAL_ERROR";
    let latestRun: GenerationRun | null = input.run;
    const providerImages: SanitizedProviderImageOutput[] = [];
    let providerImageBytes = 0;
    const applyPhase = async (
      status:
        "preparing" | "requesting" | "streaming" | "validating" | "saving",
    ): Promise<void> => {
      const persisted = await this.dependencies.tasks.applyEvent({
        ...eventContext(input.run),
        payload: { status },
        type: "muzhi.generation.status",
      });
      if (persisted !== null) {
        latestRun = persisted;
        await input.updateAssistant(persisted);
      }
    };
    try {
      const providerStream = this.dependencies.provider.stream(input.request);
      const iterator = providerStream[Symbol.asyncIterator]();
      let nextEvent = await iterator.next();
      while (!nextEvent.done) {
        const event = nextEvent.value;
        switch (event.type) {
          case "image-output": {
            if (
              this.dependencies.processImageOutput === undefined ||
              this.dependencies.repository.commitAssistantImageOutputs ===
                undefined ||
              providerImages.length >= IMAGE_ATTACHMENT_MAX_COUNT
            ) {
              throw Object.assign(
                new Error("The Provider image output could not be accepted"),
                { code: "IMAGE_OUTPUT_REJECTED" },
              );
            }
            const image = await this.dependencies.processImageOutput(
              event.descriptor,
            );
            providerImageBytes += image.blob.size;
            if (providerImageBytes > IMAGE_ATTACHMENT_MAX_TOTAL_BYTES) {
              throw Object.assign(
                new Error("The Provider image output could not be accepted"),
                { code: "IMAGE_OUTPUT_REJECTED" },
              );
            }
            providerImages.push(image);
            nextEvent = await iterator.next();
            continue;
          }
          default:
            break;
        }
        if (event.type === "reasoning") {
          try {
            input.onReasoning?.({
              runId: input.run.runId,
              text: event.delta,
              threadId: input.threadId,
            });
          } catch {
            // Transient UI callbacks cannot affect durable execution.
          }
          nextEvent = await iterator.next();
          continue;
        }
        if (event.type === "started") {
          await applyPhase("streaming");
          nextEvent = await iterator.next();
          continue;
        }
        if (event.type === "completed") {
          await applyPhase("validating");
          await applyPhase("saving");
        }
        const runtimeEvent = toRuntimeEvent(input.run, event);
        if (runtimeEvent === null) {
          nextEvent = await iterator.next();
          continue;
        }
        const persisted =
          await this.dependencies.tasks.applyEvent(runtimeEvent);
        if (persisted === null) {
          // run 已被外部终止（如会话删除的 owner-deleted 停止）：
          // 立即退出流式循环，不再消费 provider 响应。
          terminal = true;
          break;
        }
        latestRun = persisted;
        await input.updateAssistant(persisted);
        if (
          event.type === "completed" &&
          providerImages.length > 0 &&
          persisted.status === "completed"
        ) {
          const committed =
            await this.dependencies.repository.commitAssistantImageOutputs?.({
              images: providerImages,
              messageId: input.readLatestAssistant().messageId,
              run: persisted,
            });
          if (committed === null || committed === undefined) {
            terminal = true;
            break;
          }
        }
        if (
          persisted.status === "completed" ||
          persisted.status === "failed" ||
          persisted.status === "interrupted" ||
          persisted.status === "stopped" ||
          persisted.status === "cancelled"
        ) {
          terminal = true;
          break;
        }
        nextEvent = await iterator.next();
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        Reflect.get(error, "code") === "IMAGE_OUTPUT_REJECTED"
      ) {
        failureCode = "IMAGE_OUTPUT_REJECTED";
      } else if (error instanceof AiProviderError) {
        // Provider 拒绝（如模型不支持图片输入）映射为稳定失败码，
        // 让失败投影给出可操作的文案而不是笼统的内部错误。
        const code = error.code as AiProviderErrorCode;
        if ((GENERATION_FAILURE_CODES as readonly string[]).includes(code)) {
          failureCode = code;
        }
      }
      // Provider exceptions are reduced to a stable failure below.
    }
    if (!terminal) {
      const failed = await this.dependencies.tasks.applyEvent({
        ...eventContext(input.run),
        payload: { errorCode: failureCode },
        type: "muzhi.generation.failed",
      });
      if (failed !== null) {
        latestRun = failed;
        await input.updateAssistant(failed);
      }
    }
    return Object.freeze({
      assistant: input.readLatestAssistant(),
      run: latestRun,
    });
  }

  private async abortAfterCommittedCancellation(
    cancelledRuns: readonly GenerationRun[],
  ): Promise<void> {
    if (this.dependencies.abortCancelledRun === undefined) return;
    await Promise.all(
      cancelledRuns.map(async (run) => {
        try {
          await this.dependencies.abortCancelledRun?.(run);
        } catch {
          // The committed owner/revision guard rejects every late event.
        }
      }),
    );
  }
}

export function createChatRuntime(
  dependencies: ChatRuntimeDependencies,
): ChatRuntime {
  return new DefaultChatRuntime(dependencies);
}
