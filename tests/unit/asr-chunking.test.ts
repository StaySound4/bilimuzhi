import { describe, expect, it } from "vitest";

import {
  buildOverlappedChunkPlan,
  estimateChunkSeconds,
  nextSmallerChunkSeconds,
} from "../../src/infrastructure/asr/chunking";
import {
  mergePlainTextRows,
  mergeTimestampedChunkRows,
} from "../../src/infrastructure/asr/chunk-merger";
import {
  getGroqRoutingCandidates,
  parseRetryAfterSeconds,
} from "../../src/infrastructure/asr/groq-routing";

describe("speech transcription chunk contracts", () => {
  it("estimates 20 MB chunks and builds a four-second overlap", () => {
    expect(
      estimateChunkSeconds({ byteLength: 40_000_000, durationMs: 1_200_000 }),
    ).toBe(600);
    expect(buildOverlappedChunkPlan(1_200_000, 600)).toEqual([
      { endMs: 600_000, index: 0, startMs: 0 },
      { endMs: 1_196_000, index: 1, startMs: 596_000 },
      { endMs: 1_200_000, index: 2, startMs: 1_192_000 },
    ]);
  });

  it("splits audio evenly by file size targeting 20 MB per chunk", () => {
    // 56 MB / 20 MB → 3 份，每份时长 = 总时长 / 3。
    expect(
      estimateChunkSeconds({ byteLength: 56_000_000, durationMs: 1_200_000 }),
    ).toBe(400);
    // 低于目标大小 → 受 20 分钟时长上限约束：25 分钟拆 2 份。
    expect(
      estimateChunkSeconds({ byteLength: 11_900_000, durationMs: 1_505_000 }),
    ).toBe(752);
    // 40 MB → 2 份；21 MB → 2 份。
    expect(
      estimateChunkSeconds({ byteLength: 40_000_000, durationMs: 1_200_000 }),
    ).toBe(600);
    expect(
      estimateChunkSeconds({ byteLength: 21_000_000, durationMs: 1_000_000 }),
    ).toBe(500);
    // 恰好等于目标大小 → 1 份。
    expect(
      estimateChunkSeconds({ byteLength: 20_000_000, durationMs: 600_000 }),
    ).toBe(600);
  });

  it("caps each chunk at 20 minutes even when the bitrate is low", () => {
    // 64 kbps 音轨：18 MB ≈ 37 分钟，字节只够 1 份，但时长要求拆 2 份。
    expect(
      estimateChunkSeconds({ byteLength: 18_000_000, durationMs: 2_222_000 }),
    ).toBe(1_111);
    // 11.9 MB / 25 分钟：字节 1 份、时长 2 份 → 取 2 份。
    expect(
      estimateChunkSeconds({ byteLength: 11_900_000, durationMs: 1_505_000 }),
    ).toBe(752);
    // 132 kbps 音轨：18 MB ≈ 18 分钟，字节与时长都只需 1 份。
    expect(
      estimateChunkSeconds({ byteLength: 18_000_000, durationMs: 1_090_000 }),
    ).toBe(1_090);
    // 恰好 20 分钟边界：1 份。
    expect(
      estimateChunkSeconds({ byteLength: 9_000_000, durationMs: 1_200_000 }),
    ).toBe(1_200);
  });

  it("shrinks an oversized observed chunk without exceeding the current size", () => {
    const next = nextSmallerChunkSeconds(600, 30_000_000, 24_000_000);
    expect(next).toBeGreaterThanOrEqual(45);
    expect(next).toBeLessThan(600);
  });

  it("clips overlap timestamps and removes repeated boundary text", () => {
    expect(
      mergeTimestampedChunkRows(
        [{ startMs: 0, endMs: 10_000, text: "第一句" }],
        [
          { startMs: 0, endMs: 4_000, text: "第一句" },
          { startMs: 4_000, endMs: 8_000, text: "第二句" },
        ],
        6_000,
        4_000,
      ),
    ).toEqual([
      { startMs: 0, endMs: 10_000, text: "第一句" },
      { startMs: 10_000, endMs: 14_000, text: "第二句" },
    ]);
    expect(mergePlainTextRows(["A", "B"], ["A", "B", "C"])).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("alternates balanced Groq routing and respects blocked models", () => {
    expect(
      getGroqRoutingCandidates({ chunkIndex: 0, mode: "balanced", now: 1 }),
    ).toEqual(["whisper-large-v3-turbo", "whisper-large-v3"]);
    expect(
      getGroqRoutingCandidates({
        blockedUntilByModel: { "whisper-large-v3": 10 },
        chunkIndex: 1,
        mode: "balanced",
        now: 1,
      }),
    ).toEqual(["whisper-large-v3-turbo"]);
    expect(parseRetryAfterSeconds("1m 2s")).toBe(62);
  });
});
