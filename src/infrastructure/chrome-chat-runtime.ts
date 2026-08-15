import {
  createAiGenerationRequest,
  createAiModelDescriptor,
  type AiModelDescriptor,
} from "../application/ai/provider-contract";
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError,
  type AiProviderErrorCode,
} from "../application/ai/provider-error";
import type {
  ChatMutationCommit,
  ChatThreadScope,
} from "../application/chat-repository";
import type {
  ChatAssistantUpdate,
  ChatGenerationOptions,
  ChatReasoningUpdate,
  ChatRuntime,
  ChatRuntimeScope,
} from "../application/chat-runtime";
import {
  createChatMessage,
  createChatThread,
  createGenerationRun,
  type ChatMessage,
  type ChatThread,
  type GenerationRun,
} from "../domain";

const CHAT_RUNTIME_PROTOCOL_VERSION = 1 as const;

type ChatCommandType =
  | "muzhi.chat.models.discover"
  | "muzhi.chat.threads.list"
  | "muzhi.chat.messages.list"
  | "muzhi.chat.runs.list"
  | "muzhi.chat.thread.create"
  | "muzhi.chat.thread.rename"
  | "muzhi.chat.thread.delete"
  | "muzhi.chat.send"
  | "muzhi.chat.edit-and-resend"
  | "muzhi.chat.regenerate"
  | "muzhi.chat.retry"
  | "muzhi.chat.stop";

interface ChatCommand {
  readonly payload: Record<string, unknown>;
  readonly protocolVersion: typeof CHAT_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: ChatCommandType;
}

interface ChatSuccessResponse {
  readonly payload: { readonly data: unknown; readonly ok: true };
  readonly protocolVersion: typeof CHAT_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: "muzhi.chat.response";
}

interface ChatFailureResponse {
  readonly payload: {
    readonly errorCode: AiProviderErrorCode;
    readonly ok: false;
  };
  readonly protocolVersion: typeof CHAT_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: "muzhi.chat.response";
}

type ChatResponse = ChatFailureResponse | ChatSuccessResponse;

export type ChromeChatRuntimeEvent =
  | {
      readonly payload: ChatAssistantUpdate;
      readonly protocolVersion: typeof CHAT_RUNTIME_PROTOCOL_VERSION;
      readonly type: "muzhi.chat.assistant.updated";
    }
  | {
      readonly payload: ChatReasoningUpdate;
      readonly protocolVersion: typeof CHAT_RUNTIME_PROTOCOL_VERSION;
      readonly type: "muzhi.chat.reasoning";
    };

export interface ChromeChatGenerationResult {
  readonly assistant: ChatMessage;
  readonly run: GenerationRun;
  readonly user: ChatMessage;
}

export interface ChromeChatRuntimeClient {
  discoverModels(): Promise<readonly AiModelDescriptor[]>;
  listThreads(scope: ChatThreadScope): Promise<readonly ChatThread[]>;
  listMessages(
    threadId: string,
    scope: ChatRuntimeScope,
  ): Promise<readonly ChatMessage[]>;
  /** 按精确 runId 读取持久化 run（历史失败消息的投影来源）。 */
  listRuns(runIds: readonly string[]): Promise<readonly GenerationRun[]>;
  createThread(
    scope: ChatRuntimeScope,
    title?: string | null,
  ): Promise<ChatThread>;
  renameThread(
    scope: ChatRuntimeScope,
    threadId: string,
    title: string | null,
  ): Promise<ChatThread>;
  deleteThread(
    scope: ChatRuntimeScope,
    threadId: string,
  ): Promise<ChatMutationCommit>;
  send(input: {
    readonly attachmentIds?: readonly string[];
    readonly content: string;
    readonly generation: ChatGenerationOptions;
    readonly scope: ChatRuntimeScope;
    readonly temporaryControlPrompt?: string;
    readonly threadId: string;
  }): Promise<ChromeChatGenerationResult>;
  editAndResend(input: {
    readonly content: string;
    readonly generation: ChatGenerationOptions;
    readonly scope: ChatRuntimeScope;
    readonly targetMessageId: string;
    readonly threadId: string;
  }): Promise<ChromeChatGenerationResult>;
  regenerate(input: {
    readonly generation: ChatGenerationOptions;
    readonly scope: ChatRuntimeScope;
    readonly targetMessageId: string;
    readonly threadId: string;
  }): Promise<ChromeChatGenerationResult>;
  retry(input: {
    readonly generation: ChatGenerationOptions;
    readonly scope: ChatRuntimeScope;
    readonly targetMessageId: string;
    readonly threadId: string;
  }): Promise<ChromeChatGenerationResult>;
  stop(run: GenerationRun): Promise<ChatMessage | null>;
  subscribe(listener: (event: ChromeChatRuntimeEvent) => void): () => void;
}

