import { afterEach, describe, expect, it } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  createBranchPlacement,
  createTrashSessionPlacement,
} from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbRetentionRepository } from "../../src/infrastructure/indexeddb/retention-repository";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-retention-${crypto.randomUUID()}`;
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

async function seedPlacements(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(
    ["branchPlacements", "trashSessionPlacements"],
    "readwrite",
  );
  const placements = transaction.objectStore("branchPlacements");
  placements.put(
    createBranchPlacement({
      branchId: "archive-branch",
      deletionReason: null,
      location: "archive",
      order: 0,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: "session-b",
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
  );
  transaction.objectStore("trashSessionPlacements").put(
    createTrashSessionPlacement({
      deletionReason: "user",
      order: 3,
      pinned: false,
      purgeAfter: 750,
      retentionStartedAt: 300,
      sessionId: "empty-session",
      trashedAt: 300,
      trashOrigin: "workspace",
    }),
  );
  placements.put(
    createBranchPlacement({
      branchId: "expired-branch",
      deletionReason: "user",
      location: "trash",
      order: 1,
      purgeAfter: 500,
      retentionStartedAt: 100,
      sessionId: "session-b",
      trashedAt: 100,
      trashOrigin: "workspace",
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
  );
  placements.put(
    createBranchPlacement({
      branchId: "future-branch",
      deletionReason: "user",
      location: "trash",
      order: 2,
      purgeAfter: 2_000,
      retentionStartedAt: 200,
      sessionId: "session-c",
      trashedAt: 200,
      trashOrigin: "workspace",
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
  );
  await transactionDone(transaction);
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("IndexedDbRetentionRepository", () => {
  it("applies a duration to all and only existing trash entries without changing trashedAt", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedPlacements(database);
      const repository = new IndexedDbRetentionRepository(database, {
        now: () => 1_000,
      });
      await expect(
        repository.updatePolicy(
          { durationDays: 30, kind: "duration" },
          "apply-to-existing",
        ),
      ).resolves.toMatchObject([
        {
          branchId: "expired-branch",
          purgeAfter: 1_000 + 30 * 24 * 60 * 60 * 1_000,
          retentionStartedAt: 1_000,
          trashedAt: 100,
        },
        {
          branchId: "future-branch",
          purgeAfter: 1_000 + 30 * 24 * 60 * 60 * 1_000,
          retentionStartedAt: 1_000,
          trashedAt: 200,
        },
      ]);
      await expect(repository.getPolicy()).resolves.toEqual({
        durationDays: 30,
        kind: "duration",
      });
      await expect(repository.getNextPurgeAt()).resolves.toBe(
        1_000 + 30 * 24 * 60 * 60 * 1_000,
      );
      await expect(
        requestResult(
          database
            .transaction("trashSessionPlacements", "readonly")
            .objectStore("trashSessionPlacements")
            .get("empty-session"),
        ),
      ).resolves.toMatchObject({
        purgeAfter: 1_000 + 30 * 24 * 60 * 60 * 1_000,
        retentionStartedAt: 1_000,
        trashedAt: 300,
      });
    } finally {
      database.close();
    }
  });

  it("future-only changes no existing placement and lists purge eligibility through one query", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedPlacements(database);
      const repository = new IndexedDbRetentionRepository(database, {
        now: () => 1_000,
      });
      await expect(
        repository.updatePolicy({ kind: "forever" }, "future-only"),
      ).resolves.toEqual([]);
      await expect(repository.listExpired(1_000)).resolves.toEqual([
        {
          branchId: "expired-branch",
          purgeAfter: 500,
          sessionId: "session-b",
        },
      ]);
      await expect(repository.getNextPurgeAt()).resolves.toBe(500);
    } finally {
      database.close();
    }
  });
});
