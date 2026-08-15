import type {
  AsrTranscriptionProgress,
  GroqChunkTranscriber,
  GroqWhisperModel,
  GroqWhisperProvider,
  SpeechTranscript,
} from "../application/asr-contract";
import type { SubtitleLanguageMode, SubtitleRow } from "../domain";
import type { ChromeOffscreenApi } from "./chrome-asr-runtime";
import { createChromeOffscreenSpeechRuntime } from "./chrome-asr-runtime";
import {
  GroqWhisperError,
  createGroqWhisperProvider,
  type GroqWhisperErrorCode,
  type GroqWhisperProviderDependencies,
} from "./asr/groq-provider";
import { createGroqChunkTranscriber } from "./asr/groq-transcriber";
import { SETTINGS_SECRET_STORAGE_KEY } from "./chrome-settings-store";
import {
  V12_SETTINGS_SECRET_STORAGE_KEY,
  V13_SETTINGS_SECRET_STORAGE_KEY,
} from "./provider-profile-settings";

const CACHE_NAME = "muzhi-asr-groq-transient-v1";
const PROTOCOL_VERSION = 1 as const;
const CREDENTIAL_PROTOCOL_VERSION = 1 as const;
const STATUS_POLL_INTERVAL_MS = 100;
const MAX_CONSECUTIVE_STATUS_FAILURES = 5;
const MAX_START_ATTEMPTS = 3;

type GroqOffscreenCredentialRequest = {
  readonly operationId: string;
  readonly type: "muzhi.internal.offscreen.groq-credential.request";
  readonly version: typeof CREDENTIAL_PROTOCOL_VERSION;
};

type GroqOffscreenCredentialResponse =
  | {
      readonly apiKey: string;
      readonly operationId: string;
      readonly type: "muzhi.internal.offscreen.groq-credential.provided";
      readonly version: typeof CREDENTIAL_PROTOCOL_VERSION;
    }
  | {
      readonly operationId: string;
      readonly reason: "not-configured" | "storage-unavailable";
      readonly type: "muzhi.internal.offscreen.groq-credential.unavailable";
      readonly version: typeof CREDENTIAL_PROTOCOL_VERSION;
    };

type GroqOffscreenCommand =
  | {
      readonly chunkCount: number;
      readonly chunkEndMs: number;
      readonly chunkIndex: number;
      readonly chunkStartMs: number;
      readonly inputCacheUrl: string;
      readonly mimeType: string;
      readonly model: GroqWhisperModel;
      readonly operationId: string;
      readonly requestedLanguageMode: SubtitleLanguageMode;
      readonly type: "muzhi.offscreen.groq.transcribe";
      readonly version: typeof PROTOCOL_VERSION;
    }
  | {
      readonly operationId: string;
      readonly type:
        | "muzhi.offscreen.groq.cancel"
        | "muzhi.offscreen.groq.release"
        | "muzhi.offscreen.groq.status";
      readonly version: typeof PROTOCOL_VERSION;
    };

type GroqOffscreenEvent =
  | {
      readonly operationId: string;
      readonly type: "muzhi.offscreen.groq.accepted";
      readonly version: typeof PROTOCOL_VERSION;
    }
  | {
      readonly operationId: string;
      readonly phase: "uploading" | "waiting-response";
      readonly type: "muzhi.offscreen.groq.running";
      readonly version: typeof PROTOCOL_VERSION;
    }
  | {
      readonly detectedLanguage: string | null;
      readonly operationId: string;
      readonly transcript: SpeechTranscript;
      readonly type: "muzhi.offscreen.groq.completed";
      readonly version: typeof PROTOCOL_VERSION;
    }
  | {
      readonly errorCode: GroqWhisperErrorCode;
      readonly operationId: string;
      readonly retryAfterSeconds: number;
      readonly type: "muzhi.offscreen.groq.failed";
      readonly version: typeof PROTOCOL_VERSION;
    }
  | {
      readonly operationId: string;
      readonly type:
        | "muzhi.offscreen.groq.cancelled"
        | "muzhi.offscreen.groq.released"
        | "muzhi.offscreen.groq.missing";
      readonly version: typeof PROTOCOL_VERSION;
    };

interface ChromeOffscreenGroqClientDependencies {
  readonly cacheStorage?: CacheStorage;
  readonly createOperationId?: () => string;
  readonly now?: () => number;
  readonly statusPollIntervalMs?: number;
}

