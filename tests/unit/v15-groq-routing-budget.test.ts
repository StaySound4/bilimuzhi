import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  GroqWhisperModel,
  GroqWhisperProvider,
} from "../../src/application/asr-contract";
import { safeSpeechRuntimeFailure } from "../../src/application/asr/speech-runtime";
import {
  GroqWhisperError,
  createGroqWhisperProvider,
} from "../../src/infrastructure/asr/groq-provider";
import { getGroqRoutingCandidates } from "../../src/infrastructure/asr/groq-routing";
import { createGroqChunkTranscriber } from "../../src/infrastructure/asr/groq-transcriber";

const realSetTimeout = globalThis.setTimeout.bind(globalThis);
const STANDARD = "whisper-large-v3" as const;
const TURBO = "whisper-large-v3-turbo" as const;

const chunk = Object.freeze({
  bytes: new Uint8Array([1]),
  endMs: 60_000,
  index: 0,
  mimeType: "audio/mpeg",
  startMs: 0,
});

type ObservedOutcome =
  | { readonly kind: "fulfilled"; readonly value: unknown }
  | { readonly error: unknown; readonly kind: "rejected" }
  | { readonly kind: "pending" };

function observe(promise: Promise<unknown>): Promise<ObservedOutcome> {
  return promise.then(
    (value) => ({ kind: "fulfilled" as const, value }),
    (error: unknown) => ({ error, kind: "rejected" as const }),
  );
}

async function withoutHanging(
  outcome: Promise<ObservedOutcome>,
): Promise<ObservedOutcome> {
  return await Promise.race([
    outcome,
    new Promise<ObservedOutcome>((resolve) => {
      realSetTimeout(() => resolve({ kind: "pending" }), 100);
    }),
  ]);
}

function success(text = "fixture timeline") {
  return Object.freeze({
    detectedLanguage: "zh",
    transcript: Object.freeze({
      kind: "timed" as const,
      rows: Object.freeze([Object.freeze({ endMs: 1_000, startMs: 0, text })]),
    }),
  });
}

