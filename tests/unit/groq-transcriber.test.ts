import { describe, expect, it, vi } from "vitest";

import type { GroqWhisperProvider } from "../../src/application/asr-contract";
import { GroqWhisperError } from "../../src/infrastructure/asr/groq-provider";
import { createGroqChunkTranscriber } from "../../src/infrastructure/asr/groq-transcriber";

const chunk = Object.freeze({
  bytes: new Uint8Array([1]),
  endMs: 1_000,
  index: 1,
  mimeType: "audio/mpeg",
  startMs: 0,
});

function success(model: string) {
  return {
    detectedLanguage: "zh",
    transcript: {
      kind: "timed" as const,
      rows: [{ endMs: 1_000, startMs: 0, text: model }],
    },
  };
}

describe("Groq chunk transcriber", () => {
  it("uses balanced odd-chunk standard first", async () => {
    const provider: GroqWhisperProvider = {
      transcribe: vi.fn(async (input) => success(input.model)),
    };
    const transcriber = createGroqChunkTranscriber({
      now: () => 1_000,
      provider,
    });

    await expect(
      transcriber.transcribe({
        chunk,
        chunkCount: 2,
        requestedLanguageMode: "zh",
        routingMode: "balanced",
        title: "视频",
      }),
    ).resolves.toMatchObject({ model: "whisper-large-v3" });
  });

  it("switches immediately from Standard to Turbo after a replaceable network failure", async () => {
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(
        new GroqWhisperError("NETWORK_ERROR", "network", true),
      )
      .mockResolvedValueOnce(success("turbo"));
    const transcriber = createGroqChunkTranscriber({
      now: () => 1_000,
      provider: { transcribe },
    });

    await expect(
      transcriber.transcribe({
        chunk: { ...chunk, index: 0 },
        chunkCount: 1,
        requestedLanguageMode: "mixed",
        routingMode: "standard-first",
        title: "视频",
      }),
    ).resolves.toEqual({
      detectedLanguage: "zh",
      model: "whisper-large-v3-turbo",
      transcript: {
        kind: "timed",
        rows: [{ endMs: 1_000, startMs: 0, text: "turbo" }],
      },
    });
    expect(transcribe.mock.calls.map((call) => call[0].model)).toEqual([
      "whisper-large-v3",
      "whisper-large-v3-turbo",
    ]);
  });

  it("blocks a rate-limited model and never switches on auth or file errors", async () => {
    let now = 1_000;
    const transcribe = vi
      .fn()
      .mockRejectedValueOnce(
        new GroqWhisperError("RATE_LIMITED", "limited", true, 10),
      )
      .mockResolvedValueOnce(success("fallback"))
      .mockResolvedValueOnce(success("still-blocked"));
    const transcriber = createGroqChunkTranscriber({
      now: () => now,
      provider: { transcribe },
    });
    await transcriber.transcribe({
      chunk: { ...chunk, index: 0 },
      chunkCount: 1,
      requestedLanguageMode: "en",
      routingMode: "turbo-first",
      title: "视频",
    });
    now = 2_000;
    await transcriber.transcribe({
      chunk: { ...chunk, index: 0 },
      chunkCount: 1,
      requestedLanguageMode: "en",
      routingMode: "turbo-first",
      title: "视频",
    });
    expect(transcribe.mock.calls.map((call) => call[0].model)).toEqual([
      "whisper-large-v3-turbo",
      "whisper-large-v3",
      "whisper-large-v3",
    ]);

    const authTranscribe = vi.fn(async () => {
      throw new GroqWhisperError("AUTHENTICATION_REQUIRED", "auth", false);
    });
    const authTranscriber = createGroqChunkTranscriber({
      now: () => 1,
      provider: { transcribe: authTranscribe },
    });
    await expect(
      authTranscriber.transcribe({
        chunk,
        chunkCount: 1,
        requestedLanguageMode: "other",
        routingMode: "balanced",
        title: "视频",
      }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(authTranscribe).toHaveBeenCalledOnce();
  });
});
