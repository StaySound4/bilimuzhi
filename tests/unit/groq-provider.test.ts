import { describe, expect, it, vi } from "vitest";

import { SPEECH_PROMPT_POLICY } from "../../src/application/speech-prompt-policy";
import { createGroqWhisperProvider } from "../../src/infrastructure/asr/groq-provider";

const chunk = Object.freeze({
  bytes: new Uint8Array([1, 2, 3]),
  endMs: 10_000,
  index: 0,
  mimeType: "audio/mpeg",
  startMs: 0,
});

describe("Groq Whisper provider", () => {
  it.each([
    ["zh", "zh"],
    ["en", "en"],
    ["other", null],
    ["mixed", null],
  ] as const)(
    "mode=%s：prompt 走 SPEECH_PROMPT_POLICY，language=%s",
    async (mode, expectedLanguage) => {
      const fetch = vi.fn(async () => ({
        headers: { get: () => null },
        json: async () => ({
          language: "zh",
          segments: [{ end: 1.0, start: 0.0, text: "x" }],
        }),
        ok: true,
        status: 200,
      }));
      const provider = createGroqWhisperProvider({
        apiKey: "groq-secret",
        fetch,
      });
      await provider.transcribe({
        chunk,
        chunkCount: 1,
        model: "whisper-large-v3-turbo",
        requestedLanguageMode: mode,
        title: "视频",
      });
      const call = fetch.mock.calls[0] as unknown as [
        string,
        {
          readonly body: FormData;
        },
      ];
      expect(call[1].body.get("prompt")).toBe(
        SPEECH_PROMPT_POLICY[mode].prompt,
      );
      expect(call[1].body.get("language")).toBe(expectedLanguage);
    },
  );

  it("sends the key only in the header and maps verbose timestamps", async () => {
    const fetch = vi.fn(async () => ({
      headers: { get: () => null },
      json: async () => ({
        language: "zh",
        segments: [{ end: 1.25, start: 0.25, text: " 测试 " }],
      }),
      ok: true,
      status: 200,
    }));
    const provider = createGroqWhisperProvider({
      apiKey: "groq-secret",
      fetch,
    });

    await expect(
      provider.transcribe({
        chunk,
        chunkCount: 1,
        model: "whisper-large-v3-turbo",
        requestedLanguageMode: "zh",
        title: "视频",
      }),
    ).resolves.toEqual({
      detectedLanguage: "zh",
      transcript: {
        kind: "timed",
        rows: [{ endMs: 1_250, startMs: 250, text: "测试" }],
      },
    });
    const call = fetch.mock.calls[0] as unknown as [
      string,
      {
        readonly body: FormData;
        readonly headers: Record<string, string>;
        readonly signal: AbortSignal;
      },
    ];
    expect(call[0]).not.toContain("groq-secret");
    expect(call[1].headers.Authorization).toBe("Bearer groq-secret");
    expect(call[1].body.get("language")).toBe("zh");
    expect(call[1].signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    [401, "AUTHENTICATION_REQUIRED"],
    [403, "PERMISSION_DENIED"],
    [413, "FILE_TOO_LARGE"],
    [429, "RATE_LIMITED"],
  ] as const)(
    "maps HTTP %s without exposing raw provider text",
    async (status, code) => {
      const provider = createGroqWhisperProvider({
        apiKey: "secret",
        fetch: async () => ({
          headers: { get: () => "2" },
          json: async () => ({ error: "raw-secret-detail" }),
          ok: false,
          status,
        }),
      });
      await expect(
        provider.transcribe({
          chunk,
          chunkCount: 1,
          model: "whisper-large-v3",
          requestedLanguageMode: "mixed",
          title: "视频",
        }),
      ).rejects.toMatchObject({ code });
    },
  );

  it("preserves text-only results as untimed instead of creating a fake range", async () => {
    const provider = createGroqWhisperProvider({
      apiKey: "secret",
      fetch: async () => ({
        headers: { get: () => null },
        json: async () => ({ language: "en", text: " plain transcript " }),
        ok: true,
        status: 200,
      }),
    });

    await expect(
      provider.transcribe({
        chunk,
        chunkCount: 1,
        model: "whisper-large-v3",
        requestedLanguageMode: "mixed",
        title: "video",
      }),
    ).resolves.toEqual({
      detectedLanguage: "en",
      transcript: { kind: "untimed", paragraphs: ["plain transcript"] },
    });
  });

  it("times out a stalled request without exposing the key", async () => {
    const provider = createGroqWhisperProvider({
      apiKey: "timeout-secret",
      fetch: async (_url, init) =>
        await new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
      timeoutMs: 5,
    });

    await expect(
      provider.transcribe({
        chunk,
        chunkCount: 1,
        model: "whisper-large-v3",
        requestedLanguageMode: "mixed",
        title: "视频",
      }),
    ).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: "Groq 语音请求超时。",
      retryable: true,
    });
  });
});
