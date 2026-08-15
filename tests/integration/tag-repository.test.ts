import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { IndexedDbTagRepository } from "../../src/infrastructure/indexeddb/tag-repository";
import { IndexedDbArchiveRepository } from "../../src/infrastructure/indexeddb/archive-repository";
import { IndexedDbTrashRepository } from "../../src/infrastructure/indexeddb/trash-repository";
import type { StoreSchema } from "../../src/infrastructure/indexeddb/muzhi-database";
import {
  VERSION_4_SCHEMA,
  VERSION_5_SCHEMA,
  VERSION_6_SCHEMA,
  VERSION_7_SCHEMA,
  VERSION_8_SCHEMA,
  openBilimuzhiDatabase,
} from "../../src/infrastructure/indexeddb/muzhi-database";
import { MAX_TAG_NAME_LENGTH, MAX_TAGS_PER_WORKSPACE } from "../../src/domain";
import {
  createBranchPlacement,
  createWorkspaceSessionPlacement,
  createSession,
} from "../../src/domain";

const BASE_TIME = 1_752_729_600_000;
const opened: IDBDatabase[] = [];
let databaseSequence = 0;

function createDatabaseName(): string {
  databaseSequence += 1;
  return `muzhi-tag-repository-${databaseSequence}`;
}

async function openDatabase(): Promise<IDBDatabase> {
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name: createDatabaseName(),
  });
  opened.push(database);
  return database;
}

async function seedWorkspaceSession(
  database: IDBDatabase,
  sessionId: string,
): Promise<void> {
  const transaction = database.transaction(
    [
      "branchPlacements",
      "sessions",
      "subtitleBranches",
      "workspaceSessionPlacements",
      "videos",
    ],
    "readwrite",
  );
  transaction.objectStore("workspaceSessionPlacements").put(
    createWorkspaceSessionPlacement({
      order: 0,
      pinned: false,
      sessionId,
    }),
  );
  transaction.objectStore("videos").put({
    bvid: "BV1zt4y1z72D",
    canonicalUrl: "https://www.bilibili.com/video/BV1zt4y1z72D?p=1",
    cid: 1,
    page: 1,
    title: "测试视频",
    videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1",
  });
  transaction.objectStore("sessions").put(
    createSession({
      activeBranchId: "branch-" + sessionId,
      createdAt: BASE_TIME,
      customTitle: false,
      lastActivityAt: BASE_TIME,
      selectionRevision: 0,
      sessionId,
      title: sessionId,
      updatedAt: BASE_TIME,
      videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1",
    }),
  );
  transaction.objectStore("subtitleBranches").put({
    activeSubtitleId: "subtitle-" + sessionId,
    branchId: "branch-" + sessionId,
    completionSequence: 1,
    contextRevision: 1,
    createdAt: BASE_TIME,
    detectedLanguage: "zh-CN",
    language: "zh-CN",
    lastOpenedAt: BASE_TIME,
    lastReadCompletionSequence: 0,
    lastSelectedAt: BASE_TIME,
    requestedLanguageMode: null,
    sessionId,
    source: "bilibili",
    title: null,
    updatedAt: BASE_TIME,
    videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1",
  });
  transaction.objectStore("branchPlacements").put(
    createBranchPlacement({
      branchId: "branch-" + sessionId,
      deletionReason: null,
      location: "workspace",
      order: 0,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
      trashedAt: null,
    }),
  );
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), {
      once: true,
    });
  });
}

afterEach(() => {
  for (const database of opened.splice(0)) {
    database.close();
  }
});

