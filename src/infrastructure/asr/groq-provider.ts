import {
  GROQ_REQUEST_TIMEOUT_MS,
  type AsrTranscriptionProgress,
  type GroqWhisperProvider,
  type GroqWhisperModel,
  type PreparedAudioChunk,
  type SpeechTranscript,
} from "../../application/asr-contract";
import { SPEECH_PROMPT_POLICY } from "../../application/speech-prompt-policy";
import type { SubtitleLanguageMode, SubtitleRow } from "../../domain";
import { parseRetryAfterSeconds } from "./groq-routing";

export type GroqWhisperErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "FILE_TOO_LARGE"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "MALFORMED_RESPONSE";

export class GroqWhisperError extends Error {
  constructor(
    readonly code: GroqWhisperErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds = 0,
  ) {
    super(message);
    this.name = "GroqWhisperError";
  }
}

interface GroqFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

export interface GroqWhisperProviderDependencies {
  readonly apiKey: string;
  readonly fetch: (
    url: string,
    init: {
      readonly body: FormData;
      readonly headers: Readonly<Record<string, string>>;
      readonly method: "POST";
      readonly signal: AbortSignal;
    },
  ) => Promise<GroqFetchResponse>;
  readonly timeoutMs?: number;
}

function speechPrompt(mode: SubtitleLanguageMode): string {
  return SPEECH_PROMPT_POLICY[mode].prompt;
}

function speechLanguageHint(mode: SubtitleLanguageMode): string | null {
  return SPEECH_PROMPT_POLICY[mode].languageParam;
}

function safeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Request aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener("abort", abort);
    const abort = (): void => {
      cleanup();
      reject(new DOMException("Request aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function parseRows(value: unknown): {
  readonly detectedLanguage: string | null;
  readonly transcript: SpeechTranscript;
} {
  if (!safeRecord(value))
    throw new GroqWhisperError(
      "MALFORMED_RESPONSE",
      "语音服务返回了无效结果。",
      false,
    );
  if (
    ("duration" in value &&
      (typeof value.duration !== "number" ||
        !Number.isFinite(value.duration) ||
        value.duration < 0)) ||
    ("language" in value && typeof value.language !== "string") ||
    ("segments" in value && !Array.isArray(value.segments)) ||
    ("text" in value && typeof value.text !== "string")
  ) {
    throw new GroqWhisperError(
      "MALFORMED_RESPONSE",
      "语音服务返回了无效结果。",
      false,
    );
  }
  const segments = Array.isArray(value.segments) ? value.segments : [];
  const rows: SubtitleRow[] = [];
  for (const segment of segments) {
    if (!safeRecord(segment)) continue;
    const start = segment.start;
    const end = segment.end;
    const text = typeof segment.text === "string" ? segment.text.trim() : "";
    if (
      typeof start !== "number" ||
      typeof end !== "number" ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      !text
    )
      continue;
    rows.push(
      Object.freeze({
        endMs: Math.max(Math.round(end * 1_000), Math.round(start * 1_000) + 1),
        startMs: Math.max(0, Math.round(start * 1_000)),
        text,
      }),
    );
  }
  if (segments.length > 0 && rows.length === 0) {
    throw new GroqWhisperError(
      "MALFORMED_RESPONSE",
      "语音服务返回了无效结果。",
      false,
    );
  }
  if (
    rows.length === 0 &&
    typeof value.text === "string" &&
    value.text.trim()
  ) {
    return Object.freeze({
      detectedLanguage:
        typeof value.language === "string" && value.language.trim()
          ? value.language.trim()
          : null,
      transcript: Object.freeze({
        kind: "untimed" as const,
        paragraphs: Object.freeze([value.text.trim()]),
      }),
    });
  }
  if (
    rows.length === 0 &&
    typeof value.duration === "number" &&
    Number.isFinite(value.duration) &&
    value.duration >= 0 &&
    typeof value.language === "string" &&
    Array.isArray(value.segments) &&
    value.segments.length === 0 &&
    typeof value.text === "string" &&
    value.text.trim().length === 0
  ) {
    return Object.freeze({
      detectedLanguage: value.language.trim() || null,
      transcript: Object.freeze({
        kind: "untimed" as const,
        paragraphs: Object.freeze([]),
      }),
    });
  }
  if (rows.length === 0)
    throw new GroqWhisperError(
      "MALFORMED_RESPONSE",
      "语音服务没有返回可用字幕。",
      false,
    );
  return Object.freeze({
    detectedLanguage:
      typeof value.language === "string" && value.language.trim()
        ? value.language.trim()
        : null,
    transcript: Object.freeze({
      kind: "timed" as const,
      rows: Object.freeze(rows),
    }),
  });
}

function normalizeFailure(response: GroqFetchResponse): GroqWhisperError {
  if (response.status === 401)
    return new GroqWhisperError(
      "AUTHENTICATION_REQUIRED",
      "Groq 密钥无效。",
      false,
    );
  if (response.status === 403)
    return new GroqWhisperError(
      "PERMISSION_DENIED",
      "当前 Groq 账号无权使用语音模型。",
      false,
    );
  if (response.status === 413)
    return new GroqWhisperError(
      "FILE_TOO_LARGE",
      "语音分片超过上传限制。",
      false,
    );
  if (response.status === 429) {
    const retryAfter = parseRetryAfterSeconds(
      response.headers.get("retry-after") ??
        response.headers.get("x-ratelimit-reset-requests"),
    );
    return new GroqWhisperError(
      "RATE_LIMITED",
      "Groq 请求过于频繁，请稍后重试。",
      true,
      retryAfter,
    );
  }
  return new GroqWhisperError(
    "NETWORK_ERROR",
    "Groq 语音服务暂时不可用。",
    response.status >= 500,
  );
}

export function createGroqWhisperProvider(
  dependencies: GroqWhisperProviderDependencies,
): GroqWhisperProvider {
  const key = dependencies.apiKey.trim();
  if (!key || key.length > 4_096)
    throw new GroqWhisperError(
      "AUTHENTICATION_REQUIRED",
      "尚未配置 Groq 密钥。",
      false,
    );
  return Object.freeze({
    async transcribe(input: {
      readonly chunk: PreparedAudioChunk;
      readonly chunkCount: number;
      readonly model: GroqWhisperModel;
      readonly requestedLanguageMode: SubtitleLanguageMode;
      readonly title: string;
      readonly signal?: AbortSignal;
      readonly operationId?: string;
      readonly onActivity?: (
        activity: AsrTranscriptionProgress,
      ) => Promise<void> | void;
    }) {
      const form = new FormData();
      form.set(
        "file",
        new File(
          [new Uint8Array(input.chunk.bytes)],
          `chunk-${input.chunk.index + 1}.m4a`,
          { type: input.chunk.mimeType },
        ),
      );
      form.set("model", input.model);
      form.set("response_format", "verbose_json");
      form.set("timestamp_granularities[]", "segment");
      form.set("prompt", speechPrompt(input.requestedLanguageMode));
      const hint = speechLanguageHint(input.requestedLanguageMode);
      if (hint) form.set("language", hint);
      const controller = new AbortController();
      const abortFromCaller = () => controller.abort();
      input.signal?.addEventListener("abort", abortFromCaller, { once: true });
      if (input.signal?.aborted) controller.abort();
      let timedOut = false;
      const timeoutId = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, dependencies.timeoutMs ?? GROQ_REQUEST_TIMEOUT_MS);
      let lifecycleStage: "body" | "fetch" | "parse" | "progress" = "progress";
      try {
        await input.onActivity?.(
          Object.freeze({
            currentChunk: input.chunk.index + 1,
            phase: "uploading",
            totalChunks: input.chunkCount,
          }),
        );
        if (controller.signal.aborted) {
          throw new DOMException(
            "Speech transcription was cancelled",
            "AbortError",
          );
        }
        lifecycleStage = "fetch";
        const response = await withAbort(
          dependencies.fetch(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            {
              body: form,
              headers: Object.freeze({ Authorization: `Bearer ${key}` }),
              method: "POST",
              signal: controller.signal,
            },
          ),
          controller.signal,
        );
        if (controller.signal.aborted) {
          throw new DOMException(
            "Speech transcription was cancelled",
            "AbortError",
          );
        }
        if (!response.ok) throw normalizeFailure(response);
        lifecycleStage = "progress";
        await input.onActivity?.(
          Object.freeze({
            currentChunk: input.chunk.index + 1,
            phase: "waiting-response",
            totalChunks: input.chunkCount,
          }),
        );
        if (controller.signal.aborted) {
          throw new DOMException(
            "Speech transcription was cancelled",
            "AbortError",
          );
        }
        lifecycleStage = "body";
        const value = await withAbort(response.json(), controller.signal);
        if (controller.signal.aborted) {
          throw new DOMException(
            "Speech transcription was cancelled",
            "AbortError",
          );
        }
        lifecycleStage = "parse";
        return parseRows(value);
      } catch (error) {
        if (input.signal?.aborted) {
          throw new DOMException(
            "Speech transcription was cancelled",
            "AbortError",
          );
        }
        if (error instanceof GroqWhisperError) throw error;
        if (timedOut || controller.signal.aborted) {
          throw new GroqWhisperError(
            "NETWORK_ERROR",
            "Groq 语音请求超时。",
            true,
          );
        }
        if (lifecycleStage === "progress") throw error;
        if (lifecycleStage === "body" && error instanceof TypeError) {
          throw new GroqWhisperError(
            "NETWORK_ERROR",
            "Groq 语音响应传输中断。",
            true,
          );
        }
        if (lifecycleStage === "body" || lifecycleStage === "parse") {
          throw new GroqWhisperError(
            "MALFORMED_RESPONSE",
            "语音服务返回了无效结果。",
            false,
          );
        }
        throw new GroqWhisperError(
          "NETWORK_ERROR",
          "无法连接 Groq 语音服务。",
          true,
        );
      } finally {
        globalThis.clearTimeout(timeoutId);
        input.signal?.removeEventListener("abort", abortFromCaller);
      }
    },
  });
}
