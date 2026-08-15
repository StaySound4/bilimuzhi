import {
  RUNTIME_PROTOCOL_VERSION,
  isRuntimeEvent,
  type ExtensionErrorCode,
  type RuntimeCommand,
  type RuntimeEvent,
  type SubtitleTrackOption,
} from "../application/runtime-contract";
import type { VideoKey } from "../domain";
import {
  createSubtitleFailureEvent,
  isSubtitleRuntimeCommand,
  type SubtitleRuntimeCommand,
} from "../application/subtitle-runtime";

export class ChromeSubtitleRuntimeError extends Error {
  constructor(
    readonly code: ExtensionErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChromeSubtitleRuntimeError";
  }
}

export interface AcquiredSubtitleResult {
  readonly rowCount: number;
  readonly subtitleId: string;
  readonly videoKey: VideoKey;
}

export interface ChromeSubtitleRuntimeClient {
  listTracks(videoKey: VideoKey): Promise<readonly SubtitleTrackOption[]>;
  acquire(videoKey: VideoKey, trackId: string): Promise<AcquiredSubtitleResult>;
}

export interface ChromeSubtitleRuntimeClientDependencies {
  readonly createRequestId: () => string;
}

export type ChromeSubtitleMessageHandler = (
  command: SubtitleRuntimeCommand,
) => Promise<RuntimeEvent | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): ChromeSubtitleRuntimeError {
  return new ChromeSubtitleRuntimeError(
    "INTERNAL_ERROR",
    "扩展字幕响应无效，请重试。",
    false,
  );
}

function assertCorrelatedEvent(
  value: unknown,
  requestId: string,
): RuntimeEvent {
  if (!isRuntimeEvent(value) || value.requestId !== requestId) {
    throw invalidResponse();
  }
  if (value.type === "muzhi.command.failed") {
    throw new ChromeSubtitleRuntimeError(
      value.error.code,
      value.error.message,
      value.error.retryable,
    );
  }
  return value;
}

export function createChromeSubtitleRuntimeClient(
  chromeValue: unknown,
  dependencies: ChromeSubtitleRuntimeClientDependencies = {
    createRequestId: () => globalThis.crypto.randomUUID(),
  },
): ChromeSubtitleRuntimeClient {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  const sendMessage = isRecord(runtime)
    ? (Reflect.get(runtime, "sendMessage") as unknown)
    : null;
  if (!isRecord(runtime) || typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }

  const send = async (command: RuntimeCommand): Promise<RuntimeEvent> => {
    let response: unknown;
    try {
      response = await Reflect.apply(sendMessage, runtime, [command]);
    } catch (error) {
      if (error instanceof ChromeSubtitleRuntimeError) {
        throw error;
      }
      throw new ChromeSubtitleRuntimeError(
        "INTERNAL_ERROR",
        "无法连接扩展字幕后台，请重试。",
        true,
      );
    }
    return assertCorrelatedEvent(response, command.requestId);
  };

  return Object.freeze({
    async acquire(
      videoKey: VideoKey,
      trackId: string,
    ): Promise<AcquiredSubtitleResult> {
      const event = await send({
        payload: { method: "direct", trackId, videoKey },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: dependencies.createRequestId(),
        type: "muzhi.subtitle.acquire",
      });
      if (
        event.type !== "muzhi.subtitle.acquired" ||
        event.payload.videoKey !== videoKey
      ) {
        throw invalidResponse();
      }
      return Object.freeze({ ...event.payload });
    },
    async listTracks(
      videoKey: VideoKey,
    ): Promise<readonly SubtitleTrackOption[]> {
      const event = await send({
        payload: { videoKey },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: dependencies.createRequestId(),
        type: "muzhi.subtitle.tracks.list",
      });
      if (
        event.type !== "muzhi.subtitle.tracks.listed" ||
        event.payload.videoKey !== videoKey
      ) {
        throw invalidResponse();
      }
      return Object.freeze(
        event.payload.tracks.map((track) => Object.freeze({ ...track })),
      );
    },
  });
}

export function installChromeSubtitleRuntimeListener(
  chromeValue: unknown,
  handler: ChromeSubtitleMessageHandler,
): void {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  const onMessage = isRecord(runtime)
    ? (Reflect.get(runtime, "onMessage") as unknown)
    : null;
  const addListener = isRecord(onMessage)
    ? (Reflect.get(onMessage, "addListener") as unknown)
    : null;
  if (!isRecord(onMessage) || typeof addListener !== "function") {
    throw new Error("Chrome runtime message listener is unavailable");
  }

  const listener = (
    message: unknown,
    _sender: unknown,
    sendResponse: (response: unknown) => void,
  ): boolean => {
    if (!isSubtitleRuntimeCommand(message)) {
      return false;
    }
    const command = message;
    void handler(command).then(
      (event) => {
        sendResponse(
          event !== undefined && isRuntimeEvent(event)
            ? event
            : createSubtitleFailureEvent(
                command,
                new Error("Invalid runtime response"),
              ),
        );
      },
      (error: unknown) => {
        sendResponse(createSubtitleFailureEvent(command, error));
      },
    );
    return true;
  };
  Reflect.apply(addListener, onMessage, [listener]);
}
