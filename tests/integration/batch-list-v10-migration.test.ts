import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  openBilimuzhiDatabase,
  VERSION_9_SCHEMA,
  VERSION_10_SCHEMA,
} from "../../src/infrastructure/indexeddb/muzhi-database";

const names: string[] = [];

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
  });
}

async function createLegacyV9(name: string): Promise<void> {
  const seedName = `${name}-seed`;
  const seeded = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: seedName,
  });
  const records: Record<string, readonly unknown[]> = {};
  for (const storeName of seeded.objectStoreNames) {
    const tx = seeded.transaction(storeName, "readonly");
    records[storeName] = (await requestResult(
      tx.objectStore(storeName).getAll(),
    )) as readonly unknown[];
    await transactionDone(tx);
  }
  seeded.close();
  await new Promise<void>((resolve) => {
    const deleting = fakeIndexedDB.deleteDatabase(seedName);
    deleting.addEventListener("success", () => resolve(), { once: true });
  });

  const request = fakeIndexedDB.open(name, 9);
  request.addEventListener("upgradeneeded", () => {
    const db = request.result;
    for (const schema of VERSION_9_SCHEMA) {
      const store = db.createObjectStore(schema.name, {
        keyPath: schema.keyPath,
      });
      for (const index of schema.indexes) {
        store.createIndex(index.name, index.keyPath as string | string[], {
          unique: index.unique,
        });
      }
    }
  });
  const db = await requestResult(request);
  const stores = VERSION_9_SCHEMA.map((schema) => schema.name);
  const tx = db.transaction(stores, "readwrite");
  for (const [storeName, values] of Object.entries(records)) {
    if (!db.objectStoreNames.contains(storeName)) continue;
    for (const value of values) tx.objectStore(storeName).put(value);
  }
  tx.objectStore("batchJobs").put({
    batchJobId: "job-1",
    browserSessionId: "browser-1",
    createdAt: 1,
    method: "direct",
    sourceKind: "favorites",
    sourceLabel: "课程收藏夹",
    status: "ready",
    updatedAt: 1,
  });
  tx.objectStore("batchItems").put({
    batchItemId: "item-1",
    batchJobId: "job-1",
    bvid: "BV1b7411N798",
    errorCode: null,
    order: 0,
    page: 1,
    rowCount: 0,
    selected: true,
    selectedLanguage: "en-US",
    status: "pending",
    title: "video",
    trackId: null,
    updatedAt: 1,
    videoKey: null,
  });
  await transactionDone(tx);
  db.close();
}

afterEach(async () => {
  await Promise.all(
    names.splice(0).map(
      (name) =>
        new Promise<void>((resolve) => {
          const request = fakeIndexedDB.deleteDatabase(name);
          request.addEventListener("success", () => resolve(), { once: true });
        }),
    ),
  );
});

