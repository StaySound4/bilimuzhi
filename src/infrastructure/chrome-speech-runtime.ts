import {
  SPEECH_RUNTIME_PROTOCOL_VERSION,
  isSpeechRuntimeCommand,
  safeSpeechRuntimeFailure,
  type SpeechRuntimeCommand,
  type SpeechRuntimeEvent,
} from "../application/asr/speech-runtime";
import type {
  SpeechAcquisitionParameters,
  SpeechAcquisitionRecord,
} from "../application/asr/speech-acquisition-coordinator";
import type { SubtitleAcquisitionOwner } from "../application/subtitle-acquisition-contract";
import type { VideoKey } from "../domain";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ChromeSpeechRuntimeClient {
  active(videoKey: VideoKey): Promise<readonly SpeechAcquisitionRecord[]>;
  start(input: {
    readonly videoKey: VideoKey;
    readonly requestedLanguageMode: SpeechAcquisitionParameters["requestedLanguageMode"];
    readonly routingMode: SpeechAcquisitionParameters["routingMode"];
  }): Promise<SubtitleAcquisitionOwner>;
  status(
    owner: SubtitleAcquisitionOwner,
  ): Promise<SpeechAcquisitionRecord | null>;
  cancel(owner: SubtitleAcquisitionOwner): Promise<boolean>;
}

export type ChromeSpeechMessageHandler = (
  command: SpeechRuntimeCommand,
) => Promise<SpeechRuntimeEvent>;

export class ChromeSpeechRuntimeError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChromeSpeechRuntimeError";
  }
}

function runtimeApi(chromeValue: unknown): Record<string, unknown> {
  const runtime = isRecord(chromeValue)
    ? (Reflect.get(chromeValue, "runtime") as unknown)
    : null;
  if (!isRecord(runtime)) throw new Error("Chrome runtime is unavailable");
  return runtime;
}

function assertEvent(value: unknown, requestId: string): SpeechRuntimeEvent {
  if (
    !isRecord(value) ||
    value.protocolVersion !== SPEECH_RUNTIME_PROTOCOL_VERSION ||
    value.requestId !== requestId ||
    typeof value.type !== "string"
  ) {
    throw new ChromeSpeechRuntimeError(
      "INTERNAL_ERROR",
      "插件后台返回了无效的语音任务状态。",
      false,
    );
  }
  const event = value as unknown as SpeechRuntimeEvent;
  if (event.type === "muzhi.speech.failed") {
    throw new ChromeSpeechRuntimeError(
      event.error.code,
      event.error.message,
      event.error.retryable,
    );
  }
  return event;
}

export function createChromeSpeechRuntimeClient(
  chromeValue: unknown,
  createRequestId: () => string = () => globalThis.crypto.randomUUID(),
): ChromeSpeechRuntimeClient {
  const runtime = runtimeApi(chromeValue);
  const sendMessage = Reflect.get(runtime, "sendMessage");
  if (typeof sendMessage !== "function") {
    throw new Error("Chrome runtime messaging is unavailable");
  }
  const send = async (
    command: SpeechRuntimeCommand,
    transportRetries = 2,
  ): Promise<SpeechRuntimeEvent> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return assertEvent(
          await Reflect.apply(sendMessage, runtime, [command]),
          command.requestId,
        );
      } catch (error) {
        if (error instanceof ChromeSpeechRuntimeError) throw error;
        if (attempt < transportRetries) {
          await Promise.resolve();
          continue;
        }
        throw new ChromeSpeechRuntimeError(
          "INTERNAL_ERROR",
          "无法连接插件后台，请重试。",
          true,
        );
      }
    }
  };
  return Object.freeze({
    async active(videoKey: VideoKey) {
      const event = await send({
        payload: { videoKey },
        protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
        requestId: createRequestId(),
        type: "muzhi.speech.active",
      });
      if (event.type !== "muzhi.speech.active-listed") {
        throw new ChromeSpeechRuntimeError(
          "INTERNAL_ERROR",
          "插件后台未返回运行中的语音任务。",
          false,
        );
      }
      return event.payload.records;
    },
    async start(input: Parameters<ChromeSpeechRuntimeClient["start"]>[0]) {
      const requestId = createRequestId();
      const command = {
        payload: input,
        protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
        requestId,
        type: "muzhi.speech.start",
      } as const;
      let event: SpeechRuntimeEvent;
      try {
        event = await send(command, 0);
      } catch (error) {
        if (!(error instanceof ChromeSpeechRuntimeError) || !error.retryable) {
          throw error;
        }
        try {
          const activeRequestId = createRequestId();
          const activeEvent = await send({
            payload: { videoKey: input.videoKey },
            protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
            requestId: activeRequestId,
            type: "muzhi.speech.active",
          });
          if (activeEvent.type === "muzhi.speech.active-listed") {
            const recovered = activeEvent.payload.records.find(
              (record) =>
                record.owner.taskId === requestId ||
                (record.owner.videoKey === input.videoKey &&
                  record.parameters.requestedLanguageMode ===
                    input.requestedLanguageMode &&
                  record.parameters.routingMode === input.routingMode),
            );
            if (recovered !== undefined) return recovered.owner;
          }
        } catch {
          // Preserve the original transport failure when the short
          // reconciliation query is also unavailable.
        }
        throw error;
      }
      if (event.type !== "muzhi.speech.started") {
        throw new ChromeSpeechRuntimeError(
          "INTERNAL_ERROR",
          "插件后台未能启动语音任务。",
          false,
        );
      }
      return event.payload.owner;
    },
    async status(owner: SubtitleAcquisitionOwner) {
      const event = await send({
        payload: { owner },
        protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
        requestId: createRequestId(),
        type: "muzhi.speech.status",
      });
      if (event.type !== "muzhi.speech.statused") {
        throw new ChromeSpeechRuntimeError(
          "INTERNAL_ERROR",
          "插件后台未返回语音任务状态。",
          false,
        );
      }
      return event.payload.record;
    },
    async cancel(owner: SubtitleAcquisitionOwner) {
      const event = await send({
        payload: { owner },
        protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
        requestId: createRequestId(),
        type: "muzhi.speech.cancel",
      });
      if (event.type !== "muzhi.speech.cancelled") {
        throw new ChromeSpeechRuntimeError(
          "INTERNAL_ERROR",
          "插件后台未能停止语音任务。",
          false,
        );
      }
      return event.payload.cancelled;
    },
  });
}

export function installChromeSpeechRuntimeListener(
  chromeValue: unknown,
  handler: ChromeSpeechMessageHandler,
): void {
  const runtime = runtimeApi(chromeValue);
  const onMessage = Reflect.get(runtime, "onMessage");
  const addListener = isRecord(onMessage)
    ? Reflect.get(onMessage, "addListener")
    : null;
  if (typeof addListener !== "function") {
    throw new Error("Chrome runtime message listener is unavailable");
  }
  Reflect.apply(addListener, onMessage, [
    (
      message: unknown,
      _sender: unknown,
      sendResponse: (response: unknown) => void,
    ): boolean => {
      if (!isSpeechRuntimeCommand(message)) return false;
      void handler(message).then(sendResponse, (error: unknown) =>
        sendResponse(safeSpeechRuntimeFailure(message, error)),
      );
      return true;
    },
  ]);
}