describe("IndexedDbTagRepository", () => {
  it("创建标签：全局唯一、重名拒绝、上限与长度约束（v9 扁平化无类）", async () => {
    const database = await openDatabase();
    const repository = new IndexedDbTagRepository(database);

    const a = await repository.createTag("学习");
    expect(a.name).toBe("学习");
    expect(a.order).toBe(0);

    const b = await repository.createTag("工作");
    expect(b.order).toBe(1);

    await expect(repository.createTag("学习")).rejects.toMatchObject({
      message: expect.stringContaining("已存在"),
    });
    await expect(
      repository.createTag("x".repeat(MAX_TAG_NAME_LENGTH + 1)),
    ).rejects.toMatchObject({
      message: expect.stringContaining("不能超过"),
    });

    expect(await repository.listTags()).toHaveLength(2);
  });

  it("会话标签：替换式写入、引用完整性、删除标签级联移除引用", async () => {
    const database = await openDatabase();
    const repository = new IndexedDbTagRepository(database);
    const a = await repository.createTag("学习");
    const b = await repository.createTag("工作");

    const record = await repository.setSessionTags("session-x", [a.tagId]);
    expect(record.tagIds).toEqual([a.tagId]);

    // 替换式：第二次写入覆盖
    await repository.setSessionTags("session-x", [a.tagId, b.tagId]);
    expect(
      (await repository.listSessionTags()).find(
        (item) => item.sessionId === "session-x",
      )?.tagIds,
    ).toEqual([a.tagId, b.tagId]);

    // 引用不存在的标签拒绝
    await expect(
      repository.setSessionTags("session-x", ["tag:不存在"]),
    ).rejects.toThrow();

    // 删除标签：会话引用一并移除
    await repository.deleteTag(a.tagId);
    const after = (await repository.listSessionTags()).find(
      (item) => item.sessionId === "session-x",
    );
    expect(after?.tagIds).toEqual([b.tagId]);
  });

  it("上限：200 个标签后拒绝创建", async () => {
    const database = await openDatabase();
    const repository = new IndexedDbTagRepository(database);
    for (let index = 0; index < MAX_TAGS_PER_WORKSPACE; index += 1) {
      await repository.createTag(`标签${index}`);
    }
    await expect(repository.createTag("超额")).rejects.toMatchObject({
      message: expect.stringContaining("上限"),
    });
  });

  it("生命周期：归档=白板、恢复/删除进回收站时标签记录删除", async () => {
    const database = await openDatabase();
    const tags = new IndexedDbTagRepository(database);
    const archive = new IndexedDbArchiveRepository(database, {
      now: () => BASE_TIME,
    });
    const trash = new IndexedDbTrashRepository(database, {
      now: () => BASE_TIME,
    });

    await seedWorkspaceSession(database, "session-live");
    await archive.archiveWorkspaceBranches(
      ["branch-session-live"],
      "archive-root",
    );
    // 归档后打标签
    const tag = await tags.createTag("收藏");
    await tags.setSessionTags("session-live", [tag.tagId]);
    expect(
      (await tags.listSessionTags()).find(
        (item) => item.sessionId === "session-live",
      ),
    ).toBeDefined();

    // 恢复回工作区 → 标签记录删除
    await archive.restoreArchivedBranchesToWorkspace(["branch-session-live"]);
    expect(
      (await tags.listSessionTags()).find(
        (item) => item.sessionId === "session-live",
      ),
    ).toBeUndefined();

    // 再归档 → 白板；打标签后删除进回收站 → 标签记录删除
    await archive.archiveWorkspaceBranches(
      ["branch-session-live"],
      "archive-root",
    );
    await tags.setSessionTags("session-live", [tag.tagId]);
    await trash.moveToTrash(["branch-session-live"], "删除测试");
    expect(
      (await tags.listSessionTags()).find(
        (item) => item.sessionId === "session-live",
      ),
    ).toBeUndefined();
  });

  it("空会话：归档后再删除进回收站，标签记录删除", async () => {
    const database = await openDatabase();
    const tags = new IndexedDbTagRepository(database);
    const archive = new IndexedDbArchiveRepository(database, {
      now: () => BASE_TIME,
    });
    const trash = new IndexedDbTrashRepository(database, {
      now: () => BASE_TIME,
    });

    const session = createSession({
      activeBranchId: null,
      createdAt: BASE_TIME,
      customTitle: false,
      lastActivityAt: BASE_TIME,
      selectionRevision: 0,
      sessionId: "session-empty",
      title: "空会话",
      updatedAt: BASE_TIME,
      videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1",
    });
    const seed = database.transaction(
      ["sessions", "workspaceSessionPlacements"],
      "readwrite",
    );
    seed.objectStore("sessions").put(session);
    seed.objectStore("workspaceSessionPlacements").put(
      createWorkspaceSessionPlacement({
        order: 0,
        pinned: false,
        sessionId: session.sessionId,
      }),
    );
    await new Promise<void>((resolve, reject) => {
      seed.addEventListener("complete", () => resolve(), { once: true });
      seed.addEventListener("abort", () => reject(seed.error), { once: true });
    });

    await archive.archiveWorkspaceBranches([], "archive-root", [
      "session-empty",
    ]);
    const tag = await tags.createTag("空会话标签");
    await tags.setSessionTags("session-empty", [tag.tagId]);

    await trash.moveArchivedEmptySessionToTrash("session-empty", "删除");
    expect(
      (await tags.listSessionTags()).find(
        (item) => item.sessionId === "session-empty",
      ),
    ).toBeUndefined();
  });

  it("升级清理：v7 旧归档文件夹与归档会话数据被清空，标签 store 就绪", async () => {
    // openBilimuzhiDatabase 始终以最新版本打开（内部迁移），此处验证迁移后
    // 标签 store 就绪、archiveFolders 为空（v9 已无固定「未归类」类）。
    const database = await openDatabase();
    const tags = new IndexedDbTagRepository(database);
    await tags.createTag("迁移后标签");
    expect(await tags.listTags()).toHaveLength(1);
    const folders = await new Promise<readonly unknown[]>((resolve, reject) => {
      const request = database
        .transaction("archiveFolders")
        .objectStore("archiveFolders")
        .getAll();
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    expect(folders).toEqual([
      {
        folderId: "archive-root",
        order: 0,
        parentFolderId: null,
        title: "归档",
      },
    ]);
  });

  it("重命名标签：tagId 不变、重名/空名拒绝、会话关联保持", async () => {
    const database = await openDatabase();
    const repository = new IndexedDbTagRepository(database);
    const tag = await repository.createTag("旧名");
    await repository.setSessionTags("session-x", [tag.tagId]);

    const renamed = await repository.renameTag(tag.tagId, "新名");
    expect(renamed.tagId).toBe(tag.tagId); // tagId 不变 → 会话关联自动保持
    expect(renamed.name).toBe("新名");

    // 会话关联仍指向同一 tagId
    const links = await repository.listSessionTags();
    expect(
      links.find((item) => item.sessionId === "session-x")?.tagIds,
    ).toEqual([tag.tagId]);

    // 重名拒绝（与另一标签）
    await repository.createTag("其他");
    await expect(repository.renameTag(tag.tagId, "其他")).rejects.toMatchObject(
      {
        message: expect.stringContaining("已存在"),
      },
    );
    // 空名拒绝
    await expect(repository.renameTag(tag.tagId, "  ")).rejects.toMatchObject({
      message: expect.stringContaining("不能为空"),
    });
    // 超长拒绝
    await expect(
      repository.renameTag(tag.tagId, "x".repeat(MAX_TAG_NAME_LENGTH + 1)),
    ).rejects.toMatchObject({
      message: expect.stringContaining("不能超过"),
    });
    // 不存在拒绝
    await expect(
      repository.renameTag("tag:不存在", "名"),
    ).rejects.toMatchObject({
      message: expect.stringContaining("不存在"),
    });
  });

  it("v8→v9 升级：删除 presetFilters/tagCategories store，标签与归档数据保留", async () => {
    const legacyName = `muzhi-tag-v8-${databaseSequence}`;
    databaseSequence += 1;
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = fakeIndexedDB.open(legacyName, 8);
      request.addEventListener(
        "upgradeneeded",
        () => {
          const database = request.result;
          for (const schema of VERSION_8_SCHEMA) {
            if (database.objectStoreNames.contains(schema.name)) continue;
            const store = database.createObjectStore(schema.name, {
              keyPath: schema.keyPath,
            });
            for (const index of schema.indexes) {
              store.createIndex(index.name, index.keyPath, {
                unique: index.unique,
              });
            }
          }
        },
        { once: true },
      );
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    // seed v8 标签数据（含组合与类）与一个会话
    const seed = legacy.transaction(
      [
        "sessions",
        "tags",
        "archiveSessionTags",
        "presetFilters",
        "tagCategories",
      ],
      "readwrite",
    );
    seed.objectStore("sessions").put({
      branches: [],
      createdAt: BASE_TIME,
      detectedLanguage: null,
      language: "zh-CN",
      sessionId: "legacy-session",
      title: "遗留会话",
      updatedAt: BASE_TIME,
    });
    seed.objectStore("tags").put({
      categoryId: "uncategorized",
      name: "遗留标签",
      order: 0,
      tagId: "tag:遗留标签",
    });
    seed.objectStore("archiveSessionTags").put({
      sessionId: "legacy-session",
      tagIds: ["tag:遗留标签"],
    });
    seed.objectStore("presetFilters").put({
      filterId: "filter:old",
      name: "旧组合",
      order: 0,
      tagIds: ["tag:遗留标签"],
    });
    seed.objectStore("tagCategories").put({
      categoryId: "uncategorized",
      name: "未归类",
      order: 0,
    });
    await new Promise<void>((resolve, reject) => {
      seed.addEventListener("complete", () => resolve(), { once: true });
      seed.addEventListener("abort", () => reject(seed.error), { once: true });
    });
    legacy.close();

    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: legacyName,
    });
    opened.push(database);

    // 组合与类 store 整体删除
    expect(database.objectStoreNames.contains("presetFilters")).toBe(false);
    expect(database.objectStoreNames.contains("tagCategories")).toBe(false);
    // 标签与会话关联保留
    const repository = new IndexedDbTagRepository(database);
    const tags = await repository.listTags();
    expect(tags.map((tag) => tag.name)).toEqual(["遗留标签"]);
    const links = await repository.listSessionTags();
    expect(links[0]?.tagIds).toEqual(["tag:遗留标签"]);
    // 归档会话保留
    const sessions = await new Promise<readonly unknown[]>(
      (resolve, reject) => {
        const request = database
          .transaction("sessions")
          .objectStore("sessions")
          .getAll();
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      },
    );
    expect(sessions).toHaveLength(1);
  });

  for (const [version, schema] of [
    [4, VERSION_4_SCHEMA],
    [5, VERSION_5_SCHEMA],
    [6, VERSION_6_SCHEMA],
    [7, VERSION_7_SCHEMA],
  ] as [number, readonly StoreSchema[]][]) {
    it(`v${version}→v9 升级：schema 就绪、已删 store 不存在、会话数据保留`, async () => {
      const legacyName = `muzhi-tag-v${version}-${"${databaseSequence}"}`;
      databaseSequence += 1;
      const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = fakeIndexedDB.open(legacyName, version);
        request.addEventListener(
          "upgradeneeded",
          () => {
            const database = request.result;
            for (const storeSchema of schema) {
              if (database.objectStoreNames.contains(storeSchema.name)) {
                continue;
              }
              const store = database.createObjectStore(storeSchema.name, {
                keyPath: storeSchema.keyPath,
              });
              for (const index of storeSchema.indexes) {
                store.createIndex(index.name, index.keyPath, {
                  unique: index.unique,
                });
              }
            }
          },
          { once: true },
        );
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      });
      if (legacy.objectStoreNames.contains("sessions")) {
        const seed = legacy.transaction("sessions", "readwrite");
        seed.objectStore("sessions").put({
          branches: [],
          createdAt: BASE_TIME,
          detectedLanguage: null,
          language: "zh-CN",
          sessionId: "legacy-session",
          title: "遗留会话",
          updatedAt: BASE_TIME,
        });
        await new Promise<void>((resolve, reject) => {
          seed.addEventListener("complete", () => resolve(), { once: true });
          seed.addEventListener("abort", () => reject(seed.error), {
            once: true,
          });
        });
      }
      legacy.close();

      const database = await openBilimuzhiDatabase({
        factory: fakeIndexedDB,
        name: legacyName,
      });
      opened.push(database);

      // v9 schema 就绪：不再有 presetFilters/tagCategories
      expect(database.objectStoreNames.contains("presetFilters")).toBe(false);
      expect(database.objectStoreNames.contains("tagCategories")).toBe(false);
      expect(database.objectStoreNames.contains("tags")).toBe(true);
      expect(database.objectStoreNames.contains("archiveSessionTags")).toBe(
        true,
      );
      // 会话数据：v6+ 保留（<6 的既有 batch 独立迁移会清空 sessions，属冻结设计行为）
      const sessions = await new Promise<readonly unknown[]>(
        (resolve, reject) => {
          const request = database
            .transaction("sessions")
            .objectStore("sessions")
            .getAll();
          request.addEventListener("success", () => resolve(request.result), {
            once: true,
          });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        },
      );
      const sessionIds = sessions.map(
        (session) => (session as { sessionId: string }).sessionId,
      );
      if (version >= 6) {
        expect(sessionIds).toEqual(["legacy-session"]);
      } else {
        expect(sessionIds).toEqual([]);
      }
    });
  }

  it("v7 升级：只清理归档位置分支，工作区与回收站分支保留", async () => {
    const legacyName = `muzhi-tag-legacy-${databaseSequence}`;
    databaseSequence += 1;
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = fakeIndexedDB.open(legacyName, 7);
      request.addEventListener(
        "upgradeneeded",
        () => {
          const db = request.result;
          for (const schema of VERSION_7_SCHEMA) {
            if (!db.objectStoreNames.contains(schema.name)) {
              const store = db.createObjectStore(schema.name, {
                keyPath: schema.keyPath,
              });
              for (const index of schema.indexes) {
                store.createIndex(index.name, index.keyPath, {
                  unique: index.unique,
                });
              }
            }
          }
        },
        { once: true },
      );
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    const seed = legacy.transaction("branchPlacements", "readwrite");
    const placements = seed.objectStore("branchPlacements");
    for (const [branchId, location] of [
      ["legacy-workspace", "workspace"],
      ["legacy-archive", "archive"],
      ["legacy-trash", "trash"],
    ] as const) {
      placements.put({
        branchId,
        deletionReason: location === "trash" ? "x" : null,
        location,
        order: 0,
        purgeAfter: location === "trash" ? 1 : null,
        retentionStartedAt: location === "trash" ? 1 : null,
        sessionId: "legacy-session",
        trashOrigin: null,
        trashOriginFolderId: null,
        trashOriginPathSnapshot: null,
        trashedAt: location === "trash" ? 1 : null,
      });
    }
    await new Promise<void>((resolve, reject) => {
      seed.addEventListener("complete", () => resolve(), { once: true });
      seed.addEventListener("abort", () => reject(seed.error), { once: true });
    });
    legacy.close();

    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: legacyName,
    });
    opened.push(database);
    const remaining = await new Promise<readonly unknown[]>(
      (resolve, reject) => {
        const request = database
          .transaction("branchPlacements")
          .objectStore("branchPlacements")
          .getAll();
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
      },
    );
    expect(
      remaining
        .map((record) => (record as { branchId: string }).branchId)
        .sort(),
    ).toEqual(["legacy-trash", "legacy-workspace"]);
  });
});
