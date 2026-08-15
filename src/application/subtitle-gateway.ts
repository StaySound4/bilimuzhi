import {
  createSubtitleSnapshot,
  type Session,
  type SubtitleRow,
  type SubtitleSnapshot,
  type SubtitleTrackOrigin,
  type VideoRef,
} from "../domain";
export interface DirectSubtitle {
  readonly language: string;
  readonly rows: readonly SubtitleRow[];
  readonly trackOrigin?: SubtitleTrackOrigin;
}

export type SubtitleTrackSource = "official" | "ai";

export interface SubtitleTrackOption {
  readonly language: string;
  readonly name: string;
  readonly source: SubtitleTrackSource;
  readonly trackId: string;
  /**
   * 轨道来源归属（v16 D3）：用户上传 > 官方 CC > AI。
   * 可选字段：旧数据/旧网关无此信息时按 source 推导排序。
   */
  readonly origin?: SubtitleTrackOrigin | null;
}

export interface DirectSubtitleGateway {
  listTracks(
    video: VideoRef,
    options?: { readonly signal?: AbortSignal },
  ): Promise<readonly SubtitleTrackOption[]>;
  acquire(
    video: VideoRef,
    trackId: string,
    options?: { readonly signal?: AbortSignal },
  ): Promise<DirectSubtitle>;
}

export type SubtitleGatewayErrorCode =
  | "VALIDATION_FAILED"
  | "SUBTITLE_NOT_FOUND"
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "CHARGED_CONTENT_UNSUPPORTED"
  | "SUBTITLE_URL_EXPIRED"
  | "NETWORK_ERROR";

export class SubtitleGatewayError extends Error {
  readonly code: SubtitleGatewayErrorCode;
  readonly retryable: boolean;

  constructor(
    code: SubtitleGatewayErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = "SubtitleGatewayError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface DirectSubtitleAcquisitionInput {
  readonly branchId?: string;
  readonly session: Session;
  readonly trackId: string;
  readonly video: VideoRef;
}

export interface DirectSubtitleAcquirerDependencies {
  readonly createSubtitleId: () => string;
  readonly gateway: DirectSubtitleGateway;
  readonly hashRows: (rows: readonly SubtitleRow[]) => Promise<string>;
  readonly now: () => number;
}

export type DirectSubtitleAcquirer = (
  input: DirectSubtitleAcquisitionInput,
) => Promise<SubtitleSnapshot>;

export function createDirectSubtitleAcquirer(
  dependencies: DirectSubtitleAcquirerDependencies,
): DirectSubtitleAcquirer {
  return async ({ branchId, session, trackId, video }) => {
    if (session.videoKey !== video.videoKey) {
      throw new SubtitleGatewayError(
        "VALIDATION_FAILED",
        "The session and subtitle video identities do not match",
      );
    }

    const subtitle = await dependencies.gateway.acquire(video, trackId);
    const contentHash = await dependencies.hashRows(subtitle.rows);
    const subtitleId = dependencies.createSubtitleId();
    return createSubtitleSnapshot({
      branchId: branchId ?? `initial:${subtitleId}`,
      contentHash,
      createdAt: dependencies.now(),
      language: subtitle.language,
      rows: subtitle.rows,
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId,
      trackOrigin: subtitle.trackOrigin,
      videoKey: video.videoKey,
    });
  };
}
