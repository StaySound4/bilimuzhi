import { describe, expect, it, vi } from "vitest";

import {
  createGenerationStartCommand,
  createGenerationStopCommand,
} from "../../src/application/generation-command-contract";
import type {
  GenerationRuntimeEvent,
  GenerationTaskContext,
} from "../../src/application/generation-runtime-contract";
import { createGenerationExecutorRegistry } from "../../src/application/task";
import {
  createAiGenerationRequest,
  createAiModelDescriptor,
  type AiProviderStreamEvent,
} from "../../src/application/ai/provider-contract";
import {
  createGenerationRun,
  type GenerationRun,
  type TaskOwner,
} from "../../src/domain";
import { installChromeGenerationRuntimeListener } from "../../src/infrastructure/chrome-generation-runtime";

function context(): GenerationTaskContext {
  return {
    branchId: "branch-a",
    contextRevision: 1,
    expectedOwnerRevision: 0,
    kind: "chat",
    protocolVersion: 1,
    requestId: "request-a",
    sessionId: "session-a",
    subtitleId: "subtitle-a",
    targetId: "thread-a",
    taskId: "task-a",
  };
}

function request() {
  return createAiGenerationRequest({
    kind: "chat",
    messages: [{ content: "hello", role: "user" }],
    model: createAiModelDescriptor({
      capabilities: {
        contextWindowCharacters: 100_000,
        maxOutputCharacters: 10_000,
        supportedReasoningEfforts: ["none", "low", "high"],
        supportsAttachments: false,
        supportsReasoning: true,
        supportsStreaming: true,
        supportsWebSearch: false,
      },
      discoveredAt: 1,
      displayName: "Model A",
      modelId: "model-a",
      providerId: "provider-a",
    }),
    reasoningEffort: "high",
  });
}

function run(owner: TaskOwner, input?: Partial<GenerationRun>): GenerationRun {
  return createGenerationRun({
    ...owner,
    browserSessionId: "browser-a",
    completionSequence: input?.completionSequence ?? null,
    createdAt: 1,
    errorCode: input?.errorCode ?? null,
    partialOutput: input?.partialOutput ?? "",
    runId: "run-a",
    status: input?.status ?? "queued",
    stopReason: input?.stopReason ?? null,
    updatedAt: 1,
  });
}

function chromeFixture() {
  const listeners: Array<
    (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean
  > = [];
  const broadcasts: unknown[] = [];
  return {
    broadcasts,
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener: (typeof listeners)[number]) {
            listeners.push(listener);
          },
        },
        async sendMessage(message: unknown) {
          broadcasts.push(message);
        },
      },
    },
    async dispatch(
      message: unknown,
    ): Promise<{ claimed: boolean; response: unknown }> {
      let response: unknown;
      const claimed =
        listeners[0]?.(message, {}, (value) => {
          response = value;
        }) ?? false;
      for (
        let attempt = 0;
        claimed && response === undefined && attempt < 20;
        attempt += 1
      ) {
        await Promise.resolve();
      }
      return { claimed, response };
    },
  };
}

