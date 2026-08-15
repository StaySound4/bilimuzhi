import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import type { ChatRepository } from "../../src/application/chat-repository";
import {
  createBranchPlacement,
  createChatMessage,
  createChatThread,
  createGenerationRun,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  type GenerationRun,
  type ImageAttachment,
} from "../../src/domain";
import { IndexedDbChatRepository } from "../../src/infrastructure/indexeddb/chat-repository";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";

interface SanitizedProviderImage {
  readonly blob: Blob;
  readonly height: number;
  readonly mimeType: "image/jpeg" | "image/png" | "image/webp";
  readonly thumbnailBlob: Blob;
  readonly width: number;
}

interface ProviderImageOutputCommitRepository extends ChatRepository {
  commitAssistantImageOutputs(input: {
    readonly images: readonly SanitizedProviderImage[];
    readonly messageId: string;
    readonly run: GenerationRun;
  }): Promise<readonly ImageAttachment[] | null>;
}

const databaseNames: string[] = [];
const videoKey = "bvid:BV1Q541167Qg:cid:30000000002:p:2";

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

function completedRun(overrides: Partial<GenerationRun> = {}): GenerationRun {
  return createGenerationRun({
    branchId: "branch-provider-image",
    browserSessionId: "browser-provider-image",
    completionSequence: 0,
    contextHash:
      "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    contextRevision: 1,
    conversationRevision: 0,
    createdAt: 10,
    errorCode: null,
    expectedOwnerRevision: 0,
    kind: "chat",
    modelHash:
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    partialOutput: "文字答案必须保留。",
    promptHash:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runId: "run-provider-image",
    runRevision: 2,
    sessionId: "session-provider-image",
    status: "completed",
    stopReason: null,
    subtitleId: "subtitle-provider-image",
    targetId: "thread-provider-image",
    taskId: "task-provider-image",
    updatedAt: 20,
    ...overrides,
  });
}

function sanitizedImage(suffix = "one"): SanitizedProviderImage & {
  readonly base64: string;
  readonly remoteUrl: string;
} {
  return {
    base64: `PRIVATE-BASE64-${suffix}`,
    blob: new Blob([`safe-pixels-${suffix}`], { type: "image/webp" }),
    height: 480,
    mimeType: "image/webp",
    remoteUrl: `https://private-provider.example.test/${suffix}.png?token=secret`,
    thumbnailBlob: new Blob([`safe-thumb-${suffix}`], {
      type: "image/webp",
    }),
    width: 640,
  };
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
    transaction.addEventListener("error", () => reject(transaction.error), {
      once: true,
    });
  });
}

