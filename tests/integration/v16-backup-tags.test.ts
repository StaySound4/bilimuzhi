import { afterEach, describe, expect, it } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { createV12BackupRuntime } from "../../src/application/backup";
import { createV12BackupDataPort } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbTagRepository } from "../../src/infrastructure/indexeddb/tag-repository";

const opened: IDBDatabase[] = [];
let sequence = 0;

function createDatabaseName(): string {
  sequence += 1;
  return `muzhi-backup-tags-${sequence}`;
}

function createStorage() {
  const values = new Map<string, unknown>();
  return {
    get: async (key: string) => ({ [key]: structuredClone(values.get(key)) }),
    set: async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) {
        values.set(key, structuredClone(value));
      }
    },
  };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe("备份归档组标签数据", () => {
  it("导出归档组包含标签数据；导入整体替换并保留引用完整性", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    opened.push(database);
    const tags = new IndexedDbTagRepository(database);

    // 归档会话数据（标签引用完整性要求会话属于归档组）。
    const seed = database.transaction(
      ["archiveSessionPlacements", "sessions", "videos"],
      "readwrite",
    );
    seed.objectStore("videos").put({
      bvid: "BV1zt4y1z72D",
      canonicalUrl: "https://www.bilibili.com/video/BV1zt4y1z72D?p=1",
      cid: 1,
      page: 1,
      title: "测试视频",
      videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1",
    });
    for (const sessionId of ["archive-session-a", "archive-session-b"]) {
      seed.objectStore("archiveSessionPlacements").put({
        archivedAt: 1_700_000_000_000,
        folderId: "archive-root",
        order: 0,
        pinned: false,
        sessionId,
      });
      seed.objectStore("sessions").put({
        activeBranchId: null,
        createdAt: 1_700_000_000_000,
        customTitle: false,
        lastActivityAt: 1_700_000_000_000,
        selectionRevision: 0,
        sessionId,
        title: sessionId,
        updatedAt: 1_700_000_000_000,
        videoKey: "bvid:BV1zt4y1z72D:cid:1:p:1",
      });
    }
    await new Promise<void>((resolve, reject) => {
      seed.addEventListener("complete", () => resolve(), { once: true });
      seed.addEventListener("abort", () => reject(seed.error), { once: true });
    });

    const a = await tags.createTag("考试");
    const b = await tags.createTag("复习");
    await tags.setSessionTags("archive-session-a", [a.tagId]);
    await tags.setSessionTags("archive-session-b", [a.tagId, b.tagId]);

    const storage = createStorage();
    const runtime = createV12BackupRuntime({
      crypto: globalThis.crypto,
      data: createV12BackupDataPort({ database, settingsStorage: storage }),
      now: () => 1_700_000_000_000,
      randomUUID: () => "backup-tags-uuid",
    });

    const data = createV12BackupDataPort({
      database,
      settingsStorage: storage,
    });
    let exported: Awaited<ReturnType<typeof runtime.exportBackup>>;
    try {
      const raw = await data.readGroups(["archive"]);
      console.log("RAW-GROUP-KEYS:", Object.keys(raw.archive ?? {}).join(","));
      exported = await runtime.exportBackup({
        groups: ["archive"],
        includeKeys: false,
      });
    } catch (error) {
      console.log(
        "EXPORT-ERR:",
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
    const parsed = JSON.parse(exported.json) as {
      groups: {
        archive: {
          tags?: readonly Record<string, unknown>[];
        };
      };
    };
    expect(parsed.groups.archive.tags).toBeDefined();
    const tagNames = parsed.groups.archive
      .tags!.filter((record) => typeof record.tagId === "string")
      .map((record) => record.name as string);
    expect(tagNames).toContain("考试");
    expect(tagNames).toContain("复习");

    // 清空标签数据后导入：整体替换恢复
    const wipe = database.transaction(
      ["archiveSessionTags", "tags"],
      "readwrite",
    );
    for (const store of ["archiveSessionTags", "tags"]) {
      wipe.objectStore(store).clear();
    }
    await new Promise<void>((resolve, reject) => {
      wipe.addEventListener("complete", () => resolve(), { once: true });
      wipe.addEventListener("abort", () => reject(wipe.error), { once: true });
    });

    const preview = await runtime.previewImport({
      groups: ["archive"],
      json: exported.json,
    });
    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    const restored = new IndexedDbTagRepository(database);
    const restoredTags = await restored.listTags();
    expect(restoredTags.map((tag) => tag.name)).toEqual(
      expect.arrayContaining(["考试", "复习"]),
    );
    const restoredLinks = await restored.listSessionTags();
    expect(
      restoredLinks.find((record) => record.sessionId === "archive-session-b")
        ?.tagIds,
    ).toHaveLength(2);
  });

  it("导入含旧版标签类/组合记录的备份：忽略且不报错（v9 兼容）", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    opened.push(database);
    const tags = new IndexedDbTagRepository(database);
    await tags.createTag("兼容标签");

    const storage = createStorage();
    const runtime = createV12BackupRuntime({
      crypto: globalThis.crypto,
      data: createV12BackupDataPort({ database, settingsStorage: storage }),
      now: () => 1_700_000_000_000,
      randomUUID: () => "backup-tags-uuid-2",
    });

    // 模拟 v8 时代备份：archive 组含 tagCategories/presetFilters 记录
    const exported = await runtime.exportBackup({
      groups: ["archive"],
      includeKeys: false,
    });
    const parsed = JSON.parse(exported.json) as {
      groups: {
        archive: {
          tags?: readonly Record<string, unknown>[];
        };
      };
    };
    const tagsArray = [...(parsed.groups.archive.tags ?? [])];
    tagsArray.push(
      { categoryId: "category:old", name: "旧类", order: 0 },
      { filterId: "filter:old", name: "旧组合", order: 0, tagIds: [] },
    );
    parsed.groups.archive.tags = tagsArray;
    const legacyJson = JSON.stringify(parsed);

    const preview = await runtime.previewImport({
      groups: ["archive"],
      json: legacyJson,
    });
    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    // 类/组合记录被忽略；有效标签保留
    const after = new IndexedDbTagRepository(database);
    expect((await after.listTags()).map((item) => item.name)).toContain(
      "兼容标签",
    );
    expect((await after.listTags()).some((item) => item.name === "旧类")).toBe(
      false,
    );
  });
});
