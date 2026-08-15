import { describe, expect, it, vi } from "vitest";

import type { GroqWhisperProvider } from "../../src/application/asr-contract";
import { createLazySharedGroqChunkTranscriber } from "../../src/infrastructure/asr/lazy-groq-transcriber";
import { GroqWhisperError } from "../../src/infrastructure/asr/groq-provider";

function transcript(text: string) {
  return {
    detectedLanguage: "zh",
    transcript: {
      kind: "timed" as const,
      rows: [{ endMs: 1_000, startMs: 0, text }],
    },
  };
}

function input(index: number) {
  return {
    chunk: {
      bytes: new Uint8Array([index + 1]),
      endMs: 1_000,
      index,
      mimeType: "audio/mpeg",
      startMs: 0,
    },
    chunkCount: 3,
    requestedLanguageMode: "zh" as const,
    routingMode: "balanced" as const,
    title: "视频",
  };
}

describe("lazy shared Groq chunk transcriber", () => {
  it("keeps each model's rate-limit bucket across chunks instead of recreating it per chunk", async () => {
    let now = 1_000;
    const transcribe = vi
      .fn<GroqWhisperProvider["transcribe"]>()
      .mockRejectedValueOnce(
        new GroqWhisperError("RATE_LIMITED", "limited", true, 60),
      )
      .mockResolvedValueOnce(transcript("fallback"))
      .mockResolvedValueOnce(transcript("still blocked"));
    const createProvider = vi.fn(async () => ({ transcribe }));
    const shared = createLazySharedGroqChunkTranscriber({
      createProvider,
      now: () => now,
    });

    await shared.transcribe(input(0));
    now = 2_000;
    await shared.transcribe(input(2));

    expect(createProvider).toHaveBeenCalledOnce();
    expect(transcribe.mock.calls.map(([request]) => request.model)).toEqual([
      "whisper-large-v3-turbo",
      "whisper-large-v3",
      "whisper-large-v3",
    ]);
  });

  it("re-reads settings after an authentication failure instead of caching a rejected provider forever", async () => {
    const createProvider = vi
      .fn()
      .mockRejectedValueOnce(
        new GroqWhisperError(
          "AUTHENTICATION_REQUIRED",
          "尚未配置 Groq 密钥。",
          false,
        ),
      )
      .mockResolvedValueOnce({
        transcribe: vi.fn(async () => transcript("configured")),
      });
    const shared = createLazySharedGroqChunkTranscriber({
      createProvider,
      now: () => 1_000,
    });

    await expect(shared.transcribe(input(0))).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    await expect(shared.transcribe(input(0))).resolves.toMatchObject({
      transcript: { rows: [{ text: "configured" }] },
    });
    expect(createProvider).toHaveBeenCalledTimes(2);
  });
});
