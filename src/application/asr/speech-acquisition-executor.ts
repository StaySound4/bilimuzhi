import { createSubtitleSnapshot, type SubtitleRow } from "../../domain";
import type {
  AsrChunkCheckpoint,
  AsrCheckpoint,
  AsrAuthorizedMediaGateway,
  AsrAudioBytePreparationProgress,
  AsrProgressActivity,
  AudioChunkProcessor,
  GroqChunkTranscriber,
  PreparedAudioChunk,
  SpeechTranscript,
} from "../asr-contract";
import {
  ASR_MAX_SHRINK_ROUNDS,
  GROQ_CHUNK_BUDGET_MS,
  GROQ_SAFE_MAX_AUDIO_BYTES,
} from "../asr-contract";
import type { SpeechAcquisitionExecutor } from "./speech-acquisition-coordinator";
import type { BranchSubtitleRepository } from "../subtitle-repository";

export interface SpeechExecutionKeepalive {
  acquire(operationId: string): Promise<() => Promise<void>>;
}

export interface SpeechAcquisitionExecutorDependencies {
  readonly chunkProcessor: AudioChunkProcessor;
  readonly createSubtitleId: () => string;
  readonly hashRows: (rows: readonly SubtitleRow[]) => Promise<string>;
  readonly keepalive?: SpeechExecutionKeepalive;
  readonly mediaGateway: AsrAuthorizedMediaGateway;
  readonly mergeTimedRows: (
    existingRows: readonly SubtitleRow[],
    chunkRows: readonly SubtitleRow[],
    chunkStartMs: number,
    overlapMs: number,
  ) => readonly SubtitleRow[];
  readonly now: () => number;
  readonly repository: BranchSubtitleRepository;
  readonly transcriber: GroqChunkTranscriber;
}

export class SpeechExecutionError extends Error {
  constructor(
    readonly code:
      | "MEDIA_IDENTITY_CHANGED"
      | "TIMESTAMPS_UNAVAILABLE"
      | "SPEECH_TRANSCRIPTION_FAILED",
    message: string,
  ) {
    super(message);
    this.name = "SpeechExecutionError";
  }
}

function cloneTranscript(transcript: SpeechTranscript): SpeechTranscript {
  return transcript.kind === "timed"
    ? Object.freeze({
        kind: "timed" as const,
        rows: Object.freeze(
          transcript.rows.map((row) => Object.freeze({ ...row })),
        ),
      })
    : Object.freeze({
        kind: "untimed" as const,
        paragraphs: Object.freeze([...transcript.paragraphs]),
      });
}

function isFileTooLargeError(
  error: unknown,
): error is { readonly code: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FILE_TOO_LARGE"
  );
}

function nextShrinkMaxChunkBytes(current: number): number {
  return Math.max(1, Math.min(current - 1, Math.floor(current * 0.75)));
}

