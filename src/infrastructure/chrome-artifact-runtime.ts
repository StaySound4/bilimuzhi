import {
  createAiGenerationRequest,
  type AiModelDescriptor,
} from "../application/ai/provider-contract";
import {
  AI_PROVIDER_ERROR_CODES,
  AiProviderError,
  type AiProviderErrorCode,
} from "../application/ai/provider-error";
import type { ArtifactScope } from "../application/artifact-repository";
import type {
  ArtifactGenerationOptions,
  ArtifactReasoningUpdate,
  ArtifactRuntime,
  ArtifactUpdate,
} from "../application/artifact-runtime";
import {
  createArtifact,
  createGenerationRun,
  isArtifactKind,
  type Artifact,
  type ArtifactKind,
  type GenerationRun,
} from "../domain";

export const ARTIFACT_RUNTIME_PROTOCOL_VERSION = 1 as const;

type ArtifactCommandType =
  | "muzhi.artifact.list"
  | "muzhi.artifact.generate"
  | "muzhi.artifact.clear"
  | "muzhi.artifact.stop"
  | "muzhi.artifact.queryRuns";

interface ArtifactCommand {
  readonly payload: Record<string, unknown>;
  readonly protocolVersion: typeof ARTIFACT_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: ArtifactCommandType;
}

interface ArtifactResponse {
  readonly payload:
    | { readonly data: unknown; readonly ok: true }
    | { readonly errorCode: AiProviderErrorCode; readonly ok: false };
  readonly protocolVersion: typeof ARTIFACT_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly type: "muzhi.artifact.response";
}

export type ChromeArtifactRuntimeEvent =
  | {
      readonly payload: ArtifactUpdate;
      readonly protocolVersion: typeof ARTIFACT_RUNTIME_PROTOCOL_VERSION;
      readonly type: "muzhi.artifact.updated";
    }
  | {
      readonly payload: ArtifactReasoningUpdate;
      readonly protocolVersion: typeof ARTIFACT_RUNTIME_PROTOCOL_VERSION;
      readonly type: "muzhi.artifact.reasoning";
    };

export interface ChromeArtifactGenerationResult {
  readonly artifact: Artifact;
  readonly run: GenerationRun;
}

export interface ChromeArtifactRuntimeClient {
  list(scope: ArtifactScope): Promise<readonly Artifact[]>;
  /** 查询当前 scope 下进行中的分段/总结 run（切回会话时恢复运行状态）。 */
  queryActiveRuns(scope: ArtifactScope): Promise<readonly GenerationRun[]>;
  generate(input: {
    readonly generation: ArtifactGenerationOptions;
    readonly kind: ArtifactKind;
    readonly scope: ArtifactScope;
    readonly userInstruction: string | null;
    readonly userPrompt: string | null;
  }): Promise<ChromeArtifactGenerationResult>;
  clear(input: { readonly artifactId: string }): Promise<Artifact | null>;
  stop(run: GenerationRun): Promise<Artifact | null>;
  subscribe(listener: (event: ChromeArtifactRuntimeEvent) => void): () => void;
}

export interface ChromeArtifactRuntimeListenerDependencies {
  readonly getRuntime: (
    onUpdate: (update: ArtifactUpdate) => void,
  ) => Promise<ArtifactRuntime>;
  readonly readSubtitleContext: (scope: ArtifactScope) => Promise<{
    readonly rows: readonly {
      readonly startMs: number;
      readonly endMs: number;
      readonly text: string;
    }[];
    readonly title: string;
    readonly videoKey?: string;
  } | null>;
  /** 查询指定 scope 下进行中的 run（切回会话时恢复运行状态）。 */
  readonly queryActiveRuns: (
    scope: ArtifactScope,
  ) => Promise<readonly GenerationRun[]>;
}

type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

interface ChromeRuntimeApi {
  readonly onMessage: {
    addListener(listener: MessageListener): void;
    removeListener?(listener: MessageListener): void;
  };
  sendMessage(message: unknown): Promise<unknown>;
}

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

function readRuntime(chromeValue: unknown): ChromeRuntimeApi {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  const onMessage = isRecord(runtime)
    ? (Reflect.get(runtime, "onMessage") as unknown)
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
    throw new Error("Chrome artifact runtime is unavailable");
  }
  return Object.freeze({
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
  });
}

