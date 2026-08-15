import { parseStructuredArtifactSegments } from "./ai/artifact-prompt";
import { formatClock } from "./ai/context-plan";
import {
  createSubtitleContextPlan,
  type SubtitleContextChunk,
  type SubtitleContextPlan,
} from "./ai/context-plan";
import {
  createAiGenerationRequest,
  type AiGenerationKind,
  type AiGenerationRequest,
  type AiModelDescriptor,
  type AiProviderGateway,
  type AiProviderStreamEvent,
} from "./ai/provider-contract";
import { AiProviderError } from "./ai/provider-error";
import { buildTaskPrompt } from "./ai/prompt-builder";
import { PROMPT_LANGUAGE_PACKS } from "./ai/prompt-language-pack";
import type { ArtifactRepository, ArtifactScope } from "./artifact-repository";
import type {
  GenerationRuntimeEvent,
  GenerationTaskContext,
} from "./generation-runtime-contract";
import { createGenerationSnapshotHash } from "./generation-runtime-contract";
import type { GenerationTaskCoordinator } from "./task";
import type { UiLanguage } from "../i18n/languages";
import {
  createTaskOwner,
  type Artifact,
  type ArtifactKind,
  type GenerationRun,
  type SubtitleRow,
} from "../domain";

export type ArtifactGenerationOptions = Pick<
  AiGenerationRequest,
  "model" | "reasoningEffort"
>;

export type ArtifactProgressStage = "planning" | "mapping" | "reducing";

export interface ArtifactProgress {
  readonly completedChunks: number;
  readonly stage: ArtifactProgressStage;
  readonly totalChunks: number;
}

export interface ArtifactUpdate {
  readonly artifact: Artifact | null;
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly partialOutput: string;
  readonly progress: ArtifactProgress;
  readonly run: GenerationRun;
}

/** Provider-authored reasoning is transient UI state and never artifact content. */
export interface ArtifactReasoningUpdate {
  readonly artifactId: string;
  readonly kind: ArtifactKind;
  readonly runId: string;
  readonly text: string;
}

export interface ArtifactGenerationInput {
  readonly generation: ArtifactGenerationOptions;
  readonly kind: ArtifactKind;
  readonly onReasoning?: (update: ArtifactReasoningUpdate) => void;
  readonly rows: readonly SubtitleRow[];
  readonly scope: ArtifactScope;
  readonly userInstruction?: string | null;
  readonly userPrompt?: string | null;
  readonly videoBvid?: string;
  readonly videoTitle: string;
}

export interface ArtifactGenerationHandle {
  readonly artifact: Artifact;
  readonly completion: Promise<Artifact | null>;
  readonly run: GenerationRun;
  stop(): Promise<Artifact | null>;
}

export interface ArtifactRuntimeDependencies {
  readonly createArtifactId: () => string;
  readonly createTaskId: () => string;
  readonly now: () => number;
  readonly onUpdate?: (update: ArtifactUpdate) => void;
  readonly provider: AiProviderGateway;
  readonly repository: ArtifactRepository;
  readonly tasks: GenerationTaskCoordinator;
  /** AI 输出默认语言（docs/i18n-spec.md §5）；缺省不注入指令。 */
  /**
   * AI 输出默认语言（docs/i18n-spec.md §5）：per-mode 弱约束默认值，
   * 每次生成前按任务模式读取。
   */
  readonly outputLanguage?: (
    kind: AiGenerationKind,
  ) => UiLanguage | Promise<UiLanguage | undefined> | undefined;
}

export interface ArtifactRuntime {
  list(scope: ArtifactScope): Promise<readonly Artifact[]>;
  generate(input: ArtifactGenerationInput): Promise<ArtifactGenerationHandle>;
  clear(input: { readonly artifactId: string }): Promise<Artifact | null>;
  stop(run: GenerationRun): Promise<Artifact | null>;
}

/**
 * Conservative share of the model context window reserved for the subtitle
 * reference. The rest carries the instruction block, trusted metadata and the
 * model's own output budget.
 */
const REFERENCE_CONTEXT_SHARE = 0.55;
const MINIMUM_REFERENCE_BUDGET = 2_000;

