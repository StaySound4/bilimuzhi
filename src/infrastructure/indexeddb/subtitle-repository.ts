import {
  SubtitleRepositoryError,
  type AcquisitionRunCompletion,
  type BranchSubtitleRepository,
  type InitialSubtitleCommitResult,
  type SubtitleAcquisitionContext,
} from "../../application/subtitle-repository";
import type {
  SubtitleAcquisitionOwner,
  SubtitleAcquisitionParameters,
} from "../../application/subtitle-acquisition-contract";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoRef,
  DomainValidationError,
  type Session,
  type SubtitleSnapshot,
  type VideoKey,
  type VideoRef,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

export interface IndexedDbSubtitleRepositoryDependencies {
  readonly now: () => number;
}

function normalizeRepositoryError(error: unknown): SubtitleRepositoryError {
  if (error instanceof SubtitleRepositoryError) {
    return error;
  }
  if (error instanceof DomainValidationError) {
    return new SubtitleRepositoryError(
      "VALIDATION_FAILED",
      "The subtitle acquisition data is invalid",
    );
  }
  return new SubtitleRepositoryError(
    "STORAGE_TRANSACTION_FAILED",
    "Unable to update the Bilimuzhi subtitle database",
  );
}

function abortWith(
  transaction: IDBTransaction,
  error: SubtitleRepositoryError,
): never {
  try {
    transaction.abort();
  } catch {
    // A completed transaction has no writes left to roll back.
  }
  throw error;
}

type AcquisitionRunStatus = "running" | "completed" | AcquisitionRunCompletion;

interface StoredAcquisitionRun {
  readonly acquisitionId: string;
  readonly aid?: number;
  readonly branchId: string;
  readonly bvid?: string;
  readonly cid?: number;
  readonly contextRevision: number;
  readonly expectedSelectionRevision: number;
  readonly kind: "subtitle-acquisition";
  readonly parameters: SubtitleAcquisitionParameters;
  readonly operationRevision?: number;
  readonly page?: number;
  readonly requestId?: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly status: AcquisitionRunStatus;
  readonly subtitleId: string | null;
  readonly taskId: string;
  readonly trackId?: string;
  readonly videoKey: VideoKey;
}

type StoredRecord = Readonly<Record<string, unknown>>;

function storedRecord(value: unknown): StoredRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as StoredRecord)
    : null;
}

function storedString(value: StoredRecord, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === "string" ? candidate : null;
}

function deleteStoredRecords(
  store: IDBObjectStore,
  records: readonly unknown[],
  keyField: string,
  predicate: (record: StoredRecord) => boolean,
): void {
  for (const value of records) {
    const record = storedRecord(value);
    if (record === null || !predicate(record)) continue;
    const key = record[keyField];
    if (
      typeof key === "string" ||
      typeof key === "number" ||
      key instanceof Date ||
      Array.isArray(key)
    ) {
      store.delete(key as IDBValidKey);
    }
  }
}

function isSafeOpaqueIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function assertValidOwner(
  owner: SubtitleAcquisitionOwner,
): SubtitleAcquisitionOwner {
  if (
    !isSafeOpaqueIdentifier(owner.acquisitionId) ||
    !isSafeOpaqueIdentifier(owner.taskId) ||
    !isSafeOpaqueIdentifier(owner.sessionId) ||
    !isSafeOpaqueIdentifier(owner.draftBranchId) ||
    !isNonNegativeSafeInteger(owner.expectedSelectionRevision) ||
    !Number.isSafeInteger(owner.expectedContextRevision) ||
    owner.expectedContextRevision < 1 ||
    (owner.requestId !== undefined &&
      !isSafeOpaqueIdentifier(owner.requestId)) ||
    (owner.operationRevision !== undefined &&
      !isNonNegativeSafeInteger(owner.operationRevision)) ||
    (owner.subtitleContextRevision !== undefined &&
      owner.subtitleContextRevision !== owner.expectedContextRevision) ||
    (owner.trackId !== undefined && !isSafeOpaqueIdentifier(owner.trackId)) ||
    (owner.bvid !== undefined && !isSafeOpaqueIdentifier(owner.bvid)) ||
    (owner.aid !== undefined && !isNonNegativeSafeInteger(owner.aid)) ||
    (owner.cid !== undefined && !isNonNegativeSafeInteger(owner.cid)) ||
    (owner.page !== undefined &&
      (!Number.isSafeInteger(owner.page) || owner.page < 1))
  ) {
    throw new SubtitleRepositoryError(
      "VALIDATION_FAILED",
      "The subtitle acquisition owner is invalid",
    );
  }
  return Object.freeze({ ...owner });
}