export interface ChromeChatRuntimeClientOptions {
  readonly recordImageCapabilityEvidence?: (input: {
    readonly evidence:
      | { readonly outcome: "success" }
      | {
          readonly classification: "image-input";
          readonly code: "UNSUPPORTED_CAPABILITY";
          readonly outcome: "failure";
        };
    readonly modelId: string;
    readonly profileId: string;
  }) => Promise<unknown> | unknown;
}

export interface ChromeChatRuntimeListenerDependencies {
  readonly discoverModels: () => Promise<readonly AiModelDescriptor[]>;
  readonly getRuntime: (
    onAssistantUpdate: (update: ChatAssistantUpdate) => void,
  ) => Promise<ChatRuntime>;
}

interface ChromeRuntimeApi {
  readonly onMessage: {
    addListener(listener: MessageListener): void;
    removeListener?(listener: MessageListener): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
}

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
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

function readRuntime(chromeValue: unknown): ChromeRuntimeApi {
  if (!isRecord(chromeValue))
    throw new Error("Chrome chat runtime is unavailable");
  const runtime = Reflect.get(chromeValue, "runtime") as unknown;
  const onMessage = isRecord(runtime)
    ? Reflect.get(runtime, "onMessage")
    : null;
  const addListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "addListener")
    : null;
  const removeListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "removeListener")
    : null;
  const sendMessage = isRecord(runtime)
    ? Reflect.get(runtime, "sendMessage")
    : null;
  if (
    !isRecord(runtime) ||
    !isRecord(onMessage) ||
    typeof addListener !== "function" ||
    typeof sendMessage !== "function"
  ) {
    throw new Error("Chrome chat runtime is unavailable");
  }
  const api: ChromeRuntimeApi = {
    onMessage: Object.freeze({
      addListener(listener: MessageListener): void {
        Reflect.apply(addListener, onMessage, [listener]);
      },
      removeListener:
        typeof removeListener === "function"
          ? (listener: MessageListener): void => {
              Reflect.apply(removeListener, onMessage, [listener]);
            }
          : undefined,
    }),
    async sendMessage(message: unknown): Promise<unknown> {
      return Reflect.apply(sendMessage, runtime, [message]);
    },
  };
  return Object.freeze(api);
}

function scope(value: unknown): ChatRuntimeScope | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "sessionId",
      "branchId",
      "subtitleId",
      "contextRevision",
      "expectedOwnerRevision",
    ])
  )
    return null;
  if (
    !safeId(value.sessionId) ||
    !safeId(value.branchId) ||
    !safeId(value.subtitleId) ||
    !Number.isSafeInteger(value.contextRevision) ||
    Number(value.contextRevision) <= 0 ||
    !Number.isSafeInteger(value.expectedOwnerRevision) ||
    Number(value.expectedOwnerRevision) < 0
  )
    return null;
  const result: ChatRuntimeScope = {
    branchId: value.branchId,
    contextRevision: value.contextRevision as number,
    expectedOwnerRevision: value.expectedOwnerRevision as number,
    sessionId: value.sessionId,
    subtitleId: value.subtitleId,
  };
  return Object.freeze(result);
}

