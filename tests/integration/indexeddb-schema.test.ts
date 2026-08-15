import { afterEach, describe, expect, it, vi } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  MUZHI_DATABASE_VERSION,
  ROOT_ARCHIVE_FOLDER_ID,
  openBilimuzhiDatabase,
} from "../../src/infrastructure/indexeddb/muzhi-database";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-schema-${crypto.randomUUID()}`;
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

async function createEmptyDatabase(
  name: string,
  version: number,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.open(name, version);
    request.addEventListener(
      "success",
      () => {
        request.result.close();
        resolve();
      },
      { once: true },
    );
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

async function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

async function transactionDone(transaction: IDBTransaction): Promise<void> {
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

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("Bilimuzhi IndexedDB schema", () => {
  it("creates the current v6 stores including independent BatchSubtitle ownership, archive root, and settings", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });

    expect(database.version).toBe(MUZHI_DATABASE_VERSION);
    expect([...database.objectStoreNames]).toEqual([
      "archiveBatchPlacements",
      "archiveFolders",
      "archiveSessionPlacements",
      "archiveSessionTags",
      "artifacts",
      "attachments",
      "batchItems",
      "batchJobs",
      "batchSourceHistory",
      "batchSubtitles",
      "branchPlacements",
      "chatMessages",
      "chatThreads",
      "generationRuns",
      "sessions",
      "settings",
      "subtitleBranches",
      "subtitleSnapshots",
      "tags",
      "trashBatchPlacements",
      "trashSessionPlacements",
      "videos",
      "workspaceBatchPlacements",
      "workspaceSessionPlacements",
    ]);

    const transaction = database.transaction(
      [...database.objectStoreNames],
      "readonly",
    );
    const sessions = transaction.objectStore("sessions");
    const attachments = transaction.objectStore("attachments");
    const subtitleSnapshots = transaction.objectStore("subtitleSnapshots");
    const videos = transaction.objectStore("videos");

    expect(videos.keyPath).toBe("videoKey");
    expect([...videos.indexNames]).toEqual([]);
    expect(sessions.keyPath).toBe("sessionId");
    expect([...sessions.indexNames]).toEqual([
      "byLastActivityAt",
      "byVideoKey",
    ]);
    expect(sessions.index("byVideoKey")).toMatchObject({
      keyPath: "videoKey",
      unique: false,
    });
    expect(sessions.index("byLastActivityAt")).toMatchObject({
      keyPath: "lastActivityAt",
      unique: false,
    });
    expect(subtitleSnapshots.keyPath).toBe("subtitleId");
    expect([...subtitleSnapshots.indexNames]).toEqual([
      "byBranchId",
      "bySessionId",
      "bySessionStatus",
    ]);
    expect(subtitleSnapshots.index("bySessionId")).toMatchObject({
      keyPath: "sessionId",
      unique: false,
    });
    expect(subtitleSnapshots.index("bySessionStatus")).toMatchObject({
      keyPath: ["sessionId", "status"],
      unique: false,
    });
    expect([...attachments.indexNames]).toEqual([
      "byBranchId",
      "byMessageId",
      "byOwner",
      "bySessionId",
      "byThreadId",
    ]);
    expect(attachments.index("byOwner")).toMatchObject({
      keyPath: [
        "sessionId",
        "subtitleContextRevision",
        "chatThreadId",
        "messageId",
      ],
      unique: false,
    });
    expect(attachments.index("byThreadId")).toMatchObject({
      keyPath: "chatThreadId",
      unique: false,
    });
    expect([...transaction.objectStore("subtitleBranches").indexNames]).toEqual(
      ["bySessionId", "bySessionLastOpenedAt", "byVideoKey"],
    );
    expect([...transaction.objectStore("branchPlacements").indexNames]).toEqual(
      ["byLocationOrder", "byPurgeAfter", "bySessionId", "bySessionLocation"],
    );
    expect([
      ...transaction.objectStore("trashSessionPlacements").indexNames,
    ]).toEqual(["byPurgeAfter"]);
    expect([...transaction.objectStore("generationRuns").indexNames]).toEqual([
      "byBranchId",
      "byOwnerStatus",
      "byOwnerTargetStatus",
      "bySessionId",
      "byTaskId",
    ]);
    expect(
      transaction.objectStore("generationRuns").index("byOwnerTargetStatus"),
    ).toMatchObject({
      keyPath: [
        "sessionId",
        "branchId",
        "subtitleId",
        "contextRevision",
        "kind",
        "targetId",
        "status",
      ],
      unique: false,
    });
    await expect(
      requestResult(transaction.objectStore("settings").get("trashRetention")),
    ).resolves.toEqual({
      key: "trashRetention",
      policy: { durationDays: 7, kind: "duration" },
      updatedAt: 0,
    });
    await expect(
      requestResult(
        transaction.objectStore("archiveFolders").get(ROOT_ARCHIVE_FOLDER_ID),
      ),
    ).resolves.toEqual({
      folderId: ROOT_ARCHIVE_FOLDER_ID,
      order: 0,
      parentFolderId: null,
      title: "归档",
    });
    await transactionDone(transaction);

    database.close();
  });

  it("closes and rejects an existing database with an invalid version 1 schema", async () => {
    const name = createDatabaseName();
    await createEmptyDatabase(name, 1);

    await expect(
      openBilimuzhiDatabase({ factory: fakeIndexedDB, name }).then((database) => {
        database.close();
        return database;
      }),
    ).rejects.toMatchObject({
      code: "STORAGE_TRANSACTION_FAILED",
      message: "The Bilimuzhi version 1 data cannot be migrated safely",
      retryable: false,
    });
  });

  it("enforces one archive projection per session and one placement per branch", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const archive = database.transaction(
        "archiveSessionPlacements",
        "readwrite",
      );
      const archiveDone = transactionDone(archive);
      const archivePlacements = archive.objectStore("archiveSessionPlacements");
      archivePlacements.add({
        folderId: "archive-root",
        order: 0,
        pinned: false,
        sessionId: "session-b",
      });
      await expect(
        requestResult(
          archivePlacements.add({
            folderId: "another-folder",
            order: 1,
            pinned: false,
            sessionId: "session-b",
          }),
        ),
      ).rejects.toMatchObject({ name: "ConstraintError" });
      await expect(archiveDone).rejects.toBeDefined();

      const placements = database.transaction("branchPlacements", "readwrite");
      const placementDone = transactionDone(placements);
      const branchPlacements = placements.objectStore("branchPlacements");
      branchPlacements.add({ branchId: "branch-b", location: "workspace" });
      await expect(
        requestResult(
          branchPlacements.add({ branchId: "branch-b", location: "archive" }),
        ),
      ).rejects.toMatchObject({ name: "ConstraintError" });
      await expect(placementDone).rejects.toBeDefined();
    } finally {
      database.close();
    }
  });

  it("normalizes an incompatible newer database version", async () => {
    const name = createDatabaseName();
    await createEmptyDatabase(name, MUZHI_DATABASE_VERSION + 1);

    await expect(
      openBilimuzhiDatabase({ factory: fakeIndexedDB, name }),
    ).rejects.toMatchObject({
      code: "STORAGE_TRANSACTION_FAILED",
      message: "Unable to open the Bilimuzhi database",
      retryable: false,
    });
  });

  it("reopens version 4 without replacing existing data", async () => {
    const name = createDatabaseName();
    const firstConnection = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    const write = firstConnection.transaction("videos", "readwrite");
    write.objectStore("videos").put({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "持久化示例",
      videoKey: "bvid:BV1Q541167Qg:cid:30000000001:p:1",
    });
    await transactionDone(write);
    firstConnection.close();

    const secondConnection = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name,
    });
    const stored = await requestResult(
      secondConnection
        .transaction("videos", "readonly")
        .objectStore("videos")
        .get("bvid:BV1Q541167Qg:cid:30000000001:p:1"),
    );

    expect(stored).toMatchObject({
      cid: 30_000_000_001,
      title: "持久化示例",
    });
    secondConnection.close();
  });

  it("closes a connection that succeeds after an open request was blocked", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    const close = vi.spyOn(database, "close");
    const request = new EventTarget() as IDBOpenDBRequest;
    Object.defineProperties(request, {
      error: { value: null },
      result: { value: database },
      transaction: { value: null },
    });
    const factory = {
      open: () => request,
    } as unknown as IDBFactory;

    const opening = openBilimuzhiDatabase({ factory, name: "blocked-test" });
    request.dispatchEvent(new Event("blocked"));
    request.dispatchEvent(new Event("success"));

    try {
      await expect(opening).rejects.toMatchObject({
        code: "STORAGE_TRANSACTION_FAILED",
        retryable: true,
      });
      expect(close).toHaveBeenCalledOnce();
    } finally {
      database.close();
    }
  });
});
