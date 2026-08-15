import { describe, expect, it, vi } from "vitest";

import { AiProviderError } from "../../src/application/ai/provider-error";
import type {
  AiGenerationRequest,
  AiProviderGateway,
} from "../../src/application/ai/provider-contract";
import type { ChatRepository } from "../../src/application/chat-repository";
import type {
  AttachmentRepository,
  AttachmentTurnBinding,
} from "../../src/application/attachment-repository";
import {
  createChatRuntime,
  type ChatGenerationOptions,
} from "../../src/application/chat-runtime";
import type { GenerationTaskCoordinator } from "../../src/application/task";
import {
  createChatMessage,
  createChatThread,
  createGenerationRun,
  createImageAttachment,
  type ChatMessage,
  type GenerationRun,
  type ImageAttachment,
  type TaskOwner,
} from "../../src/domain";

const scope = {
  branchId: "branch-a",
  contextRevision: 1,
  expectedOwnerRevision: 0,
  sessionId: "session-a",
  subtitleId: "subtitle-a",
};

const generation: ChatGenerationOptions = {
  model: {
    capabilities: {
      contextWindowCharacters: 10_000,
      maxOutputCharacters: 1_000,
      supportedReasoningEfforts: ["none"],
      supportsAttachments: false,
      supportsReasoning: false,
      supportsStreaming: true,
      supportsWebSearch: false,
    },
    discoveredAt: 1,
    displayName: "Test model",
    modelId: "test-model",
    providerId: "test-provider",
  },
  reasoningEffort: "auto",
};

