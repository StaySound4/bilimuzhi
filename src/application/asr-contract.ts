import type {
  AuthorizedMedia,
  AuthorizedMediaGateway,
} from "./authorized-media-gateway";
import type {
  SubtitleLanguageMode,
  SubtitleRow,
  VideoKey,
  VideoRef,
} from "../domain";

export const GROQ_ATTACHMENT_LIMIT_BYTES = 25_000_000;
export const GROQ_SAFE_MAX_AUDIO_BYTES = 24_000_000;
export const GROQ_TARGET_AUDIO_BYTES = 20_000_000;
export const ASR_MIN_CHUNK_SECONDS = 45;
export const ASR_MAX_CHUNK_SECONDS = 3_600;
export const ASR_DEFAULT_CHUNK_SECONDS = 600;
// 单段音频的目标时长上限：Groq 单次请求的处理时间与排队受超时约束，
// 低码率音轨按字节分 1 份也可能超过 20 分钟，需按时长拆段。
export const ASR_TARGET_MAX_CHUNK_SECONDS = 1_200;
export const ASR_CHUNK_OVERLAP_SECONDS = 4;
export const ASR_MAX_SHRINK_ROUNDS = 3;
export const ASR_BOUNDARY_MERGE_GAP_MS = 1_500;
export const ASR_PLAIN_TEXT_DEDUP_WINDOW = 6;
export const GROQ_REQUEST_TIMEOUT_MS = 120_000;
export const GROQ_CHUNK_BUDGET_MS = 240_000;
/**
 * Kept for storage/API compatibility with pre-v15 consumers. The v15
 * transcriber deliberately performs no same-model replay.
 */
export const GROQ_MAX_SAME_MODEL_RETRIES = 1;

export type GroqWhisperModel = "whisper-large-v3" | "whisper-large-v3-turbo";
export type GroqRoutingMode = "balanced" | "standard-first" | "turbo-first";

export interface AudioChunkPlanItem {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
}

export interface PreparedAudioChunk extends AudioChunkPlanItem {
  readonly bytes: Readonly<Uint8Array>;
  readonly mimeType: string;
}

export interface TimedSpeechTranscript {
  readonly kind: "timed";
  readonly rows: readonly SubtitleRow[];
}

export interface UntimedSpeechTranscript {
  readonly kind: "untimed";
  readonly paragraphs: readonly string[];
}

export type SpeechTranscript = TimedSpeechTranscript | UntimedSpeechTranscript;

export interface AsrChunkCheckpoint {
  readonly chunkIndex: number;
  readonly detectedLanguage: string | null;
  readonly endMs: number;
  readonly model: GroqWhisperModel;
  readonly transcript: SpeechTranscript;
}

export interface AsrCheckpoint {
  readonly browserSessionId: string;
  readonly mediaIdentity: string;
  readonly completedChunks: readonly AsrChunkCheckpoint[];
  readonly uncertainChunkIndex: number | null;
  readonly uncertainChunkRetryCount: 0 | 1;
}

export interface AsrMediaAcquisitionProgress {
  readonly phase: "entitlement" | "metadata" | "downloading" | "hashing";
  readonly completedBytes: number;
  readonly totalBytes: number | null;
}

export interface AsrAudioBytePreparationProgress {
  readonly phase: "encoding";
  readonly completedBytes: number;
  readonly totalBytes: number;
}

export interface AsrAudioPreparationProgress {
  readonly phase: "loading" | "encoding" | "reading";
  readonly completedUnits: number;
  readonly totalUnits: number;
}

export interface AsrTranscriptionProgress {
  readonly phase:
    "uploading" | "waiting-response" | "switching-model" | "rate-limited";
  /** One-based chunk position for user-facing projection. */
  readonly currentChunk: number;
  readonly totalChunks: number;
  readonly retryAfterSeconds?: number;
}

export type AsrProgressActivity =
  | AsrMediaAcquisitionProgress
  | AsrAudioBytePreparationProgress
  | AsrAudioPreparationProgress
  | AsrTranscriptionProgress;

export interface AsrProgress {
  readonly stage: "preparing" | "transcribing" | "merging";
  readonly completedChunks: number;
  readonly totalChunks: number;
  readonly activity?: AsrProgressActivity;
  /** Byte projection for presenting legacy unit-based audio preparation. */
  readonly audioPreparationBytes?: AsrAudioBytePreparationProgress;
}

export interface AsrMediaAcquisitionOptions {
  readonly signal?: AbortSignal;
  readonly onProgress?: (
    progress: AsrMediaAcquisitionProgress,
  ) => Promise<void> | void;
}

export interface AsrAuthorizedMediaGateway extends AuthorizedMediaGateway {
  acquireCompleteAudio(
    video: VideoRef,
    options?: AsrMediaAcquisitionOptions,
  ): Promise<AuthorizedMedia>;
}

export interface SpeechTranscriptionRequest {
  readonly videoKey: VideoKey;
  readonly requestedLanguageMode: SubtitleLanguageMode;
  readonly routingMode: GroqRoutingMode;
  readonly title: string;
}

export interface SpeechTranscriptionResult {
  readonly detectedLanguage: string | null;
  readonly transcript: SpeechTranscript;
}

export interface AudioChunkProcessor {
  prepare(input: {
    readonly bytes: Readonly<Uint8Array>;
    readonly durationMs: number;
    /** Optional stricter local ceiling for every prepared upload chunk. */
    readonly maxChunkBytes?: number;
    readonly mimeType: string;
    readonly operationId: string;
    readonly signal?: AbortSignal;
    readonly onProgress?: (
      progress: AsrAudioPreparationProgress,
    ) => Promise<void> | void;
  }): Promise<readonly PreparedAudioChunk[]>;
}

export interface GroqWhisperProvider {
  transcribe(input: {
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
  }): Promise<{
    readonly detectedLanguage: string | null;
    readonly transcript: SpeechTranscript;
  }>;
}

export interface GroqChunkTranscriber {
  transcribe(input: {
    /** Remaining wall-clock budget; defaults to GROQ_CHUNK_BUDGET_MS. */
    readonly budgetMs?: number;
    readonly chunk: PreparedAudioChunk;
    readonly chunkCount: number;
    /** Recovery marker: the frozen first-choice request was already consumed. */
    readonly firstModelConsumed?: boolean;
    readonly operationId?: string;
    readonly onActivity?: (
      activity: AsrTranscriptionProgress,
    ) => Promise<void> | void;
    readonly requestedLanguageMode: SubtitleLanguageMode;
    readonly routingMode: GroqRoutingMode;
    readonly signal?: AbortSignal;
    readonly title: string;
  }): Promise<{
    readonly detectedLanguage: string | null;
    readonly model: GroqWhisperModel;
    readonly transcript: SpeechTranscript;
  }>;
}
