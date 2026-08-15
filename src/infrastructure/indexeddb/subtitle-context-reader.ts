import type { ArtifactScope } from "../../application/artifact-repository";
import { StorageError } from "../../application/storage";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  type SubtitleRow,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

export interface SubtitleContextContent {
  readonly language: string;
  readonly rows: readonly SubtitleRow[];
  readonly title: string;
  readonly videoKey: string;
}

export interface SubtitleContextReader {
  read(scope: ArtifactScope): Promise<SubtitleContextContent | null>;
  readByBranch(input: {
    readonly branchId: string;
    readonly sessionId: string;
  }): Promise<{
    readonly language: string;
    readonly rows: readonly SubtitleRow[];
  } | null>;
}

/**
 * Reads the exact active subtitle content of a scope inside the extension
 * background. Long subtitles therefore never cross the runtime message
 * channel just to build an AI request.
 */
export class IndexedDbSubtitleContextReader implements SubtitleContextReader {
  constructor(private readonly database: IDBDatabase) {}

  /** Reads the active snapshot of one committed branch, e.g. a batch result. */
  async readByBranch(input: {
    readonly branchId: string;
    readonly sessionId: string;
  }): Promise<{
    readonly language: string;
    readonly rows: readonly SubtitleRow[];
  } | null> {
    try {
      const transaction = this.database.transaction(
        ["subtitleBranches", "subtitleSnapshots"],
        "readonly",
      );
      const done = transactionDone(transaction);
      const storedBranch = await requestResult(
        transaction.objectStore("subtitleBranches").get(input.branchId),
      );
      const branch = createSubtitleBranch(
        storedBranch as Parameters<typeof createSubtitleBranch>[0],
      );
      if (
        branch.sessionId !== input.sessionId ||
        branch.activeSubtitleId === null
      ) {
        await done;
        return null;
      }
      const storedSubtitle = await requestResult(
        transaction
          .objectStore("subtitleSnapshots")
          .get(branch.activeSubtitleId),
      );
      await done;
      const subtitle = createSubtitleSnapshot(
        storedSubtitle as Parameters<typeof createSubtitleSnapshot>[0],
      );
      if (
        subtitle.branchId !== input.branchId ||
        subtitle.sessionId !== input.sessionId ||
        subtitle.status !== "active"
      ) {
        return null;
      }
      return Object.freeze({
        language: subtitle.language,
        rows: subtitle.rows,
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      return null;
    }
  }

  async read(scope: ArtifactScope): Promise<SubtitleContextContent | null> {
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
      const done = transactionDone(transaction);
      const [storedSession, storedBranch, storedPlacement, storedSubtitle] =
        await Promise.all([
          requestResult(
            transaction.objectStore("sessions").get(scope.sessionId),
          ),
          requestResult(
            transaction.objectStore("subtitleBranches").get(scope.branchId),
          ),
          requestResult(
            transaction.objectStore("branchPlacements").get(scope.branchId),
          ),
          requestResult(
            transaction.objectStore("subtitleSnapshots").get(scope.subtitleId),
          ),
        ]);
      await done;
      const session = createSession(
        storedSession as Parameters<typeof createSession>[0],
      );
      const branch = createSubtitleBranch(
        storedBranch as Parameters<typeof createSubtitleBranch>[0],
      );
      const placement = createBranchPlacement(
        storedPlacement as Parameters<typeof createBranchPlacement>[0],
      );
      const subtitle = createSubtitleSnapshot(
        storedSubtitle as Parameters<typeof createSubtitleSnapshot>[0],
      );
      if (
        session.sessionId !== scope.sessionId ||
        branch.sessionId !== scope.sessionId ||
        branch.branchId !== scope.branchId ||
        branch.activeSubtitleId !== scope.subtitleId ||
        branch.contextRevision !== scope.contextRevision ||
        placement.branchId !== scope.branchId ||
        placement.location === "trash" ||
        subtitle.sessionId !== scope.sessionId ||
        subtitle.branchId !== scope.branchId ||
        subtitle.status !== "active"
      ) {
        return null;
      }
      return Object.freeze({
        language: subtitle.language,
        rows: subtitle.rows,
        title: session.title,
        videoKey: session.videoKey,
      });
    } catch (error) {
      if (error instanceof StorageError) throw error;
      return null;
    }
  }
}
