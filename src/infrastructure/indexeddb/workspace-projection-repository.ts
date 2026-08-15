import { StorageError } from "../../application/storage";
import type {
  ArchiveFolderProjection,
  TrashBranchProjection,
  TrashSessionProjection,
  WorkspaceBranchProjection,
  WorkspaceProductProjection,
  WorkspaceProjectionReader,
  WorkspaceSessionProjection,
} from "../../application/workspace-projections";
import {
  createArchiveFolder,
  createArchiveSessionTags,
  createTag,
  readArchivePlacementFromStored,
  createBranchPlacement,
  createGenerationRun,
  createSession,
  createSubtitleBranch,
  createTrashSessionPlacement,
  createWorkspaceSessionPlacement,
  type ArchiveFolder,
  type ArchiveSessionPlacement,
  type ArchiveSessionTags,
  type BranchPlacement,
  type GenerationRun,
  type Session,
  type SubtitleBranch,
  type Tag,
  type TrashSessionPlacement,
  type WorkspaceSessionPlacement,
  isInFlightGenerationStatus,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";
import { ROOT_ARCHIVE_FOLDER_ID } from "./muzhi-database";

function normalizeStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError("Unable to read the Bilimuzhi workspace projections");
}

function parse<T>(value: unknown, factory: (input: T) => T): T | null {
  try {
    return factory(value as T);
  } catch {
    return null;
  }
}