function generation(value: unknown): ChatGenerationOptions | null {
  if (!isRecord(value) || !exactKeys(value, ["model", "reasoningEffort"]))
    return null;
  try {
    const validated = createAiGenerationRequest({
      kind: "chat",
      messages: [{ content: "validation", role: "user" }],
      model: value.model as AiModelDescriptor,
      reasoningEffort:
        value.reasoningEffort as ChatGenerationOptions["reasoningEffort"],
    });
    return Object.freeze({
      model: validated.model,
      reasoningEffort: validated.reasoningEffort,
    });
  } catch {
    return null;
  }
}

function attachmentIds(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || value.length > 6) return null;
  if (!value.every(safeId) || new Set(value).size !== value.length) return null;
  return Object.freeze([...value]);
}

function temporaryControlPrompt(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= 20_000 &&
    value.trim().length > 0 &&
    !hasUnsafeControlCharacter(value)
    ? value.trim()
    : null;
}

function isChatCommand(value: unknown): value is ChatCommand {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["protocolVersion", "requestId", "type", "payload"]) ||
    value.protocolVersion !== CHAT_RUNTIME_PROTOCOL_VERSION ||
    !safeId(value.requestId) ||
    !isRecord(value.payload)
  )
    return false;
  const type = value.type;
  if (type === "muzhi.chat.models.discover")
    return exactKeys(value.payload, []);
  if (type === "muzhi.chat.threads.list")
    return (
      exactKeys(value.payload, ["scope"]) && scope(value.payload.scope) !== null
    );
  if (type === "muzhi.chat.messages.list")
    return (
      exactKeys(value.payload, ["scope", "threadId"]) &&
      scope(value.payload.scope) !== null &&
      safeId(value.payload.threadId)
    );
  if (type === "muzhi.chat.runs.list") {
    const runIds = value.payload.runIds;
    return (
      exactKeys(value.payload, ["runIds"]) &&
      Array.isArray(runIds) &&
      runIds.every((runId) => safeId(runId)) &&
      new Set(runIds as string[]).size === (runIds as string[]).length
    );
  }
  if (type === "muzhi.chat.thread.create")
    return (
      exactKeys(value.payload, ["scope", "title"]) &&
      scope(value.payload.scope) !== null &&
      (value.payload.title === null ||
        (typeof value.payload.title === "string" &&
          value.payload.title.length <= 256))
    );
  if (type === "muzhi.chat.thread.rename")
    return (
      exactKeys(value.payload, ["scope", "threadId", "title"]) &&
      scope(value.payload.scope) !== null &&
      safeId(value.payload.threadId) &&
      (value.payload.title === null ||
        (typeof value.payload.title === "string" &&
          value.payload.title.length <= 256))
    );
  if (type === "muzhi.chat.thread.delete")
    return (
      exactKeys(value.payload, ["scope", "threadId"]) &&
      scope(value.payload.scope) !== null &&
      safeId(value.payload.threadId)
    );
  if (type === "muzhi.chat.stop") {
    try {
      createGenerationRun(value.payload.run as GenerationRun);
      return exactKeys(value.payload, ["run"]);
    } catch {
      return false;
    }
  }
  const common =
    scope(value.payload.scope) !== null &&
    safeId(value.payload.threadId) &&
    generation(value.payload.generation) !== null;
  if (type === "muzhi.chat.send")
    return (
      Object.keys(value.payload).every((key) =>
        [
          "scope",
          "threadId",
          "content",
          "generation",
          "attachmentIds",
          "temporaryControlPrompt",
        ].includes(key),
      ) &&
      ["scope", "threadId", "content", "generation"].every((key) =>
        Object.prototype.hasOwnProperty.call(value.payload, key),
      ) &&
      (value.payload.attachmentIds === undefined ||
        attachmentIds(value.payload.attachmentIds) !== null) &&
      (value.payload.temporaryControlPrompt === undefined ||
        temporaryControlPrompt(value.payload.temporaryControlPrompt) !==
          null) &&
      common &&
      typeof value.payload.content === "string" &&
      (value.payload.content.trim().length > 0 ||
        (value.payload.attachmentIds !== undefined &&
          attachmentIds(value.payload.attachmentIds)!.length > 0))
    );
  if (type === "muzhi.chat.edit-and-resend")
    return (
      exactKeys(value.payload, [
        "scope",
        "threadId",
        "targetMessageId",
        "content",
        "generation",
      ]) &&
      common &&
      safeId(value.payload.targetMessageId) &&
      typeof value.payload.content === "string" &&
      value.payload.content.trim().length > 0
    );
  if (type === "muzhi.chat.regenerate" || type === "muzhi.chat.retry")
    return (
      exactKeys(value.payload, [
        "scope",
        "threadId",
        "targetMessageId",
        "generation",
      ]) &&
      common &&
      safeId(value.payload.targetMessageId)
    );
  return false;
}

