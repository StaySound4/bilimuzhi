import {
  EXTENSION_ERROR_CODES,
  type ExtensionErrorCode,
  type SubtitleTrackOption,
} from "./runtime-contract";
import type { VideoKey } from "../domain";

export interface SubtitleAcquisitionResult {
  readonly rowCount: number;
  readonly subtitleId: string;
  readonly videoKey: VideoKey;
}

export interface SubtitleAcquisitionRuntime {
  listTracks(videoKey: VideoKey): Promise<readonly SubtitleTrackOption[]>;
  acquire(
    videoKey: VideoKey,
    trackId: string,
  ): Promise<SubtitleAcquisitionResult>;
}

export type SubtitleAcquisitionPhase =
  "idle" | "finding" | "selecting" | "acquiring" | "error" | "success";

export interface SubtitleAcquisitionError {
  readonly code: ExtensionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export interface SubtitleAcquisitionState {
  readonly error?: SubtitleAcquisitionError;
  readonly phase: SubtitleAcquisitionPhase;
  readonly retry?: "acquire" | "discover";
  readonly rowCount?: number;
  readonly selectedTrackId: string | null;
  readonly tracks: readonly SubtitleTrackOption[];
}

export interface SubtitleAcquisitionCoordinatorDependencies {
  readonly onChange?: (state: SubtitleAcquisitionState) => void;
  readonly runtime: SubtitleAcquisitionRuntime;
}

export interface SubtitleAcquisitionCoordinator {
  snapshot(): SubtitleAcquisitionState;
  discover(videoKey: VideoKey): Promise<SubtitleAcquisitionState>;
  select(trackId: string): SubtitleAcquisitionState;
  acquire(videoKey: VideoKey): Promise<SubtitleAcquisitionState>;
  cancel(): SubtitleAcquisitionState;
  reset(): SubtitleAcquisitionState;
}

const errorCodes = new Set<string>(EXTENSION_ERROR_CODES);

const subtitleErrorMessages: Readonly<
  Partial<Record<ExtensionErrorCode, string>>
> = Object.freeze({
  AUTHENTICATION_REQUIRED: "需要先登录 Bilibili，再重新查找字幕。",
  CHARGED_CONTENT_UNSUPPORTED: "当前视频为充电/付费内容，不支持获取字幕。",
  INTERNAL_ERROR: "字幕操作失败，请重试。",
  NETWORK_ERROR: "网络请求失败，请稍后重试。",
  PERMISSION_DENIED: "当前 Bilibili 账号无权访问该字幕轨道。",
  STORAGE_TRANSACTION_FAILED:
    "字幕未能安全保存，本地工作区没有发生变化。请重试。",
  SUBTITLE_NOT_FOUND: "当前精确视频没有找到可用的 B 站字幕。",
  SUBTITLE_REPLACEMENT_REQUIRED: "当前字幕上下文已变化，请重新查找轨道后再试。",
  SUBTITLE_URL_EXPIRED: "字幕地址已过期，请重新查找轨道后再试。",
  TASK_ALREADY_RUNNING: "相同字幕任务正在进行，请稍候。",
  TASK_INTERRUPTED: "字幕任务已中断，请重新开始。",
  TIMEOUT: "字幕请求超时，请稍后重试。",
  VALIDATION_FAILED: "字幕数据与当前视频不一致，已停止保存。",
  VIDEO_NOT_BOUND: "当前页面尚未同步到精确视频，请先同步当前页面。",
});

function freezeTracks(
  tracks: readonly SubtitleTrackOption[],
): readonly SubtitleTrackOption[] {
  return Object.freeze(tracks.map((track) => Object.freeze({ ...track })));
}

function createState(
  input: Omit<SubtitleAcquisitionState, "tracks"> & {
    readonly tracks?: readonly SubtitleTrackOption[];
  },
): SubtitleAcquisitionState {
  return Object.freeze({
    ...input,
    tracks: freezeTracks(input.tracks ?? []),
  });
}

function safeError(error: unknown): SubtitleAcquisitionError {
  if (typeof error === "object" && error !== null) {
    const code = Reflect.get(error, "code") as unknown;
    const message = Reflect.get(error, "message") as unknown;
    const retryable = Reflect.get(error, "retryable") as unknown;
    if (
      typeof code === "string" &&
      errorCodes.has(code) &&
      typeof message === "string" &&
      message.trim().length > 0 &&
      typeof retryable === "boolean"
    ) {
      return Object.freeze({
        code: code as ExtensionErrorCode,
        message:
          subtitleErrorMessages[code as ExtensionErrorCode] ?? message.trim(),
        retryable,
      });
    }
  }
  return Object.freeze({
    code: "INTERNAL_ERROR",
    message: "字幕操作失败，请重试。",
    retryable: false,
  });
}

class DefaultSubtitleAcquisitionCoordinator implements SubtitleAcquisitionCoordinator {
  private state = createState({
    phase: "idle",
    selectedTrackId: null,
  });
  private activeVideoKey: VideoKey | null = null;
  private operationRevision = 0;
  private inFlight: {
    readonly key: string;
    readonly promise: Promise<SubtitleAcquisitionState>;
  } | null = null;

