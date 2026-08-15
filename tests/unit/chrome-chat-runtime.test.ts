import { describe, expect, it, vi } from "vitest";

import type {
  ChatRuntime,
  ChatRuntimeScope,
} from "../../src/application/chat-runtime";
import {
  createAiModelDescriptor,
  type AiModelDescriptor,
} from "../../src/application/ai/provider-contract";
import {
  createChatMessage,
  createChatThread,
  createGenerationRun,
  type ChatMessage,
  type GenerationRun,
} from "../../src/domain";
import {
  createChromeChatRuntimeClient,
  installChromeChatRuntimeListener,
  type ChromeChatRuntimeEvent,
} from "../../src/infrastructure/chrome-chat-runtime";
import { AiProviderError } from "../../src/application/ai/provider-error";

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

function chromeBus() {
  const listeners: Listener[] = [];
  const broadcasts: unknown[] = [];
  const runtime = {
    onMessage: {
      addListener(listener: Listener) {
        listeners.push(listener);
      },
      removeListener(listener: Listener) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    },
    async sendMessage(message: unknown): Promise<unknown> {
      let response: unknown;
      let claimed = false;
      for (const listener of [...listeners]) {
        claimed =
          listener(message, {}, (value) => {
            response = value;
          }) || claimed;
      }
      if (!claimed) {
        broadcasts.push(message);
        return undefined;
      }
      for (
        let attempt = 0;
        response === undefined && attempt < 50;
        attempt += 1
      ) {
        await Promise.resolve();
      }
      return response;
    },
  };
  return { broadcasts, chrome: { runtime }, listeners };
}

const scope: ChatRuntimeScope = {
  branchId: "branch-a",
  contextRevision: 1,
  expectedOwnerRevision: 0,
  sessionId: "session-a",
  subtitleId: "subtitle-a",
};

const model: AiModelDescriptor = createAiModelDescriptor({
  capabilities: {
    contextWindowCharacters: 100_000,
    maxOutputCharacters: 10_000,
    supportedReasoningEfforts: ["none", "high"],
    supportsAttachments: false,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsWebSearch: false,
  },
  discoveredAt: 1,
  displayName: "Model A",
  modelId: "model-a",
  providerId: "provider-a",
});

function thread() {
  return createChatThread({
    ...scope,
    chatThreadId: "thread-a",
    conversationRevision: 0,
    createdAt: 1,
    order: 0,
    title: "对话 A",
    updatedAt: 1,
  });
}

function user() {
  return createChatMessage({
    chatThreadId: "thread-a",
    content: "问题",
    createdAt: 2,
    generationRunId: null,
    messageId: "message-user",
    order: 0,
    role: "user",
    status: "complete",
    updatedAt: 2,
  });
}

function assistant() {
  return createChatMessage({
    chatThreadId: "thread-a",
    content: "",
    createdAt: 2,
    generationRunId: "run-a",
    messageId: "message-assistant",
    order: 1,
    role: "assistant",
    status: "streaming",
    updatedAt: 2,
  });
}

function run() {
  return createGenerationRun({
    branchId: scope.branchId,
    browserSessionId: "browser-a",
    completionSequence: null,
    contextRevision: scope.contextRevision,
    createdAt: 2,
    errorCode: null,
    expectedOwnerRevision: scope.expectedOwnerRevision,
    kind: "chat",
    partialOutput: "",
    runId: "run-a",
    sessionId: scope.sessionId,
    status: "running",
    stopReason: null,
    subtitleId: scope.subtitleId,
    targetId: "thread-a",
    taskId: "task-a",
    updatedAt: 2,
  });
}

