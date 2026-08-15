import { describe, expect, it, vi } from "vitest";

import type {
  ArtifactGenerationOptions,
  ArtifactRuntime,
} from "../../src/application/artifact-runtime";
import type { ArtifactScope } from "../../src/application/artifact-repository";
import {
  ARTIFACT_RUNTIME_PROTOCOL_VERSION,
  createChromeArtifactRuntimeClient,
  installChromeArtifactRuntimeListener,
  type ChromeArtifactGenerationResult,
  type ChromeArtifactRuntimeClient,
} from "../../src/infrastructure/chrome-artifact-runtime";
import { createArtifact, createGenerationRun } from "../../src/domain";

interface V11ChromeArtifactRuntimeClient extends ChromeArtifactRuntimeClient {
  generate(input: {
    readonly generation: ArtifactGenerationOptions;
    readonly kind: "segments" | "summary";
    readonly scope: ArtifactScope;
    readonly userInstruction: string | null;
    readonly userPrompt?: string | null;
  }): Promise<ChromeArtifactGenerationResult>;
}

const generation: ArtifactGenerationOptions = {
  model: {
    capabilities: {
      contextWindowCharacters: 20_000,
      maxOutputCharacters: 4_000,
      supportedReasoningEfforts: ["none"],
      supportsAttachments: false,
      supportsReasoning: false,
      supportsStreaming: true,
      supportsWebSearch: false,
    },
    discoveredAt: 1,
    displayName: "Summary model",
    modelId: "model-summary",
    providerId: "provider-summary",
  },
  reasoningEffort: "none",
};

const scope: ArtifactScope = {
  branchId: "branch-summary",
  contextRevision: 2,
  sessionId: "session-summary",
  subtitleId: "subtitle-summary",
};

function createGeneratingResult(): ChromeArtifactGenerationResult {
  const artifact = createArtifact({
    artifactId: "artifact-summary",
    artifactRevision: 1,
    branchId: scope.branchId,
    content: "",
    contextRevision: scope.contextRevision,
    createdAt: 1,
    errorCode: null,
    kind: "summary",
    modelId: "model-summary",
    segments: [],
    sessionId: scope.sessionId,
    status: "generating",
    subtitleId: scope.subtitleId,
    updatedAt: 1,
  });
  const run = createGenerationRun({
    branchId: scope.branchId,
    browserSessionId: "browser-summary",
    completionSequence: null,
    contextRevision: scope.contextRevision,
    createdAt: 1,
    errorCode: null,
    expectedOwnerRevision: artifact.artifactRevision,
    kind: "summary",
    partialOutput: "",
    runId: "run-summary",
    sessionId: scope.sessionId,
    status: "preparing",
    stopReason: null,
    subtitleId: scope.subtitleId,
    targetId: artifact.artifactId,
    taskId: "task-summary",
    updatedAt: 1,
  });
  return Object.freeze({ artifact, run });
}

