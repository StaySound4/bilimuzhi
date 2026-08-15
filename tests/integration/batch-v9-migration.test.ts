import { afterEach, describe, expect, it } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";

interface LegacyStoreSchema {
  readonly indexes: readonly {
    readonly keyPath: string | readonly string[];
    readonly name: string;
    readonly unique?: boolean;
  }[];
  readonly keyPath: string;
  readonly name: string;
}

const legacyV5Schema: readonly LegacyStoreSchema[] = [
  {
    name: "archiveFolders",
    keyPath: "folderId",
    indexes: [{ name: "byParentOrder", keyPath: ["parentFolderId", "order"] }],
  },
  {
    name: "archiveSessionPlacements",
    keyPath: "sessionId",
    indexes: [{ name: "byFolderOrder", keyPath: ["folderId", "order"] }],
  },
  {
    name: "artifacts",
    keyPath: "artifactId",
    indexes: [
      { name: "byBranchId", keyPath: "branchId" },
      {
        name: "byOwnerKind",
        keyPath: ["sessionId", "branchId", "subtitleId", "kind"],
        unique: true,
      },
      { name: "bySessionId", keyPath: "sessionId" },
    ],
  },
  {
    name: "attachments",
    keyPath: "attachmentId",
    indexes: [
      { name: "byBranchId", keyPath: "branchId" },
      { name: "byMessageId", keyPath: "messageId" },
      { name: "bySessionId", keyPath: "sessionId" },
    ],
  },
  {
    name: "batchItems",
    keyPath: "batchItemId",
    indexes: [
      { name: "byJobOrder", keyPath: ["batchJobId", "order"], unique: true },
      { name: "byResultBranchId", keyPath: "resultBranchId" },
    ],
  },
  {
    name: "batchJobs",
    keyPath: "batchJobId",
    indexes: [{ name: "byStatus", keyPath: "status" }],
  },
  {
    name: "branchPlacements",
    keyPath: "branchId",
    indexes: [
      { name: "byLocationOrder", keyPath: ["location", "order"] },
      { name: "byPurgeAfter", keyPath: "purgeAfter" },
      { name: "bySessionId", keyPath: "sessionId" },
      { name: "bySessionLocation", keyPath: ["sessionId", "location"] },
    ],
  },
  {
    name: "chatMessages",
    keyPath: "messageId",
    indexes: [
      { name: "byBranchId", keyPath: "branchId" },
      { name: "bySessionId", keyPath: "sessionId" },
      {
        name: "byThreadOrder",
        keyPath: ["chatThreadId", "order"],
        unique: true,
      },
    ],
  },
  {
    name: "chatThreads",
    keyPath: "chatThreadId",
    indexes: [
      { name: "byBranchId", keyPath: "branchId" },
      {
        name: "byOwnerOrder",
        keyPath: ["sessionId", "branchId", "subtitleId", "order"],
        unique: true,
      },
      { name: "bySessionId", keyPath: "sessionId" },
    ],
  },
  {
    name: "generationRuns",
    keyPath: "runId",
    indexes: [
      { name: "byBranchId", keyPath: "branchId" },
      {
        name: "byOwnerStatus",
        keyPath: ["sessionId", "branchId", "subtitleId", "status"],
      },
      {
        name: "byOwnerTargetStatus",
        keyPath: [
          "sessionId",
          "branchId",
          "subtitleId",
          "contextRevision",
          "kind",
          "targetId",
          "status",
        ],
      },
      { name: "bySessionId", keyPath: "sessionId" },
      { name: "byTaskId", keyPath: "taskId", unique: true },
    ],
  },
  {
    name: "sessions",
    keyPath: "sessionId",
    indexes: [
      { name: "byLastActivityAt", keyPath: "lastActivityAt" },
      { name: "byVideoKey", keyPath: "videoKey" },
    ],
  },
  { name: "settings", keyPath: "key", indexes: [] },
  {
    name: "subtitleBranches",
    keyPath: "branchId",
    indexes: [
      { name: "bySessionId", keyPath: "sessionId" },
      { name: "bySessionLastOpenedAt", keyPath: ["sessionId", "lastOpenedAt"] },
      { name: "byVideoKey", keyPath: "videoKey" },
    ],
  },
  {
    name: "subtitleSnapshots",
    keyPath: "subtitleId",
    indexes: [
      { name: "byBranchId", keyPath: "branchId" },
      { name: "bySessionId", keyPath: "sessionId" },
      { name: "bySessionStatus", keyPath: ["sessionId", "status"] },
    ],
  },
  {
    name: "trashSessionPlacements",
    keyPath: "sessionId",
    indexes: [{ name: "byPurgeAfter", keyPath: "purgeAfter" }],
  },
  { name: "videos", keyPath: "videoKey", indexes: [] },
  {
    name: "workspaceSessionPlacements",
    keyPath: "sessionId",
    indexes: [{ name: "byPinnedOrder", keyPath: ["pinned", "order"] }],
  },
];

