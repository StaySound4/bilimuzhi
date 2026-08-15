import { StorageError } from "../../application/storage";
import {
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  type Session,
  type SubtitleBranch,
  type SubtitleSnapshot,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

const MIGRATION_SETTING_KEY = "singleSubtitleContext";
const MIGRATION_VERSION = 1 as const;
const MIGRATION_STORES = Object.freeze([
  "artifacts",
  "attachments",
  "batchItems",
  "batchJobs",
  "branchPlacements",
  "chatMessages",
  "chatThreads",
  "generationRuns",
  "sessions",
  "settings",
  "subtitleBranches",
  "subtitleSnapshots",
] as const);

type MigrationStoreName = (typeof MIGRATION_STORES)[number];
type StoredRecord = Readonly<Record<string, unknown>>;

export interface SingleSubtitleMigrationPreview {
  readonly affectedSessionCount: number;
  readonly artifactsToDelete: number;
  readonly attachmentsToDelete: number;
  readonly batchItemsToDelete: number;
  readonly branchesToDelete: number;
  readonly chatMessagesToDelete: number;
  readonly chatThreadsToDelete: number;
  readonly generationRunsToDelete: number;
  readonly requiresConfirmation: boolean;
  readonly subtitleSnapshotsToDelete: number;
}

export interface SingleSubtitleMigrationResult extends SingleSubtitleMigrationPreview {
  readonly migrated: boolean;
}

export interface MigrateToSingleSubtitleContextsOptions {
  readonly confirmed?: boolean;
  readonly now: number;
}

interface MigrationState {
  readonly records: Readonly<Record<MigrationStoreName, readonly unknown[]>>;
  readonly marker: unknown;
}

interface MigrationAnalysis {
  readonly affectedBatchJobIds: ReadonlySet<string>;
  readonly affectedSessionIds: ReadonlySet<string>;
  readonly oldBranchIds: ReadonlySet<string>;
  readonly oldMessageIds: ReadonlySet<string>;
  readonly oldThreadIds: ReadonlySet<string>;
  readonly preview: SingleSubtitleMigrationPreview;
  readonly retainedBatchJobIds: ReadonlySet<string>;
}

function record(value: unknown): StoredRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as StoredRecord)
    : null;
}

function stringField(value: StoredRecord, field: string): string | null {
  return typeof value[field] === "string" ? (value[field] as string) : null;
}

function migrationError(message: string): StorageError {
  return new StorageError(`Invalid active subtitle context: ${message}`);
}

function readSessions(values: readonly unknown[]): readonly Session[] {
  try {
    return values.map((value) => createSession(value as Session));
  } catch {
    throw migrationError("a session record is invalid");
  }
}

function readBranches(values: readonly unknown[]): readonly SubtitleBranch[] {
  try {
    return values.map((value) => createSubtitleBranch(value as SubtitleBranch));
  } catch {
    throw migrationError("a subtitle branch record is invalid");
  }
}

function readSubtitles(
  values: readonly unknown[],
): readonly SubtitleSnapshot[] {
  try {
    return values.map((value) =>
      createSubtitleSnapshot(value as SubtitleSnapshot),
    );
  } catch {
    throw migrationError("a subtitle snapshot record is invalid");
  }
}

function countRecords(
  values: readonly unknown[],
  predicate: (value: StoredRecord) => boolean,
): number {
  return values.reduce<number>((total, value) => {
    const candidate = record(value);
    return total + (candidate !== null && predicate(candidate) ? 1 : 0);
  }, 0);
}

