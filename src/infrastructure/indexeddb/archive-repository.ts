import { StorageError } from "../../application/storage";
import {
  createArchiveFolder,
  createArchiveSessionPlacement,
  readArchivePlacementFromStored,
  createBranchPlacement,
  createWorkspaceSessionPlacement,
  type ArchiveFolder,
  type ArchiveSessionPlacement,
  type BranchPlacement,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";
import { stopActiveGenerationRun } from "./generation-run-stopping";
import { ROOT_ARCHIVE_FOLDER_ID } from "./muzhi-database";

export interface IndexedDbArchiveRepositoryDependencies {
  readonly now: () => number;
}

function normalizeStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError("Unable to update the Bilimuzhi archive database");
}

function normalizeBranchIds(branchIds: readonly string[]): readonly string[] {
  if (!Array.isArray(branchIds)) {
    throw new StorageError("Archive requires a branch list");
  }
  const normalized = branchIds.map((branchId) => {
    if (
      typeof branchId !== "string" ||
      branchId.trim().length === 0 ||
      branchId !== branchId.trim()
    ) {
      throw new StorageError("Archive branch identity is invalid");
    }
    return branchId;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new StorageError("Archive branch identities must be unique");
  }
  return Object.freeze(normalized);
}

function readPlacement(value: unknown): BranchPlacement {
  return createBranchPlacement(value as BranchPlacement);
}

function readFolder(value: unknown): ArchiveFolder {
  return createArchiveFolder(value as ArchiveFolder);
}

function readArchivePlacement(value: unknown): ArchiveSessionPlacement {
  return readArchivePlacementFromStored(value);
}

function normalizeFolderIdentity(folderId: string): string {
  if (
    typeof folderId !== "string" ||
    folderId.trim().length === 0 ||
    folderId !== folderId.trim()
  ) {
    throw new StorageError("Archive folder identity is invalid");
  }
  return folderId;
}

function compareArchivePlacementOrder(
  left: ArchiveSessionPlacement,
  right: ArchiveSessionPlacement,
): number {
  return (
    left.order - right.order || left.sessionId.localeCompare(right.sessionId)
  );
}

function compareArchivePlacements(
  left: ArchiveSessionPlacement,
  right: ArchiveSessionPlacement,
): number {
  return (
    left.folderId.localeCompare(right.folderId) ||
    Number(right.pinned) - Number(left.pinned) ||
    compareArchivePlacementOrder(left, right)
  );
}

function normalizedArchivePlacementSequence(
  placements: readonly ArchiveSessionPlacement[],
): readonly ArchiveSessionPlacement[] {
  return Object.freeze(
    placements.map((placement, order) =>
      createArchiveSessionPlacement({ ...placement, order }),
    ),
  );
}

function normalizedArchivePlacementGroup(
  placements: readonly ArchiveSessionPlacement[],
): readonly ArchiveSessionPlacement[] {
  return normalizedArchivePlacementSequence(
    [...placements].sort(compareArchivePlacementOrder),
  );
}

function normalizeSessionIdentity(sessionId: string): string {
  if (
    typeof sessionId !== "string" ||
    sessionId.trim().length === 0 ||
    sessionId !== sessionId.trim()
  ) {
    throw new StorageError("Archive session identity is invalid");
  }
  return sessionId;
}

function assertFolderMoveDoesNotCycle(
  folderId: string,
  parentFolderId: string,
  folders: ReadonlyMap<string, ArchiveFolder>,
): void {
  let current: string | null = parentFolderId;
  const visited = new Set<string>();
  while (current !== null) {
    if (current === folderId) {
      throw new StorageError("The Bilimuzhi archive folder tree cannot be cyclic");
    }
    if (visited.has(current)) {
      throw new StorageError("The Bilimuzhi archive folder tree is cyclic");
    }
    visited.add(current);
    const parent = folders.get(current);
    if (parent === undefined) {
      throw new StorageError("The Bilimuzhi archive parent folder does not exist");
    }
    current = parent.parentFolderId;
  }
}

export class IndexedDbArchiveRepository {
  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: IndexedDbArchiveRepositoryDependencies,
  ) {}

  async listFolders(): Promise<readonly ArchiveFolder[]> {
    try {
      const transaction = this.database.transaction(
        "archiveFolders",
        "readonly",
      );
      const stored = await requestResult(
        transaction.objectStore("archiveFolders").getAll(),
      );
      await transactionDone(transaction);
      return Object.freeze(
        (stored as readonly unknown[])
          .map(readFolder)
          .sort(
            (left, right) =>
              (left.parentFolderId ?? "").localeCompare(
                right.parentFolderId ?? "",
              ) ||
              left.order - right.order ||
              left.folderId.localeCompare(right.folderId),
          ),
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async listSessionPlacements(): Promise<readonly ArchiveSessionPlacement[]> {
    try {
      const transaction = this.database.transaction(
        "archiveSessionPlacements",
        "readonly",
      );
      const stored = await requestResult(
        transaction.objectStore("archiveSessionPlacements").getAll(),
      );
      await transactionDone(transaction);
      return Object.freeze(
        (stored as readonly unknown[])
          .map(readArchivePlacement)
          .sort(compareArchivePlacements),
      );
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }

  async createFolder(input: ArchiveFolder): Promise<ArchiveFolder> {
    const folder = createArchiveFolder(input);
    if (folder.folderId === ROOT_ARCHIVE_FOLDER_ID) {
      throw new StorageError("The Bilimuzhi archive root already exists");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction("archiveFolders", "readwrite");
      const folders = transaction.objectStore("archiveFolders");
      const [existing, parent] = await Promise.all([
        requestResult(folders.get(folder.folderId)),
        folder.parentFolderId === null
          ? Promise.resolve(undefined)
          : requestResult(folders.get(folder.parentFolderId)),
      ]);
      if (existing !== undefined) {
        throw new StorageError("The Bilimuzhi archive folder already exists");
      }
      if (folder.parentFolderId === null || parent === undefined) {
        throw new StorageError(
          "The Bilimuzhi archive parent folder does not exist",
        );
      }
      readFolder(parent);
      folders.add(folder);
      await transactionDone(transaction);
      return folder;
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

  async renameFolder(folderId: string, title: string): Promise<ArchiveFolder> {
    const normalizedFolderId = normalizeFolderIdentity(folderId);
    if (normalizedFolderId === ROOT_ARCHIVE_FOLDER_ID) {
      throw new StorageError("The Bilimuzhi archive root cannot be renamed");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction("archiveFolders", "readwrite");
      const folders = transaction.objectStore("archiveFolders");
      const stored = await requestResult(folders.get(normalizedFolderId));
      if (stored === undefined) {
        throw new StorageError("The Bilimuzhi archive folder does not exist");
      }
      const next = createArchiveFolder({ ...readFolder(stored), title });
      folders.put(next);
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

  async moveFolder(
    folderId: string,
    parentFolderId: string,
    order: number,
  ): Promise<ArchiveFolder> {
    const normalizedFolderId = normalizeFolderIdentity(folderId);
    const normalizedParentFolderId = normalizeFolderIdentity(parentFolderId);
    if (normalizedFolderId === ROOT_ARCHIVE_FOLDER_ID) {
      throw new StorageError("The Bilimuzhi archive root cannot be moved");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction("archiveFolders", "readwrite");
      const folders = transaction.objectStore("archiveFolders");
      const storedFolders = await requestResult(folders.getAll());
      const folderById = new Map(
        (storedFolders as readonly unknown[])
          .map(readFolder)
          .map((folder) => [folder.folderId, folder] as const),
      );
      const current = folderById.get(normalizedFolderId);
      if (current === undefined) {
        throw new StorageError("The Bilimuzhi archive folder does not exist");
      }
      assertFolderMoveDoesNotCycle(
        normalizedFolderId,
        normalizedParentFolderId,
        folderById,
      );
      const next = createArchiveFolder({
        ...current,
        order,
        parentFolderId: normalizedParentFolderId,
      });
      folders.put(next);
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

  async updateSessionPlacement(
    sessionId: string,
    folderId: string,
    order: number,
    pinned: boolean,
  ): Promise<ArchiveSessionPlacement> {
    const normalizedSessionId = normalizeSessionIdentity(sessionId);
    const normalizedFolderId = normalizeFolderIdentity(folderId);
    if (!Number.isSafeInteger(order) || order < 0) {
      throw new StorageError("Archive session order is invalid");
    }
    if (typeof pinned !== "boolean") {
      throw new StorageError("Archive session pin state is invalid");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        ["archiveFolders", "archiveSessionPlacements"],
        "readwrite",
      );
      const folders = transaction.objectStore("archiveFolders");
      const placements = transaction.objectStore("archiveSessionPlacements");
      const [storedFolder, storedPlacement, storedPlacements] =
        await Promise.all([
          requestResult(folders.get(normalizedFolderId)),
          requestResult(placements.get(normalizedSessionId)),
          requestResult(placements.getAll()),
        ]);
      if (storedFolder === undefined) {
        throw new StorageError("The Bilimuzhi archive folder does not exist");
      }
      readFolder(storedFolder);
      if (storedPlacement === undefined) {
        throw new StorageError(
          "The Bilimuzhi archive session placement does not exist",
        );
      }
      const current = readArchivePlacement(storedPlacement);
      const all = (storedPlacements as readonly unknown[]).map(
        readArchivePlacement,
      );
      if (
        current.folderId === normalizedFolderId &&
        current.pinned === pinned &&
        current.order === order
      ) {
        await transactionDone(transaction);
        return current;
      }

      const withoutTarget = all
        .filter(
          (placement) =>
            placement.sessionId !== normalizedSessionId &&
            placement.folderId === normalizedFolderId &&
            placement.pinned === pinned,
        )
        .sort(compareArchivePlacementOrder);
      const insertion = Math.min(order, withoutTarget.length);
      withoutTarget.splice(
        insertion,
        0,
        createArchiveSessionPlacement({
          archivedAt: current.archivedAt,
          folderId: normalizedFolderId,
          order: 0,
          pinned,
          sessionId: normalizedSessionId,
        }),
      );
      const orderedTargetGroup =
        normalizedArchivePlacementSequence(withoutTarget);
      const sameFolderOtherPin = normalizedArchivePlacementGroup(
        all.filter(
          (placement) =>
            placement.sessionId !== normalizedSessionId &&
            placement.folderId === normalizedFolderId &&
            placement.pinned !== pinned,
        ),
      );
      const otherFolders = all.filter(
        (placement) =>
          placement.sessionId !== normalizedSessionId &&
          placement.folderId !== normalizedFolderId &&
          placement.folderId !== current.folderId,
      );
      const previousFolderRemainder =
        current.folderId === normalizedFolderId
          ? []
          : normalizedArchivePlacementGroup(
              all.filter(
                (placement) =>
                  placement.sessionId !== normalizedSessionId &&
                  placement.folderId === current.folderId,
              ),
            );

      for (const placement of [
        ...orderedTargetGroup,
        ...sameFolderOtherPin,
        ...previousFolderRemainder,
        ...otherFolders,
      ]) {
        placements.put(placement);
      }
      await transactionDone(transaction);
      return orderedTargetGroup.find(
        (placement) => placement.sessionId === normalizedSessionId,
      )!;
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

  async setSessionPinned(
    sessionId: string,
    pinned: boolean,
  ): Promise<ArchiveSessionPlacement> {
    const normalizedSessionId = normalizeSessionIdentity(sessionId);
    if (typeof pinned !== "boolean") {
      throw new StorageError("Archive session pin state is invalid");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        "archiveSessionPlacements",
        "readwrite",
      );
      const store = transaction.objectStore("archiveSessionPlacements");
      const [storedPlacement, storedPlacements] = await Promise.all([
        requestResult(store.get(normalizedSessionId)),
        requestResult(store.getAll()),
      ]);
      if (storedPlacement === undefined) {
        throw new StorageError(
          "The Bilimuzhi archive session placement does not exist",
        );
      }
      const current = readArchivePlacement(storedPlacement);
      if (current.pinned === pinned) {
        await transactionDone(transaction);
        return current;
      }
      const all = (storedPlacements as readonly unknown[]).map(
        readArchivePlacement,
      );
      const target = createArchiveSessionPlacement({
        ...current,
        order: 0,
        pinned,
      });
      const targetGroup = normalizedArchivePlacementSequence([
        target,
        ...all
          .filter(
            (placement) =>
              placement.sessionId !== normalizedSessionId &&
              placement.folderId === current.folderId &&
              placement.pinned === pinned,
          )
          .sort(compareArchivePlacementOrder),
      ]);
      const otherGroup = normalizedArchivePlacementGroup(
        all.filter(
          (placement) =>
            placement.sessionId !== normalizedSessionId &&
            placement.folderId === current.folderId &&
            placement.pinned !== pinned,
        ),
      );
      const otherFolders = all.filter(
        (placement) =>
          placement.sessionId !== normalizedSessionId &&
          placement.folderId !== current.folderId,
      );
      for (const placement of [
        ...targetGroup,
        ...otherGroup,
        ...otherFolders,
      ]) {
        store.put(placement);
      }
      await transactionDone(transaction);
      return targetGroup.find(
        (placement) => placement.sessionId === normalizedSessionId,
      )!;
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

  async reorderSession(
    sessionId: string,
    beforeSessionId: string | null,
  ): Promise<readonly ArchiveSessionPlacement[]> {
    const normalizedSessionId = normalizeSessionIdentity(sessionId);
    if (
      beforeSessionId !== null &&
      (typeof beforeSessionId !== "string" ||
        beforeSessionId.trim().length === 0 ||
        beforeSessionId !== beforeSessionId.trim())
    ) {
      throw new StorageError("Archive session order target is invalid");
    }
    if (beforeSessionId === normalizedSessionId) {
      throw new StorageError("Archive session order target is invalid");
    }
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        "archiveSessionPlacements",
        "readwrite",
      );
      const store = transaction.objectStore("archiveSessionPlacements");
      const stored = await requestResult(store.getAll());
      const placements = (stored as readonly unknown[]).map(
        readArchivePlacement,
      );
      const target = placements.find(
        (placement) => placement.sessionId === normalizedSessionId,
      );
      if (target === undefined) {
        throw new StorageError(
          "The Bilimuzhi archive session placement does not exist",
        );
      }
      const before =
        beforeSessionId === null
          ? null
          : placements.find(
              (placement) => placement.sessionId === beforeSessionId,
            );
      if (
        beforeSessionId !== null &&
        (before == null ||
          before.folderId !== target.folderId ||
          before.pinned !== target.pinned)
      ) {
        throw new StorageError("Archive session order target is invalid");
      }
      const group = placements
        .filter(
          (placement) =>
            placement.folderId === target.folderId &&
            placement.pinned === target.pinned &&
            placement.sessionId !== normalizedSessionId,
        )
        .sort(compareArchivePlacementOrder);
      const insertionIndex =
        beforeSessionId === null
          ? group.length
          : group.findIndex(
              (placement) => placement.sessionId === beforeSessionId,
            );
      group.splice(insertionIndex, 0, target);
      const normalizedGroup = normalizedArchivePlacementSequence(group);
      for (const placement of normalizedGroup) {
        store.put(placement);
      }
      await transactionDone(transaction);
      return Object.freeze(
        placements
          .filter(
            (placement) =>
              !(
                placement.folderId === target.folderId &&
                placement.pinned === target.pinned
              ),
          )
          .concat(normalizedGroup)
          .sort(compareArchivePlacements),
      );
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

  /**
   * Archives the given branches and, optionally, sessions that own no branch
   * yet. A session the user has not fetched subtitles for is still a session
   * they may want to file away, so archiving must not depend on content.
   */
  async archiveWorkspaceBranches(
    inputBranchIds: readonly string[],
    folderId: string,
    emptySessionIds: readonly string[] = [],
  ): Promise<readonly BranchPlacement[]> {
    const branchIds = normalizeBranchIds(inputBranchIds);
    if (
      typeof folderId !== "string" ||
      folderId.trim().length === 0 ||
      folderId !== folderId.trim()
    ) {
      throw new StorageError("Archive folder identity is invalid");
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
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      const folders = transaction.objectStore("archiveFolders");
      const archivePlacements = transaction.objectStore(
        "archiveSessionPlacements",
      );
      const branchPlacements = transaction.objectStore("branchPlacements");
      const generationRuns = transaction.objectStore("generationRuns");
      const workspacePlacements = transaction.objectStore(
        "workspaceSessionPlacements",
      );
      const [storedFolder, storedPlacements, allStoredPlacements] =
        await Promise.all([
          requestResult(folders.get(folderId)),
          Promise.all(
            branchIds.map((branchId) =>
              requestResult(branchPlacements.get(branchId)),
            ),
          ),
          requestResult(branchPlacements.getAll()),
        ]);
      if (storedFolder === undefined) {
        throw new StorageError("The Bilimuzhi archive folder does not exist");
      }
      readFolder(storedFolder);
      const selected = storedPlacements.map((storedPlacement, index) => {
        if (storedPlacement === undefined) {
          throw new StorageError(
            `The Bilimuzhi branch ${branchIds[index]} does not exist`,
          );
        }
        const placement = readPlacement(storedPlacement);
        if (placement.location !== "workspace") {
          throw new StorageError("Only workspace branches can be archived");
        }
        return placement;
      });
      const allPlacements = (allStoredPlacements as readonly unknown[]).map(
        readPlacement,
      );
      const selectedIds = new Set(branchIds);
      const sessions = [
        ...new Set([
          ...selected.map((placement) => placement.sessionId),
          ...emptySessionIds,
        ]),
      ];
      const existingArchivePlacements = await Promise.all(
        sessions.map((sessionId) =>
          requestResult(archivePlacements.get(sessionId)),
        ),
      );
      const orderBase = this.dependencies.now();
      if (!Number.isSafeInteger(orderBase) || orderBase < 0) {
        throw new StorageError("The Bilimuzhi archive clock is invalid");
      }
      for (const sessionId of sessions) {
        transaction.objectStore("archiveSessionTags").delete(sessionId);
      }
      for (const [index, sessionId] of sessions.entries()) {
        if (existingArchivePlacements[index] !== undefined) continue;
        archivePlacements.add(
          createArchiveSessionPlacement({
            archivedAt: orderBase,
            folderId,
            order: orderBase + index,
            pinned: false,
            sessionId,
          }),
        );
      }
      const updated = selected.map((placement) => {
        const next = createBranchPlacement({
          ...placement,
          location: "archive",
          purgeAfter: null,
          retentionStartedAt: null,
          trashedAt: null,
          trashOrigin: null,
          trashOriginFolderId: null,
          trashOriginPathSnapshot: null,
          deletionReason: null,
        });
        branchPlacements.put(next);
        return next;
      });
      for (const sessionId of sessions) {
        const hasUnselectedWorkspaceBranch = allPlacements.some(
          (placement) =>
            placement.sessionId === sessionId &&
            placement.location === "workspace" &&
            !selectedIds.has(placement.branchId),
        );
        if (!hasUnselectedWorkspaceBranch) {
          workspacePlacements.delete(sessionId);
        }
      }
      const nowForStopping = this.dependencies.now();
      if (!Number.isSafeInteger(nowForStopping) || nowForStopping < 0) {
        throw new StorageError("The Bilimuzhi archive clock is invalid");
      }
      const runsByBranch = await Promise.all(
        branchIds.map((branchId) =>
          requestResult(generationRuns.index("byBranchId").getAll(branchId)),
        ),
      );
      for (const storedRuns of runsByBranch) {
        for (const storedRun of storedRuns as readonly unknown[]) {
          const stopped = stopActiveGenerationRun(storedRun, nowForStopping);
          if (stopped !== null) generationRuns.put(stopped);
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

  /**
   * Moves archived branches back into the workspace. Archiving is a filing
   * action, so it has to be reversible without going through the recycle bin.
   */
  async restoreArchivedBranchesToWorkspace(
    inputBranchIds: readonly string[],
  ): Promise<readonly BranchPlacement[]> {
    const branchIds = normalizeBranchIds(inputBranchIds);
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        [
          "archiveSessionPlacements",
          "archiveSessionTags",
          "branchPlacements",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      const archivePlacements = transaction.objectStore(
        "archiveSessionPlacements",
      );
      const branchPlacements = transaction.objectStore("branchPlacements");
      const workspacePlacements = transaction.objectStore(
        "workspaceSessionPlacements",
      );
      const [storedPlacements, allStoredPlacements] = await Promise.all([
        Promise.all(
          branchIds.map((branchId) =>
            requestResult(branchPlacements.get(branchId)),
          ),
        ),
        requestResult(branchPlacements.getAll()),
      ]);
      const selected = storedPlacements.map((value, index) => {
        if (value === undefined) {
          throw new StorageError(
            `The Bilimuzhi branch ${branchIds[index]} does not exist`,
          );
        }
        const placement = readPlacement(value);
        if (placement.location !== "archive") {
          throw new StorageError("Only archived branches can be restored");
        }
        return placement;
      });
      const allPlacements = (allStoredPlacements as readonly unknown[]).map(
        readPlacement,
      );
      const selectedIds = new Set(branchIds);
      const sessions = [
        ...new Set(selected.map((placement) => placement.sessionId)),
      ];
      const orderBase = this.dependencies.now();
      if (!Number.isSafeInteger(orderBase) || orderBase < 0) {
        throw new StorageError("The Bilimuzhi archive clock is invalid");
      }
      const restored = selected.map((placement) => {
        const next = createBranchPlacement({
          ...placement,
          deletionReason: null,
          location: "workspace",
          purgeAfter: null,
          retentionStartedAt: null,
          trashOrigin: null,
          trashOriginFolderId: null,
          trashOriginPathSnapshot: null,
          trashedAt: null,
        });
        branchPlacements.put(next);
        return next;
      });
      for (const [index, sessionId] of sessions.entries()) {
        const existingWorkspacePlacement = await requestResult(
          workspacePlacements.get(sessionId),
        );
        if (existingWorkspacePlacement === undefined) {
          workspacePlacements.put(
            createWorkspaceSessionPlacement({
              order: orderBase + index,
              pinned: false,
              sessionId,
            }),
          );
        }
        const hasRemainingArchivedBranch = allPlacements.some(
          (placement) =>
            placement.sessionId === sessionId &&
            placement.location === "archive" &&
            !selectedIds.has(placement.branchId),
        );
        if (!hasRemainingArchivedBranch) {
          archivePlacements.delete(sessionId);
          // 恢复回工作区：会话标签关联一并移除（标签只活在归档区）。
          transaction.objectStore("archiveSessionTags").delete(sessionId);
        }
      }
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

  /**
   * Restores a session that was archived before it had any subtitle back
   * into the workspace. The archived session owns no branch, so restoring
   * moves its archive session placement only.
   */
  async restoreEmptyArchivedSessionToWorkspace(
    sessionId: string,
  ): Promise<ReturnType<typeof createWorkspaceSessionPlacement>> {
    const normalizedSessionId = normalizeSessionIdentity(sessionId);
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        [
          "archiveSessionPlacements",
          "archiveSessionTags",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      const archivePlacements = transaction.objectStore(
        "archiveSessionPlacements",
      );
      const workspacePlacements = transaction.objectStore(
        "workspaceSessionPlacements",
      );
      const storedPlacement = await requestResult(
        archivePlacements.get(normalizedSessionId),
      );
      if (storedPlacement === undefined) {
        throw new StorageError("The archived empty session does not exist");
      }
      const placement = readArchivePlacement(storedPlacement);
      const next = createWorkspaceSessionPlacement({
        order: placement.order,
        pinned: placement.pinned,
        sessionId: normalizedSessionId,
      });
      workspacePlacements.put(next);
      archivePlacements.delete(normalizedSessionId);
      transaction.objectStore("archiveSessionTags").delete(normalizedSessionId);
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
}