function assertValidParameters(
  parameters: SubtitleAcquisitionParameters,
): SubtitleAcquisitionParameters {
  if (parameters.method === "direct") {
    if (!isSafeOpaqueIdentifier(parameters.trackId)) {
      throw new SubtitleRepositoryError(
        "VALIDATION_FAILED",
        "The direct subtitle track is invalid",
      );
    }
    return Object.freeze({ method: "direct", trackId: parameters.trackId });
  }
  if (
    parameters.method !== "speech" ||
    !["zh", "en", "other", "mixed"].includes(
      parameters.requestedLanguageMode,
    ) ||
    !isSafeOpaqueIdentifier(parameters.provider) ||
    !isSafeOpaqueIdentifier(parameters.model) ||
    !isSafeOpaqueIdentifier(parameters.mediaIdentity)
  ) {
    throw new SubtitleRepositoryError(
      "VALIDATION_FAILED",
      "The subtitle acquisition parameters are invalid",
    );
  }
  return Object.freeze({ ...parameters });
}

function isValidParameters(
  value: unknown,
): value is SubtitleAcquisitionParameters {
  try {
    assertValidParameters(value as SubtitleAcquisitionParameters);
    return true;
  } catch {
    return false;
  }
}

function matchesOwner(
  run: StoredAcquisitionRun,
  owner: SubtitleAcquisitionOwner,
): boolean {
  return (
    run.acquisitionId === owner.acquisitionId &&
    run.runId === owner.acquisitionId &&
    run.taskId === owner.taskId &&
    run.sessionId === owner.sessionId &&
    run.branchId === owner.draftBranchId &&
    run.videoKey === owner.videoKey &&
    run.expectedSelectionRevision === owner.expectedSelectionRevision &&
    run.contextRevision === owner.expectedContextRevision &&
    run.requestId === owner.requestId &&
    run.operationRevision === owner.operationRevision &&
    run.trackId === owner.trackId &&
    run.bvid === owner.bvid &&
    run.aid === owner.aid &&
    run.cid === owner.cid &&
    run.page === owner.page
  );
}

function isStoredAcquisitionRun(value: unknown): value is StoredAcquisitionRun {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const run = value as Record<string, unknown>;
  return (
    run.kind === "subtitle-acquisition" &&
    isSafeOpaqueIdentifier(run.acquisitionId) &&
    isSafeOpaqueIdentifier(run.runId) &&
    isSafeOpaqueIdentifier(run.taskId) &&
    isSafeOpaqueIdentifier(run.sessionId) &&
    isSafeOpaqueIdentifier(run.branchId) &&
    isNonNegativeSafeInteger(run.expectedSelectionRevision) &&
    Number.isSafeInteger(run.contextRevision) &&
    Number(run.contextRevision) > 0 &&
    (run.requestId === undefined || isSafeOpaqueIdentifier(run.requestId)) &&
    (run.operationRevision === undefined ||
      isNonNegativeSafeInteger(run.operationRevision)) &&
    (run.trackId === undefined || isSafeOpaqueIdentifier(run.trackId)) &&
    (run.bvid === undefined || isSafeOpaqueIdentifier(run.bvid)) &&
    (run.aid === undefined || isNonNegativeSafeInteger(run.aid)) &&
    (run.cid === undefined || isNonNegativeSafeInteger(run.cid)) &&
    (run.page === undefined ||
      (Number.isSafeInteger(run.page) && Number(run.page) > 0)) &&
    isValidParameters(run.parameters) &&
    (run.status === "running" ||
      run.status === "completed" ||
      run.status === "cancelled" ||
      run.status === "failed") &&
    (run.subtitleId === null || isSafeOpaqueIdentifier(run.subtitleId))
  );
}