function readScope(value: unknown): ArtifactScope | null {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "sessionId",
      "branchId",
      "subtitleId",
      "contextRevision",
    ]) ||
    !safeId(value.sessionId) ||
    !safeId(value.branchId) ||
    !safeId(value.subtitleId) ||
    !Number.isSafeInteger(value.contextRevision) ||
    Number(value.contextRevision) <= 0
  ) {
    return null;
  }
  return Object.freeze({
    branchId: value.branchId,
    contextRevision: value.contextRevision as number,
    sessionId: value.sessionId,
    subtitleId: value.subtitleId,
  });
}

function readGeneration(
  value: unknown,
  kind: ArtifactKind,
): ArtifactGenerationOptions | null {
  if (!isRecord(value) || !exactKeys(value, ["model", "reasoningEffort"])) {
    return null;
  }
  try {
    const validated = createAiGenerationRequest({
      kind,
      messages: [{ content: "validation", role: "user" }],
      model: value.model as AiModelDescriptor,
      reasoningEffort:
        value.reasoningEffort as ArtifactGenerationOptions["reasoningEffort"],
    });
    return Object.freeze({
      model: validated.model,
      reasoningEffort: validated.reasoningEffort,
    });
  } catch {
    return null;
  }
}

function isArtifactCommand(value: unknown): value is ArtifactCommand {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["protocolVersion", "requestId", "type", "payload"]) ||
    value.protocolVersion !== ARTIFACT_RUNTIME_PROTOCOL_VERSION ||
    !safeId(value.requestId) ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  if (value.type === "muzhi.artifact.list") {
    return (
      exactKeys(value.payload, ["scope"]) &&
      readScope(value.payload.scope) !== null
    );
  }
  if (value.type === "muzhi.artifact.clear") {
    return (
      exactKeys(value.payload, ["artifactId"]) &&
      safeId(value.payload.artifactId)
    );
  }
  if (value.type === "muzhi.artifact.stop") {
    try {
      const run = createGenerationRun(value.payload.run as GenerationRun);
      return (
        exactKeys(value.payload, ["run"]) &&
        (run.kind === "segments" || run.kind === "summary")
      );
    } catch {
      return false;
    }
  }
  if (value.type === "muzhi.artifact.queryRuns") {
    return (
      exactKeys(value.payload, ["scope"]) &&
      readScope(value.payload.scope) !== null
    );
  }
  if (value.type !== "muzhi.artifact.generate") return false;
  return (
    exactKeys(value.payload, [
      "generation",
      "kind",
      "scope",
      "userInstruction",
      "userPrompt",
    ]) &&
    isArtifactKind(value.payload.kind) &&
    readScope(value.payload.scope) !== null &&
    readGeneration(value.payload.generation, value.payload.kind) !== null &&
    (value.payload.userInstruction === null ||
      (typeof value.payload.userInstruction === "string" &&
        value.payload.userInstruction.length <= 4_000)) &&
    (value.payload.userPrompt === null ||
      (typeof value.payload.userPrompt === "string" &&
        value.payload.userPrompt.length <= 20_000))
  );
}

function success(requestId: string, data: unknown): ArtifactResponse {
  return Object.freeze({
    payload: Object.freeze({ data, ok: true as const }),
    protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
    requestId,
    type: "muzhi.artifact.response" as const,
  });
}

function failure(requestId: string, error: unknown): ArtifactResponse {
  return Object.freeze({
    payload: Object.freeze({
      errorCode:
        error instanceof AiProviderError ? error.code : "INTERNAL_ERROR",
      ok: false as const,
    }),
    protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
    requestId,
    type: "muzhi.artifact.response" as const,
  });
}

