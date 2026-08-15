import { afterEach, describe, expect, it } from "vitest";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";

Object.assign(globalThis, { IDBKeyRange });

import {
  createBatchItem,
  createBatchJob,
  createBatchSourceHistoryEntry,
} from "../../src/domain";
import { IndexedDbBatchRepository } from "../../src/infrastructure/indexeddb/batch-repository";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";

const names: string[] = [];
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

function item(id: string, order: number, page: number, cid: number) {
  return createBatchItem({
    aid: 100,
    batchItemId: id,
    batchJobId: "job-1",
    bvid: "BV1b7411N798",
    cid,
    errorCode: null,
    order,
    page,
    rowCount: 0,
    selected: false,
    status: "pending",
    title: `P${page}`,
    trackId: null,
    updatedAt: 1,
    videoKey: `bvid:BV1b7411N798:cid:${cid}:p:${page}`,
  });
}

describe("Batch list source append", () => {
  it("appends only exact non-duplicates and records sanitized source history atomically", async () => {
    const name = `batch-list-append-${crypto.randomUUID()}`;
    names.push(name);
    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const repository = new IndexedDbBatchRepository(database, {
      now: () => 10,
    });
    await repository.createJob(
      createBatchJob({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
        name: "新建列表1",
        status: "ready",
        updatedAt: 1,
      }),
      [item("item-1", 0, 1, 11)],
    );

    const result = await repository.appendSource(
      "job-1",
      [item("duplicate", 1, 1, 11), item("item-2", 2, 2, 22)],
      createBatchSourceHistoryEntry({
        addedAt: 10,
        addedCount: 0,
        batchJobId: "job-1",
        duplicateCount: 0,
        sourceHistoryId: "history-1",
        sourceKey: "video-pages:BV1b7411N798",
        sourceKind: "video-pages",
      }),
    );

    expect(result.addedCount).toBe(1);
    expect(result.duplicateCount).toBe(1);
    expect(result.items.map((entry) => entry.batchItemId)).toEqual([
      "item-1",
      "item-2",
    ]);

    const transaction = database.transaction("batchSourceHistory", "readonly");
    const history = await new Promise<unknown[]>((resolve, reject) => {
      const request = transaction.objectStore("batchSourceHistory").getAll();
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    expect(history).toEqual([
      expect.objectContaining({
        addedCount: 1,
        duplicateCount: 1,
        sourceKey: "video-pages:BV1b7411N798",
      }),
    ]);
    database.close();
  });
});

describe("Batch list concurrent creation", () => {
  it("allocates distinct minimal names in repository transactions", async () => {
    const name = `batch-list-create-${crypto.randomUUID()}`;
    names.push(name);
    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const repositoryA = new IndexedDbBatchRepository(database, {
      now: () => 10,
    });
    const repositoryB = new IndexedDbBatchRepository(database, {
      now: () => 10,
    });

    const created = await Promise.all([
      repositoryA.createList({
        batchJobId: "job-a",
        browserSessionId: "browser-a",
        createdAt: 10,
      }),
      repositoryB.createList({
        batchJobId: "job-b",
        browserSessionId: "browser-b",
        createdAt: 10,
      }),
    ]);

    expect(created.map((entry) => entry.job.name).sort()).toEqual([
      "新建列表1",
      "新建列表2",
    ]);
    database.close();
  });

  it("rejects adversarial source history keys", () => {
    for (const sourceKey of [
      "search:Bearer abc",
      "favorites:SESSDATA=abc",
      "collection:https://example.test/?token=abc",
      "user-space:authorization=secret",
    ]) {
      expect(() =>
        createBatchSourceHistoryEntry({
          addedAt: 10,
          addedCount: 0,
          batchJobId: "job-1",
          duplicateCount: 0,
          sourceHistoryId: crypto.randomUUID(),
          sourceKey,
          sourceKind: "search",
        }),
      ).toThrow();
    }
  });
});
