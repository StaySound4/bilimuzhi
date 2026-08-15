import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import { createV12BackupRuntime } from "../../src/application/backup";
import type { ChromeWorkspaceStorageArea } from "../../src/infrastructure/chrome-workspace-state-store";
import {
  createV12BackupDataPort,
  openBilimuzhiDatabase,
} from "../../src/infrastructure/indexeddb/muzhi-database";

type Placement = "archive" | "trash" | "workspace";

const placementStores: Readonly<Record<Placement, string>> = Object.freeze({
  archive: "archiveSessionPlacements",
  trash: "trashSessionPlacements",
  workspace: "workspaceSessionPlacements",
});

const ownedStores = Object.freeze([
  "sessions",
  "branchPlacements",
  "subtitleBranches",
  "subtitleSnapshots",
  "chatThreads",
  "chatMessages",
  "artifacts",
  "generationRuns",
  "attachments",
  "videos",
] as const);

const databaseNames: string[] = [];

function createStorage(seed: Record<string, unknown> = {}) {
  const values = structuredClone(seed);
  const storage: ChromeWorkspaceStorageArea = {
    get: vi.fn(async (key: string) => ({
      [key]: structuredClone(values[key]),
    })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(values, structuredClone(items));
    }),
  };
  return { storage, values };
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

async function putRecords(
  database: IDBDatabase,
  records: Readonly<Record<string, readonly Record<string, unknown>[]>>,
): Promise<void> {
  const storeNames = Object.keys(records).filter(
    (storeName) => records[storeName]?.length,
  );
  const transaction = database.transaction(storeNames, "readwrite");
  const done = transactionDone(transaction);
  for (const storeName of storeNames) {
    const store = transaction.objectStore(storeName);
    for (const record of records[storeName] ?? []) store.put(record);
  }
  await done;
}

async function allRecords(
  database: IDBDatabase,
  storeName: string,
): Promise<Record<string, unknown>[]> {
  const transaction = database.transaction(storeName, "readonly");
  const values = (await requestResult(
    transaction.objectStore(storeName).getAll(),
  )) as Record<string, unknown>[];
  await transactionDone(transaction);
  return values;
}

