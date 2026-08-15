import type {
  AudioChunkProcessor,
  PreparedAudioChunk,
} from "../application/asr-contract";
import type { ChromeOffscreenApi } from "./chrome-asr-runtime";
import { createChromeOffscreenSpeechRuntime } from "./chrome-asr-runtime";

const CACHE_NAME = "muzhi-asr-transient-v1";
const MESSAGE_VERSION = 2 as const;
const STATUS_POLL_INTERVAL_MS = 50;
const MAX_CONSECUTIVE_STATUS_FAILURES = 5;

interface ChunkDescriptor {
  readonly cacheUrl: string;
  readonly endMs: number;
  readonly index: number;
  readonly mimeType: string;
  readonly startMs: number;
}

type OffscreenAudioCommand =
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.prepare";
      readonly operationId: string;
      readonly inputCacheUrl: string;
      readonly durationMs: number;
      readonly mimeType: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.cancel";
      readonly operationId: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.release";
      readonly operationId: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.status";
      readonly operationId: string;
    };

type OffscreenAudioEvent =
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.accepted";
      readonly operationId: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.running";
      readonly operationId: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.prepared";
      readonly operationId: string;
      readonly chunks: readonly ChunkDescriptor[];
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.cancelled";
      readonly operationId: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.released";
      readonly operationId: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.failed";
      readonly operationId: string;
      readonly errorCode: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.missing";
      readonly operationId: string;
    }
  | {
      readonly version: typeof MESSAGE_VERSION;
      readonly type: "muzhi.offscreen.audio.progress";
      readonly operationId: string;
      readonly progress: Parameters<
        NonNullable<Parameters<AudioChunkProcessor["prepare"]>[0]["onProgress"]>
      >[0];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommand(value: unknown): value is OffscreenAudioCommand {
  if (
    !isRecord(value) ||
    value.version !== MESSAGE_VERSION ||
    typeof value.operationId !== "string" ||
    value.operationId.length === 0
  ) {
    return false;
  }
  if (
    value.type === "muzhi.offscreen.audio.cancel" ||
    value.type === "muzhi.offscreen.audio.release" ||
    value.type === "muzhi.offscreen.audio.status"
  ) {
    return true;
  }
  return (
    value.type === "muzhi.offscreen.audio.prepare" &&
    typeof value.inputCacheUrl === "string" &&
    value.inputCacheUrl.length > 0 &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs > 0 &&
    typeof value.mimeType === "string" &&
    value.mimeType.length > 0
  );
}

function isProgressEvent(
  value: unknown,
  operationId: string,
): value is Extract<
  OffscreenAudioEvent,
  { type: "muzhi.offscreen.audio.progress" }
> {
  if (
    !isRecord(value) ||
    value.version !== MESSAGE_VERSION ||
    value.type !== "muzhi.offscreen.audio.progress" ||
    value.operationId !== operationId ||
    !isRecord(value.progress)
  ) {
    return false;
  }
  return (
    (value.progress.phase === "loading" ||
      value.progress.phase === "encoding" ||
      value.progress.phase === "reading") &&
    typeof value.progress.completedUnits === "number" &&
    Number.isFinite(value.progress.completedUnits) &&
    value.progress.completedUnits >= 0 &&
    typeof value.progress.totalUnits === "number" &&
    Number.isFinite(value.progress.totalUnits) &&
    value.progress.totalUnits > 0
  );
}

function operationUrl(operationId: string, suffix: string): string {
  return `https://muzhi.invalid/asr/${encodeURIComponent(operationId)}/${suffix}`;
}

function runtimeApi(chromeValue: unknown): Record<string, unknown> {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  if (!isRecord(runtime)) throw new Error("Chrome runtime is unavailable");
  return runtime;
}

async function deleteOperationCache(
  cache: Cache,
  operationId: string,
): Promise<void> {
  const prefix = operationUrl(operationId, "");
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter((request) => request.url.startsWith(prefix))
      .map((request) => cache.delete(request)),
  );
}

