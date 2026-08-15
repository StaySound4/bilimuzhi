import { createTrashRetentionSetting } from "../../application/settings-contract";
import { StorageError } from "../../application/storage";
import {
  calculateTrashPurgeAfter,
  createBranchPlacement,
  createTrashSessionPlacement,
  createTrashRetentionPolicy,
  type BranchPlacement,
  type TrashRetentionApplyMode,
  type TrashRetentionPolicy,
  type TrashSessionPlacement,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";
import {
  selectExpiredTrashPlacements,
  selectNextTrashPurgeAt,
  type ExpiredTrashPlacement,
} from "./trash-retention-eligibility";

const TRASH_RETENTION_SETTING_KEY = "trashRetention";

export interface IndexedDbRetentionRepositoryDependencies {
  readonly now: () => number;
}

function normalizeStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError("Unable to update the Bilimuzhi retention settings");
}

function readPolicy(value: unknown): TrashRetentionPolicy {
  return createTrashRetentionSetting(
    value as {
      readonly key: "trashRetention";
      readonly policy: TrashRetentionPolicy;
      readonly updatedAt: number;
    },
  ).policy;
}

function readPlacement(value: unknown): BranchPlacement {
  return createBranchPlacement(value as BranchPlacement);
}

function readTrashSessionPlacement(value: unknown): TrashSessionPlacement {
  return createTrashSessionPlacement(value as TrashSessionPlacement);
}

export class IndexedDbRetentionRepository {
  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: IndexedDbRetentionRepositoryDependencies,
  ) {}

  async getPolicy(): Promise<TrashRetentionPolicy> {
    try {
      const transaction = this.database.transaction("settings", "readonly");
      const stored = await requestResult(
        transaction.objectStore("settings").get(TRASH_RETENTION_SETTING_KEY),
      );
      await transactionDone(transaction);
      if (stored === undefined) {
        throw new StorageError("The Bilimuzhi retention setting is missing");
      }
      return readPolicy(stored);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async updatePolicy(
    inputPolicy: TrashRetentionPolicy,
    applyMode: TrashRetentionApplyMode,
  ): Promise<readonly BranchPlacement[]> {
    const policy = createTrashRetentionPolicy(inputPolicy);
    if (applyMode !== "apply-to-existing" && applyMode !== "future-only") {
      throw new StorageError("The Bilimuzhi retention apply mode is invalid");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        ["branchPlacements", "settings", "trashSessionPlacements"],
        "readwrite",
      );
      const settings = transaction.objectStore("settings");
      const storedSetting = await requestResult(
        settings.get(TRASH_RETENTION_SETTING_KEY),
      );
      if (storedSetting === undefined) {
        throw new StorageError("The Bilimuzhi retention setting is missing");
      }
      readPolicy(storedSetting);
      const now = this.dependencies.now();
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new StorageError("The Bilimuzhi retention clock is invalid");
      }
      settings.put(
        createTrashRetentionSetting({
          key: TRASH_RETENTION_SETTING_KEY,
          policy,
          updatedAt: now,
        }),
      );
      if (applyMode === "future-only") {
        await transactionDone(transaction);
        return Object.freeze([]);
      }

      const placements = transaction.objectStore("branchPlacements");
      const trashSessions = transaction.objectStore("trashSessionPlacements");
      const [storedPlacements, storedTrashSessions] = await Promise.all([
        requestResult(placements.getAll()),
        requestResult(trashSessions.getAll()),
      ]);
      const updated = (storedPlacements as readonly unknown[]).flatMap(
        (storedPlacement) => {
          const placement = readPlacement(storedPlacement);
          if (placement.location !== "trash") return [];
          const next = createBranchPlacement({
            ...placement,
            purgeAfter: calculateTrashPurgeAfter(now, policy),
            retentionStartedAt: now,
          });
          placements.put(next);
          return [next];
        },
      );
      for (const storedTrashSession of storedTrashSessions as readonly unknown[]) {
        const placement = readTrashSessionPlacement(storedTrashSession);
        trashSessions.put(
          createTrashSessionPlacement({
            ...placement,
            purgeAfter: calculateTrashPurgeAfter(now, policy),
            retentionStartedAt: now,
          }),
        );
      }
      await transactionDone(transaction);
      return Object.freeze(updated);
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // A completed transaction has no work left to roll back.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async listExpired(now: number): Promise<readonly ExpiredTrashPlacement[]> {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new StorageError("The Bilimuzhi retention clock is invalid");
    }
    try {
      const transaction = this.database.transaction(
        "branchPlacements",
        "readonly",
      );
      const storedPlacements = await requestResult(
        transaction.objectStore("branchPlacements").getAll(),
      );
      await transactionDone(transaction);
      return selectExpiredTrashPlacements(
        (storedPlacements as readonly unknown[]).map(readPlacement),
        now,
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async getNextPurgeAt(): Promise<number | null> {
    try {
      const transaction = this.database.transaction(
        ["branchPlacements", "trashSessionPlacements"],
        "readonly",
      );
      const [storedPlacements, storedTrashSessions] = await Promise.all([
        requestResult(transaction.objectStore("branchPlacements").getAll()),
        requestResult(
          transaction.objectStore("trashSessionPlacements").getAll(),
        ),
      ]);
      await transactionDone(transaction);
      const branchPurgeAt = selectNextTrashPurgeAt(
        (storedPlacements as readonly unknown[]).map(readPlacement),
      );
      const sessionPurgeAt = (storedTrashSessions as readonly unknown[]).reduce<
        number | null
      >((next, stored) => {
        const purgeAfter = readTrashSessionPlacement(stored).purgeAfter;
        if (purgeAfter === null) return next;
        return next === null || purgeAfter < next ? purgeAfter : next;
      }, null);
      if (branchPurgeAt === null) return sessionPurgeAt;
      if (sessionPurgeAt === null) return branchPurgeAt;
      return Math.min(branchPurgeAt, sessionPurgeAt);
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }
}