export function createSpeechAcquisitionExecutor(
  dependencies: SpeechAcquisitionExecutorDependencies,
): SpeechAcquisitionExecutor {
  return Object.freeze({
    async cancel(owner: Parameters<SpeechAcquisitionExecutor["cancel"]>[0]) {
      await dependencies.repository.finishAcquisition(owner, "cancelled");
    },
    async execute(input: Parameters<SpeechAcquisitionExecutor["execute"]>[0]) {
      const throwIfCancelled = (): void => {
        if (input.signal.aborted) {
          throw new DOMException(
            "Speech transcription was cancelled",
            "AbortError",
          );
        }
      };
      let releaseKeepalive: () => Promise<void> = async () => undefined;
      try {
        releaseKeepalive =
          (await dependencies.keepalive?.acquire(input.record.owner.taskId)) ??
          releaseKeepalive;
      } catch {
        // Keepalive improves MV3 continuity, but a temporary Offscreen setup
        // failure must not replace the real media/transcription result.
      }
      try {
        const context = await dependencies.repository.readAcquisitionContext(
          input.record.owner.videoKey,
        );
        if (context === null) {
          throw new SpeechExecutionError(
            "SPEECH_TRANSCRIPTION_FAILED",
            "The speech acquisition video is no longer bound",
          );
        }
        const resumableCheckpoint =
          input.record.checkpoint !== null &&
          input.record.checkpoint.mediaIdentity.length > 0
            ? input.record.checkpoint
            : null;
        let checkpoint: AsrCheckpoint =
          resumableCheckpoint ??
          Object.freeze({
            browserSessionId: input.record.browserSessionId,
            completedChunks: Object.freeze([]),
            mediaIdentity: "",
            uncertainChunkIndex: null,
            uncertainChunkRetryCount: 0,
          });
        const publishPreparingProgress = async (
          activity: AsrProgressActivity,
          audioPreparationBytes?: AsrAudioBytePreparationProgress,
        ): Promise<void> => {
          throwIfCancelled();
          await input.onCheckpoint(checkpoint, {
            activity,
            ...(audioPreparationBytes === undefined
              ? {}
              : { audioPreparationBytes }),
            completedChunks: checkpoint.completedChunks.length,
            stage: "preparing",
            totalChunks: 0,
          });
        };
        const media = await dependencies.mediaGateway.acquireCompleteAudio(
          context.video,
          {
            onProgress: publishPreparingProgress,
            signal: input.signal,
          },
        );
        if (
          resumableCheckpoint !== null &&
          resumableCheckpoint.mediaIdentity !== media.mediaIdentity
        ) {
          throw new SpeechExecutionError(
            "MEDIA_IDENTITY_CHANGED",
            "The authorized media identity changed during recovery",
          );
        }
        await dependencies.repository.beginAcquisition(input.record.owner, {
          mediaIdentity: media.mediaIdentity,
          method: "speech",
          model: input.record.parameters.model,
          provider: input.record.parameters.provider,
          requestedLanguageMode: input.record.parameters.requestedLanguageMode,
        });
        try {
          checkpoint =
            resumableCheckpoint ??
            Object.freeze({
              ...checkpoint,
              mediaIdentity: media.mediaIdentity,
            });
          await publishPreparingProgress({
            completedUnits: 0,
            phase: "loading",
            totalUnits: 1,
          });
          let chunks: readonly PreparedAudioChunk[] = Object.freeze([]);
          let completed = new Map<number, AsrChunkCheckpoint>();
          let maxChunkBytes: number | undefined;
          let shrinkRound = 0;
          while (true) {
            throwIfCancelled();
            await publishPreparingProgress({
              completedUnits: 0,
              phase: "loading",
              totalUnits: 1,
            });
            let preparationCompletedBytes = 0;
            chunks = await dependencies.chunkProcessor.prepare({
              bytes: media.bytes,
              durationMs: media.durationMs,
              ...(maxChunkBytes === undefined ? {} : { maxChunkBytes }),
              mimeType: media.mimeType,
              operationId: input.record.owner.taskId,
              onProgress: async (progress) => {
                if (progress.phase !== "encoding") {
                  await publishPreparingProgress(progress);
                  return;
                }
                const ratio =
                  progress.totalUnits <= 0
                    ? 0
                    : Math.min(
                        1,
                        Math.max(
                          0,
                          progress.completedUnits / progress.totalUnits,
                        ),
                      );
                preparationCompletedBytes = Math.max(
                  preparationCompletedBytes,
                  Math.min(
                    media.byteLength,
                    Math.round(media.byteLength * ratio),
                  ),
                );
                await publishPreparingProgress(progress, {
                  completedBytes: preparationCompletedBytes,
                  phase: "encoding",
                  totalBytes: media.byteLength,
                });
              },
              signal: input.signal,
            });
            await publishPreparingProgress({
              completedUnits: chunks.length,
              phase: "reading",
              totalUnits: chunks.length,
            });
            await input.onCheckpoint(checkpoint, {
              completedChunks: checkpoint.completedChunks.length,
              stage: "transcribing",
              totalChunks: chunks.length,
            });
            completed = new Map(
              checkpoint.completedChunks.map((chunk) => [
                chunk.chunkIndex,
                chunk,
              ]),
            );
            try {
              for (const chunk of chunks) {
                throwIfCancelled();
                if (completed.has(chunk.index)) continue;
                const isUncertainRetry =
                  checkpoint.uncertainChunkIndex === chunk.index;
                checkpoint = Object.freeze({
                  ...checkpoint,
                  uncertainChunkIndex: chunk.index,
                  uncertainChunkRetryCount: isUncertainRetry ? 1 : 0,
                });
                await input.onCheckpoint(checkpoint, {
                  completedChunks: completed.size,
                  stage: "transcribing",
                  totalChunks: chunks.length,
                });
                throwIfCancelled();
                const recoveryElapsedMs = isUncertainRetry
                  ? Math.max(0, dependencies.now() - input.record.updatedAt)
                  : 0;
                const transcribed = await dependencies.transcriber.transcribe({
                  budgetMs: Math.max(
                    0,
                    GROQ_CHUNK_BUDGET_MS - recoveryElapsedMs,
                  ),
                  chunk,
                  chunkCount: chunks.length,
                  firstModelConsumed: isUncertainRetry,
                  onActivity: async (activity) => {
                    throwIfCancelled();
                    await input.onCheckpoint(checkpoint, {
                      activity,
                      completedChunks: completed.size,
                      stage: "transcribing",
                      totalChunks: chunks.length,
                    });
                  },
                  operationId: `${input.record.owner.taskId}:chunk-${chunk.index}${
                    shrinkRound === 0 ? "" : `:shrink-${shrinkRound}`
                  }`,
                  requestedLanguageMode:
                    input.record.parameters.requestedLanguageMode,
                  routingMode: input.record.parameters.routingMode,
                  signal: input.signal,
                  title: context.video.title,
                });
                throwIfCancelled();
                const chunkCheckpoint = Object.freeze({
                  chunkIndex: chunk.index,
                  detectedLanguage: transcribed.detectedLanguage,
                  endMs: chunk.endMs,
                  model: transcribed.model,
                  transcript: cloneTranscript(transcribed.transcript),
                });
                completed.set(chunk.index, chunkCheckpoint);
                checkpoint = Object.freeze({
                  ...checkpoint,
                  completedChunks: Object.freeze(
                    [...completed.values()].sort(
                      (left, right) => left.chunkIndex - right.chunkIndex,
                    ),
                  ),
                  uncertainChunkIndex: null,
                  uncertainChunkRetryCount: 0,
                });
                await input.onCheckpoint(checkpoint, {
                  completedChunks: completed.size,
                  stage: "transcribing",
                  totalChunks: chunks.length,
                });
              }
              break;
            } catch (error) {
              if (
                !isFileTooLargeError(error) ||
                shrinkRound >= ASR_MAX_SHRINK_ROUNDS
              ) {
                throw error;
              }
              maxChunkBytes = nextShrinkMaxChunkBytes(
                maxChunkBytes ?? GROQ_SAFE_MAX_AUDIO_BYTES,
              );
              shrinkRound += 1;
              checkpoint = Object.freeze({
                ...checkpoint,
                completedChunks: Object.freeze([]),
                uncertainChunkIndex: null,
                uncertainChunkRetryCount: 0,
              });
              completed.clear();
              await input.onCheckpoint(checkpoint, {
                completedChunks: 0,
                stage: "preparing",
                totalChunks: 0,
              });
            }
          }

          throwIfCancelled();
          await input.onCheckpoint(checkpoint, {
            completedChunks: completed.size,
            stage: "merging",
            totalChunks: chunks.length,
          });
          let rows: readonly SubtitleRow[] = Object.freeze([]);
          let detectedLanguage: string | null = null;
          for (const item of checkpoint.completedChunks) {
            detectedLanguage ??= item.detectedLanguage;
            if (item.transcript.kind !== "timed") {
              throw new SpeechExecutionError(
                "TIMESTAMPS_UNAVAILABLE",
                "The speech provider did not return a usable timeline",
              );
            }
            const chunk = chunks[item.chunkIndex];
            if (!chunk) {
              throw new SpeechExecutionError(
                "SPEECH_TRANSCRIPTION_FAILED",
                "The speech checkpoint does not match the chunk plan",
              );
            }
            rows = dependencies.mergeTimedRows(
              rows,
              item.transcript.rows,
              chunk.startMs,
              chunk.index === 0 ? 0 : 4_000,
            );
          }
          if (rows.length === 0) {
            throw new SpeechExecutionError(
              "SPEECH_TRANSCRIPTION_FAILED",
              "Speech transcription produced no subtitle rows",
            );
          }
          const subtitleId = dependencies.createSubtitleId();
          const staged = createSubtitleSnapshot({
            branchId: input.record.owner.draftBranchId,
            contentHash: await dependencies.hashRows(rows),
            createdAt: dependencies.now(),
            language:
              detectedLanguage ?? input.record.parameters.requestedLanguageMode,
            rows,
            sessionId: input.record.owner.sessionId,
            source: "groq-whisper",
            status: "staged",
            subtitleId,
            videoKey: input.record.owner.videoKey,
          });
          throwIfCancelled();
          const committed = await dependencies.repository.commitAcquisition(
            input.record.owner,
            staged,
          );
          return Object.freeze({
            branchId: committed.branch.branchId,
            detectedLanguage,
            rowCount: committed.subtitle.rows.length,
            subtitleId: committed.subtitle.subtitleId,
          });
        } catch (error) {
          try {
            await dependencies.repository.finishAcquisition(
              input.record.owner,
              input.signal.aborted ? "cancelled" : "failed",
            );
          } catch {
            // Preserve the original processing failure.
          }
          throw error;
        }
      } finally {
        try {
          await releaseKeepalive();
        } catch {
          // Task completion is authoritative even if the best-effort lease
          // cleanup acknowledgement is lost during extension shutdown.
        }
      }
    },
  });
}
