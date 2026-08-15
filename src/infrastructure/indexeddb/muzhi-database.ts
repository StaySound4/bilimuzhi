import { StorageError } from "../../application/storage";
import {
  BackupError,
  isBatchBackupGroup,
  type BackupDataPort,
  type BackupGroup,
  type BackupImportRelocation,
} from "../../application/backup";
import {
  createArchiveFolder,
  createBranchPlacement,
  createTrashSessionPlacement,
  DEFAULT_TRASH_RETENTION_POLICY,
} from "../../domain";
import type { ChromeWorkspaceStorageArea } from "../chrome-workspace-state-store";
import {
  V12_SETTINGS_SECRET_STORAGE_KEY,
  V12_SETTINGS_STORAGE_KEY,
  V13_SETTINGS_SECRET_STORAGE_KEY,
  V13_SETTINGS_STORAGE_KEY,
} from "../provider-profile-settings";

export const MUZHI_DATABASE_NAME = "muzhi";
export const MUZHI_DATABASE_VERSION = 11;
export const ROOT_ARCHIVE_FOLDER_ID = "archive-root";

export interface OpenBilimuzhiDatabaseOptions {
  readonly factory?: IDBFactory;
  readonly name?: string;
  readonly defaultSpeechLanguageMode?: "zh" | "en" | "other" | "mixed" | "ja";
}

interface IndexSchema {
  readonly keyPath: string | readonly string[];
  readonly name: string;
  readonly unique: boolean;
}

export interface StoreSchema {
  readonly indexes: readonly IndexSchema[];
  readonly keyPath: string;
  readonly name: string;
}

const VERSION_1_SCHEMA: readonly StoreSchema[] = [
  {
    indexes: [
      { keyPath: "lastActivityAt", name: "byLastActivityAt", unique: false },
      { keyPath: "videoKey", name: "byVideoKey", unique: true },
    ],
    keyPath: "sessionId",
    name: "sessions",
  },
  {
    indexes: [
      { keyPath: "sessionId", name: "bySessionId", unique: false },
      {
        keyPath: ["sessionId", "status"],
        name: "bySessionStatus",
        unique: false,
      },
    ],
    keyPath: "subtitleId",
    name: "subtitleSnapshots",
  },
  { indexes: [], keyPath: "videoKey", name: "videos" },
];

const VERSION_2_SCHEMA: readonly StoreSchema[] = [
  {
    indexes: [
      {
        keyPath: ["parentFolderId", "order"],
        name: "byParentOrder",
        unique: false,
      },
    ],
    keyPath: "folderId",
    name: "archiveFolders",
  },
  {
    indexes: [
      {
        keyPath: ["folderId", "order"],
        name: "byFolderOrder",
        unique: false,
      },
    ],
    keyPath: "sessionId",
    name: "archiveSessionPlacements",
  },
  {
    indexes: [
      { keyPath: "branchId", name: "byBranchId", unique: false },
      {
        keyPath: ["sessionId", "branchId", "subtitleId", "kind"],
        name: "byOwnerKind",
        unique: true,
      },
      { keyPath: "sessionId", name: "bySessionId", unique: false },
    ],
    keyPath: "artifactId",
    name: "artifacts",
  },
  {
    indexes: [
      { keyPath: "branchId", name: "byBranchId", unique: false },
      { keyPath: "messageId", name: "byMessageId", unique: false },
      { keyPath: "sessionId", name: "bySessionId", unique: false },
    ],
    keyPath: "attachmentId",
    name: "attachments",
  },
  {
    indexes: [
      {
        keyPath: ["batchJobId", "order"],
        name: "byJobOrder",
        unique: true,
      },
      {
        keyPath: "resultBranchId",
        name: "byResultBranchId",
        unique: false,
      },
    ],
    keyPath: "batchItemId",
    name: "batchItems",
  },
  {
    indexes: [{ keyPath: "status", name: "byStatus", unique: false }],
    keyPath: "batchJobId",
    name: "batchJobs",
  },
  {
    indexes: [
      {
        keyPath: ["location", "order"],
        name: "byLocationOrder",
        unique: false,
      },
      { keyPath: "purgeAfter", name: "byPurgeAfter", unique: false },
      { keyPath: "sessionId", name: "bySessionId", unique: false },
      {
        keyPath: ["sessionId", "location"],
        name: "bySessionLocation",
        unique: false,
      },
    ],
    keyPath: "branchId",
    name: "branchPlacements",
  },
  {
    indexes: [
      { keyPath: "branchId", name: "byBranchId", unique: false },
      { keyPath: "sessionId", name: "bySessionId", unique: false },
      {
        keyPath: ["chatThreadId", "order"],
        name: "byThreadOrder",
        unique: true,
      },
    ],
    keyPath: "messageId",
    name: "chatMessages",
  },
  {
    indexes: [
      { keyPath: "branchId", name: "byBranchId", unique: false },
      {
        keyPath: ["sessionId", "branchId", "subtitleId", "order"],
        name: "byOwnerOrder",
        unique: true,
      },
      { keyPath: "sessionId", name: "bySessionId", unique: false },
    ],
    keyPath: "chatThreadId",
    name: "chatThreads",
  },
  {
    indexes: [
      { keyPath: "branchId", name: "byBranchId", unique: false },
      {
        keyPath: ["sessionId", "branchId", "subtitleId", "status"],
        name: "byOwnerStatus",
        unique: false,
      },
      { keyPath: "sessionId", name: "bySessionId", unique: false },
      { keyPath: "taskId", name: "byTaskId", unique: true },
    ],
    keyPath: "runId",
    name: "generationRuns",
  },
  {
    indexes: [
      { keyPath: "lastActivityAt", name: "byLastActivityAt", unique: false },
      { keyPath: "videoKey", name: "byVideoKey", unique: true },
    ],
    keyPath: "sessionId",
    name: "sessions",
  },
  {
    indexes: [
      { keyPath: "sessionId", name: "bySessionId", unique: false },
      {
        keyPath: ["sessionId", "lastOpenedAt"],
        name: "bySessionLastOpenedAt",
        unique: false,
      },
      { keyPath: "videoKey", name: "byVideoKey", unique: false },
    ],
    keyPath: "branchId",
    name: "subtitleBranches",
  },
  {
    indexes: [
      { keyPath: "branchId", name: "byBranchId", unique: false },
      { keyPath: "sessionId", name: "bySessionId", unique: false },
      {
        keyPath: ["sessionId", "status"],
        name: "bySessionStatus",
        unique: false,
      },
    ],
    keyPath: "subtitleId",
    name: "subtitleSnapshots",
  },
  { indexes: [], keyPath: "videoKey", name: "videos" },
  {
    indexes: [
      {
        keyPath: ["pinned", "order"],
        name: "byPinnedOrder",
        unique: false,
      },
    ],
    keyPath: "sessionId",
    name: "workspaceSessionPlacements",
  },
];

const VERSION_3_SCHEMA: readonly StoreSchema[] = Object.freeze([
  ...VERSION_2_SCHEMA.flatMap((store) => [
    store.name === "generationRuns"
      ? {
          ...store,
          indexes: [
            ...store.indexes.slice(0, 2),
            {
              keyPath: [
                "sessionId",
                "branchId",
                "subtitleId",
                "contextRevision",
                "kind",
                "targetId",
                "status",
              ],
              name: "byOwnerTargetStatus",
              unique: false,
            },
            ...store.indexes.slice(2),
          ],
        }
      : store,
    ...(store.name === "sessions"
      ? [{ indexes: [], keyPath: "key", name: "settings" }]
      : []),
  ]),
]);

export const VERSION_4_SCHEMA: readonly StoreSchema[] = Object.freeze(
  VERSION_3_SCHEMA.map((store) =>
    store.name === "sessions"
      ? {
          ...store,
          indexes: store.indexes.map((index) =>
            index.name === "byVideoKey" ? { ...index, unique: false } : index,
          ),
        }
      : store,
  ),
);

export const VERSION_5_SCHEMA: readonly StoreSchema[] = Object.freeze(
  VERSION_4_SCHEMA.flatMap((store) => [
    ...(store.name === "videos"
      ? [
          {
            indexes: [
              {
                keyPath: "purgeAfter",
                name: "byPurgeAfter",
                unique: false,
              },
            ],
            keyPath: "sessionId",
            name: "trashSessionPlacements",
          },
        ]
      : []),
    store,
  ]),
);

export const VERSION_6_SCHEMA: readonly StoreSchema[] = Object.freeze(
  VERSION_5_SCHEMA.flatMap((store) => [
    store,
    ...(store.name === "batchJobs"
      ? [
          {
            indexes: [],
            keyPath: "batchItemId",
            name: "batchSubtitles",
          },
        ]
      : []),
  ]),
);

export const VERSION_7_SCHEMA: readonly StoreSchema[] = Object.freeze(
  VERSION_6_SCHEMA.map((store) =>
    store.name === "attachments"
      ? {
          ...store,
          indexes: Object.freeze(
            [
              ...store.indexes,
              {
                keyPath: [
                  "sessionId",
                  "subtitleContextRevision",
                  "chatThreadId",
                  "messageId",
                ],
                name: "byOwner",
                unique: false,
              },
              {
                keyPath: "chatThreadId",
                name: "byThreadId",
                unique: false,
              },
            ].sort((left, right) => left.name.localeCompare(right.name)),
          ),
        }
      : store,
  ),
);

export const VERSION_8_SCHEMA: readonly StoreSchema[] = Object.freeze([
  ...VERSION_7_SCHEMA,
  {
    indexes: [],
    keyPath: "categoryId",
    name: "tagCategories",
  },
  {
    indexes: [{ keyPath: "categoryId", name: "byCategoryId", unique: false }],
    keyPath: "tagId",
    name: "tags",
  },
  {
    indexes: [],
    keyPath: "sessionId",
    name: "archiveSessionTags",
  },
  {
    indexes: [],
    keyPath: "filterId",
    name: "presetFilters",
  },
]);

// v9：产品决定砍掉「预设组合」与「标签类」——两个 store 及其数据整体移除，
// 标签系统扁平化（标签全局唯一、无类无组合）。
export const VERSION_9_SCHEMA: readonly StoreSchema[] = Object.freeze(
  VERSION_8_SCHEMA.filter(
    (store) => store.name !== "presetFilters" && store.name !== "tagCategories",
  ),
);

export const VERSION_10_SCHEMA: readonly StoreSchema[] = Object.freeze([
  ...VERSION_9_SCHEMA,
  { indexes: [], keyPath: "batchJobId", name: "workspaceBatchPlacements" },
  { indexes: [], keyPath: "batchJobId", name: "archiveBatchPlacements" },
  {
    indexes: [{ keyPath: "purgeAfter", name: "byPurgeAfter", unique: false }],
    keyPath: "batchJobId",
    name: "trashBatchPlacements",
  },
  { indexes: [], keyPath: "tagId", name: "batchTags" },
  { indexes: [], keyPath: "batchJobId", name: "archiveBatchTags" },
  {
    indexes: [
      {
        keyPath: ["batchJobId", "addedAt"],
        name: "byJobAddedAt",
        unique: false,
      },
    ],
    keyPath: "sourceHistoryId",
    name: "batchSourceHistory",
  },
]);