describe("Batch list v10 migration", () => {
  it("atomically expands legacy jobs and clears persisted selection", async () => {
    const name = `batch-list-v10-${crypto.randomUUID()}`;
    names.push(name);
    await createLegacyV9(name);

    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    expect([...database.objectStoreNames]).toEqual(
      expect.arrayContaining([
        "workspaceBatchPlacements",
        "archiveBatchPlacements",
        "trashBatchPlacements",
        "batchSourceHistory",
      ]),
    );
    const tx = database.transaction(
      ["batchJobs", "batchItems", "workspaceBatchPlacements"],
      "readonly",
    );
    const job = (await requestResult(
      tx.objectStore("batchJobs").get("job-1"),
    )) as Record<string, unknown>;
    const item = (await requestResult(
      tx.objectStore("batchItems").get("item-1"),
    )) as Record<string, unknown>;
    const placement = await requestResult(
      tx.objectStore("workspaceBatchPlacements").get("job-1"),
    );
    await transactionDone(tx);

    expect(job.name).toBe("课程收藏夹");
    expect(item).toMatchObject({ selected: false, speechLanguageMode: "en" });
    expect(placement).toEqual({ batchJobId: "job-1", order: 0, pinned: false });
    database.close();

    const reopened = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const reopenedTx = reopened.transaction(
      "workspaceBatchPlacements",
      "readonly",
    );
    expect(
      await requestResult(
        reopenedTx.objectStore("workspaceBatchPlacements").getAll(),
      ),
    ).toHaveLength(1);
    await transactionDone(reopenedTx);
    reopened.close();
  });

  it("v10→v11 升级：不重跑列表迁移（改名/置顶/归档/回收站 placement 全部保留，标签 store 删除）", async () => {
    const name = `batch-list-v11-${crypto.randomUUID()}`;
    names.push(name);
    // seed v10 库：用户改名列表 + 置顶 + 归档/回收站列表 + 标签数据
    const request = fakeIndexedDB.open(name, 10);
    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      for (const schema of VERSION_10_SCHEMA) {
        if (db.objectStoreNames.contains(schema.name)) continue;
        const store = db.createObjectStore(schema.name, {
          keyPath: schema.keyPath,
        });
        for (const index of schema.indexes) {
          store.createIndex(index.name, index.keyPath as string | string[], {
            unique: index.unique,
          });
        }
      }
    });
    const db = await requestResult(request);
    const tx = db.transaction(
      [
        "batchJobs",
        "workspaceBatchPlacements",
        "archiveBatchPlacements",
        "trashBatchPlacements",
        "batchTags",
        "archiveBatchTags",
      ],
      "readwrite",
    );
    tx.objectStore("batchJobs").put({
      batchJobId: "job-w",
      browserSessionId: "b",
      createdAt: 1,
      name: "用户改名列表",
      sourceLabel: "原始来源名",
      status: "ready",
      updatedAt: 1,
    });
    tx.objectStore("batchJobs").put({
      batchJobId: "job-a",
      browserSessionId: "b",
      createdAt: 2,
      name: "归档列表",
      sourceLabel: "归档来源",
      status: "ready",
      updatedAt: 2,
    });
    tx.objectStore("batchJobs").put({
      batchJobId: "job-t",
      browserSessionId: "b",
      createdAt: 3,
      name: "回收站列表",
      sourceLabel: "回收站来源",
      status: "ready",
      updatedAt: 3,
    });
    tx.objectStore("workspaceBatchPlacements").put({
      batchJobId: "job-w",
      order: 5,
      pinned: true,
    });
    tx.objectStore("archiveBatchPlacements").put({
      archivedAt: 100,
      batchJobId: "job-a",
      order: 1,
      pinned: false,
    });
    tx.objectStore("trashBatchPlacements").put({
      batchJobId: "job-t",
      deletionReason: "user-delete",
      order: 1,
      pinned: false,
      purgeAfter: null,
      retentionStartedAt: 100,
      trashedAt: 100,
      trashOrigin: "workspace",
    });
    tx.objectStore("batchTags").put({ name: "课程", order: 0, tagId: "tag-1" });
    tx.objectStore("archiveBatchTags").put({
      batchJobId: "job-a",
      tagIds: ["tag-1"],
    });
    await transactionDone(tx);
    db.close();

    const upgraded = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    // 标签 store 已删除
    expect(upgraded.objectStoreNames.contains("batchTags")).toBe(false);
    expect(upgraded.objectStoreNames.contains("archiveBatchTags")).toBe(false);
    const readTx = upgraded.transaction(
      [
        "batchJobs",
        "workspaceBatchPlacements",
        "archiveBatchPlacements",
        "trashBatchPlacements",
      ],
      "readonly",
    );
    const job = (await requestResult(
      readTx.objectStore("batchJobs").get("job-w"),
    )) as Record<string, unknown>;
    // 用户改名保留（未重跑迁移）
    expect(job.name).toBe("用户改名列表");
    const placement = (await requestResult(
      readTx.objectStore("workspaceBatchPlacements").get("job-w"),
    )) as Record<string, unknown>;
    // 置顶与顺序保留
    expect(placement).toEqual({ batchJobId: "job-w", order: 5, pinned: true });
    // 归档/回收站列表没有被复制进工作区
    const workspace = (await requestResult(
      readTx.objectStore("workspaceBatchPlacements").getAll(),
    )) as readonly { readonly batchJobId: string }[];
    expect(workspace.map((p) => p.batchJobId)).toEqual(["job-w"]);
    expect(
      (
        await requestResult(
          readTx.objectStore("archiveBatchPlacements").getAll(),
        )
      ).length,
    ).toBe(1);
    expect(
      (await requestResult(readTx.objectStore("trashBatchPlacements").getAll()))
        .length,
    ).toBe(1);
    await transactionDone(readTx);
    upgraded.close();
  });
});

