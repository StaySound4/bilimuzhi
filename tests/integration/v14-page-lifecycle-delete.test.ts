import { indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createSessionWorkspaceCoordinator,
  type SessionWorkspaceCoordinatorDependencies,
} from "../../src/application/session-workspace";
import { StorageError } from "../../src/application/storage";
import type {
  WorkspaceState,
  WorkspaceStateStore,
} from "../../src/application/workspace-restoration";
import { createVideoRef, type Session, type VideoKey } from "../../src/domain";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbTrashRepository } from "../../src/infrastructure/indexeddb/trash-repository";
import { IndexedDbWorkspaceRestorationRepository } from "../../src/infrastructure/indexeddb/workspace-restoration-repository";

const databaseNames: string[] = [];
const databaseConnections: IDBDatabase[] = [];

type RepositoryBundle = Pick<
  SessionWorkspaceCoordinatorDependencies,
  "repository" | "restorationRepository" | "trashRepository"
>;

interface V14LifecycleDependencies {
  readonly cancelBackgroundTasks: (videoKey: VideoKey) => Promise<void>;
  readonly reopenForRetry: () => Promise<RepositoryBundle>;
}

type V14SessionWorkspaceDependencies =
  SessionWorkspaceCoordinatorDependencies & {
    readonly lifecycle: V14LifecycleDependencies;
  };

interface TestStateStore extends WorkspaceStateStore {
  snapshot(): WorkspaceState;
}

function databaseName(): string {
  const name = `muzhi-v14-lifecycle-${crypto.randomUUID()}`;
  databaseNames.push(name);
  return name;
}

async function openDatabase(name: string): Promise<IDBDatabase> {
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name,
  });
  databaseConnections.push(database);
  return database;
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

function stateStore(sessions: readonly Session[]): TestStateStore {
  let state: WorkspaceState = Object.freeze({
    activeSessionId: sessions[0]?.sessionId ?? null,
    sessions: Object.freeze(
      sessions.map((session) =>
        Object.freeze({
          activeMode: "timeline" as const,
          scrollTopByMode: Object.freeze({
            chat: 0,
            segments: 0,
            summary: 0,
            timeline: 0,
          }),
          sessionId: session.sessionId,
        }),
      ),
    ),
    version: 1,
  });
  return {
    async load() {
      return state;
    },
    async save(next) {
      state = next;
    },
    snapshot() {
      return state;
    },
  };
}

function repositoryBundle(database: IDBDatabase): RepositoryBundle {
  return {
    repository: new IndexedDbSessionRepository(database, {
      createSessionId: () => `unused-${crypto.randomUUID()}`,
      now: () => 9_000,
    }),
    restorationRepository: new IndexedDbWorkspaceRestorationRepository(
      database,
      { now: () => 9_000 },
    ),
    trashRepository: new IndexedDbTrashRepository(database, {
      now: () => 9_000,
    }),
  };
}

async function seedSessions(
  database: IDBDatabase,
  count: number,
): Promise<readonly Session[]> {
  const ids = Array.from(
    { length: count },
    (_, index) => `session-${index + 1}`,
  );
  const repository = new IndexedDbSessionRepository(database, {
    createSessionId: () => ids.shift() ?? "unexpected-session",
    now: () => 1_000,
  });
  const sessions: Session[] = [];
  for (let index = 0; index < count; index += 1) {
    sessions.push(
      await repository.create(
        createVideoRef({
          bvid: "BV1Q541167Qg",
          canonicalUrl: `https://www.bilibili.com/video/BV1Q541167Qg?p=${
            index + 1
          }`,
          cid: 30_000_000_001 + index,
          page: index + 1,
          title: `生命周期视频 ${index + 1}`,
        }),
      ),
    );
  }
  return Object.freeze(sessions);
}

async function storeKeys(
  database: IDBDatabase,
  storeName: string,
): Promise<readonly IDBValidKey[]> {
  return requestResult(
    database
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .getAllKeys(),
  );
}

