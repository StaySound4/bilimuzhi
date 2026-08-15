import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import * as chatRepositoryModule from "../../src/infrastructure/indexeddb/chat-repository";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import {
  createBranchPlacement,
  createChatMessage,
  createChatThread,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
} from "../../src/domain";

interface ProcessedImage {
  readonly blob: Blob;
  readonly height: number;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly thumbnailBlob: Blob;
  readonly width: number;
}

interface AttachmentDraft {
  readonly attachmentId: string;
  readonly blob: Blob;
  readonly branchId: string;
  readonly chatThreadId: string;
  readonly currentTimeMs: number;
  readonly height: number;
  readonly messageId: null | string;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly sessionId: string;
  readonly subtitleContextRevision: number;
  readonly subtitleId: string;
  readonly thumbnailBlob: Blob;
  readonly videoKey: string;
  readonly width: number;
}

interface AttachmentRepository {
  bindToMessage(
    attachmentIds: readonly string[],
    input: { readonly chatThreadId: string; readonly messageId: string },
  ): Promise<readonly AttachmentDraft[]>;
  discardDrafts(attachmentIds: readonly string[]): Promise<void>;
  listByMessage(input: {
    readonly chatThreadId: string;
    readonly messageId: string;
  }): Promise<readonly AttachmentDraft[]>;
  maintainOwnership(): Promise<{
    readonly deletedAttachmentIds: readonly string[];
  }>;
  readStatistics(): Promise<{
    readonly attachmentCount: number;
    readonly blobBytes: number;
    readonly thumbnailBytes: number;
  }>;
  stageImages(input: {
    readonly files: readonly File[];
    readonly owner: Omit<
      AttachmentDraft,
      | "attachmentId"
      | "blob"
      | "height"
      | "messageId"
      | "mimeType"
      | "thumbnailBlob"
      | "width"
    >;
  }): Promise<readonly AttachmentDraft[]>;
}

type AttachmentRepositoryFactory = (
  database: IDBDatabase,
  dependencies: {
    readonly createAttachmentId: () => string;
    readonly processImage: (
      file: File,
      policy: {
        readonly correctOrientation: true;
        readonly maxBytes: number;
        readonly stripMetadata: true;
      },
    ) => Promise<ProcessedImage>;
  },
) => AttachmentRepository;

const databaseNames: string[] = [];

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = fakeIndexedDB.deleteDatabase(name);
          request.addEventListener("success", () => resolve(), { once: true });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        }),
    ),
  );
});

function imageFile(name: string, type: string, bytes: Uint8Array): File {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type,
  }) as File;
  Object.defineProperties(blob, {
    lastModified: { value: 1 },
    name: { value: name },
  });
  return blob;
}

