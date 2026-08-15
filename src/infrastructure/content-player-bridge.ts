import {
  RUNTIME_PROTOCOL_VERSION,
  isRuntimeCommand,
  type ExtensionErrorCode,
  type RelayedSeekCommand,
  type RuntimeCommand,
  type RuntimeEvent,
  type SeekCommand,
  type SeekDispatchSequence,
  type SeekWatermarkCommand,
} from "../application/runtime-contract";
import { parseVideoKey, type VideoKey } from "../domain";
import { parseBilibiliPageIdentity } from "./bilibili-page-identity";

export interface PlaybackVideo {
  currentTime: number;
  readonly duration: number;
  readonly ended?: boolean;
  readonly hidden?: boolean;
  readonly isConnected?: boolean;
  readonly paused?: boolean;
  addEventListener?: (
    type: "seeked",
    listener: () => void,
    options?: { readonly once?: boolean },
  ) => void;
  getBoundingClientRect?: () => {
    readonly height: number;
    readonly width: number;
  };
  removeEventListener?: (type: "seeked", listener: () => void) => void;
}

export interface ContentPageDocument {
  readonly defaultView?: unknown;
  readonly location: { readonly href: string };
  querySelectorAll(selector: string): Iterable<PlaybackVideo>;
}

type ContentMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | void;

interface PlaybackObservation {
  readonly currentTime: number;
  readonly sample: number;
}

const playbackObservations = new WeakMap<PlaybackVideo, PlaybackObservation>();
let playbackSample = 0;
const SEEK_CONFIRMATION_TIMEOUT_MS = 2_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function currentPageCid(document: ContentPageDocument): number | null {
  const windowValue = document.defaultView;
  if (!isRecord(windowValue)) return null;
  const initialState = Reflect.get(windowValue, "__INITIAL_STATE__");
  if (!isRecord(initialState)) return null;
  const videoData = Reflect.get(initialState, "videoData");
  if (!isRecord(videoData)) return null;
  const directCid = Reflect.get(videoData, "cid");
  if (Number.isSafeInteger(directCid) && Number(directCid) > 0) {
    return Number(directCid);
  }
  const page = parseBilibiliPageIdentity(document.location.href);
  const pages = Reflect.get(videoData, "pages");
  if (page === null || !Array.isArray(pages)) return null;
  const selected = pages.find(
    (candidate) => isRecord(candidate) && candidate.page === page.page,
  );
  const cid = isRecord(selected) ? Reflect.get(selected, "cid") : null;
  return Number.isSafeInteger(cid) && Number(cid) > 0 ? Number(cid) : null;
}

function matchesCurrentPage(
  videoKey: VideoKey,
  document: ContentPageDocument,
): boolean {
  const page = parseBilibiliPageIdentity(document.location.href);
  if (page === null) return false;
  try {
    const video = parseVideoKey(videoKey);
    const observedCid = currentPageCid(document);
    return (
      video.bvid === page.bvid &&
      video.page === page.page &&
      // Chrome content script 运行在隔离世界中，即使页面完全匹配，
      // __INITIAL_STATE__ 等页面全局也可能不可用。
      // CID 在可见时作为强化信号，绝不是必要条件。
      (observedCid === null || video.cid === observedCid)
    );
  } catch {
    return false;
  }
}

function findPlaybackVideo(
  document: ContentPageDocument,
): PlaybackVideo | null {
  const candidates = [...document.querySelectorAll("video")];
  const sample = ++playbackSample;
  let selected: PlaybackVideo | null = null;
  let selectedScore = Number.NEGATIVE_INFINITY;
  for (const [index, video] of candidates.entries()) {
    if (video.isConnected === false || video.hidden === true) continue;
    const hasDuration = Number.isFinite(video.duration) && video.duration > 0;
    const hasTime =
      Number.isFinite(video.currentTime) && video.currentTime >= 0;
    if (!hasDuration && !hasTime) continue;
    const bounds = video.getBoundingClientRect?.();
    if (bounds !== undefined && (bounds.width <= 0 || bounds.height <= 0)) {
      continue;
    }
    const visible =
      bounds === undefined || (bounds.width > 0 && bounds.height > 0);
    const playing = video.paused === false && video.ended !== true;
    const previous = playbackObservations.get(video);
    const advanced =
      previous !== undefined &&
      previous.sample < sample &&
      Math.abs(video.currentTime - previous.currentTime) >= 0.05;
    const score =
      (advanced ? 2_000 : 0) +
      (playing ? 1_000 : 0) +
      (visible ? 100 : -100) +
      (hasDuration ? 20 : 0) +
      (hasTime ? 10 : 0) +
      (video.ended === true ? -50 : 0) +
      index / Math.max(1, candidates.length);
    if (score > selectedScore) {
      selected = video;
      selectedScore = score;
    }
  }
  for (const video of candidates) {
    if (Number.isFinite(video.currentTime) && video.currentTime >= 0) {
      playbackObservations.set(video, {
        currentTime: video.currentTime,
        sample,
      });
    }
  }
  return selected;
}

