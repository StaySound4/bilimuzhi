import type {
  ImageAttachment,
  ImageAttachmentMimeType,
  ImageAttachmentOwner,
} from "../domain";

export interface ProcessedAttachmentImage {
  readonly blob: Blob;
  readonly height: number;
  readonly mimeType: ImageAttachmentMimeType;
  readonly thumbnailBlob: Blob;
  readonly width: number;
}

export interface AttachmentProcessingPolicy {
  readonly correctOrientation: true;
  readonly maxBytes: number;
  readonly stripMetadata: true;
}

export interface AttachmentRepository {
  bindToMessage(
    attachmentIds: readonly string[],
    input: { readonly chatThreadId: string; readonly messageId: string },
  ): Promise<readonly ImageAttachment[]>;
  discardDrafts(attachmentIds: readonly string[]): Promise<void>;
  listByMessage(input: {
    readonly chatThreadId: string;
    readonly messageId: string;
  }): Promise<readonly ImageAttachment[]>;
  maintainOwnership(): Promise<{
    readonly deletedAttachmentIds: readonly string[];
  }>;
  readStatistics(): Promise<{
    readonly attachmentCount: number;
    readonly blobBytes: number;
    readonly thumbnailBytes: number;
  }>;
  resolveById(attachmentId: string): Promise<ImageAttachment | null>;
  stageImages(input: {
    readonly files: readonly File[];
    readonly owner: ImageAttachmentOwner;
  }): Promise<readonly ImageAttachment[]>;
}

export interface AttachmentTurnBinding {
  readonly attachmentIds: readonly string[];
  readonly owner: Pick<
    ImageAttachmentOwner,
    | "branchId"
    | "chatThreadId"
    | "sessionId"
    | "subtitleContextRevision"
    | "subtitleId"
  >;
}