interface ChromeOffscreenGroqListenerDependencies {
  readonly cacheStorage?: CacheStorage;
  readonly fetch?: GroqWhisperProviderDependencies["fetch"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOperationId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function operationUrl(operationId: string): string {
  return `https://muzhi.invalid/asr-groq/${encodeURIComponent(operationId)}/input`;
}

function runtimeApi(chromeValue: unknown): Record<string, unknown> {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  if (!isRecord(runtime)) throw new Error("Chrome runtime is unavailable");
  return runtime;
}

function isApiKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    value === value.trim()
  );
}

function isCredentialRequest(
  value: unknown,
): value is GroqOffscreenCredentialRequest {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.type === "muzhi.internal.offscreen.groq-credential.request" &&
    value.version === CREDENTIAL_PROTOCOL_VERSION &&
    isOperationId(value.operationId)
  );
}

function readCredentialResponse(
  value: unknown,
  operationId: string,
): GroqOffscreenCredentialResponse | null {
  if (
    !isRecord(value) ||
    value.version !== CREDENTIAL_PROTOCOL_VERSION ||
    value.operationId !== operationId
  ) {
    return null;
  }
  if (
    value.type === "muzhi.internal.offscreen.groq-credential.provided" &&
    Object.keys(value).length === 4 &&
    isApiKey(value.apiKey)
  ) {
    return value as GroqOffscreenCredentialResponse;
  }
  if (
    value.type === "muzhi.internal.offscreen.groq-credential.unavailable" &&
    Object.keys(value).length === 4 &&
    (value.reason === "not-configured" ||
      value.reason === "storage-unavailable")
  ) {
    return value as GroqOffscreenCredentialResponse;
  }
  return null;
}

function isSameExtensionOffscreenSender(
  chromeValue: unknown,
  sender: unknown,
): boolean {
  if (!isRecord(sender)) return false;
  const runtime = runtimeApi(chromeValue);
  const extensionId = Reflect.get(runtime, "id");
  const getUrl = Reflect.get(runtime, "getURL");
  if (typeof extensionId !== "string" || typeof getUrl !== "function") {
    return false;
  }
  const offscreenUrl = Reflect.apply(getUrl, runtime, ["offscreen.html"]);
  return sender.id === extensionId && sender.url === offscreenUrl;
}

function isLanguageMode(value: unknown): value is SubtitleLanguageMode {
  return (
    value === "zh" || value === "en" || value === "other" || value === "mixed"
  );
}

function isModel(value: unknown): value is GroqWhisperModel {
  return value === "whisper-large-v3" || value === "whisper-large-v3-turbo";
}

function isCommand(value: unknown): value is GroqOffscreenCommand {
  if (
    !isRecord(value) ||
    value.version !== PROTOCOL_VERSION ||
    !isOperationId(value.operationId)
  ) {
    return false;
  }
  if (
    value.type === "muzhi.offscreen.groq.cancel" ||
    value.type === "muzhi.offscreen.groq.release" ||
    value.type === "muzhi.offscreen.groq.status"
  ) {
    return true;
  }
  return (
    value.type === "muzhi.offscreen.groq.transcribe" &&
    value.inputCacheUrl === operationUrl(value.operationId) &&
    typeof value.mimeType === "string" &&
    value.mimeType.length > 0 &&
    value.mimeType.length <= 128 &&
    isModel(value.model) &&
    isLanguageMode(value.requestedLanguageMode) &&
    Number.isSafeInteger(value.chunkIndex) &&
    Number(value.chunkIndex) >= 0 &&
    Number.isSafeInteger(value.chunkCount) &&
    Number(value.chunkCount) > Number(value.chunkIndex) &&
    Number.isFinite(value.chunkStartMs) &&
    Number(value.chunkStartMs) >= 0 &&
    Number.isFinite(value.chunkEndMs) &&
    Number(value.chunkEndMs) > Number(value.chunkStartMs)
  );
}

function isErrorCode(value: unknown): value is GroqWhisperErrorCode {
  return (
    value === "AUTHENTICATION_REQUIRED" ||
    value === "PERMISSION_DENIED" ||
    value === "FILE_TOO_LARGE" ||
    value === "RATE_LIMITED" ||
    value === "NETWORK_ERROR" ||
    value === "MALFORMED_RESPONSE"
  );
}

