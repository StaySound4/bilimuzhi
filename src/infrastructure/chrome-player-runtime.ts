import {
  RUNTIME_PROTOCOL_VERSION,
  isRuntimeEvent,
  type ExtensionErrorCode,
  type RuntimeCommand,
  type RuntimeEvent,
} from "../application/runtime-contract";
import { parseVideoKey, type VideoKey } from "../domain";

export class ChromePlayerRuntimeError extends Error {
  constructor(
    readonly code: ExtensionErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChromePlayerRuntimeError";
  }
}

export type ChromePlayerNavigationResult = "cancelled" | "seeked";

export interface ChromePlayerRuntimeClient {
  navigate(
    videoKey: VideoKey,
    seconds: number,
    canContinue?: () => boolean,
  ): Promise<ChromePlayerNavigationResult>;
  readTime(videoKey: VideoKey): Promise<number>;
}

export interface ChromePlayerRuntimeClientDependencies {
  readonly confirmOpenTarget: (
    confirmation: ChromePlayerOpenTargetConfirmation,
  ) => Promise<boolean>;
  readonly createRequestId: () => string;
}

export interface ChromePlayerOpenTargetConfirmation {
  readonly canonicalUrl: string;
  readonly seconds: number;
  readonly videoKey: VideoKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): ChromePlayerRuntimeError {
  return new ChromePlayerRuntimeError(
    "INTERNAL_ERROR",
    "扩展播放器响应无效，请重试。",
    false,
  );
}

function canonicalSeekUrl(videoKey: VideoKey, seconds: number): string {
  const video = parseVideoKey(videoKey);
  const url = new URL(`https://www.bilibili.com/video/${video.bvid}`);
  if (video.page !== 1) url.searchParams.set("p", String(video.page));
  url.searchParams.set("t", String(seconds));
  return url.href;
}

function assertResponse(value: unknown, requestId: string): RuntimeEvent {
  if (!isRuntimeEvent(value) || value.requestId !== requestId) {
    throw invalidResponse();
  }
  if (value.type === "muzhi.command.failed") {
    throw new ChromePlayerRuntimeError(
      value.error.code,
      value.error.message,
      value.error.retryable,
    );
  }
  return value;
}

export function createChromePlayerRuntimeClient(
  chromeValue: unknown,
  dependencies: ChromePlayerRuntimeClientDependencies,
): ChromePlayerRuntimeClient {
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
    try {
      return assertResponse(
        await Reflect.apply(sendMessage, runtime, [command]),
        command.requestId,
      );
    } catch (error) {
      if (error instanceof ChromePlayerRuntimeError) throw error;
      throw new ChromePlayerRuntimeError(
        "INTERNAL_ERROR",
        "无法连接当前视频播放器，请重试。",
        true,
      );
    }
  };
  const navigate = async (
    videoKey: VideoKey,
    seconds: number,
    canContinue: () => boolean = () => true,
  ): Promise<ChromePlayerNavigationResult> => {
    const command = {
      payload: { seconds, videoKey },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: dependencies.createRequestId(),
      type: "muzhi.video.seek",
    } as const satisfies RuntimeCommand;
    let event: RuntimeEvent;
    try {
      event = await send(command);
    } catch (error) {
      if (
        !(error instanceof ChromePlayerRuntimeError) ||
        error.code !== "VIDEO_NOT_BOUND"
      ) {
        throw error;
      }
      if (!canContinue()) return "cancelled";
      const confirmation = Object.freeze({
        canonicalUrl: canonicalSeekUrl(videoKey, seconds),
        seconds,
        videoKey,
      });
      const confirmed = await dependencies.confirmOpenTarget(confirmation);
      if (!confirmed || !canContinue()) return "cancelled";
      try {
        event = await send(command);
      } catch (error) {
        if (
          error instanceof ChromePlayerRuntimeError &&
          error.code === "VIDEO_NOT_BOUND"
        ) {
          if (!canContinue()) return "cancelled";
          event = await send(command);
        } else {
          throw error;
        }
      }
    }
    if (
      event.type !== "muzhi.video.seeked" ||
      event.payload.videoKey !== videoKey ||
      event.payload.seconds !== seconds
    ) {
      throw invalidResponse();
    }
    return "seeked";
  };
  return Object.freeze({
    navigate,
    async readTime(videoKey: VideoKey): Promise<number> {
      const event = await send({
        payload: { videoKey },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: dependencies.createRequestId(),
        type: "muzhi.video.time.read",
      });
      if (
        event.type !== "muzhi.video.time.reported" ||
        event.payload.videoKey !== videoKey
      ) {
        throw invalidResponse();
      }
      return event.payload.currentTimeMs;
    },
  });
}
