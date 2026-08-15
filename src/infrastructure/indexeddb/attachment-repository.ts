import type {
  AttachmentProcessingPolicy,
  AttachmentRepository,
  ProcessedAttachmentImage,
} from "../../application/attachment-repository";
import { StorageError } from "../../application/storage";
import {
  createImageAttachment,
  IMAGE_ATTACHMENT_MAX_BYTES,
  IMAGE_ATTACHMENT_MAX_COUNT,
  IMAGE_ATTACHMENT_MAX_TOTAL_BYTES,
  isImageAttachmentMimeType,
  type ImageAttachment,
} from "../../domain";
import { processImageAttachment } from "../image-attachment-processor";
import { requestResult, transactionDone } from "./idb-requests";

export interface IndexedDbAttachmentRepositoryDependencies {
  readonly createAttachmentId?: () => string;
  readonly processImage?: (
    file: File,
    policy: AttachmentProcessingPolicy,
  ) => Promise<ProcessedAttachmentImage>;
}

function normalizeStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError("Unable to update the Bilimuzhi image attachments");
}

function readAttachment(value: unknown): ImageAttachment | null {
  try {
    return createImageAttachment(value as ImageAttachment);
  } catch {
    return null;
  }
}

function uniqueAttachmentIds(ids: readonly string[]): readonly string[] {
  if (!Array.isArray(ids) || ids.length > IMAGE_ATTACHMENT_MAX_COUNT) {
    throw new StorageError("The Bilimuzhi image attachment selection is invalid");
  }
  const unique = [...new Set(ids)];
  if (
    unique.length !== ids.length ||
    unique.some(
      (id) =>
        typeof id !== "string" ||
        id.length === 0 ||
        id.length > 128 ||
        id !== id.trim() ||
        !/^[A-Za-z0-9._:-]+$/.test(id),
    )
  ) {
    throw new StorageError("The Bilimuzhi image attachment selection is invalid");
  }
  return unique;
}

export class IndexedDbAttachmentRepository implements AttachmentRepository {
  private readonly createAttachmentId: () => string;
  private readonly processImage: NonNullable<
    IndexedDbAttachmentRepositoryDependencies["processImage"]
  >;

  constructor(
    private readonly database: IDBDatabase,
    dependencies: IndexedDbAttachmentRepositoryDependencies = {},
  ) {
    this.createAttachmentId =
      dependencies.createAttachmentId ?? (() => crypto.randomUUID());
    this.processImage = dependencies.processImage ?? processImageAttachment;
  }