function analyze(state: MigrationState): MigrationAnalysis {
  const sessions = readSessions(state.records.sessions);
  const branches = readBranches(state.records.subtitleBranches);
  const subtitles = readSubtitles(state.records.subtitleSnapshots);
  const sessionById = new Map(
    sessions.map((session) => [session.sessionId, session]),
  );
  if (sessionById.size !== sessions.length) {
    throw migrationError("duplicate session identity");
  }
  const branchById = new Map(
    branches.map((branch) => [branch.branchId, branch]),
  );
  if (branchById.size !== branches.length) {
    throw migrationError("duplicate branch identity");
  }
  const subtitleById = new Map(
    subtitles.map((subtitle) => [subtitle.subtitleId, subtitle]),
  );
  if (subtitleById.size !== subtitles.length) {
    throw migrationError("duplicate subtitle identity");
  }

  for (const branch of branches) {
    const owner = sessionById.get(branch.sessionId);
    if (owner === undefined || owner.videoKey !== branch.videoKey) {
      throw migrationError("a branch is not owned by its declared session");
    }
  }
  for (const subtitle of subtitles) {
    const owner = branchById.get(subtitle.branchId);
    if (
      owner === undefined ||
      owner.sessionId !== subtitle.sessionId ||
      owner.videoKey !== subtitle.videoKey
    ) {
      throw migrationError(
        "a subtitle snapshot is not owned by a valid branch",
      );
    }
  }

  const oldBranchIds = new Set<string>();
  const affectedSessionIds = new Set<string>();
  for (const session of sessions) {
    const owned = branches.filter(
      (branch) => branch.sessionId === session.sessionId,
    );
    if (session.activeBranchId === null) {
      if (owned.length > 0) {
        throw migrationError(
          `session ${session.sessionId} has branches but no unique active branch`,
        );
      }
      continue;
    }
    const active = branchById.get(session.activeBranchId);
    if (
      active === undefined ||
      active.sessionId !== session.sessionId ||
      active.videoKey !== session.videoKey
    ) {
      throw migrationError(
        `session ${session.sessionId} references a missing active branch`,
      );
    }
    const activeSubtitle = subtitleById.get(active.activeSubtitleId);
    if (
      activeSubtitle === undefined ||
      activeSubtitle.sessionId !== session.sessionId ||
      activeSubtitle.branchId !== active.branchId ||
      activeSubtitle.videoKey !== session.videoKey ||
      activeSubtitle.status !== "active"
    ) {
      throw migrationError(
        `session ${session.sessionId} references a missing active subtitle`,
      );
    }
    for (const branch of owned) {
      if (branch.branchId === active.branchId) continue;
      oldBranchIds.add(branch.branchId);
      affectedSessionIds.add(session.sessionId);
    }
  }

  const oldThreadIds = new Set(
    state.records.chatThreads
      .map(record)
      .filter(
        (value): value is StoredRecord =>
          value !== null &&
          typeof value.branchId === "string" &&
          oldBranchIds.has(value.branchId),
      )
      .map((value) => stringField(value, "chatThreadId"))
      .filter((value): value is string => value !== null),
  );
  const oldMessageIds = new Set(
    state.records.chatMessages
      .map(record)
      .filter(
        (value): value is StoredRecord =>
          value !== null &&
          ((typeof value.branchId === "string" &&
            oldBranchIds.has(value.branchId)) ||
            (typeof value.chatThreadId === "string" &&
              oldThreadIds.has(value.chatThreadId))),
      )
      .map((value) => stringField(value, "messageId"))
      .filter((value): value is string => value !== null),
  );
  const batchItemsToDelete = state.records.batchItems
    .map(record)
    .filter(
      (value): value is StoredRecord =>
        value !== null &&
        typeof value.resultBranchId === "string" &&
        oldBranchIds.has(value.resultBranchId),
    );
  const affectedBatchJobIds = new Set(
    batchItemsToDelete
      .map((value) => stringField(value, "batchJobId"))
      .filter((value): value is string => value !== null),
  );
  const retainedBatchJobIds = new Set(
    state.records.batchItems
      .map(record)
      .filter(
        (value): value is StoredRecord =>
          value !== null &&
          !(
            typeof value.resultBranchId === "string" &&
            oldBranchIds.has(value.resultBranchId)
          ),
      )
      .map((value) => stringField(value, "batchJobId"))
      .filter((value): value is string => value !== null),
  );
  const hasOldBranch = (value: StoredRecord): boolean =>
    typeof value.branchId === "string" && oldBranchIds.has(value.branchId);

  const preview = Object.freeze({
    affectedSessionCount: affectedSessionIds.size,
    artifactsToDelete: countRecords(state.records.artifacts, hasOldBranch),
    attachmentsToDelete: countRecords(
      state.records.attachments,
      (value) =>
        hasOldBranch(value) ||
        (typeof value.messageId === "string" &&
          oldMessageIds.has(value.messageId)),
    ),
    batchItemsToDelete: batchItemsToDelete.length,
    branchesToDelete: oldBranchIds.size,
    chatMessagesToDelete: countRecords(
      state.records.chatMessages,
      (value) =>
        hasOldBranch(value) ||
        (typeof value.chatThreadId === "string" &&
          oldThreadIds.has(value.chatThreadId)),
    ),
    chatThreadsToDelete: oldThreadIds.size,
    generationRunsToDelete: countRecords(
      state.records.generationRuns,
      hasOldBranch,
    ),
    requiresConfirmation: oldBranchIds.size > 0,
    subtitleSnapshotsToDelete: countRecords(
      state.records.subtitleSnapshots,
      hasOldBranch,
    ),
  } satisfies SingleSubtitleMigrationPreview);

  return {
    affectedBatchJobIds,
    affectedSessionIds,
    oldBranchIds,
    oldMessageIds,
    oldThreadIds,
    preview,
    retainedBatchJobIds,
  };
}

async function readState(transaction: IDBTransaction): Promise<MigrationState> {
  const values = await Promise.all(
    MIGRATION_STORES.map((storeName) =>
      requestResult(transaction.objectStore(storeName).getAll()),
    ),
  );
  const records = Object.fromEntries(
    MIGRATION_STORES.map((storeName, index) => [storeName, values[index]]),
  ) as unknown as Record<MigrationStoreName, readonly unknown[]>;
  const marker = records.settings.find(
    (value) => record(value)?.key === MIGRATION_SETTING_KEY,
  );
  return { marker, records };
}

