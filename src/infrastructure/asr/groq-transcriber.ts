import {
  GROQ_CHUNK_BUDGET_MS,
  type AsrTranscriptionProgress,
  type GroqChunkTranscriber,
  type GroqRoutingMode,
  type GroqWhisperModel,
  type GroqWhisperProvider,
  type PreparedAudioChunk,
  type SpeechTranscript,
} from "../../application/asr-contract";
import type { SubtitleLanguageMode } from "../../domain";
import { GroqWhisperError } from "./groq-provider";
import { getGroqRoutingCandidates } from "./groq-routing";

export interface GroqChunkTranscriberDependencies {
  readonly now: () => number;
  readonly provider: GroqWhisperProvider;
}

export interface GroqChunkTranscriptionResult {
  readonly detectedLanguage: string | null;
  readonly model: GroqWhisperModel;
  readonly transcript: SpeechTranscript;
}

function budgetFailure(): GroqWhisperError {
  return new GroqWhisperError("NETWORK_ERROR", "Groq 语音分片转写超时。", true);
}

function isTerminalFailure(error: GroqWhisperError): boolean {
  return (
    error.code === "AUTHENTICATION_REQUIRED" ||
    error.code === "PERMISSION_DENIED" ||
    error.code === "FILE_TOO_LARGE" ||
    error.code === "MALFORMED_RESPONSE" ||
    !error.retryable
  );
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

export function createGroqChunkTranscriber(
  dependencies: GroqChunkTranscriberDependencies,
): GroqChunkTranscriber {
  const blockedUntilByModel: Partial<Record<GroqWhisperModel, number>> = {};
  return Object.freeze({
    async transcribe(input: {
      readonly budgetMs?: number;
      readonly chunk: PreparedAudioChunk;
      readonly chunkCount: number;
      readonly firstModelConsumed?: boolean;
      readonly operationId?: string;
      readonly onActivity?: (
        activity: AsrTranscriptionProgress,
      ) => Promise<void> | void;
      readonly requestedLanguageMode: SubtitleLanguageMode;
      readonly routingMode: GroqRoutingMode;
      readonly signal?: AbortSignal;
      readonly title: string;
    }): Promise<GroqChunkTranscriptionResult> {
      const startedAt = dependencies.now();
      const requestedBudget = input.budgetMs ?? GROQ_CHUNK_BUDGET_MS;
      const budgetMs = Math.min(
        GROQ_CHUNK_BUDGET_MS,
        Number.isFinite(requestedBudget) ? Math.floor(requestedBudget) : 0,
      );
      if (budgetMs <= 0) throw budgetFailure();

      const canonicalCandidates = getGroqRoutingCandidates({
        chunkIndex: input.chunk.index,
        mode: input.routingMode,
        now: startedAt,
      });
      const candidates = canonicalCandidates
        .slice(input.firstModelConsumed ? 1 : 0)
        .filter((model) => (blockedUntilByModel[model] ?? 0) <= startedAt);
      if (candidates.length === 0) {
        const nextAvailableAt = Math.min(
          ...Object.values(blockedUntilByModel).filter(
            (value): value is number =>
              typeof value === "number" && value > startedAt,
          ),
        );
        throw new GroqWhisperError(
          "RATE_LIMITED",
          "Groq 语音模型暂时处于限流等待中。",
          true,
          Number.isFinite(nextAvailableAt)
            ? Math.max(1, Math.ceil((nextAvailableAt - startedAt) / 1_000))
            : 0,
        );
      }

      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = (): void => controller.abort();
      input.signal?.addEventListener("abort", abortFromCaller, { once: true });
      if (input.signal?.aborted) controller.abort();
      const timeoutId = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, budgetMs);
      const deadline = startedAt + budgetMs;
      const emit = async (
        phase: AsrTranscriptionProgress["phase"],
        retryAfterSeconds?: number,
      ): Promise<void> => {
        await input.onActivity?.(
          Object.freeze({
            currentChunk: input.chunk.index + 1,
            phase,
            ...(retryAfterSeconds === undefined
              ? {}
              : { retryAfterSeconds: Math.max(0, retryAfterSeconds) }),
            totalChunks: input.chunkCount,
          }),
        );
      };

      let lastError: GroqWhisperError | null = null;
      let lastUntimed: GroqChunkTranscriptionResult | null = null;
      try {
        for (const [attemptIndex, model] of candidates.entries()) {
          if (input.signal?.aborted) {
            throw new DOMException(
              "Speech transcription was cancelled",
              "AbortError",
            );
          }
          if (timedOut || dependencies.now() >= deadline) {
            throw lastError?.code === "RATE_LIMITED"
              ? lastError
              : budgetFailure();
          }
          if (attemptIndex > 0 || input.firstModelConsumed) {
            await emit("switching-model");
          }
          try {
            const result = await withAbort(
              dependencies.provider.transcribe({
                chunk: input.chunk,
                chunkCount: input.chunkCount,
                model,
                operationId: input.operationId,
                onActivity: async (activity) => {
                  await emit(activity.phase, activity.retryAfterSeconds);
                },
                requestedLanguageMode: input.requestedLanguageMode,
                signal: controller.signal,
                title: input.title,
              }),
              controller.signal,
            );
            if (input.signal?.aborted) {
              throw new DOMException(
                "Speech transcription was cancelled",
                "AbortError",
              );
            }
            if (timedOut || dependencies.now() > deadline) {
              throw budgetFailure();
            }
            const transcribed = Object.freeze({ ...result, model });
            if (result.transcript.kind === "timed") return transcribed;
            lastError = null;
            lastUntimed = transcribed;
          } catch (error) {
            if (input.signal?.aborted) {
              throw new DOMException(
                "Speech transcription was cancelled",
                "AbortError",
              );
            }
            if (error instanceof DOMException && error.name === "AbortError") {
              if (timedOut) throw budgetFailure();
              throw error;
            }
            if (!(error instanceof GroqWhisperError)) throw error;
            lastUntimed = null;
            lastError = error;
            if (isTerminalFailure(error)) throw error;
            if (error.code === "RATE_LIMITED") {
              blockedUntilByModel[model] =
                dependencies.now() +
                Math.max(1, error.retryAfterSeconds) * 1_000;
              await emit("rate-limited", error.retryAfterSeconds);
            }
          }
        }
        if (lastUntimed !== null) return lastUntimed;
        throw lastError ?? budgetFailure();
      } finally {
        globalThis.clearTimeout(timeoutId);
        input.signal?.removeEventListener("abort", abortFromCaller);
      }
    },
  });
}