describe("IndexedDB image attachment pipeline", () => {
  it("processes before persistence, records the exact draft owner, binds only after send, and releases discarded drafts", async () => {
    const factory = Reflect.get(
      chatRepositoryModule,
      "createIndexedDbAttachmentRepository",
    ) as unknown as AttachmentRepositoryFactory | undefined;
    expect(factory).toBeTypeOf("function");

    const name = `muzhi-image-attachment-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    const processImage = vi.fn(
      async (
        _file: File,
        policy: Parameters<AttachmentRepositoryFactory>[1]["processImage"] extends (
          file: File,
          policy: infer Policy,
        ) => Promise<ProcessedImage>
          ? Policy
          : never,
      ): Promise<ProcessedImage> => {
        expect(policy).toEqual({
          correctOrientation: true,
          maxBytes: 5 * 1_024 * 1_024,
          stripMetadata: true,
        });
        return {
          blob: new Blob(["safe-pixels-only"], { type: "image/webp" }),
          height: 720,
          mimeType: "image/webp",
          thumbnailBlob: new Blob(["safe-thumbnail"], {
            type: "image/webp",
          }),
          width: 1_280,
        };
      },
    );
    try {
      const repository = factory!(database, {
        createAttachmentId: () => "attachment-staged",
        processImage,
      });
      const drafts = await repository.stageImages({
        files: [
          imageFile(
            "camera.jpg",
            "image/jpeg",
            new TextEncoder().encode("EXIF GPS raw-camera-bytes"),
          ),
        ],
        owner: {
          branchId: "branch-image",
          chatThreadId: "thread-image",
          currentTimeMs: 12_345,
          sessionId: "session-image",
          subtitleContextRevision: 7,
          subtitleId: "subtitle-image",
          videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
        },
      });

      expect(drafts).toEqual([
        expect.objectContaining({
          attachmentId: "attachment-staged",
          blob: expect.any(Blob),
          chatThreadId: "thread-image",
          currentTimeMs: 12_345,
          messageId: null,
          mimeType: "image/webp",
          subtitleContextRevision: 7,
          subtitleId: "subtitle-image",
          thumbnailBlob: expect.any(Blob),
          videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
        }),
      ]);
      expect(await drafts[0].blob.text()).toBe("safe-pixels-only");
      expect(await drafts[0].blob.text()).not.toMatch(/EXIF|GPS|raw-camera/);

      await expect(
        repository.bindToMessage(["attachment-staged"], {
          chatThreadId: "thread-image",
          messageId: "message-image",
        }),
      ).resolves.toEqual([
        expect.objectContaining({ messageId: "message-image" }),
      ]);
      await repository.discardDrafts(["attachment-staged"]);
      const transaction = database.transaction("attachments", "readonly");
      const stored = await new Promise<unknown>((resolve, reject) => {
        const request = transaction
          .objectStore("attachments")
          .get("attachment-staged");
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      expect(stored).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("reloads only the attachments bound to an exact message after the database is reopened", async () => {
    const factory = Reflect.get(
      chatRepositoryModule,
      "createIndexedDbAttachmentRepository",
    ) as unknown as AttachmentRepositoryFactory | undefined;
    expect(factory).toBeTypeOf("function");
    const name = `muzhi-image-reopen-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const dependencies: Parameters<AttachmentRepositoryFactory>[1] = {
      createAttachmentId: () => "attachment-reopened",
      processImage: async () => ({
        blob: new Blob(["persisted-safe-image"], { type: "image/webp" }),
        height: 120,
        mimeType: "image/webp",
        thumbnailBlob: new Blob(["persisted-safe-thumbnail"], {
          type: "image/webp",
        }),
        width: 200,
      }),
    };
    let database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const repository = factory!(database, dependencies);
    const [draft] = await repository.stageImages({
      files: [imageFile("board.png", "image/png", Uint8Array.of(1, 2, 3))],
      owner: {
        branchId: "branch-reopened",
        chatThreadId: "thread-reopened",
        currentTimeMs: 45_678,
        sessionId: "session-reopened",
        subtitleContextRevision: 3,
        subtitleId: "subtitle-reopened",
        videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
      },
    });
    await repository.bindToMessage([draft!.attachmentId], {
      chatThreadId: "thread-reopened",
      messageId: "message-reopened",
    });
    database.close();

    database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    try {
      const reopened = factory!(database, dependencies);
      expect(reopened.listByMessage).toBeTypeOf("function");
      const attachments = await reopened.listByMessage({
        chatThreadId: "thread-reopened",
        messageId: "message-reopened",
      });
      expect(attachments).toEqual([
        expect.objectContaining({
          attachmentId: "attachment-reopened",
          chatThreadId: "thread-reopened",
          currentTimeMs: 45_678,
          messageId: "message-reopened",
          thumbnailBlob: expect.any(Blob),
        }),
      ]);
      expect(await attachments[0]!.thumbnailBlob.text()).toBe(
        "persisted-safe-thumbnail",
      );
      await expect(
        reopened.listByMessage({
          chatThreadId: "another-thread",
          messageId: "message-reopened",
        }),
      ).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });

  it("startup maintenance removes only provable orphans, preserves draft, bound and trash owners, and refreshes statistics", async () => {
    const factory = Reflect.get(
      chatRepositoryModule,
      "createIndexedDbAttachmentRepository",
    ) as unknown as AttachmentRepositoryFactory | undefined;
    expect(factory).toBeTypeOf("function");
    const name = `muzhi-image-maintenance-${crypto.randomUUID()}`;
    databaseNames.push(name);
    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const safeBlob = new Blob(["image"], { type: "image/webp" });
    const safeThumbnail = new Blob(["thumb"], { type: "image/webp" });
    const attachment = (
      attachmentId: string,
      owner: {
        branchId: string;
        chatThreadId: string;
        messageId: string | null;
        sessionId: string;
        subtitleId: string;
      },
    ): AttachmentDraft => ({
      ...owner,
      attachmentId,
      blob: safeBlob,
      currentTimeMs: 1_000,
      height: 10,
      mimeType: "image/webp",
      subtitleContextRevision: 1,
      thumbnailBlob: safeThumbnail,
      videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
      width: 10,
    });
    try {
      const seed = database.transaction(
        [
          "attachments",
          "branchPlacements",
          "chatMessages",
          "chatThreads",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readwrite",
      );
      const sessions = seed.objectStore("sessions");
      const branches = seed.objectStore("subtitleBranches");
      const subtitles = seed.objectStore("subtitleSnapshots");
      const placements = seed.objectStore("branchPlacements");
      const threads = seed.objectStore("chatThreads");
      const messages = seed.objectStore("chatMessages");
      for (const suffix of ["draft", "bound", "trash"] as const) {
        sessions.put(
          createSession({
            activeBranchId: `branch-${suffix}`,
            createdAt: 1,
            customTitle: false,
            lastActivityAt: 1,
            selectionRevision: 1,
            sessionId: `session-${suffix}`,
            title: suffix,
            updatedAt: 1,
            videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
          }),
        );
        branches.put(
          createSubtitleBranch({
            activeSubtitleId: `subtitle-${suffix}`,
            branchId: `branch-${suffix}`,
            contextRevision: 1,
            createdAt: 1,
            detectedLanguage: null,
            language: "zh-CN",
            lastOpenedAt: 1,
            lastSelectedAt: 1,
            requestedLanguageMode: null,
            sessionId: `session-${suffix}`,
            source: "bilibili",
            title: null,
            updatedAt: 1,
            videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
          }),
        );
        subtitles.put(
          createSubtitleSnapshot({
            branchId: `branch-${suffix}`,
            contentHash: `hash-${suffix}`,
            createdAt: 1,
            language: "zh-CN",
            rows: [{ endMs: 1_000, startMs: 0, text: suffix }],
            sessionId: `session-${suffix}`,
            source: "bilibili",
            status: "active",
            subtitleId: `subtitle-${suffix}`,
            videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
          }),
        );
        placements.put(
          createBranchPlacement({
            branchId: `branch-${suffix}`,
            deletionReason: suffix === "trash" ? "user-delete" : null,
            location: suffix === "trash" ? "trash" : "workspace",
            order: 0,
            purgeAfter: suffix === "trash" ? 99_999 : null,
            retentionStartedAt: suffix === "trash" ? 10 : null,
            sessionId: `session-${suffix}`,
            trashedAt: suffix === "trash" ? 10 : null,
            trashOrigin: suffix === "trash" ? "workspace" : null,
            trashOriginFolderId: null,
            trashOriginPathSnapshot: null,
          }),
        );
        threads.put(
          createChatThread({
            branchId: `branch-${suffix}`,
            chatThreadId: `thread-${suffix}`,
            conversationRevision: 0,
            createdAt: 1,
            order: 0,
            sessionId: `session-${suffix}`,
            subtitleId: `subtitle-${suffix}`,
            title: null,
            updatedAt: 1,
          }),
        );
      }
      messages.put(
        createChatMessage({
          chatThreadId: "thread-bound",
          content: "bound",
          createdAt: 1,
          generationRunId: null,
          messageId: "message-bound",
          order: 0,
          role: "user",
          status: "complete",
          updatedAt: 1,
        }),
      );
      messages.put(
        createChatMessage({
          chatThreadId: "thread-trash",
          content: "trash",
          createdAt: 1,
          generationRunId: null,
          messageId: "message-trash",
          order: 0,
          role: "user",
          status: "complete",
          updatedAt: 1,
        }),
      );
      const attachments = seed.objectStore("attachments");
      attachments.put(
        attachment("attachment-draft", {
          branchId: "branch-draft",
          chatThreadId: "thread-draft",
          messageId: null,
          sessionId: "session-draft",
          subtitleId: "subtitle-draft",
        }),
      );
      attachments.put(
        attachment("attachment-bound", {
          branchId: "branch-bound",
          chatThreadId: "thread-bound",
          messageId: "message-bound",
          sessionId: "session-bound",
          subtitleId: "subtitle-bound",
        }),
      );
      attachments.put(
        attachment("attachment-trash", {
          branchId: "branch-trash",
          chatThreadId: "thread-trash",
          messageId: "message-trash",
          sessionId: "session-trash",
          subtitleId: "subtitle-trash",
        }),
      );
      attachments.put(
        attachment("attachment-orphan", {
          branchId: "missing-branch",
          chatThreadId: "missing-thread",
          messageId: "missing-message",
          sessionId: "missing-session",
          subtitleId: "missing-subtitle",
        }),
      );
      await new Promise<void>((resolve, reject) => {
        seed.addEventListener("complete", () => resolve(), { once: true });
        seed.addEventListener("abort", () => reject(seed.error), {
          once: true,
        });
        seed.addEventListener("error", () => reject(seed.error), {
          once: true,
        });
      });

      const repository = factory!(database, {
        createAttachmentId: () => "unused",
        processImage: async () => {
          throw new Error("not used");
        },
      });
      expect(repository.maintainOwnership).toBeTypeOf("function");
      expect(repository.readStatistics).toBeTypeOf("function");
      await expect(repository.readStatistics()).resolves.toEqual({
        attachmentCount: 4,
        blobBytes: 20,
        thumbnailBytes: 20,
      });
      await expect(repository.maintainOwnership()).resolves.toEqual({
        deletedAttachmentIds: ["attachment-orphan"],
      });
      await expect(repository.readStatistics()).resolves.toEqual({
        attachmentCount: 3,
        blobBytes: 15,
        thumbnailBytes: 15,
      });

      const verify = database.transaction("attachments", "readonly");
      const all = await new Promise<AttachmentDraft[]>((resolve, reject) => {
        const request = verify.objectStore("attachments").getAll();
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      expect(all.map((item) => item.attachmentId).sort()).toEqual([
        "attachment-bound",
        "attachment-draft",
        "attachment-trash",
      ]);
    } finally {
      database.close();
    }
  });
});
