import { describe, expect, it, vi } from "vitest";

import type {
  AiGenerationRequest,
  AiModelDescriptor,
  AiProviderGateway,
} from "../../src/application/ai/provider-contract";
import type {
  ArtifactRepository,
  ArtifactScope,
} from "../../src/application/artifact-repository";
import { createArtifactRuntime } from "../../src/application/artifact-runtime";
import type { GenerationTaskCoordinator } from "../../src/application/task";
import {
  ARTIFACT_RUNTIME_PROTOCOL_VERSION,
  createChromeArtifactRuntimeClient,
} from "../../src/infrastructure/chrome-artifact-runtime";
import {
  createArtifact,
  createGenerationRun,
  type Artifact,
  type GenerationRun,
  type TaskOwner,
} from "../../src/domain";

const scope: ArtifactScope = Object.freeze({
  branchId: "branch-reasoning",
  contextRevision: 13,
  sessionId: "session-reasoning",
  subtitleId: "subtitle-reasoning",
});

const reasoningModel: AiModelDescriptor = Object.freeze({
  capabilities: Object.freeze({
    contextWindowCharacters: 64_000,
    maxOutputCharacters: 8_000,
    supportedReasoningEfforts: Object.freeze(["none", "high"] as const),
    supportsAttachments: false,
    supportsReasoning: true,
    supportsStreaming: true,
    supportsWebSearch: false,
  }),
  discoveredAt: 13,
  displayName: "Provider reasoning fixture",
  modelId: "reasoning-model",
  providerId: "reasoning-provider",
});

function emptySummary(): Artifact {
  return createArtifact({
    artifactId: "artifact-summary",
    artifactRevision: 0,
    branchId: scope.branchId,
    content: "",
    contextRevision: scope.contextRevision,
    createdAt: 1,
    errorCode: null,
    kind: "summary",
    modelId: null,
    segments: [],
    sessionId: scope.sessionId,
    status: "empty",
    subtitleId: scope.subtitleId,
    updatedAt: 1,
  });
}

function artifactRepository() {
  let current = emptySummary();
  const repository: ArtifactRepository = {
    async beginGeneration({ modelId }) {
      current = createArtifact({
        ...current,
        artifactRevision: current.artifactRevision + 1,
        modelId,
        status: "generating",
        updatedAt: 2,
      });
      return current;
    },
    async clear() {
      return null;
    },
    async complete({ content, expectedRevision, segments }) {
      if (current.artifactRevision !== expectedRevision) return null;
      current = createArtifact({
        ...current,
        content,
        segments,
        status: "ready",
        updatedAt: 4,
      });
      return current;
    },
    async ensure() {
      return current;
    },
    async fail({ errorCode, expectedRevision }) {
      if (current.artifactRevision !== expectedRevision) return null;
      current = createArtifact({
        ...current,
        errorCode,
        status: "failed",
        updatedAt: 4,
      });
      return current;
    },
    async get() {
      return current;
    },
    async list() {
      return [current];
    },
  };
  return repository;
}

function generationTasks(): GenerationTaskCoordinator {
  let current: GenerationRun | null = null;
  return {
    async applyEvent(eventValue: unknown) {
      if (current === null) return null;
      const event = eventValue as {
        readonly payload: Record<string, unknown>;
        readonly type: string;
      };
      if (event.type === "muzhi.generation.reasoning") return null;
      if (event.type === "muzhi.generation.status") {
        current = createGenerationRun({
          ...current,
          status: event.payload.status as GenerationRun["status"],
          updatedAt: current.updatedAt + 1,
        });
      } else if (event.type === "muzhi.generation.delta") {
        current = createGenerationRun({
          ...current,
          partialOutput: `${current.partialOutput}${String(event.payload.delta)}`,
          status: "streaming",
          updatedAt: current.updatedAt + 1,
        });
      } else if (event.type === "muzhi.generation.completed") {
        current = createGenerationRun({
          ...current,
          completionSequence: 0,
          partialOutput: String(event.payload.output),
          status: "completed",
          updatedAt: current.updatedAt + 1,
        });
      } else if (event.type === "muzhi.generation.failed") {
        current = createGenerationRun({
          ...current,
          errorCode: String(event.payload.errorCode),
          status: "failed",
          updatedAt: current.updatedAt + 1,
        });
      }
      return current;
    },
    async start(owner: TaskOwner) {
      current = createGenerationRun({
        ...owner,
        browserSessionId: "browser-reasoning",
        completionSequence: null,
        createdAt: 2,
        errorCode: null,
        partialOutput: "",
        runId: "run-summary-1",
        status: "queued",
        stopReason: null,
        updatedAt: 2,
      });
      return current;
    },
    async stop() {
      return null;
    },
  };
}

function providerWithExplicitReasoning(): AiProviderGateway & {
  readonly requests: AiGenerationRequest[];
} {
  const requests: AiGenerationRequest[] = [];
  return {
    requests,
    async discoverModels() {
      return [reasoningModel];
    },
    async *stream(request) {
      requests.push(request);
      yield { type: "started" } as const;
      yield { delta: "供应商显式推理", type: "reasoning" } as const;
      yield { delta: "最终总结正文", type: "delta" } as const;
      yield { output: "最终总结正文", type: "completed" } as const;
    },
  };
}

