import {
  ASR_CHUNK_OVERLAP_SECONDS,
  ASR_DEFAULT_CHUNK_SECONDS,
  ASR_MAX_CHUNK_SECONDS,
  ASR_MIN_CHUNK_SECONDS,
  ASR_TARGET_MAX_CHUNK_SECONDS,
  GROQ_TARGET_AUDIO_BYTES,
  type AudioChunkPlanItem,
} from "../../application/asr-contract";

export function clampChunkSeconds(value: number): number {
  if (!Number.isFinite(value)) return ASR_DEFAULT_CHUNK_SECONDS;
  return Math.max(
    ASR_MIN_CHUNK_SECONDS,
    Math.min(ASR_MAX_CHUNK_SECONDS, Math.floor(value)),
  );
}

export function estimateChunkSeconds(input: {
  readonly byteLength: number;
  readonly durationMs: number;
  readonly targetBytes?: number;
}): number {
  if (
    !Number.isSafeInteger(input.byteLength) ||
    input.byteLength <= 0 ||
    !Number.isSafeInteger(input.durationMs) ||
    input.durationMs <= 0
  ) {
    return ASR_DEFAULT_CHUNK_SECONDS;
  }
  // 按字节与时长双约束平均分段：
  // 段数 = max(⌈总字节 / 20 MB⌉, ⌈总时长 / 20 分钟⌉)，每段时长 = 总时长 / 段数。
  // AAC 免重编码切片下段大小与原始码率成正比；
  // 低码率音轨可能字节很小但时长很长，单段过长会让 Groq 单次请求超时。
  const target = input.targetBytes ?? GROQ_TARGET_AUDIO_BYTES;
  const chunkCount = Math.max(
    Math.ceil(input.byteLength / target),
    Math.ceil(input.durationMs / 1_000 / ASR_TARGET_MAX_CHUNK_SECONDS),
  );
  const secondsPerChunk = Math.floor(input.durationMs / 1_000 / chunkCount);
  return clampChunkSeconds(secondsPerChunk);
}

export function buildOverlappedChunkPlan(
  durationMs: number,
  chunkSeconds: number,
  overlapSeconds = ASR_CHUNK_OVERLAP_SECONDS,
): readonly AudioChunkPlanItem[] {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0)
    return Object.freeze([]);
  const chunkMs = clampChunkSeconds(chunkSeconds) * 1_000;
  const overlapMs = Math.max(
    0,
    Math.min(Math.floor(overlapSeconds * 1_000), chunkMs - 1_000),
  );
  const stepMs = chunkMs - overlapMs;
  const plan: AudioChunkPlanItem[] = [];
  for (let startMs = 0, index = 0; startMs < durationMs; index += 1) {
    const endMs = Math.min(durationMs, startMs + chunkMs);
    plan.push(Object.freeze({ endMs, index, startMs }));
    if (endMs >= durationMs) break;
    startMs += stepMs;
  }
  return Object.freeze(plan);
}

export function nextSmallerChunkSeconds(
  currentSeconds: number,
  observedMaxBytes: number,
  safeMaxBytes: number,
): number {
  const ratio = Math.min(
    0.95,
    (safeMaxBytes / Math.max(1, observedMaxBytes)) * 0.97,
  );
  return Math.floor(clampChunkSeconds(currentSeconds) * ratio);
}
