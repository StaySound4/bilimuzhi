import { createTrashRetentionSetting } from "../../application/settings-contract";
import {
  normalizeStorageFailure,
  persistedDataStorageError,
  StorageError,
} from "../../application/storage";
import {
  calculateTrashPurgeAfter,
  createArchiveFolder,
  readArchivePlacementFromStored,
  createBranchPlacement,
  createGenerationRun,
  createSession,
  createTrashSessionPlacement,
  createWorkspaceSessionPlacement,
  isInFlightGenerationStatus,
  type ArchiveFolder,
  type ArchiveSessionPlacement,
  type BranchPlacement,
  type GenerationRun,
  type TrashRetentionPolicy,
  type TrashSessionPlacement,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";
import { stopActiveGenerationRun } from "./generation-run-stopping";
import { ROOT_ARCHIVE_FOLDER_ID } from "./muzhi-database";
import { selectExpiredTrashPlacements } from "./trash-retention-eligibility";

const TRASH_RETENTION_SETTING_KEY = "trashRetention";

export interface IndexedDbTrashRepositoryDependencies {
  readonly now: () => number;
}

export interface ArchiveFolderDeletionPreview {
  readonly branchCount: number;
  readonly branchIds: readonly string[];
  readonly folderIds: readonly string[];
  readonly runningTaskCount: number;
  readonly sessionCount: number;
  readonly sessionIds: readonly string[];
}

export interface TrashPermanentDeleteResult {
  readonly branchIds: readonly string[];
  readonly sessionIds: readonly string[];
}

/**
 * Preview of a user-initiated trash permanent deletion, used only to build
 * the confirmation copy. Counts are deduplicated; running tasks are the
 * generation runs on the selected branches that are still queued/running.
 */
export interface TrashPermanentDeletionPreview {
  readonly branchCount: number;
  readonly sessionCount: number;
  readonly runningTaskCount: number;
}

function normalizeStorageError(error: unknown): StorageError {
  return normalizeStorageFailure(
    error,
    "Unable to move Bilimuzhi branches to the trash",
  );
}

async function deleteAllByIndex(
  index: IDBIndex,
  key: IDBValidKey,
): Promise<void> {
  const keys = await requestResult(index.getAllKeys(key));
  for (const value of keys) {
    index.objectStore.delete(value);
  }
}

function normalizeBranchIds(branchIds: readonly string[]): readonly string[] {
  if (!Array.isArray(branchIds) || branchIds.length === 0) {
    throw new StorageError("Trash requires at least one branch");
  }
  const normalized = branchIds.map((branchId) => {
    if (
      typeof branchId !== "string" ||
      branchId.trim().length === 0 ||
      branchId !== branchId.trim()
    ) {
      throw new StorageError("Trash branch identity is invalid");
    }
    return branchId;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new StorageError("Trash branch identities must be unique");
  }
  return Object.freeze(normalized);
}

function normalizeSessionIds(sessionIds: readonly string[]): readonly string[] {
  if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
    throw new StorageError("Trash requires at least one session");
  }
  const normalized = sessionIds.map((sessionId) => {
    if (
      typeof sessionId !== "string" ||
      sessionId.trim().length === 0 ||
      sessionId !== sessionId.trim()
    ) {
      throw new StorageError("Trash session identity is invalid");
    }
    return sessionId;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new StorageError("Trash session identities must be unique");
  }
  return Object.freeze(normalized);
}

function readPlacement(value: unknown): BranchPlacement {
  try {
    return createBranchPlacement(value as BranchPlacement);
  } catch {
    throw persistedDataStorageError(
      "The persisted Bilimuzhi branch placement is invalid",
    );
  }
}

function readArchivePlacement(value: unknown): ArchiveSessionPlacement {
  try {
    return readArchivePlacementFromStored(value);
  } catch {
    throw persistedDataStorageError(
      "The persisted Bilimuzhi archive placement is invalid",
    );
  }
}

function readTrashSessionPlacement(value: unknown): TrashSessionPlacement {
  try {
    return createTrashSessionPlacement(value as TrashSessionPlacement);
  } catch {
    throw persistedDataStorageError(
      "The persisted Bilimuzhi trash placement is invalid",
    );
  }
}

function readFolder(value: unknown): ArchiveFolder {
  try {
    return createArchiveFolder(value as ArchiveFolder);
  } catch {
    throw persistedDataStorageError(
      "The persisted Bilimuzhi archive folder is invalid",
    );
  }
}

function readRetentionPolicy(value: unknown): TrashRetentionPolicy {
  try {
    return createTrashRetentionSetting(
      value as {
        readonly key: "trashRetention";
        readonly policy: TrashRetentionPolicy;
        readonly updatedAt: number;
      },
    ).policy;
  } catch {
    throw persistedDataStorageError(
      "The persisted Bilimuzhi trash retention setting is invalid",
    );
  }
}

function readWorkspacePlacement(value: unknown) {
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

function archivePathSnapshot(
  folderId: string,
  folders: ReadonlyMap<string, ArchiveFolder>,
): string {
  const titles: string[] = [];
  const visited = new Set<string>();
  let currentFolderId: string | null = folderId;
  while (currentFolderId !== null) {
    if (visited.has(currentFolderId)) {
      throw new StorageError("The Bilimuzhi archive folder tree is cyclic");
    }
    visited.add(currentFolderId);
    const folder = folders.get(currentFolderId);
    if (folder === undefined) {
      throw new StorageError("The Bilimuzhi archive folder does not exist");
    }
    titles.push(folder.title);
    currentFolderId = folder.parentFolderId;
  }
  return titles.reverse().join(" / ");
}

function resolveFolderSubtree(
  folderId: string,
  folders: readonly ArchiveFolder[],
): readonly string[] {
  if (folderId === ROOT_ARCHIVE_FOLDER_ID) {
    throw new StorageError("The Bilimuzhi archive root cannot be deleted");
  }
  const folderById = new Map(
    folders.map((folder) => [folder.folderId, folder] as const),
  );
  if (!folderById.has(folderId)) {
    throw new StorageError("The Bilimuzhi archive folder does not exist");
  }
  const subtree: string[] = [];
  const pending = [folderId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined || visited.has(current)) {
      if (current !== undefined) {
        throw new StorageError("The Bilimuzhi archive folder tree is cyclic");
      }
      continue;
    }
    visited.add(current);
    subtree.push(current);
    for (const folder of folders) {
      if (folder.parentFolderId === current) pending.push(folder.folderId);
    }
  }
  return Object.freeze(subtree);
}

function countRunningTasks(
  branchIds: ReadonlySet<string>,
  generationRuns: readonly unknown[],
): number {
  return generationRuns.reduce<number>((count, value) => {
    try {
      const run = createGenerationRun(value as GenerationRun);
      return branchIds.has(run.branchId) &&
        isInFlightGenerationStatus(run.status)
        ? count + 1
        : count;
    } catch {
      return count;
    }
  }, 0);
}

function createFolderDeletionPreview(
  folderId: string,
  folders: readonly ArchiveFolder[],
  archivePlacements: readonly ArchiveSessionPlacement[],
  branchPlacements: readonly BranchPlacement[],
  generationRuns: readonly unknown[],
): ArchiveFolderDeletionPreview {
  const folderIds = resolveFolderSubtree(folderId, folders);
  const folderIdSet = new Set(folderIds);
  const sessionIds = Object.freeze(
    archivePlacements
      .filter((placement) => folderIdSet.has(placement.folderId))
      .map((placement) => placement.sessionId)
      .sort(),
  );
  const sessionIdSet = new Set(sessionIds);
  const branchIds = Object.freeze(
    branchPlacements
      .filter(
        (placement) =>
          placement.location === "archive" &&
          sessionIdSet.has(placement.sessionId),
      )
      .map((placement) => placement.branchId)
      .sort(),
  );
  const runningTaskCount = countRunningTasks(
    new Set(branchIds),
    generationRuns,
  );
  return Object.freeze({
    branchCount: branchIds.length,
    branchIds,
    folderIds,
    runningTaskCount,
    sessionCount: sessionIds.length,
    sessionIds,
  });
}

export class IndexedDbTrashRepository {
  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: IndexedDbTrashRepositoryDependencies,
  ) {}

  private async moveToTrashInternal(
    inputBranchIds: readonly string[] | null,
    deletionReason: string,
    folderIdToDelete: string | null,
    workspaceSessionIdsToDelete: readonly string[] | null = null,
  ): Promise<readonly BranchPlacement[]> {
    const requestedBranchIds =
      inputBranchIds === null ? null : normalizeBranchIds(inputBranchIds);
    const requestedWorkspaceSessionIds =
      workspaceSessionIdsToDelete === null
        ? null
        : normalizeSessionIds(workspaceSessionIdsToDelete);
    const workspaceSessionIdSet = new Set(requestedWorkspaceSessionIds ?? []);
    if (
      typeof deletionReason !== "string" ||
      deletionReason.trim().length === 0 ||
      deletionReason !== deletionReason.trim()
    ) {
      throw new StorageError("Trash deletion reason is invalid");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        [
          "archiveFolders",
          "archiveSessionPlacements",
          "archiveSessionTags",
          "branchPlacements",
          "generationRuns",
          "settings",
          "trashSessionPlacements",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      const archiveFolders = transaction.objectStore("archiveFolders");
      const archiveSessionPlacements = transaction.objectStore(
        "archiveSessionPlacements",
      );
      const archiveSessionTags = transaction.objectStore("archiveSessionTags");
      const branchPlacements = transaction.objectStore("branchPlacements");
      const generationRuns = transaction.objectStore("generationRuns");
      const settings = transaction.objectStore("settings");
      const trashSessionPlacements = transaction.objectStore(
        "trashSessionPlacements",
      );
      const workspaceSessionPlacements = transaction.objectStore(
        "workspaceSessionPlacements",
      );
      const [
        storedPolicy,
        allStoredPlacements,
        storedFolders,
        storedArchivePlacements,
        storedGenerationRuns,
        storedWorkspacePlacements,
        storedTrashSessionPlacements,
      ] = await Promise.all([
        requestResult(settings.get(TRASH_RETENTION_SETTING_KEY)),
        requestResult(branchPlacements.getAll()),
        requestResult(archiveFolders.getAll()),
        requestResult(archiveSessionPlacements.getAll()),
        requestResult(generationRuns.getAll()),
        requestedWorkspaceSessionIds === null
          ? Promise.resolve([])
          : Promise.all(
              requestedWorkspaceSessionIds.map((sessionId) =>
                requestResult(workspaceSessionPlacements.get(sessionId)),
              ),
            ),
        requestedWorkspaceSessionIds === null
          ? Promise.resolve([])
          : Promise.all(
              requestedWorkspaceSessionIds.map((sessionId) =>
                requestResult(trashSessionPlacements.get(sessionId)),
              ),
            ),
      ]);
      if (storedPolicy === undefined) {
        throw new StorageError("The Bilimuzhi retention setting is missing");
      }
      const policy = readRetentionPolicy(storedPolicy);
      const now = this.dependencies.now();
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new StorageError("The Bilimuzhi trash clock is invalid");
      }
      const allPlacements = (allStoredPlacements as readonly unknown[]).map(
        readPlacement,
      );
      for (const index of (requestedWorkspaceSessionIds ?? []).keys()) {
        const storedWorkspacePlacement = storedWorkspacePlacements[index];
        if (storedWorkspacePlacement === undefined) {
          throw new StorageError("The workspace session placement is missing");
        }
        readWorkspacePlacement(storedWorkspacePlacement);
        const storedTrashSessionPlacement = storedTrashSessionPlacements[index];
        if (storedTrashSessionPlacement !== undefined) {
          readTrashSessionPlacement(storedTrashSessionPlacement);
          throw new StorageError("The workspace session is already in trash");
        }
      }
      const folders = (storedFolders as readonly unknown[]).map(readFolder);
      const archivePlacements = (
        storedArchivePlacements as readonly unknown[]
      ).map(readArchivePlacement);
      const placementByBranchId = new Map(
        allPlacements.map(
          (placement) => [placement.branchId, placement] as const,
        ),
      );
      const folderPreview =
        folderIdToDelete === null
          ? null
          : createFolderDeletionPreview(
              folderIdToDelete,
              folders,
              archivePlacements,
              allPlacements,
              storedGenerationRuns as readonly unknown[],
            );
      const branchIds =
        folderPreview === null
          ? requestedWorkspaceSessionIds === null
            ? (requestedBranchIds ?? [])
            : allPlacements
                .filter(
                  (placement) =>
                    workspaceSessionIdSet.has(placement.sessionId) &&
                    placement.location === "workspace",
                )
                .map((placement) => placement.branchId)
          : folderPreview.branchIds;
      const selected = branchIds.map((branchId) => {
        const placement = placementByBranchId.get(branchId);
        if (placement === undefined) {
          throw new StorageError(`The Bilimuzhi branch ${branchId} does not exist`);
        }
        if (placement.location === "trash") {
          throw new StorageError("A trashed branch cannot be trashed again");
        }
        if (folderPreview !== null && placement.location !== "archive") {
          throw new StorageError(
            "An archive folder can only delete archived branches",
          );
        }
        return placement;
      });
      const generationRunsByBranch = await Promise.all(
        branchIds.map((branchId) =>
          requestResult(generationRuns.index("byBranchId").getAll(branchId)),
        ),
      );
      for (const storedRuns of generationRunsByBranch) {
        for (const storedRun of storedRuns as readonly unknown[]) {
          const stopped = stopActiveGenerationRun(storedRun, now);
          if (stopped !== null) generationRuns.put(stopped);
        }
      }
      const folderById = new Map(
        folders.map((folder) => [folder.folderId, folder] as const),
      );
      const archiveSessions = [
        ...new Set(
          selected
            .filter((placement) => placement.location === "archive")
            .map((placement) => placement.sessionId),
        ),
      ];
      const archiveProjectionBySession = new Map(
        archiveSessions.map((sessionId) => {
          const placement = archivePlacements.find(
            (candidate) => candidate.sessionId === sessionId,
          );
          if (placement === undefined) {
            throw new StorageError(
              "An archived branch has no archive session placement",
            );
          }
          return [sessionId, placement] as const;
        }),
      );
      const selectedIds = new Set(branchIds);
      const updated = selected.map((placement) => {
        const trashOrigin = placement.location;
        if (trashOrigin !== "workspace" && trashOrigin !== "archive") {
          throw new StorageError("A trashed branch cannot be trashed again");
        }
        const archiveProjection =
          trashOrigin === "archive"
            ? archiveProjectionBySession.get(placement.sessionId)
            : undefined;
        const next = createBranchPlacement({
          ...placement,
          deletionReason,
          location: "trash",
          purgeAfter: calculateTrashPurgeAfter(now, policy),
          retentionStartedAt: now,
          trashedAt: now,
          trashOrigin,
          trashOriginFolderId: archiveProjection?.folderId ?? null,
          trashOriginPathSnapshot:
            archiveProjection === undefined
              ? null
              : archivePathSnapshot(archiveProjection.folderId, folderById),
        });
        branchPlacements.put(next);
        return next;
      });
      for (const sessionId of new Set(selected.map((item) => item.sessionId))) {
        const hasWorkspaceRemaining = allPlacements.some(
          (placement) =>
            placement.sessionId === sessionId &&
            placement.location === "workspace" &&
            !selectedIds.has(placement.branchId),
        );
        const hasArchiveRemaining = allPlacements.some(
          (placement) =>
            placement.sessionId === sessionId &&
            placement.location === "archive" &&
            !selectedIds.has(placement.branchId),
        );
        if (!hasWorkspaceRemaining) {
          workspaceSessionPlacements.delete(sessionId);
        }
        if (!hasArchiveRemaining) {
          archiveSessionPlacements.delete(sessionId);
          // 归档区删除：会话标签关联一并移除（标签只活在归档区）。
          archiveSessionTags.delete(sessionId);
        }
      }
      for (const [index, sessionId] of (
        requestedWorkspaceSessionIds ?? []
      ).entries()) {
        const sessionHasSelectedBranch = selected.some(
          (placement) => placement.sessionId === sessionId,
        );
        if (sessionHasSelectedBranch) continue;
        const storedWorkspacePlacement = storedWorkspacePlacements[index];
        if (
          allPlacements.some(
            (placement) => placement.sessionId === sessionId,
          ) ||
          archivePlacements.some(
            (placement) => placement.sessionId === sessionId,
          )
        ) {
          throw new StorageError(
            "The empty workspace session retains another content placement",
          );
        }
        const workspacePlacement = readWorkspacePlacement(
          storedWorkspacePlacement,
        );
        trashSessionPlacements.add(
          createTrashSessionPlacement({
            deletionReason,
            order: workspacePlacement.order,
            pinned: workspacePlacement.pinned,
            purgeAfter: calculateTrashPurgeAfter(now, policy),
            retentionStartedAt: now,
            sessionId,
            trashedAt: now,
            trashOrigin: "workspace",
          }),
        );
        workspaceSessionPlacements.delete(sessionId);
      }
      if (folderPreview !== null) {
        for (const sessionId of folderPreview.sessionIds) {
          archiveSessionPlacements.delete(sessionId);
        }
        for (const folderId of [...folderPreview.folderIds].reverse()) {
          archiveFolders.delete(folderId);
        }
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

  async moveToTrash(
    inputBranchIds: readonly string[],
    deletionReason: string,
  ): Promise<readonly BranchPlacement[]> {
    return this.moveToTrashInternal(inputBranchIds, deletionReason, null);
  }

  async moveWorkspaceSessionToTrash(
    sessionId: string,
    deletionReason: string,
  ): Promise<readonly BranchPlacement[]> {
    return this.moveToTrashInternal(null, deletionReason, null, [sessionId]);
  }

  async moveWorkspaceSessionsToTrash(
    sessionIds: readonly string[],
    deletionReason: string,
  ): Promise<readonly BranchPlacement[]> {
    return this.moveToTrashInternal(null, deletionReason, null, sessionIds);
  }

  /**
   * Moves a session that was archived before it had any subtitle into the
   * trash. The session owns no branch, so only its archive session placement
   * moves; the trash row keeps the archive origin for display.
   */
  async moveArchivedEmptySessionToTrash(
    sessionId: string,
    deletionReason: string,
  ): Promise<ReturnType<typeof createTrashSessionPlacement>> {
    if (
      typeof sessionId !== "string" ||
      sessionId.trim().length === 0 ||
      sessionId !== sessionId.trim()
    ) {
      throw new StorageError("Trash session identity is invalid");
    }
    if (
      typeof deletionReason !== "string" ||
      deletionReason.trim().length === 0 ||
      deletionReason !== deletionReason.trim()
    ) {
      throw new StorageError("Trash deletion reason is invalid");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        [
          "archiveSessionPlacements",
          "archiveSessionTags",
          "settings",
          "trashSessionPlacements",
        ],
        "readwrite",
      );
      const archivePlacements = transaction.objectStore(
        "archiveSessionPlacements",
      );
      const trashSessionPlacements = transaction.objectStore(
        "trashSessionPlacements",
      );
      const storedArchivePlacement = await requestResult(
        archivePlacements.get(sessionId),
      );
      if (storedArchivePlacement === undefined) {
        throw new StorageError("The archived empty session does not exist");
      }
      const existingTrashPlacement = await requestResult(
        trashSessionPlacements.get(sessionId),
      );
      if (existingTrashPlacement !== undefined) {
        throw new StorageError("The archived session is already in trash");
      }
      const placement = readArchivePlacement(storedArchivePlacement);
      const now = this.dependencies.now();
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new StorageError("The Bilimuzhi trash clock is invalid");
      }
      const storedPolicy = await requestResult(
        transaction.objectStore("settings").get(TRASH_RETENTION_SETTING_KEY),
      );
      if (storedPolicy === undefined) {
        throw new StorageError("The Bilimuzhi retention setting is missing");
      }
      const policy = readRetentionPolicy(storedPolicy);
      const next = createTrashSessionPlacement({
        deletionReason,
        order: placement.order,
        pinned: placement.pinned,
        purgeAfter: calculateTrashPurgeAfter(now, policy),
        retentionStartedAt: now,
        sessionId,
        trashedAt: now,
        trashOrigin: "archive",
      });
      trashSessionPlacements.add(next);
      archivePlacements.delete(sessionId);
      transaction.objectStore("archiveSessionTags").delete(sessionId);
      await transactionDone(transaction);
      return next;
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

  async previewArchiveFolderDeletion(
    folderId: string,
  ): Promise<ArchiveFolderDeletionPreview> {
    if (
      typeof folderId !== "string" ||
      folderId.trim().length === 0 ||
      folderId !== folderId.trim()
    ) {
      throw new StorageError("Archive folder identity is invalid");
    }
    try {
      const transaction = this.database.transaction(
        [
          "archiveFolders",
          "archiveSessionPlacements",
          "branchPlacements",
          "generationRuns",
        ],
        "readonly",
      );
      const [
        storedFolders,
        storedArchivePlacements,
        storedBranches,
        storedRuns,
      ] = await Promise.all([
        requestResult(transaction.objectStore("archiveFolders").getAll()),
        requestResult(
          transaction.objectStore("archiveSessionPlacements").getAll(),
        ),
        requestResult(transaction.objectStore("branchPlacements").getAll()),
        requestResult(transaction.objectStore("generationRuns").getAll()),
      ]);
      await transactionDone(transaction);
      return createFolderDeletionPreview(
        folderId,
        (storedFolders as readonly unknown[]).map(readFolder),
        (storedArchivePlacements as readonly unknown[]).map(
          readArchivePlacement,
        ),
        (storedBranches as readonly unknown[]).map(readPlacement),
        storedRuns as readonly unknown[],
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async deleteArchiveFolderTree(
    folderId: string,
    deletionReason: string,
  ): Promise<readonly BranchPlacement[]> {
    if (
      typeof folderId !== "string" ||
      folderId.trim().length === 0 ||
      folderId !== folderId.trim()
    ) {
      throw new StorageError("Archive folder identity is invalid");
    }
    return this.moveToTrashInternal(null, deletionReason, folderId);
  }

  async restoreToWorkspace(
    inputBranchIds: readonly string[],
  ): Promise<readonly BranchPlacement[]> {
    const branchIds = normalizeBranchIds(inputBranchIds);
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        [
          "branchPlacements",
          "trashSessionPlacements",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      const branchPlacements = transaction.objectStore("branchPlacements");
      const trashSessionPlacements = transaction.objectStore(
        "trashSessionPlacements",
      );
      const workspaceSessionPlacements = transaction.objectStore(
        "workspaceSessionPlacements",
      );
      const storedPlacements = await Promise.all(
        branchIds.map((branchId) =>
          requestResult(branchPlacements.get(branchId)),
        ),
      );
      const selected = storedPlacements.map((value, index) => {
        if (value === undefined) {
          throw new StorageError(
            `The Bilimuzhi branch ${branchIds[index]} does not exist`,
          );
        }
        const placement = readPlacement(value);
        if (placement.location !== "trash") {
          throw new StorageError(
            "Only trashed branches can be restored to the workspace",
          );
        }
        return placement;
      });
      const sessionIds = [
        ...new Set(selected.map((placement) => placement.sessionId)),
      ];
      const existingWorkspacePlacements = await Promise.all(
        sessionIds.map((sessionId) =>
          requestResult(workspaceSessionPlacements.get(sessionId)),
        ),
      );
      const now = this.dependencies.now();
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new StorageError("The Bilimuzhi workspace restore clock is invalid");
      }
      for (const [index, sessionId] of sessionIds.entries()) {
        if (existingWorkspacePlacements[index] !== undefined) continue;
        workspaceSessionPlacements.add(
          createWorkspaceSessionPlacement({
            order: now + index,
            pinned: false,
            sessionId,
          }),
        );
        // 清理同会话的 trashSessionPlacements 孤儿（该会话已有分支恢复，
        // empty-session 标记不再有效，避免与到期清理/统计冲突）。
        trashSessionPlacements.delete(sessionId);
      }
      const updated = selected.map((placement, index) => {
        const next = createBranchPlacement({
          ...placement,
          deletionReason: null,
          location: "workspace",
          order: now + index,
          purgeAfter: null,
          retentionStartedAt: null,
          trashedAt: null,
          trashOrigin: null,
          trashOriginFolderId: null,
          trashOriginPathSnapshot: null,
        });
        branchPlacements.put(next);
        return next;
      });
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

  async restoreEmptySessionsToWorkspace(
    sessionIds: readonly string[],
  ): Promise<readonly ReturnType<typeof createWorkspaceSessionPlacement>[]> {
    const normalizedSessionIds = normalizeSessionIds(sessionIds);
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        ["sessions", "trashSessionPlacements", "workspaceSessionPlacements"],
        "readwrite",
      );
      const sessions = transaction.objectStore("sessions");
      const trashPlacements = transaction.objectStore("trashSessionPlacements");
      const workspacePlacements = transaction.objectStore(
        "workspaceSessionPlacements",
      );
      const storedRows = await Promise.all(
        normalizedSessionIds.map(async (normalizedSessionId) =>
          Promise.all([
            requestResult(sessions.get(normalizedSessionId)),
            requestResult(trashPlacements.get(normalizedSessionId)),
            requestResult(workspacePlacements.get(normalizedSessionId)),
          ]),
        ),
      );
      const restored = storedRows.map(
        (
          [storedSession, storedTrashPlacement, storedWorkspacePlacement],
          index,
        ) => {
          const normalizedSessionId = normalizedSessionIds[index]!;
          if (storedSession === undefined) {
            throw new StorageError("The trashed session does not exist");
          }
          createSession(storedSession as Parameters<typeof createSession>[0]);
          if (storedTrashPlacement === undefined) {
            throw new StorageError(
              "The trashed session placement does not exist",
            );
          }
          if (storedWorkspacePlacement !== undefined) {
            throw new StorageError(
              "The trashed session is already in the workspace",
            );
          }
          const placement = readTrashSessionPlacement(storedTrashPlacement);
          const next = createWorkspaceSessionPlacement({
            order: placement.order,
            pinned: placement.pinned,
            sessionId: normalizedSessionId,
          });
          workspacePlacements.add(next);
          trashPlacements.delete(normalizedSessionId);
          return next;
        },
      );
      await transactionDone(transaction);
      return Object.freeze(restored);
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

  private async permanentlyDeleteTrashContentInternal(
    inputBranchIds: readonly string[] | null,
    inputSessionIds: readonly string[] | null,
    purgeAtOrBefore: number | null,
  ): Promise<TrashPermanentDeleteResult> {
    const requestedBranchIds =
      inputBranchIds === null
        ? null
        : inputBranchIds.length === 0
          ? Object.freeze([])
          : normalizeBranchIds(inputBranchIds);
    const requestedSessionIds =
      inputSessionIds === null
        ? null
        : inputSessionIds.length === 0
          ? Object.freeze([])
          : normalizeSessionIds(inputSessionIds);
    if (
      purgeAtOrBefore === null &&
      requestedBranchIds?.length === 0 &&
      requestedSessionIds?.length === 0
    ) {
      throw new StorageError("Permanent delete requires trash content");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
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
          "trashSessionPlacements",
          "videos",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      const branchPlacements = transaction.objectStore("branchPlacements");
      const sessions = transaction.objectStore("sessions");
      const trashSessionPlacements = transaction.objectStore(
        "trashSessionPlacements",
      );
      const [allStoredPlacements, allStoredTrashSessions, allStoredSessions] =
        await Promise.all([
          requestResult(branchPlacements.getAll()),
          requestResult(trashSessionPlacements.getAll()),
          requestResult(sessions.getAll()),
        ]);
      const allPlacements = (allStoredPlacements as readonly unknown[]).map(
        readPlacement,
      );
      const allTrashSessions = (
        allStoredTrashSessions as readonly unknown[]
      ).map(readTrashSessionPlacement);
      const allSessions = (allStoredSessions as readonly unknown[]).map(
        (stored) =>
          createSession(stored as Parameters<typeof createSession>[0]),
      );
      const sessionById = new Map(
        allSessions.map((session) => [session.sessionId, session] as const),
      );
      const placementByBranchId = new Map(
        allPlacements.map(
          (placement) => [placement.branchId, placement] as const,
        ),
      );
      const selectedBranches =
        requestedBranchIds === null
          ? selectExpiredTrashPlacements(
              allPlacements,
              purgeAtOrBefore as number,
            ).map((eligible) => placementByBranchId.get(eligible.branchId)!)
          : requestedBranchIds.map((branchId) => {
              const placement = placementByBranchId.get(branchId);
              if (placement === undefined) {
                throw new StorageError(
                  `The Bilimuzhi branch ${branchId} does not exist`,
                );
              }
              if (placement.location !== "trash") {
                throw new StorageError(
                  "Only trash branches can be permanently deleted",
                );
              }
              return placement;
            });
      const branchIds = Object.freeze(
        selectedBranches.map((placement) => placement.branchId),
      );
      const trashSessionById = new Map(
        allTrashSessions.map((placement) => [placement.sessionId, placement]),
      );
      const selectedTrashSessions =
        requestedSessionIds === null
          ? allTrashSessions.filter(
              (placement) =>
                placement.purgeAfter !== null &&
                placement.purgeAfter <= (purgeAtOrBefore as number),
            )
          : requestedSessionIds.map((sessionId) => {
              const placement = trashSessionById.get(sessionId);
              if (placement === undefined) {
                throw new StorageError(
                  `The Bilimuzhi trash session ${sessionId} does not exist`,
                );
              }
              return placement;
            });
      const emptySessionIds = Object.freeze(
        selectedTrashSessions.map((placement) => placement.sessionId),
      );
      for (const sessionId of emptySessionIds) {
        if (
          allPlacements.some((placement) => placement.sessionId === sessionId)
        ) {
          throw new StorageError(
            "A session-level trash item cannot retain subtitle placements",
          );
        }
      }
      if (branchIds.length === 0 && emptySessionIds.length === 0) {
        await transactionDone(transaction);
        return Object.freeze({ branchIds, sessionIds: emptySessionIds });
      }
      const now = this.dependencies.now();
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new StorageError("The Bilimuzhi permanent delete clock is invalid");
      }
      const selectedIds = new Set(branchIds);
      const branchSessionIds = [
        ...new Set(selectedBranches.map((placement) => placement.sessionId)),
      ];
      const fullyDeletedSessionIds = new Set(emptySessionIds);
      for (const sessionId of branchSessionIds) {
        if (
          !allPlacements.some(
            (placement) =>
              placement.sessionId === sessionId &&
              !selectedIds.has(placement.branchId),
          )
        ) {
          fullyDeletedSessionIds.add(sessionId);
        }
      }
      for (const sessionId of new Set([
        ...branchSessionIds,
        ...emptySessionIds,
      ])) {
        const session = sessionById.get(sessionId);
        if (session === undefined) {
          throw new StorageError("The Bilimuzhi branch session does not exist");
        }
        if (fullyDeletedSessionIds.has(sessionId)) continue;
        if (
          session.activeBranchId !== null &&
          selectedIds.has(session.activeBranchId)
        ) {
          if (session.selectionRevision === Number.MAX_SAFE_INTEGER) {
            throw new StorageError(
              "The Bilimuzhi session selection revision overflowed",
            );
          }
          sessions.put(
            createSession({
              ...session,
              activeBranchId: null,
              selectionRevision: session.selectionRevision + 1,
              updatedAt: Math.max(now, session.updatedAt),
            }),
          );
        }
      }
      const ownedBranchIndexes = [
        "artifacts",
        "attachments",
        "chatMessages",
        "chatThreads",
        "generationRuns",
        "subtitleSnapshots",
      ].map((storeName) =>
        transaction!.objectStore(storeName).index("byBranchId"),
      );
      for (const branchId of branchIds) {
        branchPlacements.delete(branchId);
        transaction.objectStore("subtitleBranches").delete(branchId);
        await Promise.all(
          ownedBranchIndexes.map((index) => deleteAllByIndex(index, branchId)),
        );
      }
      const sessionOwnedStoreNames = [
        "artifacts",
        "attachments",
        "branchPlacements",
        "chatMessages",
        "chatThreads",
        "generationRuns",
        "subtitleBranches",
        "subtitleSnapshots",
      ] as const;
      for (const sessionId of fullyDeletedSessionIds) {
        sessions.delete(sessionId);
        transaction.objectStore("workspaceSessionPlacements").delete(sessionId);
        transaction.objectStore("archiveSessionPlacements").delete(sessionId);
        trashSessionPlacements.delete(sessionId);
        await Promise.all(
          sessionOwnedStoreNames.map((storeName) =>
            deleteAllByIndex(
              transaction!.objectStore(storeName).index("bySessionId"),
              sessionId,
            ),
          ),
        );
      }
      const videos = transaction.objectStore("videos");
      const deletedVideoKeys = new Set<string>();
      for (const sessionId of fullyDeletedSessionIds) {
        const session = sessionById.get(sessionId)!;
        if (deletedVideoKeys.has(session.videoKey)) continue;
        const hasSurvivingSession = allSessions.some(
          (candidate) =>
            candidate.videoKey === session.videoKey &&
            !fullyDeletedSessionIds.has(candidate.sessionId),
        );
        if (!hasSurvivingSession) {
          videos.delete(session.videoKey);
          deletedVideoKeys.add(session.videoKey);
        }
      }
      await transactionDone(transaction);
      return Object.freeze({
        branchIds: Object.freeze([...branchIds]),
        sessionIds: Object.freeze([...emptySessionIds]),
      });
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

  async permanentlyDeleteTrashBranches(
    inputBranchIds: readonly string[],
  ): Promise<readonly string[]> {
    return (
      await this.permanentlyDeleteTrashContentInternal(inputBranchIds, [], null)
    ).branchIds;
  }

  async permanentlyDeleteTrashContent(input: {
    readonly branchIds: readonly string[];
    readonly sessionIds: readonly string[];
  }): Promise<TrashPermanentDeleteResult> {
    return this.permanentlyDeleteTrashContentInternal(
      input.branchIds,
      input.sessionIds,
      null,
    );
  }

  async permanentlyDeleteExpiredTrashBranches(
    now: number,
  ): Promise<readonly string[]> {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new StorageError("The Bilimuzhi retention clock is invalid");
    }
    return (await this.permanentlyDeleteTrashContentInternal(null, null, now))
      .branchIds;
  }

  /**
   * Computes deduplicated branch/session counts and the running task count
   * for a user-confirmed trash permanent deletion. Read-only: it validates
   * the same identities as `permanentlyDeleteTrashContent` but never writes,
   * so cancelling the confirmation stays a zero-write operation.
   */
  async previewTrashPermanentDeletion(input: {
    readonly branchIds: readonly string[];
    readonly sessionIds: readonly string[];
  }): Promise<TrashPermanentDeletionPreview> {
    const requestedBranchIds =
      input.branchIds.length === 0
        ? Object.freeze([] as readonly string[])
        : normalizeBranchIds(input.branchIds);
    const requestedSessionIds =
      input.sessionIds.length === 0
        ? Object.freeze([] as readonly string[])
        : normalizeSessionIds(input.sessionIds);
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        ["branchPlacements", "trashSessionPlacements", "generationRuns"],
        "readonly",
      );
      const [allStoredPlacements, allStoredTrashSessions, allStoredRuns] =
        await Promise.all([
          requestResult(transaction.objectStore("branchPlacements").getAll()),
          requestResult(
            transaction.objectStore("trashSessionPlacements").getAll(),
          ),
          requestResult(transaction.objectStore("generationRuns").getAll()),
        ]);
      const allPlacements = (allStoredPlacements as readonly unknown[]).map(
        readPlacement,
      );
      const allTrashSessions = (
        allStoredTrashSessions as readonly unknown[]
      ).map(readTrashSessionPlacement);
      const placementByBranchId = new Map(
        allPlacements.map(
          (placement) => [placement.branchId, placement] as const,
        ),
      );
      const branchIds = Object.freeze(
        requestedBranchIds.map((branchId) => {
          const placement = placementByBranchId.get(branchId);
          if (placement === undefined) {
            throw new StorageError(
              `The Bilimuzhi branch ${branchId} does not exist`,
            );
          }
          if (placement.location !== "trash") {
            throw new StorageError(
              "Only trash branches can be permanently deleted",
            );
          }
          return branchId;
        }),
      );
      const trashSessionById = new Map(
        allTrashSessions.map(
          (placement) => [placement.sessionId, placement] as const,
        ),
      );
      const sessionIds = Object.freeze(
        requestedSessionIds.map((sessionId) => {
          const placement = trashSessionById.get(sessionId);
          if (placement === undefined) {
            throw new StorageError(
              `The Bilimuzhi trash session ${sessionId} does not exist`,
            );
          }
          return sessionId;
        }),
      );
      for (const sessionId of sessionIds) {
        if (
          allPlacements.some((placement) => placement.sessionId === sessionId)
        ) {
          throw new StorageError(
            "A session-level trash item cannot retain subtitle placements",
          );
        }
      }
      const runningTaskCount = countRunningTasks(
        new Set(branchIds),
        allStoredRuns,
      );
      await transactionDone(transaction);
      return Object.freeze({
        branchCount: branchIds.length,
        runningTaskCount,
        sessionCount: new Set([
          ...branchIds.map(
            (branchId) => placementByBranchId.get(branchId)!.sessionId,
          ),
          ...sessionIds,
        ]).size,
      });
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // A completed readonly transaction has no work left to roll back.
        }
      }
      throw normalizeStorageError(error);
    }
  }
}