function safeFailureMessage(code: GroqWhisperErrorCode): string {
  switch (code) {
    case "AUTHENTICATION_REQUIRED":
      return "尚未配置 Groq 密钥或密钥无效。";
    case "PERMISSION_DENIED":
      return "当前 Groq 账号无权使用语音模型。";
    case "FILE_TOO_LARGE":
      return "语音分片超过上传限制。";
    case "RATE_LIMITED":
      return "Groq 请求过于频繁，请稍后重试。";
    case "MALFORMED_RESPONSE":
      return "语音服务返回了无效结果。";
    case "NETWORK_ERROR":
      return "Groq 语音服务暂时不可用。";
  }
}

function retryableCode(code: GroqWhisperErrorCode): boolean {
  return code === "NETWORK_ERROR" || code === "RATE_LIMITED";
}

function cloneTranscript(value: unknown): SpeechTranscript | null {
  if (!isRecord(value)) return null;
  if (value.kind === "timed" && Array.isArray(value.rows)) {
    const rows: SubtitleRow[] = [];
    for (const row of value.rows) {
      if (
        !isRecord(row) ||
        typeof row.text !== "string" ||
        !Number.isFinite(row.startMs) ||
        !Number.isFinite(row.endMs) ||
        Number(row.startMs) < 0 ||
        Number(row.endMs) <= Number(row.startMs)
      ) {
        return null;
      }
      rows.push(
        Object.freeze({
          endMs: Number(row.endMs),
          startMs: Number(row.startMs),
          text: row.text,
        }),
      );
    }
    return rows.length === 0
      ? null
      : Object.freeze({ kind: "timed", rows: Object.freeze(rows) });
  }
  if (
    value.kind === "untimed" &&
    Array.isArray(value.paragraphs) &&
    value.paragraphs.every((paragraph) => typeof paragraph === "string")
  ) {
    return Object.freeze({
      kind: "untimed",
      paragraphs: Object.freeze([...value.paragraphs]),
    });
  }
  return null;
}