// v11：批量标签系统整体删除（Ticket 05）——batchTags/archiveBatchTags
// 两个 store 及备份中的标签数据不再存在；升级时删除 store 与关联数据。
export const VERSION_11_SCHEMA: readonly StoreSchema[] = Object.freeze(
  VERSION_10_SCHEMA.filter(
    (store) => store.name !== "batchTags" && store.name !== "archiveBatchTags",
  ),
);

const V9_MIGRATION_MARKER_KEY = "batchIndependentMigrationV9";
const V9_LEGACY_OWNED_STORES = Object.freeze([
  "archiveFolders",
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
] as const);

function mutableKeyPath(
  keyPath: string | readonly string[],
): string | string[] {
  return typeof keyPath === "string" ? keyPath : [...keyPath];
}

function createStore(
  database: IDBDatabase,
  schema: StoreSchema,
): IDBObjectStore {
  const store = database.createObjectStore(schema.name, {
    keyPath: schema.keyPath,
  });
  for (const indexSchema of schema.indexes) {
    store.createIndex(indexSchema.name, mutableKeyPath(indexSchema.keyPath), {
      unique: indexSchema.unique,
    });
  }
  return store;
}

function ensureVersion11Schema(
  database: IDBDatabase,
  transaction: IDBTransaction,
): void {
  for (const schema of VERSION_11_SCHEMA) {
    if (!database.objectStoreNames.contains(schema.name)) {
      createStore(database, schema);
      continue;
    }
    const store = transaction.objectStore(schema.name);
    for (const index of schema.indexes) {
      if (store.indexNames.contains(index.name)) {
        const existing = store.index(index.name);
        if (
          hasKeyPath(existing.keyPath, index.keyPath) &&
          existing.unique === index.unique
        ) {
          continue;
        }
        store.deleteIndex(index.name);
      }
      store.createIndex(index.name, mutableKeyPath(index.keyPath), {
        unique: index.unique,
      });
    }
  }
  // 9：预设组合与标签类整体删除——数据按产品决定直接清除，不保留。
  for (const obsolete of ["presetFilters", "tagCategories"]) {
    if (database.objectStoreNames.contains(obsolete)) {
      transaction.objectStore(obsolete).clear();
      database.deleteObjectStore(obsolete);
    }
  }
  // v11：批量标签 store 整体删除（Ticket 05）。
  for (const obsolete of ["batchTags", "archiveBatchTags"]) {
    if (database.objectStoreNames.contains(obsolete)) {
      transaction.objectStore(obsolete).clear();
      database.deleteObjectStore(obsolete);
    }
  }
  // 回收站保留策略默认值兜底（仅在缺失时写入，不覆盖用户已保存设置）。
  for (const key of ["trashRetention", "batchTrashRetention"]) {
    const settings = transaction.objectStore("settings");
    const existing = settings.get(key);
    existing.addEventListener("success", () => {
      if (existing.result === undefined) {
        settings.put({
          key,
          policy: DEFAULT_TRASH_RETENTION_POLICY,
          updatedAt: 0,
        });
      }
    });
  }
}