function runtimeMock(
  stopPersistedRun: (
    run: GenerationRun,
  ) => Promise<ChatMessage | null> = async () => null,
): ChatRuntime {
  const valueThread = thread();
  return {
    async createThread() {
      return valueThread;
    },
    async deleteThread() {
      return {
        cancelledRuns: [],
        deletedMessageIds: [],
        replacementMessage: null,
        thread: null,
      };
    },
    async editAndResend(input) {
      return this.send({
        content: input.content,
        generation: input.generation,
        onReasoning: input.onReasoning,
        scope: input.scope,
        threadId: input.threadId,
      });
    },
    async load() {
      return [valueThread];
    },
    async loadMessages() {
      return [user(), assistant()];
    },
    async listRuns() {
      return Object.freeze([]);
    },
    async regenerate(input) {
      return this.send({
        content: "regenerate",
        generation: input.generation,
        onReasoning: input.onReasoning,
        scope: input.scope,
        threadId: input.threadId,
      });
    },
    async renameThread() {
      return valueThread;
    },
    async retry(input) {
      return this.regenerate(input);
    },
    async send(input) {
      const valueRun = run();
      const valueAssistant = assistant();
      input.onReasoning?.({
        runId: valueRun.runId,
        text: "private reasoning",
        threadId: input.threadId,
      });
      return {
        assistant: valueAssistant,
        completion: Promise.resolve({
          assistant: valueAssistant,
          run: valueRun,
        }),
        run: valueRun,
        async stop() {
          return null;
        },
        user: user(),
      };
    },
    stop: stopPersistedRun,
  };
}