function failure(
  command: RuntimeCommand,
  code: ExtensionErrorCode,
  message: string,
): RuntimeEvent {
  return {
    error: { code, message, retryable: false },
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    type: "muzhi.command.failed",
  };
}

function isPlayerCommand(
  value: RuntimeCommand,
): value is Extract<
  RuntimeCommand,
  { type: "muzhi.video.seek" | "muzhi.video.time.read" }
> {
  return (
    value.type === "muzhi.video.seek" || value.type === "muzhi.video.time.read"
  );
}

interface ContentPlayerBridgeState {
  listener: ContentMessageListener;
  latestSeekSequence: number | null;
  onMessage: Record<string, unknown>;
}

const CONTENT_PLAYER_BRIDGE_STATES_KEY = Symbol.for(
  "muzhi.content-player-bridge.states.v1",
);

function readInstalledBridgeStates(): WeakMap<
  object,
  ContentPlayerBridgeState
> {
  const existing = Reflect.get(globalThis, CONTENT_PLAYER_BRIDGE_STATES_KEY);
  if (existing instanceof WeakMap) {
    return existing as WeakMap<object, ContentPlayerBridgeState>;
  }
  const states = new WeakMap<object, ContentPlayerBridgeState>();
  Reflect.set(globalThis, CONTENT_PLAYER_BRIDGE_STATES_KEY, states);
  return states;
}

const installedBridgeStates = readInstalledBridgeStates();

function hasSeekDispatchSequence(
  value: unknown,
): value is SeekDispatchSequence {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  const sequence = Reflect.get(value, "sequence");
  return Number.isSafeInteger(sequence) && Number(sequence) > 0;
}

function isRelayedSeekCommand(value: unknown): value is RelayedSeekCommand {
  if (!isRecord(value)) return false;
  const seekDispatch = Reflect.get(value, "seekDispatch");
  const command = { ...value };
  delete command.seekDispatch;
  return (
    isRuntimeCommand(command) &&
    command.type === "muzhi.video.seek" &&
    hasSeekDispatchSequence(seekDispatch)
  );
}

function isSeekWatermarkCommand(value: unknown): value is SeekWatermarkCommand {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.type === "muzhi.video.seek.watermark" &&
    hasSeekDispatchSequence(value.seekDispatch)
  );
}

function seekCommandFrom(value: RelayedSeekCommand | SeekCommand): SeekCommand {
  if (!isRelayedSeekCommand(value)) return value;
  return {
    payload: value.payload,
    protocolVersion: value.protocolVersion,
    requestId: value.requestId,
    type: value.type,
  };
}
export function handleContentPlayerCommand(
  document: ContentPageDocument,
  value: unknown,
): RuntimeEvent | undefined {
  if (!isRuntimeCommand(value) || !isPlayerCommand(value)) return undefined;
  const command = value;
  if (!matchesCurrentPage(command.payload.videoKey, document)) {
    return failure(
      command,
      "VIDEO_NOT_BOUND",
      "当前页面不是目标视频，无法跳转。",
    );
  }
  const video = findPlaybackVideo(document);
  if (video === null) {
    return failure(
      command,
      "UNSUPPORTED_CAPABILITY",
      "当前页面没有可播放的视频。",
    );
  }

  if (command.type === "muzhi.video.time.read") {
    const currentTimeMs = Math.round(video.currentTime * 1_000);
    if (!Number.isSafeInteger(currentTimeMs) || currentTimeMs < 0) {
      return failure(
        command,
        "UNSUPPORTED_CAPABILITY",
        "当前播放器时间不可用。",
      );
    }
    return {
      payload: { currentTimeMs, videoKey: command.payload.videoKey },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.video.time.reported",
    };
  }

  if (
    Number.isFinite(video.duration) &&
    video.duration > 0 &&
    command.payload.seconds > video.duration
  ) {
    return failure(command, "VALIDATION_FAILED", "跳转位置超出视频时长。");
  }
  return failure(
    command,
    "UNSUPPORTED_CAPABILITY",
    "当前播放器无法确认跳转完成。",
  );
}

