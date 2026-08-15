import {
  RUNTIME_PROTOCOL_VERSION,
  isRuntimeCommand,
  isRuntimeEvent,
  type ExtensionError,
  type ExtensionErrorCode,
  type RuntimeCommand,
  type RuntimeEvent,
  type SubtitleTrackOption,
} from "./runtime-contract";
import { StorageError } from "./storage";
import {
  SubtitleGatewayError,
  type DirectSubtitleAcquirer,
  type DirectSubtitleGateway,
} from "./subtitle-gateway";
import {
  SubtitleRepositoryError,
  type SubtitleAcquisitionContext,
  type SubtitleRepository,
} from "./subtitle-repository";
import type { BranchSubtitleAcquisitionService } from "./branch-subtitle-acquisition";

export type SubtitleRuntimeCommand = Extract<
  RuntimeCommand,
  { type: "muzhi.subtitle.acquire" | "muzhi.subtitle.tracks.list" }
>;

export interface SubtitleRuntimeHandlerDependencies {
  readonly acquireDirect: DirectSubtitleAcquirer;
  /**
   * Optional while protocol v1 clients are migrated. When present, direct
   * acquisition commits through the owner-correlated Branch transaction.
   */
  readonly branchAcquisition?: BranchSubtitleAcquisitionService;
  readonly gateway: DirectSubtitleGateway;
  readonly repository: SubtitleRepository;
}

export type SubtitleRuntimeHandler = (
  value: unknown,
) => Promise<RuntimeEvent | undefined>;

const SAFE_ERROR_MESSAGES: Readonly<
  Partial<Record<ExtensionErrorCode, string>>
> = Object.freeze({
  AUTHENTICATION_REQUIRED: "请先登录 B 站后再获取字幕。",
  CHARGED_CONTENT_UNSUPPORTED: "当前视频为充电/付费内容，不支持获取字幕。",
  INTERNAL_ERROR: "字幕操作失败，请重试。",
  NETWORK_ERROR:
    "无法读取 B 站字幕。请确认该视频页仍然打开且停留在同一个分 P，然后重试。",
  PERMISSION_DENIED: "当前 B 站账号无权读取该字幕。",
  STORAGE_TRANSACTION_FAILED: "字幕已获取，但无法安全保存，请重试。",
  SUBTITLE_NOT_FOUND: "该视频没有可用的 B 站字幕。",
  SUBTITLE_REPLACEMENT_REQUIRED: "当前会话已有活动字幕，需要使用替换流程。",
  SUBTITLE_URL_EXPIRED: "字幕地址已过期，请重试。",
  UNSUPPORTED_CAPABILITY: "当前字幕获取方式尚不可用。",
  VALIDATION_FAILED: "字幕请求无效。",
  VIDEO_NOT_BOUND: "请先绑定视频会话。",
});

function isExtensionErrorCode(value: string): value is ExtensionErrorCode {
  return Object.hasOwn(SAFE_ERROR_MESSAGES, value);
}

function normalizeRuntimeError(error: unknown): ExtensionError {
  if (
    error instanceof SubtitleGatewayError ||
    error instanceof SubtitleRepositoryError ||
    error instanceof StorageError
  ) {
    const code = isExtensionErrorCode(error.code)
      ? error.code
      : "INTERNAL_ERROR";
    return Object.freeze({
      code,
      message: SAFE_ERROR_MESSAGES[code] ?? SAFE_ERROR_MESSAGES.INTERNAL_ERROR!,
      retryable: code === "INTERNAL_ERROR" ? false : error.retryable,
    });
  }
  return Object.freeze({
    code: "INTERNAL_ERROR",
    message: SAFE_ERROR_MESSAGES.INTERNAL_ERROR!,
    retryable: false,
  });
}

export function createSubtitleFailureEvent(
  command: SubtitleRuntimeCommand,
  error: unknown,
): RuntimeEvent {
  return Object.freeze({
    error: normalizeRuntimeError(error),
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    type: "muzhi.command.failed",
  });
}

