import { afterEach, describe, expect, it, vi } from "vitest";

import {
  IDBObjectStore as FakeIDBObjectStore,
  indexedDB as fakeIndexedDB,
} from "fake-indexeddb";

import {
  createSubtitleSnapshot as createDomainSubtitleSnapshot,
  createVideoRef,
  type CreateSubtitleSnapshotInput,
  type Session,
  type SubtitleSnapshot,
} from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";

const databaseNames: string[] = [];

function createSubtitleSnapshot(
  input: Omit<CreateSubtitleSnapshotInput, "branchId"> & {
    readonly branchId?: string;
  },
): SubtitleSnapshot {
  return createDomainSubtitleSnapshot({
    ...input,
    branchId: input.branchId ?? `branch:${input.subtitleId}`,
  });
}

function createDatabaseName(): string {
  const name = `muzhi-subtitle-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
    transaction.addEventListener("error", () => reject(transaction.error), {
      once: true,
    });
  });
}

async function readSubtitleState(
  database: IDBDatabase,
  sessionId: string,
): Promise<{
  readonly session: Session | undefined;
  readonly snapshots: readonly SubtitleSnapshot[];
}> {
  const transaction = database.transaction(
    ["sessions", "subtitleSnapshots"],
    "readonly",
  );
  const [session, snapshots] = await Promise.all([
    requestResult(transaction.objectStore("sessions").get(sessionId)),
    requestResult(transaction.objectStore("subtitleSnapshots").getAll()),
  ]);
  await transactionDone(transaction);
  return {
    session: session as Session | undefined,
    snapshots: snapshots as readonly SubtitleSnapshot[],
  };
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("IndexedDbSubtitleRepository", () => {
  it("reads the authoritative bound context and commits the first subtitle atomically", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      aid: 88_000_099,
      bvid: "BV1xx411c7mD",
      canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      cid: 30_000_000_099,
      page: 1,
      title: "字幕事务",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-subtitle",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const staged = createSubtitleSnapshot({
      contentHash: "sha256:transaction",
      createdAt: 1_500,
      language: "en-US",
      rows: [{ endMs: 2_000, startMs: 1_000, text: "atomic subtitle" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-transaction",
      videoKey: video.videoKey,
    });
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });

    try {
      await expect(
        repository.readAcquisitionContext(video.videoKey),
      ).resolves.toEqual({ expectedContextRevision: 1, session, video });

      const transaction = vi.spyOn(database, "transaction");
      const commit = repository.commitInitialAcquisition(staged);
      const writeTransaction = transaction.mock.results[0]
        ?.value as IDBTransaction;
      let completed = false;
      writeTransaction.addEventListener(
        "complete",
        () => {
          completed = true;
        },
        { once: true },
      );
      const committed = await commit;

      expect(completed).toBe(true);
      expect(committed).toMatchObject({
        session: {
          ...session,
          activeBranchId: staged.branchId,
          lastActivityAt: 2_000,
          selectionRevision: 1,
          updatedAt: 2_000,
        },
        subtitle: { ...staged, status: "active" },
      });
      expect(committed.branch).toMatchObject({
        activeSubtitleId: staged.subtitleId,
        branchId: staged.branchId,
        contextRevision: 1,
      });
      expect(committed.placement).toMatchObject({
        branchId: staged.branchId,
        location: "workspace",
      });
      expect(transaction).toHaveBeenCalledOnce();
      expect(transaction).toHaveBeenCalledWith(
        [
          "branchPlacements",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );

      const read = database.transaction(
        ["sessions", "subtitleSnapshots"],
        "readonly",
      );
      await expect(
        requestResult(read.objectStore("sessions").get(session.sessionId)),
      ).resolves.toEqual(committed.session);
      await expect(
        requestResult(
          read.objectStore("subtitleSnapshots").get(staged.subtitleId),
        ),
      ).resolves.toEqual(committed.subtitle);
      await transactionDone(read);
    } finally {
      database.close();
    }
  });

  it("rejects an existing active subtitle without creating an orphan", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "已有字幕",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-existing",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    const first = createSubtitleSnapshot({
      contentHash: "sha256:first",
      createdAt: 1_100,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "first" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-first",
      videoKey: video.videoKey,
    });
    const second = createSubtitleSnapshot({
      ...first,
      contentHash: "sha256:second",
      subtitleId: "subtitle-second",
    });

    try {
      await repository.commitInitialAcquisition(first);
      await expect(
        repository.commitInitialAcquisition(second),
      ).rejects.toMatchObject({
        code: "SUBTITLE_REPLACEMENT_REQUIRED",
        retryable: false,
      });
      const state = await readSubtitleState(database, session.sessionId);
      expect(state.session).toMatchObject({
        activeBranchId: first.branchId,
        selectionRevision: 1,
      });
      expect(state.snapshots).toHaveLength(1);
      expect(state.snapshots[0]).toMatchObject({
        status: "active",
        subtitleId: first.subtitleId,
      });
    } finally {
      database.close();
    }
  });

  it("rejects missing and mismatched sessions before any subtitle write", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const firstVideo = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "first",
    });
    const secondVideo = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      cid: 30_000_000_002,
      page: 2,
      title: "second",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-identity",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(firstVideo);
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    const snapshot = (
      sessionId: string,
      videoKey: typeof firstVideo.videoKey,
    ) =>
      createSubtitleSnapshot({
        contentHash: "sha256:identity",
        createdAt: 1_500,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "identity" }],
        sessionId,
        source: "bilibili",
        status: "staged",
        subtitleId: `subtitle-${sessionId}`,
        videoKey,
      });

    try {
      await expect(
        repository.commitInitialAcquisition(
          snapshot("missing-session", firstVideo.videoKey),
        ),
      ).rejects.toMatchObject({ code: "VIDEO_NOT_BOUND", retryable: false });
      await expect(
        readSubtitleState(database, session.sessionId),
      ).resolves.toEqual({ session, snapshots: [] });
      await expect(
        repository.commitInitialAcquisition(
          snapshot(session.sessionId, secondVideo.videoKey),
        ),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED", retryable: false });
      await expect(
        readSubtitleState(database, session.sessionId),
      ).resolves.toEqual({ session, snapshots: [] });
    } finally {
      database.close();
    }
  });

  it("returns null for an absent acquisition context and rejects a one-sided binding", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "context",
    });
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });

    try {
      await expect(
        repository.readAcquisitionContext(video.videoKey),
      ).resolves.toBeNull();
      const sessionRepository = new IndexedDbSessionRepository(database, {
        createSessionId: () => "session-context",
        now: () => 1_000,
      });
      await sessionRepository.create(video);
      const corrupt = database.transaction("videos", "readwrite");
      corrupt.objectStore("videos").delete(video.videoKey);
      await transactionDone(corrupt);

      await expect(
        repository.readAcquisitionContext(video.videoKey),
      ).rejects.toMatchObject({
        code: "STORAGE_TRANSACTION_FAILED",
        message: "The bound Bilimuzhi video context is inconsistent",
      });
    } finally {
      database.close();
    }
  });

  it("rejects a non-staged first subtitle before opening a write transaction", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "non-staged",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-non-staged",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    const active = createSubtitleSnapshot({
      contentHash: "sha256:non-staged",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "non-staged" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "active",
      subtitleId: "subtitle-non-staged",
      videoKey: video.videoKey,
    });
    const transaction = vi.spyOn(database, "transaction");

    try {
      await expect(
        repository.commitInitialAcquisition(active),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(transaction).not.toHaveBeenCalled();
      transaction.mockRestore();
      await expect(
        readSubtitleState(database, session.sessionId),
      ).resolves.toEqual({ session, snapshots: [] });
    } finally {
      transaction.mockRestore();
      database.close();
    }
  });

  it("rolls back the Session pointer when the subtitle primary key conflicts", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "conflict",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-conflict",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const existing = createSubtitleSnapshot({
      contentHash: "sha256:existing",
      createdAt: 1_100,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "existing" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-conflict",
      videoKey: video.videoKey,
    });
    const seed = database.transaction("subtitleSnapshots", "readwrite");
    seed.objectStore("subtitleSnapshots").add(existing);
    await transactionDone(seed);
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });

    try {
      await expect(
        repository.commitInitialAcquisition(
          createSubtitleSnapshot({
            ...existing,
            contentHash: "sha256:new",
            rows: [{ endMs: 2_000, startMs: 1_000, text: "new" }],
          }),
        ),
      ).rejects.toMatchObject({
        code: "STORAGE_TRANSACTION_FAILED",
        retryable: false,
      });
      await expect(
        requestResult(
          database
            .transaction("sessions", "readonly")
            .objectStore("sessions")
            .get(session.sessionId),
        ),
      ).resolves.toEqual(session);
      await expect(
        requestResult(
          database
            .transaction("subtitleSnapshots", "readonly")
            .objectStore("subtitleSnapshots")
            .get(existing.subtitleId),
        ),
      ).resolves.toEqual(existing);
    } finally {
      database.close();
    }
  });

  it("serializes concurrent first commits so exactly one subtitle becomes active", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "concurrent",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-concurrent",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const createStaged = (subtitleId: string) =>
      createSubtitleSnapshot({
        contentHash: `sha256:${subtitleId}`,
        createdAt: 1_500,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: subtitleId }],
        sessionId: session.sessionId,
        source: "bilibili",
        status: "staged",
        subtitleId,
        videoKey: video.videoKey,
      });
    const first = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    const second = new IndexedDbSubtitleRepository(database, {
      now: () => 3_000,
    });

    try {
      const results = await Promise.allSettled([
        first.commitInitialAcquisition(createStaged("subtitle-one")),
        second.commitInitialAcquisition(createStaged("subtitle-two")),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      expect(rejected).toMatchObject({
        reason: { code: "SUBTITLE_REPLACEMENT_REQUIRED" },
      });
      const state = await readSubtitleState(database, session.sessionId);
      expect(state.snapshots).toHaveLength(1);
      expect(state.snapshots[0]).toMatchObject({ status: "active" });
      expect(state.session).toMatchObject({
        activeBranchId: state.snapshots[0]?.branchId,
        selectionRevision: 1,
      });
    } finally {
      database.close();
    }
  });

  it("normalizes a closed-database transaction failure without writing", async () => {
    const name = createDatabaseName();
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "closed",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-closed",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const staged = createSubtitleSnapshot({
      contentHash: "sha256:closed",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "closed" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-closed",
      videoKey: video.videoKey,
    });
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    database.close();

    await expect(
      repository.commitInitialAcquisition(staged),
    ).rejects.toMatchObject({
      code: "STORAGE_TRANSACTION_FAILED",
      message: "Unable to update the Bilimuzhi subtitle database",
      retryable: false,
    });

    const reopened = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    try {
      await expect(
        readSubtitleState(reopened, session.sessionId),
      ).resolves.toEqual({ session, snapshots: [] });
    } finally {
      reopened.close();
    }
  });

  it("aborts an already queued subtitle add when the Session put throws synchronously", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "put failure",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-put-failure",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const staged = createSubtitleSnapshot({
      contentHash: "sha256:put-failure",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "put failure" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-put-failure",
      videoKey: video.videoKey,
    });
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    const originalPut = FakeIDBObjectStore.prototype.put;
    const put = vi
      .spyOn(FakeIDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === "sessions") {
          throw new DOMException("injected put failure", "DataError");
        }
        return Reflect.apply(
          originalPut,
          this,
          key === undefined ? [value] : [value, key],
        ) as IDBRequest<IDBValidKey>;
      });

    try {
      await expect(
        repository.commitInitialAcquisition(staged),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      const read = database.transaction(
        ["sessions", "subtitleSnapshots"],
        "readonly",
      );
      await expect(
        requestResult(read.objectStore("sessions").get(session.sessionId)),
      ).resolves.toEqual(session);
      await expect(
        requestResult(read.objectStore("subtitleSnapshots").count()),
      ).resolves.toBe(0);
    } finally {
      put.mockRestore();
      database.close();
    }
  });

  it("leaves both stores unchanged when the subtitle add throws synchronously", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "add failure",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-add-failure",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const staged = createSubtitleSnapshot({
      contentHash: "sha256:add-failure",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "add failure" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-add-failure",
      videoKey: video.videoKey,
    });
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    const originalAdd = FakeIDBObjectStore.prototype.add;
    const add = vi
      .spyOn(FakeIDBObjectStore.prototype, "add")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === "subtitleSnapshots") {
          throw new DOMException("injected add failure", "DataError");
        }
        return Reflect.apply(
          originalAdd,
          this,
          key === undefined ? [value] : [value, key],
        ) as IDBRequest<IDBValidKey>;
      });

    try {
      await expect(
        repository.commitInitialAcquisition(staged),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        readSubtitleState(database, session.sessionId),
      ).resolves.toEqual({ session, snapshots: [] });
    } finally {
      add.mockRestore();
      database.close();
    }
  });

  it("rolls back the subtitle when the Session put fails asynchronously", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "async put failure",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-async-put-failure",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const staged = createSubtitleSnapshot({
      contentHash: "sha256:async-put-failure",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "async put failure" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-async-put-failure",
      videoKey: video.videoKey,
    });
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    const originalPut = FakeIDBObjectStore.prototype.put;
    const originalAdd = FakeIDBObjectStore.prototype.add;
    const put = vi
      .spyOn(FakeIDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        if (this.name === "sessions") {
          return Reflect.apply(
            originalAdd,
            this,
            key === undefined ? [value] : [value, key],
          ) as IDBRequest<IDBValidKey>;
        }
        return Reflect.apply(
          originalPut,
          this,
          key === undefined ? [value] : [value, key],
        ) as IDBRequest<IDBValidKey>;
      });

    try {
      await expect(
        repository.commitInitialAcquisition(staged),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        readSubtitleState(database, session.sessionId),
      ).resolves.toEqual({ session, snapshots: [] });
    } finally {
      put.mockRestore();
      database.close();
    }
  });

  it("rolls back both queued writes when the transaction aborts", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const video = createVideoRef({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "abort failure",
    });
    const sessionRepository = new IndexedDbSessionRepository(database, {
      createSessionId: () => "session-abort-failure",
      now: () => 1_000,
    });
    const session = await sessionRepository.create(video);
    const staged = createSubtitleSnapshot({
      contentHash: "sha256:abort-failure",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "abort failure" }],
      sessionId: session.sessionId,
      source: "bilibili",
      status: "staged",
      subtitleId: "subtitle-abort-failure",
      videoKey: video.videoKey,
    });
    const repository = new IndexedDbSubtitleRepository(database, {
      now: () => 2_000,
    });
    const originalPut = FakeIDBObjectStore.prototype.put;
    const put = vi
      .spyOn(FakeIDBObjectStore.prototype, "put")
      .mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        const request = Reflect.apply(
          originalPut,
          this,
          key === undefined ? [value] : [value, key],
        ) as IDBRequest<IDBValidKey>;
        if (this.name === "sessions") {
          queueMicrotask(() => this.transaction.abort());
        }
        return request;
      });

    try {
      await expect(
        repository.commitInitialAcquisition(staged),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        readSubtitleState(database, session.sessionId),
      ).resolves.toEqual({ session, snapshots: [] });
    } finally {
      put.mockRestore();
      database.close();
    }
  });

  it("ignores archive-only history when resolving acquisition context for the exact VideoKey", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const video = createVideoRef({
        bvid: "BV1Q541167Qg",
        canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
        cid: 30_000_000_002,
        page: 2,
        title: "归档历史视频",
      });
      const sessionRepository = new IndexedDbSessionRepository(database, {
        createSessionId: () => "session-archive-only",
        now: () => 1_000,
      });
      const archived = await sessionRepository.create(video);
      const seed = database.transaction(
        ["workspaceSessionPlacements", "archiveSessionPlacements"],
        "readwrite",
      );
      seed.objectStore("workspaceSessionPlacements").delete(archived.sessionId);
      seed.objectStore("archiveSessionPlacements").put({
        folderId: "archive-root",
        order: 0,
        pinned: false,
        sessionId: archived.sessionId,
      });
      await transactionDone(seed);

      const repository = new IndexedDbSubtitleRepository(database, {
        now: () => 2_000,
      });
      await expect(
        repository.readAcquisitionContext(video.videoKey),
      ).resolves.toBeNull();
    } finally {
      database.close();
    }
  });
});