function readStatus(
  value: unknown,
  operationId: string,
): GroqOffscreenEvent | null {
  if (
    !isRecord(value) ||
    value.version !== PROTOCOL_VERSION ||
    value.operationId !== operationId ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  if (
    value.type === "muzhi.offscreen.groq.missing" ||
    value.type === "muzhi.offscreen.groq.cancelled" ||
    value.type === "muzhi.offscreen.groq.released" ||
    value.type === "muzhi.offscreen.groq.accepted"
  ) {
    return value as unknown as GroqOffscreenEvent;
  }
  if (
    value.type === "muzhi.offscreen.groq.running" &&
    (value.phase === "uploading" || value.phase === "waiting-response")
  ) {
    return value as unknown as GroqOffscreenEvent;
  }
  if (
    value.type === "muzhi.offscreen.groq.failed" &&
    isErrorCode(value.errorCode) &&
    Number.isSafeInteger(value.retryAfterSeconds) &&
    Number(value.retryAfterSeconds) >= 0
  ) {
    return value as unknown as GroqOffscreenEvent;
  }
  if (value.type === "muzhi.offscreen.groq.completed") {
    const transcript = cloneTranscript(value.transcript);
    if (
      transcript === null ||
      !(
        value.detectedLanguage === null ||
        typeof value.detectedLanguage === "string"
      )
    ) {
      return null;
    }
    return Object.freeze({
      detectedLanguage: value.detectedLanguage,
      operationId,
      transcript,
      type: "muzhi.offscreen.groq.completed",
      version: PROTOCOL_VERSION,
    });
  }
  return null;
}

function waitForPoll(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(
      new DOMException("Speech transcription was cancelled", "AbortError"),
    );
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => signal?.removeEventListener("abort", abort);
    const timer = globalThis.setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = (): void => {
      globalThis.clearTimeout(timer);
      cleanup();
      reject(
        new DOMException("Speech transcription was cancelled", "AbortError"),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function createChromeOffscreenGroqWhisperProvider(
  chromeValue: unknown,
  offscreen: ChromeOffscreenApi,
  dependencies: ChromeOffscreenGroqClientDependencies = {},
): GroqWhisperProvider {
  const cacheStorage = dependencies.cacheStorage ?? globalThis.caches;
  const runtime = runtimeApi(chromeValue);
  const sendMessage = Reflect.get(runtime, "sendMessage");
  if (typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }
  const documentRuntime = createChromeOffscreenSpeechRuntime(offscreen);
  const createOperationId =
    dependencies.createOperationId ?? (() => globalThis.crypto.randomUUID());
  const statusPollIntervalMs =
    dependencies.statusPollIntervalMs ?? STATUS_POLL_INTERVAL_MS;
  if (
    !Number.isSafeInteger(statusPollIntervalMs) ||
    statusPollIntervalMs <= 0
  ) {
    throw new Error("The Groq status poll interval is invalid");
  }

  return Object.freeze({
    async transcribe(input: Parameters<GroqWhisperProvider["transcribe"]>[0]) {
      if (input.signal?.aborted) {
        throw new DOMException(
          "Speech transcription was cancelled",
          "AbortError",
        );
      }
      const baseOperationId = input.operationId ?? createOperationId();
      const operationId = `${baseOperationId}:model-${input.model}`;
      if (!isOperationId(operationId)) {
        throw new GroqWhisperError(
          "NETWORK_ERROR",
          "Groq 转写任务标识无效。",
          true,
        );
      }
      const cache = await cacheStorage.open(CACHE_NAME);
      const inputCacheUrl = operationUrl(operationId);
      const send = async (command: GroqOffscreenCommand): Promise<unknown> =>
        await Reflect.apply(sendMessage, runtime, [command]);
      const command: Extract<
        GroqOffscreenCommand,
        { type: "muzhi.offscreen.groq.transcribe" }
      > = Object.freeze({
        chunkCount: input.chunkCount,
        chunkEndMs: input.chunk.endMs,
        chunkIndex: input.chunk.index,
        chunkStartMs: input.chunk.startMs,
        inputCacheUrl,
        mimeType: input.chunk.mimeType,
        model: input.model,
        operationId,
        requestedLanguageMode: input.requestedLanguageMode,
        type: "muzhi.offscreen.groq.transcribe",
        version: PROTOCOL_VERSION,
      });
      const abort = (): void => {
        void send({
          operationId,
          type: "muzhi.offscreen.groq.cancel",
          version: PROTOCOL_VERSION,
        }).catch(() => undefined);
      };
      input.signal?.addEventListener("abort", abort, { once: true });
      let lastPhase: AsrTranscriptionProgress["phase"] | null = null;
      try {
        await cache.put(
          inputCacheUrl,
          new Response(new Uint8Array(input.chunk.bytes), {
            headers: { "content-type": input.chunk.mimeType },
          }),
        );
        await documentRuntime.ensureDocument();
        const start = async (): Promise<void> => {
          try {
            await send(command);
          } catch {
            // Acknowledgement loss is reconciled by the stable operation ID
            // and status polling below.
          }
        };
        await start();
        let startAttempts = 1;
        let consecutiveStatusFailures = 0;
        for (;;) {
          if (input.signal?.aborted) {
            throw new DOMException(
              "Speech transcription was cancelled",
              "AbortError",
            );
          }
          let raw: unknown;
          try {
            raw = await send({
              operationId,
              type: "muzhi.offscreen.groq.status",
              version: PROTOCOL_VERSION,
            });
            consecutiveStatusFailures = 0;
          } catch {
            consecutiveStatusFailures += 1;
            if (consecutiveStatusFailures >= MAX_CONSECUTIVE_STATUS_FAILURES) {
              throw new GroqWhisperError(
                "NETWORK_ERROR",
                "Groq 后台转写状态暂时不可用。",
                true,
              );
            }
            await waitForPoll(statusPollIntervalMs, input.signal);
            continue;
          }
          const status = readStatus(raw, operationId);
          if (status === null) {
            throw new GroqWhisperError(
              "MALFORMED_RESPONSE",
              "Groq 后台返回了无效的转写状态。",
              false,
            );
          }
          if (status.type === "muzhi.offscreen.groq.missing") {
            startAttempts += 1;
            if (startAttempts > MAX_START_ATTEMPTS) {
              throw new GroqWhisperError(
                "NETWORK_ERROR",
                "Groq 后台未能恢复转写任务。",
                true,
              );
            }
            await start();
          } else if (status.type === "muzhi.offscreen.groq.running") {
            if (status.phase !== lastPhase) {
              lastPhase = status.phase;
              await input.onActivity?.(
                Object.freeze({
                  currentChunk: input.chunk.index + 1,
                  phase: status.phase,
                  totalChunks: input.chunkCount,
                }),
              );
            }
          } else if (status.type === "muzhi.offscreen.groq.completed") {
            return Object.freeze({
              detectedLanguage: status.detectedLanguage,
              transcript: status.transcript,
            });
          } else if (status.type === "muzhi.offscreen.groq.failed") {
            throw new GroqWhisperError(
              status.errorCode,
              safeFailureMessage(status.errorCode),
              retryableCode(status.errorCode),
              status.retryAfterSeconds,
            );
          } else if (status.type === "muzhi.offscreen.groq.cancelled") {
            throw new DOMException(
              "Speech transcription was cancelled",
              "AbortError",
            );
          }
          await waitForPoll(statusPollIntervalMs, input.signal);
        }
      } finally {
        input.signal?.removeEventListener("abort", abort);
        try {
          await send({
            operationId,
            type: input.signal?.aborted
              ? "muzhi.offscreen.groq.cancel"
              : "muzhi.offscreen.groq.release",
            version: PROTOCOL_VERSION,
          });
        } catch {
          // The cache deletion below remains authoritative for audio bytes.
        }
        await cache.delete(inputCacheUrl);
      }
    },
  });
}

export function createChromeOffscreenGroqChunkTranscriber(
  chromeValue: unknown,
  offscreen: ChromeOffscreenApi,
  dependencies: ChromeOffscreenGroqClientDependencies = {},
): GroqChunkTranscriber {
  return createGroqChunkTranscriber({
    now: dependencies.now ?? (() => Date.now()),
    provider: createChromeOffscreenGroqWhisperProvider(
      chromeValue,
      offscreen,
      dependencies,
    ),
  });
}

export function installChromeOffscreenGroqTranscriptionListener(
  chromeValue: unknown,
  dependencies: ChromeOffscreenGroqListenerDependencies = {},
): void {
  const cacheStorage = dependencies.cacheStorage ?? globalThis.caches;
  const runtime = runtimeApi(chromeValue);
  const onMessage = Reflect.get(runtime, "onMessage");
  const addListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "addListener")
    : null;
  if (typeof addListener !== "function") {
    throw new Error("Chrome runtime message listener is unavailable");
  }
  const sendMessage = Reflect.get(runtime, "sendMessage");
  if (typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }
  const fetch =
    dependencies.fetch ?? ((url, init) => globalThis.fetch(url, init));
  type GroqJob = {
    readonly controller: AbortController;
    readonly inputCacheUrl: string;
    event: GroqOffscreenEvent;
  };
  const jobs = new Map<string, GroqJob>();
  const deleteInput = async (inputCacheUrl: string): Promise<void> => {
    try {
      const cache = await cacheStorage.open(CACHE_NAME);
      await cache.delete(inputCacheUrl);
    } catch {
      // The input is transient and is also deleted by the Service Worker side.
    }
  };

  Reflect.apply(addListener, onMessage, [
    (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: GroqOffscreenEvent) => void,
    ): boolean => {
      if (!isCommand(message)) return false;
      if (message.type === "muzhi.offscreen.groq.cancel") {
        const job = jobs.get(message.operationId);
        job?.controller.abort();
        jobs.delete(message.operationId);
        if (job) void deleteInput(job.inputCacheUrl);
        sendResponse({
          operationId: message.operationId,
          type: "muzhi.offscreen.groq.cancelled",
          version: PROTOCOL_VERSION,
        });
        return false;
      }
      if (message.type === "muzhi.offscreen.groq.release") {
        const job = jobs.get(message.operationId);
        if (job?.event.type === "muzhi.offscreen.groq.running") {
          job.controller.abort();
        }
        jobs.delete(message.operationId);
        if (job) void deleteInput(job.inputCacheUrl);
        sendResponse({
          operationId: message.operationId,
          type: "muzhi.offscreen.groq.released",
          version: PROTOCOL_VERSION,
        });
        return false;
      }
      if (message.type === "muzhi.offscreen.groq.status") {
        sendResponse(
          jobs.get(message.operationId)?.event ?? {
            operationId: message.operationId,
            type: "muzhi.offscreen.groq.missing",
            version: PROTOCOL_VERSION,
          },
        );
        return false;
      }
      if (message.type !== "muzhi.offscreen.groq.transcribe") return false;

      const existing = jobs.get(message.operationId);
      if (existing === undefined) {
        const controller = new AbortController();
        const job: GroqJob = {
          controller,
          event: {
            operationId: message.operationId,
            phase: "uploading",
            type: "muzhi.offscreen.groq.running",
            version: PROTOCOL_VERSION,
          },
          inputCacheUrl: message.inputCacheUrl,
        };
        jobs.set(message.operationId, job);
        void (async () => {
          try {
            const cache = await cacheStorage.open(CACHE_NAME);
            const input = await cache.match(message.inputCacheUrl);
            if (!input) {
              throw new GroqWhisperError(
                "NETWORK_ERROR",
                "Groq 转写音频分片不可用。",
                true,
              );
            }
            const bytes = new Uint8Array(await input.arrayBuffer());
            await cache.delete(message.inputCacheUrl);
            let rawCredential: unknown;
            try {
              rawCredential = await Reflect.apply(sendMessage, runtime, [
                Object.freeze({
                  operationId: message.operationId,
                  type: "muzhi.internal.offscreen.groq-credential.request",
                  version: CREDENTIAL_PROTOCOL_VERSION,
                } satisfies GroqOffscreenCredentialRequest),
              ]);
            } catch {
              throw new GroqWhisperError(
                "NETWORK_ERROR",
                "Groq 凭据暂时不可用。",
                true,
              );
            }
            const credential = readCredentialResponse(
              rawCredential,
              message.operationId,
            );
            if (credential === null) {
              throw new GroqWhisperError(
                "MALFORMED_RESPONSE",
                "Groq 凭据通道返回了无效响应。",
                false,
              );
            }
            if (
              credential.type ===
              "muzhi.internal.offscreen.groq-credential.unavailable"
            ) {
              throw new GroqWhisperError(
                credential.reason === "not-configured"
                  ? "AUTHENTICATION_REQUIRED"
                  : "NETWORK_ERROR",
                credential.reason === "not-configured"
                  ? "尚未配置 Groq 密钥。"
                  : "Groq 凭据暂时不可用。",
                credential.reason === "storage-unavailable",
              );
            }
            const provider = createGroqWhisperProvider({
              apiKey: credential.apiKey,
              fetch,
            });
            const result = await provider.transcribe({
              chunk: Object.freeze({
                bytes,
                endMs: message.chunkEndMs,
                index: message.chunkIndex,
                mimeType: message.mimeType,
                startMs: message.chunkStartMs,
              }),
              chunkCount: message.chunkCount,
              model: message.model,
              onActivity: async (activity) => {
                if (
                  jobs.get(message.operationId) === job &&
                  (activity.phase === "uploading" ||
                    activity.phase === "waiting-response")
                ) {
                  job.event = {
                    operationId: message.operationId,
                    phase: activity.phase,
                    type: "muzhi.offscreen.groq.running",
                    version: PROTOCOL_VERSION,
                  };
                }
              },
              operationId: message.operationId,
              requestedLanguageMode: message.requestedLanguageMode,
              signal: controller.signal,
              title: "",
            });
            if (jobs.get(message.operationId) === job) {
              job.event = {
                detectedLanguage: result.detectedLanguage,
                operationId: message.operationId,
                transcript: result.transcript,
                type: "muzhi.offscreen.groq.completed",
                version: PROTOCOL_VERSION,
              };
            }
          } catch (error) {
            if (jobs.get(message.operationId) !== job) return;
            if (error instanceof DOMException && error.name === "AbortError") {
              job.event = {
                operationId: message.operationId,
                type: "muzhi.offscreen.groq.cancelled",
                version: PROTOCOL_VERSION,
              };
              return;
            }
            const failure =
              error instanceof GroqWhisperError
                ? error
                : new GroqWhisperError(
                    "NETWORK_ERROR",
                    "Groq 语音服务暂时不可用。",
                    true,
                  );
            job.event = {
              errorCode: failure.code,
              operationId: message.operationId,
              retryAfterSeconds: Math.max(0, failure.retryAfterSeconds),
              type: "muzhi.offscreen.groq.failed",
              version: PROTOCOL_VERSION,
            };
          }
        })();
      }
      sendResponse({
        operationId: message.operationId,
        type: "muzhi.offscreen.groq.accepted",
        version: PROTOCOL_VERSION,
      });
      return false;
    },
  ]);
}

/**
 * Groq 密钥存储解析:v13 是当前保存路径(saveV12GroqApiKey 的 persist 写入
 * V13_SETTINGS_SECRET_STORAGE_KEY)。此前 broker 只读 v12/legacy,导致
 * 新保存的 key 在首次语音转录时读不到(not-configured → AUTHENTICATION_REQUIRED)。
 * 解析顺序:v13 → v12 → legacy(v2)。
 */
function isGroqKeyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    value === value.trim()
  );
}