function success(requestId: string, data: unknown): ChatSuccessResponse {
  return Object.freeze({
    payload: Object.freeze({ data, ok: true as const }),
    protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
    requestId,
    type: "muzhi.chat.response" as const,
  });
}

function failure(requestId: string, error: unknown): ChatFailureResponse {
  return Object.freeze({
    payload: Object.freeze({
      errorCode:
        error instanceof AiProviderError ? error.code : "INTERNAL_ERROR",
      ok: false as const,
    }),
    protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
    requestId,
    type: "muzhi.chat.response" as const,
  });
}

function generationResult(
  handle: Awaited<ReturnType<ChatRuntime["send"]>>,
): ChromeChatGenerationResult {
  return Object.freeze({
    assistant: handle.assistant,
    run: handle.run,
    user: handle.user,
  });
}

export function installChromeChatRuntimeListener(
  chromeValue: unknown,
  dependencies: ChromeChatRuntimeListenerDependencies,
): void {
  const runtimeApi = readRuntime(chromeValue);
  const handles = new Map<string, Awaited<ReturnType<ChatRuntime["send"]>>>();
  const publish = async (event: ChromeChatRuntimeEvent): Promise<void> => {
    try {
      await runtimeApi.sendMessage(event);
    } catch {
      // Durable chat state remains available when the Side Panel is closed.
    }
  };
  const onAssistantUpdate = (update: ChatAssistantUpdate): void => {
    void publish({
      payload: update,
      protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
      type: "muzhi.chat.assistant.updated",
    });
  };
  const onReasoning = (update: ChatReasoningUpdate): void => {
    void publish({
      payload: update,
      protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
      type: "muzhi.chat.reasoning",
    });
  };

  const execute = async (command: ChatCommand): Promise<unknown> => {
    if (command.type === "muzhi.chat.models.discover")
      return dependencies.discoverModels();
    const chat = await dependencies.getRuntime(onAssistantUpdate);
    const inputScope = scope(command.payload.scope);
    switch (command.type) {
      case "muzhi.chat.threads.list":
        return chat.load(inputScope!);
      case "muzhi.chat.messages.list":
        return chat.loadMessages(
          command.payload.threadId as string,
          inputScope!,
        );
      case "muzhi.chat.runs.list":
        return chat.listRuns(command.payload.runIds as string[]);
      case "muzhi.chat.thread.create":
        return chat.createThread({
          scope: inputScope!,
          title: command.payload.title as string | null,
        });
      case "muzhi.chat.thread.rename":
        return chat.renameThread({
          scope: inputScope!,
          threadId: command.payload.threadId as string,
          title: command.payload.title as string | null,
        });
      case "muzhi.chat.thread.delete":
        return chat.deleteThread({
          scope: inputScope!,
          threadId: command.payload.threadId as string,
        });
      case "muzhi.chat.send": {
        const handle = await chat.send({
          ...(command.payload.attachmentIds === undefined
            ? {}
            : {
                attachmentIds: attachmentIds(command.payload.attachmentIds)!,
              }),
          content: command.payload.content as string,
          generation: generation(command.payload.generation)!,
          onReasoning,
          scope: inputScope!,
          ...(command.payload.temporaryControlPrompt === undefined
            ? {}
            : {
                temporaryControlPrompt: temporaryControlPrompt(
                  command.payload.temporaryControlPrompt,
                )!,
              }),
          threadId: command.payload.threadId as string,
        });
        handles.set(handle.run.taskId, handle);
        void handle.completion.finally(() => handles.delete(handle.run.taskId));
        return generationResult(handle);
      }
      case "muzhi.chat.edit-and-resend": {
        const handle = await chat.editAndResend({
          content: command.payload.content as string,
          generation: generation(command.payload.generation)!,
          onReasoning,
          scope: inputScope!,
          targetMessageId: command.payload.targetMessageId as string,
          threadId: command.payload.threadId as string,
        });
        handles.set(handle.run.taskId, handle);
        void handle.completion.finally(() => handles.delete(handle.run.taskId));
        return generationResult(handle);
      }
      case "muzhi.chat.regenerate":
      case "muzhi.chat.retry": {
        const method =
          command.type === "muzhi.chat.retry"
            ? chat.retry.bind(chat)
            : chat.regenerate.bind(chat);
        const handle = await method({
          generation: generation(command.payload.generation)!,
          onReasoning,
          scope: inputScope!,
          targetMessageId: command.payload.targetMessageId as string,
          threadId: command.payload.threadId as string,
        });
        handles.set(handle.run.taskId, handle);
        void handle.completion.finally(() => handles.delete(handle.run.taskId));
        return generationResult(handle);
      }
      case "muzhi.chat.stop": {
        const stored = createGenerationRun(
          command.payload.run as GenerationRun,
        );
        const localHandle = handles.get(stored.taskId);
        return localHandle === undefined
          ? chat.stop(stored)
          : localHandle.stop();
      }
      default:
        return null;
    }
  };

  runtimeApi.onMessage.addListener(
    (message, _sender, sendResponse): boolean => {
      if (!isChatCommand(message)) return false;
      const command = message;
      void execute(command).then(
        (data) => sendResponse(success(command.requestId, data)),
        (error: unknown) => sendResponse(failure(command.requestId, error)),
      );
      return true;
    },
  );
}