function migrateBatchListsV10(
  transaction: IDBTransaction,
  defaultSpeechLanguageMode: "zh" | "en" | "other" | "mixed" | "ja",
): void {
  const jobs = transaction.objectStore("batchJobs");
  const workspace = transaction.objectStore("workspaceBatchPlacements");
  const request = jobs.openCursor();
  let order = 0;
  const occupiedNames = new Set<string>();
  request.addEventListener("success", () => {
    const cursor = request.result;
    if (cursor === null) return;
    const record = cursor.value as Record<string, unknown>;
    const baseName =
      typeof record.sourceLabel === "string" &&
      record.sourceLabel.trim().length > 0
        ? record.sourceLabel.trim().slice(0, 200)
        : "新建列表";
    let name = baseName;
    let suffix = 2;
    while (occupiedNames.has(name)) {
      const suffixText = String(suffix);
      name = `${baseName.slice(0, 200 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    occupiedNames.add(name);
    cursor.update({ ...record, name });
    workspace.put({
      batchJobId: String(record.batchJobId),
      order,
      pinned: false,
    });
    order += 1;
    cursor.continue();
  });

  const items = transaction.objectStore("batchItems");
  const itemRequest = items.openCursor();
  itemRequest.addEventListener("success", () => {
    const cursor = itemRequest.result;
    if (cursor === null) return;
    const record = cursor.value as Record<string, unknown>;
    const language =
      typeof record.selectedLanguage === "string"
        ? record.selectedLanguage.trim().toLowerCase()
        : "";
    const existing = record.speechLanguageMode;
    const speechLanguageMode =
      existing === "zh" ||
      existing === "en" ||
      existing === "other" ||
      existing === "mixed"
        ? existing
        : language.startsWith("zh")
          ? "zh"
          : language.startsWith("en")
            ? "en"
            : language === "other"
              ? "other"
              : defaultSpeechLanguageMode;
    cursor.update({ ...record, selected: false, speechLanguageMode });
    cursor.continue();
  });
}

async function clearLegacyArchiveData(
  transaction: IDBTransaction,
): Promise<void> {
  try {
    transaction.objectStore("archiveFolders").clear();
  } catch {
    // 版本过旧时该 store 可能不存在——跳过。
  }
  try {
    transaction.objectStore("archiveSessionPlacements").clear();
  } catch {
    // 版本过旧时该 store 可能不存在——跳过。
  }
  let branchPlacements: IDBObjectStore;
  try {
    branchPlacements = transaction.objectStore("branchPlacements");
  } catch {
    return;
  }
  // 只清理归档位置的 branch placement（避免孤儿投影）；工作区/回收站保留。
  const archivedBranchIds = new Set<string>();
  for (const placement of await migrateAll(branchPlacements)) {
    if ((placement as { location?: string }).location === "archive") {
      archivedBranchIds.add((placement as { branchId: string }).branchId);
    }
  }
  for (const branchId of archivedBranchIds) {
    branchPlacements.delete(branchId);
  }
  // 归档操作仍以固定根文件夹为占位（8a 起不再参与分组展示）。
  transaction.objectStore("archiveFolders").put(
    createArchiveFolder({
      folderId: ROOT_ARCHIVE_FOLDER_ID,
      order: 0,
      parentFolderId: null,
      title: "归档",
    }),
  );
}

function hasVersion11Schema(database: IDBDatabase): boolean {
  return (
    VERSION_11_SCHEMA.every((schema) =>
      database.objectStoreNames.contains(schema.name),
    ) &&
    !database.objectStoreNames.contains("presetFilters") &&
    !database.objectStoreNames.contains("tagCategories") &&
    !database.objectStoreNames.contains("batchTags") &&
    !database.objectStoreNames.contains("archiveBatchTags")
  );
}

function migrateBatchIndependentV9(transaction: IDBTransaction): void {
  // v4/v5/v6 可能缺少部分 store（如 batchJobs 到 v5、attachments 到 v6 才加入），
  // 必须跳过不存在的 store，否则版本变更事务直接中止（真实升级失败）。
  for (const storeName of V9_LEGACY_OWNED_STORES) {
    try {
      transaction.objectStore(storeName).clear();
    } catch {
      // v4/v5/v6 可能缺少部分 store（如 batchJobs 到 v5、attachments 到 v6
      // 才加入）——跳过，否则版本变更事务直接中止（真实升级失败）。
    }
  }
  try {
    transaction.objectStore("batchSubtitles").clear();
  } catch {
    // batchSubtitles 仅 v5+ 存在。
  }
  let archiveFolders: IDBObjectStore;
  try {
    archiveFolders = transaction.objectStore("archiveFolders");
  } catch {
    return;
  }
  archiveFolders.put(
    createArchiveFolder({
      folderId: ROOT_ARCHIVE_FOLDER_ID,
      order: 0,
      parentFolderId: null,
      title: "归档",
    }),
  );
  transaction.objectStore("settings").put({
    completed: true,
    key: V9_MIGRATION_MARKER_KEY,
    updatedAt: 0,
  });
}

function hasSchema(
  database: IDBDatabase,
  transaction: IDBTransaction,
  schema: readonly StoreSchema[],
): boolean {
  if (
    !hasNames(
      database.objectStoreNames,
      schema.map((store) => store.name),
    )
  ) {
    return false;
  }
  try {
    return schema.every((storeSchema) => {
      const store = transaction.objectStore(storeSchema.name);
      return (
        hasKeyPath(store.keyPath, storeSchema.keyPath) &&
        hasNames(
          store.indexNames,
          storeSchema.indexes.map((index) => index.name),
        ) &&
        storeSchema.indexes.every((indexSchema) => {
          const index = store.index(indexSchema.name);
          return (
            hasKeyPath(index.keyPath, indexSchema.keyPath) &&
            index.unique === indexSchema.unique
          );
        })
      );
    });
  } catch {
    return false;
  }
}

function hasNames(actual: DOMStringList, expected: readonly string[]): boolean {
  // 集合语义：只要求名称集合相等，不关心顺序（创建顺序在浏览器与
  // 测试实现间不一致，逐索引比较会使 schema 校验误判失败）。
  return (
    actual.length === expected.length &&
    expected.every((name) => actual.contains(name))
  );
}

function hasKeyPath(
  actual: string | string[] | null,
  expected: string | readonly string[],
): boolean {
  if (typeof expected === "string") {
    return actual === expected;
  }
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((value, index) => actual[index] === value)
  );
}

export function openBilimuzhiDatabase(
  options: OpenBilimuzhiDatabaseOptions = {},
): Promise<IDBDatabase> {
  const factory = options.factory ?? globalThis.indexedDB;
  const name = options.name ?? MUZHI_DATABASE_NAME;

  return new Promise((resolve, reject) => {
    let settled = false;
    let migrationFailed = false;
    let migrationFailureVersion: number | null = null;
    const fail = (error: StorageError): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    };
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, MUZHI_DATABASE_VERSION);
    } catch {
      fail(new StorageError("Unable to open the Bilimuzhi database"));
      return;
    }

    request.addEventListener(
      "upgradeneeded",
      (event) => {
        const transaction = request.transaction;
        if (settled || transaction === null) {
          transaction?.abort();
          return;
        }
        const oldVersion = event.oldVersion;
        if (
          oldVersion !== 0 &&
          oldVersion !== 1 &&
          oldVersion !== 2 &&
          oldVersion !== 3 &&
          oldVersion !== 4 &&
          oldVersion !== 5 &&
          oldVersion !== 6 &&
          oldVersion !== 7 &&
          oldVersion !== 8 &&
          oldVersion !== 9 &&
          oldVersion !== 10
        ) {
          transaction.abort();
          return;
        }
        const failMigration = (): void => {
          migrationFailed = true;
          migrationFailureVersion ??= oldVersion;
          try {
            transaction.abort();
          } catch {
            // The versionchange transaction may already be aborting.
          }
        };
        try {
          if (
            oldVersion === 1 &&
            !hasSchema(request.result, transaction, VERSION_1_SCHEMA)
          ) {
            failMigration();
            return;
          }
          if (
            oldVersion === 2 &&
            !hasSchema(request.result, transaction, VERSION_2_SCHEMA)
          ) {
            failMigration();
            return;
          }
          if (
            oldVersion === 3 &&
            !hasSchema(request.result, transaction, VERSION_3_SCHEMA)
          ) {
            failMigration();
            return;
          }
          if (
            oldVersion === 4 &&
            !hasSchema(request.result, transaction, VERSION_4_SCHEMA)
          ) {
            failMigration();
            return;
          }
          if (
            oldVersion === 5 &&
            !hasSchema(request.result, transaction, VERSION_5_SCHEMA)
          ) {
            failMigration();
            return;
          }
          if (
            oldVersion === 6 &&
            !hasSchema(request.result, transaction, VERSION_6_SCHEMA)
          ) {
            failMigration();
            return;
          }
          if (
            oldVersion === 7 &&
            !hasSchema(request.result, transaction, VERSION_7_SCHEMA)
          ) {
            failMigration();
            return;
          }
          if (
            oldVersion === 8 &&
            !hasSchema(request.result, transaction, VERSION_8_SCHEMA)
          ) {
            failMigration();
            return;
          }
          if (
            oldVersion === 9 &&
            !hasSchema(request.result, transaction, VERSION_9_SCHEMA)
          ) {
            failMigration();
            return;
          }
          // 直接按 v11 创建缺失 store 并删除已废弃的 presetFilters/tagCategories
          // 与批量标签 store；不再先建 v8/v10（同一事务内先建后删不可靠）。
          ensureVersion11Schema(request.result, transaction);
          // v10 库已存在 workspaceBatchPlacements（v9→v10 迁移产物）：
          // 重跑 migrateBatchListsV10 会覆盖用户改名/置顶/顺序并把
          // 归档/回收站列表复制进工作区，因此只在 v6–v9 升级时执行。
          if (oldVersion >= 6 && oldVersion < 10)
            migrateBatchListsV10(
              transaction,
              options.defaultSpeechLanguageMode ?? "mixed",
            );
          // The v6 -> v7 attachment-index migration is additive and must not
          // touch existing user data. Older upgrades retain their already
          // frozen destructive batch-independence migration behavior.
          if (oldVersion < 6) migrateBatchIndependentV9(transaction);
          // 8a：旧归档文件夹树废弃——最后执行归档区数据清理，
          // 避免 v9 迁移重新写入的 archive-root 复活。
          void clearLegacyArchiveData(transaction).catch(() => {
            // 归档区清理是幂等收尾；失败不阻断升级（事务会等待其 IDB 请求）。
          });
        } catch {
          // 升级失败由 failMigration 汇总为存储错误。
          failMigration();
        }
      },
      { once: true },
    );
    request.addEventListener(
      "success",
      () => {
        const database = request.result;
        if (settled) {
          database.close();
          return;
        }
        if (!hasVersion11Schema(database)) {
          database.close();
          fail(new StorageError("The Bilimuzhi database schema is invalid"));
          return;
        }
        database.addEventListener("versionchange", () => database.close());
        settled = true;
        resolve(database);
      },
      { once: true },
    );
    request.addEventListener(
      "error",
      () =>
        fail(
          new StorageError(
            migrationFailed
              ? `The Bilimuzhi version ${migrationFailureVersion ?? "unknown"} data cannot be migrated safely`
              : "Unable to open the Bilimuzhi database",
          ),
        ),
      { once: true },
    );
    request.addEventListener(
      "blocked",
      () =>
        fail(
          new StorageError(
            "The Bilimuzhi database upgrade is blocked by another connection",
            true,
          ),
        ),
      { once: true },
    );
  });
}

function migrateAll(store: IDBObjectStore): Promise<readonly unknown[]> {
  return new Promise<readonly unknown[]>((resolve, reject) => {
    const request = store.getAll();
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function backupRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

function backupTransactionDone(transaction: IDBTransaction): Promise<void> {
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

function backupRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const BACKUP_PLACEMENT_STORES = Object.freeze({
  archive: "archiveSessionPlacements",
  trash: "trashSessionPlacements",
  workspace: "workspaceSessionPlacements",
} as const);

type BackupPlacement = keyof typeof BACKUP_PLACEMENT_STORES;

const BACKUP_SESSION_GRAPH_STORES = Object.freeze([
  "subtitleBranches",
  "subtitleSnapshots",
  "chatThreads",
  "chatMessages",
  "artifacts",
  "generationRuns",
  "attachments",
  "videos",
] as const);

const BACKUP_DATABASE_STORES = Object.freeze([
  "sessions",
  "branchPlacements",
  ...BACKUP_SESSION_GRAPH_STORES,
  ...Object.values(BACKUP_PLACEMENT_STORES),
  "archiveFolders",
  "archiveSessionTags",
  "tags",
  "batchJobs",
  "batchItems",
  "batchSubtitles",
  "batchSourceHistory",
  "workspaceBatchPlacements",
  "archiveBatchPlacements",
  "trashBatchPlacements",
] as const);

const BACKUP_STORE_KEYS: Readonly<Record<string, string>> = Object.freeze({
  archiveBatchPlacements: "batchJobId",
  archiveFolders: "folderId",
  archiveSessionPlacements: "sessionId",
  archiveSessionTags: "sessionId",
  batchItems: "batchItemId",
  batchJobs: "batchJobId",
  batchSourceHistory: "sourceHistoryId",
  batchSubtitles: "batchItemId",
  tags: "tagId",
  artifacts: "artifactId",
  branchPlacements: "branchId",
  attachments: "attachmentId",
  chatMessages: "messageId",
  chatThreads: "chatThreadId",
  generationRuns: "runId",
  sessions: "sessionId",
  subtitleBranches: "branchId",
  subtitleSnapshots: "subtitleId",
  trashSessionPlacements: "sessionId",
  videos: "videoKey",
  workspaceSessionPlacements: "sessionId",
});

type BackupDatabaseSnapshot = Readonly<
  Record<string, readonly Record<string, unknown>[]>
>;

interface IncomingBackupGraph {
  readonly branchPlacements: Readonly<
    Record<BackupPlacement, readonly ReturnType<typeof createBranchPlacement>[]>
  >;
  readonly folders: readonly Record<string, unknown>[];
  /** 归档组附带的标签数据（Tag + ArchiveSessionTags + 未归类类）。 */
  readonly tags: readonly Record<string, unknown>[];
  readonly graph: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  readonly selectedPlacements: readonly BackupPlacement[];
  readonly sessions: Readonly<
    Record<BackupPlacement, readonly Record<string, unknown>[]>
  >;
}

function backupString(
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | null {
  return typeof record[key] === "string" && record[key].length > 0
    ? record[key]
    : null;
}

function requireBackupString(
  record: Readonly<Record<string, unknown>>,
  key: string,
  context: string,
): string {
  const value = backupString(record, key);
  if (value === null) {
    throw new Error(`Invalid ${context} ${key}`);
  }
  return value;
}

function tagRecordStoreName(
  record: Readonly<Record<string, unknown>>,
): "archiveSessionTags" | "tags" | null {
  if (typeof record.tagId === "string") return "tags";
  if (typeof record.sessionId === "string") return "archiveSessionTags";
  // 旧备份可能含标签类/预设组合记录（v9 已删除）——导入时忽略，不报错。
  if (typeof record.categoryId === "string") return null;
  if (typeof record.filterId === "string") return null;
  throw new Error("Invalid archive tag record");
}

function backupArray(
  group: Readonly<Record<string, unknown>>,
  key: string,
): readonly Record<string, unknown>[] {
  const value = group[key];
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((record) => !backupRecord(record))) {
    throw new Error(`Invalid backup ${key} collection`);
  }
  return value as readonly Record<string, unknown>[];
}

function assertUniqueKeys(
  records: readonly Record<string, unknown>[],
  storeName: string,
): void {
  const keyName = BACKUP_STORE_KEYS[storeName];
  if (keyName === undefined)
    throw new Error(`Unknown backup store ${storeName}`);
  const keys = new Set<string>();
  for (const record of records) {
    const key = requireBackupString(record, keyName, storeName);
    if (keys.has(key)) throw new Error(`Duplicate ${storeName} key`);
    keys.add(key);
  }
}

function backupBranchPlacementFromSession(
  placement: BackupPlacement,
  branch: Readonly<Record<string, unknown>>,
  session: Readonly<Record<string, unknown>>,
  order: number,
): Record<string, unknown> {
  const branchId = requireBackupString(branch, "branchId", "subtitleBranches");
  const sessionId = requireBackupString(session, "sessionId", "sessions");
  if (placement !== "trash") {
    return {
      branchId,
      deletionReason: null,
      location: placement,
      order,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId,
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    };
  }
  const trashOrigin =
    session.trashOrigin === "archive" ? "archive" : "workspace";
  return {
    branchId,
    deletionReason:
      typeof session.deletionReason === "string"
        ? session.deletionReason
        : "backup-import",
    location: "trash",
    order: typeof session.order === "number" ? session.order : order,
    purgeAfter:
      typeof session.purgeAfter === "number" ? session.purgeAfter : null,
    retentionStartedAt:
      typeof session.retentionStartedAt === "number"
        ? session.retentionStartedAt
        : typeof session.trashedAt === "number"
          ? session.trashedAt
          : 0,
    sessionId,
    trashedAt: typeof session.trashedAt === "number" ? session.trashedAt : 0,
    trashOrigin,
    trashOriginFolderId:
      trashOrigin === "archive" &&
      typeof session.trashOriginFolderId === "string"
        ? session.trashOriginFolderId
        : null,
    trashOriginPathSnapshot:
      trashOrigin === "archive" &&
      typeof session.trashOriginPathSnapshot === "string"
        ? session.trashOriginPathSnapshot
        : null,
  };
}

function validateIncomingBackupGraph(
  groups: Partial<Record<BackupGroup, unknown>>,
): IncomingBackupGraph {
  const selectedPlacements = (
    ["workspace", "archive", "trash"] as const
  ).filter((placement) => groups[placement] !== undefined);
  const branchPlacements: Record<
    BackupPlacement,
    readonly ReturnType<typeof createBranchPlacement>[]
  > = { archive: [], trash: [], workspace: [] };
  const sessions: Record<BackupPlacement, readonly Record<string, unknown>[]> =
    { archive: [], trash: [], workspace: [] };
  const graph: Record<string, Record<string, unknown>[]> = Object.fromEntries(
    BACKUP_SESSION_GRAPH_STORES.map((storeName) => [storeName, []]),
  );
  const exportedVideos = new Map<string, Record<string, unknown>>();
  let folders: readonly Record<string, unknown>[] = [];
  let tags: readonly Record<string, unknown>[] = [];
  const selectedSessions = new Map<string, Record<string, unknown>>();

  for (const placement of selectedPlacements) {
    const group = groups[placement];
    if (!backupRecord(group)) throw new Error(`Invalid ${placement} group`);
    const placementSessions = backupArray(group, "sessions");
    sessions[placement] = placementSessions;
    const sessionIds = new Set<string>();
    const videoKeys = new Set<string>();
    for (const session of placementSessions) {
      const sessionId = requireBackupString(session, "sessionId", "session");
      const videoKey = requireBackupString(session, "videoKey", "session");
      if (sessionIds.has(sessionId)) {
        throw new Error("A Session is duplicated in one backup group");
      }
      const existingSession = selectedSessions.get(sessionId);
      const normalizedSession = sessionRecordWithoutPlacement(session);
      if (
        existingSession !== undefined &&
        JSON.stringify(existingSession) !== JSON.stringify(normalizedSession)
      ) {
        throw new Error("Selected placements contain conflicting Session data");
      }
      if (session.placement !== undefined && session.placement !== placement) {
        throw new Error("Session placement does not match its backup group");
      }
      sessionIds.add(sessionId);
      videoKeys.add(videoKey);
      selectedSessions.set(sessionId, normalizedSession);
    }

    const placementGraph = Object.fromEntries(
      BACKUP_SESSION_GRAPH_STORES.map((storeName) => [
        storeName,
        backupArray(group, storeName),
      ]),
    ) as Record<string, readonly Record<string, unknown>[]>;
    const storedBranchPlacements = backupArray(group, "branchPlacements");
    const sessionById = new Map(
      placementSessions.map((session) => [
        requireBackupString(session, "sessionId", "sessions"),
        session,
      ]),
    );
    const normalizedBranchPlacements = (
      storedBranchPlacements.length > 0
        ? storedBranchPlacements
        : placementGraph.subtitleBranches.map((branch, order) => {
            const sessionId = requireBackupString(
              branch,
              "sessionId",
              "subtitleBranches",
            );
            const session = sessionById.get(sessionId);
            if (session === undefined) {
              throw new Error("Subtitle branch has an orphan Session owner");
            }
            return backupBranchPlacementFromSession(
              placement,
              branch,
              session,
              order,
            );
          })
    ).map((record) =>
      createBranchPlacement(
        record as unknown as Parameters<typeof createBranchPlacement>[0],
      ),
    );
    for (const branchPlacement of normalizedBranchPlacements) {
      if (branchPlacement.location !== placement) {
        throw new Error("Branch placement does not match its backup group");
      }
      if (!sessionIds.has(branchPlacement.sessionId)) {
        throw new Error("Branch placement has an orphan Session owner");
      }
    }
    branchPlacements[placement] = normalizedBranchPlacements;
    const threadIds = new Set(
      placementGraph.chatThreads.map((record) => {
        const sessionId = requireBackupString(
          record,
          "sessionId",
          "chatThreads",
        );
        if (!sessionIds.has(sessionId)) {
          throw new Error("Chat thread has an orphan Session owner");
        }
        return requireBackupString(record, "chatThreadId", "chatThreads");
      }),
    );
    const messageOwners = new Map(
      placementGraph.chatMessages.map((record) => {
        const threadId = requireBackupString(
          record,
          "chatThreadId",
          "chatMessages",
        );
        if (!threadIds.has(threadId)) {
          throw new Error("Chat message has an orphan thread owner");
        }
        return [
          requireBackupString(record, "messageId", "chatMessages"),
          threadId,
        ] as const;
      }),
    );
    const branches = new Map(
      placementGraph.subtitleBranches.map((record) => {
        const sessionId = requireBackupString(
          record,
          "sessionId",
          "subtitleBranches",
        );
        if (!sessionIds.has(sessionId)) {
          throw new Error("Subtitle branch has an orphan Session owner");
        }
        return [
          requireBackupString(record, "branchId", "subtitleBranches"),
          record,
        ] as const;
      }),
    );
    const branchIds = new Set(branches.keys());
    const placementBranchIds = new Set(
      normalizedBranchPlacements.map((record) => record.branchId),
    );
    if (
      branchIds.size !== placementBranchIds.size ||
      [...branchIds].some((branchId) => !placementBranchIds.has(branchId))
    ) {
      throw new Error("Branch placements do not match subtitle branches");
    }
    for (const branchPlacement of normalizedBranchPlacements) {
      const branch = branches.get(branchPlacement.branchId);
      if (
        branch === undefined ||
        backupString(branch, "sessionId") !== branchPlacement.sessionId
      ) {
        throw new Error("Branch placement owner does not match its Branch");
      }
    }
    const subtitles = new Map(
      placementGraph.subtitleSnapshots.map((record) => [
        requireBackupString(record, "subtitleId", "subtitleSnapshots"),
        record,
      ]),
    );

    for (const storeName of [
      "subtitleSnapshots",
      "artifacts",
      "generationRuns",
      "attachments",
    ] as const) {
      for (const record of placementGraph[storeName]) {
        const sessionId = requireBackupString(record, "sessionId", storeName);
        if (!sessionIds.has(sessionId)) {
          throw new Error(`${storeName} has an orphan Session owner`);
        }
        const branchId = backupString(record, "branchId");
        if (branchId !== null && !branchIds.has(branchId)) {
          throw new Error(`${storeName} has an orphan subtitle branch owner`);
        }
      }
    }
    for (const attachment of placementGraph.attachments) {
      const sessionId = requireBackupString(
        attachment,
        "sessionId",
        "attachments",
      );
      const branchId = requireBackupString(
        attachment,
        "branchId",
        "attachments",
      );
      const subtitleId = requireBackupString(
        attachment,
        "subtitleId",
        "attachments",
      );
      const threadId = requireBackupString(
        attachment,
        "chatThreadId",
        "attachments",
      );
      const messageId = requireBackupString(
        attachment,
        "messageId",
        "attachments",
      );
      const branch = branches.get(branchId);
      const subtitle = subtitles.get(subtitleId);
      const thread = placementGraph.chatThreads.find(
        (record) => backupString(record, "chatThreadId") === threadId,
      );
      if (
        branch === undefined ||
        backupString(branch, "sessionId") !== sessionId ||
        backupString(branch, "activeSubtitleId") !== subtitleId ||
        subtitle === undefined ||
        backupString(subtitle, "sessionId") !== sessionId ||
        backupString(subtitle, "branchId") !== branchId ||
        thread === undefined ||
        backupString(thread, "sessionId") !== sessionId ||
        backupString(thread, "branchId") !== branchId ||
        backupString(thread, "subtitleId") !== subtitleId ||
        messageOwners.get(messageId) !== threadId
      ) {
        throw new Error("Attachment has an invalid owner graph");
      }
      if (!(attachment.blob instanceof Blob)) {
        throw new BackupError(
          "BACKUP_ATTACHMENT_INVALID",
          "备份中的附件内容无效。",
        );
      }
      if (attachment.blob.size > 5 * 1024 * 1024) {
        throw new Error("Attachment exceeds the per-file backup limit");
      }
      if (
        attachment.thumbnailBlob !== undefined &&
        !(attachment.thumbnailBlob instanceof Blob)
      ) {
        throw new Error("Attachment thumbnail Blob is invalid");
      }
    }
    const attachmentUsage = new Map<
      string,
      { count: number; totalBytes: number }
    >();
    for (const attachment of placementGraph.attachments) {
      const ownerKey = JSON.stringify([
        requireBackupString(attachment, "chatThreadId", "attachments"),
        requireBackupString(attachment, "messageId", "attachments"),
      ]);
      const usage = attachmentUsage.get(ownerKey) ?? {
        count: 0,
        totalBytes: 0,
      };
      usage.count += 1;
      usage.totalBytes += (attachment.blob as Blob).size;
      if (usage.count > 6 || usage.totalBytes > 20 * 1024 * 1024) {
        throw new Error("Attachment owner exceeds the backup capacity limit");
      }
      attachmentUsage.set(ownerKey, usage);
    }
    const exportedVideoKeys = new Set(
      placementGraph.videos.map((video) =>
        requireBackupString(video, "videoKey", "videos"),
      ),
    );
    for (const videoKey of exportedVideoKeys) {
      if (!videoKeys.has(videoKey)) {
        throw new Error("Video has no Session owner in its backup group");
      }
    }

    for (const storeName of BACKUP_SESSION_GRAPH_STORES) {
      if (storeName !== "videos") {
        graph[storeName]!.push(...placementGraph[storeName]);
        continue;
      }
      for (const video of placementGraph.videos) {
        const videoKey = requireBackupString(video, "videoKey", "videos");
        const existing = exportedVideos.get(videoKey);
        if (existing === undefined) {
          graph.videos!.push(video);
          exportedVideos.set(videoKey, video);
        } else if (JSON.stringify(existing) !== JSON.stringify(video)) {
          throw new Error("Selected placements contain conflicting Video data");
        }
      }
    }
    if (placement === "archive") {
      folders = backupArray(group, "folders");
      tags = backupArray(group, "tags");
    }
  }

  for (const storeName of BACKUP_SESSION_GRAPH_STORES) {
    assertUniqueKeys(graph[storeName] ?? [], storeName);
  }
  assertUniqueKeys(
    selectedPlacements.flatMap((placement) =>
      branchPlacements[placement].map((record) => ({ ...record })),
    ),
    "branchPlacements",
  );
  for (const placement of selectedPlacements) {
    assertUniqueKeys(sessions[placement], "sessions");
  }
  assertUniqueKeys(folders, "archiveFolders");

  if (selectedPlacements.includes("archive")) {
    const folderIds = new Set(
      folders.map((folder) =>
        requireBackupString(folder, "folderId", "archiveFolders"),
      ),
    );
    for (const session of sessions.archive) {
      const folderId =
        backupString(session, "folderId") ?? ROOT_ARCHIVE_FOLDER_ID;
      if (folderId !== ROOT_ARCHIVE_FOLDER_ID && !folderIds.has(folderId)) {
        throw new Error("Archive placement has an orphan folder owner");
      }
    }
    // 标签组预检：键非空、会话关联引用存在的标签。
    const tagIds = new Set<string>();
    const archiveSessionIds = new Set(
      sessions.archive.map((session) =>
        requireBackupString(session, "sessionId", "sessions"),
      ),
    );
    for (const record of tags) {
      if (typeof record.tagId === "string") {
        const tagId = requireBackupString(record, "tagId", "tags");
        if (tagIds.has(tagId)) {
          throw new Error("A Tag is duplicated in the archive backup group");
        }
        tagIds.add(tagId);
      } else if (typeof record.sessionId === "string") {
        const sessionId = requireBackupString(
          record,
          "sessionId",
          "archiveSessionTags",
        );
        if (!archiveSessionIds.has(sessionId)) {
          throw new Error(
            "Archive session tags reference a Session outside the archive group",
          );
        }
        const tagIdValues = record.tagIds;
        if (
          !Array.isArray(tagIdValues) ||
          tagIdValues.some((id) => typeof id !== "string" || !tagIds.has(id))
        ) {
          throw new Error("Archive session tags reference a missing Tag");
        }
      } else if (typeof record.categoryId === "string") {
        // v9：旧备份的标签类记录直接忽略（功能已删除）。
      } else if (typeof record.filterId === "string") {
        // v9：旧备份的组合记录直接忽略（功能已删除）。
      } else {
        throw new Error("Invalid archive tag record");
      }
    }
  }

  return {
    branchPlacements,
    folders,
    graph,
    selectedPlacements,
    sessions,
    tags,
  };
}

function queueBackupSnapshot(
  transaction: IDBTransaction,
): Promise<BackupDatabaseSnapshot> {
  const requests = BACKUP_DATABASE_STORES.map((storeName) =>
    backupRequest(transaction.objectStore(storeName).getAll()).then((records) =>
      records.filter(backupRecord),
    ),
  );
  return Promise.all(requests).then((collections) =>
    Object.fromEntries(
      BACKUP_DATABASE_STORES.map((storeName, index) => [
        storeName,
        collections[index] ?? [],
      ]),
    ),
  );
}

async function readBackupSnapshot(
  database: IDBDatabase,
): Promise<BackupDatabaseSnapshot> {
  const transaction = database.transaction(BACKUP_DATABASE_STORES, "readonly");
  const done = backupTransactionDone(transaction);
  const snapshot = await queueBackupSnapshot(transaction);
  await done;
  return snapshot;
}

function localSessionLocations(
  snapshot: BackupDatabaseSnapshot,
): ReadonlyMap<string, ReadonlySet<BackupPlacement>> {
  const locations = new Map<string, Set<BackupPlacement>>();
  const add = (sessionId: string, placement: BackupPlacement) => {
    const owned = locations.get(sessionId) ?? new Set<BackupPlacement>();
    owned.add(placement);
    locations.set(sessionId, owned);
  };
  for (const placement of ["workspace", "archive"] as const) {
    for (const record of snapshot[BACKUP_PLACEMENT_STORES[placement]] ?? []) {
      add(
        requireBackupString(
          record,
          "sessionId",
          BACKUP_PLACEMENT_STORES[placement],
        ),
        placement,
      );
    }
  }
  for (const record of snapshot.trashSessionPlacements ?? []) {
    add(
      requireBackupString(record, "sessionId", "trashSessionPlacements"),
      "trash",
    );
  }
  for (const record of snapshot.branchPlacements ?? []) {
    const placement = record.location;
    if (
      placement !== "workspace" &&
      placement !== "archive" &&
      placement !== "trash"
    ) {
      throw new Error("A local Branch placement location is invalid");
    }
    add(
      requireBackupString(record, "sessionId", "branchPlacements"),
      placement,
    );
  }
  return locations;
}

function selectedLocalSessionIds(
  snapshot: BackupDatabaseSnapshot,
  selectedPlacements: readonly BackupPlacement[],
): ReadonlySet<string> {
  const selected = new Set(selectedPlacements);
  const result = new Set<string>();
  for (const [sessionId, locations] of localSessionLocations(snapshot)) {
    if ([...locations].some((placement) => selected.has(placement))) {
      result.add(sessionId);
    }
  }
  return result;
}

function relocatableTrashBranchIds(
  snapshot: BackupDatabaseSnapshot,
  incoming: IncomingBackupGraph,
): ReadonlySet<string> {
  if (!incoming.selectedPlacements.includes("workspace")) return new Set();
  const incomingWorkspaceSessionIds = new Set(
    incoming.sessions.workspace.map((session) =>
      requireBackupString(session, "sessionId", "sessions"),
    ),
  );
  const incomingBranchIds = new Set(
    (incoming.graph.subtitleBranches ?? []).map((record) =>
      requireBackupString(record, "branchId", "subtitleBranches"),
    ),
  );
  return new Set(
    (snapshot.branchPlacements ?? []).flatMap((record) => {
      const sessionId = requireBackupString(
        record,
        "sessionId",
        "branchPlacements",
      );
      const branchId = requireBackupString(
        record,
        "branchId",
        "branchPlacements",
      );
      return record.location === "trash" &&
        incomingWorkspaceSessionIds.has(sessionId) &&
        incomingBranchIds.has(branchId)
        ? [branchId]
        : [];
    }),
  );
}

function backupImportRelocations(
  snapshot: BackupDatabaseSnapshot,
  incoming: IncomingBackupGraph,
): readonly BackupImportRelocation[] {
  const branchIds = relocatableTrashBranchIds(snapshot, incoming);
  const counts = new Map<string, number>();
  for (const record of snapshot.branchPlacements ?? []) {
    const branchId = backupString(record, "branchId");
    const sessionId = backupString(record, "sessionId");
    if (branchId === null || sessionId === null || !branchIds.has(branchId)) {
      continue;
    }
    counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  }
  return [...counts.entries()].map(([sessionId, branchCount]) => ({
    branchCount,
    from: "trash",
    sessionId,
    to: "workspace",
  }));
}

async function assertSafeBatchBackupReplacement(
  database: IDBDatabase,
  incoming: IncomingBatchBackup,
): Promise<void> {
  const snapshot = await readBackupSnapshot(database);
  const localOwners = new Map<string, BatchBackupGroup>();
  for (const group of Object.keys(
    BATCH_BACKUP_PLACEMENT_STORES,
  ) as BatchBackupGroup[]) {
    const storeName = BATCH_BACKUP_PLACEMENT_STORES[group];
    for (const placement of snapshot[storeName] ?? []) {
      localOwners.set(
        requireBatchString(placement, "batchJobId", group),
        group,
      );
    }
  }
  const selected = new Set(Object.keys(incoming.groups) as BatchBackupGroup[]);
  for (const group of Object.keys(incoming.groups) as BatchBackupGroup[]) {
    for (const job of incoming.groups[group]?.jobs ?? []) {
      const batchJobId = requireBatchString(job, "batchJobId", group);
      const localOwner = localOwners.get(batchJobId);
      if (localOwner !== undefined && !selected.has(localOwner)) {
        throw new BackupError(
          "BATCH_BACKUP_JOB_ID_CONFLICT",
          "备份中的批量列表与未选择的本机批量组冲突。",
        );
      }
    }
  }
}

function assertSafeBackupReplacement(
  snapshot: BackupDatabaseSnapshot,
  incoming: IncomingBackupGraph,
): void {
  const existingSelected = selectedLocalSessionIds(
    snapshot,
    incoming.selectedPlacements,
  );
  const localLocations = localSessionLocations(snapshot);
  const relocatableBranchIds = relocatableTrashBranchIds(snapshot, incoming);
  const localSessions = new Map(
    (snapshot.sessions ?? []).map((record) => [
      requireBackupString(record, "sessionId", "sessions"),
      record,
    ]),
  );
  for (const placement of incoming.selectedPlacements) {
    for (const session of incoming.sessions[placement]) {
      const sessionId = requireBackupString(session, "sessionId", "sessions");
      const locations = localLocations.get(sessionId);
      if (
        locations !== undefined &&
        [...locations].some(
          (location) => !incoming.selectedPlacements.includes(location),
        )
      ) {
        const branchPlacementOnly = (snapshot.branchPlacements ?? []).every(
          (record) =>
            backupString(record, "sessionId") !== sessionId ||
            relocatableBranchIds.has(
              requireBackupString(record, "branchId", "branchPlacements"),
            ),
        );
        if (!branchPlacementOnly) {
          throw new Error(
            "Incoming Session conflicts with an unselected placement",
          );
        }
      }
      if (
        localSessions.has(sessionId) &&
        !existingSelected.has(sessionId) &&
        locations === undefined
      ) {
        throw new Error(
          "Incoming Session conflicts with an unowned local Session",
        );
      }
    }
  }

  const selectedThreadIds = new Set(
    (snapshot.chatThreads ?? []).flatMap((record) => {
      const sessionId = backupString(record, "sessionId");
      const threadId = backupString(record, "chatThreadId");
      const branchId = backupString(record, "branchId");
      return sessionId !== null &&
        threadId !== null &&
        (existingSelected.has(sessionId) ||
          (branchId !== null && relocatableBranchIds.has(branchId)))
        ? [threadId]
        : [];
    }),
  );
  for (const storeName of BACKUP_SESSION_GRAPH_STORES) {
    if (storeName === "videos") continue;
    const keyName = BACKUP_STORE_KEYS[storeName]!;
    const existingByKey = new Map(
      (snapshot[storeName] ?? []).map((record) => [
        requireBackupString(record, keyName, storeName),
        record,
      ]),
    );
    for (const record of incoming.graph[storeName] ?? []) {
      const existing = existingByKey.get(
        requireBackupString(record, keyName, storeName),
      );
      if (existing === undefined) continue;
      const existingBranchId = backupString(existing, "branchId");
      const replaceable =
        storeName === "chatMessages"
          ? selectedThreadIds.has(
              requireBackupString(existing, "chatThreadId", storeName),
            )
          : existingSelected.has(
              requireBackupString(existing, "sessionId", storeName),
            ) ||
            (existingBranchId !== null &&
              relocatableBranchIds.has(existingBranchId));
      if (!replaceable) {
        throw new Error(`${storeName} key conflicts with an unselected owner`);
      }
    }
  }

  const remainingVideoKeys = new Set(
    (snapshot.sessions ?? []).flatMap((record) => {
      const sessionId = backupString(record, "sessionId");
      const videoKey = backupString(record, "videoKey");
      return sessionId !== null &&
        videoKey !== null &&
        !existingSelected.has(sessionId)
        ? [videoKey]
        : [];
    }),
  );
  const existingVideos = new Map(
    (snapshot.videos ?? []).map((record) => [
      requireBackupString(record, "videoKey", "videos"),
      record,
    ]),
  );
  for (const video of incoming.graph.videos ?? []) {
    const videoKey = requireBackupString(video, "videoKey", "videos");
    const existing = existingVideos.get(videoKey);
    if (
      existing !== undefined &&
      remainingVideoKeys.has(videoKey) &&
      JSON.stringify(existing) !== JSON.stringify(video)
    ) {
      throw new Error("Incoming Video conflicts with an unselected owner");
    }
  }
}

function sessionRecordWithoutPlacement(
  session: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result = { ...session };
  for (const key of [
    "deletionReason",
    "expiresAt",
    "folderId",
    "order",
    "pinned",
    "placement",
    "purgeAfter",
    "retentionStartedAt",
    "trashedAt",
    "trashOrigin",
  ]) {
    delete result[key];
  }
  return result;
}

function placementRecordFromSession(
  placement: BackupPlacement,
  session: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const sessionId = requireBackupString(session, "sessionId", "sessions");
  if (placement === "workspace") {
    return {
      order: typeof session.order === "number" ? session.order : 0,
      pinned: session.pinned === true,
      sessionId,
    };
  }
  if (placement === "archive") {
    return {
      folderId:
        typeof session.folderId === "string"
          ? session.folderId
          : ROOT_ARCHIVE_FOLDER_ID,
      order: typeof session.order === "number" ? session.order : 0,
      pinned: session.pinned === true,
      sessionId,
    };
  }
  const result: Record<string, unknown> = { sessionId };
  for (const key of [
    "deletionReason",
    "order",
    "pinned",
    "purgeAfter",
    "retentionStartedAt",
    "trashedAt",
    "trashOrigin",
  ]) {
    if (session[key] !== undefined) result[key] = session[key];
  }
  if (result.purgeAfter === undefined) {
    result.purgeAfter =
      typeof session.expiresAt === "number"
        ? session.expiresAt
        : Number.MAX_SAFE_INTEGER;
  }
  return result;
}

function deleteBackupRecord(
  transaction: IDBTransaction,
  storeName: string,
  record: Readonly<Record<string, unknown>>,
): void {
  const keyName = BACKUP_STORE_KEYS[storeName]!;
  transaction
    .objectStore(storeName)
    .delete(requireBackupString(record, keyName, storeName));
}

const BATCH_BACKUP_PLACEMENT_STORES = Object.freeze({
  "batch-archive": "archiveBatchPlacements",
  "batch-trash": "trashBatchPlacements",
  "batch-workspace": "workspaceBatchPlacements",
} as const);

type BatchBackupGroup = keyof typeof BATCH_BACKUP_PLACEMENT_STORES;

function requireBatchString(
  record: Record<string, unknown>,
  key: string,
  context: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Backup ${context} is missing ${key}`);
  }
  return value;
}

function sanitizeBatchItemForBackup(
  item: Record<string, unknown>,
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(item)) {
    if (key === "selected") continue;
    clean[key] = value;
  }
  return clean;
}