function generationResult(runId: string, revision: number) {
  const artifact = createArtifact({
    ...emptySummary(),
    artifactRevision: revision,
    modelId: reasoningModel.modelId,
    status: "generating",
    updatedAt: revision + 1,
  });
  const run = createGenerationRun({
    branchId: scope.branchId,
    browserSessionId: "browser-reasoning",
    completionSequence: null,
    contextRevision: scope.contextRevision,
    createdAt: revision + 1,
    errorCode: null,
    expectedOwnerRevision: artifact.artifactRevision,
    kind: "summary",
    partialOutput: "",
    runId,
    sessionId: scope.sessionId,
    status: "streaming",
    stopReason: null,
    subtitleId: scope.subtitleId,
    targetId: artifact.artifactId,
    taskId: `task-${runId}`,
    updatedAt: revision + 1,
  });
  return Object.freeze({ artifact, run });
}

describe("v13 provider-explicit Artifact reasoning production wiring", () => {
  it("keeps Provider reasoning independent from the final body at the real ArtifactRuntime generation entry", async () => {
    const reasoningSignals: unknown[] = [];
    const provider = providerWithExplicitReasoning();
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-summary",
      createTaskId: () => "task-summary",
      now: () => 13,
      provider,
      repository: artifactRepository(),
      tasks: generationTasks(),
    });
    const input = {
      generation: { model: reasoningModel, reasoningEffort: "high" as const },
      kind: "summary" as const,
      onReasoning: (signal: unknown) => reasoningSignals.push(signal),
      rows: [
        {
          endMs: 1_000,
          lineId: "line-reasoning",
          startMs: 0,
          text: "用于真实公共入口的字幕",
        },
      ],
      scope,
      videoTitle: "Provider reasoning wiring",
    };

    const handle = await runtime.generate(input);
    const stored = await handle.completion;

    expect(provider.requests).toHaveLength(1);
    expect(stored).toMatchObject({
      content: "最终总结正文",
      status: "ready",
    });
    expect(reasoningSignals).toEqual([
      {
        artifactId: handle.artifact.artifactId,
        kind: "summary",
        runId: handle.run.runId,
        text: "供应商显式推理",
      },
    ]);
    expect(JSON.stringify(reasoningSignals)).not.toContain("最终总结正文");
    expect(stored?.content).not.toContain("供应商显式推理");
  });

  it("accepts only the current artifact/kind/run reasoning owner through the real Chrome client subscription", async () => {
    type RuntimeListener = (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean;
    const listeners: RuntimeListener[] = [];
    const results = [
      generationResult("run-summary-1", 1),
      generationResult("run-summary-2", 2),
    ];
    let generationIndex = 0;
    const chromeValue = {
      runtime: {
        onMessage: {
          addListener(listener: RuntimeListener) {
            listeners.push(listener);
          },
          removeListener: vi.fn(),
        },
        sendMessage: vi.fn(async (message: unknown) => {
          const requestId = Reflect.get(message as object, "requestId");
          const result = results[generationIndex++]!;
          return {
            payload: { data: result, ok: true },
            protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
            requestId,
            type: "muzhi.artifact.response",
          };
        }),
      },
    };
    const client = createChromeArtifactRuntimeClient(
      chromeValue,
      () => `request-${generationIndex + 1}`,
    );
    const received: unknown[] = [];
    client.subscribe((event) => received.push(event));
    const generate = () =>
      client.generate({
        generation: { model: reasoningModel, reasoningEffort: "high" },
        kind: "summary",
        scope,
        userInstruction: null,
        userPrompt: null,
      });
    const publish = (payload: Record<string, unknown>) => {
      for (const listener of [...listeners]) {
        listener(
          {
            payload,
            protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
            type: "muzhi.artifact.reasoning",
          },
          {},
          () => undefined,
        );
      }
    };

    const first = await generate();
    publish({
      artifactId: first.artifact.artifactId,
      kind: first.artifact.kind,
      runId: first.run.runId,
      text: "first-current",
    });
    publish({
      artifactId: "artifact-wrong",
      kind: first.artifact.kind,
      runId: first.run.runId,
      text: "wrong-artifact",
    });
    publish({
      artifactId: first.artifact.artifactId,
      kind: "segments",
      runId: first.run.runId,
      text: "wrong-kind",
    });
    publish({
      artifactId: first.artifact.artifactId,
      kind: first.artifact.kind,
      runId: "run-wrong",
      text: "wrong-run",
    });

    const second = await generate();
    publish({
      artifactId: first.artifact.artifactId,
      kind: first.artifact.kind,
      runId: first.run.runId,
      text: "late-owner",
    });
    publish({
      artifactId: second.artifact.artifactId,
      kind: second.artifact.kind,
      runId: second.run.runId,
      text: "second-current",
    });

    expect(
      received.map((event) =>
        Reflect.get(Reflect.get(event as object, "payload"), "text"),
      ),
    ).toEqual(["first-current", "second-current"]);
  });
});