function createHarness(
  provider: AiProviderGateway,
  subtitleContext?: () => Promise<{
    readonly meta: {
      readonly bvid: string;
      readonly durationSec: number | null;
      readonly title: string;
    };
    readonly rows: readonly {
      readonly endMs: number;
      readonly startMs: number;
      readonly text: string;
    }[];
  } | null>,
  readUserPrompt?: () => Promise<string | null>,
  outputLanguage?: () => Promise<"zh-Hans" | "zh-Hant" | "en" | "ja">,
) {
  const thread = createChatThread({
    ...scope,
    chatThreadId: "thread-a",
    conversationRevision: 0,
    createdAt: 1,
    order: 0,
    title: null,
    updatedAt: 1,
  });
  const messages = new Map<string, ChatMessage>();
  const runs = new Map<string, GenerationRun>();
  const attachments = new Map<string, ImageAttachment>();
  const turnBindings: AttachmentTurnBinding[] = [];
  const attachmentRepository: Pick<AttachmentRepository, "resolveById"> = {
    async resolveById(attachmentId: string) {
      return attachments.get(attachmentId) ?? null;
    },
  };
  const repository: ChatRepository = {
    async appendMessage(message) {
      messages.set(message.messageId, message);
      return message;
    },
    async appendTurn(user, assistant, binding) {
      messages.set(user.messageId, user);
      messages.set(assistant.messageId, assistant);
      if (binding !== undefined) turnBindings.push(binding);
      return [user, assistant];
    },
    async applyAssistantRun(run) {
      if (runs.get(run.runId) !== run) return null;
      const assistant = [...messages.values()].find(
        (message) => message.generationRunId === run.runId,
      );
      if (assistant === undefined) return null;
      const updated = createChatMessage({
        ...assistant,
        content: run.partialOutput,
        status:
          run.status === "completed"
            ? "complete"
            : run.status === "queued" || run.status === "running"
              ? "streaming"
              : "failed",
        updatedAt: run.updatedAt,
      });
      messages.set(updated.messageId, updated);
      return updated;
    },
    async createThread(value) {
      return value;
    },
    async deleteThread() {
      throw new Error("not used");
    },
    async getThread(threadId) {
      return threadId === thread.chatThreadId ? thread : null;
    },
    async listMessages(threadId) {
      return [...messages.values()]
        .filter((message) => message.chatThreadId === threadId)
        .sort((left, right) => left.order - right.order);
    },
    async listRuns(runIds) {
      return runIds
        .map((runId) => runs.get(runId))
        .filter((run): run is GenerationRun => run !== undefined);
    },
    async listThreads() {
      return [thread];
    },
    async renameThread() {
      return thread;
    },
    async truncate() {
      throw new Error("not used");
    },
  };
  const applyEvent = vi.fn(async (event: unknown) => {
    const value = event as {
      readonly payload: {
        readonly delta?: string;
        readonly errorCode?: string;
        readonly output?: string;
      };
      readonly taskId: string;
      readonly type: string;
    };
    const current = [...runs.values()].find(
      (run) => run.taskId === value.taskId,
    );
    if (
      current === undefined ||
      (current.status !== "queued" && current.status !== "running")
    ) {
      return null;
    }
    const next = createGenerationRun({
      ...current,
      completionSequence:
        value.type === "muzhi.generation.completed" ? 1 : null,
      errorCode:
        value.type === "muzhi.generation.failed"
          ? (value.payload.errorCode ?? "INTERNAL_ERROR")
          : null,
      partialOutput:
        value.type === "muzhi.generation.delta"
          ? `${current.partialOutput}${value.payload.delta ?? ""}`
          : value.type === "muzhi.generation.completed"
            ? (value.payload.output ?? "")
            : current.partialOutput,
      status:
        value.type === "muzhi.generation.completed"
          ? "completed"
          : value.type === "muzhi.generation.failed"
            ? "failed"
            : "running",
      updatedAt: current.updatedAt + 1,
    });
    runs.set(next.runId, next);
    return next;
  });
  const tasks: GenerationTaskCoordinator = {
    applyEvent,
    async start(owner: TaskOwner) {
      const run = createGenerationRun({
        ...owner,
        browserSessionId: "browser-a",
        completionSequence: null,
        createdAt: 10,
        errorCode: null,
        partialOutput: "",
        runId: "run-a",
        status: "queued",
        stopReason: null,
        updatedAt: 10,
      });
      runs.set(run.runId, run);
      return run;
    },
    async stop(owner: TaskOwner) {
      const current = [...runs.values()].find(
        (run) => run.taskId === owner.taskId,
      );
      if (
        current === undefined ||
        (current.status !== "queued" && current.status !== "running")
      ) {
        return null;
      }
      const stopped = createGenerationRun({
        ...current,
        status: "stopped",
        stopReason: "user",
        updatedAt: current.updatedAt + 1,
      });
      runs.set(stopped.runId, stopped);
      return stopped;
    },
  };
  let messageId = 0;
  return {
    applyEvent,
    attachments,
    messages,
    runs,
    turnBindings,
    runtime: createChatRuntime({
      attachmentRepository,
      createMessageId: () => `message-${++messageId}`,
      createTaskId: () => "task-a",
      createThreadId: () => "thread-new",
      now: () => 10,
      outputLanguage,
      provider,
      readSubtitleContext: subtitleContext,
      readUserPrompt,
      repository,
      tasks,
    }),
  };
}