const legacyOwnedStores = [
  "archiveSessionPlacements",
  "artifacts",
  "attachments",
  "batchItems",
  "batchJobs",
  "branchPlacements",
  "chatMessages",
  "chatThreads",
  "generationRuns",
  "sessions",
  "subtitleBranches",
  "subtitleSnapshots",
  "trashSessionPlacements",
  "videos",
  "workspaceSessionPlacements",
] as const;

const databaseNames: string[] = [];

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

async function deleteDatabase(name: string): Promise<void> {
  await requestResult(fakeIndexedDB.deleteDatabase(name));
}

async function createLegacyV5Database(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.open(name, 5);
    request.addEventListener("upgradeneeded", () => {
      for (const schema of legacyV5Schema) {
        const store = request.result.createObjectStore(schema.name, {
          keyPath: schema.keyPath,
        });
        for (const index of schema.indexes) {
          store.createIndex(index.name, index.keyPath as string | string[], {
            unique: index.unique ?? false,
          });
        }
      }
    });
    request.addEventListener("success", () => {
      const database = request.result;
      const transaction = database.transaction(
        [...legacyOwnedStores],
        "readwrite",
      );
      for (const storeName of legacyOwnedStores) {
        const keyPath = legacyV5Schema.find(
          (schema) => schema.name === storeName,
        )?.keyPath;
        if (keyPath === undefined)
          throw new Error(`missing legacy schema for ${storeName}`);
        transaction.objectStore(storeName).put({
          [keyPath]: `legacy-${storeName}`,
          batchJobId: "legacy-batchJobs",
          order: 0,
          sessionId: "legacy-sessions",
        });
      }
      transactionDone(transaction).then(() => {
        database.close();
        resolve();
      }, reject);
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

async function counts(
  database: IDBDatabase,
  stores: readonly string[],
): Promise<Record<string, number>> {
  const transaction = database.transaction([...stores], "readonly");
  const result = Object.fromEntries(
    await Promise.all(
      stores.map(
        async (storeName) =>
          [
            storeName,
            await requestResult(transaction.objectStore(storeName).count()),
          ] as const,
      ),
    ),
  );
  await transactionDone(transaction);
  return result;
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("v9 独立批量一次性迁移", () => {
  it("从合法 v5 一次性清除全部旧 Session 派生数据和旧批量空壳，并创建独立 BatchSubtitle store", async () => {
    const name = `muzhi-batch-v9-${crypto.randomUUID()}`;
    databaseNames.push(name);
    await createLegacyV5Database(name);

    const migrated = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });

    expect([...migrated.objectStoreNames]).toContain("batchSubtitles");
    await expect(counts(migrated, legacyOwnedStores)).resolves.toEqual(
      Object.fromEntries(legacyOwnedStores.map((storeName) => [storeName, 0])),
    );

    const postMigrationStores = [
      "sessions",
      "batchJobs",
      "batchItems",
      "batchSubtitles",
    ];
    const seed = migrated.transaction(postMigrationStores, "readwrite");
    seed.objectStore("sessions").put({ sessionId: "new-session-after-v9" });
    seed.objectStore("batchJobs").put({ batchJobId: "new-job-after-v9" });
    seed.objectStore("batchItems").put({
      batchItemId: "new-item-after-v9",
      batchJobId: "new-job-after-v9",
      order: 0,
    });
    seed.objectStore("batchSubtitles").put({
      batchItemId: "new-item-after-v9",
      language: "zh-CN",
      rows: [{ startMs: 0, endMs: 1_000, text: "迁移后数据" }],
    });
    await transactionDone(seed);
    migrated.close();

    const reopened = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    await expect(counts(reopened, postMigrationStores)).resolves.toEqual({
      batchItems: 1,
      batchJobs: 1,
      batchSubtitles: 1,
      sessions: 1,
    });
    reopened.close();
  });
});