  async stageImages(
    input: Parameters<AttachmentRepository["stageImages"]>[0],
  ): Promise<readonly ImageAttachment[]> {
    if (
      !Array.isArray(input.files) ||
      input.files.length === 0 ||
      input.files.length > IMAGE_ATTACHMENT_MAX_COUNT
    ) {
      throw new StorageError("Select between 1 and 6 image attachments");
    }
    const attachments: ImageAttachment[] = [];
    let totalBytes = 0;
    try {
      for (const file of input.files) {
        if (!isImageAttachmentMimeType(file.type)) {
          throw new StorageError(
            "Only PNG, JPEG, and WebP images are supported",
          );
        }
        const processed = await this.processImage(file, {
          correctOrientation: true,
          maxBytes: IMAGE_ATTACHMENT_MAX_BYTES,
          stripMetadata: true,
        });
        totalBytes += processed.blob.size;
        if (totalBytes > IMAGE_ATTACHMENT_MAX_TOTAL_BYTES) {
          throw new StorageError(
            "The processed images exceed the 20 MiB aggregate limit",
          );
        }
        attachments.push(
          createImageAttachment({
            ...input.owner,
            attachmentId: this.createAttachmentId(),
            blob: processed.blob,
            height: processed.height,
            messageId: null,
            mimeType: processed.mimeType,
            thumbnailBlob: processed.thumbnailBlob,
            width: processed.width,
          }),
        );
      }
    } catch (error) {
      throw normalizeStorageError(error);
    }
    if (
      new Set(attachments.map((attachment) => attachment.attachmentId)).size !==
      attachments.length
    ) {
      throw new StorageError(
        "The Bilimuzhi image attachment identifier is invalid",
      );
    }

    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction("attachments", "readwrite");
      done = transactionDone(transaction);
      const store = transaction.objectStore("attachments");
      for (const attachment of attachments) store.add(attachment);
      await done;
      return Object.freeze([...attachments]);
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A failed add may already have aborted the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the public boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async resolveById(attachmentId: string): Promise<ImageAttachment | null> {
    const [id] = uniqueAttachmentIds([attachmentId]);
    try {
      const transaction = this.database.transaction("attachments", "readonly");
      const done = transactionDone(transaction);
      const attachment = readAttachment(
        await requestResult(transaction.objectStore("attachments").get(id)),
      );
      await done;
      return attachment;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async listByMessage(input: {
    readonly chatThreadId: string;
    readonly messageId: string;
  }): Promise<readonly ImageAttachment[]> {
    try {
      const transaction = this.database.transaction("attachments", "readonly");
      const done = transactionDone(transaction);
      const stored = (await requestResult(
        transaction
          .objectStore("attachments")
          .index("byMessageId")
          .getAll(input.messageId),
      )) as readonly unknown[];
      const attachments = stored
        .map(readAttachment)
        .filter(
          (attachment): attachment is ImageAttachment =>
            attachment !== null &&
            attachment.chatThreadId === input.chatThreadId &&
            attachment.messageId === input.messageId,
        )
        .sort((left, right) =>
          left.attachmentId.localeCompare(right.attachmentId),
        );
      await done;
      return Object.freeze(attachments);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async readStatistics(): Promise<{
    readonly attachmentCount: number;
    readonly blobBytes: number;
    readonly thumbnailBytes: number;
  }> {
    try {
      const transaction = this.database.transaction("attachments", "readonly");
      const done = transactionDone(transaction);
      const stored = (await requestResult(
        transaction.objectStore("attachments").getAll(),
      )) as readonly unknown[];
      const attachments = stored
        .map(readAttachment)
        .filter(
          (attachment): attachment is ImageAttachment => attachment !== null,
        );
      await done;
      return Object.freeze({
        attachmentCount: attachments.length,
        blobBytes: attachments.reduce(
          (total, attachment) => total + attachment.blob.size,
          0,
        ),
        thumbnailBytes: attachments.reduce(
          (total, attachment) => total + attachment.thumbnailBlob.size,
          0,
        ),
      });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async maintainOwnership(): Promise<{
    readonly deletedAttachmentIds: readonly string[];
  }> {
    const storeNames = [
      "attachments",
      "branchPlacements",
      "chatMessages",
      "chatThreads",
      "sessions",
      "subtitleBranches",
      "subtitleSnapshots",
    ];
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction(storeNames, "readwrite");
      done = transactionDone(transaction);
      const attachmentStore = transaction.objectStore("attachments");
      const stored = (await requestResult(
        attachmentStore.getAll(),
      )) as readonly unknown[];
      const deletedAttachmentIds: string[] = [];
      for (const value of stored) {
        const attachment = readAttachment(value);
        // Malformed records are not deleted automatically: without a valid
        // owner tuple they cannot be proven orphaned safely.
        if (attachment === null) continue;
        const [session, branch, subtitle, placement, thread] =
          await Promise.all([
            requestResult(
              transaction!.objectStore("sessions").get(attachment.sessionId),
            ),
            requestResult(
              transaction!
                .objectStore("subtitleBranches")
                .get(attachment.branchId),
            ),
            requestResult(
              transaction!
                .objectStore("subtitleSnapshots")
                .get(attachment.subtitleId),
            ),
            requestResult(
              transaction!
                .objectStore("branchPlacements")
                .get(attachment.branchId),
            ),
            requestResult(
              transaction!
                .objectStore("chatThreads")
                .get(attachment.chatThreadId),
            ),
          ]);
        const record = (candidate: unknown): Record<string, unknown> | null =>
          typeof candidate === "object" && candidate !== null
            ? (candidate as Record<string, unknown>)
            : null;
        const sessionRecord = record(session);
        const branchRecord = record(branch);
        const subtitleRecord = record(subtitle);
        const placementRecord = record(placement);
        const threadRecord = record(thread);
        let owned =
          sessionRecord?.sessionId === attachment.sessionId &&
          sessionRecord.activeBranchId === attachment.branchId &&
          branchRecord?.branchId === attachment.branchId &&
          branchRecord.sessionId === attachment.sessionId &&
          branchRecord.activeSubtitleId === attachment.subtitleId &&
          branchRecord.contextRevision === attachment.subtitleContextRevision &&
          subtitleRecord?.subtitleId === attachment.subtitleId &&
          subtitleRecord.sessionId === attachment.sessionId &&
          subtitleRecord.branchId === attachment.branchId &&
          subtitleRecord.status === "active" &&
          placementRecord?.branchId === attachment.branchId &&
          placementRecord.sessionId === attachment.sessionId &&
          threadRecord?.chatThreadId === attachment.chatThreadId &&
          threadRecord.sessionId === attachment.sessionId &&
          threadRecord.branchId === attachment.branchId &&
          threadRecord.subtitleId === attachment.subtitleId;
        if (owned && attachment.messageId !== null) {
          const message = record(
            await requestResult(
              transaction.objectStore("chatMessages").get(attachment.messageId),
            ),
          );
          owned =
            message?.messageId === attachment.messageId &&
            message.chatThreadId === attachment.chatThreadId;
        }
        if (!owned) {
          attachmentStore.delete(attachment.attachmentId);
          deletedAttachmentIds.push(attachment.attachmentId);
        }
      }
      await done;
      deletedAttachmentIds.sort((left, right) => left.localeCompare(right));
      return Object.freeze({
        deletedAttachmentIds: Object.freeze(deletedAttachmentIds),
      });
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A failed request may already have aborted the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the public boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async bindToMessage(
    attachmentIds: readonly string[],
    input: { readonly chatThreadId: string; readonly messageId: string },
  ): Promise<readonly ImageAttachment[]> {
    const ids = uniqueAttachmentIds(attachmentIds);
    if (ids.length === 0) return Object.freeze([]);
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction("attachments", "readwrite");
      done = transactionDone(transaction);
      const store = transaction.objectStore("attachments");
      const bound: ImageAttachment[] = [];
      for (const id of ids) {
        const existing = readAttachment(await requestResult(store.get(id)));
        if (
          existing === null ||
          existing.chatThreadId !== input.chatThreadId ||
          (existing.messageId !== null &&
            existing.messageId !== input.messageId)
        ) {
          throw new StorageError(
            "The Bilimuzhi image attachment owner is no longer authoritative",
          );
        }
        const updated = createImageAttachment({
          ...existing,
          messageId: input.messageId,
        });
        store.put(updated);
        bound.push(updated);
      }
      await done;
      return Object.freeze(bound);
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A failed request may already have aborted the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the public boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async discardDrafts(attachmentIds: readonly string[]): Promise<void> {
    const ids = uniqueAttachmentIds(attachmentIds);
    if (ids.length === 0) return;
    try {
      const transaction = this.database.transaction("attachments", "readwrite");
      const done = transactionDone(transaction);
      const store = transaction.objectStore("attachments");
      for (const id of ids) store.delete(id);
      await done;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }
}

export function createIndexedDbAttachmentRepository(
  database: IDBDatabase,
  dependencies: IndexedDbAttachmentRepositoryDependencies = {},
): AttachmentRepository {
  return new IndexedDbAttachmentRepository(database, dependencies);
}

export function createAttachmentBlobResolver(
  repository: Pick<AttachmentRepository, "resolveById">,
): (attachmentId: string) => Promise<Blob | null> {
  return async (attachmentId) =>
    (await repository.resolveById(attachmentId))?.blob ?? null;
}
