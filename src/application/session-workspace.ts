import {
  createSession as createDomainSession,
  type Session,
  type VideoKey,
  type VideoRef,
} from "../domain";
import {
  bindVideoSession,
  createEmptySessionRecord,
  nextEmptySessionTitle,
  type BindVideoSessionInput,
} from "./session-management";
import type { SessionRepository } from "./session-repository";
import { StorageError } from "./storage";
import type { VideoGateway } from "./video-gateway";
import {
  activateWorkspaceSession,
  restoreWorkspace,
  saveWorkspaceView,
  type RestoredWorkspace,
  type SessionWorkspaceState,
  type WorkspaceRestorationRepository,
  type WorkspaceState,
  type WorkspaceStateStore,
} from "./workspace-restoration";

export interface SessionWorkspaceSnapshot {
  readonly restoredWorkspace: RestoredWorkspace | null;
  readonly sessions: readonly Session[];
}

export interface SessionWorkspaceTrashRepository {
  moveWorkspaceSessionToTrash(
    sessionId: string,
    deletionReason: string,
  ): Promise<readonly unknown[]>;
  moveWorkspaceSessionsToTrash?(
    sessionIds: readonly string[],
    deletionReason: string,
  ): Promise<readonly unknown[]>;
}

export interface SessionWorkspaceRepositoryBundle {
  readonly repository: SessionRepository;
  readonly restorationRepository: WorkspaceRestorationRepository;
  readonly trashRepository?: SessionWorkspaceTrashRepository;
}

export interface SessionWorkspaceLifecycleDependencies {
  cancelBackgroundTasks(videoKey: VideoKey): Promise<void>;
  reopenForRetry(): Promise<SessionWorkspaceRepositoryBundle>;
}

export interface SessionWorkspaceCoordinatorDependencies extends SessionWorkspaceRepositoryBundle {
  readonly archiveRepository?: {
    archiveWorkspaceBranches(
      branchIds: readonly string[],
      folderId: string,
      emptySessionIds?: readonly string[],
    ): Promise<readonly unknown[]>;
  };
  readonly gateway: VideoGateway;
  readonly lifecycle?: SessionWorkspaceLifecycleDependencies;
  readonly stateStore: WorkspaceStateStore;
}

export interface SessionWorkspaceCoordinator {
  initialize(): Promise<SessionWorkspaceSnapshot>;
  createSession(input?: {
    readonly pageRevision?: number;
    readonly titleBase?: string;
  }): Promise<SessionWorkspaceSnapshot>;
  synchronizeCreatedSession(input: {
    readonly pageRevision: number;
    readonly sessionId: string;
    readonly video: VideoRef | null;
  }): Promise<SessionWorkspaceSnapshot>;
  bind(input: BindVideoSessionInput): Promise<SessionWorkspaceSnapshot>;
  select(sessionId: string): Promise<SessionWorkspaceSnapshot>;
  rename(sessionId: string, title: string): Promise<SessionWorkspaceSnapshot>;
  setPinned(
    sessionId: string,
    pinned: boolean,
  ): Promise<SessionWorkspaceSnapshot>;
  reorder(
    sessionId: string,
    beforeSessionId: string | null,
  ): Promise<SessionWorkspaceSnapshot>;
  archive(
    sessionId: string,
    branchIds: readonly string[],
    folderId: string,
  ): Promise<SessionWorkspaceSnapshot>;
  archiveMany(
    sessions: readonly {
      readonly branchIds: readonly string[];
      readonly sessionId: string;
    }[],
    folderId: string,
  ): Promise<SessionWorkspaceSnapshot>;
  delete(sessionId: string): Promise<SessionWorkspaceSnapshot>;
  deleteMany(sessionIds: readonly string[]): Promise<SessionWorkspaceSnapshot>;
  saveView(state: SessionWorkspaceState): Promise<void>;
}

export class StaleSessionSynchronizationError extends Error {
  readonly code = "STALE_REQUEST_OWNER";

  constructor() {
    super("The page synchronization no longer owns the created session");
    this.name = "StaleSessionSynchronizationError";
  }
}

const emptyScrollPositions = Object.freeze({
  chat: 0,
  segments: 0,
  summary: 0,
  timeline: 0,
});

function restoredEmptySession(session: Session): RestoredWorkspace {
  return Object.freeze({
    activeMode: "timeline" as const,
    branch: null,
    placement: null,
    scrollTopByMode: emptyScrollPositions,
    session,
    subtitle: null,
  });
}

