import { afterEach, describe, expect, it } from "vitest";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";

Object.assign(globalThis, { IDBKeyRange });

import { createBatchItem, createBatchJob } from "../../src/domain";
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

describe("Batch list repository round trip", () => {
  it("preserves runtime selection after setSelection and defaults missing speech language", async () => {
    const name = `batch-list-repository-${crypto.randomUUID()}`;
    names.push(name);
    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const repository = new IndexedDbBatchRepository(database, {
      defaultSpeechLanguageMode: "zh",
      now: () => 2,
    });
    const job = createBatchJob({
      batchJobId: "job-1",
      browserSessionId: "browser-1",
      createdAt: 1,
      name: "新建列表1",
      status: "ready",
      updatedAt: 1,
    });
    const item = createBatchItem(
      {
        batchItemId: "item-1",
        batchJobId: "job-1",
        bvid: "BV1b7411N798",
        errorCode: null,
        order: 0,
        page: 1,
        rowCount: 0,
        selected: false,
        status: "pending",
        title: "video",
        trackId: null,
        updatedAt: 1,
        videoKey: null,
      },
      "zh",
    );
    await repository.createJob(job, [item]);
    await repository.setSelection("job-1", ["item-1"]);

    const stored = await repository.read("job-1");
    expect(stored?.items[0]).toMatchObject({
      selected: true,
      speechLanguageMode: "zh",
    });
    const raw = database.transaction("batchItems", "readonly");
    expect(
      await new Promise<unknown>((resolve, reject) => {
        const request = raw.objectStore("batchItems").get("item-1");
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      }),
    ).toMatchObject({ selected: false });

    const reloadedRepository = new IndexedDbBatchRepository(database, {
      defaultSpeechLanguageMode: "zh",
      now: () => 3,
    });
    expect((await reloadedRepository.read("job-1"))?.items[0].selected).toBe(
      false,
    );
    database.close();
  });

  it("cascades expanded lifecycle records when deleting a list", async () => {
    const name = `batch-list-delete-${crypto.randomUUID()}`;
    names.push(name);
    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const repository = new IndexedDbBatchRepository(database, { now: () => 1 });
    await repository.createJob(
      createBatchJob({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
        name: "list",
        status: "ready",
        updatedAt: 1,
      }),
      [],
    );
    const seed = database.transaction(["batchSourceHistory"], "readwrite");
    seed.objectStore("batchSourceHistory").put({
      addedAt: 1,
      batchJobId: "job-1",
      sourceHistoryId: "h1",
    });
    await new Promise<void>((resolve) =>
      seed.addEventListener("complete", () => resolve(), { once: true }),
    );

    await repository.deleteJob("job-1");
    const read = database.transaction(
      ["batchJobs", "workspaceBatchPlacements", "batchSourceHistory"],
      "readonly",
    );
    for (const storeName of [
      "batchJobs",
      "workspaceBatchPlacements",
      "batchSourceHistory",
    ]) {
      expect(
        await new Promise((resolve, reject) => {
          const request = read.objectStore(storeName).getAll();
          request.addEventListener("success", () => resolve(request.result), {
            once: true,
          });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        }),
      ).toEqual([]);
    }
    database.close();
  });

  describe("Batch list lifecycle placement", () => {
    async function openRepository(): Promise<{
      readonly database: IDBDatabase;
      readonly repository: IndexedDbBatchRepository;
    }> {
      const name = `batch-list-lifecycle-${crypto.randomUUID()}`;
      names.push(name);
      const database = await openBilimuzhiDatabase({
        factory: fakeIndexedDB,
        name,
      });
      const repository = new IndexedDbBatchRepository(database, {
        defaultSpeechLanguageMode: "zh",
        now: () => 100,
      });
      return { database, repository };
    }

    it("lists only workspace lists ordered by pinned then placement order", async () => {
      const { repository } = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      await repository.createList({
        batchJobId: "job-2",
        browserSessionId: "browser-1",
        createdAt: 2,
      });
      await repository.createList({
        batchJobId: "job-3",
        browserSessionId: "browser-1",
        createdAt: 3,
      });
      // 归档 job-3 与 job-1 的 placement 后，它们不再出现在 workspace 列表。
      await repository.moveListToArchive("job-3", 50);
      await repository.setPinned("job-2", true);

      const lists = await repository.listWorkspaceLists();
      expect(lists.map((entry) => entry.job.batchJobId)).toEqual([
        "job-2",
        "job-1",
      ]);
      expect(lists[0]?.pinned).toBe(true);
      expect(lists[1]?.pinned).toBe(false);
    });

    it("renames a list without treating the name as identity", async () => {
      const { repository } = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      const renamed = await repository.renameList("job-1", "  我的课程列表  ");
      expect(renamed?.name).toBe("我的课程列表");
      const lists = await repository.listWorkspaceLists();
      expect(lists[0]?.job.name).toBe("我的课程列表");
      expect(await repository.renameList("job-1", "   ")).toBeNull();
    });

    it("moves a list to trash with trash metadata and removes it from the workspace", async () => {
      const { repository } = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      await repository.moveListToTrash("job-1", {
        deletionReason: "user-delete",
        purgeAfter: null,
        retentionStartedAt: 200,
        trashedAt: 200,
        trashOrigin: "workspace",
      });
      expect(await repository.listWorkspaceLists()).toEqual([]);
      const database = repository as unknown as {
        readonly database: IDBDatabase;
      };
      const read = database.database.transaction(
        "trashBatchPlacements",
        "readonly",
      );
      const stored = await new Promise<unknown>((resolve, reject) => {
        const request = read.objectStore("trashBatchPlacements").get("job-1");
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      expect(stored).toMatchObject({
        batchJobId: "job-1",
        deletionReason: "user-delete",
        trashOrigin: "workspace",
      });
    });
  });

  describe("Batch archive/trash routing and tags", () => {
    async function openRepository(): Promise<IndexedDbBatchRepository> {
      const name = `batch-routing-${crypto.randomUUID()}`;
      names.push(name);
      const database = await openBilimuzhiDatabase({
        factory: fakeIndexedDB,
        name,
      });
      return new IndexedDbBatchRepository(database, {
        defaultSpeechLanguageMode: "zh",
        now: () => 100,
      });
    }

    it("lists archived lists and moves them to trash, restoring later", async () => {
      const repository = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      await repository.moveListToArchive("job-1", 50);

      const archived = await repository.listArchivedLists();
      expect(archived).toHaveLength(1);
      expect(archived[0]?.job.batchJobId).toBe("job-1");

      await repository.moveListToTrash("job-1", {
        deletionReason: "user-delete",
        purgeAfter: null,
        retentionStartedAt: 200,
        trashedAt: 200,
        trashOrigin: "archive",
      });
      expect(await repository.listArchivedLists()).toEqual([]);
      const trashed = await repository.listTrashedLists();
      expect(trashed[0]?.trashOrigin).toBe("archive");

      expect(await repository.restoreList("job-1")).toBe(true);
      expect(await repository.listTrashedLists()).toEqual([]);
      expect(await repository.listWorkspaceLists()).toHaveLength(1);
    });

    it("restores an archived list directly back to the workspace", async () => {
      const repository = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      await repository.setPinned("job-1", true);
      await repository.moveListToArchive("job-1", 50);

      expect(await repository.restoreList("job-1")).toBe(true);
      expect(await repository.listArchivedLists()).toEqual([]);
      const workspace = await repository.listWorkspaceLists();
      expect(workspace).toHaveLength(1);
      // 恢复保留 order/pinned（与 moveListToTrash 语义一致）。
      expect(workspace[0]?.pinned).toBe(true);
    });

    it("returns false when restoring a list that has no placement", async () => {
      const repository = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      expect(await repository.restoreList("missing-list")).toBe(false);
      expect(await repository.listWorkspaceLists()).toHaveLength(1);
    });

    it("purges a trashed list with full cascade", async () => {
      const repository = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      await repository.moveListToTrash("job-1", {
        deletionReason: "user-delete",
        purgeAfter: null,
        retentionStartedAt: 200,
        trashedAt: 200,
        trashOrigin: "workspace",
      });
      await repository.purgeList("job-1");
      expect(await repository.listTrashedLists()).toEqual([]);
      expect(await repository.listWorkspaceLists()).toEqual([]);
    });

    it("restores an archived list directly back to the workspace", async () => {
      const repository = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      await repository.setPinned("job-1", true);
      await repository.moveListToArchive("job-1", 50);

      expect(await repository.restoreList("job-1")).toBe(true);
      expect(await repository.listArchivedLists()).toEqual([]);
      const workspace = await repository.listWorkspaceLists();
      expect(workspace).toHaveLength(1);
      // 恢复保留 order/pinned（与 moveListToTrash 语义一致）。
      expect(workspace[0]?.pinned).toBe(true);
    });

    it("returns false when restoring a list that has no placement", async () => {
      const repository = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      expect(await repository.restoreList("missing-list")).toBe(false);
      expect(await repository.listWorkspaceLists()).toHaveLength(1);
    });

    it("purges a trashed list with full cascade", async () => {
      const repository = await openRepository();
      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      await repository.moveListToTrash("job-1", {
        deletionReason: "user-delete",
        purgeAfter: null,
        retentionStartedAt: 200,
        trashedAt: 200,
        trashOrigin: "workspace",
      });
      await repository.purgeList("job-1");
      expect(await repository.listTrashedLists()).toEqual([]);
      expect(await repository.listWorkspaceLists()).toEqual([]);
    });

    it("batch trash retention policy: read default, update with apply-to-existing, purge expired", async () => {
      const repository = await openRepository();
      // 默认策略 7 天
      const initial = await repository.getRetentionPolicy();
      expect(initial).toEqual({ durationDays: 7, kind: "duration" });

      await repository.createList({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
      });
      await repository.moveListToTrash("job-1", {
        deletionReason: "user-delete",
        purgeAfter: 2_000,
        retentionStartedAt: 1_000,
        trashedAt: 1_000,
        trashOrigin: "workspace",
      });
      // 应用到现有：purgeAfter 更新为 30 天
      await repository.updateRetentionPolicy(
        { durationDays: 30, kind: "duration" },
        "apply-to-existing",
      );
      const trashed = await repository.listTrashedLists();
      // openRepository 注入 now: () => 100；apply-to-existing 后
      // purgeAfter = 100 + 30 天。
      expect(trashed[0]?.purgeAfter).toBe(100 + 30 * 24 * 60 * 60 * 1_000);

      // 到期清理：purgeAfter 改为过去时间后清理
      const read = repository as unknown as {
        readonly database: IDBDatabase;
      };
      const db = read.database;
      const tx = db.transaction("trashBatchPlacements", "readwrite");
      const store = tx.objectStore("trashBatchPlacements");
      store.put({
        batchJobId: "job-1",
        deletionReason: "user-delete",
        order: 0,
        pinned: false,
        purgeAfter: 1_500,
        retentionStartedAt: 1_000,
        trashedAt: 1_000,
        trashOrigin: "workspace",
      });
      await new Promise<void>((resolve) => {
        tx.addEventListener("complete", () => resolve(), { once: true });
      });
      const purged = await repository.permanentlyDeleteExpiredBatchTrash(1_600);
      expect(purged).toEqual(["job-1"]);
      expect(await repository.listTrashedLists()).toEqual([]);
    });
  });
});
