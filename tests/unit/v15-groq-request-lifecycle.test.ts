import { afterEach, describe, expect, it, vi } from "vitest";

import { createGroqWhisperProvider } from "../../src/infrastructure/asr/groq-provider";

const realSetTimeout = globalThis.setTimeout.bind(globalThis);

const chunk = Object.freeze({
  bytes: new Uint8Array([1, 2, 3]),
  endMs: 10_000,
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

function transcriptionInput(signal?: AbortSignal) {
  return {
    chunk,
    chunkCount: 1,
    model: "whisper-large-v3-turbo" as const,
    requestedLanguageMode: "mixed" as const,
    ...(signal === undefined ? {} : { signal }),
    title: "v15 lifecycle fixture",
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("v15 Groq complete request lifecycle (G2/G4)", () => {
  it("times out after response headers when the response body never completes", async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    let bodyWasAborted = false;
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const provider = createGroqWhisperProvider({
      apiKey: "test-only-credential",
      fetch: async (_url, init) => {
        requestSignal = init.signal;
        return {
          headers: { get: () => null },
          json: async () => {
            markBodyStarted();
            return await new Promise<never>((_resolve, reject) => {
              const abort = (): void => {
                bodyWasAborted = true;
                reject(new DOMException("body aborted", "AbortError"));
              };
              if (init.signal.aborted) abort();
              else init.signal.addEventListener("abort", abort, { once: true });
            });
          },
          ok: true,
          status: 200,
        };
      },
      timeoutMs: 50,
    });

    const result = observe(provider.transcribe(transcriptionInput()));
    await bodyStarted;
    await vi.advanceTimersByTimeAsync(50);
    const outcome = await withoutHanging(result);

    expect(outcome).toMatchObject({
      error: {
        code: "NETWORK_ERROR",
        retryable: true,
      },
      kind: "rejected",
    });
    expect(requestSignal?.aborted).toBe(true);
    expect(bodyWasAborted).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain("test-only-credential");
  });

  it("propagates caller cancellation through response-body reading", async () => {
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    let markBodyStarted!: () => void;
    const bodyStarted = new Promise<void>((resolve) => {
      markBodyStarted = resolve;
    });
    const provider = createGroqWhisperProvider({
      apiKey: "test-only-credential",
      fetch: async (_url, init) => {
        requestSignal = init.signal;
        return {
          headers: { get: () => null },
          json: async () => {
            markBodyStarted();
            return await new Promise<never>((_resolve, reject) => {
              const abort = (): void =>
                reject(new DOMException("body aborted", "AbortError"));
              if (init.signal.aborted) abort();
              else init.signal.addEventListener("abort", abort, { once: true });
            });
          },
          ok: true,
          status: 200,
        };
      },
      timeoutMs: 60_000,
    });

    const result = observe(
      provider.transcribe(transcriptionInput(caller.signal)),
    );
    await bodyStarted;
    caller.abort();
    const outcome = await withoutHanging(result);

    expect(outcome).toMatchObject({
      error: { name: "AbortError" },
      kind: "rejected",
    });
    expect(requestSignal?.aborted).toBe(true);
  });
});
