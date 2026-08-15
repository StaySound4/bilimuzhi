import { describe, expect, it, vi } from "vitest";

import type {
  AiGenerationRequest,
  AiModelDescriptor,
  AiProviderGateway,
  AiProviderStreamEvent,
} from "../../src/application/ai/provider-contract";
import type {
  ArtifactRepository,
  ArtifactScope,
} from "../../src/application/artifact-repository";
import {
  createArtifactRuntime,
  subtitleReferenceBudget,
} from "../../src/application/artifact-runtime";
import type { GenerationTaskCoordinator } from "../../src/application/task";
import {
  createArtifact,
  createGenerationRun,
  type Artifact,
  type GenerationRun,
  type SubtitleRow,
  type TaskOwner,
} from "../../src/domain";

const scope: ArtifactScope = Object.freeze({
  branchId: "branch-1",
  contextRevision: 1,
  sessionId: "session-1",
  subtitleId: "subtitle-1",
});

function model(contextWindowCharacters: number): AiModelDescriptor {
  return Object.freeze({
    capabilities: {
      contextWindowCharacters,
      maxOutputCharacters: 4_000,
      supportedReasoningEfforts: ["none"] as const,
      supportsAttachments: false,
      supportsReasoning: false,
      supportsStreaming: true,
      supportsWebSearch: false,
    },
    discoveredAt: 1,
    displayName: "Test Model",
    modelId: "test-model",
    providerId: "test",
  });
}

function rows(count: number): readonly SubtitleRow[] {
  return Object.freeze(
    Array.from({ length: count }, (_, index) => ({
      endMs: (index + 1) * 1_000,
      lineId: `line-${index}`,
      startMs: index * 1_000,
      text: `第 ${index} 行字幕内容用于填充上下文预算`,
    })),
  );
}

function emptyArtifact(kind: "segments" | "summary"): Artifact {
  return createArtifact({
    artifactId: "artifact-1",
    artifactRevision: 0,
    branchId: scope.branchId,
    content: "",
    contextRevision: scope.contextRevision,
    createdAt: 1,
    errorCode: null,
    kind,
    modelId: null,
    segments: [],
    sessionId: scope.sessionId,
    status: "empty",
    subtitleId: scope.subtitleId,
    updatedAt: 1,
  });
}

