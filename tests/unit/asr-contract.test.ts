import { describe, expect, it } from "vitest";

import {
  ASR_BOUNDARY_MERGE_GAP_MS,
  ASR_CHUNK_OVERLAP_SECONDS,
  ASR_MAX_CHUNK_SECONDS,
  ASR_MAX_SHRINK_ROUNDS,
  ASR_MIN_CHUNK_SECONDS,
  ASR_PLAIN_TEXT_DEDUP_WINDOW,
  ASR_TARGET_MAX_CHUNK_SECONDS,
  GROQ_CHUNK_BUDGET_MS,
  GROQ_MAX_SAME_MODEL_RETRIES,
  GROQ_REQUEST_TIMEOUT_MS,
  GROQ_SAFE_MAX_AUDIO_BYTES,
  GROQ_TARGET_AUDIO_BYTES,
  type AsrCheckpoint,
  type SpeechTranscript,
} from "../../src/application/asr-contract";

describe("speech transcription contracts", () => {
  it("locks the reviewed upload, chunking, overlap, retry, and merge constants", () => {
    expect(GROQ_SAFE_MAX_AUDIO_BYTES).toBe(24_000_000);
    expect(GROQ_TARGET_AUDIO_BYTES).toBe(20_000_000);
    expect(ASR_MIN_CHUNK_SECONDS).toBe(45);
    expect(ASR_MAX_CHUNK_SECONDS).toBe(3_600);
    expect(ASR_CHUNK_OVERLAP_SECONDS).toBe(4);
    expect(ASR_MAX_SHRINK_ROUNDS).toBe(3);
    expect(ASR_BOUNDARY_MERGE_GAP_MS).toBe(1_500);
    expect(ASR_PLAIN_TEXT_DEDUP_WINDOW).toBe(6);
    expect(GROQ_REQUEST_TIMEOUT_MS).toBe(120_000);
    expect(GROQ_CHUNK_BUDGET_MS).toBe(240_000);
    expect(ASR_TARGET_MAX_CHUNK_SECONDS).toBe(1_200);
    expect(GROQ_MAX_SAME_MODEL_RETRIES).toBe(1);
  });

  it("keeps untimed provider output separate instead of inventing timestamps", () => {
    const transcript: SpeechTranscript = Object.freeze({
      kind: "untimed",
      paragraphs: Object.freeze(["没有时间戳的正文"]),
    });

    expect(transcript).toEqual({
      kind: "untimed",
      paragraphs: ["没有时间戳的正文"],
    });
    expect(transcript).not.toHaveProperty("rows");
  });

  it("models resumable completed chunks and at most one uncertain chunk", () => {
    const checkpoint: AsrCheckpoint = Object.freeze({
      browserSessionId: "browser-session-1",
      completedChunks: Object.freeze([
        Object.freeze({
          chunkIndex: 0,
          detectedLanguage: "zh",
          endMs: 600_000,
          model: "whisper-large-v3-turbo",
          transcript: Object.freeze({
            kind: "timed" as const,
            rows: Object.freeze([
              Object.freeze({ endMs: 1_000, startMs: 0, text: "测试" }),
            ]),
          }),
        }),
      ]),
      mediaIdentity: "sha256:media",
      uncertainChunkIndex: 1,
      uncertainChunkRetryCount: 0,
    });

    expect(checkpoint.completedChunks).toHaveLength(1);
    expect(checkpoint.uncertainChunkIndex).toBe(1);
    expect(JSON.stringify(checkpoint)).not.toContain("https://");
  });
});