export function createChromeOffscreenAudioChunkProcessor(
  chromeValue: unknown,
  offscreen: ChromeOffscreenApi,
  cacheStorage: CacheStorage = globalThis.caches,
): AudioChunkProcessor {
  const runtime = runtimeApi(chromeValue);
  const sendMessage = Reflect.get(runtime, "sendMessage");
  if (typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }
  const documentRuntime = createChromeOffscreenSpeechRuntime(offscreen);
  const onMessage = Reflect.get(runtime, "onMessage");
  const addListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "addListener")
    : null;
  const removeListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "removeListener")
    : null;
  return Object.freeze({
    async prepare(input: Parameters<AudioChunkProcessor["prepare"]>[0]) {
      if (input.signal?.aborted) {
        throw new DOMException(
          "Speech transcription was cancelled",
          "AbortError",
        );
      }
      const operationId = input.operationId;
      if (
        typeof operationId !== "string" ||
        operationId.length === 0 ||
        operationId.length > 128
      ) {
        throw new Error("The audio preparation operation identity is invalid");
      }
      const cache = await cacheStorage.open(CACHE_NAME);
      const inputCacheUrl = operationUrl(operationId, "input");
      let progressWrites: Promise<void> = Promise.resolve();
      const progressListener = (message: unknown): boolean => {
        if (!isProgressEvent(message, operationId)) return false;
        const progress = Object.freeze({ ...message.progress });
        progressWrites = progressWrites.then(async () => {
          await input.onProgress?.(progress);
        });
        return false;
      };
      if (typeof addListener === "function" && input.onProgress) {
        Reflect.apply(addListener, onMessage, [progressListener]);
      }
      await documentRuntime.ensureDocument();
      const abort = (): void => {
        void Promise.resolve()
          .then(() =>
            Reflect.apply(sendMessage, runtime, [
              {
                operationId,
                type: "muzhi.offscreen.audio.cancel",
                version: MESSAGE_VERSION,
              } satisfies OffscreenAudioCommand,
            ]),
          )
          .catch(() => undefined);
      };
      input.signal?.addEventListener("abort", abort, { once: true });
      let consumed = false;
      try {
        const send = async (command: OffscreenAudioCommand): Promise<unknown> =>
          await Reflect.apply(sendMessage, runtime, [command]);
        const readStatus = async (): Promise<OffscreenAudioEvent> => {
          const raw = await send({
            operationId,
            type: "muzhi.offscreen.audio.status",
            version: MESSAGE_VERSION,
          });
          if (
            !isRecord(raw) ||
            raw.version !== MESSAGE_VERSION ||
            raw.operationId !== operationId ||
            (raw.type !== "muzhi.offscreen.audio.running" &&
              raw.type !== "muzhi.offscreen.audio.prepared" &&
              raw.type !== "muzhi.offscreen.audio.failed" &&
              raw.type !== "muzhi.offscreen.audio.missing")
          ) {
            throw new Error(
              "Offscreen audio processing returned invalid status",
            );
          }
          return raw as unknown as OffscreenAudioEvent;
        };
        const start = async (): Promise<void> => {
          await cache.put(
            inputCacheUrl,
            new Response(new Uint8Array(input.bytes), {
              headers: { "content-type": input.mimeType },
            }),
          );
          try {
            const raw = await send({
              durationMs: input.durationMs,
              inputCacheUrl,
              mimeType: input.mimeType,
              operationId,
              type: "muzhi.offscreen.audio.prepare",
              version: MESSAGE_VERSION,
            });
            if (
              !isRecord(raw) ||
              raw.version !== MESSAGE_VERSION ||
              raw.operationId !== operationId ||
              raw.type !== "muzhi.offscreen.audio.accepted"
            ) {
              throw new Error(
                "Offscreen audio processing did not acknowledge the operation",
              );
            }
          } catch {
            // The acknowledgement can be lost while Chrome replaces the
            // sender. The stable operation id lets the next status poll
            // determine whether the Offscreen document accepted the work.
          }
        };
        const waitForNextStatus = async (): Promise<void> => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, STATUS_POLL_INTERVAL_MS);
          });
        };

        let consecutiveStatusFailures = 0;
        let startAttempts = 0;
        let raw: OffscreenAudioEvent | null = null;
        while (raw === null || raw.type !== "muzhi.offscreen.audio.prepared") {
          if (input.signal?.aborted) {
            throw new DOMException(
              "Speech transcription was cancelled",
              "AbortError",
            );
          }
          try {
            raw = await readStatus();
            consecutiveStatusFailures = 0;
          } catch (error) {
            consecutiveStatusFailures += 1;
            if (consecutiveStatusFailures >= MAX_CONSECUTIVE_STATUS_FAILURES) {
              const failure = new Error(
                "Offscreen audio status channel is unavailable",
              ) as Error & { code: string; cause?: unknown };
              failure.code = "ASR_CHUNK_BRIDGE_DISCONNECTED";
              failure.cause = error;
              throw failure;
            }
            await waitForNextStatus();
            continue;
          }
          if (raw.type === "muzhi.offscreen.audio.failed") {
            const failure = new Error(
              "Offscreen audio processing failed",
            ) as Error & {
              code: string;
            };
            failure.code = raw.errorCode;
            throw failure;
          }
          if (raw.type === "muzhi.offscreen.audio.missing") {
            startAttempts += 1;
            if (startAttempts > 3) {
              const failure = new Error(
                "Offscreen audio processing could not be resumed",
              ) as Error & { code: string };
              failure.code = "ASR_CHUNK_BRIDGE_DISCONNECTED";
              throw failure;
            }
            await start();
          }
          if (raw.type !== "muzhi.offscreen.audio.prepared") {
            await waitForNextStatus();
          }
        }
        if (!Array.isArray(raw.chunks)) {
          throw new Error("Offscreen audio processing returned invalid data");
        }
        await progressWrites;
        const prepared: PreparedAudioChunk[] = [];
        for (const descriptor of raw.chunks as readonly ChunkDescriptor[]) {
          const response = await cache.match(descriptor.cacheUrl);
          if (!response)
            throw new Error("Offscreen audio chunk is unavailable");
          prepared.push(
            Object.freeze({
              bytes: new Uint8Array(await response.arrayBuffer()),
              endMs: descriptor.endMs,
              index: descriptor.index,
              mimeType: descriptor.mimeType,
              startMs: descriptor.startMs,
            }),
          );
        }
        consumed = true;
        return Object.freeze(prepared);
      } finally {
        input.signal?.removeEventListener("abort", abort);
        if (typeof removeListener === "function" && input.onProgress) {
          Reflect.apply(removeListener, onMessage, [progressListener]);
        }
        try {
          await Reflect.apply(sendMessage, runtime, [
            {
              operationId,
              type: consumed
                ? "muzhi.offscreen.audio.release"
                : "muzhi.offscreen.audio.cancel",
              version: MESSAGE_VERSION,
            } satisfies OffscreenAudioCommand,
          ]);
        } catch {
          // Cache cleanup below is still authoritative for the transient
          // bytes. A stale in-memory Offscreen record is harmless because a
          // later prepare can explicitly replace it after its cache vanishes.
        }
        await deleteOperationCache(cache, operationId);
      }
    },
  });
}