afterEach(async () => {
  for (const database of databaseConnections.splice(0)) database.close();
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

describe("v14 page-independent session deletion lifecycle", () => {
  it.each([
    {
      label: "a non-video active page after the target tab closed",
      targets: ["session-1"],
    },
    {
      label: "a switched active tab with every target video tab unavailable",
      targets: ["session-1", "session-2"],
    },
  ])(
    "reopens once and immediately refreshes single/multi delete from $label",
    async ({ targets }) => {
      const name = databaseName();
      const originalDatabase = await openDatabase(name);
      const sessions = await seedSessions(originalDatabase, 3);
      const originalBundle = repositoryBundle(originalDatabase);
      const workspaceState = stateStore(sessions);
      originalDatabase.close();

      let reopenedDatabase: IDBDatabase | undefined;
      const reopenForRetry = vi.fn(async () => {
        reopenedDatabase = await openDatabase(name);
        return repositoryBundle(reopenedDatabase);
      });
      const cancelBackgroundTasks = vi.fn<
        V14LifecycleDependencies["cancelBackgroundTasks"]
      >(async () => {
        throw new Error("service worker message channel closed");
      });
      const dependencies: V14SessionWorkspaceDependencies = {
        ...originalBundle,
        gateway: { resolve: vi.fn() },
        lifecycle: { cancelBackgroundTasks, reopenForRetry },
        stateStore: workspaceState,
      };
      const coordinator = createSessionWorkspaceCoordinator(dependencies);

      const snapshot =
        targets.length === 1
          ? await coordinator.delete(targets[0])
          : await coordinator.deleteMany(targets);
      const survivors = sessions.filter(
        (session) => !targets.includes(session.sessionId),
      );
      const survivorSessionIds = survivors.map((session) => session.sessionId);
      const activeSurvivorId = survivorSessionIds[0];

      expect(reopenForRetry).toHaveBeenCalledOnce();
      expect(
        new Set(cancelBackgroundTasks.mock.calls.map(([key]) => key)),
      ).toEqual(
        new Set(
          sessions
            .filter((session) => targets.includes(session.sessionId))
            .map((session) => session.videoKey),
        ),
      );
      expect(snapshot.sessions.map((session) => session.sessionId)).toEqual(
        survivorSessionIds,
      );
      expect(snapshot.restoredWorkspace?.session.sessionId).toBe(
        activeSurvivorId,
      );
      expect(workspaceState.snapshot().activeSessionId).toBe(activeSurvivorId);

      expect(reopenedDatabase).toBeDefined();
      expect(
        await storeKeys(reopenedDatabase!, "workspaceSessionPlacements"),
      ).toEqual(survivorSessionIds);
      expect(
        new Set(await storeKeys(reopenedDatabase!, "trashSessionPlacements")),
      ).toEqual(new Set(targets));
    },
  );

  it("retries a closed connection only once and does not remove or deselect anything when the retry also fails", async () => {
    const name = databaseName();
    const originalDatabase = await openDatabase(name);
    const sessions = await seedSessions(originalDatabase, 2);
    const originalBundle = repositoryBundle(originalDatabase);
    const workspaceState = stateStore(sessions);
    originalDatabase.close();

    const reopenForRetry = vi.fn(async () => {
      const unusableDatabase = await openDatabase(name);
      const unusableBundle = repositoryBundle(unusableDatabase);
      unusableDatabase.close();
      return unusableBundle;
    });
    const dependencies: V14SessionWorkspaceDependencies = {
      ...originalBundle,
      gateway: { resolve: vi.fn() },
      lifecycle: {
        cancelBackgroundTasks: vi.fn(async () => undefined),
        reopenForRetry,
      },
      stateStore: workspaceState,
    };
    const coordinator = createSessionWorkspaceCoordinator(dependencies);

    const error = await coordinator
      .delete("session-1")
      .catch((reason) => reason);

    expect(reopenForRetry).toHaveBeenCalledOnce();
    expect(error).toMatchObject({
      code: "STORAGE_TRANSACTION_FAILED",
      reason: "CONNECTION_INVALID",
      retryable: true,
    });
    expect(workspaceState.snapshot().activeSessionId).toBe("session-1");
    const inspectionDatabase = await openDatabase(name);
    expect(
      await storeKeys(inspectionDatabase, "workspaceSessionPlacements"),
    ).toEqual(["session-1", "session-2"]);
    expect(
      await storeKeys(inspectionDatabase, "trashSessionPlacements"),
    ).toEqual([]);
  });

  it("does not treat persistently corrupted placement data as a reconnectable database handle", async () => {
    const name = databaseName();
    const database = await openDatabase(name);
    const sessions = await seedSessions(database, 2);
    const storedPlacement = await requestResult(
      database
        .transaction("workspaceSessionPlacements", "readonly")
        .objectStore("workspaceSessionPlacements")
        .get("session-1"),
    );
    const corruption = database.transaction(
      "workspaceSessionPlacements",
      "readwrite",
    );
    corruption.objectStore("workspaceSessionPlacements").put({
      ...(storedPlacement as Record<string, unknown>),
      order: "not-a-persisted-order",
    });
    await transactionDone(corruption);

    const reopenForRetry = vi.fn(async () =>
      repositoryBundle(await openDatabase(name)),
    );
    const workspaceState = stateStore(sessions);
    const dependencies: V14SessionWorkspaceDependencies = {
      ...repositoryBundle(database),
      gateway: { resolve: vi.fn() },
      lifecycle: {
        cancelBackgroundTasks: vi.fn(async () => undefined),
        reopenForRetry,
      },
      stateStore: workspaceState,
    };
    const coordinator = createSessionWorkspaceCoordinator(dependencies);

    const error = await coordinator
      .delete("session-1")
      .catch((reason) => reason);

    expect(error).toBeInstanceOf(StorageError);
    expect(error).toMatchObject({
      code: "STORAGE_TRANSACTION_FAILED",
      reason: "PERSISTED_DATA_INVALID",
      retryable: false,
    });
    expect(reopenForRetry).not.toHaveBeenCalled();
    expect(workspaceState.snapshot().activeSessionId).toBe("session-1");
    expect(
      await requestResult(
        database
          .transaction("workspaceSessionPlacements", "readonly")
          .objectStore("workspaceSessionPlacements")
          .get("session-1"),
      ),
    ).toBeDefined();
    expect(
      await requestResult(
        database
          .transaction("trashSessionPlacements", "readonly")
          .objectStore("trashSessionPlacements")
          .get("session-1"),
      ),
    ).toBeUndefined();
  });
});
