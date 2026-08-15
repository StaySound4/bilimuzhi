import {
  canApplyGenerationRuntimeEvent,
  isGenerationRunNonTerminal,
  isGenerationRuntimeEvent,
  reconcileGenerationRunAfterBackgroundStart,
  type GenerationRuntimeEvent,
} from "../../application/generation-runtime-contract";
import { GenerationTaskConflictError } from "../../application/task";
import { StorageError } from "../../application/storage";
import {
  createArtifact,
  createBranchPlacement,
  createChatThread,
  createGenerationRun,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createTaskOwner,
  type Artifact,
  type GenerationRun,
  type TaskOwner,
} from "../../domain";
import { requestResult, transactionDone } from "./idb-requests";

export interface IndexedDbGenerationRepositoryDependencies {
  readonly now: () => number;
}

function normalizeStorageError(error: unknown): StorageError {
  return error instanceof StorageError
    ? error
    : new StorageError("Unable to update the Bilimuzhi generation task");
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function validNow(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readRun(value: unknown): GenerationRun | null {
  try {
    return createGenerationRun(value as GenerationRun);
  } catch {
    // generationRuns also contains direct subtitle acquisition records. Those
    // have a different owner model and must never be mutated by AI events.
    return null;
  }
}

function hasSameTaskOwner(left: GenerationRun, right: GenerationRun): boolean {
  return (
    left.taskId === right.taskId &&
    left.sessionId === right.sessionId &&
    left.branchId === right.branchId &&
    left.subtitleId === right.subtitleId &&
    left.contextRevision === right.contextRevision &&
    left.kind === right.kind &&
    left.targetId === right.targetId &&
    left.expectedOwnerRevision === right.expectedOwnerRevision &&
    (left.promptHash ?? null) === (right.promptHash ?? null) &&
    (left.modelHash ?? null) === (right.modelHash ?? null) &&
    (left.contextHash ?? null) === (right.contextHash ?? null) &&
    (left.conversationRevision ?? left.expectedOwnerRevision) ===
      (right.conversationRevision ?? right.expectedOwnerRevision) &&
    (left.runRevision ?? 0) === (right.runRevision ?? 0)
  );
}

function hasSameActiveOwner(left: TaskOwner, right: TaskOwner): boolean {
  return (
    left.sessionId === right.sessionId &&
    left.branchId === right.branchId &&
    left.subtitleId === right.subtitleId &&
    left.contextRevision === right.contextRevision &&
    left.kind === right.kind &&
    left.targetId === right.targetId
  );
}

function hasAuthoritativeOwner(
  run: GenerationRun,
  storedSession: unknown,
  storedBranch: unknown,
  storedPlacement: unknown,
  storedSubtitle: unknown,
): boolean {
  try {
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
    return (
      session.sessionId === run.sessionId &&
      session.videoKey === branch.videoKey &&
      branch.branchId === run.branchId &&
      branch.sessionId === run.sessionId &&
      branch.activeSubtitleId === run.subtitleId &&
      branch.contextRevision === run.contextRevision &&
      placement.branchId === run.branchId &&
      placement.sessionId === run.sessionId &&
      placement.location !== "trash" &&
      subtitle.subtitleId === run.subtitleId &&
      subtitle.branchId === run.branchId &&
      subtitle.sessionId === run.sessionId &&
      subtitle.videoKey === branch.videoKey &&
      subtitle.status === "active"
    );
  } catch {
    return false;
  }
}

function hasAuthoritativeTarget(
  run: GenerationRun,
  storedChatThread: unknown,
  storedArtifact: unknown,
): boolean {
  if (run.kind === "chat") {
    try {
      const thread = createChatThread(
        storedChatThread as Parameters<typeof createChatThread>[0],
      );
      return (
        thread.chatThreadId === run.targetId &&
        thread.sessionId === run.sessionId &&
        thread.branchId === run.branchId &&
        thread.subtitleId === run.subtitleId &&
        thread.conversationRevision === run.expectedOwnerRevision
      );
    } catch {
      return false;
    }
  }

  try {
    const artifact = createArtifact(storedArtifact as Artifact);
    return (
      artifact.artifactId === run.targetId &&
      artifact.kind === run.kind &&
      artifact.sessionId === run.sessionId &&
      artifact.branchId === run.branchId &&
      artifact.subtitleId === run.subtitleId &&
      artifact.contextRevision === run.contextRevision &&
      artifact.artifactRevision === run.expectedOwnerRevision
    );
  } catch {
    return false;
  }
}

function transitionRun(
  run: GenerationRun,
  event: GenerationRuntimeEvent,
  now: number,
  completionSequence: number | null,
): GenerationRun | null {
  const updatedAt = Math.max(now, run.updatedAt);
  switch (event.type) {
    case "muzhi.generation.started":
      return createGenerationRun({
        ...run,
        status: "running",
        updatedAt,
      });
    case "muzhi.generation.status":
      if (event.payload.status === "queued" && run.status !== "queued") {
        return null;
      }
      return createGenerationRun({
        ...run,
        status: event.payload.status,
        updatedAt,
      });
    case "muzhi.generation.reasoning":
      // Reasoning is a transient UI-only signal. It must never be persisted
      // into generation output, chat messages, copied content, or exports.
      return null;
    case "muzhi.generation.delta":
      if (run.partialOutput.length + event.payload.delta.length > 2_000_000) {
        return null;
      }
      return createGenerationRun({
        ...run,
        partialOutput: `${run.partialOutput}${event.payload.delta}`,
        updatedAt,
      });
    case "muzhi.generation.completed":
      if (completionSequence === null) return null;
      return createGenerationRun({
        ...run,
        completionSequence,
        errorCode: null,
        partialOutput: event.payload.output,
        status: "completed",
        stopReason: null,
        updatedAt,
      });
    case "muzhi.generation.stopped":
      return createGenerationRun({
        ...run,
        completionSequence: null,
        errorCode: null,
        status: "stopped",
        stopReason: event.payload.reason,
        updatedAt,
      });
    case "muzhi.generation.interrupted":
      return createGenerationRun({
        ...run,
        completionSequence: null,
        errorCode: null,
        status: "interrupted",
        stopReason: null,
        updatedAt,
      });
    case "muzhi.generation.failed":
      return createGenerationRun({
        ...run,
        completionSequence: null,
        errorCode: event.payload.errorCode,
        status: "failed",
        stopReason: null,
        updatedAt,
      });
  }
}

export class IndexedDbGenerationRepository {
  constructor(
    private readonly database: IDBDatabase,
    dependencies: IndexedDbGenerationRepositoryDependencies,
  ) {
    void dependencies;
  }

  async begin(inputRun: GenerationRun): Promise<GenerationRun> {
    let candidate: GenerationRun;
    try {
      candidate = createGenerationRun(inputRun);
    } catch {
      throw new StorageError("The Bilimuzhi generation task is invalid");
    }
    if (candidate.status !== "queued") {
      throw new StorageError(
        "A generation task must begin in the queued state",
      );
    }

    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction(
        [
          "artifacts",
          "branchPlacements",
          "chatThreads",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readwrite",
      );
      done = transactionDone(transaction);
      const runs = transaction.objectStore("generationRuns");
      const replay = readRun(
        await requestResult(runs.index("byTaskId").get(candidate.taskId)),
      );
      if (replay !== null) {
        if (hasSameTaskOwner(replay, candidate)) {
          await done;
          return replay;
        }
        throw new GenerationTaskConflictError(
          "The generation task ID belongs to another owner",
        );
      }

      const runIdCollision = readRun(
        await requestResult(runs.get(candidate.runId)),
      );
      if (runIdCollision !== null) {
        throw new GenerationTaskConflictError(
          "The generation run ID already belongs to another task",
        );
      }
      const activeRuns = (await requestResult(
        runs.index("byBranchId").getAll(candidate.branchId),
      )) as readonly unknown[];
      if (
        activeRuns.some((value) => {
          const run = readRun(value);
          return (
            run !== null &&
            isGenerationRunNonTerminal(run.status) &&
            hasSameActiveOwner(run, candidate)
          );
        })
      ) {
        throw new GenerationTaskConflictError(
          "The generation owner already has an active task",
        );
      }

      const [
        storedSession,
        storedBranch,
        storedPlacement,
        storedSubtitle,
        storedTarget,
      ] = await Promise.all([
        requestResult(
          transaction.objectStore("sessions").get(candidate.sessionId),
        ),
        requestResult(
          transaction.objectStore("subtitleBranches").get(candidate.branchId),
        ),
        requestResult(
          transaction.objectStore("branchPlacements").get(candidate.branchId),
        ),
        requestResult(
          transaction
            .objectStore("subtitleSnapshots")
            .get(candidate.subtitleId),
        ),
        requestResult(
          candidate.kind === "chat"
            ? transaction.objectStore("chatThreads").get(candidate.targetId)
            : transaction.objectStore("artifacts").get(candidate.targetId),
        ),
      ]);
      if (
        !hasAuthoritativeOwner(
          candidate,
          storedSession,
          storedBranch,
          storedPlacement,
          storedSubtitle,
        ) ||
        !hasAuthoritativeTarget(
          candidate,
          candidate.kind === "chat" ? storedTarget : undefined,
          candidate.kind === "chat" ? undefined : storedTarget,
        )
      ) {
        throw new GenerationTaskConflictError(
          "The generation owner is no longer authoritative",
        );
      }

      runs.add(candidate);
      await done;
      return candidate;
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A request error can already have closed the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // Preserve the explicit conflict error below.
        }
      }
      if (error instanceof GenerationTaskConflictError) throw error;
      throw normalizeStorageError(error);
    }
  }

  async applyEvent(
    event: GenerationRuntimeEvent,
    now: number,
  ): Promise<GenerationRun | null> {
    if (!isGenerationRuntimeEvent(event)) return null;
    if (!validNow(now)) {
      throw new StorageError("The Bilimuzhi generation clock is invalid");
    }

    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction(
        [
          "artifacts",
          "branchPlacements",
          "chatThreads",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readwrite",
      );
      done = transactionDone(transaction);
      const runs = transaction.objectStore("generationRuns");
      const storedRun = await requestResult(
        runs.index("byTaskId").get(event.taskId),
      );
      const run = readRun(storedRun);
      if (run === null || !canApplyGenerationRuntimeEvent(run, event)) {
        await done;
        return null;
      }

      const [
        storedSession,
        storedBranch,
        storedPlacement,
        storedSubtitle,
        storedTarget,
      ] = await Promise.all([
        requestResult(transaction.objectStore("sessions").get(run.sessionId)),
        requestResult(
          transaction.objectStore("subtitleBranches").get(run.branchId),
        ),
        requestResult(
          transaction.objectStore("branchPlacements").get(run.branchId),
        ),
        requestResult(
          transaction.objectStore("subtitleSnapshots").get(run.subtitleId),
        ),
        requestResult(
          run.kind === "chat"
            ? transaction.objectStore("chatThreads").get(run.targetId)
            : transaction.objectStore("artifacts").get(run.targetId),
        ),
      ]);
      if (
        !hasAuthoritativeOwner(
          run,
          storedSession,
          storedBranch,
          storedPlacement,
          storedSubtitle,
        ) ||
        !hasAuthoritativeTarget(
          run,
          run.kind === "chat" ? storedTarget : undefined,
          run.kind === "chat" ? undefined : storedTarget,
        )
      ) {
        await done;
        return null;
      }

      const branch = createSubtitleBranch(
        storedBranch as Parameters<typeof createSubtitleBranch>[0],
      );
      const completionSequence =
        event.type === "muzhi.generation.completed"
          ? branch.completionSequence === Number.MAX_SAFE_INTEGER
            ? null
            : branch.completionSequence + 1
          : null;
      const nextRun = transitionRun(run, event, now, completionSequence);
      if (nextRun === null) {
        await done;
        return null;
      }
      if (event.type === "muzhi.generation.completed") {
        transaction.objectStore("subtitleBranches").put(
          createSubtitleBranch({
            ...branch,
            completionSequence: completionSequence ?? branch.completionSequence,
            updatedAt: Math.max(now, branch.updatedAt),
          }),
        );
      }
      runs.put(nextRun);
      await done;
      return nextRun;
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A request error can already have closed the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the safe boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async stopByUser(
    owner: TaskOwner,
    now: number,
  ): Promise<GenerationRun | null> {
    let expectedOwner: TaskOwner;
    try {
      expectedOwner = createTaskOwner(owner);
    } catch {
      throw new StorageError("The Bilimuzhi generation owner is invalid");
    }
    if (!validNow(now)) {
      throw new StorageError("The Bilimuzhi generation clock is invalid");
    }

    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction(
        [
          "branchPlacements",
          "generationRuns",
          "sessions",
          "subtitleBranches",
          "subtitleSnapshots",
        ],
        "readwrite",
      );
      done = transactionDone(transaction);
      const runs = transaction.objectStore("generationRuns");
      const storedRun = await requestResult(
        runs.index("byTaskId").get(expectedOwner.taskId),
      );
      const run = readRun(storedRun);
      if (
        run === null ||
        !isGenerationRunNonTerminal(run.status) ||
        run.sessionId !== expectedOwner.sessionId ||
        run.branchId !== expectedOwner.branchId ||
        run.subtitleId !== expectedOwner.subtitleId ||
        run.contextRevision !== expectedOwner.contextRevision ||
        run.kind !== expectedOwner.kind ||
        run.targetId !== expectedOwner.targetId ||
        run.expectedOwnerRevision !== expectedOwner.expectedOwnerRevision
      ) {
        await done;
        return null;
      }
      const [storedSession, storedBranch, storedPlacement, storedSubtitle] =
        await Promise.all([
          requestResult(transaction.objectStore("sessions").get(run.sessionId)),
          requestResult(
            transaction.objectStore("subtitleBranches").get(run.branchId),
          ),
          requestResult(
            transaction.objectStore("branchPlacements").get(run.branchId),
          ),
          requestResult(
            transaction.objectStore("subtitleSnapshots").get(run.subtitleId),
          ),
        ]);
      if (
        !hasAuthoritativeOwner(
          run,
          storedSession,
          storedBranch,
          storedPlacement,
          storedSubtitle,
        )
      ) {
        await done;
        return null;
      }
      const stopped = createGenerationRun({
        ...run,
        completionSequence: null,
        errorCode: null,
        status: "stopped",
        stopReason: "user",
        updatedAt: Math.max(now, run.updatedAt),
      });
      runs.put(stopped);
      await done;
      return stopped;
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A request error can already have closed the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the safe boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async listQueuedOrRunning(): Promise<readonly GenerationRun[]> {
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction("generationRuns", "readonly");
      done = transactionDone(transaction);
      const storedRuns = await requestResult(
        transaction.objectStore("generationRuns").getAll(),
      );
      const runs = (storedRuns as readonly unknown[])
        .map(readRun)
        .filter(
          (run): run is GenerationRun =>
            run !== null && isGenerationRunNonTerminal(run.status),
        )
        .sort(
          (left, right) =>
            left.createdAt - right.createdAt ||
            left.runId.localeCompare(right.runId),
        );
      await done;
      return Object.freeze(runs);
    } catch (error) {
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the safe boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }

  async reconcileAfterBackgroundStart(
    inputRun: GenerationRun,
    input: {
      readonly browserSessionId: string;
      readonly hasLiveExecutor: boolean;
      readonly now: number;
    },
  ): Promise<GenerationRun | null> {
    let candidate: GenerationRun;
    try {
      candidate = createGenerationRun(inputRun);
    } catch {
      throw new StorageError("The Bilimuzhi generation recovery run is invalid");
    }
    if (
      !isSafeIdentifier(input.browserSessionId) ||
      typeof input.hasLiveExecutor !== "boolean" ||
      !validNow(input.now)
    ) {
      throw new StorageError("The Bilimuzhi generation recovery input is invalid");
    }
    let transaction: IDBTransaction | undefined;
    let done: Promise<void> | undefined;
    try {
      transaction = this.database.transaction("generationRuns", "readwrite");
      done = transactionDone(transaction);
      const runs = transaction.objectStore("generationRuns");
      const current = readRun(await requestResult(runs.get(candidate.runId)));
      if (
        current === null ||
        !hasSameTaskOwner(current, candidate) ||
        current.browserSessionId !== candidate.browserSessionId
      ) {
        await done;
        return null;
      }
      const reconciled = reconcileGenerationRunAfterBackgroundStart(
        current,
        input,
      );
      if (reconciled !== current) runs.put(reconciled);
      await done;
      return reconciled;
    } catch (error) {
      try {
        transaction?.abort();
      } catch {
        // A request error can already have closed the transaction.
      }
      if (done !== undefined) {
        try {
          await done;
        } catch {
          // The normalized error below is the safe boundary.
        }
      }
      throw normalizeStorageError(error);
    }
  }
}