function hasSessionIdentity(value: unknown): value is Session {
  return (
    typeof value === "object" &&
    value !== null &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    value.sessionId.trim().length > 0 &&
    "title" in value &&
    typeof value.title === "string" &&
    value.title.trim().length > 0
  );
}

function fallbackSessionId(): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ? `session-${randomId}`
    : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function synchronizeVolatileSession(
  session: Session,
  video: VideoRef,
): Session {
  const timestamp = Math.max(
    Date.now(),
    session.updatedAt,
    session.lastActivityAt,
  );
  return createDomainSession({
    ...session,
    lastActivityAt: timestamp,
    title: session.customTitle ? session.title : video.title,
    updatedAt: timestamp,
    videoBound: true,
    videoKey: video.videoKey,
  });
}

function freezeSnapshot(
  sessions: readonly Session[],
  restoredWorkspace: RestoredWorkspace | null,
): SessionWorkspaceSnapshot {
  return Object.freeze({
    restoredWorkspace,
    sessions: Object.freeze([...sessions]),
  });
}

class DefaultSessionWorkspaceCoordinator implements SessionWorkspaceCoordinator {
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly volatileCreatedSessions = new Map<string, Session>();
  private repository: SessionRepository;
  private restorationRepository: WorkspaceRestorationRepository;
  private trashRepository: SessionWorkspaceTrashRepository | undefined;
  private createdSessionOwner: {
    readonly session: Session;
    readonly pageRevision: number;
  } | null = null;