export function installChromeArtifactRuntimeListener(
  chromeValue: unknown,
  dependencies: ChromeArtifactRuntimeListenerDependencies,
): void {
  const runtimeApi = readRuntime(chromeValue);
  const handles = new Map<
    string,
    Awaited<ReturnType<ArtifactRuntime["generate"]>>
  >();
  const onUpdate = (update: ArtifactUpdate): void => {
    void runtimeApi
      .sendMessage({
        payload: update,
        protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
        type: "muzhi.artifact.updated",
      })
      .catch(() => undefined);
  };
  const onReasoning = (update: ArtifactReasoningUpdate): void => {
    void runtimeApi
      .sendMessage({
        payload: update,
        protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
        type: "muzhi.artifact.reasoning",
      })
      .catch(() => undefined);
  };

  const execute = async (command: ArtifactCommand): Promise<unknown> => {
    const runtime = await dependencies.getRuntime(onUpdate);
    if (command.type === "muzhi.artifact.list") {
      return runtime.list(readScope(command.payload.scope)!);
    }
    if (command.type === "muzhi.artifact.clear") {
      return runtime.clear({
        artifactId: command.payload.artifactId as string,
      });
    }
    if (command.type === "muzhi.artifact.stop") {
      const run = createGenerationRun(command.payload.run as GenerationRun);
      const handle = handles.get(run.taskId);
      return handle === undefined ? runtime.stop(run) : handle.stop();
    }
    if (command.type === "muzhi.artifact.queryRuns") {
      return dependencies.queryActiveRuns(readScope(command.payload.scope)!);
    }
    const scope = readScope(command.payload.scope)!;
    const kind = command.payload.kind as ArtifactKind;
    const context = await dependencies.readSubtitleContext(scope);
    if (context === null || context.rows.length === 0) {
      throw new AiProviderError(
        "UNSUPPORTED_CAPABILITY",
        "The subtitle context is unavailable",
        false,
      );
    }
    const videoBvid =
      typeof context.videoKey === "string"
        ? /^bvid:(BV[0-9A-Za-z]{10}):/.exec(context.videoKey)?.[1]
        : undefined;
    const handle = await runtime.generate({
      generation: readGeneration(command.payload.generation, kind)!,
      kind,
      onReasoning,
      rows: context.rows,
      scope,
      userInstruction: command.payload.userInstruction as string | null,
      userPrompt: command.payload.userPrompt as string | null,
      ...(videoBvid === undefined ? {} : { videoBvid }),
      videoTitle: context.title,
    });
    handles.set(handle.run.taskId, handle);
    void handle.completion
      .catch(() => undefined)
      .finally(() => handles.delete(handle.run.taskId));
    return Object.freeze({ artifact: handle.artifact, run: handle.run });
  };

  runtimeApi.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isArtifactCommand(message)) return false;
    const command = message;
    void execute(command).then(
      (data) => sendResponse(success(command.requestId, data)),
      (error: unknown) => sendResponse(failure(command.requestId, error)),
    );
    return true;
  });
}