function assertContextMatchesOwner(
  session: Session,
  video: VideoRef,
  owner: SubtitleAcquisitionOwner,
): void {
  if (
    session.sessionId !== owner.sessionId ||
    session.videoKey !== owner.videoKey ||
    video.videoKey !== owner.videoKey ||
    (owner.bvid !== undefined && video.bvid !== owner.bvid) ||
    (owner.aid !== undefined && video.aid !== owner.aid) ||
    (owner.cid !== undefined && video.cid !== owner.cid) ||
    (owner.page !== undefined && video.page !== owner.page)
  ) {
    throw new SubtitleRepositoryError(
      "VIDEO_NOT_BOUND",
      "The subtitle acquisition owner is no longer bound",
    );
  }
}

export class IndexedDbSubtitleRepository implements BranchSubtitleRepository {
  constructor(
    private readonly database: IDBDatabase,
    private readonly dependencies: IndexedDbSubtitleRepositoryDependencies,
  ) {}

  async readAcquisitionContext(
    videoKey: VideoKey,
  ): Promise<SubtitleAcquisitionContext | null> {
    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        [
          "sessions",
          "subtitleBranches",
          "videos",
          "workspaceSessionPlacements",
        ],
        "readonly",
      );
      const sessions = transaction.objectStore("sessions");
      const videos = transaction.objectStore("videos");
      const branches = transaction.objectStore("subtitleBranches");
      const workspacePlacements = transaction.objectStore(
        "workspaceSessionPlacements",
      );
      const [matchingSessions, storedVideo, storedPlacements] =
        await Promise.all([
          requestResult(sessions.index("byVideoKey").getAll(videoKey)),
          requestResult(videos.get(videoKey)),
          requestResult(workspacePlacements.getAll()),
        ]);
      if (
        (matchingSessions as readonly unknown[]).length === 0 &&
        storedVideo === undefined
      ) {
        await transactionDone(transaction);
        return null;
      }
      if (
        (matchingSessions as readonly unknown[]).length === 0 ||
        storedVideo === undefined
      ) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "STORAGE_TRANSACTION_FAILED",
            "The bound Bilimuzhi video context is inconsistent",
          ),
        );
      }
      const sessionsById = new Map(
        (matchingSessions as Session[])
          .map((value) => createSession(value))
          .map((session) => [session.sessionId, session] as const),
      );
      const workspaceSession = (storedPlacements as readonly unknown[])
        .map((value) => value as { readonly sessionId?: unknown })
        .map((value) =>
          typeof value.sessionId === "string"
            ? sessionsById.get(value.sessionId)
            : undefined,
        )
        .find((session): session is Session => session !== undefined);
      // Acquisition only targets workspace sessions. Archive/trash history for
      // the same exact VideoKey must not intercept a new workspace acquisition.
      if (workspaceSession === undefined) {
        await transactionDone(transaction);
        return null;
      }
      const session = workspaceSession;
      const video = createVideoRef(storedVideo as VideoRef);
      if (session.videoKey !== videoKey || video.videoKey !== videoKey) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "STORAGE_TRANSACTION_FAILED",
            "The bound Bilimuzhi video context is inconsistent",
          ),
        );
      }
      const storedBranches = await requestResult(
        branches.index("bySessionId").getAll(session.sessionId),
      );
      await transactionDone(transaction);
      const owned = (storedBranches as readonly unknown[]).map((value) =>
        createSubtitleBranch(value as never),
      );
      if (
        owned.some(
          (branch) =>
            branch.sessionId !== session.sessionId ||
            branch.videoKey !== session.videoKey,
        )
      ) {
        throw new SubtitleRepositoryError(
          "STORAGE_TRANSACTION_FAILED",
          "The bound Bilimuzhi subtitle context is inconsistent",
        );
      }
      const highestContextRevision = owned.reduce(
        (highest, branch) => Math.max(highest, branch.contextRevision),
        0,
      );
      return Object.freeze({
        expectedContextRevision: highestContextRevision + 1,
        session,
        video,
      });
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
      }
      throw normalizeRepositoryError(error);
    }
  }

  async beginAcquisition(
    inputOwner: SubtitleAcquisitionOwner,
    inputParameters: SubtitleAcquisitionParameters,
  ): Promise<SubtitleAcquisitionContext> {
    let owner: SubtitleAcquisitionOwner;
    let parameters: SubtitleAcquisitionParameters;
    try {
      owner = assertValidOwner(inputOwner);
      parameters = assertValidParameters(inputParameters);
      const hasExactDirectOwner =
        owner.operationRevision !== undefined ||
        owner.requestId !== undefined ||
        owner.trackId !== undefined ||
        owner.bvid !== undefined ||
        owner.aid !== undefined ||
        owner.cid !== undefined ||
        owner.page !== undefined ||
        owner.subtitleContextRevision !== undefined;
      if (
        parameters.method === "direct" &&
        hasExactDirectOwner &&
        (owner.operationRevision === undefined ||
          owner.requestId === undefined ||
          owner.subtitleContextRevision !== owner.expectedContextRevision ||
          owner.trackId !== parameters.trackId ||
          owner.bvid === undefined ||
          owner.aid === undefined ||
          owner.cid === undefined ||
          owner.page === undefined)
      ) {
        throw new SubtitleRepositoryError(
          "VALIDATION_FAILED",
          "The direct subtitle acquisition owner is incomplete",
        );
      }
    } catch (error) {
      throw normalizeRepositoryError(error);
    }

    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        ["generationRuns", "sessions", "videos"],
        "readwrite",
      );
      const sessions = transaction.objectStore("sessions");
      const videos = transaction.objectStore("videos");
      const runs = transaction.objectStore("generationRuns");
      const [storedSession, storedVideo, existingByTask] = await Promise.all([
        requestResult(sessions.get(owner.sessionId)),
        requestResult(videos.get(owner.videoKey)),
        requestResult(runs.index("byTaskId").get(owner.taskId)),
      ]);
      if (storedSession === undefined || storedVideo === undefined) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VIDEO_NOT_BOUND",
            "The subtitle acquisition video is not bound",
          ),
        );
      }
      const session = createSession(storedSession as Session);
      const video = createVideoRef(storedVideo as VideoRef);
      assertContextMatchesOwner(session, video, owner);
      if (session.selectionRevision !== owner.expectedSelectionRevision) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The subtitle acquisition selection is stale",
          ),
        );
      }
      if (existingByTask !== undefined) {
        if (
          !isStoredAcquisitionRun(existingByTask) ||
          !matchesOwner(existingByTask, owner) ||
          JSON.stringify(existingByTask.parameters) !==
            JSON.stringify(parameters)
        ) {
          abortWith(
            transaction,
            new SubtitleRepositoryError(
              "VALIDATION_FAILED",
              "The subtitle acquisition task identity conflicts",
            ),
          );
        }
      } else {
        runs.add({
          acquisitionId: owner.acquisitionId,
          aid: owner.aid,
          branchId: owner.draftBranchId,
          bvid: owner.bvid,
          cid: owner.cid,
          contextRevision: owner.expectedContextRevision,
          expectedSelectionRevision: owner.expectedSelectionRevision,
          kind: "subtitle-acquisition",
          operationRevision: owner.operationRevision,
          page: owner.page,
          parameters,
          requestId: owner.requestId,
          runId: owner.acquisitionId,
          sessionId: owner.sessionId,
          status: "running",
          subtitleId: null,
          taskId: owner.taskId,
          trackId: owner.trackId,
          videoKey: owner.videoKey,
        } satisfies StoredAcquisitionRun);
      }
      await transactionDone(transaction);
      return Object.freeze({
        expectedContextRevision: owner.expectedContextRevision,
        session,
        video,
      });
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
      }
      throw normalizeRepositoryError(error);
    }
  }

  async finishAcquisition(
    inputOwner: SubtitleAcquisitionOwner,
    completion: AcquisitionRunCompletion,
  ): Promise<void> {
    let owner: SubtitleAcquisitionOwner;
    try {
      owner = assertValidOwner(inputOwner);
      if (completion !== "cancelled" && completion !== "failed") {
        throw new SubtitleRepositoryError(
          "VALIDATION_FAILED",
          "The subtitle acquisition completion is invalid",
        );
      }
    } catch (error) {
      throw normalizeRepositoryError(error);
    }

    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(["generationRuns"], "readwrite");
      const runs = transaction.objectStore("generationRuns");
      const storedRun = await requestResult(runs.get(owner.acquisitionId));
      if (storedRun !== undefined) {
        if (
          !isStoredAcquisitionRun(storedRun) ||
          !matchesOwner(storedRun, owner)
        ) {
          abortWith(
            transaction,
            new SubtitleRepositoryError(
              "VALIDATION_FAILED",
              "The subtitle acquisition owner is invalid",
            ),
          );
        }
        if (storedRun.status === "running") {
          runs.put({ ...storedRun, status: completion });
        }
      }
      await transactionDone(transaction);
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
      }
      throw normalizeRepositoryError(error);
    }
  }

  async commitAcquisition(
    inputOwner: SubtitleAcquisitionOwner,
    stagedSubtitle: SubtitleSnapshot,
  ): Promise<InitialSubtitleCommitResult> {
    let owner: SubtitleAcquisitionOwner;
    let staged: SubtitleSnapshot;
    try {
      owner = assertValidOwner(inputOwner);
      staged = createSubtitleSnapshot(stagedSubtitle);
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
    if (
      staged.status !== "staged" ||
      staged.sessionId !== owner.sessionId ||
      staged.branchId !== owner.draftBranchId ||
      staged.videoKey !== owner.videoKey
    ) {
      throw new SubtitleRepositoryError(
        "VALIDATION_FAILED",
        "The staged subtitle does not match its acquisition owner",
      );
    }

    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        [
          "artifacts",
          "attachments",
          "batchItems",
          "batchJobs",
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
      const branches = transaction.objectStore("subtitleBranches");
      const runs = transaction.objectStore("generationRuns");
      const sessions = transaction.objectStore("sessions");
      const subtitles = transaction.objectStore("subtitleSnapshots");
      const videos = transaction.objectStore("videos");
      const [
        storedRun,
        storedSession,
        storedVideo,
        storedArtifacts,
        storedAttachments,
        storedBatchItems,
        storedBatchJobs,
        storedBranches,
        storedBranchPlacements,
        storedChatMessages,
        storedChatThreads,
        storedRuns,
        storedSubtitles,
      ] = await Promise.all([
        requestResult(runs.get(owner.acquisitionId)),
        requestResult(sessions.get(owner.sessionId)),
        requestResult(videos.get(owner.videoKey)),
        requestResult(transaction.objectStore("artifacts").getAll()),
        requestResult(transaction.objectStore("attachments").getAll()),
        requestResult(transaction.objectStore("batchItems").getAll()),
        requestResult(transaction.objectStore("batchJobs").getAll()),
        requestResult(branches.getAll()),
        requestResult(transaction.objectStore("branchPlacements").getAll()),
        requestResult(transaction.objectStore("chatMessages").getAll()),
        requestResult(transaction.objectStore("chatThreads").getAll()),
        requestResult(runs.getAll()),
        requestResult(subtitles.getAll()),
      ]);
      if (
        storedRun === undefined ||
        storedSession === undefined ||
        storedVideo === undefined
      ) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VIDEO_NOT_BOUND",
            "The subtitle acquisition owner is no longer available",
          ),
        );
      }
      if (
        !isStoredAcquisitionRun(storedRun) ||
        !matchesOwner(storedRun, owner)
      ) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The subtitle acquisition owner is invalid",
          ),
        );
      }
      if (storedRun.status !== "running") {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The subtitle acquisition is no longer running",
          ),
        );
      }
      const newerOwnerExists = (storedRuns as readonly unknown[]).some(
        (candidate) => {
          if (!isStoredAcquisitionRun(candidate)) return false;
          return (
            candidate.kind === "subtitle-acquisition" &&
            candidate.sessionId === owner.sessionId &&
            candidate.videoKey === owner.videoKey &&
            candidate.operationRevision !== undefined &&
            owner.operationRevision !== undefined &&
            candidate.operationRevision > owner.operationRevision
          );
        },
      );
      if (newerOwnerExists) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The subtitle acquisition owner is stale",
          ),
        );
      }
      if (
        storedRun.parameters.method === "direct" &&
        owner.trackId !== undefined &&
        (storedRun.trackId !== owner.trackId ||
          storedRun.parameters.trackId !== owner.trackId)
      ) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The subtitle track owner changed before commit",
          ),
        );
      }
      if (
        (storedRun.parameters.method === "direct" &&
          staged.source !== "bilibili") ||
        (storedRun.parameters.method === "speech" &&
          staged.source !== "groq-whisper")
      ) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The staged subtitle source does not match its acquisition",
          ),
        );
      }
      const session = createSession(storedSession as Session);
      const video = createVideoRef(storedVideo as VideoRef);
      assertContextMatchesOwner(session, video, owner);
      if (session.selectionRevision !== owner.expectedSelectionRevision) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The subtitle acquisition selection changed before commit",
          ),
        );
      }
      if (session.selectionRevision === Number.MAX_SAFE_INTEGER) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The subtitle selection revision cannot advance",
          ),
        );
      }

      const activeSubtitle = createSubtitleSnapshot({
        ...staged,
        status: "active",
      });
      const previousBranches = (storedBranches as readonly unknown[])
        .filter((value) => storedRecord(value)?.sessionId === owner.sessionId)
        .map((value) => createSubtitleBranch(value as never));
      if (
        previousBranches.some(
          (candidate) =>
            candidate.videoKey !== owner.videoKey ||
            candidate.branchId === owner.draftBranchId,
        ) ||
        (session.activeBranchId !== null &&
          !previousBranches.some(
            (candidate) => candidate.branchId === session.activeBranchId,
          ))
      ) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "STORAGE_TRANSACTION_FAILED",
            "The previous subtitle context is inconsistent",
          ),
        );
      }
      const previousBranchIds = new Set(
        previousBranches.map((candidate) => candidate.branchId),
      );
      const previousThreadIds = new Set(
        (storedChatThreads as readonly unknown[])
          .map(storedRecord)
          .filter(
            (record): record is StoredRecord =>
              record !== null &&
              (record.sessionId === owner.sessionId ||
                (typeof record.branchId === "string" &&
                  previousBranchIds.has(record.branchId))),
          )
          .map((record) => storedString(record, "chatThreadId"))
          .filter((value): value is string => value !== null),
      );
      const previousMessageIds = new Set(
        (storedChatMessages as readonly unknown[])
          .map(storedRecord)
          .filter(
            (record): record is StoredRecord =>
              record !== null &&
              (record.sessionId === owner.sessionId ||
                (typeof record.branchId === "string" &&
                  previousBranchIds.has(record.branchId)) ||
                (typeof record.chatThreadId === "string" &&
                  previousThreadIds.has(record.chatThreadId))),
          )
          .map((record) => storedString(record, "messageId"))
          .filter((value): value is string => value !== null),
      );
      const batchItemsToDelete = (storedBatchItems as readonly unknown[])
        .map(storedRecord)
        .filter(
          (record): record is StoredRecord =>
            record !== null &&
            typeof record.resultBranchId === "string" &&
            previousBranchIds.has(record.resultBranchId),
        );
      const affectedBatchJobIds = new Set(
        batchItemsToDelete
          .map((record) => storedString(record, "batchJobId"))
          .filter((value): value is string => value !== null),
      );
      const retainedBatchJobIds = new Set(
        (storedBatchItems as readonly unknown[])
          .map(storedRecord)
          .filter(
            (record): record is StoredRecord =>
              record !== null &&
              !(
                typeof record.resultBranchId === "string" &&
                previousBranchIds.has(record.resultBranchId)
              ),
          )
          .map((record) => storedString(record, "batchJobId"))
          .filter((value): value is string => value !== null),
      );
      const nextContextRevision =
        previousBranches.reduce(
          (highest, candidate) => Math.max(highest, candidate.contextRevision),
          0,
        ) + 1;
      const timestamp = Math.max(
        this.dependencies.now(),
        staged.createdAt,
        session.updatedAt,
        session.lastActivityAt,
      );
      const branch = createSubtitleBranch({
        activeSubtitleId: activeSubtitle.subtitleId,
        branchId: owner.draftBranchId,
        contextRevision: nextContextRevision,
        createdAt: activeSubtitle.createdAt,
        detectedLanguage:
          activeSubtitle.source === "groq-whisper"
            ? activeSubtitle.language
            : null,
        language: activeSubtitle.language,
        lastOpenedAt: timestamp,
        lastSelectedAt: timestamp,
        requestedLanguageMode:
          storedRun.parameters.method === "speech"
            ? storedRun.parameters.requestedLanguageMode
            : null,
        sessionId: owner.sessionId,
        source: activeSubtitle.source,
        trackOrigin: activeSubtitle.trackOrigin,
        title: null,
        updatedAt: timestamp,
        videoKey: owner.videoKey,
      });
      const placement = createBranchPlacement({
        branchId: branch.branchId,
        deletionReason: null,
        location: "workspace",
        order: timestamp,
        purgeAfter: null,
        retentionStartedAt: null,
        sessionId: branch.sessionId,
        trashedAt: null,
        trashOrigin: null,
        trashOriginFolderId: null,
        trashOriginPathSnapshot: null,
      });
      const updatedSession = createSession({
        ...session,
        activeBranchId: branch.branchId,
        lastActivityAt: timestamp,
        selectionRevision: session.selectionRevision + 1,
        updatedAt: timestamp,
      });

      deleteStoredRecords(
        transaction.objectStore("artifacts"),
        storedArtifacts as readonly unknown[],
        "artifactId",
        (record) =>
          record.sessionId === owner.sessionId ||
          (typeof record.branchId === "string" &&
            previousBranchIds.has(record.branchId)),
      );
      deleteStoredRecords(
        transaction.objectStore("attachments"),
        storedAttachments as readonly unknown[],
        "attachmentId",
        (record) =>
          record.sessionId === owner.sessionId ||
          (typeof record.branchId === "string" &&
            previousBranchIds.has(record.branchId)) ||
          (typeof record.messageId === "string" &&
            previousMessageIds.has(record.messageId)),
      );
      deleteStoredRecords(
        transaction.objectStore("batchItems"),
        batchItemsToDelete,
        "batchItemId",
        () => true,
      );
      deleteStoredRecords(
        transaction.objectStore("batchJobs"),
        storedBatchJobs as readonly unknown[],
        "batchJobId",
        (record) => {
          const batchJobId = storedString(record, "batchJobId");
          return (
            batchJobId !== null &&
            affectedBatchJobIds.has(batchJobId) &&
            !retainedBatchJobIds.has(batchJobId)
          );
        },
      );
      deleteStoredRecords(
        transaction.objectStore("chatMessages"),
        storedChatMessages as readonly unknown[],
        "messageId",
        (record) =>
          record.sessionId === owner.sessionId ||
          (typeof record.branchId === "string" &&
            previousBranchIds.has(record.branchId)) ||
          (typeof record.chatThreadId === "string" &&
            previousThreadIds.has(record.chatThreadId)),
      );
      deleteStoredRecords(
        transaction.objectStore("chatThreads"),
        storedChatThreads as readonly unknown[],
        "chatThreadId",
        (record) =>
          record.sessionId === owner.sessionId ||
          (typeof record.branchId === "string" &&
            previousBranchIds.has(record.branchId)),
      );
      deleteStoredRecords(
        runs,
        storedRuns as readonly unknown[],
        "runId",
        (record) =>
          storedString(record, "runId") !== owner.acquisitionId &&
          (record.sessionId === owner.sessionId ||
            (typeof record.branchId === "string" &&
              previousBranchIds.has(record.branchId))),
      );
      deleteStoredRecords(
        subtitles,
        storedSubtitles as readonly unknown[],
        "subtitleId",
        (record) =>
          record.sessionId === owner.sessionId ||
          (typeof record.branchId === "string" &&
            previousBranchIds.has(record.branchId)),
      );
      deleteStoredRecords(
        transaction.objectStore("branchPlacements"),
        storedBranchPlacements as readonly unknown[],
        "branchId",
        (record) =>
          record.sessionId === owner.sessionId ||
          (typeof record.branchId === "string" &&
            previousBranchIds.has(record.branchId)),
      );
      for (const previousBranch of previousBranches) {
        branches.delete(previousBranch.branchId);
      }

      subtitles.add(activeSubtitle);
      branches.add(branch);
      transaction.objectStore("branchPlacements").add(placement);
      sessions.put(updatedSession);
      runs.put({
        ...storedRun,
        status: "completed",
        subtitleId: activeSubtitle.subtitleId,
      } satisfies StoredAcquisitionRun);
      await transactionDone(transaction);
      return Object.freeze({
        branch,
        placement,
        session: updatedSession,
        subtitle: activeSubtitle,
      });
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
      }
      throw normalizeRepositoryError(error);
    }
  }

  async commitInitialAcquisition(
    stagedSubtitle: SubtitleSnapshot,
  ): Promise<InitialSubtitleCommitResult> {
    let staged: SubtitleSnapshot;
    try {
      staged = createSubtitleSnapshot(stagedSubtitle);
    } catch (error) {
      throw normalizeRepositoryError(error);
    }
    if (staged.status !== "staged") {
      throw new SubtitleRepositoryError(
        "VALIDATION_FAILED",
        "The first acquired subtitle must be staged",
      );
    }

    let transaction: IDBTransaction | undefined;
    try {
      transaction = this.database.transaction(
        [
          "branchPlacements",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
          "workspaceSessionPlacements",
        ],
        "readwrite",
      );
      const sessions = transaction.objectStore("sessions");
      const branches = transaction.objectStore("subtitleBranches");
      const subtitles = transaction.objectStore("subtitleSnapshots");
      const storedSession = await requestResult(sessions.get(staged.sessionId));
      if (storedSession === undefined) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VIDEO_NOT_BOUND",
            "The subtitle session does not exist",
          ),
        );
      }
      const session = createSession(storedSession as Session);
      if (session.videoKey !== staged.videoKey) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The session and subtitle video identities do not match",
          ),
        );
      }
      if (session.activeBranchId !== null) {
        abortWith(
          transaction,
          new SubtitleRepositoryError(
            "SUBTITLE_REPLACEMENT_REQUIRED",
            "An active subtitle already exists and requires replacement",
          ),
        );
      }

      const activeSubtitle = createSubtitleSnapshot({
        ...staged,
        status: "active",
      });
      const timestamp = Math.max(
        this.dependencies.now(),
        staged.createdAt,
        session.updatedAt,
        session.lastActivityAt,
      );
      const branch = createSubtitleBranch({
        activeSubtitleId: activeSubtitle.subtitleId,
        branchId: activeSubtitle.branchId,
        contextRevision: 1,
        createdAt: activeSubtitle.createdAt,
        detectedLanguage: null,
        language: activeSubtitle.language,
        lastOpenedAt: timestamp,
        lastSelectedAt: timestamp,
        requestedLanguageMode: null,
        sessionId: activeSubtitle.sessionId,
        source: activeSubtitle.source,
        trackOrigin: activeSubtitle.trackOrigin,
        title: null,
        updatedAt: timestamp,
        videoKey: activeSubtitle.videoKey,
      });
      const placement = createBranchPlacement({
        branchId: branch.branchId,
        deletionReason: null,
        location: "workspace",
        order: branch.createdAt,
        purgeAfter: null,
        retentionStartedAt: null,
        sessionId: branch.sessionId,
        trashedAt: null,
        trashOrigin: null,
        trashOriginFolderId: null,
        trashOriginPathSnapshot: null,
      });
      const updatedSession = createSession({
        ...session,
        activeBranchId: branch.branchId,
        lastActivityAt: timestamp,
        selectionRevision: session.selectionRevision + 1,
        updatedAt: timestamp,
      });
      subtitles.add(activeSubtitle);
      branches.add(branch);
      transaction.objectStore("branchPlacements").add(placement);
      transaction.objectStore("workspaceSessionPlacements").put({
        order: timestamp,
        pinned: false,
        sessionId: session.sessionId,
      });
      sessions.put(updatedSession);
      await transactionDone(transaction);
      return Object.freeze({
        branch,
        placement,
        session: updatedSession,
        subtitle: activeSubtitle,
      });
    } catch (error) {
      if (transaction !== undefined) {
        try {
          transaction.abort();
        } catch {
          // The transaction may already have completed or aborted.
        }
      }
      throw normalizeRepositoryError(error);
    }
  }
}