function normalizeBatchJobForImport(
  job: Record<string, unknown>,
): Record<string, unknown> {
  const status = job.status;
  if (status !== "running" && status !== "preparing") return job;
  return { ...job, status: "ready" };
}

interface IncomingBatchBackup {
  readonly groups: Partial<
    Record<
      BatchBackupGroup,
      {
        readonly history: readonly Record<string, unknown>[];
        readonly items: readonly Record<string, unknown>[];
        readonly jobs: readonly Record<string, unknown>[];
        readonly placements: readonly Record<string, unknown>[];
        readonly subtitles: readonly Record<string, unknown>[];
      }
    >
  >;
}

function validateIncomingBatchBackup(
  groups: Partial<Record<BackupGroup, unknown>>,
): IncomingBatchBackup {
  const selected = (
    ["batch-workspace", "batch-archive", "batch-trash"] as const
  ).filter((group) => groups[group] !== undefined);
  const incoming: IncomingBatchBackup = { groups: {} };
  const jobIds = new Map<string, BatchBackupGroup>();
  const itemIds = new Map<string, string>();

  for (const group of selected) {
    const value = groups[group];
    if (!backupRecord(value)) throw new Error(`Invalid ${group} group`);
    const jobs = backupArray(value, "jobs");
    const items = backupArray(value, "items");
    const subtitles = backupArray(value, "subtitles");
    const history = backupArray(value, "history");
    const placements = backupArray(value, "placements");
    const jobsById = new Set<string>();
    for (const job of jobs) {
      const batchJobId = requireBatchString(job, "batchJobId", group);
      if (jobsById.has(batchJobId)) {
        throw new Error("A Batch list is duplicated in one backup group");
      }
      const previous = jobIds.get(batchJobId);
      if (previous !== undefined && previous !== group) {
        throw new Error("A Batch list belongs to multiple backup groups");
      }
      jobIds.set(batchJobId, group);
      jobsById.add(batchJobId);
    }
    const itemIdsInGroup = new Set<string>();
    for (const item of items) {
      const batchItemId = requireBatchString(item, "batchItemId", group);
      const owner = requireBatchString(item, "batchJobId", group);
      if (!jobsById.has(owner)) {
        throw new Error("Batch item has an orphan list owner");
      }
      if (itemIdsInGroup.has(batchItemId)) {
        throw new Error("A Batch item is duplicated in one backup group");
      }
      const previous = itemIds.get(batchItemId);
      if (previous !== undefined && previous !== group) {
        throw new Error("A Batch item belongs to multiple backup groups");
      }
      itemIds.set(batchItemId, group);
      itemIdsInGroup.add(batchItemId);
    }
    for (const subtitle of subtitles) {
      const batchItemId = requireBatchString(subtitle, "batchItemId", group);
      if (!itemIdsInGroup.has(batchItemId)) {
        throw new Error("Batch subtitle has an orphan item owner");
      }
    }
    for (const entry of history) {
      const owner = requireBatchString(entry, "batchJobId", group);
      if (!jobsById.has(owner)) {
        throw new Error("Batch source history has an orphan list owner");
      }
    }
    for (const placement of placements) {
      const batchJobId = requireBatchString(placement, "batchJobId", group);
      if (!jobsById.has(batchJobId)) {
        throw new Error("Batch placement has an orphan list owner");
      }
      if (placement.location !== undefined && placement.location !== group) {
        throw new Error("Batch placement does not match its backup group");
      }
    }
    incoming.groups[group] = Object.freeze({
      history: Object.freeze([...history]),
      items: Object.freeze(items.map(sanitizeBatchItemForBackup)),
      jobs: Object.freeze(jobs.map(normalizeBatchJobForImport)),
      placements: Object.freeze([...placements]),
      subtitles: Object.freeze([...subtitles]),
    });
  }
  return incoming;
}