describe("chat runtime", () => {
  it("persists visible output while reasoning remains transient", async () => {
    const reasoning = vi.fn();
    const harness = createHarness({
      discoverModels: async () => [],
      async *stream() {
        yield { type: "started" };
        yield { delta: "private chain", type: "reasoning" };
        yield { delta: "visible ", type: "delta" };
        yield { output: "visible answer", type: "completed" };
      },
    });

    const handle = await harness.runtime.send({
      content: "question",
      generation,
      onReasoning: reasoning,
      scope,
      threadId: "thread-a",
    });
    const result = await handle.completion;

    expect(reasoning).toHaveBeenCalledWith({
      runId: "run-a",
      text: "private chain",
      threadId: "thread-a",
    });
    expect(result.assistant).toMatchObject({
      content: "visible answer",
      status: "complete",
    });
    expect(JSON.stringify([...harness.messages.values()])).not.toContain(
      "private chain",
    );
    expect(JSON.stringify([...harness.runs.values()])).not.toContain(
      "private chain",
    );
  });

  it("commits stop before rejecting a provider's late delta", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      discoverModels: async () => [],
      async *stream() {
        yield { type: "started" };
        await gate;
        yield { delta: "late", type: "delta" };
      },
    });

    const handle = await harness.runtime.send({
      content: "question",
      generation,
      scope,
      threadId: "thread-a",
    });
    await handle.stop();
    release();
    const result = await handle.completion;

    expect(result.assistant).toMatchObject({ content: "", status: "failed" });
    expect(harness.applyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { delta: "late" } }),
    );
    expect(JSON.stringify([...harness.messages.values()])).not.toContain(
      "late",
    );
  });

  it("persists user cancellation as a distinct cancelled run while retaining confirmed partial output", async () => {
    let release!: () => void;
    let markStreaming!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const streamingReached = new Promise<void>((resolve) => {
      markStreaming = resolve;
    });
    const harness = createHarness({
      async discoverModels() {
        return [];
      },
      async *stream() {
        yield { type: "started" } as const;
        yield { delta: "confirmed partial", type: "delta" } as const;
        markStreaming();
        await gate;
        yield { output: "late complete", type: "completed" } as const;
      },
    });
    const handle = await harness.runtime.send({
      content: "cancel this response",
      generation,
      scope,
      threadId: "thread-a",
    });
    await streamingReached;

    await handle.stop();
    const cancelled = [...harness.runs.values()].at(-1);
    expect(cancelled).toMatchObject({
      partialOutput: "confirmed partial",
      status: "cancelled",
    });

    release();
    await handle.completion;
    expect([...harness.runs.values()].at(-1)).toEqual(cancelled);
  });

  it("stops a durable run without retaining its original generation handle", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      discoverModels: async () => [],
      async *stream() {
        yield { type: "started" };
        await gate;
        yield { output: "late completion", type: "completed" };
      },
    });

    const originalHandle = await harness.runtime.send({
      content: "question",
      generation,
      scope,
      threadId: "thread-a",
    });
    const persistedRun = createGenerationRun(originalHandle.run);

    await expect(harness.runtime.stop(persistedRun)).resolves.toMatchObject({
      content: "",
      status: "failed",
    });
    release();
    await originalHandle.completion;
    expect(JSON.stringify([...harness.messages.values()])).not.toContain(
      "late completion",
    );
  });

  it("grounds every chat turn in the exact subtitle instead of chatting free-form", async () => {
    const requests: AiGenerationRequest[] = [];
    const harness = createHarness(
      {
        async discoverModels() {
          return [];
        },
        async *stream(request) {
          requests.push(request);
          yield { type: "started" } as const;
          yield {
            output: "字幕里提到了人浪的传播速度。",
            type: "completed",
          } as const;
        },
      },
      async () => ({
        meta: {
          bvid: "BV1Q541167Qg",
          durationSec: 300,
          title: "人浪的传播速度",
        },
        rows: [
          { endMs: 4_000, startMs: 1_000, text: "人浪确实是波" },
          { endMs: 9_000, startMs: 5_000, text: "接近每秒 12 米" },
        ],
      }),
    );
    await harness.runtime.send({
      content: "人浪的速度是多少？",
      generation,
      scope,
      threadId: "thread-a",
    });

    const sent = requests.at(-1);
    expect(sent).toBeDefined();
    const combined = sent!.messages
      .map((message) => message.content)
      .join("\n");
    expect(combined).toContain("untrusted_subtitle_reference");
    expect(combined).toContain("接近每秒 12 米");
    expect(combined).toContain("BV1Q541167Qg");
    expect(combined).toContain("人浪的速度是多少？");
  });

  it("injects the configured output language into the grounded chat prompt", async () => {
    const requests: AiGenerationRequest[] = [];
    const harness = createHarness(
      {
        async discoverModels() {
          return [];
        },
        async *stream(request) {
          requests.push(request);
          yield { type: "started" } as const;
          yield {
            output: "字幕に基づいて回答します。",
            type: "completed" as const,
          } as const;
        },
      },
      async () => ({
        meta: {
          bvid: "BV1Q541167Qg",
          durationSec: 300,
          title: "人浪的传播速度",
        },
        rows: [
          { endMs: 4_000, startMs: 1_000, text: "人浪确实是波" },
          { endMs: 9_000, startMs: 5_000, text: "接近每秒 12 米" },
        ],
      }),
      undefined,
      async () => "ja",
    );
    await harness.runtime.send({
      content: "人浪的速度是多少？",
      generation,
      scope,
      threadId: "thread-a",
    });

    const sent = requests.at(-1);
    expect(sent).toBeDefined();
    const combined = sent!.messages
      .map((message) => message.content)
      .join("\n");
    expect(combined).toContain(
      "出力は必ず日本語で書くこと。出力は必ず日本語で書くこと。出力は必ず日本語で書くこと。",
    );
    expect(combined).toContain(
      "ユーザーがこのターンで「中国語で答えて」などと明示的に中国語を要求した場合に限り",
    );
  });

  it("uses a temporary control prompt for exactly one send without persisting it or reordering safety layers", async () => {
    const requests: AiGenerationRequest[] = [];
    const harness = createHarness(
      {
        async discoverModels() {
          return [];
        },
        async *stream(request) {
          requests.push(request);
          yield { type: "started" } as const;
          yield { output: "回答", type: "completed" } as const;
        },
      },
      async () => ({
        meta: {
          bvid: "BV1Q541167Qg",
          durationSec: 10,
          title: "META_MARKER",
        },
        rows: [
          {
            endMs: 10_000,
            startMs: 0,
            text: "SUBTITLE_MARKER",
          },
        ],
      }),
      async () => "DEFAULT_CONTROL_MARKER",
    );
    type TemporaryPromptSend = Parameters<typeof harness.runtime.send>[0] & {
      readonly temporaryControlPrompt?: string;
    };

    const firstInput: TemporaryPromptSend = {
      content: "FIRST_REQUEST_MARKER",
      generation,
      scope,
      temporaryControlPrompt: "ONE_SHOT_CONTROL_MARKER",
      threadId: "thread-a",
    };
    const first = await harness.runtime.send(firstInput);
    await first.completion;
    const secondInput: TemporaryPromptSend = {
      content: "SECOND_REQUEST_MARKER",
      generation,
      scope,
      threadId: "thread-a",
    };
    const second = await harness.runtime.send(secondInput);
    await second.completion;

    expect(requests).toHaveLength(2);
    const firstMessages = requests[0]!.messages;
    const markerIndex = (marker: string) =>
      firstMessages.findIndex((message) => message.content.includes(marker));
    const orderedMarkers = [
      "不可信数据",
      "内置定位与链接规则",
      "ONE_SHOT_CONTROL_MARKER",
      "FIRST_REQUEST_MARKER",
      "META_MARKER",
      "SUBTITLE_MARKER",
    ].map(markerIndex);
    expect(orderedMarkers.every((index) => index >= 0)).toBe(true);
    expect(orderedMarkers).toEqual(
      [...orderedMarkers].sort((left, right) => left - right),
    );
    expect(firstMessages.at(-1)?.content).toContain(
      "<untrusted_subtitle_reference>",
    );
    expect(
      firstMessages.map((message) => message.content).join("\n"),
    ).not.toContain("DEFAULT_CONTROL_MARKER");

    const secondPrompt = requests[1]!.messages
      .map((message) => message.content)
      .join("\n");
    expect(secondPrompt).toContain("DEFAULT_CONTROL_MARKER");
    expect(secondPrompt).not.toContain("ONE_SHOT_CONTROL_MARKER");
    expect(JSON.stringify([...harness.messages.values()])).not.toContain(
      "ONE_SHOT_CONTROL_MARKER",
    );
    expect(JSON.stringify([...harness.runs.values()])).not.toContain(
      "ONE_SHOT_CONTROL_MARKER",
    );
  });

  it("persists the real five-stage lifecycle before completing chat", async () => {
    const harness = createHarness({
      async discoverModels() {
        return [];
      },
      async *stream() {
        yield { type: "started" } as const;
        yield { delta: "partial", type: "delta" } as const;
        yield { output: "complete", type: "completed" } as const;
      },
    });

    const handle = await harness.runtime.send({
      content: "describe the lifecycle",
      generation,
      scope,
      threadId: "thread-a",
    });
    await handle.completion;

    const persistedPhases = harness.applyEvent.mock.calls.flatMap(([value]) => {
      const runtimeEvent = value as {
        readonly payload?: { readonly status?: string };
        readonly type?: string;
      };
      return runtimeEvent.type === "muzhi.generation.status" &&
        runtimeEvent.payload?.status !== undefined
        ? [runtimeEvent.payload.status]
        : [];
    });
    expect(persistedPhases).toEqual([
      "preparing",
      "requesting",
      "streaming",
      "validating",
      "saving",
    ]);
  });

  it("captures a safe immutable generation snapshot without persisting prompt or credential material", async () => {
    const harness = createHarness(
      {
        async discoverModels() {
          return [];
        },
        async *stream() {
          yield { output: "answer", type: "completed" } as const;
        },
      },
      async () => ({
        meta: {
          bvid: "BV1Q541167Qg",
          durationSec: 10,
          title: "SNAPSHOT_META_MARKER",
        },
        rows: [
          {
            endMs: 10_000,
            startMs: 0,
            text: "SNAPSHOT_SUBTITLE_MARKER",
          },
        ],
      }),
      async () => "SNAPSHOT_PROMPT_MARKER sk-secret-value",
    );

    const handle = await harness.runtime.send({
      content: "snapshot question",
      generation,
      scope,
      threadId: "thread-a",
    });
    await handle.completion;
    const snapshot = handle.run as GenerationRun & {
      readonly contextHash: string;
      readonly conversationRevision: number;
      readonly modelHash: string;
      readonly promptHash: string;
      readonly runRevision: number;
    };

    expect(snapshot).toMatchObject({
      contextHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      conversationRevision: 0,
      modelHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      promptHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      runRevision: 0,
    });
    expect(JSON.stringify(snapshot)).not.toContain("SNAPSHOT_PROMPT_MARKER");
    expect(JSON.stringify(snapshot)).not.toContain("SNAPSHOT_SUBTITLE_MARKER");
    expect(JSON.stringify(snapshot)).not.toContain("sk-secret-value");
  });

  it("sends with image attachment ids after validating the exact draft owner", async () => {
    const harness = createHarness({
      discoverModels: async () => [],
      async *stream() {
        yield { type: "started" };
        yield { output: "看图回答", type: "completed" };
      },
    });
    harness.attachments.set(
      "att-1",
      createImageAttachment({
        attachmentId: "att-1",
        blob: new Blob(["fixture"], { type: "image/png" }),
        branchId: scope.branchId,
        chatThreadId: "thread-a",
        currentTimeMs: 65_000,
        height: 10,
        messageId: null,
        mimeType: "image/png",
        sessionId: scope.sessionId,
        subtitleContextRevision: scope.contextRevision,
        subtitleId: scope.subtitleId,
        thumbnailBlob: new Blob(["fixture"], { type: "image/png" }),
        videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
        width: 10,
      }),
    );

    const handle = await harness.runtime.send({
      attachmentIds: ["att-1"],
      content: "看图",
      generation: {
        ...generation,
        model: {
          ...generation.model,
          capabilities: {
            ...generation.model.capabilities,
            supportsAttachments: true,
          },
        },
      },
      scope,
      threadId: "thread-a",
    });
    const result = await handle.completion;

    expect(result.assistant).toMatchObject({
      content: "看图回答",
      status: "complete",
    });
    expect(harness.turnBindings).toEqual([
      expect.objectContaining({
        attachmentIds: ["att-1"],
        owner: expect.objectContaining({
          chatThreadId: "thread-a",
          sessionId: scope.sessionId,
        }),
      }),
    ]);
  });

  it("rejects image attachment ids when the selected model does not support attachments", async () => {
    const harness = createHarness({
      discoverModels: async () => [],
      async *stream() {
        yield { type: "started" };
        yield { output: "不该出现", type: "completed" };
      },
    });
    harness.attachments.set(
      "att-1",
      createImageAttachment({
        attachmentId: "att-1",
        blob: new Blob(["fixture"], { type: "image/png" }),
        branchId: scope.branchId,
        chatThreadId: "thread-a",
        currentTimeMs: 65_000,
        height: 10,
        messageId: null,
        mimeType: "image/png",
        sessionId: scope.sessionId,
        subtitleContextRevision: scope.contextRevision,
        subtitleId: scope.subtitleId,
        thumbnailBlob: new Blob(["fixture"], { type: "image/png" }),
        videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
        width: 10,
      }),
    );

    await expect(
      harness.runtime.send({
        attachmentIds: ["att-1"],
        content: "看图",
        generation,
        scope,
        threadId: "thread-a",
      }),
    ).rejects.toThrow("attachment support");
  });

  it("sends an image-only turn with empty text content", async () => {
    const harness = createHarness({
      discoverModels: async () => [],
      async *stream() {
        yield { type: "started" };
        yield { output: "识别图片", type: "completed" };
      },
    });
    harness.attachments.set(
      "att-only",
      createImageAttachment({
        attachmentId: "att-only",
        blob: new Blob(["fixture"], { type: "image/png" }),
        branchId: scope.branchId,
        chatThreadId: "thread-a",
        currentTimeMs: 10_000,
        height: 10,
        messageId: null,
        mimeType: "image/png",
        sessionId: scope.sessionId,
        subtitleContextRevision: scope.contextRevision,
        subtitleId: scope.subtitleId,
        thumbnailBlob: new Blob(["fixture"], { type: "image/png" }),
        videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
        width: 10,
      }),
    );

    const handle = await harness.runtime.send({
      attachmentIds: ["att-only"],
      content: "",
      generation: {
        ...generation,
        model: {
          ...generation.model,
          capabilities: {
            ...generation.model.capabilities,
            supportsAttachments: true,
          },
        },
      },
      scope,
      threadId: "thread-a",
    });
    const result = await handle.completion;

    expect(result.assistant).toMatchObject({
      content: "识别图片",
      status: "complete",
    });
    expect(harness.turnBindings).toEqual([
      expect.objectContaining({ attachmentIds: ["att-only"] }),
    ]);
  });

  it("maps a Provider capability rejection to a stable UNSUPPORTED_CAPABILITY failure", async () => {
    const harness = createHarness({
      discoverModels: async () => [],
      stream: () => {
        throw new AiProviderError(
          "UNSUPPORTED_CAPABILITY",
          "model does not support images",
          false,
        );
      },
    });
    const handle = await harness.runtime.send({
      content: "看图",
      generation,
      scope,
      threadId: "thread-a",
    });
    const result = await handle.completion;
    expect(result.assistant).toMatchObject({ status: "failed" });
    expect(result.run).toMatchObject({
      errorCode: "UNSUPPORTED_CAPABILITY",
      status: "failed",
    });
  });

  it("rejects attachment ids whose draft owner is no longer authoritative", async () => {
    const harness = createHarness({
      discoverModels: async () => [],
      async *stream() {
        yield { type: "started" };
        yield { output: "不该出现", type: "completed" };
      },
    });
    harness.attachments.set(
      "att-stale",
      createImageAttachment({
        attachmentId: "att-stale",
        blob: new Blob(["fixture"], { type: "image/png" }),
        branchId: "branch-other",
        chatThreadId: "thread-a",
        currentTimeMs: 0,
        height: 10,
        messageId: null,
        mimeType: "image/png",
        sessionId: scope.sessionId,
        subtitleContextRevision: scope.contextRevision,
        subtitleId: scope.subtitleId,
        thumbnailBlob: new Blob(["fixture"], { type: "image/png" }),
        videoKey: "bvid:BV1Q541167Qg:cid:1:p:1",
        width: 10,
      }),
    );

    await expect(
      harness.runtime.send({
        attachmentIds: ["att-stale"],
        content: "看图",
        generation,
        scope,
        threadId: "thread-a",
      }),
    ).rejects.toThrow(
      "The Bilimuzhi image attachment owner is no longer authoritative",
    );
  });
});