describe("Chrome chat runtime", () => {
  it("does not claim unrelated messages", () => {
    const bus = chromeBus();
    installChromeChatRuntimeListener(bus.chrome, {
      discoverModels: async () => [],
      getRuntime: async () => runtimeMock(),
    });

    expect(bus.listeners[0]?.({ type: "unrelated" }, {}, vi.fn())).toBe(false);
  });

  it("discovers models and performs chat operations through correlated safe responses", async () => {
    const bus = chromeBus();
    installChromeChatRuntimeListener(bus.chrome, {
      discoverModels: async () => [model],
      getRuntime: async () => runtimeMock(),
    });
    const client = createChromeChatRuntimeClient(
      bus.chrome,
      () => `request-${crypto.randomUUID()}`,
    );

    await expect(client.discoverModels()).resolves.toEqual([model]);
    await expect(client.listThreads(scope)).resolves.toMatchObject([
      { chatThreadId: "thread-a", title: "对话 A" },
    ]);
    await expect(client.listMessages("thread-a", scope)).resolves.toHaveLength(
      2,
    );
    await expect(
      client.send({
        content: "问题",
        generation: { model, reasoningEffort: "high" },
        scope,
        threadId: "thread-a",
      }),
    ).resolves.toMatchObject({
      assistant: { messageId: "message-assistant" },
      run: { runId: "run-a" },
      user: { messageId: "message-user" },
    });
    await vi.waitFor(() =>
      expect(bus.broadcasts).toContainEqual(
        expect.objectContaining({ type: "muzhi.chat.reasoning" }),
      ),
    );
  });

  it("transports a one-shot control prompt through the validated send DTO", async () => {
    const bus = chromeBus();
    const runtime = runtimeMock();
    const sendToRuntime = vi.spyOn(runtime, "send");
    installChromeChatRuntimeListener(bus.chrome, {
      discoverModels: async () => [],
      getRuntime: async () => runtime,
    });
    const client = createChromeChatRuntimeClient(bus.chrome) as ReturnType<
      typeof createChromeChatRuntimeClient
    > & {
      send(input: {
        readonly content: string;
        readonly generation: {
          readonly model: AiModelDescriptor;
          readonly reasoningEffort: "high";
        };
        readonly scope: ChatRuntimeScope;
        readonly temporaryControlPrompt?: string;
        readonly threadId: string;
      }): ReturnType<ReturnType<typeof createChromeChatRuntimeClient>["send"]>;
    };

    await expect(
      client.send({
        content: "问题",
        generation: { model, reasoningEffort: "high" },
        scope,
        temporaryControlPrompt: "本次回答只给结论",
        threadId: "thread-a",
      }),
    ).resolves.toMatchObject({ run: { runId: "run-a" } });
    expect(sendToRuntime).toHaveBeenCalledOnce();
    expect(sendToRuntime.mock.calls[0]?.[0]).toMatchObject({
      content: "问题",
      temporaryControlPrompt: "本次回答只给结论",
      threadId: "thread-a",
    });
  });

  it("publishes only validated assistant and transient reasoning events to subscribers", async () => {
    const bus = chromeBus();
    let publishAssistant:
      | ((update: {
          message: ReturnType<typeof assistant>;
          run: ReturnType<typeof run>;
          threadId: string;
        }) => void)
      | undefined;
    installChromeChatRuntimeListener(bus.chrome, {
      discoverModels: async () => [],
      getRuntime: async (onAssistantUpdate) => {
        publishAssistant = onAssistantUpdate;
        return runtimeMock();
      },
    });
    const client = createChromeChatRuntimeClient(bus.chrome);
    const received: ChromeChatRuntimeEvent[] = [];
    client.subscribe((event) => received.push(event));
    await client.listThreads(scope);
    publishAssistant?.({
      message: assistant(),
      run: run(),
      threadId: "thread-a",
    });

    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({
      payload: { message: { messageId: "message-assistant" } },
      type: "muzhi.chat.assistant.updated",
    });
  });

  it("stops an exact persisted run after the listener-local handle was lost", async () => {
    const bus = chromeBus();
    const stoppedAssistant = createChatMessage({
      ...assistant(),
      status: "failed",
      updatedAt: 3,
    });
    const stopPersistedRun = vi.fn(async () => stoppedAssistant);
    installChromeChatRuntimeListener(bus.chrome, {
      discoverModels: async () => [],
      getRuntime: async () => runtimeMock(stopPersistedRun),
    });
    const client = createChromeChatRuntimeClient(bus.chrome);

    await expect(client.stop(run())).resolves.toEqual(stoppedAssistant);
    expect(stopPersistedRun).toHaveBeenCalledWith(run());
  });

  it("redacts runtime exceptions instead of returning provider details", async () => {
    const bus = chromeBus();
    installChromeChatRuntimeListener(bus.chrome, {
      async discoverModels() {
        throw new Error("sk-secret raw response");
      },
      getRuntime: async () => runtimeMock(),
    });
    const rawResponse = await bus.chrome.runtime.sendMessage({
      payload: {},
      protocolVersion: 1,
      requestId: "request-a",
      type: "muzhi.chat.models.discover",
    });

    expect(rawResponse).toMatchObject({
      payload: { errorCode: "INTERNAL_ERROR", ok: false },
    });
    expect(JSON.stringify(rawResponse)).not.toContain("sk-secret");
    expect(JSON.stringify(rawResponse)).not.toContain("raw response");
  });

  it("preserves a safe provider error code without exposing provider details", async () => {
    const bus = chromeBus();
    installChromeChatRuntimeListener(bus.chrome, {
      async discoverModels() {
        throw new AiProviderError(
          "AUTHENTICATION_REQUIRED",
          "Bearer sk-secret was rejected",
          false,
        );
      },
      getRuntime: async () => runtimeMock(),
    });
    const client = createChromeChatRuntimeClient(bus.chrome);

    const rawResponse = await bus.chrome.runtime.sendMessage({
      payload: {},
      protocolVersion: 1,
      requestId: "request-provider-error",
      type: "muzhi.chat.models.discover",
    });
    expect(rawResponse).toMatchObject({
      payload: { errorCode: "AUTHENTICATION_REQUIRED", ok: false },
    });
    expect(JSON.stringify(rawResponse)).not.toContain("sk-secret");
    expect(JSON.stringify(rawResponse)).not.toContain("Bearer");

    await expect(client.discoverModels()).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
      name: "AiProviderError",
    });
  });

  it("does not expose a closed Chrome response channel as a raw UI error", async () => {
    const client = createChromeChatRuntimeClient({
      runtime: {
        onMessage: {
          addListener() {},
          removeListener() {},
        },
        async sendMessage() {
          throw new Error(
            "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
          );
        },
      },
    });

    await expect(client.discoverModels()).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "无法连接Bilimuzhi AI 后台，请重试。",
      name: "AiProviderError",
      retryable: true,
    });
  });

  it("acknowledges a chat generation before its long completion settles", async () => {
    const bus = chromeBus();
    let finish: (() => void) | undefined;
    const completion = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const runtime = runtimeMock();
    runtime.send = async () => {
      const valueRun = run();
      const valueAssistant = assistant();
      return {
        assistant: valueAssistant,
        completion: completion.then(() => ({
          assistant: valueAssistant,
          run: valueRun,
        })),
        run: valueRun,
        async stop() {
          return null;
        },
        user: user(),
      };
    };
    installChromeChatRuntimeListener(bus.chrome, {
      discoverModels: async () => [],
      getRuntime: async () => runtime,
    });
    const client = createChromeChatRuntimeClient(bus.chrome);

    await expect(
      client.send({
        content: "问题",
        generation: { model, reasoningEffort: "high" },
        scope,
        threadId: "thread-a",
      }),
    ).resolves.toMatchObject({ run: { taskId: "task-a" } });

    finish?.();
  });
});