export function subtitleReferenceBudget(model: AiModelDescriptor): number {
  return Math.max(
    MINIMUM_REFERENCE_BUDGET,
    Math.floor(
      model.capabilities.contextWindowCharacters * REFERENCE_CONTEXT_SHARE,
    ),
  );
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

function isTerminal(run: GenerationRun): boolean {
  return (
    run.status === "completed" ||
    run.status === "failed" ||
    run.status === "interrupted" ||
    run.status === "stopped" ||
    run.status === "cancelled"
  );
}

function lineIdFor(row: SubtitleRow, index: number): string {
  return row.lineId?.trim() || `line-${index}`;
}

function identifiedChunk(
  chunk: SubtitleContextChunk,
  rows: readonly SubtitleRow[],
): SubtitleContextChunk {
  return Object.freeze({
    ...chunk,
    text: chunk.rowIndexes
      .map((index) => {
        const row = rows[index];
        // 字幕时间戳预转为 hh:mm:ss 时钟格式再给模型（长毫秒数字换算
        // 容易让模型产生幻觉并反复“思维反刍”做换算）。
        return `[${lineIdFor(row, index)}][${formatClock(row.startMs)}-${formatClock(row.endMs)}] ${row.text}`;
      })
      .join("\n"),
  });
}

function promptPlan(
  plan: SubtitleContextPlan,
  chunks: readonly SubtitleContextChunk[],
): SubtitleContextPlan {
  return Object.freeze({ ...plan, chunks: Object.freeze([...chunks]) });
}

class DefaultArtifactRuntime implements ArtifactRuntime {
  constructor(private readonly dependencies: ArtifactRuntimeDependencies) {}

  list(scope: ArtifactScope): Promise<readonly Artifact[]> {
    return this.dependencies.repository.list(scope);
  }

  clear(input: { readonly artifactId: string }): Promise<Artifact | null> {
    return this.dependencies.repository.clear(input.artifactId);
  }

  async stop(run: GenerationRun): Promise<Artifact | null> {
    if (run.kind !== "segments" && run.kind !== "summary") {
      throw new Error("The generation run is not an artifact task");
    }
    const stopped = await this.dependencies.tasks.stop(run);
    if (stopped === null) return null;
    return this.dependencies.repository.fail({
      artifactId: stopped.targetId,
      errorCode: "USER_CANCELLED",
      expectedRevision: stopped.expectedOwnerRevision,
    });
  }

  async generate(
    input: ArtifactGenerationInput,
  ): Promise<ArtifactGenerationHandle> {
    if (input.rows.length === 0) {
      throw new Error("The subtitle context has no rows to analyse");
    }
    const ensured = await this.dependencies.repository.ensure({
      artifactId: this.dependencies.createArtifactId(),
      kind: input.kind,
      scope: input.scope,
    });
    const artifact = await this.dependencies.repository.beginGeneration({
      artifactId: ensured.artifactId,
      modelId: input.generation.model.modelId,
    });
    const owner = createTaskOwner({
      branchId: input.scope.branchId,
      contextRevision: input.scope.contextRevision,
      expectedOwnerRevision: artifact.artifactRevision,
      kind: input.kind,
      sessionId: input.scope.sessionId,
      subtitleId: input.scope.subtitleId,
      targetId: artifact.artifactId,
      taskId: this.dependencies.createTaskId(),
    });
    const [promptHash, modelHash, contextHash] = await Promise.all([
      createGenerationSnapshotHash({
        userInstruction:
          input.kind === "segments" ? null : (input.userInstruction ?? null),
        userPrompt:
          input.kind === "segments" ? null : (input.userPrompt ?? null),
      }),
      createGenerationSnapshotHash({
        model: input.generation.model,
        reasoningEffort: input.generation.reasoningEffort,
      }),
      createGenerationSnapshotHash({
        kind: input.kind,
        rows: input.rows,
        scope: input.scope,
        videoBvid: input.videoBvid ?? null,
        videoTitle: input.videoTitle,
      }),
    ]);
    const run = await this.dependencies.tasks.start({
      ...owner,
      contextHash,
      conversationRevision: owner.expectedOwnerRevision,
      modelHash,
      promptHash,
      runRevision: 0,
    });
    const completion = this.execute(input, artifact, run).catch(
      async (error) => {
        const errorCode =
          error instanceof AiProviderError ? error.code : "INTERNAL_ERROR";
        const failed = await this.dependencies.tasks.applyEvent({
          ...eventContext(run),
          payload: { errorCode },
          type: "muzhi.generation.failed",
        });
        const stored = await this.dependencies.repository.fail({
          artifactId: artifact.artifactId,
          errorCode: failed?.errorCode ?? errorCode,
          expectedRevision: artifact.artifactRevision,
        });
        this.notify({
          artifact: stored,
          artifactId: artifact.artifactId,
          kind: input.kind,
          partialOutput: failed?.partialOutput ?? "",
          progress: Object.freeze({
            completedChunks: 0,
            stage: "planning",
            totalChunks: 0,
          }),
          run: failed ?? run,
        });
        return stored;
      },
    );
    return Object.freeze({
      artifact,
      completion,
      run,
      stop: () => this.stop(run),
    });
  }

  private notify(update: {
    readonly artifact: Artifact | null;
    readonly artifactId: string;
    readonly kind: ArtifactKind;
    readonly partialOutput: string;
    readonly progress: ArtifactProgress;
    readonly run: GenerationRun;
  }): void {
    try {
      this.dependencies.onUpdate?.(Object.freeze({ ...update }));
    } catch {
      // Transient UI notifications cannot affect durable execution.
    }
  }

  private async execute(
    input: ArtifactGenerationInput,
    artifact: Artifact,
    run: GenerationRun,
  ): Promise<Artifact | null> {
    await this.dependencies.tasks.applyEvent({
      ...eventContext(run),
      payload: { status: "preparing" },
      type: "muzhi.generation.status",
    });
    const budget = subtitleReferenceBudget(input.generation.model);
    const plan = createSubtitleContextPlan({
      characterBudget: budget,
      kind: input.kind,
      query: null,
      rows: input.rows,
    });
    this.notify({
      artifact,
      artifactId: artifact.artifactId,
      kind: input.kind,
      partialOutput: "",
      progress: {
        completedChunks: 0,
        stage: "planning",
        totalChunks: plan.chunks.length,
      },
      run,
    });

    const videoMeta = Object.freeze({
      bvid:
        input.videoBvid !== undefined &&
        /^BV[0-9A-Za-z]{10}$/.test(input.videoBvid)
          ? input.videoBvid
          : "BV1xx411c7mD",
      durationSec: input.rows.at(-1)?.endMs
        ? Math.ceil(input.rows.at(-1)!.endMs / 1_000)
        : null,
      title: input.videoTitle,
    });
    // 输出默认语言在 generate 入口读取一次：既用于提示词注入，
    // 也用于生成完成后的正文语言校验（弱约束，不符时重试一次）。
    const outputLanguage = await this.dependencies.outputLanguage?.(input.kind);
    const languagePack =
      outputLanguage === undefined
        ? null
        : PROMPT_LANGUAGE_PACKS[outputLanguage];
    const createMessages = async (
      contextPlan: SubtitleContextPlan,
      oneShot: string,
    ) =>
      buildTaskPrompt({
        contextPlan,
        kind: input.kind,
        meta: videoMeta,
        outputLanguage,
        question: oneShot,
        rows: input.rows,
        userPrompt:
          input.kind === "segments" ? null : (input.userPrompt ?? null),
      });
    const userInstruction =
      input.kind === "segments" ? null : input.userInstruction?.trim();
    let finalPlan: SubtitleContextPlan;
    if (plan.chunks.length === 1) {
      finalPlan = promptPlan(plan, [
        identifiedChunk(plan.chunks[0], input.rows),
      ]);
    } else {
      const drafts: string[] = [];
      for (const [index, chunk] of plan.chunks.entries()) {
        const draft = await this.collect(
          createAiGenerationRequest({
            kind: input.kind,
            messages: await createMessages(
              promptPlan(plan, [identifiedChunk(chunk, input.rows)]),
              [
                userInstruction,
                languagePack?.chunkStageInstruction(
                  index + 1,
                  plan.chunks.length,
                ) ??
                  `这是第 ${index + 1}/${plan.chunks.length} 个字幕分块；只分析该分块。`,
              ]
                .filter(Boolean)
                .join("\n"),
            ),
            model: input.generation.model,
            reasoningEffort: input.generation.reasoningEffort,
          }),
        );
        drafts.push(draft);
        this.notify({
          artifact,
          artifactId: artifact.artifactId,
          kind: input.kind,
          partialOutput: "",
          progress: {
            completedChunks: index + 1,
            stage: "mapping",
            totalChunks: plan.chunks.length,
          },
          run,
        });
      }
      let reference = `合并为一份完整、连续且不重叠的最终结果。\n${drafts.join("\n\n")}`;
      if (reference.length > budget) reference = reference.slice(0, budget);
      finalPlan = promptPlan(plan, [
        Object.freeze({
          endMs: input.rows.at(-1)?.endMs ?? 0,
          rowIndexes: Object.freeze(input.rows.map((_, index) => index)),
          startMs: input.rows[0]?.startMs ?? 0,
          text: reference,
        }),
      ]);
    }

    const request = createAiGenerationRequest({
      kind: input.kind,
      messages: await createMessages(
        finalPlan,
        [
          userInstruction,
          plan.chunks.length === 1
            ? (languagePack?.startOutputPrompt ?? "请现在开始输出。")
            : (languagePack?.reduceStageInstruction ??
              "将分块草稿合并为一份完整的最终结果。"),
        ]
          .filter(Boolean)
          .join("\n"),
      ),
      model: input.generation.model,
      reasoningEffort: input.generation.reasoningEffort,
    });
    return this.stream(input, artifact, run, request, plan.chunks.length);
  }

  /** Runs a provider request to completion without touching the durable run. */
  private async collect(request: AiGenerationRequest): Promise<string> {
    for await (const event of this.dependencies.provider.stream(request)) {
      if (event.type === "completed") return event.output;
      if (event.type === "failed") {
        throw new AiProviderError(
          event.code,
          "The AI provider could not complete this artifact stage",
          event.retryable,
        );
      }
    }
    throw new AiProviderError(
      "PROVIDER_EARLY_END",
      "The AI provider ended before completing this artifact stage",
      true,
    );
  }

  private async stream(
    input: ArtifactGenerationInput,
    artifact: Artifact,
    run: GenerationRun,
    request: AiGenerationRequest,
    totalChunks: number,
  ): Promise<Artifact | null> {
    const context = eventContext(run);
    const progress: ArtifactProgress = Object.freeze({
      completedChunks: totalChunks,
      stage: "reducing",
      totalChunks,
    });
    let latestRun =
      (await this.dependencies.tasks.applyEvent({
        ...context,
        payload: { status: "requesting" },
        type: "muzhi.generation.status",
      })) ?? run;
    let completedOutput: string | null = null;
    let streamFailureCode: string | null = null;
    try {
      for await (const event of this.dependencies.provider.stream(request)) {
        if (event.type === "reasoning") {
          try {
            input.onReasoning?.(
              Object.freeze({
                artifactId: artifact.artifactId,
                kind: input.kind,
                runId: run.runId,
                text: event.delta,
              }),
            );
          } catch {
            // Transient UI callbacks cannot affect durable artifact execution.
          }
          continue;
        }
        if (event.type === "completed") {
          completedOutput = event.output;
          break;
        }
        const runtimeEvent =
          event.type === "started"
            ? ({
                ...context,
                payload: { status: "streaming" },
                type: "muzhi.generation.status",
              } as const)
            : this.toRuntimeEvent(context, event);
        if (runtimeEvent === null) continue;
        const persisted =
          await this.dependencies.tasks.applyEvent(runtimeEvent);
        if (persisted === null) {
          // run 已被外部终止（如会话删除的 owner-deleted 停止）：
          // 立即退出流式循环，不再消费 provider 响应。
          break;
        }
        latestRun = persisted;
        this.notify({
          artifact,
          artifactId: artifact.artifactId,
          kind: input.kind,
          partialOutput: persisted.partialOutput,
          progress,
          run: persisted,
        });
        if (isTerminal(persisted)) break;
      }
    } catch (error) {
      streamFailureCode =
        error instanceof AiProviderError ? error.code : "INTERNAL_ERROR";
    }
    if (completedOutput === null && !isTerminal(latestRun)) {
      const failed = await this.dependencies.tasks.applyEvent({
        ...context,
        payload: {
          errorCode: streamFailureCode ?? "PROVIDER_EARLY_END",
        },
        type: "muzhi.generation.failed",
      });
      if (failed !== null) latestRun = failed;
    }
    if (completedOutput !== null && !isTerminal(latestRun)) {
      const validating = await this.dependencies.tasks.applyEvent({
        ...context,
        payload: { status: "validating" },
        type: "muzhi.generation.status",
      });
      if (validating !== null) latestRun = validating;

      let segments: Artifact["segments"] = Object.freeze([]);
      try {
        if (input.kind === "segments") {
          if (completedOutput.trim().length === 0) {
            throw Object.assign(new Error("The segments output is empty"), {
              code: "STRUCTURED_OUTPUT_INVALID",
            });
          }
          segments = parseStructuredArtifactSegments(
            completedOutput,
            input.rows,
          );
        } else if (completedOutput.trim().length === 0) {
          throw Object.assign(new Error("The summary output is empty"), {
            code: "STRUCTURED_OUTPUT_INVALID",
          });
        }
      } catch (error) {
        const code =
          typeof error === "object" &&
          error !== null &&
          Reflect.get(error, "code") === "STRUCTURED_OUTPUT_INVALID"
            ? "STRUCTURED_OUTPUT_INVALID"
            : "INTERNAL_ERROR";
        const failed = await this.dependencies.tasks.applyEvent({
          ...context,
          payload: { errorCode: code },
          type: "muzhi.generation.failed",
        });
        if (failed !== null) latestRun = failed;
        const stored = await this.dependencies.repository.fail({
          artifactId: artifact.artifactId,
          errorCode: code,
          expectedRevision: artifact.artifactRevision,
        });
        this.notify({
          artifact: stored,
          artifactId: artifact.artifactId,
          kind: input.kind,
          partialOutput: completedOutput,
          progress,
          run: latestRun,
        });
        return stored;
      }

      const saving = await this.dependencies.tasks.applyEvent({
        ...context,
        payload: { status: "saving" },
        type: "muzhi.generation.status",
      });
      if (saving === null) return null;
      latestRun = saving;
      let stored: Artifact | null;
      try {
        stored = await this.dependencies.repository.complete({
          artifactId: artifact.artifactId,
          content: completedOutput,
          expectedRevision: artifact.artifactRevision,
          segments,
        });
      } catch {
        const failed = await this.dependencies.tasks.applyEvent({
          ...context,
          payload: { errorCode: "PERSISTENCE_FAILED" },
          type: "muzhi.generation.failed",
        });
        if (failed !== null) latestRun = failed;
        const failedArtifact = await this.dependencies.repository.fail({
          artifactId: artifact.artifactId,
          errorCode: "PERSISTENCE_FAILED",
          expectedRevision: artifact.artifactRevision,
        });
        this.notify({
          artifact: failedArtifact,
          artifactId: artifact.artifactId,
          kind: input.kind,
          partialOutput: completedOutput,
          progress,
          run: latestRun,
        });
        return failedArtifact;
      }
      const completed = await this.dependencies.tasks.applyEvent({
        ...context,
        payload: { completionSequence: 0, output: completedOutput },
        type: "muzhi.generation.completed",
      });
      if (completed !== null) latestRun = completed;
      this.notify({
        artifact: stored,
        artifactId: artifact.artifactId,
        kind: input.kind,
        partialOutput: completedOutput,
        progress,
        run: latestRun,
      });
      return stored;
    }
    const stored = await this.dependencies.repository.fail({
      artifactId: artifact.artifactId,
      errorCode:
        latestRun.errorCode ??
        (latestRun.status === "stopped" ? "STOPPED_BY_USER" : "INTERNAL_ERROR"),
      expectedRevision: artifact.artifactRevision,
    });
    this.notify({
      artifact: stored,
      artifactId: artifact.artifactId,
      kind: input.kind,
      partialOutput: latestRun.partialOutput,
      progress,
      run: latestRun,
    });
    return stored;
  }

  private toRuntimeEvent(
    context: GenerationTaskContext,
    event: AiProviderStreamEvent,
  ): GenerationRuntimeEvent | null {
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
        return {
          ...context,
          payload: { errorCode: "IMAGE_OUTPUT_REJECTED" },
          type: "muzhi.generation.failed",
        };
    }
  }
}

export function createArtifactRuntime(
  dependencies: ArtifactRuntimeDependencies,
): ArtifactRuntime {
  return new DefaultArtifactRuntime(dependencies);
}
