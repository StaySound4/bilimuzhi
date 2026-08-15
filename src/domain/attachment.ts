import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
  assertPositiveSafeInteger,
} from "./validation";
import { isVideoKey, type VideoKey } from "./video";

export const IMAGE_ATTACHMENT_MAX_COUNT = 6;
export const IMAGE_ATTACHMENT_MAX_BYTES = 5 * 1_024 * 1_024;
export const IMAGE_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1_024 * 1_024;

export const IMAGE_ATTACHMENT_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
] as const);

export type ImageAttachmentMimeType =
  (typeof IMAGE_ATTACHMENT_MIME_TYPES)[number];

/**
 * A locally owned, metadata-free image. `blob` and `thumbnailBlob` never leave
 * the infrastructure boundary except through the explicit provider resolver.
 */
export interface ImageAttachment {
  readonly attachmentId: string;
  readonly blob: Blob;
  readonly branchId: string;
  readonly chatThreadId: string;
  readonly currentTimeMs: number;
  readonly height: number;
  readonly messageId: string | null;
  readonly mimeType: ImageAttachmentMimeType;
  readonly sessionId: string;
  readonly subtitleContextRevision: number;
  readonly subtitleId: string;
  readonly thumbnailBlob: Blob;
  readonly videoKey: VideoKey;
  readonly width: number;
}

export type ImageAttachmentOwner = Pick<
  ImageAttachment,
  | "branchId"
  | "chatThreadId"
  | "currentTimeMs"
  | "sessionId"
  | "subtitleContextRevision"
  | "subtitleId"
  | "videoKey"
>;

export function isImageAttachmentMimeType(
  value: unknown,
): value is ImageAttachmentMimeType {
  return (IMAGE_ATTACHMENT_MIME_TYPES as readonly unknown[]).includes(value);
}

export function createImageAttachment(input: ImageAttachment): ImageAttachment {
  assertNonEmptyString(input.attachmentId, "attachmentId");
  assertNonEmptyString(input.sessionId, "sessionId");
  assertNonEmptyString(input.branchId, "branchId");
  assertNonEmptyString(input.subtitleId, "subtitleId");
  assertNonEmptyString(input.chatThreadId, "chatThreadId");
  if (input.messageId !== null) {
    assertNonEmptyString(input.messageId, "messageId");
  }
  assertPositiveSafeInteger(
    input.subtitleContextRevision,
    "subtitleContextRevision",
  );
  assertNonNegativeSafeInteger(input.currentTimeMs, "currentTimeMs");
  assertPositiveSafeInteger(input.width, "width");
  assertPositiveSafeInteger(input.height, "height");
  if (!isVideoKey(input.videoKey)) {
    throw new DomainValidationError(
      "videoKey",
      "image attachment VideoKey is invalid",
    );
  }
  if (!isImageAttachmentMimeType(input.mimeType)) {
    throw new DomainValidationError(
      "mimeType",
      "image attachment type is unsupported",
    );
  }
  if (!(input.blob instanceof Blob) || input.blob.type !== input.mimeType) {
    throw new DomainValidationError("blob", "image attachment Blob is invalid");
  }
  if (input.blob.size <= 0 || input.blob.size > IMAGE_ATTACHMENT_MAX_BYTES) {
    throw new DomainValidationError(
      "blob",
      "image attachment Blob exceeds the size policy",
    );
  }
  if (
    !(input.thumbnailBlob instanceof Blob) ||
    input.thumbnailBlob.size <= 0 ||
    !isImageAttachmentMimeType(input.thumbnailBlob.type)
  ) {
    throw new DomainValidationError(
      "thumbnailBlob",
      "image attachment thumbnail is invalid",
    );
  }
  return Object.freeze({
    attachmentId: input.attachmentId.trim(),
    blob: input.blob,
    branchId: input.branchId.trim(),
    chatThreadId: input.chatThreadId.trim(),
    currentTimeMs: input.currentTimeMs,
    height: input.height,
    messageId: input.messageId?.trim() ?? null,
    mimeType: input.mimeType,
    sessionId: input.sessionId.trim(),
    subtitleContextRevision: input.subtitleContextRevision,
    subtitleId: input.subtitleId.trim(),
    thumbnailBlob: input.thumbnailBlob,
    videoKey: input.videoKey,
    width: input.width,
  });
}