async function canonicalize(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    return {
      bytes: Array.from(new Uint8Array(await value.arrayBuffer())),
      type: value.type,
    };
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map(canonicalize));
  }
  if (typeof value === "object" && value !== null) {
    const entries = await Promise.all(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(async ([key, child]) => [key, await canonicalize(child)] as const),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

async function canonicalRecords(
  records: readonly Record<string, unknown>[],
): Promise<unknown[]> {
  const canonical = await Promise.all(records.map(canonicalize));
  return canonical.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

async function graphSnapshot(database: IDBDatabase, sessionId: string) {
  const sessions = (await allRecords(database, "sessions")).filter(
    (record) => record.sessionId === sessionId,
  );
  const videoKeys = new Set(
    sessions.flatMap((record) =>
      typeof record.videoKey === "string" ? [record.videoKey] : [],
    ),
  );
  const threads = (await allRecords(database, "chatThreads")).filter(
    (record) => record.sessionId === sessionId,
  );
  const archivePlacements = (
    await allRecords(database, "archiveSessionPlacements")
  ).filter((record) => record.sessionId === sessionId);
  const archiveFolderIds = new Set(
    archivePlacements.flatMap((record) =>
      typeof record.folderId === "string" ? [record.folderId] : [],
    ),
  );
  const threadIds = new Set(
    threads.flatMap((record) =>
      typeof record.chatThreadId === "string" ? [record.chatThreadId] : [],
    ),
  );
  const records: Record<string, Record<string, unknown>[]> = {
    archiveFolders: (await allRecords(database, "archiveFolders")).filter(
      (record) =>
        typeof record.folderId === "string" &&
        archiveFolderIds.has(record.folderId),
    ),
    archiveSessionPlacements: archivePlacements,
    artifacts: (await allRecords(database, "artifacts")).filter(
      (record) => record.sessionId === sessionId,
    ),
    attachments: (await allRecords(database, "attachments")).filter(
      (record) => record.sessionId === sessionId,
    ),
    chatMessages: (await allRecords(database, "chatMessages")).filter(
      (record) =>
        typeof record.chatThreadId === "string" &&
        threadIds.has(record.chatThreadId),
    ),
    chatThreads: threads,
    generationRuns: (await allRecords(database, "generationRuns")).filter(
      (record) => record.sessionId === sessionId,
    ),
    sessions,
    subtitleBranches: (await allRecords(database, "subtitleBranches")).filter(
      (record) => record.sessionId === sessionId,
    ),
    subtitleSnapshots: (await allRecords(database, "subtitleSnapshots")).filter(
      (record) => record.sessionId === sessionId,
    ),
    branchPlacements: (await allRecords(database, "branchPlacements")).filter(
      (record) => record.sessionId === sessionId,
    ),
    trashSessionPlacements: (
      await allRecords(database, "trashSessionPlacements")
    ).filter((record) => record.sessionId === sessionId),
    videos: (await allRecords(database, "videos")).filter(
      (record) =>
        typeof record.videoKey === "string" && videoKeys.has(record.videoKey),
    ),
    workspaceSessionPlacements: (
      await allRecords(database, "workspaceSessionPlacements")
    ).filter((record) => record.sessionId === sessionId),
  };
  return Object.fromEntries(
    await Promise.all(
      Object.entries(records).map(async ([storeName, storeRecords]) => [
        storeName,
        await canonicalRecords(storeRecords),
      ]),
    ),
  );
}

async function databaseSnapshot(database: IDBDatabase) {
  const storeNames = [
    ...ownedStores,
    ...Object.values(placementStores),
    "archiveFolders",
  ];
  return Object.fromEntries(
    await Promise.all(
      storeNames.map(async (storeName) => [
        storeName,
        await canonicalRecords(await allRecords(database, storeName)),
      ]),
    ),
  );
}

function graphRecords(prefix: string, placement: Placement) {
  const sessionId = `${prefix}-session`;
  const branchId = `${prefix}-context`;
  const subtitleId = `${prefix}-subtitle`;
  const threadId = `${prefix}-thread`;
  const userMessageId = `${prefix}-message-user`;
  const assistantMessageId = `${prefix}-message-assistant`;
  const runId = `${prefix}-run`;
  const artifactId = `${prefix}-artifact`;
  const videoKey = `bvid:BV1${prefix.toUpperCase()}:cid:${prefix.length + 10}:p:1`;
  const placementRecord =
    placement === "workspace"
      ? { order: 3, pinned: true, sessionId }
      : {
          folderId: `${prefix}-folder`,
          order: 4,
          pinned: false,
          sessionId,
        };
  return {
    ids: {
      artifactId,
      assistantMessageId,
      branchId,
      runId,
      sessionId,
      subtitleId,
      threadId,
      userMessageId,
      videoKey,
    },
    records: {
      ...(placement === "archive"
        ? {
            archiveFolders: [
              {
                folderId: `${prefix}-folder`,
                order: 1,
                parentFolderId: "archive-root",
                title: `${prefix} folder`,
              },
            ],
          }
        : {}),
      ...(placement === "trash"
        ? {}
        : { [placementStores[placement]]: [placementRecord] }),
      artifacts: [
        {
          artifactId,
          artifactRevision: 1,
          branchId,
          content: `${prefix} summary`,
          contextRevision: 7,
          createdAt: 20,
          errorCode: null,
          kind: "summary",
          modelId: "test-model",
          segments: [],
          sessionId,
          status: "ready",
          subtitleId,
          updatedAt: 21,
        },
      ],
      branchPlacements: [
        placement === "trash"
          ? prefix.includes("archive-origin")
            ? {
                branchId,
                deletionReason: "test-delete",
                location: "trash",
                order: 0,
                purgeAfter: 9_999_999,
                retentionStartedAt: 50,
                sessionId,
                trashedAt: 50,
                trashOrigin: "archive",
                trashOriginFolderId: "archived-before-delete",
                trashOriginPathSnapshot: "归档 / 课程",
              }
            : {
                branchId,
                deletionReason: "test-delete",
                location: "trash",
                order: 0,
                purgeAfter: 9_999_999,
                retentionStartedAt: 50,
                sessionId,
                trashedAt: 50,
                trashOrigin: "workspace",
                trashOriginFolderId: null,
                trashOriginPathSnapshot: null,
              }
          : {
              branchId,
              deletionReason: null,
              location: placement,
              order: 0,
              purgeAfter: null,
              retentionStartedAt: null,
              sessionId,
              trashedAt: null,
              trashOrigin: null,
              trashOriginFolderId: null,
              trashOriginPathSnapshot: null,
            },
      ],
      attachments: [
        {
          attachmentId: `${prefix}-attachment`,
          blob: new Blob([new Uint8Array([82, 73, 70, 70, prefix.length])], {
            type: "image/webp",
          }),
          branchId,
          chatThreadId: threadId,
          currentTimeMs: 1_500,
          height: 2,
          messageId: userMessageId,
          mimeType: "image/webp",
          sessionId,
          subtitleContextRevision: 7,
          subtitleId,
          thumbnailBlob: new Blob(
            [new Uint8Array([87, 69, 66, 80, prefix.length])],
            { type: "image/webp" },
          ),
          videoKey,
          width: 3,
        },
      ],
      chatMessages: [
        {
          chatThreadId: threadId,
          content: `${prefix} question`,
          createdAt: 30,
          generationRunId: null,
          messageId: userMessageId,
          order: 0,
          role: "user",
          status: "complete",
          updatedAt: 30,
        },
        {
          chatThreadId: threadId,
          content: `${prefix} answer`,
          createdAt: 31,
          generationRunId: runId,
          messageId: assistantMessageId,
          order: 1,
          role: "assistant",
          status: "complete",
          updatedAt: 31,
        },
      ],
      chatThreads: [
        {
          branchId,
          chatThreadId: threadId,
          conversationRevision: 2,
          createdAt: 25,
          order: 0,
          sessionId,
          subtitleId,
          title: `${prefix} chat`,
          updatedAt: 31,
        },
      ],
      generationRuns: [
        {
          branchId,
          browserSessionId: `${prefix}-browser`,
          completionSequence: 1,
          contextHash: null,
          contextRevision: 7,
          conversationRevision: 2,
          createdAt: 31,
          errorCode: null,
          expectedOwnerRevision: 2,
          kind: "chat",
          modelHash: null,
          partialOutput: `${prefix} answer`,
          promptHash: null,
          runId,
          runRevision: 0,
          sessionId,
          status: "completed",
          stopReason: null,
          subtitleId,
          targetId: threadId,
          taskId: `${prefix}-task`,
          updatedAt: 32,
        },
      ],
      sessions: [
        {
          createdAt: 10,
          lastActivityAt: 40,
          sessionId,
          subtitleContextRevision: 7,
          title: `${prefix} session`,
          videoKey,
        },
      ],
      subtitleBranches: [
        {
          activeSubtitleId: subtitleId,
          branchId,
          completionSequence: 1,
          contextRevision: 7,
          createdAt: 11,
          detectedLanguage: null,
          language: "zh-CN",
          lastOpenedAt: 13,
          lastReadCompletionSequence: 1,
          lastSelectedAt: 13,
          requestedLanguageMode: null,
          sessionId,
          source: "bilibili",
          title: null,
          updatedAt: 13,
          videoKey,
        },
      ],
      subtitleSnapshots: [
        {
          branchId,
          contentHash: `sha256:${prefix}`,
          createdAt: 12,
          language: "zh-CN",
          rows: [
            {
              endMs: 2_000,
              lineId: `${prefix}-line`,
              startMs: 1_000,
              text: `${prefix} subtitle row`,
            },
          ],
          sessionId,
          source: "bilibili",
          status: "active",
          subtitleId,
          videoKey,
        },
      ],
      videos: [
        {
          aid: prefix.length + 100,
          bvid: `BV1${prefix.toUpperCase()}`,
          cid: prefix.length + 10,
          page: 1,
          title: `${prefix} video`,
          videoKey,
        },
      ],
    } satisfies Record<string, readonly Record<string, unknown>[]>,
  };
}

async function openDatabase(label: string): Promise<IDBDatabase> {
  const name = `muzhi-v12-backup-graph-${label}-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return openBilimuzhiDatabase({ factory: fakeIndexedDB, name });
}

function runtime(database: IDBDatabase) {
  const { storage } = createStorage();
  return createV12BackupRuntime({
    crypto: globalThis.crypto,
    data: createV12BackupDataPort({ database, settingsStorage: storage }),
    now: () => 1_700_000_000_000,
    randomUUID: () => "dependency-graph",
  });
}

async function exportPlacement(
  database: IDBDatabase,
  placement: Placement,
): Promise<string> {
  return (
    await runtime(database).exportBackup({
      groups: [placement],
      includeKeys: false,
    })
  ).json;
}

function databaseWithInjectedAttachmentFailure(
  database: IDBDatabase,
): IDBDatabase {
  return new Proxy(database, {
    get(target, property) {
      if (property !== "transaction") {
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (
        storeNames: string | Iterable<string>,
        mode?: IDBTransactionMode,
        options?: IDBTransactionOptions,
      ) => {
        const transaction = target.transaction(storeNames, mode, options);
        if (mode !== "readwrite") return transaction;
        return new Proxy(transaction, {
          get(transactionTarget, transactionProperty) {
            if (transactionProperty !== "objectStore") {
              const value = Reflect.get(
                transactionTarget,
                transactionProperty,
                transactionTarget,
              ) as unknown;
              return typeof value === "function"
                ? value.bind(transactionTarget)
                : value;
            }
            return (storeName: string) => {
              const store = transactionTarget.objectStore(storeName);
              if (storeName !== "attachments") return store;
              return new Proxy(store, {
                get(storeTarget, storeProperty) {
                  if (storeProperty === "put" || storeProperty === "add") {
                    return () => {
                      transactionTarget.abort();
                      throw new Error(
                        "injected attachment persistence failure",
                      );
                    };
                  }
                  const value = Reflect.get(
                    storeTarget,
                    storeProperty,
                    storeTarget,
                  ) as unknown;
                  return typeof value === "function"
                    ? value.bind(storeTarget)
                    : value;
                },
              });
            };
          },
        });
      };
    },
  });
}

afterEach(async () => {
  await Promise.all(
    databaseNames.splice(0).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = fakeIndexedDB.deleteDatabase(name);
          request.addEventListener("success", () => resolve(), { once: true });
          request.addEventListener("error", () => reject(request.error), {
            once: true,
          });
        }),
    ),
  );
});

describe("v12 selected-placement backup dependency graph (A12)", () => {
  it.each(["workspace", "archive", "trash"] as const)(
    "exports the selected %s graph without being blocked by an unrelated unowned row",
    async (placement) => {
      const database = await openDatabase(`export-unowned-${placement}`);
      const sessionId = `selected-${placement}-session`;
      await putRecords(database, {
        [placementStores[placement]]: [
          placement === "archive"
            ? {
                folderId: "archive-root",
                order: 0,
                pinned: false,
                sessionId,
              }
            : placement === "workspace"
              ? { order: 0, pinned: false, sessionId }
              : { purgeAfter: Number.MAX_SAFE_INTEGER, sessionId },
        ],
        generationRuns: [
          {
            runId: `unowned-${placement}-run`,
            sessionId: `unowned-${placement}-session`,
          },
        ],
        sessions: [
          {
            createdAt: 1,
            lastActivityAt: 1,
            sessionId,
            subtitleContextRevision: 0,
            title: `selected ${placement}`,
            videoBound: false,
            videoKey: `bvid:BV1${placement.toUpperCase()}:cid:1:p:1`,
          },
        ],
      });

      const json = await exportPlacement(database, placement);

      expect(JSON.parse(json)).toMatchObject({
        groups: {
          [placement]: {
            sessions: [expect.objectContaining({ sessionId })],
          },
        },
        version: 1,
      });
      expect(json).not.toContain(`unowned-${placement}-session`);
      database.close();
    },
  );

  it("exports all three selected placement graphs while omitting an unbound draft attachment and ignoring an unrelated orphan", async () => {
    const database = await openDatabase("export-selected-matrix");
    const workspace = graphRecords("matrix-workspace", "workspace");
    const archive = graphRecords("matrix-archive", "archive");
    const trash = graphRecords("matrix-trash", "trash");
    await putRecords(database, workspace.records);
    await putRecords(database, archive.records);
    await putRecords(database, trash.records);
    await putRecords(database, {
      attachments: [
        {
          ...workspace.records.attachments![0],
          attachmentId: "matrix-workspace-draft",
          messageId: null,
        },
      ],
      generationRuns: [
        {
          runId: "matrix-unrelated-orphan-run",
          sessionId: "matrix-unrelated-orphan-session",
        },
      ],
    });

    const json = (
      await runtime(database).exportBackup({
        groups: ["workspace", "archive", "trash"],
        includeKeys: false,
      })
    ).json;

    expect(JSON.parse(json)).toMatchObject({
      groups: {
        archive: {
          sessions: [
            expect.objectContaining({ sessionId: archive.ids.sessionId }),
          ],
        },
        trash: {
          sessions: [
            expect.objectContaining({ sessionId: trash.ids.sessionId }),
          ],
        },
        workspace: {
          sessions: [
            expect.objectContaining({ sessionId: workspace.ids.sessionId }),
          ],
        },
      },
      version: 1,
    });
    expect(json).not.toContain("matrix-workspace-draft");
    expect(json).not.toContain("matrix-unrelated-orphan-session");
    database.close();
  });

  it("rejects a selected Session that also belongs to an unselected placement", async () => {
    const database = await openDatabase("export-selected-owner-conflict");
    const selected = graphRecords("selected-owner-conflict", "workspace");
    await putRecords(database, selected.records);
    await putRecords(database, {
      archiveSessionPlacements: [
        {
          folderId: "archive-root",
          order: 0,
          pinned: false,
          sessionId: selected.ids.sessionId,
        },
      ],
    });

    await expect(exportPlacement(database, "workspace")).rejects.toMatchObject({
      code: "BACKUP_EXPORT_GENERATION_FAILED",
    });
    database.close();
  });

  it("rejects conflicting Video records shared by selected placements", async () => {
    const database = await openDatabase("import-conflicting-shared-video");
    const videoKey = "bvid:BV1CONFLICTINGVIDEO:cid:9:p:1";
    const session = (sessionId: string, placement: Placement) => ({
      createdAt: 1,
      lastActivityAt: 1,
      order: 0,
      pinned: false,
      placement,
      sessionId,
      subtitleContextRevision: 0,
      title: placement,
      videoKey,
    });

    await expect(
      runtime(database).previewImport({
        groups: ["workspace", "archive"],
        json: JSON.stringify({
          groups: {
            archive: {
              folders: [],
              sessions: [session("conflicting-video-archive", "archive")],
              videos: [
                {
                  aid: 9,
                  bvid: "BV1CONFLICTINGVIDEO",
                  cid: 9,
                  page: 1,
                  title: "archive title",
                  videoKey,
                },
              ],
            },
            workspace: {
              sessions: [session("conflicting-video-workspace", "workspace")],
              videos: [
                {
                  aid: 9,
                  bvid: "BV1CONFLICTINGVIDEO",
                  cid: 9,
                  page: 1,
                  title: "workspace title",
                  videoKey,
                },
              ],
            },
          },
          version: 1,
        }),
      }),
    ).rejects.toMatchObject({ code: "BACKUP_IMPORT_VALIDATION_FAILED" });
    database.close();
  });

  it("exports multiple selected placements that share one Video dependency", async () => {
    const database = await openDatabase("export-shared-video");
    const videoKey = "bvid:BV1SHAREDVIDEO:cid:7:p:1";
    await putRecords(database, {
      archiveSessionPlacements: [
        {
          folderId: "archive-root",
          order: 0,
          pinned: false,
          sessionId: "shared-video-archive",
        },
      ],
      sessions: [
        {
          createdAt: 1,
          lastActivityAt: 1,
          sessionId: "shared-video-workspace",
          subtitleContextRevision: 0,
          title: "workspace",
          videoKey,
        },
        {
          createdAt: 2,
          lastActivityAt: 2,
          sessionId: "shared-video-archive",
          subtitleContextRevision: 0,
          title: "archive",
          videoKey,
        },
        {
          createdAt: 3,
          lastActivityAt: 3,
          sessionId: "shared-video-trash",
          subtitleContextRevision: 0,
          title: "trash",
          videoKey,
        },
      ],
      trashSessionPlacements: [
        {
          purgeAfter: Number.MAX_SAFE_INTEGER,
          sessionId: "shared-video-trash",
        },
      ],
      videos: [
        {
          aid: 7,
          bvid: "BV1SHAREDVIDEO",
          cid: 7,
          page: 1,
          title: "shared video",
          videoKey,
        },
      ],
      workspaceSessionPlacements: [
        { order: 0, pinned: false, sessionId: "shared-video-workspace" },
      ],
    });

    const json = (
      await runtime(database).exportBackup({
        groups: ["workspace", "archive", "trash"],
        includeKeys: false,
      })
    ).json;

    expect(JSON.parse(json)).toMatchObject({
      groups: {
        archive: { sessions: [expect.objectContaining({ videoKey })] },
        trash: { sessions: [expect.objectContaining({ videoKey })] },
        workspace: { sessions: [expect.objectContaining({ videoKey })] },
      },
      version: 1,
    });
    database.close();
  });

  it.each(["workspace", "archive", "trash"] as const)(
    "round-trips and fully replaces the %s Session graph while preserving an unselected graph",
    async (placement) => {
      const source = await openDatabase(`source-${placement}`);
      const destination = await openDatabase(`destination-${placement}`);
      const incoming = graphRecords(`incoming-${placement}`, placement);
      const old = graphRecords(`old-${placement}`, placement);
      const unselectedPlacement: Placement =
        placement === "workspace"
          ? "archive"
          : placement === "archive"
            ? "trash"
            : "workspace";
      const untouched = graphRecords(
        `untouched-${placement}`,
        unselectedPlacement,
      );
      await putRecords(source, incoming.records);
      await putRecords(destination, old.records);
      await putRecords(destination, untouched.records);
      const expectedIncoming = await graphSnapshot(
        source,
        incoming.ids.sessionId,
      );
      const untouchedBefore = await graphSnapshot(
        destination,
        untouched.ids.sessionId,
      );
      const expectedEmpty = await graphSnapshot(source, "missing-session");

      const destinationRuntime = runtime(destination);
      const preview = await destinationRuntime.previewImport({
        groups: [placement],
        json: await exportPlacement(source, placement),
      });
      await destinationRuntime.commitImport({
        confirmation: "replace-selected-groups",
        preview,
      });

      expect(await graphSnapshot(destination, incoming.ids.sessionId)).toEqual(
        expectedIncoming,
      );
      expect(await graphSnapshot(destination, old.ids.sessionId)).toEqual(
        expectedEmpty,
      );
      expect(await graphSnapshot(destination, untouched.ids.sessionId)).toEqual(
        untouchedBefore,
      );

      const sessionIds = new Set(
        (await allRecords(destination, "sessions")).map(
          (record) => record.sessionId,
        ),
      );
      for (const storeName of ownedStores.filter(
        (name) => name !== "sessions" && name !== "videos",
      )) {
        for (const record of await allRecords(destination, storeName)) {
          if (typeof record.sessionId === "string") {
            expect(
              sessionIds.has(record.sessionId),
              `${storeName} must not contain an orphan owner`,
            ).toBe(true);
          }
        }
      }
      source.close();
      destination.close();
    },
  );

  it("previews a plaintext backup containing every supported group and optional secrets", async () => {
    const database = await openDatabase("all-groups-plaintext-import");
    const workspace = graphRecords("all-groups-workspace", "workspace");
    await putRecords(database, workspace.records);
    const backup = runtime(database);
    const exported = await backup.exportBackup({
      confirmPlaintextSecrets: true,
      groups: ["application-ai", "prompts", "workspace", "archive", "trash"],
      includeKeys: true,
    });
    const inspection = await backup.inspectBackupFile({ json: exported.json });

    expect(inspection).toMatchObject({
      availableGroups: [
        "application-ai",
        "prompts",
        "workspace",
        "archive",
        "trash",
      ],
      containsSecrets: true,
      containsUnencryptedSecrets: true,
      encrypted: false,
    });
    await expect(
      backup.previewImport({
        groups: inspection.availableGroups,
        json: exported.json,
      }),
    ).resolves.toMatchObject({ conflicts: [] });
    database.close();
  });

  it("re-imports a workspace backup after its exact Branch was moved to trash", async () => {
    const database = await openDatabase("workspace-trash-relocation");
    const workspace = graphRecords("workspace-trash-relocation", "workspace");
    await putRecords(database, workspace.records);
    const backup = runtime(database);
    const exported = await backup.exportBackup({
      groups: ["workspace"],
      includeKeys: false,
    });
    await putRecords(database, {
      branchPlacements: [
        {
          ...workspace.records.branchPlacements![0],
          deletionReason: "workspace-session",
          location: "trash",
          purgeAfter: null,
          retentionStartedAt: 100,
          trashedAt: 100,
          trashOrigin: "workspace",
          trashOriginFolderId: null,
          trashOriginPathSnapshot: null,
        },
      ],
    });
    const removeWorkspace = database.transaction(
      ["trashSessionPlacements", "workspaceSessionPlacements"],
      "readwrite",
    );
    removeWorkspace
      .objectStore("workspaceSessionPlacements")
      .delete(workspace.ids.sessionId);
    removeWorkspace.objectStore("trashSessionPlacements").put({
      deletionReason: "legacy-populated-trash-owner",
      order: 0,
      pinned: false,
      purgeAfter: null,
      retentionStartedAt: 100,
      sessionId: workspace.ids.sessionId,
      trashedAt: 100,
      trashOrigin: "workspace",
    });
    await transactionDone(removeWorkspace);

    const preview = await backup.previewImport({
      groups: ["workspace"],
      json: exported.json,
    });
    expect(preview).toMatchObject({
      conflicts: [],
      relocations: [
        {
          branchCount: 1,
          from: "trash",
          sessionId: workspace.ids.sessionId,
          to: "workspace",
        },
      ],
    });
    await backup.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    expect(await allRecords(database, "branchPlacements")).toContainEqual(
      expect.objectContaining({
        branchId: workspace.ids.branchId,
        location: "workspace",
        sessionId: workspace.ids.sessionId,
      }),
    );
    expect(await allRecords(database, "trashSessionPlacements")).toEqual([]);
    database.close();
  });

  it("exports and restores a populated trash Branch with its lifetime metadata", async () => {
    const source = await openDatabase("trash-branch-source");
    const destination = await openDatabase("trash-branch-destination");
    const trash = graphRecords("trash-branch", "trash");
    await putRecords(source, trash.records);

    const exported = await exportPlacement(source, "trash");
    expect(JSON.parse(exported)).toMatchObject({
      groups: {
        trash: {
          branchPlacements: [
            expect.objectContaining({
              branchId: trash.ids.branchId,
              location: "trash",
              trashOrigin: "workspace",
              trashedAt: 50,
            }),
          ],
          sessions: [
            expect.objectContaining({ sessionId: trash.ids.sessionId }),
          ],
        },
      },
    });
    const destinationRuntime = runtime(destination);
    const preview = await destinationRuntime.previewImport({
      groups: ["trash"],
      json: exported,
    });
    await destinationRuntime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });
    expect(await allRecords(destination, "branchPlacements")).toContainEqual(
      expect.objectContaining({
        branchId: trash.ids.branchId,
        location: "trash",
        purgeAfter: 9_999_999,
        retentionStartedAt: 50,
        trashedAt: 50,
      }),
    );
    source.close();
    destination.close();
  });

  it("round-trips archive-origin trash Branch metadata without creating an empty-session trash owner", async () => {
    const source = await openDatabase("trash-archive-origin-source");
    const destination = await openDatabase("trash-archive-origin-destination");
    const trash = graphRecords("trash-archive-origin", "trash");
    await putRecords(source, trash.records);
    const destinationRuntime = runtime(destination);
    const preview = await destinationRuntime.previewImport({
      groups: ["trash"],
      json: await exportPlacement(source, "trash"),
    });
    await destinationRuntime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    expect(await allRecords(destination, "branchPlacements")).toContainEqual(
      expect.objectContaining({
        branchId: trash.ids.branchId,
        location: "trash",
        trashOrigin: "archive",
        trashOriginFolderId: "archived-before-delete",
        trashOriginPathSnapshot: "归档 / 课程",
      }),
    );
    expect(await allRecords(destination, "trashSessionPlacements")).toEqual([]);
    source.close();
    destination.close();
  });

  it("previews re-import into the same database even when an unrelated local orphan exists", async () => {
    const database = await openDatabase("same-database-reimport");
    const workspace = graphRecords("same-database-workspace", "workspace");
    await putRecords(database, workspace.records);
    await putRecords(database, {
      generationRuns: [
        {
          runId: "same-database-unrelated-orphan-run",
          sessionId: "same-database-unrelated-orphan-session",
        },
      ],
    });
    const backup = runtime(database);
    const exported = await backup.exportBackup({
      groups: ["workspace"],
      includeKeys: false,
    });

    await expect(
      backup.previewImport({ groups: ["workspace"], json: exported.json }),
    ).resolves.toMatchObject({
      conflicts: [],
      selectedGroups: ["workspace"],
    });
    database.close();
  });

  it("rolls back every selected owner record and placement when an attachment write fails", async () => {
    const source = await openDatabase("rollback-source");
    const destination = await openDatabase("rollback-destination");
    const incoming = graphRecords("incoming-rollback", "workspace");
    const old = graphRecords("old-rollback", "workspace");
    const untouched = graphRecords("untouched-rollback", "archive");
    await putRecords(source, incoming.records);
    await putRecords(destination, old.records);
    await putRecords(destination, untouched.records);
    const before = await databaseSnapshot(destination);
    const json = await exportPlacement(source, "workspace");
    const injectedRuntime = runtime(
      databaseWithInjectedAttachmentFailure(destination),
    );
    const preview = await injectedRuntime.previewImport({
      groups: ["workspace"],
      json,
    });

    let rejected = false;
    try {
      await injectedRuntime.commitImport({
        confirmation: "replace-selected-groups",
        preview,
      });
    } catch (error) {
      rejected = true;
      expect(error).toMatchObject({ code: "BACKUP_IMPORT_TRANSACTION_FAILED" });
    }

    expect(await databaseSnapshot(destination)).toEqual(before);
    expect(rejected).toBe(true);
    source.close();
    destination.close();
  });

  it("accepts one shared Session across selected placements when its immutable data matches", async () => {
    const database = await openDatabase("selected-placement-conflict");
    const existing = graphRecords("existing-conflict", "trash");
    await putRecords(database, existing.records);
    const before = await databaseSnapshot(database);
    const sharedSession = {
      createdAt: 1,
      lastActivityAt: 1,
      sessionId: "shared-selected-session",
      subtitleContextRevision: 1,
      title: "shared",
      videoKey: "bvid:BV1SHARED:cid:77:p:1",
    };

    const preview = await runtime(database).previewImport({
      groups: ["workspace", "archive"],
      json: JSON.stringify({
        groups: {
          archive: {
            folders: [],
            sessions: [
              {
                ...sharedSession,
                folderId: "archive-root",
                order: 0,
                placement: "archive",
              },
            ],
          },
          workspace: {
            sessions: [
              {
                ...sharedSession,
                order: 0,
                pinned: false,
                placement: "workspace",
              },
            ],
          },
        },
        version: 1,
      }),
    });

    expect(preview.conflicts).toEqual([]);
    expect(await databaseSnapshot(database)).toEqual(before);
    database.close();
  });

  describe("v12 batch backup round trip", () => {
    async function seedBatchData(database: IDBDatabase): Promise<void> {
      const transaction = database.transaction(
        [
          "batchJobs",
          "batchItems",
          "batchSubtitles",
          "batchSourceHistory",
          "workspaceBatchPlacements",
          "archiveBatchPlacements",
        ],
        "readwrite",
      );
      const done = new Promise<void>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve(), {
          once: true,
        });
        transaction.addEventListener("error", () => reject(transaction.error), {
          once: true,
        });
      });
      transaction.objectStore("batchJobs").put({
        batchJobId: "job-1",
        browserSessionId: "browser-1",
        createdAt: 1,
        name: "工作区列表",
        status: "ready",
        updatedAt: 1,
      });
      transaction.objectStore("batchJobs").put({
        batchJobId: "job-2",
        browserSessionId: "browser-1",
        createdAt: 2,
        name: "归档列表",
        status: "running",
        updatedAt: 2,
      });
      transaction.objectStore("batchItems").put({
        batchItemId: "item-1",
        batchJobId: "job-1",
        bvid: "BV1b7411N798",
        errorCode: null,
        order: 0,
        page: 1,
        rowCount: 0,
        selected: true,
        status: "pending",
        title: "工作区视频",
        trackId: null,
        updatedAt: 1,
        videoKey: null,
      });
      transaction.objectStore("batchSubtitles").put({
        batchItemId: "item-1",
        batchJobId: "job-1",
        language: "zh",
        rows: [{ startMs: 0, endMs: 1000, text: "行" }],
        source: "official",
        trackId: "track-1",
        updatedAt: 1,
      });
      transaction.objectStore("batchSourceHistory").put({
        addedAt: 1,
        addedCount: 1,
        batchJobId: "job-1",
        duplicateCount: 0,
        sourceHistoryId: "history-1",
        sourceKey: "single-video:BV1b7411N798:p:1",
        sourceKind: "single-video",
      });
      transaction.objectStore("workspaceBatchPlacements").put({
        batchJobId: "job-1",
        order: 1,
        pinned: true,
      });
      transaction.objectStore("archiveBatchPlacements").put({
        archivedAt: 10,
        batchJobId: "job-2",
        order: 2,
        pinned: false,
      });
      await done;
    }

    it("exports batch groups with sanitized items and imports them into a fresh database", async () => {
      const source = await openDatabase("batch-source");
      await seedBatchData(source);
      const json = (
        await runtime(source).exportBackup({
          groups: ["batch-workspace", "batch-archive"],
          includeKeys: false,
        })
      ).json;
      // 导出不含 selected 临时态。
      expect(json).not.toContain('"selected":true');
      // 导出包含净化来源历史；批量标签系统已删除（Ticket 05）。
      expect(json).toContain('"sourceKey"');
      expect(json).not.toContain('"tag-1"');

      const destination = await openDatabase("batch-destination");
      const destinationRuntime = runtime(destination);
      const preview = await destinationRuntime.previewImport({
        groups: ["batch-workspace", "batch-archive"],
        json,
      });
      await destinationRuntime.commitImport({
        confirmation: "replace-selected-groups",
        preview,
      });
      const exported = (
        await destinationRuntime.exportBackup({
          groups: ["batch-workspace", "batch-archive"],
          includeKeys: false,
        })
      ).json;
      // 往返等价：两组均可再次导出且含同样内容。
      expect(exported).toContain('"工作区列表"');
      expect(exported).toContain('"归档列表"');
      // 批量标签系统已删除：导出不含标签数据。
      expect(exported).not.toContain('"tag-1"');
      // 导入运行态规范化：running → ready。
      expect(exported).not.toContain('"status":"running"');
      expect(exported).toContain('"status":"ready"');
    });

    it("rejects orphan items and duplicate placements across groups with zero writes", async () => {
      const destination = await openDatabase("batch-invalid");
      await expect(
        runtime(destination).previewImport({
          groups: ["batch-workspace"],
          json: JSON.stringify({
            groups: {
              "batch-workspace": {
                history: [],
                items: [
                  {
                    batchItemId: "item-orphan",
                    batchJobId: "job-missing",
                    bvid: "BV1b7411N798",
                    errorCode: null,
                    order: 0,
                    page: 1,
                    rowCount: 0,
                    status: "pending",
                    title: "孤儿",
                    trackId: null,
                    updatedAt: 1,
                    videoKey: null,
                  },
                ],
                jobs: [
                  {
                    batchJobId: "job-a",
                    browserSessionId: "browser-1",
                    createdAt: 1,
                    name: "列表A",
                    status: "ready",
                    updatedAt: 1,
                  },
                ],
                placements: [
                  { batchJobId: "job-a", order: 1, pinned: false },
                  { batchJobId: "job-b", order: 2, pinned: false },
                ],
                subtitles: [],
              },
            },
            version: 1,
          }),
        }),
      ).rejects.toThrow();
    });
  });

  it("round-trips batch trash with metadata and reports preview counts", async () => {
    const source = await openDatabase("batch-trash-source");
    const transaction = source.transaction(
      ["batchJobs", "trashBatchPlacements"],
      "readwrite",
    );
    const done = new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve(), { once: true });
      transaction.addEventListener("error", () => reject(transaction.error), {
        once: true,
      });
    });
    transaction.objectStore("batchJobs").put({
      batchJobId: "job-t",
      browserSessionId: "browser-1",
      createdAt: 3,
      name: "回收站列表",
      status: "cancelled",
      updatedAt: 3,
    });
    transaction.objectStore("trashBatchPlacements").put({
      batchJobId: "job-t",
      deletionReason: "user-delete",
      order: 3,
      pinned: false,
      purgeAfter: null,
      retentionStartedAt: 200,
      trashedAt: 200,
      trashOrigin: "workspace",
    });
    await done;

    const json = (
      await runtime(source).exportBackup({
        groups: ["batch-trash"],
        includeKeys: false,
      })
    ).json;
    expect(json).toContain('"回收站列表"');
    expect(json).toContain('"trashOrigin":"workspace"');

    const destination = await openDatabase("batch-trash-dest");
    const destinationRuntime = runtime(destination);
    const preview = await destinationRuntime.previewImport({
      groups: ["batch-trash"],
      json,
    });
    // 预览计数：批量组 incoming 为 { lists, items, subtitles }（无标签）。
    const counts = preview.statistics["batch-trash"].incoming;
    expect(counts).toMatchObject({ items: 0, lists: 1, subtitles: 0 });

    await destinationRuntime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });
    const exported = (
      await destinationRuntime.exportBackup({
        groups: ["batch-trash"],
        includeKeys: false,
      })
    ).json;
    expect(exported).toContain('"回收站列表"');
    // 回收站语义保持：trashedAt/retentionStartedAt 保留。
    expect(exported).toContain('"trashedAt":200');
    expect(exported).toContain('"trashOrigin":"workspace"');
    // 不自动恢复：导入后仍在 trash 组。
    const workspaceJson = (
      await destinationRuntime.exportBackup({
        groups: ["batch-workspace"],
        includeKeys: false,
      })
    ).json;
    expect(workspaceJson).not.toContain('"回收站列表"');
  });

  it("rejects a cross-group duplicate list and leaves the database unchanged", async () => {
    const destination = await openDatabase("batch-conflict");
    const destinationRuntime = runtime(destination);
    const json = JSON.stringify({
      groups: {
        "batch-workspace": {
          history: [],
          items: [],
          jobs: [
            {
              batchJobId: "job-dup",
              browserSessionId: "browser-1",
              createdAt: 1,
              name: "重复",
              status: "ready",
              updatedAt: 1,
            },
          ],
          placements: [{ batchJobId: "job-dup", order: 1, pinned: false }],
          subtitles: [],
        },
        "batch-archive": {
          archiveTags: [],
          history: [],
          items: [],
          jobs: [
            {
              batchJobId: "job-dup",
              browserSessionId: "browser-1",
              createdAt: 1,
              name: "重复",
              status: "ready",
              updatedAt: 1,
            },
          ],
          placements: [{ batchJobId: "job-dup", order: 1, pinned: false }],
          subtitles: [],
          tags: [{ name: "旧标签", order: 0, tagId: "old-tag-1" }],
        },
      },
      version: 1,
    });
    await expect(
      destinationRuntime.previewImport({
        groups: ["batch-workspace", "batch-archive"],
        json,
      }),
    ).rejects.toThrow();

    // 零写入：数据库没有 job-dup。
    const transaction = destination.transaction("batchJobs", "readonly");
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = transaction.objectStore("batchJobs").get("job-dup");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    expect(stored).toBeUndefined();
  });
  it("旧备份批量组携带标签数据时 preview 标记 ignoredBatchTags（静默跳过）", async () => {
    const destination = await openDatabase("batch-tags-dest");
    const destinationRuntime = runtime(destination);
    const json = JSON.stringify({
      groups: {
        "batch-workspace": {
          history: [],
          items: [],
          jobs: [
            {
              batchJobId: "job-tags",
              browserSessionId: "b",
              createdAt: 1,
              name: "带标签的列表",
              sourceKind: "favorites",
              sourceLabel: "带标签的列表",
              status: "ready",
              updatedAt: 1,
            },
          ],
          placements: [{ batchJobId: "job-tags", order: 1, pinned: false }],
          subtitles: [],
          tags: [{ name: "旧标签", order: 0, tagId: "old-tag-1" }],
          archiveTags: [{ batchJobId: "job-tags", tagIds: ["old-tag-1"] }],
        },
      },
      version: 1,
    });
    const preview = await destinationRuntime.previewImport({
      groups: ["batch-workspace"],
      json,
    });
    expect(preview.ignoredBatchTags).toBe(true);
    // 标签数据被静默跳过：导入后无标签 store 且列表可读。
    await destinationRuntime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });
    const jobs = destination.transaction("batchJobs", "readonly");
    const storedJob = await new Promise<unknown>((resolve, reject) => {
      const request = jobs.objectStore("batchJobs").get("job-tags");
      request.addEventListener("success", () => resolve(request.result), {
        once: true,
      });
      request.addEventListener("error", () => reject(request.error), {
        once: true,
      });
    });
    expect(storedJob).toMatchObject({ batchJobId: "job-tags" });
  });

  it("keeps unselected batch groups untouched and rejects local conflicts", async () => {
    const destination = await openDatabase("batch-conflict-local");
    // 本地已有 batch-trash 的 job-local。
    const seed = destination.transaction(
      ["batchJobs", "trashBatchPlacements"],
      "readwrite",
    );
    const seedDone = new Promise<void>((resolve, reject) => {
      seed.addEventListener("complete", () => resolve(), { once: true });
      seed.addEventListener("error", () => reject(seed.error), { once: true });
    });
    seed.objectStore("batchJobs").put({
      batchJobId: "job-local",
      browserSessionId: "browser-1",
      createdAt: 1,
      name: "本地回收站列表",
      status: "ready",
      updatedAt: 1,
    });
    seed.objectStore("trashBatchPlacements").put({
      batchJobId: "job-local",
      deletionReason: "user-delete",
      order: 1,
      pinned: false,
      purgeAfter: null,
      retentionStartedAt: 100,
      trashedAt: 100,
      trashOrigin: "workspace",
    });
    await seedDone;

    const destinationRuntime = runtime(destination);
    // 备份的 workspace 组包含同 ID job：与未选择的本地 trash 组冲突。
    const json = JSON.stringify({
      groups: {
        "batch-workspace": {
          history: [],
          items: [],
          jobs: [
            {
              batchJobId: "job-local",
              browserSessionId: "browser-1",
              createdAt: 1,
              name: "本地回收站列表",
              status: "ready",
              updatedAt: 1,
            },
          ],
          placements: [{ batchJobId: "job-local", order: 1, pinned: false }],
          subtitles: [],
        },
      },
      version: 1,
    });
    const preview = await destinationRuntime.previewImport({
      groups: ["batch-workspace"],
      json,
    });
    await expect(
      destinationRuntime.commitImport({
        confirmation: "replace-selected-groups",
        preview,
      }),
    ).rejects.toThrow();
    // 本地 trash 数据保持不变。
    const trashed = await destinationRuntime.exportBackup({
      groups: ["batch-trash"],
      includeKeys: false,
    });
    expect(trashed.json).toContain('"本地回收站列表"');
  });
});