export function installContentPlayerBridge(
  chromeValue: unknown,
  document: ContentPageDocument,
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
  if (
    !isRecord(runtime) ||
    !isRecord(onMessage) ||
    typeof addListener !== "function"
  ) {
    throw new Error("Chrome 运行时消息监听不可用。");
  }
  const bridgeKey = runtime;
  const existingState = installedBridgeStates.get(bridgeKey);
  if (existingState !== undefined) {
    if (existingState.onMessage === onMessage) return;
    Reflect.apply(addListener, onMessage, [existingState.listener]);
    existingState.onMessage = onMessage;
    return;
  }
  const state = {} as ContentPlayerBridgeState;
  const listener: ContentMessageListener = (message, _sender, sendResponse) => {
    if (isSeekWatermarkCommand(message)) {
      if (
        state.latestSeekSequence === null ||
        message.seekDispatch.sequence > state.latestSeekSequence
      ) {
        state.latestSeekSequence = message.seekDispatch.sequence;
      }
      return false;
    }
    if (
      isRelayedSeekCommand(message) &&
      !matchesCurrentPage(message.payload.videoKey, document)
    ) {
      sendResponse(
        failure(
          seekCommandFrom(message),
          "VIDEO_NOT_BOUND",
          "当前页面不是目标视频，无法跳转。",
        ),
      );
      return false;
    }
    if (
      (isRelayedSeekCommand(message) ||
        (isRuntimeCommand(message) && message.type === "muzhi.video.seek")) &&
      matchesCurrentPage(message.payload.videoKey, document)
    ) {
      const relayedCommand = message;
      const command = seekCommandFrom(relayedCommand);
      const order = isRelayedSeekCommand(relayedCommand)
        ? relayedCommand.seekDispatch.sequence
        : null;
      if (
        (order === null && state.latestSeekSequence !== null) ||
        (order !== null &&
          state.latestSeekSequence !== null &&
          order < state.latestSeekSequence)
      ) {
        sendResponse(
          failure(
            command,
            "TASK_INTERRUPTED",
            "较新的跳转请求已取代当前请求。",
          ),
        );
        return false;
      }
      if (
        order !== null &&
        (state.latestSeekSequence === null || order > state.latestSeekSequence)
      ) {
        state.latestSeekSequence = order;
      }
      const video = findPlaybackVideo(document);
      if (
        video !== null &&
        typeof video.addEventListener === "function" &&
        typeof video.removeEventListener === "function"
      ) {
        if (
          Number.isFinite(video.duration) &&
          video.duration > 0 &&
          command.payload.seconds > video.duration
        ) {
          sendResponse(
            failure(command, "VALIDATION_FAILED", "跳转位置超出视频时长。"),
          );
          return false;
        }
        let settled = false;
        const cleanup = (): void => {
          globalThis.clearTimeout(timeout);
          video.removeEventListener?.("seeked", confirmSeek);
        };
        const settle = (response: RuntimeEvent): void => {
          if (settled) return;
          settled = true;
          cleanup();
          sendResponse(response);
        };
        const confirmSeek = (): void => {
          if (
            !matchesCurrentPage(command.payload.videoKey, document) ||
            video.isConnected === false ||
            findPlaybackVideo(document) !== video ||
            !Number.isFinite(video.currentTime) ||
            Math.abs(video.currentTime - command.payload.seconds) > 0.25
          ) {
            return;
          }
          settle({
            payload: {
              seconds: command.payload.seconds,
              videoKey: command.payload.videoKey,
            },
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            requestId: command.requestId,
            type: "muzhi.video.seeked",
          });
        };
        video.addEventListener("seeked", confirmSeek, { once: true });
        const timeout = globalThis.setTimeout(() => {
          settle(
            failure(
              command,
              "UNSUPPORTED_CAPABILITY",
              "当前播放器未确认请求的跳转。",
            ),
          );
        }, SEEK_CONFIRMATION_TIMEOUT_MS);
        try {
          video.currentTime = command.payload.seconds;
        } catch {
          settle(
            failure(command, "UNSUPPORTED_CAPABILITY", "当前播放器无法跳转。"),
          );
        }
        return true;
      }
    }
    const response = handleContentPlayerCommand(document, message);
    if (response === undefined) return false;
    sendResponse(response);
    return false;
  };
  state.listener = listener;
  state.latestSeekSequence = null;
  state.onMessage = onMessage;
  installedBridgeStates.set(bridgeKey, state);
  Reflect.apply(addListener, onMessage, [listener]);
}