export async function resolveGroqApiKeyFromStorage(
  storage: { get(key: string): Promise<Record<string, unknown>> },
  options: { loadLegacy: () => Promise<unknown> },
): Promise<string | null> {
  const v13Secret = (await storage.get(V13_SETTINGS_SECRET_STORAGE_KEY))[
    V13_SETTINGS_SECRET_STORAGE_KEY
  ];
  if (isRecord(v13Secret) && v13Secret.version === 13) {
    if (isGroqKeyString(v13Secret.groqApiKey)) return v13Secret.groqApiKey;
    // v13 存在但没有 key:继续尝试 v12/legacy(可能只迁移了部分)。
  }
  const v12Secret = (await storage.get(V12_SETTINGS_SECRET_STORAGE_KEY))[
    V12_SETTINGS_SECRET_STORAGE_KEY
  ];
  if (isRecord(v12Secret) && v12Secret.version === 12) {
    return isGroqKeyString(v12Secret.groqApiKey) ? v12Secret.groqApiKey : null;
  }
  await options.loadLegacy();
  const legacySecret = (await storage.get(SETTINGS_SECRET_STORAGE_KEY))[
    SETTINGS_SECRET_STORAGE_KEY
  ];
  return isRecord(legacySecret) &&
    legacySecret.version === 2 &&
    isGroqKeyString(legacySecret.groqApiKey)
    ? legacySecret.groqApiKey
    : null;
}

