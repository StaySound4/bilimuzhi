import { describe, expect, it, vi } from "vitest";

import { createGroqWhisperProvider } from "../../src/infrastructure/asr/groq-provider";
import { createGroqChunkTranscriber } from "../../src/infrastructure/asr/groq-transcriber";

const STANDARD = "whisper-large-v3" as const;
const TURBO = "whisper-large-v3-turbo" as const;

const chunk = Object.freeze({
  bytes: new Uint8Array([1, 2, 3]),
  endMs: 4_000,
  index: 0,
  mimeType: "audio/mpeg",
  startMs: 0,
});

type ObservedOutcome =
  | { readonly kind: "fulfilled"; readonly value: unknown }
  | { readonly error: unknown; readonly kind: "rejected" };

function observe(promise: Promise<unknown>): Promise<ObservedOutcome> {
  return promise.then(
    (value) => ({ kind: "fulfilled" as const, value }),
    (error: unknown) => ({ error, kind: "rejected" as const }),
  );
}

function transcriptionInput() {
  return {
    chunk,
    chunkCount: 1,
    requestedLanguageMode: "mixed" as const,
    routingMode: "turbo-first" as const,
    title: "v15 body routing fixture",
  };
}

function timedVerboseJson(text: string) {
  return Object.freeze({
    duration: 4,
    language: "zh",
    segments: Object.freeze([Object.freeze({ end: 4, start: 0, text })]),
    text,
  });
}

function assertSuccessfulFallback(
  outcome: ObservedOutcome,
  models: readonly (FormDataEntryValue | null)[],
  requestCount: number,
  expectedText: string,
): void {
  expect.soft(outcome).not.toMatchObject({
    error: { code: "MALFORMED_RESPONSE", retryable: false },
    kind: "rejected",
  });
  expect.soft(outcome).toMatchObject({
    kind: "fulfilled",
    value: {
      model: STANDARD,
      transcript: {
        kind: "timed",
        rows: [{ endMs: 4_000, startMs: 0, text: expectedText }],
      },
    },
  });
  expect.soft(models).toEqual([TURBO, STANDARD]);
  expect.soft(models.filter((model) => model === TURBO)).toHaveLength(1);
  expect.soft(models.filter((model) => model === STANDARD)).toHaveLength(1);
  expect.soft(requestCount).toBe(2);
}

describe("v15 Groq response-body failure routing (G3)", () => {
  it("switches to the backup model when a successful response header is followed by a body transport interruption", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        headers: { get: () => null },
        json: async () => {
          throw new TypeError("fixture body transport interrupted");
        },
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        headers: { get: () => null },
        json: async () => timedVerboseJson("backup transport timeline"),
        ok: true,
        status: 200,
      });
    const provider = createGroqWhisperProvider({
      apiKey: "fixture-groq-key-not-a-secret",
      fetch,
      timeoutMs: 60_000,
    });
    const transcriber = createGroqChunkTranscriber({
      now: () => 1_000,
      provider,
    });

    const outcome = await observe(transcriber.transcribe(transcriptionInput()));
    const models = fetch.mock.calls.map(([, init]) =>
      (init as { readonly body: FormData }).body.get("model"),
    );

    assertSuccessfulFallback(
      outcome,
      models,
      fetch.mock.calls.length,
      "backup transport timeline",
    );
  });

  it("switches to the backup model for a legal verbose response with no usable timeline", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        headers: { get: () => null },
        json: async () => ({
          duration: 4,
          language: "zh",
          segments: [],
          text: "",
        }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        headers: { get: () => null },
        json: async () => timedVerboseJson("backup empty timeline"),
        ok: true,
        status: 200,
      });
    const provider = createGroqWhisperProvider({
      apiKey: "fixture-groq-key-not-a-secret",
      fetch,
      timeoutMs: 60_000,
    });
    const transcriber = createGroqChunkTranscriber({
      now: () => 1_000,
      provider,
    });

    const outcome = await observe(transcriber.transcribe(transcriptionInput()));
    const models = fetch.mock.calls.map(([, init]) =>
      (init as { readonly body: FormData }).body.get("model"),
    );

    assertSuccessfulFallback(
      outcome,
      models,
      fetch.mock.calls.length,
      "backup empty timeline",
    );
  });
});