function isResponse(
  value: unknown,
  requestId: string,
): value is ArtifactResponse {
  return (
    isRecord(value) &&
    exactKeys(value, ["protocolVersion", "requestId", "type", "payload"]) &&
    value.protocolVersion === ARTIFACT_RUNTIME_PROTOCOL_VERSION &&
    value.requestId === requestId &&
    value.type === "muzhi.artifact.response" &&
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

function isArtifactUpdatedEvent(
  value: unknown,
): value is Extract<
  ChromeArtifactRuntimeEvent,
  { readonly type: "muzhi.artifact.updated" }
> {
  if (
    !isRecord(value) ||
    value.protocolVersion !== ARTIFACT_RUNTIME_PROTOCOL_VERSION ||
    value.type !== "muzhi.artifact.updated" ||
    !isRecord(value.payload)
  ) {
    return false;
  }
  try {
    createGenerationRun(value.payload.run as GenerationRun);
    if (value.payload.artifact !== null) {
      createArtifact(value.payload.artifact as Artifact);
    }
    return (
      safeId(value.payload.artifactId) &&
      isArtifactKind(value.payload.kind) &&
      typeof value.payload.partialOutput === "string" &&
      isRecord(value.payload.progress)
    );
  } catch {
    return false;
  }
}

function isArtifactReasoningEvent(
  value: unknown,
): value is Extract<
  ChromeArtifactRuntimeEvent,
  { readonly type: "muzhi.artifact.reasoning" }
> {
  return (
    isRecord(value) &&
    exactKeys(value, ["protocolVersion", "type", "payload"]) &&
    value.protocolVersion === ARTIFACT_RUNTIME_PROTOCOL_VERSION &&
    value.type === "muzhi.artifact.reasoning" &&
    isRecord(value.payload) &&
    exactKeys(value.payload, ["artifactId", "kind", "runId", "text"]) &&
    safeId(value.payload.artifactId) &&
    isArtifactKind(value.payload.kind) &&
    safeId(value.payload.runId) &&
    typeof value.payload.text === "string" &&
    value.payload.text.length <= 2_000_000
  );
}

export function createChromeArtifactRuntimeClient(
  chromeValue: unknown,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
): ChromeArtifactRuntimeClient {
  const runtimeApi = readRuntime(chromeValue);
  const currentReasoningOwnerByKind = new Map<
    ArtifactKind,
    {
      readonly artifactId: string;
      readonly expectedOwnerRevision: number;
      readonly runId: string;
    }
  >();
  const rememberReasoningOwner = (
    artifact: Artifact,
    run: GenerationRun,
    force: boolean,
  ): boolean => {
    if (run.kind !== artifact.kind || run.targetId !== artifact.artifactId) {
      return false;
    }
    const current = currentReasoningOwnerByKind.get(artifact.kind);
    if (
      !force &&
      current !== undefined &&
      current.runId !== run.runId &&
      run.expectedOwnerRevision <= current.expectedOwnerRevision
    ) {
      return false;
    }
    currentReasoningOwnerByKind.set(
      artifact.kind,
      Object.freeze({
        artifactId: artifact.artifactId,
        expectedOwnerRevision: run.expectedOwnerRevision,
        runId: run.runId,
      }),
    );
    return true;
  };
  const send = async (
    type: ArtifactCommandType,
    payload: Record<string, unknown>,
  ): Promise<unknown> => {
    const requestId = createRequestId();
    let response: unknown;
    try {
      response = await runtimeApi.sendMessage({
        payload,
        protocolVersion: ARTIFACT_RUNTIME_PROTOCOL_VERSION,
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
    if (!isResponse(response, requestId)) {
      throw new Error("Bilimuzhi分段/总结后台响应无效，请重试。");
    }
    if (!response.payload.ok) {
      throw new AiProviderError(
        response.payload.errorCode,
        "Bilimuzhi分段/总结请求失败。",
        response.payload.errorCode === "RATE_LIMITED" ||
          response.payload.errorCode === "TIMEOUT" ||
          response.payload.errorCode === "NETWORK_ERROR" ||
          response.payload.errorCode === "INTERNAL_ERROR",
      );
    }
    return response.payload.data;
  };
  const client: ChromeArtifactRuntimeClient = {
    async list(scope) {
      const data = await send("muzhi.artifact.list", { scope });
      if (!Array.isArray(data)) throw new Error("Bilimuzhi分段/总结响应无效");
      return Object.freeze(
        data.map((value) => createArtifact(value as Artifact)),
      );
    },
    async queryActiveRuns(scope) {
      const data = await send("muzhi.artifact.queryRuns", { scope });
      if (!Array.isArray(data)) throw new Error("Bilimuzhi分段/总结响应无效");
      return Object.freeze(
        data.map((value) => createGenerationRun(value as GenerationRun)),
      );
    },
    async generate(input) {
      const data = await send("muzhi.artifact.generate", {
        generation: input.generation,
        kind: input.kind,
        scope: input.scope,
        userInstruction: input.userInstruction,
        userPrompt: input.userPrompt,
      });
      if (!isRecord(data)) throw new Error("Bilimuzhi分段/总结响应无效");
      const artifact = createArtifact(data.artifact as Artifact);
      const run = createGenerationRun(data.run as GenerationRun);
      if (!rememberReasoningOwner(artifact, run, true)) {
        throw new Error("Bilimuzhi分段/总结响应所有者无效");
      }
      return Object.freeze({ artifact, run });
    },
    async clear(input) {
      const data = await send("muzhi.artifact.clear", {
        artifactId: input.artifactId,
      });
      for (const [kind, owner] of currentReasoningOwnerByKind) {
        if (owner.artifactId === input.artifactId) {
          currentReasoningOwnerByKind.delete(kind);
        }
      }
      return data === null ? null : createArtifact(data as Artifact);
    },
    async stop(run) {
      const data = await send("muzhi.artifact.stop", { run });
      return data === null ? null : createArtifact(data as Artifact);
    },
    subscribe(listener) {
      const runtimeListener: MessageListener = (message) => {
        if (isArtifactUpdatedEvent(message)) {
          const { artifact, artifactId, kind, run } = message.payload;
          if (
            artifact !== null &&
            artifact.artifactId === artifactId &&
            artifact.kind === kind
          ) {
            rememberReasoningOwner(artifact, run, false);
          }
          listener(message);
          return false;
        }
        if (isArtifactReasoningEvent(message)) {
          const owner = currentReasoningOwnerByKind.get(message.payload.kind);
          if (
            owner?.artifactId === message.payload.artifactId &&
            owner.runId === message.payload.runId
          ) {
            listener(message);
          }
        }
        return false;
      };
      runtimeApi.onMessage.addListener(runtimeListener);
      return () => runtimeApi.onMessage.removeListener?.(runtimeListener);
    },
  };
  return Object.freeze(client);
}