describe("Chrome artifact runtime v11 command", () => {
  it("carries the selected summary detail to the background request instead of leaving it in UI-only state", async () => {
    const sent: unknown[] = [];
    const { artifact, run } = createGeneratingResult();
    const chromeValue = {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        sendMessage: vi.fn(async (message: unknown) => {
          sent.push(message);
          const requestId = Reflect.get(
            message as object,
            "requestId",
          ) as string;
          return {
            payload: { data: { artifact, run }, ok: true },
            protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
            requestId,
            type: "muzhi.artifact.response",
          };
        }),
      },
    };
    const client = createChromeArtifactRuntimeClient(
      chromeValue,
      () => "request-summary",
    ) as V11ChromeArtifactRuntimeClient;

    await client.generate({
      generation,
      kind: "summary",
      scope,
      userInstruction: null,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      payload: {
        kind: "summary",
      },
      type: "muzhi.artifact.generate",
    });
  });

  it("serializes the selected control preset and the per-click requirement as distinct artifact DTO fields", async () => {
    const sent: unknown[] = [];
    const { artifact, run } = createGeneratingResult();
    const chromeValue = {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
        sendMessage: vi.fn(async (message: unknown) => {
          sent.push(message);
          return {
            payload: { data: { artifact, run }, ok: true },
            protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
            requestId: Reflect.get(message as object, "requestId"),
            type: "muzhi.artifact.response",
          };
        }),
      },
    };
    const client = createChromeArtifactRuntimeClient(
      chromeValue,
      () => "request-layered-client",
    ) as V11ChromeArtifactRuntimeClient;

    await client.generate({
      generation,
      kind: "summary",
      scope,
      userInstruction: "本次只比较结论，不展开背景。",
      userPrompt: "始终用审慎、证据优先的方式总结。",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      payload: {
        userInstruction: "本次只比较结论，不展开背景。",
        userPrompt: "始终用审慎、证据优先的方式总结。",
      },
      type: "muzhi.artifact.generate",
    });
    expect(
      Reflect.get(Reflect.get(sent[0] as object, "payload"), "userPrompt"),
    ).not.toBe(
      Reflect.get(Reflect.get(sent[0] as object, "payload"), "userInstruction"),
    );
  });

  it("validates and dispatches both prompt layers to ArtifactRuntime.generate without merging or reordering them", async () => {
    type RuntimeMessageListener = (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean;

    let listener: RuntimeMessageListener | undefined;
    const { artifact, run } = createGeneratingResult();
    const generate = vi.fn(async () => ({
      artifact,
      completion: Promise.resolve(artifact),
      run,
      stop: vi.fn(async () => artifact),
    }));
    const runtime = {
      clear: vi.fn(),
      generate,
      list: vi.fn(),
      stop: vi.fn(),
    } as unknown as ArtifactRuntime;
    const chromeValue = {
      runtime: {
        onMessage: {
          addListener: vi.fn((value: RuntimeMessageListener) => {
            listener = value;
          }),
          removeListener: vi.fn(),
        },
        sendMessage: vi.fn(async () => undefined),
      },
    };
    installChromeArtifactRuntimeListener(chromeValue, {
      getRuntime: vi.fn(async () => runtime),
      queryActiveRuns: vi.fn(async () => []),
      readSubtitleContext: vi.fn(async () => ({
        rows: [{ endMs: 1_000, startMs: 0, text: "真实字幕" }],
        title: "真实标题",
      })),
    });

    let responseResolve!: (response: unknown) => void;
    const response = new Promise<unknown>((resolve) => {
      responseResolve = resolve;
    });
    const accepted = listener?.(
      {
        payload: {
          generation,
          kind: "summary",
          scope,
          userInstruction: "本次附加要求：只列出三条结论。",
          userPrompt: "控制预设：始终先呈现证据，再陈述结论。",
        },
        protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
        requestId: "request-layered-listener",
        type: "muzhi.artifact.generate",
      },
      {},
      responseResolve,
    );

    expect(accepted).toBe(true);
    await expect(response).resolves.toMatchObject({
      payload: { ok: true },
      requestId: "request-layered-listener",
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        userInstruction: "本次附加要求：只列出三条结论。",
        userPrompt: "控制预设：始终先呈现证据，再陈述结论。",
      }),
    );
  });

  it("broadcasts an owner-correlated terminal ArtifactUpdate through the real Chrome client subscription seam", async () => {
    type RuntimeMessageListener = (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean;
    const listeners: RuntimeMessageListener[] = [];
    const chromeValue = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: RuntimeMessageListener) => {
            listeners.push(listener);
          }),
          removeListener: vi.fn(),
        },
        sendMessage: vi.fn(
          async (message: unknown) =>
            new Promise<unknown>((resolve) => {
              for (const listener of [...listeners]) {
                if (listener(message, {}, resolve)) return;
              }
              resolve(undefined);
            }),
        ),
      },
    };
    const { artifact, run } = createGeneratingResult();
    const failedRun = createGenerationRun({
      ...run,
      errorCode: "RATE_LIMITED",
      status: "failed",
      updatedAt: 2,
    });
    const failedArtifact = createArtifact({
      ...artifact,
      errorCode: "RATE_LIMITED",
      status: "failed",
      updatedAt: 2,
    });
    let publishTerminal!: () => void;
    const completionGate = new Promise<void>((resolve) => {
      publishTerminal = resolve;
    });
    installChromeArtifactRuntimeListener(chromeValue, {
      getRuntime: vi.fn(async (onUpdate) => {
        const runtime: ArtifactRuntime = {
          clear: vi.fn(),
          generate: vi.fn(async () => ({
            artifact,
            completion: completionGate.then(() => {
              onUpdate({
                artifact: failedArtifact,
                artifactId: artifact.artifactId,
                kind: artifact.kind,
                partialOutput: "已确认的部分输出",
                progress: {
                  completedChunks: 1,
                  stage: "reducing",
                  totalChunks: 1,
                },
                run: failedRun,
              });
              return failedArtifact;
            }),
            run,
            stop: vi.fn(async () => failedArtifact),
          })),
          list: vi.fn(),
          stop: vi.fn(),
        };
        return runtime;
      }),
      queryActiveRuns: vi.fn(async () => []),
      readSubtitleContext: vi.fn(async () => ({
        rows: [{ endMs: 1_000, startMs: 0, text: "真实字幕" }],
        title: "真实标题",
      })),
    });
    const client = createChromeArtifactRuntimeClient(
      chromeValue,
      () => "request-terminal-update",
    );
    const received: unknown[] = [];
    client.subscribe((event) => received.push(event));

    await client.generate({
      generation,
      kind: "summary",
      scope,
      userInstruction: null,
      userPrompt: null,
    });
    publishTerminal();
    await completionGate;
    await vi.waitFor(() => expect(received).toHaveLength(1));

    expect(received[0]).toMatchObject({
      payload: {
        artifact: { errorCode: "RATE_LIMITED", status: "failed" },
        artifactId: artifact.artifactId,
        run: {
          errorCode: "RATE_LIMITED",
          expectedOwnerRevision: artifact.artifactRevision,
          status: "failed",
          targetId: artifact.artifactId,
          taskId: run.taskId,
        },
      },
      type: "muzhi.artifact.updated",
    });
  });

  it("queries active runs for the current scope through the real client seam", async () => {
    type RuntimeMessageListener = (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean;
    const listeners: RuntimeMessageListener[] = [];
    const chromeValue = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: RuntimeMessageListener) => {
            listeners.push(listener);
          }),
          removeListener: vi.fn(),
        },
        sendMessage: vi.fn(
          async (message: unknown) =>
            new Promise<unknown>((resolve) => {
              for (const listener of [...listeners]) {
                if (listener(message, {}, resolve)) return;
              }
              resolve(undefined);
            }),
        ),
      },
    };
    const { run } = createGeneratingResult();
    const queryActiveRuns = vi.fn(async () => [run]);
    const runtime = {
      clear: vi.fn(),
      generate: vi.fn(),
      list: vi.fn(),
      stop: vi.fn(),
    } as unknown as ArtifactRuntime;
    installChromeArtifactRuntimeListener(chromeValue, {
      getRuntime: vi.fn(async () => runtime),
      queryActiveRuns,
      readSubtitleContext: vi.fn(async () => ({
        rows: [{ endMs: 1_000, startMs: 0, text: "真实字幕" }],
        title: "真实标题",
      })),
    });

    const client = createChromeArtifactRuntimeClient(
      chromeValue,
      () => "request-runs",
    );
    const runs = await client.queryActiveRuns(scope);

    expect(queryActiveRuns).toHaveBeenCalledWith(scope);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ taskId: run.taskId, kind: run.kind });
  });
});