  constructor(
    private readonly dependencies: SubtitleAcquisitionCoordinatorDependencies,
  ) {}

  private publish(state: SubtitleAcquisitionState): SubtitleAcquisitionState {
    this.state = state;
    this.dependencies.onChange?.(state);
    return state;
  }

  private publishIfCurrent(
    revision: number,
    state: SubtitleAcquisitionState,
  ): SubtitleAcquisitionState {
    return revision === this.operationRevision
      ? this.publish(state)
      : this.state;
  }

  snapshot(): SubtitleAcquisitionState {
    return this.state;
  }

  discover(videoKey: VideoKey): Promise<SubtitleAcquisitionState> {
    const operationKey = `discover:${videoKey}`;
    if (this.inFlight?.key === operationKey) {
      return this.inFlight.promise;
    }
    const revision = ++this.operationRevision;
    this.inFlight = null;
    this.activeVideoKey = videoKey;
    const operation = (async (): Promise<SubtitleAcquisitionState> => {
      this.publish(createState({ phase: "finding", selectedTrackId: null }));
      try {
        const tracks = await this.dependencies.runtime.listTracks(videoKey);
        if (tracks.length === 0) {
          return this.publishIfCurrent(
            revision,
            createState({
              error: {
                code: "SUBTITLE_NOT_FOUND",
                message: "该视频没有可用的 B 站字幕。",
                retryable: false,
              },
              phase: "error",
              retry: "discover",
              selectedTrackId: null,
            }),
          );
        }
        return this.publishIfCurrent(
          revision,
          createState({
            phase: "selecting",
            selectedTrackId: tracks[0].trackId,
            tracks,
          }),
        );
      } catch (error) {
        return this.publishIfCurrent(
          revision,
          createState({
            error: safeError(error),
            phase: "error",
            retry: "discover",
            selectedTrackId: null,
          }),
        );
      }
    })();
    const inFlight = { key: operationKey, promise: operation };
    this.inFlight = inFlight;
    void operation.finally(() => {
      if (this.inFlight === inFlight) {
        this.inFlight = null;
      }
    });
    return operation;
  }

  select(trackId: string): SubtitleAcquisitionState {
    if (
      this.state.phase !== "selecting" ||
      !this.state.tracks.some((track) => track.trackId === trackId)
    ) {
      return this.state;
    }
    return this.publish(
      createState({
        phase: "selecting",
        selectedTrackId: trackId,
        tracks: this.state.tracks,
      }),
    );
  }

  acquire(videoKey: VideoKey): Promise<SubtitleAcquisitionState> {
    const selectedTrackId = this.state.selectedTrackId;
    if (
      this.activeVideoKey !== videoKey ||
      selectedTrackId === null ||
      !this.state.tracks.some((track) => track.trackId === selectedTrackId)
    ) {
      return Promise.resolve(this.state);
    }
    const operationKey = `acquire:${videoKey}:${selectedTrackId}`;
    if (this.inFlight?.key === operationKey) {
      return this.inFlight.promise;
    }
    const revision = ++this.operationRevision;
    this.inFlight = null;
    const tracks = this.state.tracks;
    const operation = (async (): Promise<SubtitleAcquisitionState> => {
      this.publish(
        createState({
          phase: "acquiring",
          selectedTrackId,
          tracks,
        }),
      );
      try {
        const result = await this.dependencies.runtime.acquire(
          videoKey,
          selectedTrackId,
        );
        return this.publishIfCurrent(
          revision,
          createState({
            phase: "success",
            rowCount: result.rowCount,
            selectedTrackId,
            tracks,
          }),
        );
      } catch (error) {
        return this.publishIfCurrent(
          revision,
          createState({
            error: safeError(error),
            phase: "error",
            retry: "acquire",
            selectedTrackId,
            tracks,
          }),
        );
      }
    })();
    const inFlight = { key: operationKey, promise: operation };
    this.inFlight = inFlight;
    void operation.finally(() => {
      if (this.inFlight === inFlight) {
        this.inFlight = null;
      }
    });
    return operation;
  }

  cancel(): SubtitleAcquisitionState {
    if (this.inFlight !== null) {
      return this.state;
    }
    return this.reset();
  }

  reset(): SubtitleAcquisitionState {
    this.operationRevision += 1;
    this.inFlight = null;
    this.activeVideoKey = null;
    return this.publish(createState({ phase: "idle", selectedTrackId: null }));
  }
}

export function createSubtitleAcquisitionCoordinator(
  dependencies: SubtitleAcquisitionCoordinatorDependencies,
): SubtitleAcquisitionCoordinator {
  return new DefaultSubtitleAcquisitionCoordinator(dependencies);
}