function deleteBatchGroupData(
  transaction: IDBTransaction,
  group: BatchBackupGroup,
  snapshot: Record<string, readonly Record<string, unknown>[]>,
): void {
  const placementStoreName = BATCH_BACKUP_PLACEMENT_STORES[group];
  const oldPlacements =
    snapshot[placementStoreName] ?? ([] as readonly Record<string, unknown>[]);
  const oldJobIds = oldPlacements
    .map((placement) => requireBatchString(placement, "batchJobId", group))
    .filter((batchJobId, index, all) => all.indexOf(batchJobId) === index);
  const jobsStore = transaction.objectStore("batchJobs");
  const itemsStore = transaction.objectStore("batchItems");
  const subtitlesStore = transaction.objectStore("batchSubtitles");
  const historyStore = transaction.objectStore("batchSourceHistory");
  for (const batchJobId of oldJobIds) {
    jobsStore.delete(batchJobId);
    for (const item of snapshot.batchItems ?? []) {
      if (requireBatchString(item, "batchJobId", group) !== batchJobId) {
        continue;
      }
      const batchItemId = requireBatchString(item, "batchItemId", group);
      itemsStore.delete(batchItemId);
      subtitlesStore.delete(batchItemId);
    }
    for (const entry of snapshot.batchSourceHistory ?? []) {
      if (requireBatchString(entry, "batchJobId", group) !== batchJobId) {
        continue;
      }
      historyStore.delete(requireBatchString(entry, "sourceHistoryId", group));
    }
  }
  const placementStore = transaction.objectStore(placementStoreName);
  for (const placement of oldPlacements) {
    placementStore.delete(requireBatchString(placement, "batchJobId", group));
  }
}