/**
 * 协议层错误：SW 未响应或响应格式无效。消息是面向用户的稳定中文文案，
 * 不含内部细节，可安全显示。
 */
export class ChatProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProtocolError";
  }
}

function isResponse(value: unknown, requestId: string): value is ChatResponse {
  return (
    isRecord(value) &&
    exactKeys(value, ["protocolVersion", "requestId", "type", "payload"]) &&
    value.protocolVersion === CHAT_RUNTIME_PROTOCOL_VERSION &&
    value.requestId === requestId &&
    value.type === "muzhi.chat.response" &&
    isRecord(value.payload) &&
    ((exactKeys(value.payload, ["ok", "data"]) && value.payload.ok === true) ||
      (exactKeys(value.payload, ["ok", "errorCode"]) &&
        value.payload.ok === false &&
        typeof value.payload.errorCode === "string" &&
        (AI_PROVIDER_ERROR_CODES as readonly string[]).includes(
          value.payload.errorCode,
        )))
  );
}

function isChatEvent(value: unknown): value is ChromeChatRuntimeEvent {
  if (
    !isRecord(value) ||
    value.protocolVersion !== CHAT_RUNTIME_PROTOCOL_VERSION ||
    !isRecord(value.payload)
  )
    return false;
  if (value.type === "muzhi.chat.reasoning")
    return (
      safeId(value.payload.runId) &&
      safeId(value.payload.threadId) &&
      typeof value.payload.text === "string" &&
      value.payload.text.length <= 2_000_000
    );
  if (value.type === "muzhi.chat.assistant.updated") {
    try {
      createChatMessage(value.payload.message as ChatMessage);
      createGenerationRun(value.payload.run as GenerationRun);
      return safeId(value.payload.threadId);
    } catch {
      return false;
    }
  }
  return false;
}

