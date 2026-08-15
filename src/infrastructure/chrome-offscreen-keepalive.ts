import type { ChromeOffscreenApi } from "./chrome-asr-runtime";
import { createChromeOffscreenSpeechRuntime } from "./chrome-asr-runtime";

const KEEPALIVE_PROTOCOL_VERSION = 1 as const;
const KEEPALIVE_INTERVAL_MS = 20_000;

type KeepaliveCommand =
  | {
      readonly operationId: string;
      readonly type: "muzhi.offscreen.keepalive.acquire";
      readonly version: typeof KEEPALIVE_PROTOCOL_VERSION;
    }
  | {
      readonly operationId: string;
      readonly type: "muzhi.offscreen.keepalive.release";
      readonly version: typeof KEEPALIVE_PROTOCOL_VERSION;
    };

interface KeepaliveAcknowledgement {
  readonly operationId: string;
  readonly type: "muzhi.offscreen.keepalive.acknowledged";
  readonly version: typeof KEEPALIVE_PROTOCOL_VERSION;
}

interface KeepalivePulse {
  readonly activeOperations: number;
  readonly type: "muzhi.service-worker.keepalive";
  readonly version: typeof KEEPALIVE_PROTOCOL_VERSION;
}

export interface SpeechTaskKeepalive {
  acquire(operationId: string): Promise<() => Promise<void>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function runtimeApi(chromeValue: unknown): Record<string, unknown> {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  if (!isRecord(runtime)) throw new Error("Chrome runtime is unavailable");
  return runtime;
}

function isCommand(value: unknown): value is KeepaliveCommand {
  return (
    isRecord(value) &&
    value.version === KEEPALIVE_PROTOCOL_VERSION &&
    typeof value.operationId === "string" &&
    value.operationId.length > 0 &&
    value.operationId.length <= 128 &&
    (value.type === "muzhi.offscreen.keepalive.acquire" ||
      value.type === "muzhi.offscreen.keepalive.release")
  );
}

function isAcknowledgement(
  value: unknown,
  operationId: string,
): value is KeepaliveAcknowledgement {
  return (
    isRecord(value) &&
    value.version === KEEPALIVE_PROTOCOL_VERSION &&
    value.type === "muzhi.offscreen.keepalive.acknowledged" &&
    value.operationId === operationId
  );
}

export function createChromeOffscreenSpeechTaskKeepalive(
  chromeValue: unknown,
  offscreen: ChromeOffscreenApi,
): SpeechTaskKeepalive {
  const runtime = runtimeApi(chromeValue);
  const sendMessage = Reflect.get(runtime, "sendMessage");
  if (typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }
  const documentRuntime = createChromeOffscreenSpeechRuntime(offscreen);
  const send = async (command: KeepaliveCommand): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await Reflect.apply(sendMessage, runtime, [command]);
        if (isAcknowledgement(response, command.operationId)) return;
        lastError = new Error(
          "Offscreen keepalive returned an invalid response",
        );
      } catch (error) {
        lastError = error;
      }
      await Promise.resolve();
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Offscreen keepalive is unavailable");
  };

  return Object.freeze({
    async acquire(operationId: string) {
      if (
        typeof operationId !== "string" ||
        operationId.length === 0 ||
        operationId.length > 128
      ) {
        throw new Error("The speech keepalive operation identity is invalid");
      }
      await documentRuntime.ensureDocument();
      await send({
        operationId,
        type: "muzhi.offscreen.keepalive.acquire",
        version: KEEPALIVE_PROTOCOL_VERSION,
      });
      let released = false;
      return async (): Promise<void> => {
        if (released) return;
        released = true;
        try {
          await send({
            operationId,
            type: "muzhi.offscreen.keepalive.release",
            version: KEEPALIVE_PROTOCOL_VERSION,
          });
        } catch {
          // A lost release acknowledgement normally still means the idempotent
          // release reached the Offscreen document. The browser also destroys
          // every remaining lease when the extension context is closed.
        }
      };
    },
  });
}

export function installChromeOffscreenSpeechTaskKeepaliveListener(
  chromeValue: unknown,
  intervalMs = KEEPALIVE_INTERVAL_MS,
): void {
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error("The speech keepalive interval is invalid");
  }
  const runtime = runtimeApi(chromeValue);
  const onMessage = Reflect.get(runtime, "onMessage");
  const addListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "addListener")
    : null;
  const sendMessage = Reflect.get(runtime, "sendMessage");
  if (typeof addListener !== "function" || typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }
  const operations = new Set<string>();
  let pulseTimer: ReturnType<typeof setInterval> | null = null;
  const stopPulse = (): void => {
    if (pulseTimer === null) return;
    clearInterval(pulseTimer);
    pulseTimer = null;
  };
  const reconcilePulse = (): void => {
    if (operations.size === 0) {
      stopPulse();
      return;
    }
    if (pulseTimer !== null) return;
    pulseTimer = setInterval(() => {
      void Promise.resolve(
        Reflect.apply(sendMessage, runtime, [
          {
            activeOperations: operations.size,
            type: "muzhi.service-worker.keepalive",
            version: KEEPALIVE_PROTOCOL_VERSION,
          } satisfies KeepalivePulse,
        ]),
      ).catch(() => undefined);
    }, intervalMs);
  };

  Reflect.apply(addListener, onMessage, [
    (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: KeepaliveAcknowledgement) => void,
    ): boolean => {
      if (!isCommand(message)) return false;
      if (message.type === "muzhi.offscreen.keepalive.acquire") {
        operations.add(message.operationId);
      } else {
        operations.delete(message.operationId);
      }
      reconcilePulse();
      sendResponse({
        operationId: message.operationId,
        type: "muzhi.offscreen.keepalive.acknowledged",
        version: KEEPALIVE_PROTOCOL_VERSION,
      });
      return false;
    },
  ]);
}

export {
  KEEPALIVE_INTERVAL_MS as SPEECH_KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_PROTOCOL_VERSION as SPEECH_KEEPALIVE_PROTOCOL_VERSION,
};