function applyBatchBackupReplacement(
  transaction: IDBTransaction,
  incoming: IncomingBatchBackup,
  snapshot: Record<string, readonly Record<string, unknown>[]>,
): void {
  for (const group of Object.keys(incoming.groups) as BatchBackupGroup[]) {
    deleteBatchGroupData(transaction, group, snapshot);
    const placementStoreName = BATCH_BACKUP_PLACEMENT_STORES[group];
    const data = incoming.groups[group];
    const jobs = data?.jobs ?? [];
    const store = transaction.objectStore(placementStoreName);
    const jobsStore = transaction.objectStore("batchJobs");
    const itemsStore = transaction.objectStore("batchItems");
    const subtitlesStore = transaction.objectStore("batchSubtitles");
    const historyStore = transaction.objectStore("batchSourceHistory");
    for (const job of jobs) {
      const batchJobId = requireBatchString(job, "batchJobId", group);
      jobsStore.put(job);
      for (const item of data?.items ?? []) {
        if (requireBatchString(item, "batchJobId", group) !== batchJobId) {
          continue;
        }
        itemsStore.put(item);
      }
      for (const subtitle of data?.subtitles ?? []) {
        const batchItemId = requireBatchString(subtitle, "batchItemId", group);
        const ownedByJob = (data?.items ?? []).some(
          (item) =>
            requireBatchString(item, "batchItemId", group) === batchItemId &&
            requireBatchString(item, "batchJobId", group) === batchJobId,
        );
        if (ownedByJob) subtitlesStore.put(subtitle);
      }
      for (const entry of data?.history ?? []) {
        if (requireBatchString(entry, "batchJobId", group) !== batchJobId) {
          continue;
        }
        historyStore.put(entry);
      }
    }
    for (const placement of data?.placements ?? []) {
      store.put(placement);
    }
  }
}

function applyBackupGraphReplacement(
  transaction: IDBTransaction,
  snapshot: BackupDatabaseSnapshot,
  incoming: IncomingBackupGraph,
): void {
  assertSafeBackupReplacement(snapshot, incoming);
  const selectedLocations = new Set(incoming.selectedPlacements);
  const relocatedBranchIds = relocatableTrashBranchIds(snapshot, incoming);
  const relocatedSessionIds = new Set(
    (snapshot.branchPlacements ?? []).flatMap((record) =>
      relocatedBranchIds.has(
        requireBackupString(record, "branchId", "branchPlacements"),
      )
        ? [requireBackupString(record, "sessionId", "branchPlacements")]
        : [],
    ),
  );
  for (const record of snapshot.branchPlacements ?? []) {
    const branchId = requireBackupString(
      record,
      "branchId",
      "branchPlacements",
    );
    if (selectedLocations.has(record.location as BackupPlacement)) {
      deleteBackupRecord(transaction, "branchPlacements", record);
      continue;
    }
    if (relocatedBranchIds.has(branchId)) {
      deleteBackupRecord(transaction, "branchPlacements", record);
    }
  }
  const selectedSessionIds = selectedLocalSessionIds(
    snapshot,
    incoming.selectedPlacements,
  );
  const selectedThreadIds = new Set(
    (snapshot.chatThreads ?? []).flatMap((record) => {
      const sessionId = backupString(record, "sessionId");
      const threadId = backupString(record, "chatThreadId");
      return sessionId !== null &&
        threadId !== null &&
        selectedSessionIds.has(sessionId)
        ? [threadId]
        : [];
    }),
  );

  for (const record of snapshot.sessions ?? []) {
    const sessionId = requireBackupString(record, "sessionId", "sessions");
    if (selectedSessionIds.has(sessionId)) {
      deleteBackupRecord(transaction, "sessions", record);
    }
  }
  for (const storeName of [
    "subtitleBranches",
    "subtitleSnapshots",
    "chatThreads",
    "artifacts",
    "generationRuns",
    "attachments",
  ] as const) {
    for (const record of snapshot[storeName] ?? []) {
      const sessionId = requireBackupString(record, "sessionId", storeName);
      if (selectedSessionIds.has(sessionId)) {
        deleteBackupRecord(transaction, storeName, record);
      }
    }
  }
  for (const record of snapshot.chatMessages ?? []) {
    const threadId = requireBackupString(
      record,
      "chatThreadId",
      "chatMessages",
    );
    if (selectedThreadIds.has(threadId)) {
      deleteBackupRecord(transaction, "chatMessages", record);
    }
  }

  const oldVideoKeys = new Set(
    (snapshot.sessions ?? []).flatMap((record) => {
      const sessionId = backupString(record, "sessionId");
      const videoKey = backupString(record, "videoKey");
      return sessionId !== null &&
        videoKey !== null &&
        selectedSessionIds.has(sessionId)
        ? [videoKey]
        : [];
    }),
  );
  const remainingVideoKeys = new Set(
    (snapshot.sessions ?? []).flatMap((record) => {
      const sessionId = backupString(record, "sessionId");
      const videoKey = backupString(record, "videoKey");
      return sessionId !== null &&
        videoKey !== null &&
        !selectedSessionIds.has(sessionId)
        ? [videoKey]
        : [];
    }),
  );
  for (const video of snapshot.videos ?? []) {
    const videoKey = requireBackupString(video, "videoKey", "videos");
    if (oldVideoKeys.has(videoKey) && !remainingVideoKeys.has(videoKey)) {
      deleteBackupRecord(transaction, "videos", video);
    }
  }

  for (const placement of incoming.selectedPlacements) {
    transaction.objectStore(BACKUP_PLACEMENT_STORES[placement]).clear();
  }
  if (relocatedSessionIds.size > 0) {
    const trashSessionPlacements = transaction.objectStore(
      "trashSessionPlacements",
    );
    for (const sessionId of relocatedSessionIds) {
      trashSessionPlacements.delete(sessionId);
    }
  }
  if (incoming.selectedPlacements.includes("archive")) {
    transaction.objectStore("archiveFolders").clear();
    // 8a：归档组标签数据整体替换（标签只活在归档区）。
    transaction.objectStore("tags").clear();
    transaction.objectStore("archiveSessionTags").clear();
  }

  for (const placement of incoming.selectedPlacements) {
    const branchOwnedSessionIds = new Set(
      incoming.branchPlacements[placement].map((record) => record.sessionId),
    );
    for (const session of incoming.sessions[placement]) {
      const sessionId = requireBackupString(session, "sessionId", "sessions");
      transaction
        .objectStore("sessions")
        .put(sessionRecordWithoutPlacement(session));
      if (placement === "trash" && branchOwnedSessionIds.has(sessionId)) {
        continue;
      }
      transaction
        .objectStore(BACKUP_PLACEMENT_STORES[placement])
        .put(placementRecordFromSession(placement, session));
    }
  }
  for (const placement of incoming.selectedPlacements) {
    for (const branchPlacement of incoming.branchPlacements[placement]) {
      transaction.objectStore("branchPlacements").put(branchPlacement);
    }
  }
  for (const storeName of BACKUP_SESSION_GRAPH_STORES) {
    for (const record of incoming.graph[storeName] ?? []) {
      transaction.objectStore(storeName).put(record);
    }
  }
  if (incoming.selectedPlacements.includes("archive")) {
    const folderStore = transaction.objectStore("archiveFolders");
    for (const folder of incoming.folders) folderStore.put(folder);
    if (incoming.folders.length === 0) {
      folderStore.put(
        createArchiveFolder({
          folderId: ROOT_ARCHIVE_FOLDER_ID,
          order: 0,
          parentFolderId: null,
          title: "归档",
        }),
      );
    }
    for (const record of incoming.tags) {
      const storeName = tagRecordStoreName(record);
      if (storeName === null) continue; // v9：旧备份组合记录忽略
      transaction.objectStore(storeName).put(record);
    }
    // v9 扁平化：不再需要固定「未归类」类。
  }
}

