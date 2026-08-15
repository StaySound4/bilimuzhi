import {
  ASR_MAX_SHRINK_ROUNDS,
  GROQ_SAFE_MAX_AUDIO_BYTES,
  GROQ_TARGET_AUDIO_BYTES,
  type AudioChunkProcessor,
  type PreparedAudioChunk,
} from "../../application/asr-contract";
import {
  buildOverlappedChunkPlan,
  estimateChunkSeconds,
  nextSmallerChunkSeconds,
} from "./chunking";

export interface FfmpegEngine {
  writeFile(path: string, bytes: Uint8Array): Promise<unknown>;
  readFile(path: string): Promise<Uint8Array>;
  deleteFile(path: string): Promise<unknown>;
  exec(
    arguments_: readonly string[],
    onProgress?: (progress: number) => void,
  ): Promise<number>;
  terminate(): void;
}

export interface FfmpegAudioChunkProcessorDependencies {
  readonly load: () => Promise<FfmpegEngine>;
  readonly createOperationId: () => string;
}

function abortError(): DOMException {
  return new DOMException("Speech processing was cancelled", "AbortError");
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function safeOperationId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .slice(0, 64);
  return normalized || "operation";
}

function effectiveMaxChunkBytes(value: number | undefined): number {
  if (value === undefined) return GROQ_SAFE_MAX_AUDIO_BYTES;
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError("The audio chunk byte ceiling must be positive");
  }
  return Math.min(GROQ_SAFE_MAX_AUDIO_BYTES, Math.max(1, Math.floor(value)));
}

async function bestEffortDelete(
  engine: FfmpegEngine,
  path: string,
): Promise<void> {
  try {
    await engine.deleteFile(path);
  } catch {
    // The operation may have been cancelled before FFmpeg created the file.
  }
}

export function createFfmpegAudioChunkProcessor(
  dependencies: FfmpegAudioChunkProcessorDependencies,
): AudioChunkProcessor {
  return Object.freeze({
    async prepare(
      input: Parameters<AudioChunkProcessor["prepare"]>[0],
    ): Promise<readonly PreparedAudioChunk[]> {
      assertNotAborted(input.signal);
      if (
        !Number.isSafeInteger(input.durationMs) ||
        input.durationMs <= 0 ||
        input.bytes.byteLength <= 0
      ) {
        throw new TypeError("Audio bytes and duration must be positive");
      }
      const maxChunkBytes = effectiveMaxChunkBytes(input.maxChunkBytes);
      const operationId = safeOperationId(dependencies.createOperationId());
      const inputPath = `${operationId}-input.bin`;
      await input.onProgress?.({
        completedUnits: 0,
        phase: "loading",
        totalUnits: 1,
      });
      const engine = await dependencies.load();
      await input.onProgress?.({
        completedUnits: 1,
        phase: "loading",
        totalUnits: 1,
      });
      const generatedPaths = new Set<string>();
      let progressWrites: Promise<void> = Promise.resolve();
      const queueProgress = (
        progress: Parameters<NonNullable<typeof input.onProgress>>[0],
      ): void => {
        progressWrites = progressWrites.then(async () => {
          await input.onProgress?.(progress);
        });
      };
      const flushProgress = async (): Promise<void> => {
        await progressWrites;
      };
      let cancelled = false;
      const cancel = () => {
        cancelled = true;
        engine.terminate();
      };
      input.signal?.addEventListener("abort", cancel, { once: true });
      try {
        assertNotAborted(input.signal);
        await engine.writeFile(inputPath, Uint8Array.from(input.bytes));
        let chunkSeconds = estimateChunkSeconds({
          byteLength: input.bytes.byteLength,
          durationMs: input.durationMs,
          targetBytes: Math.min(GROQ_TARGET_AUDIO_BYTES, maxChunkBytes),
        });
        for (let round = 0; round <= ASR_MAX_SHRINK_ROUNDS; round += 1) {
          const plan = buildOverlappedChunkPlan(input.durationMs, chunkSeconds);
          const prepared: PreparedAudioChunk[] = [];
          let observedMaxBytes = 0;
          for (const item of plan) {
            assertNotAborted(input.signal);
            const outputPath = `${operationId}-r${round}-c${item.index}.m4a`;
            generatedPaths.add(outputPath);
            queueProgress({
              completedUnits: item.index,
              phase: "encoding",
              totalUnits: plan.length,
            });
            const exitCode = await engine.exec(
              [
                "-ss",
                (item.startMs / 1_000).toFixed(3),
                "-t",
                ((item.endMs - item.startMs) / 1_000).toFixed(3),
                "-i",
                inputPath,
                "-vn",
                // AAC 免重编码切片：直接复制原始音轨流（Groq 原生支持 mp4/m4a），
                // 段大小与原始码率成正比，由按字节平均分的分段算法控制。
                "-c",
                "copy",
                "-y",
                outputPath,
              ],
              (progress) => {
                const normalized = Math.min(1, Math.max(0, progress));
                queueProgress({
                  completedUnits: item.index + normalized,
                  phase: "encoding",
                  totalUnits: plan.length,
                });
              },
            );
            queueProgress({
              completedUnits: item.index + 1,
              phase: "encoding",
              totalUnits: plan.length,
            });
            await flushProgress();
            if (exitCode !== 0) throw new Error("FFmpeg audio export failed");
            assertNotAborted(input.signal);
            await input.onProgress?.({
              completedUnits: item.index,
              phase: "reading",
              totalUnits: plan.length,
            });
            const bytes = Uint8Array.from(await engine.readFile(outputPath));
            await input.onProgress?.({
              completedUnits: item.index + 1,
              phase: "reading",
              totalUnits: plan.length,
            });
            await bestEffortDelete(engine, outputPath);
            generatedPaths.delete(outputPath);
            observedMaxBytes = Math.max(observedMaxBytes, bytes.byteLength);
            prepared.push(
              Object.freeze({
                ...item,
                bytes,
                mimeType: "audio/mp4",
              }),
            );
          }
          if (observedMaxBytes <= maxChunkBytes) {
            return Object.freeze(prepared);
          }
          if (round === ASR_MAX_SHRINK_ROUNDS) {
            throw new RangeError(
              "Audio chunks remain above the safe upload limit",
            );
          }
          chunkSeconds = nextSmallerChunkSeconds(
            chunkSeconds,
            observedMaxBytes,
            maxChunkBytes,
          );
        }
        throw new RangeError("Unable to prepare audio chunks");
      } catch (error) {
        if (cancelled || input.signal?.aborted) throw abortError();
        throw error;
      } finally {
        input.signal?.removeEventListener("abort", cancel);
        for (const path of generatedPaths) await bestEffortDelete(engine, path);
        await bestEffortDelete(engine, inputPath);
      }
    },
  });
}