export function createChromeChatRuntimeClient(
  chromeValue: unknown,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
  options: ChromeChatRuntimeClientOptions = {},
): ChromeChatRuntimeClient {
  const runtimeApi = readRuntime(chromeValue);
  const attachedRuns = new Map<
    string,
    { readonly modelId: string; readonly profileId: string }
  >();
  const earlyTerminalRuns = new Map<
    string,
    Pick<GenerationRun, "errorCode" | "runId" | "status">
  >();

  const isTerminalRun = (run: GenerationRun): boolean =>
    run.status === "stopped" ||
    run.status === "cancelled" ||
    run.status === "completed" ||
    run.status === "interrupted" ||
    run.status === "failed";

  const notifyAttachedRunEvidence = (
    run: Pick<GenerationRun, "errorCode" | "runId" | "status">,
  ): void => {
    const identity = attachedRuns.get(run.runId);
    if (identity === undefined) return;
    attachedRuns.delete(run.runId);
    const evidence =
      run.status === "completed"
        ? ({ outcome: "success" } as const)
        : run.status === "failed" && run.errorCode === "UNSUPPORTED_CAPABILITY"
          ? ({
              classification: "image-input",
              code: "UNSUPPORTED_CAPABILITY",
              outcome: "failure",
            } as const)
          : null;
    if (
      evidence === null ||
      options.recordImageCapabilityEvidence === undefined
    )
      return;
    try {
      void Promise.resolve(
        options.recordImageCapabilityEvidence({
          evidence,
          modelId: identity.modelId,
          profileId: identity.profileId,
        }),
      ).catch(() => undefined);
    } catch {
      // Capability caching is best-effort and must never disrupt chat events.
    }
  };

  if (options.recordImageCapabilityEvidence !== undefined) {
    runtimeApi.onMessage.addListener((message): boolean => {
      if (
        !isChatEvent(message) ||
        message.type !== "muzhi.chat.assistant.updated" ||
        !isTerminalRun(message.payload.run)
      ) {
        return false;
      }
      if (attachedRuns.has(message.payload.run.runId)) {
        notifyAttachedRunEvidence(message.payload.run);
        return false;
      }
      // A very fast Provider can finish before the send acknowledgement reaches
      // the panel. Retain only a bounded normalized terminal projection until
      // that acknowledgement supplies the frozen attached-run identity.
      if (earlyTerminalRuns.size >= 32) {
        const oldest = earlyTerminalRuns.keys().next().value;
        if (oldest !== undefined) earlyTerminalRuns.delete(oldest);
      }
      earlyTerminalRuns.set(message.payload.run.runId, {
        errorCode: message.payload.run.errorCode,
        runId: message.payload.run.runId,
        status: message.payload.run.status,
      });
      return false;
    });
  }

  const registerAttachedRun = (
    result: ChromeChatGenerationResult,
    input: {
      readonly attachmentIds?: readonly string[];
      readonly generation: ChatGenerationOptions;
    },
  ): void => {
    const earlyTerminal = earlyTerminalRuns.get(result.run.runId);
    earlyTerminalRuns.delete(result.run.runId);
    if (
      options.recordImageCapabilityEvidence === undefined ||
      !input.attachmentIds ||
      input.attachmentIds.length === 0
    ) {
      return;
    }
    attachedRuns.set(result.run.runId, {
      modelId: input.generation.model.modelId,
      profileId: input.generation.model.providerId,
    });
    if (earlyTerminal !== undefined) notifyAttachedRunEvidence(earlyTerminal);
  };

  const send = async (
    type: ChatCommandType,
    payload: Record<string, unknown>,
  ): Promise<unknown> => {
    const requestId = createRequestId();
    let response: unknown;
    try {
      response = await runtimeApi.sendMessage({
        payload,
        protocolVersion: CHAT_RUNTIME_PROTOCOL_VERSION,
        requestId,
        type,
      });
    } catch {
      throw new AiProviderError(
        "INTERNAL_ERROR",
        "无法连接Bilimuzhi AI 后台，请重试。",
        true,
      );
    }
    if (!isResponse(response, requestId))
      throw new ChatProtocolError(
        "Bilimuzhi AI 后台响应无效；请重新加载扩展后再试。",
      );
    if (!response.payload.ok) {
      throw new AiProviderError(
        response.payload.errorCode,
        "Bilimuzhi AI Provider 请求失败。",
        response.payload.errorCode === "RATE_LIMITED" ||
          response.payload.errorCode === "TIMEOUT" ||
          response.payload.errorCode === "NETWORK_ERROR" ||
          response.payload.errorCode === "INTERNAL_ERROR",
      );
    }
    return response.payload.data;
  };
  const readThread = (value: unknown): ChatThread =>
    createChatThread(value as ChatThread);
  const readMessage = (value: unknown): ChatMessage =>
    createChatMessage(value as ChatMessage);
  const readResult = (value: unknown): ChromeChatGenerationResult => {
    if (!isRecord(value))
      throw new ChatProtocolError(
        "Bilimuzhi AI 生成响应无效；请重新加载扩展后再试。",
      );
    return Object.freeze({
      assistant: readMessage(value.assistant),
      run: createGenerationRun(value.run as GenerationRun),
      user: readMessage(value.user),
    });
  };
  const client: ChromeChatRuntimeClient = {
    async discoverModels() {
      const data = await send("muzhi.chat.models.discover", {});
      if (!Array.isArray(data))
        throw new ChatProtocolError(
          "Bilimuzhi AI 模型响应无效；请重新加载扩展后再试。",
        );
      return Object.freeze(
        data.map((value) =>
          createAiModelDescriptor(value as AiModelDescriptor),
        ),
      );
    },
    async listThreads(inputScope) {
      const data = await send("muzhi.chat.threads.list", { scope: inputScope });
      if (!Array.isArray(data))
        throw new ChatProtocolError(
          "Bilimuzhi AI 对话响应无效；请重新加载扩展后再试。",
        );
      return Object.freeze(data.map(readThread));
    },
    async listMessages(threadId, inputScope) {
      const data = await send("muzhi.chat.messages.list", {
        scope: inputScope,
        threadId,
      });
      if (!Array.isArray(data))
        throw new ChatProtocolError(
          "Bilimuzhi AI 消息响应无效；请重新加载扩展后再试。",
        );
      return Object.freeze(data.map(readMessage));
    },
    async listRuns(runIds) {
      const data = await send("muzhi.chat.runs.list", { runIds });
      if (!Array.isArray(data))
        throw new ChatProtocolError(
          "Bilimuzhi AI 任务响应无效；请重新加载扩展后再试。",
        );
      return Object.freeze(
        data.map((value) => createGenerationRun(value as GenerationRun)),
      );
    },
    async createThread(inputScope, title = null) {
      return readThread(
        await send("muzhi.chat.thread.create", { scope: inputScope, title }),
      );
    },
    async renameThread(inputScope, threadId, title) {
      return readThread(
        await send("muzhi.chat.thread.rename", {
          scope: inputScope,
          threadId,
          title,
        }),
      );
    },
    async deleteThread(inputScope, threadId) {
      return (await send("muzhi.chat.thread.delete", {
        scope: inputScope,
        threadId,
      })) as ChatMutationCommit;
    },
    async send(input) {
      const result = readResult(await send("muzhi.chat.send", input));
      registerAttachedRun(result, input);
      return result;
    },
    async editAndResend(input) {
      return readResult(await send("muzhi.chat.edit-and-resend", input));
    },
    async regenerate(input) {
      return readResult(await send("muzhi.chat.regenerate", input));
    },
    async retry(input) {
      return readResult(await send("muzhi.chat.retry", input));
    },
    async stop(runValue) {
      const data = await send("muzhi.chat.stop", { run: runValue });
      return data === null ? null : readMessage(data);
    },
    subscribe(listener) {
      const runtimeListener: MessageListener = (message) => {
        if (isChatEvent(message)) listener(message);
        return false;
      };
      runtimeApi.onMessage.addListener(runtimeListener);
      return () => runtimeApi.onMessage.removeListener?.(runtimeListener);
    },
  };
  return Object.freeze(client);
}