async function readAll<T>(database: IDBDatabase, storeName: string) {
  const transaction = database.transaction(storeName, "readonly");
  const result = await new Promise<T[]>((resolve, reject) => {
    const request = transaction.objectStore(storeName).getAll();
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
  await transactionDone(transaction);
  return result;
}

async function fixture() {
  const name = `muzhi-v12-provider-image-${crypto.randomUUID()}`;
  databaseNames.push(name);
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name,
  });
  const run = completedRun();
  const thread = createChatThread({
    branchId: run.branchId,
    chatThreadId: run.targetId,
    conversationRevision: 0,
    createdAt: 1,
    order: 0,
    sessionId: run.sessionId,
    subtitleId: run.subtitleId,
    title: "Provider 图片输出",
    updatedAt: 20,
  });
  const assistant = createChatMessage({
    chatThreadId: thread.chatThreadId,
    content: run.partialOutput,
    createdAt: 10,
    generationRunId: run.runId,
    messageId: "message-provider-image",
    order: 1,
    role: "assistant",
    status: "complete",
    updatedAt: 20,
  });
  const transaction = database.transaction(
    [
      "branchPlacements",
      "chatMessages",
      "chatThreads",
      "generationRuns",
      "sessions",
      "subtitleBranches",
      "subtitleSnapshots",
    ],
    "readwrite",
  );
  transaction.objectStore("sessions").put(
    createSession({
      activeBranchId: run.branchId,
      createdAt: 1,
      customTitle: false,
      lastActivityAt: 20,
      selectionRevision: 0,
      sessionId: run.sessionId,
      title: "Provider 图片输出",
      updatedAt: 20,
      videoKey,
    }),
  );
  transaction.objectStore("subtitleBranches").put(
    createSubtitleBranch({
      activeSubtitleId: run.subtitleId,
      branchId: run.branchId,
      contextRevision: run.contextRevision,
      createdAt: 1,
      detectedLanguage: null,
      language: "zh-CN",
      lastOpenedAt: 20,
      lastSelectedAt: 20,
      requestedLanguageMode: null,
      sessionId: run.sessionId,
      source: "bilibili",
      title: null,
      updatedAt: 20,
      videoKey,
    }),
  );
  transaction.objectStore("subtitleSnapshots").put(
    createSubtitleSnapshot({
      branchId: run.branchId,
      contentHash: "sha256:provider-image-output",
      createdAt: 1,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "字幕" }],
      sessionId: run.sessionId,
      source: "bilibili",
      status: "active",
      subtitleId: run.subtitleId,
      videoKey,
    }),
  );
  transaction.objectStore("branchPlacements").put(
    createBranchPlacement({
      branchId: run.branchId,
      deletionReason: null,
      location: "workspace",
      order: 0,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: run.sessionId,
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
  );
  transaction.objectStore("chatThreads").put(thread);
  transaction.objectStore("chatMessages").put(assistant);
  transaction.objectStore("generationRuns").put(run);
  await transactionDone(transaction);

  let id = 0;
  const repository = new IndexedDbChatRepository(database, {
    createAttachmentId: () => `provider-output-${++id}`,
    now: () => 30,
  } as unknown as ConstructorParameters<
    typeof IndexedDbChatRepository
  >[1]) as unknown as ProviderImageOutputCommitRepository;
  expect(
    repository.commitAssistantImageOutputs,
    "A9 requires an atomic assistant-message image output commit",
  ).toBeTypeOf("function");
  return { assistant, database, repository, run, thread };
}

describe("v12 Provider image-output IndexedDB ownership (A9/A13)", () => {
  it("atomically binds and persists only sanitized local Blobs to the exact assistant message", async () => {
    const { assistant, database, repository, run } = await fixture();
    const image = sanitizedImage();

    const committed = await repository.commitAssistantImageOutputs({
      images: [image],
      messageId: assistant.messageId,
      run,
    });

    expect(committed).toEqual([
      expect.objectContaining({
        attachmentId: "provider-output-1",
        blob: expect.any(Blob),
        branchId: run.branchId,
        chatThreadId: run.targetId,
        messageId: assistant.messageId,
        mimeType: "image/webp",
        sessionId: run.sessionId,
        subtitleContextRevision: run.contextRevision,
        subtitleId: run.subtitleId,
        thumbnailBlob: expect.any(Blob),
        videoKey,
      }),
    ]);
    const stored = await readAll<Record<string, unknown>>(
      database,
      "attachments",
    );
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(image.remoteUrl);
    expect(JSON.stringify(stored)).not.toContain(image.base64);
    expect(await (stored[0]!.blob as Blob).text()).toBe("safe-pixels-one");
  });

  it.each([
    ["run revision", { runRevision: 3 }],
    ["conversation revision", { conversationRevision: 1 }],
    ["owner revision", { expectedOwnerRevision: 1 }],
    ["context revision", { contextRevision: 2 }],
  ] as const)(
    "rejects a late %s mismatch without adding an attachment",
    async (_label, mismatch) => {
      const { assistant, database, repository, run } = await fixture();
      const lateRun = completedRun(mismatch);

      await expect(
        repository.commitAssistantImageOutputs({
          images: [sanitizedImage("late")],
          messageId: assistant.messageId,
          run: lateRun,
        }),
      ).resolves.toBeNull();

      expect(await readAll(database, "attachments")).toEqual([]);
      expect(await readAll(database, "chatMessages")).toContainEqual(
        expect.objectContaining({
          content: run.partialOutput,
          messageId: assistant.messageId,
        }),
      );
    },
  );

  it("rolls back the whole attachment commit when one output is invalid and preserves assistant text", async () => {
    const { assistant, database, repository, run } = await fixture();
    const invalid = {
      ...sanitizedImage("invalid"),
      blob: new Blob(["<svg onload='alert(1)'/>"], {
        type: "image/svg+xml",
      }),
      mimeType: "image/svg+xml",
    } as unknown as SanitizedProviderImage;

    await expect(
      repository.commitAssistantImageOutputs({
        images: [sanitizedImage("valid-first"), invalid],
        messageId: assistant.messageId,
        run,
      }),
    ).rejects.toMatchObject({
      message: expect.not.stringContaining("svg onload"),
    });

    expect(await readAll(database, "attachments")).toEqual([]);
    expect(await readAll(database, "chatMessages")).toContainEqual(
      expect.objectContaining({
        content: "文字答案必须保留。",
        messageId: assistant.messageId,
      }),
    );
  });

  it("reuses existing message/thread attachment cleanup when an owning conversation is deleted", async () => {
    const { assistant, database, repository, run, thread } = await fixture();
    await repository.commitAssistantImageOutputs({
      images: [sanitizedImage("owned")],
      messageId: assistant.messageId,
      run,
    });
    expect(await readAll(database, "attachments")).toHaveLength(1);

    await repository.deleteThread(thread.chatThreadId);

    expect(await readAll(database, "attachments")).toEqual([]);
    expect(await readAll(database, "chatMessages")).toEqual([]);
  });
});
