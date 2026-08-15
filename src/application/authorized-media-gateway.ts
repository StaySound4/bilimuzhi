import type { VideoKey, VideoRef } from "../domain";

export type AuthorizedMediaGatewayErrorCode =
  | "VALIDATION_FAILED"
  | "AUTHENTICATION_REQUIRED"
  | "PERMISSION_DENIED"
  | "MEDIA_INCOMPLETE"
  | "MEDIA_URL_EXPIRED"
  | "NETWORK_ERROR"
  | "UNSUPPORTED_CAPABILITY";

export class AuthorizedMediaGatewayError extends Error {
  constructor(
    readonly code: AuthorizedMediaGatewayErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AuthorizedMediaGatewayError";
  }
}

export interface AuthorizedMedia {
  readonly videoKey: VideoKey;
  readonly mediaIdentity: string;
  readonly mimeType: string;
  readonly byteLength: number;
  readonly durationMs: number;
  readonly bytes: Readonly<Uint8Array>;
}

export interface AuthorizedMediaGateway {
  acquireCompleteAudio(video: VideoRef): Promise<AuthorizedMedia>;
}