async function readAllRecords(
  database: IDBDatabase,
  storeName: string,
): Promise<Record<string, unknown>[]> {
  const transaction = database.transaction(storeName, "readonly");
  const records = await backupRequest(
    transaction.objectStore(storeName).getAll(),
  );
  await backupTransactionDone(transaction);
  return records.filter(backupRecord);
}

/**
 * IndexedDB/settings adapter for the v12 selected-group replacement contract.
 * Settings are written before the IDB transaction so a rejected settings
 * write cannot expose a partially replaced session graph. If IDB fails, the
 * previous settings snapshot is restored before the error escapes.
 */
export function createV12BackupDataPort(dependencies: {
  readonly database: IDBDatabase;
  readonly settingsStorage: ChromeWorkspaceStorageArea;
}): BackupDataPort {
  const { database, settingsStorage } = dependencies;

  async function readSettingsValue(key: string): Promise<unknown> {
    return (await settingsStorage.get(key))[key];
  }

  function isStoredRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  /** v13 优先读取，回退 v12（迁移前的旧快照）。 */
  async function readCurrentSettings(): Promise<unknown> {
    const v13 = await readSettingsValue(V13_SETTINGS_STORAGE_KEY);
    if (isStoredRecord(v13) && v13.version === 13) return v13;
    return readSettingsValue(V12_SETTINGS_STORAGE_KEY);
  }

  async function readCurrentSecrets(): Promise<unknown> {
    const v13 = await readSettingsValue(V13_SETTINGS_SECRET_STORAGE_KEY);
    if (isStoredRecord(v13) && v13.version === 13) return v13;
    return readSettingsValue(V12_SETTINGS_SECRET_STORAGE_KEY);
  }

  async function placementIds(
    placement: keyof typeof BACKUP_PLACEMENT_STORES,
  ): Promise<string[]> {
    const [sessionPlacements, branchPlacements] = await Promise.all([
      readAllRecords(database, BACKUP_PLACEMENT_STORES[placement]),
      readAllRecords(database, "branchPlacements"),
    ]);
    return [
      ...new Set(
        [...sessionPlacements, ...branchPlacements].flatMap((record) =>
          (record.location === undefined || record.location === placement) &&
          typeof record.sessionId === "string"
            ? [record.sessionId]
            : [],
        ),
      ),
    ];
  }

  function placementGroup(
    snapshot: BackupDatabaseSnapshot,
    placement: BackupPlacement,
  ): Record<string, unknown> {
    const placements = [
      ...(snapshot[BACKUP_PLACEMENT_STORES[placement]] ?? []),
      ...(snapshot.branchPlacements ?? [])
        .filter((record) => record.location === placement)
        .map((record) => {
          const normalized = createBranchPlacement(
            record as unknown as Parameters<typeof createBranchPlacement>[0],
          );
          return placement === "workspace"
            ? {
                order: normalized.order,
                pinned: false,
                sessionId: normalized.sessionId,
              }
            : placement === "archive"
              ? {
                  folderId: ROOT_ARCHIVE_FOLDER_ID,
                  order: normalized.order,
                  pinned: false,
                  sessionId: normalized.sessionId,
                }
              : createTrashSessionPlacement({
                  deletionReason: normalized.deletionReason!,
                  order: normalized.order,
                  pinned: false,
                  purgeAfter: normalized.purgeAfter,
                  retentionStartedAt: normalized.retentionStartedAt!,
                  sessionId: normalized.sessionId,
                  trashedAt: normalized.trashedAt!,
                  trashOrigin: "workspace",
                });
        }),
    ].filter(
      (entry, index, all) =>
        all.findIndex(
          (candidate) => candidate.sessionId === entry.sessionId,
        ) === index,
    );
    const sessions = snapshot.sessions ?? [];
    const byId = new Map(
      sessions.map((session) => [session.sessionId, session]),
    );
    const selectedSessions = placements.flatMap((entry) => {
      const session = byId.get(entry.sessionId);
      if (session === undefined) {
        throw new Error("A placement references a missing Session");
      }
      return [{ ...session, ...entry, placement }];
    });
    const sessionIds = new Set(
      selectedSessions.map((session) =>
        requireBackupString(session, "sessionId", "sessions"),
      ),
    );
    const videoKeys = new Set(
      selectedSessions.map((session) =>
        requireBackupString(session, "videoKey", "sessions"),
      ),
    );
    const chatThreads = (snapshot.chatThreads ?? []).filter((record) => {
      const sessionId = backupString(record, "sessionId");
      return sessionId !== null && sessionIds.has(sessionId);
    });
    const chatThreadIds = new Set(
      chatThreads.map((record) =>
        requireBackupString(record, "chatThreadId", "chatThreads"),
      ),
    );
    const selectedBranchPlacements = (snapshot.branchPlacements ?? []).filter(
      (record) => {
        const sessionId = backupString(record, "sessionId");
        return (
          record.location === placement &&
          sessionId !== null &&
          sessionIds.has(sessionId)
        );
      },
    );
    const selectedBranchIds = new Set(
      selectedBranchPlacements.map((record) =>
        requireBackupString(record, "branchId", "branchPlacements"),
      ),
    );
    const includeBySelectedBranch = (record: Record<string, unknown>) => {
      const branchId = backupString(record, "branchId");
      return branchId === null
        ? selectedBranchIds.size === 0 &&
            (backupString(record, "sessionId") === null ||
              sessionIds.has(backupString(record, "sessionId")!))
        : selectedBranchIds.has(branchId);
    };
    return {
      artifacts: (snapshot.artifacts ?? []).filter((record) => {
        const sessionId = backupString(record, "sessionId");
        return (
          sessionId !== null &&
          sessionIds.has(sessionId) &&
          includeBySelectedBranch(record)
        );
      }),
      branchPlacements: selectedBranchPlacements,
      attachments: (snapshot.attachments ?? []).filter((record) => {
        const sessionId = backupString(record, "sessionId");
        return (
          sessionId !== null &&
          sessionIds.has(sessionId) &&
          includeBySelectedBranch(record) &&
          backupString(record, "messageId") !== null
        );
      }),
      chatMessages: (snapshot.chatMessages ?? []).filter((record) => {
        const threadId = backupString(record, "chatThreadId");
        return (
          threadId !== null &&
          chatThreadIds.has(threadId) &&
          chatThreads.some(
            (thread) =>
              backupString(thread, "chatThreadId") === threadId &&
              includeBySelectedBranch(thread),
          )
        );
      }),
      chatThreads: chatThreads.filter(includeBySelectedBranch),
      generationRuns: (snapshot.generationRuns ?? []).filter((record) => {
        const sessionId = backupString(record, "sessionId");
        return (
          sessionId !== null &&
          sessionIds.has(sessionId) &&
          includeBySelectedBranch(record)
        );
      }),
      sessions: selectedSessions,
      subtitleBranches: (snapshot.subtitleBranches ?? []).filter((record) => {
        const sessionId = backupString(record, "sessionId");
        return (
          sessionId !== null &&
          sessionIds.has(sessionId) &&
          includeBySelectedBranch(record)
        );
      }),
      subtitleSnapshots: (snapshot.subtitleSnapshots ?? []).filter((record) => {
        const sessionId = backupString(record, "sessionId");
        return (
          sessionId !== null &&
          sessionIds.has(sessionId) &&
          includeBySelectedBranch(record)
        );
      }),
      videos: (snapshot.videos ?? []).filter((record) => {
        const videoKey = backupString(record, "videoKey");
        return videoKey !== null && videoKeys.has(videoKey);
      }),
      ...(placement === "archive"
        ? {
            folders: snapshot.archiveFolders ?? [],
            tags: [
              // v9 扁平化：仅导出 tags 与 archiveSessionTags（类/组合 store 已删除）。
              ...(snapshot.tags ?? []),
              ...(snapshot.archiveSessionTags ?? []),
            ],
          }
        : {}),
    };
  }

  return {
    async validateImport(input) {
      validateIncomingBatchBackup(input.groups);
      const incoming = validateIncomingBackupGraph(input.groups);
      if (incoming.selectedPlacements.length === 0) {
        return { relocations: [] };
      }
      const snapshot = await readBackupSnapshot(database);
      assertSafeBackupReplacement(snapshot, incoming);
      return { relocations: backupImportRelocations(snapshot, incoming) };
    },

    async commitImport(input) {
      const incomingBatch = validateIncomingBatchBackup(input.groups);
      const incoming = validateIncomingBackupGraph(input.groups);
      if (Object.keys(incomingBatch.groups).length > 0) {
        await assertSafeBatchBackupReplacement(database, incomingBatch);
      }
      if (incoming.selectedPlacements.length > 0) {
        const preflightSnapshot = await readBackupSnapshot(database);
        assertSafeBackupReplacement(preflightSnapshot, incoming);
      }
      const previousSettings = await readCurrentSettings();
      const previousSecrets = await readCurrentSecrets();
      let settingsWritten = false;
      try {
        const application = input.groups["application-ai"];
        const prompts = input.groups.prompts;
        if (input.importKeysOnly && backupRecord(application)) {
          const apiKeys = application.apiKeys;
          if (!backupRecord(apiKeys)) {
            throw new Error("Backup API keys are invalid");
          }
          const currentSettings = backupRecord(previousSettings)
            ? { ...previousSettings }
            : {};
          const groqApiKey =
            typeof apiKeys.groq === "string" ? apiKeys.groq : null;
          const currentSpeech = backupRecord(currentSettings.speech)
            ? currentSettings.speech
            : {};
          await settingsStorage.set({
            [V13_SETTINGS_SECRET_STORAGE_KEY]: {
              groqApiKey,
              providerApiKeys: backupRecord(apiKeys.providers)
                ? apiKeys.providers
                : {},
              removedProviderKeyIds: [],
              version: 13,
            },
            [V13_SETTINGS_STORAGE_KEY]: {
              ...currentSettings,
              customReasoningEfforts:
                currentSettings.customReasoningEfforts ?? [],
              modelReasoningOverrides:
                currentSettings.modelReasoningOverrides ?? {},
              speech: {
                ...currentSpeech,
                groqApiKeyConfigured: groqApiKey !== null,
              },
              version: 13,
            },
          });
          settingsWritten = true;
        } else if (backupRecord(application) || backupRecord(prompts)) {
          const local = backupRecord(previousSettings)
            ? { ...previousSettings }
            : {};
          const incomingApplication = backupRecord(application)
            ? { ...application }
            : {};
          const apiKeys = incomingApplication.apiKeys;
          delete incomingApplication.apiKeys;
          delete incomingApplication.appearance;
          delete incomingApplication.promptPresets;
          const promptPresets = backupRecord(prompts)
            ? backupArray(prompts, "userPresets")
            : undefined;
          const nextSettings: Record<string, unknown> = {
            ...(backupRecord(application)
              ? {
                  archivedSegmentPrompts: [],
                  imageCapabilities: [],
                  profiles: [],
                  speech: { groqApiKeyConfigured: false },
                  taskSelections: {
                    chat: null,
                    segments: null,
                    summary: null,
                  },
                  ...incomingApplication,
                }
              : {
                  archivedSegmentPrompts: local.archivedSegmentPrompts ?? [],
                  imageCapabilities: local.imageCapabilities ?? [],
                  profiles: local.profiles ?? [],
                  speech: local.speech ?? { groqApiKeyConfigured: false },
                  taskSelections: local.taskSelections ?? {
                    chat: null,
                    segments: null,
                    summary: null,
                  },
                }),
            ...(local.appearance === undefined
              ? {}
              : { appearance: local.appearance }),
            customReasoningEfforts: local.customReasoningEfforts ?? [],
            modelReasoningOverrides: local.modelReasoningOverrides ?? {},
            promptPresets: promptPresets ?? local.promptPresets ?? [],
            version: 13,
          };
          if (backupRecord(application)) {
            const effectiveGroqApiKey = input.preserveLocalKeys
              ? backupRecord(previousSecrets) &&
                typeof previousSecrets.groqApiKey === "string"
                ? previousSecrets.groqApiKey
                : null
              : backupRecord(apiKeys) && typeof apiKeys.groq === "string"
                ? apiKeys.groq
                : null;
            nextSettings.speech = {
              ...(backupRecord(nextSettings.speech) ? nextSettings.speech : {}),
              groqApiKeyConfigured: effectiveGroqApiKey !== null,
            };
          }
          const items: Record<string, unknown> = {
            [V13_SETTINGS_STORAGE_KEY]: nextSettings,
          };
          if (
            backupRecord(application) &&
            !input.preserveLocalKeys &&
            backupRecord(apiKeys)
          ) {
            items[V13_SETTINGS_SECRET_STORAGE_KEY] = {
              groqApiKey:
                typeof apiKeys.groq === "string" ? apiKeys.groq : null,
              providerApiKeys: backupRecord(apiKeys.providers)
                ? apiKeys.providers
                : {},
              removedProviderKeyIds: [],
              version: 13,
            };
          }
          await settingsStorage.set(items);
          settingsWritten = true;
        }

        if (
          incoming.selectedPlacements.length === 0 &&
          Object.keys(incomingBatch.groups).length === 0
        ) {
          return;
        }
        const transaction = database.transaction(
          BACKUP_DATABASE_STORES,
          "readwrite",
        );
        const done = backupTransactionDone(transaction);
        try {
          const transactionSnapshot = await queueBackupSnapshot(transaction);
          applyBackupGraphReplacement(
            transaction,
            transactionSnapshot,
            incoming,
          );
          if (Object.keys(incomingBatch.groups).length > 0) {
            applyBatchBackupReplacement(
              transaction,
              incomingBatch,
              transactionSnapshot,
            );
          }
          await done;
        } catch (transactionError) {
          try {
            transaction.abort();
          } catch {
            // The transaction may already have been aborted by the failed
            // request. Its original failure remains the authoritative cause.
          }
          try {
            await done;
          } catch {
            // Observe the abort rejection so it cannot escape as an unhandled
            // promise; transactionError below is still propagated unchanged.
          }
          throw transactionError;
        }
      } catch (error) {
        if (settingsWritten) {
          const restore: Record<string, unknown> = {
            [V13_SETTINGS_STORAGE_KEY]: previousSettings,
            [V13_SETTINGS_SECRET_STORAGE_KEY]: previousSecrets,
          };
          try {
            await settingsStorage.set(restore);
          } catch (compensationError) {
            throw new AggregateError(
              [error, compensationError],
              "V12 backup import and settings rollback both failed",
              { cause: compensationError },
            );
          }
        }
        throw error;
      }
    },

    async inspectLocal() {
      const [workspace, archive, trash, settings] = await Promise.all([
        placementIds("workspace"),
        placementIds("archive"),
        placementIds("trash"),
        readCurrentSettings(),
      ]);
      const profiles =
        backupRecord(settings) && Array.isArray(settings.profiles)
          ? settings.profiles.length
          : 0;
      const batchSnapshot = await readBackupSnapshot(database);
      const batchCounts: Partial<
        Record<
          BatchBackupGroup,
          {
            readonly items: number;
            readonly lists: number;
            readonly subtitles: number;
          }
        >
      > = {};
      for (const group of [
        "batch-workspace",
        "batch-archive",
        "batch-trash",
      ] as const) {
        const storeName = BATCH_BACKUP_PLACEMENT_STORES[group];
        const placements = batchSnapshot?.[storeName] ?? [];
        const jobIds = placements
          .map((placement) =>
            requireBatchString(placement, "batchJobId", group),
          )
          .filter(
            (batchJobId, index, all) => all.indexOf(batchJobId) === index,
          );
        const items = (batchSnapshot?.batchItems ?? []).filter((item) =>
          jobIds.includes(requireBatchString(item, "batchJobId", group)),
        ).length;
        const subtitles = (batchSnapshot?.batchSubtitles ?? []).filter(
          (subtitle) =>
            jobIds.includes(requireBatchString(subtitle, "batchJobId", group)),
        ).length;
        batchCounts[group] = {
          items,
          lists: jobIds.length,
          subtitles,
        };
      }
      return {
        placements: { archive, trash, workspace },
        statistics: {
          "application-ai": profiles,
          archive: archive.length,
          "batch-archive": batchCounts["batch-archive"] ?? {
            items: 0,
            lists: 0,
            subtitles: 0,
          },
          "batch-trash": batchCounts["batch-trash"] ?? {
            items: 0,
            lists: 0,
            subtitles: 0,
          },
          "batch-workspace": batchCounts["batch-workspace"] ?? {
            items: 0,
            lists: 0,
            subtitles: 0,
          },
          prompts:
            backupRecord(settings) && Array.isArray(settings.promptPresets)
              ? settings.promptPresets.length
              : 0,
          trash: trash.length,
          workspace: workspace.length,
        },
      };
    },

    async readGroups(groups: readonly BackupGroup[]) {
      const result: Partial<Record<BackupGroup, unknown>> = {};
      const needsPlacementSnapshot = groups.some(
        (group) =>
          group === "workspace" || group === "archive" || group === "trash",
      );
      const needsBatchSnapshot = groups.some((group) =>
        isBatchBackupGroup(group),
      );
      const snapshot = needsPlacementSnapshot
        ? await readBackupSnapshot(database)
        : null;
      if (snapshot !== null) {
        const selectedSessionIds = new Set<string>();
        for (const group of groups) {
          if (
            group !== "workspace" &&
            group !== "archive" &&
            group !== "trash"
          ) {
            continue;
          }
          for (const placement of snapshot[BACKUP_PLACEMENT_STORES[group]] ??
            []) {
            selectedSessionIds.add(
              requireBackupString(
                placement,
                "sessionId",
                BACKUP_PLACEMENT_STORES[group],
              ),
            );
          }
        }
        const ownerCounts = new Map<string, number>();
        for (const placement of ["workspace", "archive", "trash"] as const) {
          for (const record of snapshot[BACKUP_PLACEMENT_STORES[placement]] ??
            []) {
            const sessionId = requireBackupString(
              record,
              "sessionId",
              BACKUP_PLACEMENT_STORES[placement],
            );
            if (!selectedSessionIds.has(sessionId)) continue;
            ownerCounts.set(sessionId, (ownerCounts.get(sessionId) ?? 0) + 1);
          }
        }
        if ([...ownerCounts.values()].some((count) => count !== 1)) {
          throw new Error(
            "A selected Session belongs to multiple local placements",
          );
        }
      }
      const batchSnapshot = needsBatchSnapshot
        ? await readBackupSnapshot(database)
        : null;
      for (const group of groups) {
        if (isBatchBackupGroup(group)) {
          const placementStoreName =
            BATCH_BACKUP_PLACEMENT_STORES[group as BatchBackupGroup];
          const placements =
            batchSnapshot?.[placementStoreName] ??
            ([] as readonly Record<string, unknown>[]);
          const jobIds = placements
            .map((placement) =>
              requireBatchString(placement, "batchJobId", group),
            )
            .filter(
              (batchJobId, index, all) => all.indexOf(batchJobId) === index,
            );
          const jobs: Record<string, unknown>[] = [];
          const items: Record<string, unknown>[] = [];
          const subtitles: Record<string, unknown>[] = [];
          const history: Record<string, unknown>[] = [];
          for (const job of batchSnapshot?.batchJobs ?? []) {
            if (
              !jobIds.includes(requireBatchString(job, "batchJobId", group))
            ) {
              continue;
            }
            jobs.push(normalizeBatchJobForImport(job));
          }
          for (const item of batchSnapshot?.batchItems ?? []) {
            if (
              !jobIds.includes(requireBatchString(item, "batchJobId", group))
            ) {
              continue;
            }
            items.push(sanitizeBatchItemForBackup(item));
          }
          for (const subtitle of batchSnapshot?.batchSubtitles ?? []) {
            const batchItemId = requireBatchString(
              subtitle,
              "batchItemId",
              group,
            );
            const owned = items.some(
              (item) =>
                requireBatchString(item, "batchItemId", group) === batchItemId,
            );
            if (owned) subtitles.push(subtitle);
          }
          for (const entry of batchSnapshot?.batchSourceHistory ?? []) {
            if (
              !jobIds.includes(requireBatchString(entry, "batchJobId", group))
            ) {
              continue;
            }
            history.push(entry);
          }
          result[group] = Object.freeze({
            history: Object.freeze(history),
            items: Object.freeze(items),
            jobs: Object.freeze(jobs),
            placements: Object.freeze(placements),
            subtitles: Object.freeze(subtitles),
          });
          continue;
        }
        if (group === "workspace" || group === "archive" || group === "trash") {
          result[group] = placementGroup(snapshot!, group);
          continue;
        }
        const settings = await readCurrentSettings();
        if (group === "prompts") {
          result.prompts = backupRecord(settings)
            ? { userPresets: settings.promptPresets ?? [] }
            : { userPresets: [] };
        } else {
          result["application-ai"] = backupRecord(settings)
            ? { ...settings, appearance: undefined, promptPresets: undefined }
            : {};
        }
      }
      if (snapshot !== null) {
        validateIncomingBackupGraph(result);
      }
      return result;
    },

    async readKeys() {
      const value = await readCurrentSecrets();
      return {
        groq:
          backupRecord(value) && typeof value.groqApiKey === "string"
            ? value.groqApiKey
            : null,
        providers:
          backupRecord(value) && backupRecord(value.providerApiKeys)
            ? (value.providerApiKeys as Record<string, string>)
            : {},
      };
    },
  };
}