function byText(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareBranches(left: SubtitleBranch, right: SubtitleBranch): number {
  return (
    right.lastOpenedAt - left.lastOpenedAt ||
    right.createdAt - left.createdAt ||
    byText(left.branchId, right.branchId)
  );
}

/**
 * 归档时间的回退解析：
 * 1. archivedAt（新数据）；
 * 2. order（旧数据归档时用时间戳做序号）；
 * 3. 分支/会话时间（更早版本 order 为 0 时近似）。
 */
function resolveArchivedAt(
  placement: ArchiveSessionPlacement,
  session: Session,
  branches: readonly SubtitleBranch[],
): number {
  if (placement.archivedAt > 0) return placement.archivedAt;
  if (placement.order > 0) return placement.order;
  const branchTime = branches.reduce(
    (max, branch) => Math.max(max, branch.createdAt),
    0,
  );
  if (branchTime > 0) return branchTime;
  if (session.updatedAt > 0) return session.updatedAt;
  return session.createdAt;
}

function workspaceBranch(
  branch: SubtitleBranch,
  runs: readonly GenerationRun[],
): WorkspaceBranchProjection {
  const running = runs.some(
    (run) =>
      isInFlightGenerationStatus(run.status) &&
      run.sessionId === branch.sessionId &&
      run.branchId === branch.branchId &&
      run.subtitleId === branch.activeSubtitleId &&
      run.contextRevision === branch.contextRevision,
  );
  return Object.freeze({
    branchId: branch.branchId,
    createdAt: branch.createdAt,
    detectedLanguage: branch.detectedLanguage,
    language: branch.language,
    requestedLanguageMode: branch.requestedLanguageMode,
    running,
    source: branch.source,
    title: branch.title,
    trackOrigin: branch.trackOrigin ?? null,
    unread: branch.completionSequence > branch.lastReadCompletionSequence,
  });
}

function trashBranch(
  branch: SubtitleBranch,
  placement: BranchPlacement,
): TrashBranchProjection {
  if (
    placement.location !== "trash" ||
    placement.trashOrigin === null ||
    placement.trashedAt === null
  ) {
    throw new StorageError("The Bilimuzhi trash branch metadata is invalid");
  }
  return Object.freeze({
    branchId: branch.branchId,
    createdAt: branch.createdAt,
    detectedLanguage: branch.detectedLanguage,
    language: branch.language,
    purgeAfter: placement.purgeAfter,
    requestedLanguageMode: branch.requestedLanguageMode,
    source: branch.source,
    title: branch.title,
    trackOrigin: branch.trackOrigin ?? null,
    trashedAt: placement.trashedAt,
    trashOrigin: placement.trashOrigin,
    trashOriginFolderId: placement.trashOriginFolderId,
    trashOriginPathSnapshot: placement.trashOriginPathSnapshot,
  });
}

function validFolders(
  folders: readonly ArchiveFolder[],
): readonly ArchiveFolder[] {
  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const root = byId.get(ROOT_ARCHIVE_FOLDER_ID);
  if (root === undefined || root.parentFolderId !== null)
    return Object.freeze([]);
  const valid = new Set([ROOT_ARCHIVE_FOLDER_ID]);
  const visiting = new Set<string>();
  const attached = (folderId: string): boolean => {
    if (valid.has(folderId)) return true;
    if (visiting.has(folderId)) return false;
    const folder = byId.get(folderId);
    if (folder?.parentFolderId == null) return false;
    visiting.add(folderId);
    const result = attached(folder.parentFolderId);
    visiting.delete(folderId);
    if (result) valid.add(folderId);
    return result;
  };
  for (const folder of folders) attached(folder.folderId);
  return Object.freeze(folders.filter((folder) => valid.has(folder.folderId)));
}

function folderProjections(
  folders: readonly ArchiveFolder[],
  archiveSessions: readonly WorkspaceSessionProjection[],
): readonly ArchiveFolderProjection[] {
  const children = new Map<string, ArchiveFolder[]>();
  for (const folder of folders) {
    if (folder.parentFolderId === null) continue;
    const siblings = children.get(folder.parentFolderId) ?? [];
    siblings.push(folder);
    children.set(folder.parentFolderId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort(
      (left, right) =>
        left.order - right.order || byText(left.folderId, right.folderId),
    );
  }
  const byId = new Map(folders.map((folder) => [folder.folderId, folder]));
  const result: ArchiveFolderProjection[] = [];
  const visit = (folderId: string): void => {
    const folder = byId.get(folderId);
    if (folder === undefined) return;
    const childFolders = children.get(folderId) ?? [];
    result.push(
      Object.freeze({
        childFolderIds: Object.freeze(
          childFolders.map((child) => child.folderId),
        ),
        folderId,
        isRoot: folderId === ROOT_ARCHIVE_FOLDER_ID,
        order: folder.order,
        parentFolderId: folder.parentFolderId,
        sessionIds: Object.freeze(
          archiveSessions
            .filter((session) => session.folderId === folderId)
            .map((session) => session.sessionId),
        ),
        title: folder.title,
      }),
    );
    for (const child of childFolders) visit(child.folderId);
  };
  visit(ROOT_ARCHIVE_FOLDER_ID);
  return Object.freeze(result);
}

export class IndexedDbWorkspaceProjectionRepository implements WorkspaceProjectionReader {
  constructor(private readonly database: IDBDatabase) {}

  async load(): Promise<WorkspaceProductProjection> {
    try {
      const transaction = this.database.transaction(
        [
          "archiveFolders",
          "archiveSessionPlacements",
          "archiveSessionTags",
          "branchPlacements",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "tags",
          "trashSessionPlacements",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      const [
        rawFolders,
        rawArchivePlacements,
        rawBranchPlacements,
        rawRuns,
        rawSessions,
        rawBranches,
        rawTrashSessionPlacements,
        rawWorkspacePlacements,
        rawTags,
        rawArchiveSessionTags,
      ] = await Promise.all([
        requestResult(transaction.objectStore("archiveFolders").getAll()),
        requestResult(
          transaction.objectStore("archiveSessionPlacements").getAll(),
        ),
        requestResult(transaction.objectStore("branchPlacements").getAll()),
        requestResult(transaction.objectStore("generationRuns").getAll()),
        requestResult(transaction.objectStore("sessions").getAll()),
        requestResult(transaction.objectStore("subtitleBranches").getAll()),
        requestResult(
          transaction.objectStore("trashSessionPlacements").getAll(),
        ),
        requestResult(
          transaction.objectStore("workspaceSessionPlacements").getAll(),
        ),
        requestResult(transaction.objectStore("tags").getAll()),
        requestResult(transaction.objectStore("archiveSessionTags").getAll()),
      ]);
      await transactionDone(transaction);

      const sessions = (rawSessions as readonly unknown[])
        .map((value) => parse(value, createSession))
        .filter((value): value is Session => value !== null);
      const sessionsById = new Map(
        sessions.map((session) => [session.sessionId, session]),
      );
      const branches = (rawBranches as readonly unknown[])
        .map((value) => parse(value, createSubtitleBranch))
        .filter((value): value is SubtitleBranch => value !== null)
        .filter(
          (branch) =>
            sessionsById.get(branch.sessionId)?.videoKey === branch.videoKey,
        );
      const branchesById = new Map(
        branches.map((branch) => [branch.branchId, branch]),
      );
      const placements = (rawBranchPlacements as readonly unknown[])
        .map((value) => parse(value, createBranchPlacement))
        .filter((value): value is BranchPlacement => value !== null)
        .filter(
          (placement) =>
            branchesById.get(placement.branchId)?.sessionId ===
            placement.sessionId,
        );
      const runs = (rawRuns as readonly unknown[])
        .map((value) => parse(value, createGenerationRun))
        .filter((value): value is GenerationRun => value !== null);
      const workspacePlacements = (rawWorkspacePlacements as readonly unknown[])
        .map((value) => parse(value, createWorkspaceSessionPlacement))
        .filter((value): value is WorkspaceSessionPlacement => value !== null);
      const archivePlacements = (rawArchivePlacements as readonly unknown[])
        .map((value) => {
          try {
            return readArchivePlacementFromStored(value);
          } catch {
            return null;
          }
        })
        .filter((value): value is ArchiveSessionPlacement => value !== null);
      const trashSessionPlacements = (
        rawTrashSessionPlacements as readonly unknown[]
      )
        .map((value) => parse(value, createTrashSessionPlacement))
        .filter((value): value is TrashSessionPlacement => value !== null)
        .filter(
          (placement) =>
            !placements.some(
              (branchPlacement) =>
                branchPlacement.sessionId === placement.sessionId,
            ),
        );
      const folders = validFolders(
        (rawFolders as readonly unknown[])
          .map((value) => parse(value, createArchiveFolder))
          .filter((value): value is ArchiveFolder => value !== null),
      );
      const folderIds = new Set(folders.map((folder) => folder.folderId));
      const liveSessionIds = new Set<string>([
        ...workspacePlacements.map((placement) => placement.sessionId),
        ...archivePlacements.map((placement) => placement.sessionId),
        ...placements
          .filter((placement) => placement.location === "trash")
          .map((placement) => placement.sessionId),
        ...trashSessionPlacements.map((placement) => placement.sessionId),
      ]);
      const sessionsByVideo = new Map<string, Session[]>();
      for (const session of sessions) {
        if (!liveSessionIds.has(session.sessionId)) continue;
        const group = sessionsByVideo.get(session.videoKey) ?? [];
        group.push(session);
        sessionsByVideo.set(session.videoKey, group);
      }
      const ordinalBySessionId = new Map<string, number>();
      for (const group of sessionsByVideo.values()) {
        if (group.length < 2) continue;
        group
          .sort(
            (left, right) =>
              left.createdAt - right.createdAt ||
              byText(left.sessionId, right.sessionId),
          )
          .forEach((session, index) =>
            ordinalBySessionId.set(session.sessionId, index + 1),
          );
      }
      const displayTitle = (session: Session): string => {
        const baseTitle = session.customTitle
          ? session.title
          : session.title.replace(/^\[\d+\]\s+/, "");
        const ordinal = ordinalBySessionId.get(session.sessionId);
        return ordinal === undefined ? baseTitle : `[${ordinal}] ${baseTitle}`;
      };

      const branchesFor = (
        location: "workspace" | "archive",
        sessionId: string,
      ): SubtitleBranch[] =>
        placements
          .filter(
            (placement) =>
              placement.location === location &&
              placement.sessionId === sessionId,
          )
          .map((placement) => branchesById.get(placement.branchId))
          .filter((branch): branch is SubtitleBranch => branch !== undefined)
          .sort(compareBranches);

      const workspaceSessions = workspacePlacements
        .map((placement): WorkspaceSessionProjection | null => {
          const session = sessionsById.get(placement.sessionId);
          const children = branchesFor("workspace", placement.sessionId);
          if (session === undefined) return null;
          return Object.freeze({
            archivedAt: null,
            branches: Object.freeze(
              children.map((branch) => workspaceBranch(branch, runs)),
            ),
            folderId: null,
            location: "workspace",
            order: placement.order,
            pinned: placement.pinned,
            sessionId: session.sessionId,
            title: displayTitle(session),
            videoKey: session.videoKey,
          });
        })
        .filter((value): value is WorkspaceSessionProjection => value !== null)
        .sort(
          (left, right) =>
            Number(right.pinned) - Number(left.pinned) ||
            left.order - right.order ||
            byText(left.sessionId, right.sessionId),
        );

      const archiveSessions = archivePlacements
        .filter((placement) => folderIds.has(placement.folderId))
        .map((placement): WorkspaceSessionProjection | null => {
          const session = sessionsById.get(placement.sessionId);
          const children = branchesFor("archive", placement.sessionId);
          if (session === undefined) return null;
          return Object.freeze({
            archivedAt: resolveArchivedAt(placement, session, children),
            branches: Object.freeze(
              children.map((branch) => workspaceBranch(branch, runs)),
            ),
            folderId: placement.folderId,
            location: "archive",
            order: placement.order,
            pinned: placement.pinned,
            sessionId: session.sessionId,
            title: displayTitle(session),
            videoKey: session.videoKey,
          });
        })
        .filter((value): value is WorkspaceSessionProjection => value !== null)
        .sort(
          (left, right) =>
            byText(left.folderId ?? "", right.folderId ?? "") ||
            Number(right.pinned) - Number(left.pinned) ||
            left.order - right.order ||
            byText(left.sessionId, right.sessionId),
        );

      const trashGroups = new Map<string, TrashBranchProjection[]>();
      for (const placement of placements) {
        if (placement.location !== "trash") continue;
        const branch = branchesById.get(placement.branchId);
        if (branch === undefined) continue;
        try {
          const group = trashGroups.get(placement.sessionId) ?? [];
          group.push(trashBranch(branch, placement));
          trashGroups.set(placement.sessionId, group);
        } catch {
          // A corrupt metadata row is omitted rather than exposing content.
        }
      }
      const branchTrashSessions = [...trashGroups.entries()]
        .map(([sessionId, children]): TrashSessionProjection | null => {
          const session = sessionsById.get(sessionId);
          if (session === undefined || children.length === 0) return null;
          children.sort(
            (left, right) =>
              right.trashedAt - left.trashedAt ||
              right.createdAt - left.createdAt ||
              byText(left.branchId, right.branchId),
          );
          return Object.freeze({
            branches: Object.freeze(children),
            location: "trash",
            sessionId,
            title: displayTitle(session),
            videoKey: session.videoKey,
          });
        })
        .filter((value): value is TrashSessionProjection => value !== null);
      const emptyTrashSessions = trashSessionPlacements
        .map((placement): TrashSessionProjection | null => {
          const session = sessionsById.get(placement.sessionId);
          if (session === undefined) return null;
          return Object.freeze({
            branches: Object.freeze([]),
            emptySession: Object.freeze({
              purgeAfter: placement.purgeAfter,
              trashedAt: placement.trashedAt,
              trashOrigin: placement.trashOrigin,
            }),
            location: "trash",
            sessionId: session.sessionId,
            title: displayTitle(session),
            videoKey: session.videoKey,
          });
        })
        .filter((value): value is TrashSessionProjection => value !== null);
      const trashSessions = [
        ...branchTrashSessions,
        ...emptyTrashSessions,
      ].sort(
        (left, right) =>
          (right.branches[0]?.trashedAt ?? right.emptySession?.trashedAt ?? 0) -
            (left.branches[0]?.trashedAt ??
              left.emptySession?.trashedAt ??
              0) || byText(left.sessionId, right.sessionId),
      );

      const tags = (rawTags as readonly unknown[])
        .map((value) => parse(value, createTag))
        .filter((value): value is Tag => value !== null)
        .sort((left, right) => left.order - right.order);
      const sessionTags = (rawArchiveSessionTags as readonly unknown[])
        .map((value) => parse(value, createArchiveSessionTags))
        .filter((value): value is ArchiveSessionTags => value !== null);
      const tagCounts = new Map<string, number>();
      for (const record of sessionTags) {
        for (const tagId of new Set(record.tagIds)) {
          tagCounts.set(tagId, (tagCounts.get(tagId) ?? 0) + 1);
        }
      }

      return Object.freeze({
        archive: Object.freeze({
          folders: folderProjections(folders, archiveSessions),
          sessions: Object.freeze(archiveSessions),
          sessionTags: Object.freeze(sessionTags),
          tagCounts,
          tags: Object.freeze(tags),
        }),
        trash: Object.freeze({ sessions: Object.freeze(trashSessions) }),
        workspace: Object.freeze({
          sessions: Object.freeze(workspaceSessions),
        }),
      });
    } catch (error) {
      throw normalizeStorageError(error);
    }
  }
}
