import type { SessionRepository } from "../../application/session-repository";
import { createEmptySessionRecord } from "../../application/session-management";
import {
  normalizeStorageFailure,
  persistedDataStorageError,
  StorageError,
} from "../../application/storage";
import {
  createSession,
  createWorkspaceSessionPlacement,
  type Session,
  type VideoKey,
  type VideoRef,
  type WorkspaceSessionPlacement,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

export interface IndexedDbSessionRepositoryDependencies {
  readonly createSessionId: () => string;
  readonly now: () => number;
}

function normalizeStorageError(error: unknown): StorageError {
  return normalizeStorageFailure(
    error,
    "Unable to update the Bilimuzhi session database",
  );
}

function readPersistedSession(value: unknown): Session {
  try {
    return createSession(value as Session);
  } catch {
    throw persistedDataStorageError("The persisted Bilimuzhi session is invalid");
  }
}

function readPersistedWorkspacePlacement(
  value: unknown,
): WorkspaceSessionPlacement {
  try {
    return createWorkspaceSessionPlacement(
      value as Parameters<typeof createWorkspaceSessionPlacement>[0],
    );
  } catch {
    throw persistedDataStorageError(
      "The persisted Bilimuzhi workspace placement is invalid",
    );
  }
}

function compareWorkspacePlacements(
  left: WorkspaceSessionPlacement,
  right: WorkspaceSessionPlacement,
): number {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    left.order - right.order ||
    left.sessionId.localeCompare(right.sessionId)
  );
}

function comparePlacementOrder(
  left: WorkspaceSessionPlacement,
  right: WorkspaceSessionPlacement,
): number {
  return (
    left.order - right.order || left.sessionId.localeCompare(right.sessionId)
  );
}

function normalizedPlacementGroup(
  placements: readonly WorkspaceSessionPlacement[],
): readonly WorkspaceSessionPlacement[] {
  return normalizedPlacementSequence(
    [...placements].sort(comparePlacementOrder),
  );
}

function normalizedPlacementSequence(
  placements: readonly WorkspaceSessionPlacement[],
): readonly WorkspaceSessionPlacement[] {
  return Object.freeze(
    placements.map((placement, order) =>
      createWorkspaceSessionPlacement({ ...placement, order }),
    ),
  );
}

async function deleteAllByIndex(
  index: IDBIndex,
  key: IDBValidKey,
): Promise<void> {
  const ownedKeys = await requestResult(index.getAllKeys(key));
  for (const ownedKey of ownedKeys) {
    index.objectStore.delete(ownedKey);
  }
}