export function isSubtitleRuntimeCommand(
  value: unknown,
): value is SubtitleRuntimeCommand {
  return (
    isRuntimeCommand(value) &&
    (value.type === "muzhi.subtitle.tracks.list" ||
      value.type === "muzhi.subtitle.acquire")
  );
}

async function readContext(
  repository: SubtitleRepository,
  command: SubtitleRuntimeCommand,
): Promise<SubtitleAcquisitionContext> {
  const context = await repository.readAcquisitionContext(
    command.payload.videoKey,
  );
  if (context === null) {
    throw new SubtitleRepositoryError(
      "VIDEO_NOT_BOUND",
      "The requested video session is not bound",
    );
  }
  return context;
}

function sanitizeTracks(
  tracks: readonly SubtitleTrackOption[],
): readonly SubtitleTrackOption[] {
  return Object.freeze(
    tracks.map(({ language, name, source, trackId }) =>
      Object.freeze({ language, name, source, trackId }),
    ),
  );
}

function validatedEvent(event: RuntimeEvent): RuntimeEvent {
  if (!isRuntimeEvent(event)) {
    throw new SubtitleGatewayError(
      "VALIDATION_FAILED",
      "The subtitle runtime result is invalid",
    );
  }
  return Object.freeze(event);
}

type DirectSubtitleRuntimeCommand = SubtitleRuntimeCommand & {
  readonly payload: { readonly method: "direct"; readonly trackId: string };
};

async function acquireAndCommit(
  dependencies: SubtitleRuntimeHandlerDependencies,
  context: SubtitleAcquisitionContext,
  command: DirectSubtitleRuntimeCommand,
  operationRevision: number,
) {
  if (dependencies.branchAcquisition) {
    const handle = dependencies.branchAcquisition.startDirectOwned
      ? await dependencies.branchAcquisition.startDirectOwned({
          operationRevision,
          requestId: command.requestId,
          taskId: command.requestId,
          trackId: command.payload.trackId,
          videoKey: context.video.videoKey,
        })
      : await dependencies.branchAcquisition.startDirect({
          trackId: command.payload.trackId,
          videoKey: context.video.videoKey,
        });
    return handle.result;
  }
  const staged = await dependencies.acquireDirect({
    session: context.session,
    trackId: command.payload.trackId,
    video: context.video,
  });
  return dependencies.repository.commitInitialAcquisition(staged);
}

export function createSubtitleRuntimeHandler(
  dependencies: SubtitleRuntimeHandlerDependencies,
): SubtitleRuntimeHandler {
  let operationRevision = 0;
  const requestRevisions = new Map<string, number>();
  return async (value) => {
    if (!isSubtitleRuntimeCommand(value)) {
      return undefined;
    }
    const command = value;
    try {
      const context = await readContext(dependencies.repository, command);
      if (command.type === "muzhi.subtitle.tracks.list") {
        const tracks = sanitizeTracks(
          await dependencies.gateway.listTracks(context.video),
        );
        return validatedEvent({
          payload: {
            tracks,
            videoKey: context.video.videoKey,
          },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          type: "muzhi.subtitle.tracks.listed",
        });
      }
      if (command.payload.method !== "direct") {
        throw new SubtitleGatewayError(
          "VALIDATION_FAILED",
          "Speech acquisition is not available in this runtime slice",
        );
      }
      const committed = await acquireAndCommit(
        dependencies,
        context,
        command as DirectSubtitleRuntimeCommand,
        requestRevisions.get(command.requestId) ??
          (() => {
            const revision = ++operationRevision;
            requestRevisions.set(command.requestId, revision);
            if (requestRevisions.size > 128) {
              const oldest = requestRevisions.keys().next().value;
              if (oldest !== undefined) requestRevisions.delete(oldest);
            }
            return revision;
          })(),
      );
      return validatedEvent({
        payload: {
          rowCount: committed.subtitle.rows.length,
          subtitleId: committed.subtitle.subtitleId,
          videoKey: committed.subtitle.videoKey,
        },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.subtitle.acquired",
      });
    } catch (error) {
      return createSubtitleFailureEvent(command, error);
    }
  };
}
