import type {
  AiProviderGateway,
  AiProviderStreamEvent,
} from "../application/ai/provider-contract";
import {
  isGenerationRuntimeCommand,
  type GenerationRuntimeCommand,
} from "../application/generation-command-contract";
import {
  isGenerationRuntimeEvent,
  type GenerationRuntimeEvent,
  type GenerationTaskContext,
} from "../application/generation-runtime-contract";
import type {
  GenerationTaskCoordinator,
  MutableGenerationExecutorRegistry,
} from "../application/task";
import { createTaskOwner, type GenerationRun } from "../domain";

interface ChromeRuntimeMessageApi {
  readonly onMessage: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => boolean,
    ): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
}

export interface ChromeGenerationRuntimeDependencies {
  readonly createProvider: () => Promise<AiProviderGateway>;
  readonly executors: MutableGenerationExecutorRegistry;
  readonly tasks: GenerationTaskCoordinator;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRuntime(chromeValue: unknown): ChromeRuntimeMessageApi {
  if (!isRecord(chromeValue)) {
    throw new Error("Chrome generation runtime messaging is unavailable");
  }
  const runtime = Reflect.get(chromeValue, "runtime") as unknown;
  const onMessage = isRecord(runtime)
    ? (Reflect.get(runtime, "onMessage") as unknown)
    : null;
  const addListener = isRecord(onMessage)
    ? (Reflect.get(onMessage, "addListener") as unknown)
    : null;
  const sendMessage = isRecord(runtime)
    ? (Reflect.get(runtime, "sendMessage") as unknown)
    : null;
  if (
    !isRecord(runtime) ||
    !isRecord(onMessage) ||
    typeof addListener !== "function" ||
    typeof sendMessage !== "function"
  ) {
    throw new Error("Chrome generation runtime messaging is unavailable");
  }
  return Object.freeze({
    onMessage: Object.freeze({
      addListener(
        listener: Parameters<
          ChromeRuntimeMessageApi["onMessage"]["addListener"]
        >[0],
      ): void {
        Reflect.apply(addListener, onMessage, [listener]);
      },
    }),
    async sendMessage(message: unknown): Promise<unknown> {
      return Reflect.apply(sendMessage, runtime, [message]);
    },
  });
}

function contextOf(command: GenerationRuntimeCommand): GenerationTaskContext {
  return Object.freeze({
    branchId: command.branchId,
    contextRevision: command.contextRevision,
    expectedOwnerRevision: command.expectedOwnerRevision,
    kind: command.kind,
    protocolVersion: command.protocolVersion,
    requestId: command.requestId,
    sessionId: command.sessionId,
    subtitleId: command.subtitleId,
    targetId: command.targetId,
    taskId: command.taskId,
  });
}

function failedEvent(
  context: GenerationTaskContext,
  errorCode = "INTERNAL_ERROR",
): GenerationRuntimeEvent {
  return Object.freeze({
    ...context,
    payload: Object.freeze({ errorCode }),
    type: "muzhi.generation.failed" as const,
  });
}

function queuedEvent(context: GenerationTaskContext): GenerationRuntimeEvent {
  return Object.freeze({
    ...context,
    payload: Object.freeze({ status: "queued" as const }),
    type: "muzhi.generation.status" as const,
  });
}

function stoppedEvent(context: GenerationTaskContext): GenerationRuntimeEvent {
  return Object.freeze({
    ...context,
    payload: Object.freeze({ reason: "user" as const }),
    type: "muzhi.generation.stopped" as const,
  });
}

function providerEvent(
  context: GenerationTaskContext,
  event: AiProviderStreamEvent,
): GenerationRuntimeEvent {
  switch (event.type) {
    case "started":
      return { ...context, payload: {}, type: "muzhi.generation.started" };
    case "reasoning":
      return {
        ...context,
        payload: { text: event.delta },
        type: "muzhi.generation.reasoning",
      };
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
    case "image-output":
      return {
        ...context,
        payload: { errorCode: "IMAGE_OUTPUT_REJECTED" },
        type: "muzhi.generation.failed",
      };
  }
}

function authoritativeEvent(
  event: GenerationRuntimeEvent,
  run: GenerationRun,
): GenerationRuntimeEvent {
  if (event.type !== "muzhi.generation.completed") return event;
  if (run.completionSequence === null) return failedEvent(event);
  return Object.freeze({
    ...event,
    payload: Object.freeze({
      completionSequence: run.completionSequence,
      output: run.partialOutput,
    }),
  });
}

async function broadcast(
  runtime: ChromeRuntimeMessageApi,
  event: GenerationRuntimeEvent,
): Promise<void> {
  if (!isGenerationRuntimeEvent(event)) return;
  try {
    await runtime.sendMessage(event);
  } catch {
    // The task remains authoritative in IndexedDB when no Side Panel is open.
  }
}

export function installChromeGenerationRuntimeListener(
  chromeValue: unknown,
  dependencies: ChromeGenerationRuntimeDependencies,
): void {
  const runtime = readRuntime(chromeValue);

  const execute = async (
    command: GenerationRuntimeCommand,
  ): Promise<GenerationRuntimeEvent> => {
    const context = contextOf(command);
    const owner = createTaskOwner(context);
    if (command.type === "muzhi.generation.stop") {
      const stopped = await dependencies.tasks.stop(owner);
      return stopped === null ? failedEvent(context) : stoppedEvent(context);
    }

    const provider = await dependencies.createProvider();
    await dependencies.tasks.start(owner);
    let aborted = false;
    let iterator: AsyncIterator<AiProviderStreamEvent> | null = null;
    const unregister = dependencies.executors.register({
      async abort(): Promise<void> {
        aborted = true;
        await iterator?.return?.();
      },
      owner,
    });

    void (async (): Promise<void> => {
      try {
        const stream = provider.stream(command.payload.request);
        iterator = stream[Symbol.asyncIterator]();
        while (!aborted) {
          const next = await iterator.next();
          if (next.done || aborted) break;
          const event = providerEvent(context, next.value);
          if (event.type === "muzhi.generation.reasoning") {
            await broadcast(runtime, event);
            continue;
          }
          const persisted = await dependencies.tasks.applyEvent(event);
          if (persisted !== null) {
            await broadcast(runtime, authoritativeEvent(event, persisted));
          }
          if (
            event.type === "muzhi.generation.completed" ||
            event.type === "muzhi.generation.failed"
          ) {
            break;
          }
        }
      } catch {
        if (!aborted) {
          const event = failedEvent(context);
          const persisted = await dependencies.tasks.applyEvent(event);
          if (persisted !== null) await broadcast(runtime, event);
        }
      } finally {
        unregister();
      }
    })();

    return queuedEvent(context);
  };

  runtime.onMessage.addListener((message, _sender, sendResponse): boolean => {
    if (!isGenerationRuntimeCommand(message)) return false;
    const command = message;
    void execute(command).then(
      (event) => sendResponse(event),
      () => sendResponse(failedEvent(contextOf(command))),
    );
    return true;
  });
}