export class IndexedDbSessionRepository implements SessionRepository {
  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: IndexedDbSessionRepositoryDependencies,
  ) {}

  async list(): Promise<readonly Session[]> {
    try {
      const transaction = this.database.transaction(
        ["sessions", "workspaceSessionPlacements"],
        "readonly",
      );
      const [stored, storedPlacements] = await Promise.all([
        requestResult(transaction.objectStore("sessions").getAll()),
        requestResult(
          transaction.objectStore("workspaceSessionPlacements").getAll(),
        ),
      ]);
      await transactionDone(transaction);
      const placements = (storedPlacements as readonly unknown[]).map(
        readPersistedWorkspacePlacement,
      );
      const sessionsById = new Map(
        (stored as Session[])
          .map(readPersistedSession)
          .map((session) => [session.sessionId, session] as const),
      );
      const sessions = placements
        .sort(compareWorkspacePlacements)
        .map((placement) => sessionsById.get(placement.sessionId))
        .filter((session): session is Session => session !== undefined);
      return Object.freeze(sessions);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async getByVideoKey(videoKey: VideoKey): Promise<Session | null> {
    try {
      const transaction = this.database.transaction(
        ["sessions", "workspaceSessionPlacements"],
        "readonly",
      );
      const [stored, storedPlacements] = await Promise.all([
        requestResult(
          transaction
            .objectStore("sessions")
            .index("byVideoKey")
            .getAll(videoKey),
        ),
        requestResult(
          transaction.objectStore("workspaceSessionPlacements").getAll(),
        ),
      ]);
      await transactionDone(transaction);
      const sessionsById = new Map(
        (stored as Session[])
          .map(readPersistedSession)
          .map((session) => [session.sessionId, session] as const),
      );
      const selected = (storedPlacements as readonly unknown[])
        .map(readPersistedWorkspacePlacement)
        .filter((placement) => sessionsById.has(placement.sessionId))
        .sort(compareWorkspacePlacements)[0];
      return selected === undefined
        ? null
        : (sessionsById.get(selected.sessionId) ?? null);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async create(video: VideoRef): Promise<Session> {
    try {
      const transaction = this.database.transaction(
        ["sessions", "videos", "workspaceSessionPlacements"],
        "readwrite",
      );
      const sessions = transaction.objectStore("sessions");
      const workspacePlacements = transaction.objectStore(
        "workspaceSessionPlacements",
      );
      const [matchingSessions, storedPlacements] = await Promise.all([
        requestResult(sessions.index("byVideoKey").getAll(video.videoKey)),
        requestResult(workspacePlacements.getAll()),
      ]);
      const matchingSessionsById = new Map(
        (matchingSessions as Session[])
          .map(readPersistedSession)
          .map((session) => [session.sessionId, session] as const),
      );
      const existingPlacement = (storedPlacements as readonly unknown[])
        .map(readPersistedWorkspacePlacement)
        .filter((placement) => matchingSessionsById.has(placement.sessionId))
        .sort(compareWorkspacePlacements)[0];
      if (existingPlacement !== undefined) {
        await transactionDone(transaction);
        return matchingSessionsById.get(existingPlacement.sessionId)!;
      }

      const now = this.dependencies.now();
      const session = createSession({
        activeBranchId: null,
        createdAt: now,
        customTitle: false,
        lastActivityAt: now,
        selectionRevision: 0,
        sessionId: this.dependencies.createSessionId(),
        title: video.title,
        updatedAt: now,
        videoKey: video.videoKey,
      });
      transaction.objectStore("videos").put(video);
      sessions.add(session);
      workspacePlacements.add(
        createWorkspaceSessionPlacement({
          order: now,
          pinned: false,
          sessionId: session.sessionId,
        }),
      );
      await transactionDone(transaction);
      return session;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async createEmpty(input: { readonly title: string }): Promise<Session> {
    try {
      const transaction = this.database.transaction(
        ["sessions", "workspaceSessionPlacements"],
        "readwrite",
      );
      const sessions = transaction.objectStore("sessions");
      const placements = transaction.objectStore("workspaceSessionPlacements");
      const storedPlacements = (await requestResult(
        placements.getAll(),
      )) as readonly unknown[];
      const now = this.dependencies.now();
      const session = createEmptySessionRecord({
        now,
        sessionId: this.dependencies.createSessionId(),
        title: input.title,
      });
      const order = Math.max(
        now,
        ...storedPlacements.map(
          (value) => readPersistedWorkspacePlacement(value).order + 1,
        ),
      );
      sessions.add(session);
      placements.add(
        createWorkspaceSessionPlacement({
          order,
          pinned: false,
          sessionId: session.sessionId,
        }),
      );
      await transactionDone(transaction);
      return session;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async synchronizeCreatedSession(
    sessionId: string,
    video: VideoRef,
  ): Promise<Session> {
    try {
      const transaction = this.database.transaction(
        ["sessions", "videos"],
        "readwrite",
      );
      const sessions = transaction.objectStore("sessions");
      const stored = await requestResult(sessions.get(sessionId));
      if (stored === undefined) {
        await transactionDone(transaction);
        throw new StorageError("The Bilimuzhi session does not exist");
      }
      const existing = readPersistedSession(stored);
      if (
        existing.activeBranchId !== null &&
        existing.videoKey !== video.videoKey
      ) {
        await transactionDone(transaction);
        throw new StorageError("A populated session cannot change its video");
      }
      const timestamp = Math.max(
        this.dependencies.now(),
        existing.updatedAt,
        existing.lastActivityAt,
      );
      const updated = createSession({
        ...existing,
        lastActivityAt: timestamp,
        title: existing.customTitle ? existing.title : video.title,
        updatedAt: timestamp,
        videoBound: true,
        videoKey: video.videoKey,
      });
      transaction.objectStore("videos").put(video);
      sessions.put(updated);
      await transactionDone(transaction);
      return updated;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async rename(sessionId: string, title: string): Promise<Session> {
    try {
      const transaction = this.database.transaction("sessions", "readwrite");
      const sessions = transaction.objectStore("sessions");
      const stored = await requestResult(sessions.get(sessionId));
      if (stored === undefined) {
        await transactionDone(transaction);
        throw new StorageError("The Bilimuzhi session does not exist");
      }
      const existing = readPersistedSession(stored);
      const updated = createSession({
        ...existing,
        customTitle: true,
        title,
        updatedAt: Math.max(this.dependencies.now(), existing.updatedAt),
      });
      sessions.put(updated);
      await transactionDone(transaction);
      return updated;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async touch(sessionId: string): Promise<Session> {
    try {
      const transaction = this.database.transaction("sessions", "readwrite");
      const sessions = transaction.objectStore("sessions");
      const stored = await requestResult(sessions.get(sessionId));
      if (stored === undefined) {
        await transactionDone(transaction);
        throw new StorageError("The Bilimuzhi session does not exist");
      }
      const existing = readPersistedSession(stored);
      const timestamp = Math.max(
        this.dependencies.now(),
        existing.lastActivityAt,
        existing.updatedAt,
      );
      const updated = createSession({
        ...existing,
        lastActivityAt: timestamp,
        updatedAt: timestamp,
      });
      sessions.put(updated);
      await transactionDone(transaction);
      return updated;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async setPinned(
    sessionId: string,
    pinned: boolean,
  ): Promise<WorkspaceSessionPlacement> {
    try {
      const transaction = this.database.transaction(
        "workspaceSessionPlacements",
        "readwrite",
      );
      const store = transaction.objectStore("workspaceSessionPlacements");
      const stored = (await requestResult(
        store.getAll(),
      )) as readonly unknown[];
      const placements = stored.map(readPersistedWorkspacePlacement);
      const existing = placements.find(
        (placement) => placement.sessionId === sessionId,
      );
      if (existing === undefined) {
        await transactionDone(transaction);
        throw new StorageError("The Bilimuzhi workspace session does not exist");
      }
      if (existing.pinned === pinned) {
        await transactionDone(transaction);
        return existing;
      }

      const target = createWorkspaceSessionPlacement({
        ...existing,
        order: 0,
        pinned,
      });
      const targetGroup = normalizedPlacementSequence([
        target,
        ...placements
          .filter(
            (placement) =>
              placement.sessionId !== sessionId && placement.pinned === pinned,
          )
          .sort(comparePlacementOrder),
      ]);
      const otherGroup = normalizedPlacementGroup(
        placements.filter(
          (placement) =>
            placement.sessionId !== sessionId && placement.pinned !== pinned,
        ),
      );
      for (const placement of [...targetGroup, ...otherGroup]) {
        store.put(placement);
      }
      await transactionDone(transaction);
      return targetGroup.find(
        (placement) => placement.sessionId === sessionId,
      )!;
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async reorder(
    sessionId: string,
    beforeSessionId: string | null,
  ): Promise<readonly WorkspaceSessionPlacement[]> {
    try {
      const transaction = this.database.transaction(
        "workspaceSessionPlacements",
        "readwrite",
      );
      const store = transaction.objectStore("workspaceSessionPlacements");
      const stored = (await requestResult(
        store.getAll(),
      )) as readonly unknown[];
      const placements = stored.map(readPersistedWorkspacePlacement);
      const target = placements.find(
        (placement) => placement.sessionId === sessionId,
      );
      if (target === undefined) {
        await transactionDone(transaction);
        throw new StorageError("The Bilimuzhi workspace session does not exist");
      }
      const before =
        beforeSessionId === null
          ? null
          : placements.find(
              (placement) => placement.sessionId === beforeSessionId,
            );
      if (beforeSessionId === sessionId) {
        await transactionDone(transaction);
        throw new StorageError("The Bilimuzhi workspace order target is invalid");
      }
      if (
        beforeSessionId !== null &&
        (before == null || before.pinned !== target.pinned)
      ) {
        await transactionDone(transaction);
        throw new StorageError("The Bilimuzhi workspace order target is invalid");
      }

      const group = placements
        .filter(
          (placement) =>
            placement.pinned === target.pinned &&
            placement.sessionId !== sessionId,
        )
        .sort(comparePlacementOrder);
      const insertionIndex =
        beforeSessionId === null
          ? group.length
          : group.findIndex(
              (placement) => placement.sessionId === beforeSessionId,
            );
      group.splice(insertionIndex, 0, target);
      const normalizedGroup = normalizedPlacementSequence(group);
      for (const placement of normalizedGroup) {
        store.put(placement);
      }
      await transactionDone(transaction);
      return Object.freeze(
        placements
          .filter((placement) => placement.pinned !== target.pinned)
          .concat(normalizedGroup)
          .sort(compareWorkspacePlacements),
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async deleteCascade(sessionId: string): Promise<void> {
    try {
      const transaction = this.database.transaction(
        [
          "archiveSessionPlacements",
          "artifacts",
          "attachments",
          "branchPlacements",
          "chatMessages",
          "chatThreads",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
          "videos",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      const sessions = transaction.objectStore("sessions");
      const stored = await requestResult(sessions.get(sessionId));
      if (stored === undefined) {
        await transactionDone(transaction);
        return;
      }
      const session = readPersistedSession(stored);
      const sessionsForVideo = await requestResult(
        sessions.index("byVideoKey").getAllKeys(session.videoKey),
      );
      sessions.delete(session.sessionId);
      if (sessionsForVideo.length === 1) {
        transaction.objectStore("videos").delete(session.videoKey);
      }
      transaction
        .objectStore("workspaceSessionPlacements")
        .delete(session.sessionId);
      transaction
        .objectStore("archiveSessionPlacements")
        .delete(session.sessionId);
      await Promise.all(
        [
          "artifacts",
          "attachments",
          "branchPlacements",
          "chatMessages",
          "chatThreads",
          "generationRuns",
          "subtitleBranches",
          "subtitleSnapshots",
        ].map((storeName) =>
          deleteAllByIndex(
            transaction.objectStore(storeName).index("bySessionId"),
            session.sessionId,
          ),
        ),
      );
      await transactionDone(transaction);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }
}
