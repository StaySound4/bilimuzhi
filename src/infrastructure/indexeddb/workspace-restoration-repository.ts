import type {
  RestorableWorkspaceData,
  WorkspaceRestorationRepository,
  WorkspaceStartupRouter,
  RoutedWorkspaceData,
} from "../../application/workspace-restoration";
import {
  normalizeStorageFailure,
  StorageError,
} from "../../application/storage";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  type BranchPlacement,
  type Session,
  type SubtitleBranch,
  type SubtitleSnapshot,
  type VideoKey,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

function normalizeStorageError(error: unknown): StorageError {
  return normalizeStorageFailure(
    error,
    "Unable to restore the Bilimuzhi workspace",
  );
}

export interface IndexedDbWorkspaceRestorationRepositoryDependencies {
  readonly now: () => number;
}

function compareBranchRecency(
  left: SubtitleBranch,
  right: SubtitleBranch,
): number {
  return (
    right.lastOpenedAt - left.lastOpenedAt ||
    right.createdAt - left.createdAt ||
    left.branchId.localeCompare(right.branchId)
  );
}

export class IndexedDbWorkspaceRestorationRepository
  implements WorkspaceRestorationRepository, WorkspaceStartupRouter
{
  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: IndexedDbWorkspaceRestorationRepositoryDependencies = {
      now: () => Date.now(),
    },
  ) {}

  async restore(sessionId: string): Promise<RestorableWorkspaceData | null> {
    try {
      const transaction = this.database.transaction(
        [
          "branchPlacements",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readonly",
      );
      const storedSession = await requestResult(
        transaction.objectStore("sessions").get(sessionId),
      );
      if (storedSession === undefined) {
        await transactionDone(transaction);
        return null;
      }

      const session = createSession(storedSession as Session);
      if (session.activeBranchId === null) {
        await transactionDone(transaction);
        return Object.freeze({
          branch: null,
          placement: null,
          session,
          subtitle: null,
        });
      }

      const [storedBranch, storedPlacement] = await Promise.all([
        requestResult(
          transaction
            .objectStore("subtitleBranches")
            .get(session.activeBranchId),
        ),
        requestResult(
          transaction
            .objectStore("branchPlacements")
            .get(session.activeBranchId),
        ),
      ]);
      if (storedBranch === undefined || storedPlacement === undefined) {
        throw new StorageError("The Bilimuzhi workspace data is inconsistent");
      }
      const branch = createSubtitleBranch(storedBranch as SubtitleBranch);
      const placement = createBranchPlacement(
        storedPlacement as BranchPlacement,
      );
      const storedSubtitle = await requestResult(
        transaction
          .objectStore("subtitleSnapshots")
          .get(branch.activeSubtitleId),
      );
      if (storedSubtitle === undefined) {
        throw new StorageError("The Bilimuzhi workspace data is inconsistent");
      }
      const subtitle = createSubtitleSnapshot(
        storedSubtitle as SubtitleSnapshot,
      );
      if (
        branch.branchId !== session.activeBranchId ||
        branch.sessionId !== session.sessionId ||
        branch.videoKey !== session.videoKey ||
        placement.branchId !== branch.branchId ||
        placement.sessionId !== session.sessionId ||
        placement.location === "trash" ||
        subtitle.subtitleId !== branch.activeSubtitleId ||
        subtitle.branchId !== branch.branchId ||
        subtitle.sessionId !== session.sessionId ||
        subtitle.videoKey !== session.videoKey ||
        subtitle.status !== "active"
      ) {
        throw new StorageError("The Bilimuzhi workspace data is inconsistent");
      }

      await transactionDone(transaction);
      return Object.freeze({ branch, placement, session, subtitle });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async route(videoKey: VideoKey): Promise<RoutedWorkspaceData | null> {
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        ["branchPlacements", "subtitleBranches"],
        "readonly",
      );
      const branchesStore = transaction.objectStore("subtitleBranches");
      const placementsStore = transaction.objectStore("branchPlacements");
      const storedBranches = await requestResult(
        branchesStore.index("byVideoKey").getAll(videoKey),
      );
      const branches = (storedBranches as readonly SubtitleBranch[]).map(
        (value) => createSubtitleBranch(value as SubtitleBranch),
      );
      const branchById = new Map(
        branches.map((branch) => [branch.branchId, branch] as const),
      );
      const sessionIds = [
        ...new Set(branches.map((branch) => branch.sessionId)),
      ];
      const storedPlacements = (
        await Promise.all(
          sessionIds.map((sessionId) =>
            requestResult(
              placementsStore
                .index("bySessionLocation")
                .getAll([sessionId, "workspace"]),
            ),
          ),
        )
      ).flat() as readonly BranchPlacement[];
      const candidates = storedPlacements.map((value) =>
        createBranchPlacement(value as BranchPlacement),
      );
      const selected = candidates
        .flatMap((placement) => {
          const branch = branchById.get(placement.branchId);
          return branch === undefined ? [] : [{ branch, placement }];
        })
        .sort((left, right) =>
          compareBranchRecency(left.branch, right.branch),
        )[0];
      await transactionDone(transaction);
      if (!selected) {
        return null;
      }

      transaction = this.database.transaction(
        [
          "branchPlacements",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readwrite",
      );
      const updateBranches = transaction.objectStore("subtitleBranches");
      const updatePlacements = transaction.objectStore("branchPlacements");
      const sessions = transaction.objectStore("sessions");
      const subtitles = transaction.objectStore("subtitleSnapshots");
      const [storedBranch, storedPlacement, storedSession, storedSubtitle] =
        await Promise.all([
          requestResult(updateBranches.get(selected.branch.branchId)),
          requestResult(updatePlacements.get(selected.branch.branchId)),
          requestResult(sessions.get(selected.branch.sessionId)),
          requestResult(subtitles.get(selected.branch.activeSubtitleId)),
        ]);
      if (
        storedBranch === undefined ||
        storedPlacement === undefined ||
        storedSession === undefined ||
        storedSubtitle === undefined
      ) {
        throw new StorageError("The Bilimuzhi workspace data is inconsistent");
      }
      const selectedBranch = createSubtitleBranch(
        storedBranch as SubtitleBranch,
      );
      const selectedPlacement = createBranchPlacement(
        storedPlacement as BranchPlacement,
      );
      const session = createSession(storedSession as Session);
      const subtitle = createSubtitleSnapshot(
        storedSubtitle as SubtitleSnapshot,
      );
      if (
        session.videoKey !== videoKey ||
        selectedBranch.sessionId !== session.sessionId ||
        selectedBranch.videoKey !== videoKey ||
        selectedPlacement.branchId !== selectedBranch.branchId ||
        selectedPlacement.sessionId !== session.sessionId ||
        selectedPlacement.location !== "workspace" ||
        subtitle.subtitleId !== selectedBranch.activeSubtitleId ||
        subtitle.branchId !== selectedBranch.branchId ||
        subtitle.sessionId !== session.sessionId ||
        subtitle.videoKey !== videoKey ||
        subtitle.status !== "active"
      ) {
        throw new StorageError("The Bilimuzhi workspace data is inconsistent");
      }
      if (
        session.activeBranchId !== selectedBranch.branchId &&
        session.selectionRevision === Number.MAX_SAFE_INTEGER
      ) {
        throw new StorageError("The Bilimuzhi workspace data is inconsistent");
      }

      const timestamp = Math.max(
        this.dependencies.now(),
        selectedBranch.createdAt,
        selectedBranch.updatedAt,
        selectedBranch.lastOpenedAt,
        session.updatedAt,
        session.lastActivityAt,
      );
      const branch = createSubtitleBranch({
        ...selectedBranch,
        lastOpenedAt: timestamp,
        lastSelectedAt: timestamp,
        updatedAt: timestamp,
      });
      const updatedSession = createSession({
        ...session,
        activeBranchId: branch.branchId,
        lastActivityAt: timestamp,
        selectionRevision:
          session.activeBranchId === branch.branchId
            ? session.selectionRevision
            : session.selectionRevision + 1,
        updatedAt: timestamp,
      });
      updateBranches.put(branch);
      sessions.put(updatedSession);
      await transactionDone(transaction);
      return Object.freeze({
        branch,
        location: "workspace",
        placement: selectedPlacement,
        session: updatedSession,
        subtitle,
      });
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
      }
      throw normalizeStorageError(error);
    }
  }
}
