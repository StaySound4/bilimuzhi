import { afterEach, describe, expect, it, vi } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  MUZHI_DATABASE_VERSION,
  openBilimuzhiDatabase,
} from "../../src/infrastructure/indexeddb/muzhi-database";

const databaseNames: string[] = [];
const videoKey = "bvid:BV1Q541167Qg:cid:30000000001:p:1";

function createDatabaseName(): string {
  const name = `muzhi-v2-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
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

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

interface LegacySeed {
  readonly activeSubtitleId: string | null;
  readonly includeSubtitle: boolean;
  readonly includeVideo?: boolean;
}

async function createLegacyVersion1(
  name: string,
  seed: LegacySeed,
): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDB.open(name, 1);
    request.addEventListener("upgradeneeded", () => {
      const sessions = request.result.createObjectStore("sessions", {
        keyPath: "sessionId",
      });
      sessions.createIndex("byLastActivityAt", "lastActivityAt");
      sessions.createIndex("byVideoKey", "videoKey", { unique: true });
      const snapshots = request.result.createObjectStore("subtitleSnapshots", {
        keyPath: "subtitleId",
      });
      snapshots.createIndex("bySessionId", "sessionId");
      snapshots.createIndex("bySessionStatus", ["sessionId", "status"]);
      request.result.createObjectStore("videos", { keyPath: "videoKey" });
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
  const transaction = database.transaction(
    ["sessions", "subtitleSnapshots", "videos"],
    "readwrite",
  );
  transaction.objectStore("sessions").put({
    activeSubtitleId: seed.activeSubtitleId,
    contextRevision: seed.activeSubtitleId === null ? 0 : 1,
    createdAt: 1_000,
    customTitle: false,
    lastActivityAt: 2_000,
    sessionId: "session-legacy",
    title: "旧字幕",
    updatedAt: 2_000,
    videoKey,
  });
  if (seed.includeVideo !== false) {
    transaction.objectStore("videos").put({
      bvid: "BV1Q541167Qg",
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
      cid: 30_000_000_001,
      page: 1,
      title: "旧字幕",
      videoKey,
    });
  }
  if (seed.includeSubtitle) {
    transaction.objectStore("subtitleSnapshots").put({
      contentHash: "sha256:legacy",
      createdAt: 1_500,
      language: "zh-CN",
      rows: [{ endMs: 1_000, startMs: 0, text: "旧字幕" }],
      sessionId: "session-legacy",
      source: "bilibili",
      status: "active",
      subtitleId: "subtitle-legacy",
      videoKey,
    });
  }
  await transactionDone(transaction);
  database.close();
}

type Version2Index = readonly [
  name: string,
  keyPath: string | readonly string[],
  unique?: boolean,
];

interface Version2Store {
  readonly indexes: readonly Version2Index[];
  readonly keyPath: string;
  readonly name: string;
}

const version2Stores: readonly Version2Store[] = [
  {
    indexes: [["byParentOrder", ["parentFolderId", "order"]]],
    keyPath: "folderId",
    name: "archiveFolders",
  },
  {
    indexes: [["byFolderOrder", ["folderId", "order"]]],
    keyPath: "sessionId",
    name: "archiveSessionPlacements",
  },
  {
    indexes: [
      ["byBranchId", "branchId"],
      ["byOwnerKind", ["sessionId", "branchId", "subtitleId", "kind"], true],
      ["bySessionId", "sessionId"],
    ],
    keyPath: "artifactId",
    name: "artifacts",
  },
  {
    indexes: [
      ["byBranchId", "branchId"],
      ["byMessageId", "messageId"],
      ["bySessionId", "sessionId"],
    ],
    keyPath: "attachmentId",
    name: "attachments",
  },
  {
    indexes: [
      ["byJobOrder", ["batchJobId", "order"], true],
      ["byResultBranchId", "resultBranchId"],
    ],
    keyPath: "batchItemId",
    name: "batchItems",
  },
  {
    indexes: [["byStatus", "status"]],
    keyPath: "batchJobId",
    name: "batchJobs",
  },
  {
    indexes: [
      ["byLocationOrder", ["location", "order"]],
      ["byPurgeAfter", "purgeAfter"],
      ["bySessionId", "sessionId"],
      ["bySessionLocation", ["sessionId", "location"]],
    ],
    keyPath: "branchId",
    name: "branchPlacements",
  },
  {
    indexes: [
      ["byBranchId", "branchId"],
      ["bySessionId", "sessionId"],
      ["byThreadOrder", ["chatThreadId", "order"], true],
    ],
    keyPath: "messageId",
    name: "chatMessages",
  },
  {
    indexes: [
      ["byBranchId", "branchId"],
      ["byOwnerOrder", ["sessionId", "branchId", "subtitleId", "order"], true],
      ["bySessionId", "sessionId"],
    ],
    keyPath: "chatThreadId",
    name: "chatThreads",
  },
  {
    indexes: [
      ["byBranchId", "branchId"],
      ["byOwnerStatus", ["sessionId", "branchId", "subtitleId", "status"]],
      ["bySessionId", "sessionId"],
      ["byTaskId", "taskId", true],
    ],
    keyPath: "runId",
    name: "generationRuns",
  },
  {
    indexes: [
      ["byLastActivityAt", "lastActivityAt"],
      ["byVideoKey", "videoKey", true],
    ],
    keyPath: "sessionId",
    name: "sessions",
  },
  {
    indexes: [
      ["bySessionId", "sessionId"],
      ["bySessionLastOpenedAt", ["sessionId", "lastOpenedAt"]],
      ["byVideoKey", "videoKey"],
    ],
    keyPath: "branchId",
    name: "subtitleBranches",
  },
  {
    indexes: [
      ["byBranchId", "branchId"],
      ["bySessionId", "sessionId"],
      ["bySessionStatus", ["sessionId", "status"]],
    ],
    keyPath: "subtitleId",
    name: "subtitleSnapshots",
  },
  { indexes: [], keyPath: "videoKey", name: "videos" },
  {
    indexes: [["byPinnedOrder", ["pinned", "order"]]],
    keyPath: "sessionId",
    name: "workspaceSessionPlacements",
  },
];

async function createVersion2WithLegacyBranch(name: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDB.open(name, 2);
    request.addEventListener("upgradeneeded", () => {
      for (const schema of version2Stores) {
        const store = request.result.createObjectStore(schema.name, {
          keyPath: schema.keyPath,
        });
        for (const [indexName, keyPath, unique = false] of schema.indexes) {
          store.createIndex(
            indexName,
            typeof keyPath === "string" ? keyPath : [...keyPath],
            { unique },
          );
        }
      }
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
  const transaction = database.transaction("subtitleBranches", "readwrite");
  transaction.objectStore("subtitleBranches").put({
    activeSubtitleId: "subtitle-v2",
    branchId: "branch-v2",
    contextRevision: 1,
    createdAt: 1,
    detectedLanguage: null,
    language: "zh-CN",
    lastOpenedAt: 1,
    lastSelectedAt: 1,
    requestedLanguageMode: null,
    sessionId: "session-v2",
    source: "bilibili",
    title: null,
    updatedAt: 1,
    videoKey,
  });
  await transactionDone(transaction);
  database.close();
}

async function createVersion3WithWorkspaceData(name: string): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = fakeIndexedDB.open(name, 3);
    request.addEventListener("upgradeneeded", () => {
      for (const schema of version2Stores) {
        const store = request.result.createObjectStore(schema.name, {
          keyPath: schema.keyPath,
        });
        for (const [indexName, keyPath, unique = false] of schema.indexes) {
          store.createIndex(
            indexName,
            typeof keyPath === "string" ? keyPath : [...keyPath],
            { unique },
          );
        }
        if (schema.name === "generationRuns") {
          store.createIndex("byOwnerTargetStatus", [
            "sessionId",
            "branchId",
            "subtitleId",
            "contextRevision",
            "kind",
            "targetId",
            "status",
          ]);
        }
      }
      request.result.createObjectStore("settings", { keyPath: "key" });
    });
    request.addEventListener("success", () => resolve(request.result), {
      once: true,
    });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
  const transaction = database.transaction(
    [
      "branchPlacements",
      "sessions",
      "settings",
      "subtitleBranches",
      "subtitleSnapshots",
      "videos",
      "workspaceSessionPlacements",
    ],
    "readwrite",
  );
  transaction.objectStore("videos").put({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
    cid: 30_000_000_001,
    page: 1,
    title: "v3 工作区",
    videoKey,
  });
  transaction.objectStore("sessions").put({
    activeBranchId: "branch-v3",
    createdAt: 1_000,
    customTitle: false,
    lastActivityAt: 2_000,
    selectionRevision: 1,
    sessionId: "session-v3",
    title: "v3 工作区",
    updatedAt: 2_000,
    videoKey,
  });
  transaction.objectStore("subtitleBranches").put({
    activeSubtitleId: "subtitle-v3",
    branchId: "branch-v3",
    completionSequence: 2,
    contextRevision: 1,
    createdAt: 1_500,
    detectedLanguage: null,
    language: "zh-CN",
    lastOpenedAt: 2_000,
    lastReadCompletionSequence: 1,
    lastSelectedAt: 2_000,
    requestedLanguageMode: null,
    sessionId: "session-v3",
    source: "bilibili",
    title: null,
    updatedAt: 2_000,
    videoKey,
  });
  transaction.objectStore("subtitleSnapshots").put({
    branchId: "branch-v3",
    contentHash: "sha256:v3",
    createdAt: 1_500,
    language: "zh-CN",
    rows: [{ endMs: 1_000, startMs: 0, text: "保留 v3 字幕" }],
    sessionId: "session-v3",
    source: "bilibili",
    status: "active",
    subtitleId: "subtitle-v3",
    videoKey,
  });
  transaction.objectStore("branchPlacements").put({
    branchId: "branch-v3",
    deletionReason: null,
    location: "workspace",
    order: 0,
    purgeAfter: null,
    retentionStartedAt: null,
    sessionId: "session-v3",
    trashedAt: null,
    trashOrigin: null,
    trashOriginFolderId: null,
    trashOriginPathSnapshot: null,
  });
  transaction.objectStore("workspaceSessionPlacements").put({
    order: 0,
    pinned: true,
    sessionId: "session-v3",
  });
  transaction.objectStore("settings").put({
    key: "trashRetention",
    policy: { durationDays: 7, kind: "duration" },
    updatedAt: 0,
  });
  await transactionDone(transaction);
  database.close();
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("Bilimuzhi IndexedDB legacy migration", () => {
  it("upgrades a valid v1 database by purging its Session-backed subtitle graph", async () => {
    const name = createDatabaseName();
    await createLegacyVersion1(name, {
      activeSubtitleId: "subtitle-legacy",
      includeSubtitle: true,
    });

    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    try {
      const ownedStores = [
        "sessions",
        "subtitleBranches",
        "branchPlacements",
        "workspaceSessionPlacements",
        "subtitleSnapshots",
        "videos",
        "batchJobs",
        "batchItems",
        "batchSubtitles",
      ];
      const transaction = database.transaction(ownedStores, "readonly");
      const counts = Object.fromEntries(
        await Promise.all(
          ownedStores.map(async (storeName) => [
            storeName,
            await requestResult(transaction.objectStore(storeName).count()),
          ]),
        ),
      );
      await transactionDone(transaction);

      expect(database.version).toBe(MUZHI_DATABASE_VERSION);
      expect(counts).toEqual(
        Object.fromEntries(ownedStores.map((name) => [name, 0])),
      );
    } finally {
      database.close();
    }
  });

  it("purges a corrupt v1 relation instead of retaining an incompatible Session graph", async () => {
    const name = createDatabaseName();
    await createLegacyVersion1(name, {
      activeSubtitleId: "subtitle-missing",
      includeSubtitle: false,
    });

    const migrated = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    expect(migrated.version).toBe(MUZHI_DATABASE_VERSION);
    expect([...migrated.objectStoreNames]).toContain("batchSubtitles");
    await expect(
      requestResult(
        migrated
          .transaction("sessions", "readonly")
          .objectStore("sessions")
          .count(),
      ),
    ).resolves.toBe(0);
    migrated.close();
  });

  it("purges a v1 session with no owned video without inventing replacement identity", async () => {
    const name = createDatabaseName();
    await createLegacyVersion1(name, {
      activeSubtitleId: "subtitle-legacy",
      includeSubtitle: true,
      includeVideo: false,
    });

    const migrated = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const read = migrated.transaction(
      ["sessions", "subtitleSnapshots"],
      "readonly",
    );
    await expect(
      requestResult(read.objectStore("sessions").count()),
    ).resolves.toBe(0);
    await expect(
      requestResult(read.objectStore("subtitleSnapshots").count()),
    ).resolves.toBe(0);
    await transactionDone(read);
    migrated.close();
  });

  it("purges v2 branches while creating the current settings and independent batch store", async () => {
    const name = createDatabaseName();
    await createVersion2WithLegacyBranch(name);

    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    try {
      const transaction = database.transaction(
        ["settings", "subtitleBranches", "batchSubtitles"],
        "readonly",
      );
      const [branchCount, batchSubtitleCount, setting] = await Promise.all([
        requestResult(transaction.objectStore("subtitleBranches").count()),
        requestResult(transaction.objectStore("batchSubtitles").count()),
        requestResult(
          transaction.objectStore("settings").get("trashRetention"),
        ),
      ]);
      await transactionDone(transaction);

      expect(database.version).toBe(MUZHI_DATABASE_VERSION);
      expect(branchCount).toBe(0);
      expect(batchSubtitleCount).toBe(0);
      expect(setting).toEqual({
        key: "trashRetention",
        policy: { durationDays: 7, kind: "duration" },
        updatedAt: 0,
      });
    } finally {
      database.close();
    }
  });

  it("purges v3 workspace data once, then preserves sessions created after migration", async () => {
    const name = createDatabaseName();
    await createVersion3WithWorkspaceData(name);

    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    try {
      const read = database.transaction(
        [
          "branchPlacements",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      const sessions = read.objectStore("sessions");
      expect(sessions.index("byVideoKey").unique).toBe(false);
      await expect(requestResult(sessions.count())).resolves.toBe(0);
      await expect(
        requestResult(read.objectStore("subtitleBranches").count()),
      ).resolves.toBe(0);
      await expect(
        requestResult(read.objectStore("subtitleSnapshots").count()),
      ).resolves.toBe(0);
      await expect(
        requestResult(read.objectStore("branchPlacements").count()),
      ).resolves.toBe(0);
      await expect(
        requestResult(read.objectStore("workspaceSessionPlacements").count()),
      ).resolves.toBe(0);
      await transactionDone(read);

      const write = database.transaction(
        ["sessions", "workspaceSessionPlacements"],
        "readwrite",
      );
      write.objectStore("sessions").add({
        activeBranchId: null,
        createdAt: 3_000,
        customTitle: false,
        lastActivityAt: 3_000,
        selectionRevision: 0,
        sessionId: "session-after-v6",
        title: "新的工作区会话",
        updatedAt: 3_000,
        videoKey,
      });
      write.objectStore("workspaceSessionPlacements").add({
        order: 1,
        pinned: false,
        sessionId: "session-after-v6",
      });
      await transactionDone(write);

      database.close();
      const reopened = await openBilimuzhiDatabase({
        factory: fakeIndexedDB,
        name,
      });
      await expect(
        requestResult(
          reopened
            .transaction("sessions", "readonly")
            .objectStore("sessions")
            .get("session-after-v6"),
        ),
      ).resolves.toMatchObject({ title: "新的工作区会话", videoKey });
      reopened.close();
      return;
    } finally {
      database.close();
    }
  });

  it("closes an opened v2 connection when a later versionchange arrives", async () => {
    const name = createDatabaseName();
    const database = await openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
    const close = vi.spyOn(database, "close");
    try {
      const request = fakeIndexedDB.open(name, MUZHI_DATABASE_VERSION + 1);
      const newer = await new Promise<IDBDatabase>((resolve, reject) => {
        request.addEventListener("success", () => resolve(request.result), {
          once: true,
        });
        request.addEventListener("error", () => reject(request.error), {
          once: true,
        });
        request.addEventListener(
          "blocked",
          () => reject(new Error("versionchange was blocked")),
          { once: true },
        );
      });

      expect(close).toHaveBeenCalledOnce();
      newer.close();
    } finally {
      database.close();
    }
  });
});