describe("Chrome generation runtime", () => {
  it("does not claim unknown runtime messages", async () => {
    const fixture = chromeFixture();
    installChromeGenerationRuntimeListener(fixture.chrome, {
      createProvider: vi.fn(),
      executors: createGenerationExecutorRegistry(),
      tasks: {
        applyEvent: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      },
    });

    await expect(fixture.dispatch({ type: "unknown" })).resolves.toEqual({
      claimed: false,
      response: undefined,
    });
  });

  it("persists visible events, broadcasts reasoning transiently, and uses the repository completion sequence", async () => {
    const fixture = chromeFixture();
    const executors = createGenerationExecutorRegistry();
    const applied: GenerationRuntimeEvent[] = [];
    const owner = context();
    const tasks = {
      async applyEvent(value: unknown): Promise<GenerationRun | null> {
        applied.push(value as GenerationRuntimeEvent);
        const event = value as GenerationRuntimeEvent;
        return run(
          owner,
          event.type === "muzhi.generation.completed"
            ? {
                completionSequence: 7,
                partialOutput: "visible answer",
                status: "completed",
              }
            : {
                partialOutput:
                  event.type === "muzhi.generation.delta" ? "visible " : "",
                status: "running",
              },
        );
      },
      async start(): Promise<GenerationRun> {
        return run(owner);
      },
      async stop(): Promise<GenerationRun | null> {
        return null;
      },
    };
    const events: AiProviderStreamEvent[] = [
      { type: "started" },
      { delta: "private thought", type: "reasoning" },
      { delta: "visible ", type: "delta" },
      { output: "visible answer", type: "completed" },
    ];
    installChromeGenerationRuntimeListener(fixture.chrome, {
      async createProvider() {
        return {
          async discoverModels() {
            return [];
          },
          async *stream() {
            yield* events;
          },
        };
      },
      executors,
      tasks,
    });

    const result = await fixture.dispatch(
      createGenerationStartCommand({ context: owner, request: request() }),
    );
    expect(result.claimed).toBe(true);
    expect(result.response).toMatchObject({
      payload: { status: "queued" },
      type: "muzhi.generation.status",
    });
    await vi.waitFor(() => expect(fixture.broadcasts).toHaveLength(4));
    expect(applied.map((event) => event.type)).toEqual([
      "muzhi.generation.started",
      "muzhi.generation.delta",
      "muzhi.generation.completed",
    ]);
    expect(fixture.broadcasts[1]).toMatchObject({
      payload: { text: "private thought" },
      type: "muzhi.generation.reasoning",
    });
    expect(fixture.broadcasts[3]).toMatchObject({
      payload: { completionSequence: 7, output: "visible answer" },
      type: "muzhi.generation.completed",
    });
  });

  it("commits stop before aborting the registered stream executor", async () => {
    const fixture = chromeFixture();
    const executors = createGenerationExecutorRegistry();
    const calls: string[] = [];
    const owner = context();
    let releaseStream: (() => void) | undefined;
    const streamWait = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    const tasks = {
      async applyEvent(): Promise<GenerationRun | null> {
        return run(owner, { status: "running" });
      },
      async start(): Promise<GenerationRun> {
        return run(owner);
      },
      async stop(input: TaskOwner): Promise<GenerationRun | null> {
        calls.push("commit-stop");
        await executors.abort(input);
        calls.push("abort-finished");
        return run(owner, { status: "stopped", stopReason: "user" });
      },
    };
    installChromeGenerationRuntimeListener(fixture.chrome, {
      async createProvider() {
        return {
          async discoverModels() {
            return [];
          },
          async *stream() {
            try {
              await streamWait;
              yield { type: "started" as const };
            } finally {
              calls.push("executor-abort");
            }
          },
        };
      },
      executors,
      tasks,
    });

    await fixture.dispatch(
      createGenerationStartCommand({ context: owner, request: request() }),
    );
    await Promise.resolve();
    const stopping = fixture.dispatch(createGenerationStopCommand(owner));
    await vi.waitFor(() => expect(calls).toContain("commit-stop"));
    releaseStream?.();
    const result = await stopping;

    expect(result.response).toMatchObject({
      payload: { reason: "user" },
      type: "muzhi.generation.stopped",
    });
    expect(calls.slice(0, 3)).toEqual([
      "commit-stop",
      "executor-abort",
      "abort-finished",
    ]);
  });

  it("returns a redacted stable failure when provider setup rejects", async () => {
    const fixture = chromeFixture();
    installChromeGenerationRuntimeListener(fixture.chrome, {
      async createProvider() {
        throw new Error("sk-secret raw provider body");
      },
      executors: createGenerationExecutorRegistry(),
      tasks: {
        applyEvent: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      },
    });

    const result = await fixture.dispatch(
      createGenerationStartCommand({ context: context(), request: request() }),
    );
    expect(result.response).toMatchObject({
      payload: { errorCode: "INTERNAL_ERROR" },
      type: "muzhi.generation.failed",
    });
    expect(JSON.stringify(result.response)).not.toContain("sk-secret");
    expect(JSON.stringify(result.response)).not.toContain("raw provider body");
  });
});