  constructor(
    private readonly dependencies: SessionWorkspaceCoordinatorDependencies,
  ) {
    this.repository = dependencies.repository;
    this.restorationRepository = dependencies.restorationRepository;
    this.trashRepository = dependencies.trashRepository;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async readSnapshot(): Promise<SessionWorkspaceSnapshot> {
    const restoredWorkspace = await restoreWorkspace({
      repository: this.restorationRepository,
      stateStore: this.dependencies.stateStore,
    });
    const sessions = await this.listSessions();
    return freezeSnapshot(sessions, restoredWorkspace);
  }

  private async listSessions(
    excludedSessionIds: ReadonlySet<string> = new Set(),
  ): Promise<readonly Session[]> {
    const stored = await this.repository.list();
    const merged = new Map(this.volatileCreatedSessions);
    if (Array.isArray(stored)) {
      for (const session of stored) {
        if (hasSessionIdentity(session)) merged.set(session.sessionId, session);
      }
    }
    for (const sessionId of excludedSessionIds) merged.delete(sessionId);
    return Object.freeze([...merged.values()]);
  }

  private installRepositoryBundle(
    bundle: SessionWorkspaceRepositoryBundle,
  ): void {
    if (
      this.trashRepository !== undefined &&
      bundle.trashRepository === undefined
    ) {
      throw new StorageError(
        "The reopened Bilimuzhi database is missing its trash repository",
        true,
        "CONNECTION_INVALID",
      );
    }
    this.repository = bundle.repository;
    this.restorationRepository = bundle.restorationRepository;
    this.trashRepository = bundle.trashRepository;
  }

  private async retryClosedConnectionOnce<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        !(error instanceof StorageError) ||
        error.reason !== "CONNECTION_INVALID" ||
        this.dependencies.lifecycle === undefined
      ) {
        throw error;
      }
      let reopened: SessionWorkspaceRepositoryBundle;
      try {
        reopened = await this.dependencies.lifecycle.reopenForRetry();
        this.installRepositoryBundle(reopened);
      } catch (reopenError) {
        if (reopenError instanceof StorageError) throw reopenError;
        throw new StorageError(
          "Unable to reopen the Bilimuzhi database",
          true,
          "CONNECTION_INVALID",
        );
      }
      return operation();
    }
  }

  private async refreshAfterWorkspaceRemoval(
    sessionId: string,
    previousState: WorkspaceState | null,
  ): Promise<SessionWorkspaceSnapshot> {
    return this.refreshAfterWorkspaceRemovals([sessionId], previousState);
  }

  private async refreshAfterWorkspaceRemovals(
    sessionIds: readonly string[],
    previousState: WorkspaceState | null,
  ): Promise<SessionWorkspaceSnapshot> {
    const removedSessionIds = new Set(sessionIds);
    const sessions = await this.listSessions(removedSessionIds);
    const retainedSessionIds = new Set(
      sessions.map((session) => session.sessionId),
    );
    const retainedSessionStates = (previousState?.sessions ?? []).filter(
      (state) =>
        !removedSessionIds.has(state.sessionId) &&
        retainedSessionIds.has(state.sessionId),
    );
    const previousActiveSessionId = previousState?.activeSessionId ?? null;
    const activeSessionId =
      previousActiveSessionId !== null &&
      retainedSessionIds.has(previousActiveSessionId)
        ? previousActiveSessionId
        : (sessions[0]?.sessionId ?? null);
    if (
      activeSessionId !== null &&
      !retainedSessionStates.some(
        (state) => state.sessionId === activeSessionId,
      )
    ) {
      retainedSessionStates.push(
        Object.freeze({
          activeMode: "timeline" as const,
          scrollTopByMode: emptyScrollPositions,
          sessionId: activeSessionId,
        }),
      );
    }
    const nextState: WorkspaceState = Object.freeze({
      activeSessionId,
      sessions: Object.freeze(retainedSessionStates),
      version: 1,
    });
    const previewStateStore: WorkspaceStateStore = {
      async load() {
        return nextState;
      },
      async save() {
        // restoreWorkspace is read-only; this keeps the preview dependency total.
      },
    };
    const restoredWorkspace = await restoreWorkspace({
      repository: this.restorationRepository,
      stateStore: previewStateStore,
    });
    await this.dependencies.stateStore.save(nextState);
    for (const sessionId of removedSessionIds) {
      this.volatileCreatedSessions.delete(sessionId);
    }
    return freezeSnapshot(sessions, restoredWorkspace);
  }

  initialize(): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(() => this.readSnapshot());
  }

  createSession(
    input: {
      readonly pageRevision?: number;
      readonly titleBase?: string;
    } = {},
  ): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      const currentSessions = await this.listSessions();
      const title = nextEmptySessionTitle(currentSessions, input.titleBase);
      const createEmpty = this.repository.createEmpty;
      const stored = createEmpty
        ? await createEmpty.call(this.repository, { title })
        : null;
      const session = hasSessionIdentity(stored)
        ? stored
        : createEmptySessionRecord({
            now: Date.now(),
            sessionId: fallbackSessionId(),
            title,
          });
      this.volatileCreatedSessions.set(session.sessionId, session);
      this.createdSessionOwner = {
        pageRevision: input.pageRevision ?? 0,
        session,
      };
      await activateWorkspaceSession(
        this.dependencies.stateStore,
        session.sessionId,
      );
      return freezeSnapshot(
        await this.listSessions(),
        restoredEmptySession(session),
      );
    });
  }

  synchronizeCreatedSession(input: {
    readonly pageRevision: number;
    readonly sessionId: string;
    readonly video: VideoRef | null;
  }): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      const owner = this.createdSessionOwner;
      if (
        owner === null ||
        owner.session.sessionId !== input.sessionId ||
        !Number.isSafeInteger(input.pageRevision) ||
        input.pageRevision < owner.pageRevision
      ) {
        throw new StaleSessionSynchronizationError();
      }
      this.createdSessionOwner = {
        pageRevision: input.pageRevision,
        session: owner.session,
      };
      if (input.video === null) {
        return freezeSnapshot(
          await this.listSessions(),
          restoredEmptySession(owner.session),
        );
      }

      const synchronizeCreatedSession =
        this.repository.synchronizeCreatedSession;
      const stored = synchronizeCreatedSession
        ? await synchronizeCreatedSession.call(
            this.repository,
            input.sessionId,
            input.video,
          )
        : synchronizeVolatileSession(owner.session, input.video);
      const session = hasSessionIdentity(stored) ? stored : owner.session;
      this.volatileCreatedSessions.set(session.sessionId, session);
      this.createdSessionOwner = {
        pageRevision: input.pageRevision,
        session,
      };
      await activateWorkspaceSession(
        this.dependencies.stateStore,
        session.sessionId,
      );
      return freezeSnapshot(
        await this.listSessions(),
        restoredEmptySession(session),
      );
    });
  }

  bind(input: BindVideoSessionInput): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      const session = await bindVideoSession(
        {
          gateway: this.dependencies.gateway,
          repository: this.repository,
        },
        input,
      );
      await this.repository.touch(session.sessionId);
      await activateWorkspaceSession(
        this.dependencies.stateStore,
        session.sessionId,
      );
      return this.readSnapshot();
    });
  }

  select(sessionId: string): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.repository.touch(sessionId);
      await activateWorkspaceSession(this.dependencies.stateStore, sessionId);
      return this.readSnapshot();
    });
  }

  rename(sessionId: string, title: string): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.repository.rename(sessionId, title);
      return this.readSnapshot();
    });
  }

  setPinned(
    sessionId: string,
    pinned: boolean,
  ): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.repository.setPinned(sessionId, pinned);
      return this.readSnapshot();
    });
  }

  reorder(
    sessionId: string,
    beforeSessionId: string | null,
  ): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      await this.repository.reorder(sessionId, beforeSessionId);
      return this.readSnapshot();
    });
  }

  archive(
    sessionId: string,
    branchIds: readonly string[],
    folderId: string,
  ): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      if (!this.dependencies.archiveRepository) {
        throw new Error("The Bilimuzhi archive repository is unavailable");
      }
      const previousState = await this.dependencies.stateStore.load();
      await this.dependencies.archiveRepository.archiveWorkspaceBranches(
        branchIds,
        folderId,
        branchIds.length === 0 ? [sessionId] : [],
      );
      return this.refreshAfterWorkspaceRemoval(sessionId, previousState);
    });
  }

  archiveMany(
    sessions: readonly {
      readonly branchIds: readonly string[];
      readonly sessionId: string;
    }[],
    folderId: string,
  ): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      if (!this.dependencies.archiveRepository) {
        throw new Error("The Bilimuzhi archive repository is unavailable");
      }
      if (!Array.isArray(sessions) || sessions.length === 0) {
        throw new Error("At least one workspace session must be archived");
      }
      const sessionIds = sessions.map((session) => session.sessionId);
      if (new Set(sessionIds).size !== sessionIds.length) {
        throw new Error("Workspace archive session identities must be unique");
      }
      const branchIds = sessions.flatMap((session) => session.branchIds);
      if (new Set(branchIds).size !== branchIds.length) {
        throw new Error("Workspace archive branch identities must be unique");
      }
      const previousState = await this.dependencies.stateStore.load();
      await this.dependencies.archiveRepository.archiveWorkspaceBranches(
        branchIds,
        folderId,
        sessions
          .filter((session) => session.branchIds.length === 0)
          .map((session) => session.sessionId),
      );
      return this.refreshAfterWorkspaceRemovals(sessionIds, previousState);
    });
  }

  private async moveWorkspaceSessionsToTrash(
    sessionIds: readonly string[],
    deletionReason: string,
  ): Promise<void> {
    await this.retryClosedConnectionOnce(async () => {
      const sessions = await this.repository.list();
      const videoKeys = new Set(
        sessions
          .filter((session) => sessionIds.includes(session.sessionId))
          .map((session) => session.videoKey),
      );
      if (this.dependencies.lifecycle !== undefined) {
        await Promise.all(
          [...videoKeys].map(async (videoKey) => {
            try {
              await this.dependencies.lifecycle?.cancelBackgroundTasks(
                videoKey,
              );
            } catch {
              // Background cleanup is best-effort and cannot own local CRUD.
            }
          }),
        );
      }
      if (this.trashRepository !== undefined) {
        if (
          sessionIds.length > 1 &&
          this.trashRepository.moveWorkspaceSessionsToTrash !== undefined
        ) {
          await this.trashRepository.moveWorkspaceSessionsToTrash(
            sessionIds,
            deletionReason,
          );
          return;
        }
        for (const sessionId of sessionIds) {
          await this.trashRepository.moveWorkspaceSessionToTrash(
            sessionId,
            deletionReason,
          );
        }
        return;
      }
      for (const sessionId of sessionIds) {
        await this.repository.deleteCascade(sessionId);
      }
    });
  }

  delete(sessionId: string): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      const previousState = await this.dependencies.stateStore.load();
      await this.moveWorkspaceSessionsToTrash([sessionId], "workspace-session");
      return this.refreshAfterWorkspaceRemoval(sessionId, previousState);
    });
  }

  deleteMany(sessionIds: readonly string[]): Promise<SessionWorkspaceSnapshot> {
    return this.enqueue(async () => {
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        throw new Error("At least one workspace session must be deleted");
      }
      const normalizedSessionIds = [...new Set(sessionIds)];
      if (normalizedSessionIds.length !== sessionIds.length) {
        throw new Error("Workspace delete session identities must be unique");
      }
      const previousState = await this.dependencies.stateStore.load();
      await this.moveWorkspaceSessionsToTrash(
        normalizedSessionIds,
        "workspace-selection",
      );
      return this.refreshAfterWorkspaceRemovals(
        normalizedSessionIds,
        previousState,
      );
    });
  }

  saveView(state: SessionWorkspaceState): Promise<void> {
    return this.enqueue(async () => {
      await saveWorkspaceView(this.dependencies.stateStore, state);
    });
  }
}

export function createSessionWorkspaceCoordinator(
  dependencies: SessionWorkspaceCoordinatorDependencies,
): SessionWorkspaceCoordinator {
  return new DefaultSessionWorkspaceCoordinator(dependencies);
}