describe("Batch list v10 review regressions", () => {
  it("deduplicates migrated names and uses the injected speech default", async () => {
    const name = `batch-list-v10-duplicates-${crypto.randomUUID()}`;
    names.push(name);
    await createLegacyV9(name);
    const legacy = await requestResult(fakeIndexedDB.open(name, 9));
    const write = legacy.transaction(["batchJobs", "batchItems"], "readwrite");
    write.objectStore("batchJobs").put({
      batchJobId: "job-2",
      browserSessionId: "browser-1",
      createdAt: 2,
      method: "direct",
      sourceKind: "favorites",
      sourceLabel: "课程收藏夹",
      status: "ready",
      updatedAt: 2,
    });
    write.objectStore("batchItems").put({
      batchItemId: "item-2",
      batchJobId: "job-2",
      bvid: "BV1b7411N798",
      errorCode: null,
      order: 0,
      page: 2,
      rowCount: 0,
      selected: true,
      selectedLanguage: null,
      status: "pending",
      title: "video 2",
      trackId: null,
      updatedAt: 2,
      videoKey: null,
    });
    await transactionDone(write);
    legacy.close();

    const database = await openBilimuzhiDatabase({
      defaultSpeechLanguageMode: "zh",
      factory: fakeIndexedDB,
      name,
    });
    const tx = database.transaction(["batchJobs", "batchItems"], "readonly");
    const jobs = (await requestResult(
      tx.objectStore("batchJobs").getAll(),
    )) as Array<Record<string, unknown>>;
    const item = (await requestResult(
      tx.objectStore("batchItems").get("item-2"),
    )) as Record<string, unknown>;
    await transactionDone(tx);
    expect(jobs.map((job) => job.name).sort()).toEqual([
      "课程收藏夹",
      "课程收藏夹2",
    ]);
    expect(item).toMatchObject({ selected: false, speechLanguageMode: "zh" });
    database.close();
  });

  it("reserves suffix space for duplicate 200-character names deterministically", async () => {
    const name = `batch-list-v10-long-names-${crypto.randomUUID()}`;
    names.push(name);
    await createLegacyV9(name);
    const legacy = await requestResult(fakeIndexedDB.open(name, 9));
    const write = legacy.transaction("batchJobs", "readwrite");
    const sourceLabel = "名".repeat(200);
    for (let index = 1; index <= 11; index += 1) {
      write.objectStore("batchJobs").put({
        batchJobId: `long-job-${String(index).padStart(2, "0")}`,
        browserSessionId: "browser-1",
        createdAt: index + 10,
        method: "direct",
        sourceKind: "favorites",
        sourceLabel,
        status: "ready",
        updatedAt: index + 10,
      });
    }
    await transactionDone(write);
    legacy.close();

    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const tx = database.transaction("batchJobs", "readonly");
    const jobs = (await requestResult(
      tx.objectStore("batchJobs").getAll(),
    )) as Array<Record<string, unknown>>;
    await transactionDone(tx);
    const migrated = jobs
      .filter((job) => String(job.batchJobId).startsWith("long-job"))
      .map((job) => String(job.name));
    expect(migrated).toHaveLength(11);
    expect(new Set(migrated).size).toBe(11);
    expect(migrated.every((value) => value.length <= 200)).toBe(true);
    expect(migrated).toContain(sourceLabel);
    expect(migrated).toContain(`${"名".repeat(198)}10`);
    expect(migrated).toContain(`${"名".repeat(198)}11`);
    database.close();
  });

  it("aborts an incompatible v9 schema without upgrading it", async () => {
    const name = `batch-list-v10-invalid-${crypto.randomUUID()}`;
    names.push(name);
    const request = fakeIndexedDB.open(name, 9);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore("batchJobs", { keyPath: "wrongKey" });
    });
    const legacy = await requestResult(request);
    legacy.close();
    await expect(
      openBilimuzhiDatabase({ factory: fakeIndexedDB, name }),
    ).rejects.toMatchObject({
      code: "STORAGE_TRANSACTION_FAILED",
    });
    const unchanged = await requestResult(fakeIndexedDB.open(name));
    expect(unchanged.version).toBe(9);
    expect(
      unchanged.objectStoreNames.contains("workspaceBatchPlacements"),
    ).toBe(false);
    unchanged.close();
  });

  it("allows multiple source history entries in the same millisecond", async () => {
    const name = `batch-list-v10-history-${crypto.randomUUID()}`;
    names.push(name);
    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const tx = database.transaction("batchSourceHistory", "readwrite");
    const store = tx.objectStore("batchSourceHistory");
    store.add({ sourceHistoryId: "h1", batchJobId: "job", addedAt: 1 });
    store.add({ sourceHistoryId: "h2", batchJobId: "job", addedAt: 1 });
    await transactionDone(tx);
    const read = database.transaction("batchSourceHistory", "readonly");
    expect(
      await requestResult(read.objectStore("batchSourceHistory").getAll()),
    ).toHaveLength(2);
    await transactionDone(read);
    database.close();
  });
});