function createFakeRepository(kind: "segments" | "summary") {
  let current = emptyArtifact(kind);
  const repository: ArtifactRepository = {
    async beginGeneration({ modelId }) {
      current = createArtifact({
        ...current,
        artifactRevision: current.artifactRevision + 1,
        content: "",
        errorCode: null,
        modelId,
        segments: [],
        status: "generating",
        updatedAt: 2,
      });
      return current;
    },
    async clear() {
      current = createArtifact({
        ...current,
        artifactRevision: current.artifactRevision + 1,
        content: "",
        errorCode: null,
        modelId: null,
        segments: [],
        status: "empty",
        updatedAt: 3,
      });
      return current;
    },
    async complete({ content, expectedRevision, segments }) {
      if (current.artifactRevision !== expectedRevision) return null;
      current = createArtifact({
        ...current,
        content,
        errorCode: null,
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
        updatedAt: 5,
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
  return { read: () => current, repository };
}

function createFakeTasks() {
  let run: GenerationRun | null = null;
  const tasks: GenerationTaskCoordinator = {
    async applyEvent(event: unknown) {
      const value = event as {
        readonly payload: Record<string, unknown>;
        readonly type: string;
      };
      if (run === null) return null;
      if (
        ["cancelled", "completed", "failed", "interrupted", "stopped"].includes(
          run.status,
        )
      ) {
        return null;
      }
      if (value.type === "muzhi.generation.started") {
        run = createGenerationRun({ ...run, status: "running", updatedAt: 3 });
      } else if (value.type === "muzhi.generation.status") {
        run = createGenerationRun({
          ...run,
          status: value.payload.status as GenerationRun["status"],
          updatedAt: 3,
        });
      } else if (value.type === "muzhi.generation.delta") {
        run = createGenerationRun({
          ...run,
          partialOutput: `${run.partialOutput}${value.payload.delta as string}`,
          updatedAt: 3,
        });
      } else if (value.type === "muzhi.generation.completed") {
        run = createGenerationRun({
          ...run,
          completionSequence: 0,
          partialOutput: value.payload.output as string,
          status: "completed",
          updatedAt: 4,
        });
      } else if (value.type === "muzhi.generation.failed") {
        run = createGenerationRun({
          ...run,
          errorCode: value.payload.errorCode as string,
          status: "failed",
          updatedAt: 4,
        });
      }
      return run;
    },
    async start(owner: TaskOwner) {
      run = createGenerationRun({
        ...owner,
        browserSessionId: "browser-1",
        completionSequence: null,
        createdAt: 2,
        errorCode: null,
        partialOutput: "",
        runId: "run-1",
        status: "queued",
        stopReason: null,
        updatedAt: 2,
      });
      return run;
    },
    async stop() {
      if (run === null || run.status !== "queued") {
        if (run === null || run.status !== "running") return null;
      }
      run = createGenerationRun({
        ...run,
        completionSequence: null,
        errorCode: null,
        status: "stopped",
        stopReason: "user",
        updatedAt: 5,
      });
      return run;
    },
  };
  return { read: () => run, tasks };
}

function createFakeProvider(
  responses: readonly string[],
): AiProviderGateway & { readonly requests: AiGenerationRequest[] } {
  const requests: AiGenerationRequest[] = [];
  let index = 0;
  return {
    requests,
    async discoverModels() {
      return [];
    },
    async *stream(request: AiGenerationRequest) {
      requests.push(request);
      const output = responses[Math.min(index, responses.length - 1)];
      index += 1;
      const events: AiProviderStreamEvent[] = [
        { type: "started" },
        { delta: output, type: "delta" },
        { output, type: "completed" },
      ];
      for (const event of events) yield event;
    },
  };
}

describe("subtitleReferenceBudget", () => {
  it("reserves context for instructions and output", () => {
    expect(subtitleReferenceBudget(model(100_000))).toBe(55_000);
    expect(subtitleReferenceBudget(model(1_000))).toBe(2_000);
  });
});

describe("ArtifactRuntime", () => {
  it("streams a single-chunk summary and stores the parsed result", async () => {
    const { read, repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const provider = createFakeProvider(["## 关键要点\n- 第一点"]);
    const updates: unknown[] = [];
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      onUpdate: (update) => updates.push(update),
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: rows(3),
      scope,
      videoTitle: "示例视频",
    });
    const stored = await handle.completion;

    expect(provider.requests).toHaveLength(1);
    expect(stored?.status).toBe("ready");
    expect(read().content).toContain("关键要点");
    expect(read().modelId).toBe("test-model");
    expect(updates.length).toBeGreaterThan(0);
  });

  it("maps every chunk before reducing when the subtitle exceeds the budget", async () => {
    const { repository } = createFakeRepository("segments");
    const { tasks } = createFakeTasks();
    const completeSegmentOutput = [
      "[00:00:00-00:06:40] 最终章节",
      "合并描述",
    ].join("\n");
    const provider = createFakeProvider([
      completeSegmentOutput,
      completeSegmentOutput,
      completeSegmentOutput,
    ]);
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(4_000), reasoningEffort: "auto" },
      kind: "segments",
      rows: rows(400),
      scope,
      videoTitle: "长视频",
    });
    const stored = await handle.completion;

    expect(provider.requests.length).toBeGreaterThan(2);
    expect(provider.requests.at(-1)!.messages.at(-1)!.content).toContain(
      "合并为一份完整",
    );
    expect(stored?.status).toBe("ready");
    expect(stored?.segments).toEqual([
      {
        detail: "合并描述",
        endLineId: "line-399",
        endMs: 400_000,
        isAdvertisement: false,
        startLineId: "line-0",
        startMs: 0,
        title: "最终章节",
        type: "content",
      },
    ]);
  });

  it("publishes an owner-correlated terminal update when a map-stage provider failure is persisted", async () => {
    const { repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const updates: Array<
      Parameters<
        NonNullable<Parameters<typeof createArtifactRuntime>[0]["onUpdate"]>
      >[0]
    > = [];
    const provider: AiProviderGateway = {
      async discoverModels() {
        return [];
      },
      async *stream() {
        yield { type: "started" } as const;
        yield {
          code: "RATE_LIMITED",
          retryable: true,
          type: "failed",
        } as const;
      },
    };
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      onUpdate: (update) => updates.push(update),
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(4_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: rows(400),
      scope,
      videoTitle: "map failure",
    });
    await handle.completion;

    expect(updates.at(-1)).toMatchObject({
      artifact: { errorCode: "RATE_LIMITED", status: "failed" },
      artifactId: handle.artifact.artifactId,
      run: {
        errorCode: "RATE_LIMITED",
        expectedOwnerRevision: handle.artifact.artifactRevision,
        status: "failed",
        targetId: handle.artifact.artifactId,
        taskId: handle.run.taskId,
      },
    });
  });

  it("classifies a reduce-stage early end and publishes its terminal owner update", async () => {
    const { repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const updates: Array<
      Parameters<
        NonNullable<Parameters<typeof createArtifactRuntime>[0]["onUpdate"]>
      >[0]
    > = [];
    const provider: AiProviderGateway = {
      async discoverModels() {
        return [];
      },
      async *stream(request) {
        const prompt = request.messages
          .map((message) => message.content)
          .join("\n");
        yield { type: "started" } as const;
        if (prompt.includes("将分块草稿合并为一份完整的最终结果")) {
          yield {
            delta: "已确认但未完成的 reduce 输出",
            type: "delta",
          } as const;
          return;
        }
        yield { output: "map draft", type: "completed" } as const;
      },
    };
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      onUpdate: (update) => updates.push(update),
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(4_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: rows(400),
      scope,
      videoTitle: "reduce early end",
    });
    await handle.completion;

    expect(updates.at(-1)).toMatchObject({
      artifact: { errorCode: "PROVIDER_EARLY_END", status: "failed" },
      artifactId: handle.artifact.artifactId,
      partialOutput: "已确认但未完成的 reduce 输出",
      run: {
        errorCode: "PROVIDER_EARLY_END",
        expectedOwnerRevision: handle.artifact.artifactRevision,
        status: "failed",
        targetId: handle.artifact.artifactId,
        taskId: handle.run.taskId,
      },
    });
  });

  it("keeps a stable failure when the provider stream fails", async () => {
    const { read, repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const provider: AiProviderGateway = {
      async discoverModels() {
        return [];
      },
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error("provider exploded");
      },
    };
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: rows(2),
      scope,
      videoTitle: "示例视频",
    });
    await handle.completion;

    expect(read().status).toBe("failed");
    expect(read().errorCode).toBe("INTERNAL_ERROR");
  });

  it("classifies a repository commit failure without losing the last successful summary", async () => {
    const previous = createArtifact({
      artifactId: "artifact-1",
      artifactRevision: 2,
      branchId: scope.branchId,
      content: "previous successful summary",
      contextRevision: scope.contextRevision,
      createdAt: 1,
      errorCode: null,
      kind: "summary",
      modelId: "previous-model",
      segments: [],
      sessionId: scope.sessionId,
      status: "ready",
      subtitleId: scope.subtitleId,
      updatedAt: 2,
    });
    const generating = createArtifact({
      ...previous,
      artifactRevision: previous.artifactRevision + 1,
      content: "",
      modelId: "test-model",
      status: "generating",
      updatedAt: 3,
    });
    const complete = vi.fn<ArtifactRepository["complete"]>(async () => {
      throw new Error("indexeddb transaction aborted");
    });
    const fail = vi.fn<ArtifactRepository["fail"]>(async () => previous);
    const repository: ArtifactRepository = {
      async beginGeneration() {
        return generating;
      },
      async clear() {
        return null;
      },
      complete,
      async ensure() {
        return previous;
      },
      fail,
      async get() {
        return previous;
      },
      async list() {
        return [previous];
      },
    };
    const { tasks } = createFakeTasks();
    const updates: unknown[] = [];
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      onUpdate: (update) => updates.push(update),
      provider: createFakeProvider(["new summary"]),
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: rows(2),
      scope,
      videoTitle: "persistence failure",
    });

    await expect(handle.completion).resolves.toEqual(previous);
    expect(complete).toHaveBeenCalledOnce();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "PERSISTENCE_FAILED" }),
    );
    expect(updates.at(-1)).toMatchObject({
      artifact: previous,
      artifactId: generating.artifactId,
      partialOutput: "new summary",
      run: {
        errorCode: "PERSISTENCE_FAILED",
        expectedOwnerRevision: generating.artifactRevision,
        status: "failed",
        targetId: generating.artifactId,
      },
    });
  });

  it("refuses to generate without subtitle rows", async () => {
    const { repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider: createFakeProvider(["never"]),
      repository,
      tasks,
    });

    await expect(
      runtime.generate({
        generation: { model: model(200_000), reasoningEffort: "auto" },
        kind: "summary",
        rows: [],
        scope,
        videoTitle: "空字幕",
      }),
    ).rejects.toThrow();
  });

  it("does not overwrite a finished artifact when stop arrives late", async () => {
    const { read, repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const stopSpy = vi.spyOn(tasks, "stop");
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider: createFakeProvider(["部分输出"]),
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: rows(2),
      scope,
      videoTitle: "示例视频",
    });
    await handle.completion;

    await expect(handle.stop()).resolves.toBeNull();
    expect(stopSpy).toHaveBeenCalled();
    expect(read().status).toBe("ready");
    expect(read().content).toBe("部分输出");
  });

  it("keeps both summary user layers in the strict ordered prompt runtime contract", async () => {
    const { repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const provider = createFakeProvider(["## 结论\n- provider output"]);
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: [
        {
          endMs: 2_000,
          lineId: "line-0",
          startMs: 0,
          text: "UNTRUSTED_REFERENCE_MARKER",
        },
      ],
      scope,
      userInstruction: "ONE_SHOT_REQUEST_MARKER",
      userPrompt: "CONTROL_PRESET_MARKER",
      videoTitle: "TRUSTED_METADATA_MARKER",
    });
    const stored = await handle.completion;

    expect(stored?.status).toBe("ready");
    expect(provider.requests).toHaveLength(1);
    const messages = provider.requests[0].messages;
    const markerIndex = (marker: string) =>
      messages.findIndex((message) => message.content.includes(marker));
    const orderedIndexes = [
      markerIndex("不可信数据"),
      markerIndex("视频内容总结助手"),
      markerIndex("CONTROL_PRESET_MARKER"),
      markerIndex("ONE_SHOT_REQUEST_MARKER"),
      markerIndex("TRUSTED_METADATA_MARKER"),
      markerIndex("UNTRUSTED_REFERENCE_MARKER"),
    ];
    expect(orderedIndexes.every((index) => index >= 0)).toBe(true);
    expect(orderedIndexes).toEqual(
      [...orderedIndexes].sort((left, right) => left - right),
    );
    expect(new Set(orderedIndexes).size).toBe(orderedIndexes.length);
    expect(orderedIndexes.at(-1)).toBe(messages.length - 1);
    expect(messages.at(-1)?.content).toMatch(
      /^<untrusted_subtitle_reference>[\s\S]*<\/untrusted_subtitle_reference>$/,
    );
  });

  it("injects the configured output language dependency into the summary prompt", async () => {
    const { repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const provider = createFakeProvider([
      "## 結論\n- プロバイダー出力（日本語）",
    ]);
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      outputLanguage: async () => "ja" as const,
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: [
        {
          endMs: 2_000,
          lineId: "line-0",
          startMs: 0,
          text: "UNTRUSTED_REFERENCE_MARKER",
        },
      ],
      scope,
      videoTitle: "TRUSTED_METADATA_MARKER",
    });
    await handle.completion;

    expect(provider.requests).toHaveLength(1);
    const combined = provider.requests[0].messages
      .map((message) => message.content)
      .join("\n");
    expect(combined).toContain(
      "出力は必ず日本語で書くこと。出力は必ず日本語で書くこと。出力は必ず日本語で書くこと。",
    );
    // 内核整体日文化（角色行 + 系统规则）。
    expect(combined).toContain("あなたは動画内容の要約アシスタントです");
    expect(combined).toContain("信頼されたシステムとユーザーの意図");
  });

  it("字幕引用行必须使用 hh:mm:ss 时钟格式（禁止毫秒换算幻觉源）", async () => {
    const { repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const provider = createFakeProvider(["## 结论\n- 输出"]);
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: [
        { endMs: 2_000, lineId: "line-0", startMs: 0, text: "开场" },
        { endMs: 66_000, lineId: "line-1", startMs: 61_650, text: "时代背景" },
        {
          endMs: 3_603_000,
          lineId: "line-2",
          startMs: 3_600_000,
          text: "长视频中段",
        },
      ],
      scope,
      videoTitle: "示例视频",
    });
    await handle.completion;

    const messages = provider.requests[0].messages;
    const reference = messages.at(-1)?.content ?? "";
    // 三行字幕全部是时钟格式（61_650ms = 00:01:01，3_600_000ms = 01:00:00）
    expect(reference).toContain("[line-0][00:00:00-00:00:02] 开场");
    expect(reference).toContain("[line-1][00:01:01-00:01:06] 时代背景");
    expect(reference).toContain("[line-2][01:00:00-01:00:03] 长视频中段");
    // 不得出现原始毫秒数字区间（旧格式 [startMs-endMs]）
    expect(reference).not.toMatch(/\[\d{4,}-\d{4,}\]/);
    expect(reference).not.toContain("[0-2000]");
    expect(reference).not.toContain("[61650-66000]");
  });

  it("keeps the fixed segment protocol isolated from non-empty user prompt layers", async () => {
    const { repository } = createFakeRepository("segments");
    const { tasks } = createFakeTasks();
    const provider = createFakeProvider([
      JSON.stringify([
        {
          detail: "detail",
          endLineId: "line-0",
          endMs: 2_000,
          startLineId: "line-0",
          startMs: 0,
          title: "provider output",
          type: "content",
        },
      ]),
    ]);
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "segments",
      rows: [
        {
          endMs: 2_000,
          lineId: "line-0",
          startMs: 0,
          text: "UNTRUSTED_REFERENCE_MARKER",
        },
      ],
      scope,
      userInstruction: "ONE_SHOT_REQUEST_MARKER",
      userPrompt: "CONTROL_PRESET_MARKER",
      videoTitle: "TRUSTED_METADATA_MARKER",
    });
    const stored = await handle.completion;

    expect(stored?.status).toBe("ready");
    expect(stored?.segments).toHaveLength(1);
    expect(provider.requests).toHaveLength(1);
    const messages = provider.requests[0].messages;
    const markerIndex = (marker: string) =>
      messages.findIndex((message) => message.content.includes(marker));
    const orderedIndexes = [
      markerIndex("不可信数据"),
      markerIndex("内置输出格式：严格遵守"),
      markerIndex("TRUSTED_METADATA_MARKER"),
      markerIndex("UNTRUSTED_REFERENCE_MARKER"),
    ];
    expect(orderedIndexes.every((index) => index >= 0)).toBe(true);
    expect(orderedIndexes).toEqual(
      [...orderedIndexes].sort((left, right) => left - right),
    );
    expect(new Set(orderedIndexes).size).toBe(orderedIndexes.length);
    expect(orderedIndexes.at(-1)).toBe(messages.length - 1);
    expect(messages.at(-1)?.content).toMatch(
      /^<untrusted_subtitle_reference>[\s\S]*<\/untrusted_subtitle_reference>$/,
    );
    const providerContract = messages
      .map((message) => message.content)
      .join("\n");
    expect(providerContract).not.toContain("CONTROL_PRESET_MARKER");
    expect(providerContract).not.toContain("ONE_SHOT_REQUEST_MARKER");
  });

  it("puts the nearby verifiable-time obligation into the summary provider request", async () => {
    const { repository } = createFakeRepository("summary");
    const { tasks } = createFakeTasks();
    const provider = createFakeProvider(["summary output"]);
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider,
      repository,
      tasks,
    });

    const handle = await runtime.generate({
      generation: { model: model(200_000), reasoningEffort: "auto" },
      kind: "summary",
      rows: rows(3),
      scope,
      videoTitle: "summary time-link contract",
    });
    await handle.completion;
    const providerContract = provider.requests
      .flatMap((request) => request.messages)
      .map((message) => message.content)
      .join("\n");

    expect(providerContract).toMatch(
      /每个重要(?:观点|事实)[\s\S]{0,80}(?:就近|附近)[\s\S]{0,80}(?:可验证|真实)[\s\S]{0,80}(?:时间链接|跳转链接)/,
    );
  });

  it.each(["summary", "segments"] as const)(
    "persists the real five-stage lifecycle before completing %s",
    async (kind) => {
      const { repository } = createFakeRepository(kind);
      const { tasks } = createFakeTasks();
      const applyEvent = vi.spyOn(tasks, "applyEvent");
      const provider = createFakeProvider([
        kind === "summary"
          ? "summary output"
          : JSON.stringify([
              {
                detail: "detail",
                endLineId: "line-1",
                endMs: 2_000,
                startLineId: "line-0",
                startMs: 0,
                title: "chapter",
                type: "content",
              },
            ]),
      ]);
      const runtime = createArtifactRuntime({
        createArtifactId: () => "artifact-1",
        createTaskId: () => "task-1",
        now: () => 10,
        provider,
        repository,
        tasks,
      });

      const handle = await runtime.generate({
        generation: { model: model(200_000), reasoningEffort: "auto" },
        kind,
        rows: rows(2),
        scope,
        videoTitle: "lifecycle",
      });
      await handle.completion;
      const persistedPhases = applyEvent.mock.calls.flatMap(([value]) => {
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
    },
  );

  it("rejects weak-model free text, keeps the last successful segments, and never completes falsely", async () => {
    const previous = createArtifact({
      artifactId: "artifact-1",
      artifactRevision: 4,
      branchId: scope.branchId,
      content: "previous structured output",
      contextRevision: scope.contextRevision,
      createdAt: 1,
      errorCode: null,
      kind: "segments",
      modelId: "previous-model",
      segments: [
        {
          detail: "previous detail",
          endMs: 2_000,
          isAdvertisement: false,
          startMs: 0,
          title: "previous chapter",
        },
      ],
      sessionId: scope.sessionId,
      status: "ready",
      subtitleId: scope.subtitleId,
      updatedAt: 4,
    });
    let visible = previous;
    const complete = vi.fn<ArtifactRepository["complete"]>(async (input) => {
      visible = createArtifact({
        ...previous,
        artifactRevision: input.expectedRevision,
        content: input.content,
        modelId: "weak-model",
        segments: input.segments,
        updatedAt: 10,
      });
      return visible;
    });
    const fail = vi.fn<ArtifactRepository["fail"]>(async () => visible);
    const repository: ArtifactRepository = {
      async beginGeneration({ modelId }) {
        return createArtifact({
          ...previous,
          artifactRevision: previous.artifactRevision + 1,
          content: "",
          modelId,
          segments: [],
          status: "generating",
          updatedAt: 10,
        });
      },
      async clear() {
        return null;
      },
      complete,
      async ensure() {
        return previous;
      },
      fail,
      async get() {
        return visible;
      },
      async list() {
        return [visible];
      },
    };
    const { tasks } = createFakeTasks();
    const applyEvent = vi.spyOn(tasks, "applyEvent");
    const runtime = createArtifactRuntime({
      createArtifactId: () => "artifact-1",
      createTaskId: () => "task-1",
      now: () => 10,
      provider: createFakeProvider([
        "无法解析的自由文本段落\n\n第二段自由文本。",
      ]),
      repository,
      tasks,
    });
    const identifiedRows = [
      { endMs: 1_000, lineId: "line-a", startMs: 0, text: "a" },
      { endMs: 2_000, lineId: "line-b", startMs: 1_000, text: "b" },
    ] as unknown as readonly SubtitleRow[];

    const handle = await runtime.generate({
      generation: { model: model(2_000), reasoningEffort: "auto" },
      kind: "segments",
      rows: identifiedRows,
      scope,
      videoTitle: "weak-model fallback",
    });
    await handle.completion;

    // 切片 9：自由文本降级为原文分段，不失败、不丢结果。
    expect(fail).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: expect.arrayContaining([
          expect.objectContaining({ title: "分段 1" }),
        ]),
      }),
    );
    const terminalEvents = applyEvent.mock.calls.map(
      ([event]) => (event as { readonly type: string }).type,
    );
    expect(terminalEvents).not.toContain("muzhi.generation.failed");
    expect(terminalEvents).toContain("muzhi.generation.completed");
  });
});
