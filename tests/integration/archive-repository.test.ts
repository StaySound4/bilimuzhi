import { afterEach, describe, expect, it } from "vitest";

import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import {
  createArchiveFolder,
  createBranchPlacement,
  createGenerationRun,
  createWorkspaceSessionPlacement,
} from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbArchiveRepository } from "../../src/infrastructure/indexeddb/archive-repository";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";

const databaseNames: string[] = [];

function createDatabaseName(): string {
  const name = `muzhi-archive-${crypto.randomUUID()}`;
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

async function seedWorkspace(database: IDBDatabase): Promise<void> {
  const transaction = database.transaction(
    ["archiveFolders", "branchPlacements", "workspaceSessionPlacements"],
    "readwrite",
  );
  transaction.objectStore("archiveFolders").put(
    createArchiveFolder({
      folderId: "alternate-folder",
      order: 1,
      parentFolderId: "archive-root",
      title: "备选目录",
    }),
  );
  const branches = transaction.objectStore("branchPlacements");
  for (const [branchId, order] of [
    ["branch-one", 0],
    ["branch-two", 1],
  ] as const) {
    branches.put(
      createBranchPlacement({
        branchId,
        deletionReason: null,
        location: "workspace",
        order,
        purgeAfter: null,
        retentionStartedAt: null,
        sessionId: "session-b",
        trashedAt: null,
        trashOrigin: null,
        trashOriginFolderId: null,
        trashOriginPathSnapshot: null,
      }),
    );
  }
  transaction.objectStore("workspaceSessionPlacements").put(
    createWorkspaceSessionPlacement({
      order: 0,
      pinned: false,
      sessionId: "session-b",
    }),
  );
  await transactionDone(transaction);
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("IndexedDbArchiveRepository", () => {
  it("moves only selected workspace branches and keeps a session's original archive projection", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedWorkspace(database);
      const repository = new IndexedDbArchiveRepository(database, {
        now: () => 100,
      });
      await expect(
        repository.archiveWorkspaceBranches(["branch-one"], "archive-root"),
      ).resolves.toMatchObject([
        { branchId: "branch-one", location: "archive" },
      ]);

      let transaction = database.transaction(
        [
          "archiveSessionPlacements",
          "branchPlacements",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      await expect(
        requestResult(
          transaction.objectStore("branchPlacements").get("branch-two"),
        ),
      ).resolves.toMatchObject({ location: "workspace" });
      await expect(
        requestResult(
          transaction
            .objectStore("workspaceSessionPlacements")
            .get("session-b"),
        ),
      ).resolves.toMatchObject({ sessionId: "session-b" });
      await transactionDone(transaction);

      await repository.archiveWorkspaceBranches(
        ["branch-two"],
        "alternate-folder",
      );
      transaction = database.transaction(
        [
          "archiveSessionPlacements",
          "branchPlacements",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      await expect(
        requestResult(
          transaction.objectStore("archiveSessionPlacements").get("session-b"),
        ),
      ).resolves.toMatchObject({
        folderId: "archive-root",
        sessionId: "session-b",
      });
      await expect(
        requestResult(
          transaction.objectStore("branchPlacements").get("branch-two"),
        ),
      ).resolves.toMatchObject({ location: "archive" });
      await expect(
        requestResult(
          transaction
            .objectStore("workspaceSessionPlacements")
            .get("session-b"),
        ),
      ).resolves.toBeUndefined();
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  });

  it("rejects a non-workspace branch without partially creating an archive projection", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedWorkspace(database);
      const repository = new IndexedDbArchiveRepository(database, {
        now: () => 100,
      });
      await repository.archiveWorkspaceBranches(["branch-one"], "archive-root");
      await expect(
        repository.archiveWorkspaceBranches(["branch-one"], "alternate-folder"),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      const transaction = database.transaction(
        "archiveSessionPlacements",
        "readonly",
      );
      await expect(
        requestResult(
          transaction.objectStore("archiveSessionPlacements").get("session-b"),
        ),
      ).resolves.toMatchObject({ folderId: "archive-root" });
      await transactionDone(transaction);
    } finally {
      database.close();
    }
  });

  it("persists folder naming, hierarchy moves, session projection moves, ordering, and pinning", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedWorkspace(database);
      const repository = new IndexedDbArchiveRepository(database, {
        now: () => 100,
      });
      await expect(
        repository.createFolder(
          createArchiveFolder({
            folderId: "child-folder",
            order: 1,
            parentFolderId: "alternate-folder",
            title: "子目录",
          }),
        ),
      ).resolves.toMatchObject({ parentFolderId: "alternate-folder" });
      await expect(
        repository.renameFolder("child-folder", "重命名目录"),
      ).resolves.toMatchObject({ title: "重命名目录" });
      await expect(
        repository.moveFolder("alternate-folder", "child-folder", 5),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        repository.moveFolder("child-folder", "archive-root", 5),
      ).resolves.toMatchObject({ order: 5, parentFolderId: "archive-root" });

      await repository.archiveWorkspaceBranches(
        ["branch-one"],
        "alternate-folder",
      );
      await expect(
        repository.updateSessionPlacement("session-b", "child-folder", 8, true),
      ).resolves.toEqual({
        archivedAt: 100,
        folderId: "child-folder",
        order: 0,
        pinned: true,
        sessionId: "session-b",
      });
      await expect(repository.listSessionPlacements()).resolves.toEqual([
        {
          archivedAt: 100,
          folderId: "child-folder",
          order: 0,
          pinned: true,
          sessionId: "session-b",
        },
      ]);
      await expect(repository.listFolders()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            folderId: "child-folder",
            order: 5,
            title: "重命名目录",
          }),
        ]),
      );
    } finally {
      database.close();
    }
  });

  it("reorders archive sessions only within the same folder pin group and reindexes dense order", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const seed = database.transaction(
        ["archiveSessionPlacements"],
        "readwrite",
      );
      for (const [sessionId, order, pinned] of [
        ["session-a", 0, true],
        ["session-b", 1, true],
        ["session-c", 0, false],
        ["session-d", 1, false],
        ["session-other-folder", 0, false],
      ] as const) {
        seed.objectStore("archiveSessionPlacements").put({
          folderId:
            sessionId === "session-other-folder"
              ? "alternate-folder"
              : "archive-root",
          order,
          pinned,
          sessionId,
        });
      }
      await transactionDone(seed);
      // ensure alternate folder exists for placement validity in other tests only; reorder does not need folder store
      const repository = new IndexedDbArchiveRepository(database, {
        now: () => 100,
      });

      await expect(
        repository.reorderSession("session-b", "session-a"),
      ).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sessionId: "session-b",
            order: 0,
            pinned: true,
            folderId: "archive-root",
          }),
          expect.objectContaining({
            sessionId: "session-a",
            order: 1,
            pinned: true,
            folderId: "archive-root",
          }),
          expect.objectContaining({
            sessionId: "session-c",
            order: 0,
            pinned: false,
          }),
          expect.objectContaining({
            sessionId: "session-d",
            order: 1,
            pinned: false,
          }),
        ]),
      );

      await expect(
        repository.reorderSession("session-c", "session-b"),
      ).rejects.toMatchObject({ code: "STORAGE_TRANSACTION_FAILED" });
      await expect(
        repository.setSessionPinned("session-c", true),
      ).resolves.toMatchObject({
        sessionId: "session-c",
        pinned: true,
        order: 0,
        folderId: "archive-root",
      });
      await expect(repository.listSessionPlacements()).resolves.toEqual([
        {
          archivedAt: 0,
          folderId: "alternate-folder",
          order: 0,
          pinned: false,
          sessionId: "session-other-folder",
        },
        {
          archivedAt: 0,
          folderId: "archive-root",
          order: 0,
          pinned: true,
          sessionId: "session-c",
        },
        {
          archivedAt: 1,
          folderId: "archive-root",
          order: 1,
          pinned: true,
          sessionId: "session-b",
        },
        {
          archivedAt: 0,
          folderId: "archive-root",
          order: 2,
          pinned: true,
          sessionId: "session-a",
        },
        {
          archivedAt: 1,
          folderId: "archive-root",
          order: 0,
          pinned: false,
          sessionId: "session-d",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("archives an empty session and restores it back to the workspace", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      const repository = new IndexedDbArchiveRepository(database, {
        now: () => 100,
      });
      await expect(
        repository.archiveWorkspaceBranches([], "archive-root", [
          "empty-session",
        ]),
      ).resolves.toEqual([]);

      let verify = database.transaction(
        ["archiveSessionPlacements", "workspaceSessionPlacements"],
        "readonly",
      );
      await expect(
        requestResult(
          verify.objectStore("archiveSessionPlacements").get("empty-session"),
        ),
      ).resolves.toMatchObject({ sessionId: "empty-session" });
      await transactionDone(verify);

      await expect(
        repository.restoreEmptyArchivedSessionToWorkspace("empty-session"),
      ).resolves.toMatchObject({ sessionId: "empty-session" });

      verify = database.transaction(
        ["archiveSessionPlacements", "workspaceSessionPlacements"],
        "readonly",
      );
      await expect(
        requestResult(
          verify.objectStore("archiveSessionPlacements").get("empty-session"),
        ),
      ).resolves.toBeUndefined();
      await expect(
        requestResult(
          verify.objectStore("workspaceSessionPlacements").get("empty-session"),
        ),
      ).resolves.toMatchObject({ sessionId: "empty-session" });
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });

  it("stops queued or running generations when their branches are archived", async () => {
    const database = await openBilimuzhiDatabase({
      factory: fakeIndexedDB,
      name: createDatabaseName(),
    });
    try {
      await seedWorkspace(database);
      const runningGeneration = database.transaction(
        "generationRuns",
        "readwrite",
      );
      runningGeneration.objectStore("generationRuns").put(
        createGenerationRun({
          branchId: "branch-one",
          browserSessionId: "archive-browser",
          completionSequence: null,
          contextRevision: 1,
          createdAt: 80,
          errorCode: null,
          expectedOwnerRevision: 0,
          kind: "summary",
          partialOutput: "partial",
          runId: "archive-owned-generation",
          sessionId: "session-b",
          status: "running",
          stopReason: null,
          subtitleId: "owned-subtitle",
          targetId: "archive-target",
          taskId: "archive-generation-task",
          updatedAt: 80,
        }),
      );
      await transactionDone(runningGeneration);

      await new IndexedDbArchiveRepository(database, {
        now: () => 100,
      }).archiveWorkspaceBranches(["branch-one"], "archive-root");

      const verify = database.transaction("generationRuns", "readonly");
      await expect(
        requestResult(
          verify.objectStore("generationRuns").get("archive-owned-generation"),
        ),
      ).resolves.toMatchObject({
        status: "stopped",
        stopReason: "owner-deleted",
      });
      await transactionDone(verify);
    } finally {
      database.close();
    }
  });
});
