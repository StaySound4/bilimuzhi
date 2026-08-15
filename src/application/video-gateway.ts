import type { VideoRef } from "../domain";

export type VideoResolveInput =
  | { kind: "current-tab"; tabId: number }
  | { kind: "identifier"; value: string };

export type CanonicalVideoResolveInput =
  | VideoResolveInput
  | {
      kind: "selection";
      bvid: string;
      cid: number;
      page: number;
    };

export interface CanonicalVideoResolver {
  resolve(input: CanonicalVideoResolveInput): Promise<VideoRef>;
}

export interface VideoGateway {
  resolve(input: VideoResolveInput): Promise<VideoRef>;
}

export type VideoGatewayErrorCode =
  | "VALIDATION_FAILED"
  | "VIDEO_NOT_BOUND"
  | "NETWORK_ERROR"
  | "UNSUPPORTED_CAPABILITY";

export class VideoGatewayError extends Error {
  readonly code: VideoGatewayErrorCode;
  readonly retryable: boolean;

  constructor(code: VideoGatewayErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "VideoGatewayError";
    this.code = code;
    this.retryable = retryable;
  }
}