function input(
  routingMode: "balanced" | "standard-first" | "turbo-first" = "balanced",
) {
  return {
    chunk,
    chunkCount: 1,
    requestedLanguageMode: "mixed" as const,
    routingMode,
    title: "v15 routing fixture",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("v15 Groq routing and shared chunk budget (G1-G3)", () => {
  it("alternates cross-mode first choice and keeps speed/accuracy deterministic", () => {
    const firstChoices = (mode: Parameters<typeof input>[0]) =>
      [0, 1, 2, 3].map(
        (chunkIndex) =>
          getGroqRoutingCandidates({
            chunkIndex,
            mode: mode ?? "balanced",
            now: 1_000,
          })[0],
      );

    expect(firstChoices("balanced")).toEqual([
      TURBO,
      STANDARD,
      TURBO,
      STANDARD,
    ]);
    expect(firstChoices("turbo-first")).toEqual([TURBO, TURBO, TURBO, TURBO]);
    expect(firstChoices("standard-first")).toEqual([
      STANDARD,
      STANDARD,
      STANDARD,
      STANDARD,
    ]);
  });

  it("makes at most one request per model and never retries the same model invisibly", async () => {
    const transcribe = vi.fn<GroqWhisperProvider["transcribe"]>(async () => {
      throw new GroqWhisperError(
        "NETWORK_ERROR",
        "safe transport failure",
        true,
      );
    });
    const transcriber = createGroqChunkTranscriber({
      now: () => 1_000,
      provider: { transcribe },
    });

    const outcome = await observe(
      transcriber.transcribe(input("standard-first")),
    );

    expect(outcome).toMatchObject({
      error: { code: "NETWORK_ERROR" },
      kind: "rejected",
    });
    expect(transcribe.mock.calls.map(([request]) => request.model)).toEqual([
      STANDARD,
      TURBO,
    ]);
  });

  it("caps both model attempts to one shared 240 second wall-clock budget", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const models: GroqWhisperModel[] = [];
    const provider: GroqWhisperProvider = {
      transcribe: vi.fn(async (request) => {
        models.push(request.model);
        return await new Promise<never>((_resolve, reject) => {
          const failure = (): void =>
            reject(
              new GroqWhisperError(
                "NETWORK_ERROR",
                "safe timed fixture failure",
                true,
              ),
            );
          const timer = setTimeout(failure, 80_000);
          request.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              failure();
            },
            { once: true },
          );
        });
      }),
    };
    const transcriber = createGroqChunkTranscriber({
      now: () => Date.now(),
      provider,
    });

    const result = observe(transcriber.transcribe(input("standard-first")));
    await vi.advanceTimersByTimeAsync(240_000);
    const outcome = await withoutHanging(result);

    expect(outcome).toMatchObject({
      error: { code: "NETWORK_ERROR" },
      kind: "rejected",
    });
    // 两次模型尝试各 80 秒超时，在预算内完成失败（时钟推进到预算终点）。
    expect(Date.now()).toBe(240_000);
    expect(models).toEqual([STANDARD, TURBO]);
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", false],
    ["PERMISSION_DENIED", false],
    ["MALFORMED_RESPONSE", false],
    ["FILE_TOO_LARGE", false],
  ] as const)(
    "does not switch models for non-replaceable %s outcomes",
    async (code, retryable) => {
      const transcribe = vi.fn<GroqWhisperProvider["transcribe"]>(async () => {
        throw new GroqWhisperError(code, "safe terminal failure", retryable);
      });
      const transcriber = createGroqChunkTranscriber({
        now: () => 1_000,
        provider: { transcribe },
      });

      await expect(
        transcriber.transcribe(input("turbo-first")),
      ).rejects.toMatchObject({ code });
      expect(transcribe.mock.calls.map(([request]) => request.model)).toEqual([
        TURBO,
      ]);
    },
  );

  it.each([
    ["NETWORK_ERROR", 0],
    ["RATE_LIMITED", 17],
  ] as const)(
    "switches once to the other model for eligible %s failures",
    async (code, retryAfterSeconds) => {
      const transcribe = vi
        .fn<GroqWhisperProvider["transcribe"]>()
        .mockRejectedValueOnce(
          new GroqWhisperError(
            code,
            "safe replaceable failure",
            true,
            retryAfterSeconds,
          ),
        )
        .mockResolvedValueOnce(success("backup timeline"));
      const transcriber = createGroqChunkTranscriber({
        now: () => 1_000,
        provider: { transcribe },
      });

      await expect(
        transcriber.transcribe(input("turbo-first")),
      ).resolves.toMatchObject({ model: STANDARD });
      expect(transcribe.mock.calls.map(([request]) => request.model)).toEqual([
        TURBO,
        STANDARD,
      ]);
    },
  );

  it("treats a legal response without a usable timeline as replaceable once", async () => {
    const transcribe = vi
      .fn<GroqWhisperProvider["transcribe"]>()
      .mockResolvedValueOnce({
        detectedLanguage: "zh",
        transcript: { kind: "untimed", paragraphs: ["plain fixture text"] },
      })
      .mockResolvedValueOnce(success("timed backup"));
    const transcriber = createGroqChunkTranscriber({
      now: () => 1_000,
      provider: { transcribe },
    });

    await expect(
      transcriber.transcribe(input("turbo-first")),
    ).resolves.toMatchObject({
      model: STANDARD,
      transcript: { kind: "timed" },
    });
    expect(transcribe.mock.calls.map(([request]) => request.model)).toEqual([
      TURBO,
      STANDARD,
    ]);
  });

  it("routes an HTTP 5xx response to the backup model without a same-model replay", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        headers: { get: () => null },
        json: async () => ({ ignored: true }),
        ok: false,
        status: 503,
      })
      .mockResolvedValueOnce({
        headers: { get: () => null },
        json: async () => ({
          language: "zh",
          segments: [{ end: 1, start: 0, text: "backup timeline" }],
        }),
        ok: true,
        status: 200,
      });
    const provider = createGroqWhisperProvider({
      apiKey: "test-only-credential",
      fetch,
    });
    const transcriber = createGroqChunkTranscriber({
      now: () => 1_000,
      provider,
    });

    await expect(
      transcriber.transcribe(input("turbo-first")),
    ).resolves.toMatchObject({ model: STANDARD });
    expect(
      fetch.mock.calls.map(([, init]) =>
        (init as { readonly body: FormData }).body.get("model"),
      ),
    ).toEqual([TURBO, STANDARD]);
  });

  it("keeps the final runtime failure stable and excludes provider error正文", () => {
    const failure = safeSpeechRuntimeFailure(
      {
        payload: {
          requestedLanguageMode: "mixed",
          routingMode: "balanced",
          videoKey: "bvid:BV1xx411c7mD:cid:30000000099:p:1",
        },
        protocolVersion: 1,
        requestId: "v15-safe-failure",
        type: "muzhi.speech.start",
      },
      Object.assign(new Error("raw-provider-body fixture"), {
        code: "RATE_LIMITED",
      }),
    );

    expect(failure).toMatchObject({
      error: {
        code: "RATE_LIMITED",
        message: "Groq 请求过于频繁，请稍后重试。",
        retryable: true,
      },
      type: "muzhi.speech.failed",
    });
    expect(JSON.stringify(failure)).not.toContain("raw-provider-body");
  });
});