export function installChromeGroqOffscreenCredentialBroker(
  chromeValue: unknown,
  loadApiKey: () => Promise<string | null>,
): void {
  const runtime = runtimeApi(chromeValue);
  const onMessage = Reflect.get(runtime, "onMessage");
  const addListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "addListener")
    : null;
  if (typeof addListener !== "function") {
    throw new Error("Chrome runtime message listener is unavailable");
  }

  Reflect.apply(addListener, onMessage, [
    (
      message: unknown,
      sender: unknown,
      sendResponse: (response: GroqOffscreenCredentialResponse) => void,
    ): boolean => {
      if (
        !isCredentialRequest(message) ||
        !isSameExtensionOffscreenSender(chromeValue, sender)
      ) {
        return false;
      }
      void (async () => {
        let loadedApiKey: string | null;
        try {
          loadedApiKey = await loadApiKey();
        } catch {
          sendResponse({
            operationId: message.operationId,
            reason: "storage-unavailable",
            type: "muzhi.internal.offscreen.groq-credential.unavailable",
            version: CREDENTIAL_PROTOCOL_VERSION,
          });
          return;
        }
        if (!isApiKey(loadedApiKey)) {
          sendResponse({
            operationId: message.operationId,
            reason: "not-configured",
            type: "muzhi.internal.offscreen.groq-credential.unavailable",
            version: CREDENTIAL_PROTOCOL_VERSION,
          });
          return;
        }
        sendResponse({
          apiKey: loadedApiKey,
          operationId: message.operationId,
          type: "muzhi.internal.offscreen.groq-credential.provided",
          version: CREDENTIAL_PROTOCOL_VERSION,
        });
      })();
      return true;
    },
  ]);
}

export const installChromeOffscreenGroqTranscriberListener =
  installChromeOffscreenGroqTranscriptionListener;

export {
  CACHE_NAME as ASR_GROQ_TRANSIENT_CACHE_NAME,
  PROTOCOL_VERSION as OFFSCREEN_GROQ_PROTOCOL_VERSION,
};