export function installChromeOffscreenAudioListener(
  chromeValue: unknown,
  processor: AudioChunkProcessor,
  cacheStorage: CacheStorage = globalThis.caches,
): void {
  const runtime = runtimeApi(chromeValue);
  const onMessage = Reflect.get(runtime, "onMessage");
  const addListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "addListener")
    : null;
  if (typeof addListener !== "function") {
    throw new Error("Chrome runtime message listener is unavailable");
  }
  const sendMessage = Reflect.get(runtime, "sendMessage");
  if (typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }
  type AudioJob = {
    readonly controller: AbortController;
    event:
      | Extract<OffscreenAudioEvent, { type: "muzhi.offscreen.audio.running" }>
      | Extract<OffscreenAudioEvent, { type: "muzhi.offscreen.audio.prepared" }>
      | Extract<OffscreenAudioEvent, { type: "muzhi.offscreen.audio.failed" }>;
  };
  const jobs = new Map<string, AudioJob>();
  Reflect.apply(addListener, onMessage, [
    (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: OffscreenAudioEvent) => void,
    ): boolean => {
      if (!isCommand(message)) return false;
      if (message.type === "muzhi.offscreen.audio.cancel") {
        jobs.get(message.operationId)?.controller.abort();
        jobs.delete(message.operationId);
        sendResponse({
          operationId: message.operationId,
          type: "muzhi.offscreen.audio.cancelled",
          version: MESSAGE_VERSION,
        });
        return false;
      }
      if (message.type === "muzhi.offscreen.audio.release") {
        const job = jobs.get(message.operationId);
        if (job?.event.type === "muzhi.offscreen.audio.running") {
          job.controller.abort();
        }
        jobs.delete(message.operationId);
        sendResponse({
          operationId: message.operationId,
          type: "muzhi.offscreen.audio.released",
          version: MESSAGE_VERSION,
        });
        return false;
      }
      if (message.type === "muzhi.offscreen.audio.status") {
        sendResponse(
          jobs.get(message.operationId)?.event ?? {
            operationId: message.operationId,
            type: "muzhi.offscreen.audio.missing",
            version: MESSAGE_VERSION,
          },
        );
        return false;
      }
      const existing = jobs.get(message.operationId);
      if (existing === undefined) {
        const controller = new AbortController();
        const job: AudioJob = {
          controller,
          event: {
            operationId: message.operationId,
            type: "muzhi.offscreen.audio.running",
            version: MESSAGE_VERSION,
          },
        };
        jobs.set(message.operationId, job);
        void (async () => {
          const cache = await cacheStorage.open(CACHE_NAME);
          try {
            const input = await cache.match(message.inputCacheUrl);
            if (!input) throw new Error("Speech audio input is unavailable");
            const chunks = await processor.prepare({
              bytes: new Uint8Array(await input.arrayBuffer()),
              durationMs: message.durationMs,
              mimeType: message.mimeType,
              operationId: message.operationId,
              onProgress: async (progress) => {
                try {
                  await Reflect.apply(sendMessage, runtime, [
                    {
                      operationId: message.operationId,
                      progress: Object.freeze({ ...progress }),
                      type: "muzhi.offscreen.audio.progress",
                      version: MESSAGE_VERSION,
                    } satisfies OffscreenAudioEvent,
                  ]);
                } catch {
                  // Progress is advisory. A restarted Service Worker can
                  // reattach to this stable operation through status polling.
                }
              },
              signal: controller.signal,
            });
            const descriptors: ChunkDescriptor[] = [];
            for (const chunk of chunks) {
              const cacheUrl = operationUrl(
                message.operationId,
                `chunk-${chunk.index}`,
              );
              await cache.put(
                cacheUrl,
                new Response(new Uint8Array(chunk.bytes), {
                  headers: { "content-type": chunk.mimeType },
                }),
              );
              descriptors.push(
                Object.freeze({
                  cacheUrl,
                  endMs: chunk.endMs,
                  index: chunk.index,
                  mimeType: chunk.mimeType,
                  startMs: chunk.startMs,
                }),
              );
            }
            if (jobs.get(message.operationId) === job) {
              job.event = {
                chunks: Object.freeze(descriptors),
                operationId: message.operationId,
                type: "muzhi.offscreen.audio.prepared",
                version: MESSAGE_VERSION,
              };
            }
          } catch (error) {
            if (jobs.get(message.operationId) === job) {
              const code =
                error instanceof DOMException && error.name === "AbortError"
                  ? "CANCELLED"
                  : isRecord(error) &&
                      typeof error.code === "string" &&
                      /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)
                    ? error.code
                    : "ASR_CHUNK_FAILED";
              job.event = {
                errorCode: code,
                operationId: message.operationId,
                type: "muzhi.offscreen.audio.failed",
                version: MESSAGE_VERSION,
              };
            }
          }
        })();
      }
      sendResponse({
        operationId: message.operationId,
        type: "muzhi.offscreen.audio.accepted",
        version: MESSAGE_VERSION,
      });
      return false;
    },
  ]);
}

export { CACHE_NAME as ASR_TRANSIENT_CACHE_NAME };