function deleteRecords(
  store: IDBObjectStore,
  values: readonly unknown[],
  keyField: string,
  predicate: (value: StoredRecord) => boolean,
): void {
  for (const value of values) {
    const candidate = record(value);
    if (candidate === null || !predicate(candidate)) continue;
    const key = candidate[keyField];
    if (typeof key === "string" || typeof key === "number") store.delete(key);
  }
}

export async function inspectSingleSubtitleMigration(
  database: IDBDatabase,
): Promise<SingleSubtitleMigrationPreview> {
  let transaction: IDBTransaction | undefined;
  try {
    transaction = database.transaction([...MIGRATION_STORES], "readonly");
    const state = await readState(transaction);
    const analysis = analyze(state);
    await transactionDone(transaction);
    return analysis.preview;
  } catch (error) {
    try {
      transaction?.abort();
    } catch {
      // A completed read transaction has no writes to roll back.
    }
    throw error instanceof StorageError
      ? error
      : migrationError("the migration preview could not be verified");
  }
}

export async function migrateToSingleSubtitleContexts(
  database: IDBDatabase,
  options: MigrateToSingleSubtitleContextsOptions,
): Promise<SingleSubtitleMigrationResult> {
  if (!Number.isSafeInteger(options.now) || options.now < 0) {
    throw new StorageError("The single subtitle migration clock is invalid");
  }
  let transaction: IDBTransaction | undefined;
  try {
    transaction = database.transaction([...MIGRATION_STORES], "readwrite");
    const state = await readState(transaction);
    const analysis = analyze(state);
    if (analysis.preview.requiresConfirmation && options.confirmed !== true) {
      throw new StorageError(
        "Single subtitle migration requires explicit user confirmation",
      );
    }
    const old = analysis.oldBranchIds;
    const hasOldBranch = (value: StoredRecord): boolean =>
      typeof value.branchId === "string" && old.has(value.branchId);
    deleteRecords(
      transaction.objectStore("artifacts"),
      state.records.artifacts,
      "artifactId",
      hasOldBranch,
    );
    deleteRecords(
      transaction.objectStore("attachments"),
      state.records.attachments,
      "attachmentId",
      (value) =>
        hasOldBranch(value) ||
        (typeof value.messageId === "string" &&
          analysis.oldMessageIds.has(value.messageId)),
    );
    deleteRecords(
      transaction.objectStore("batchItems"),
      state.records.batchItems,
      "batchItemId",
      (value) =>
        typeof value.resultBranchId === "string" &&
        old.has(value.resultBranchId),
    );
    deleteRecords(
      transaction.objectStore("batchJobs"),
      state.records.batchJobs,
      "batchJobId",
      (value) => {
        const id = stringField(value, "batchJobId");
        return (
          id !== null &&
          analysis.affectedBatchJobIds.has(id) &&
          !analysis.retainedBatchJobIds.has(id)
        );
      },
    );
    deleteRecords(
      transaction.objectStore("branchPlacements"),
      state.records.branchPlacements,
      "branchId",
      hasOldBranch,
    );
    deleteRecords(
      transaction.objectStore("chatMessages"),
      state.records.chatMessages,
      "messageId",
      (value) =>
        hasOldBranch(value) ||
        (typeof value.chatThreadId === "string" &&
          analysis.oldThreadIds.has(value.chatThreadId)),
    );
    deleteRecords(
      transaction.objectStore("chatThreads"),
      state.records.chatThreads,
      "chatThreadId",
      hasOldBranch,
    );
    deleteRecords(
      transaction.objectStore("generationRuns"),
      state.records.generationRuns,
      "runId",
      hasOldBranch,
    );
    deleteRecords(
      transaction.objectStore("subtitleSnapshots"),
      state.records.subtitleSnapshots,
      "subtitleId",
      hasOldBranch,
    );
    for (const branchId of old) {
      transaction.objectStore("subtitleBranches").delete(branchId);
    }
    const previousMarker = record(state.marker);
    const alreadyMarked =
      previousMarker?.key === MIGRATION_SETTING_KEY &&
      previousMarker.version === MIGRATION_VERSION;
    transaction.objectStore("settings").put({
      completedAt: options.now,
      key: MIGRATION_SETTING_KEY,
      version: MIGRATION_VERSION,
    });
    await transactionDone(transaction);
    return Object.freeze({
      ...analysis.preview,
      migrated: analysis.preview.branchesToDelete > 0 || !alreadyMarked,
    });
  } catch (error) {
    try {
      transaction?.abort();
    } catch {
      // The version is unchanged when a destructive transaction aborts.
    }
    throw error instanceof StorageError
      ? error
      : migrationError("the destructive migration could not be completed");
  }
}
