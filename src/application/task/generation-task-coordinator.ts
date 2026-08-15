import {
  createGenerationRun,
  createTaskOwner,
  type GenerationRun,
  type TaskOwner,
} from "../../domain";
import {
  isGenerationRuntimeEvent,
  type GenerationRuntimeEvent,
} from "../generation-runtime-contract";
import type { GenerationExecutorRegistry } from "./executor-registry";

export type GenerationActiveOwner = Pick<
  TaskOwner,
  | "sessionId"
  | "branchId"
  | "subtitleId"
  | "contextRevision"
  | "kind"
  | "targetId"
>;

/**
 * The persistence boundary is deliberately command-shaped. Implementations
 * must execute each operation inside one authoritative transaction; callers
 * must not reproduce a read/validate/update sequence in application code.
 */
export interface GenerationRunStore {
  /**
   * Atomically replay a matching task, reject a task-ID owner mismatch, reject
   * an existing active owner, or create the queued run.
   */
  begin(run: GenerationRun): Promise<GenerationRun>;
  /**
   * Atomically find the exact live owner, reject late/deleted events, and
   * persist the event result. For completed events the repository allocates
   * completionSequence; the event payload value is not authoritative.
   */
  applyEvent(
    event: GenerationRuntimeEvent,
    now: number,
  ): Promise<GenerationRun | null>;
  /**
   * Atomically verify the exact active owner and persist stopped/user. A null
   * result means no abort is allowed because no user stop was committed.
   */
  stopByUser(owner: TaskOwner, now: number): Promise<GenerationRun | null>;
}

export interface GenerationRunReconciliationStore extends GenerationRunStore {
  listQueuedOrRunning(): Promise<readonly GenerationRun[]>;
  /**
   * Atomically re-read the candidate run before either retaining a verified
   * same-session executor or recording interrupted. It returns null if the
   * candidate disappeared during reconciliation.
   */
  reconcileAfterBackgroundStart(
    run: GenerationRun,
    input: {
      readonly browserSessionId: string;
      readonly hasLiveExecutor: boolean;
      readonly now: number;
    },
  ): Promise<GenerationRun | null>;
}

export interface GenerationTaskCoordinatorDependencies {
  readonly browserSessionId: string;
  readonly createRunId: () => string;
  readonly executorRegistry: GenerationExecutorRegistry;
  readonly now: () => number;
  readonly store: GenerationRunStore;
}

export interface GenerationTaskStart extends TaskOwner {
  readonly promptHash?: string | null;
  readonly modelHash?: string | null;
  readonly contextHash?: string | null;
  readonly conversationRevision?: number;
  readonly runRevision?: number;
}

export interface GenerationTaskCoordinator {
  applyEvent(event: unknown): Promise<GenerationRun | null>;
  start(owner: GenerationTaskStart): Promise<GenerationRun>;
  stop(owner: TaskOwner): Promise<GenerationRun | null>;
}

export class GenerationTaskConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationTaskConflictError";
  }
}

function hasSameTaskOwner(
  left: GenerationTaskStart,
  right: GenerationTaskStart,
): boolean {
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

function activeOwnerKey(owner: TaskOwner): string {
  return [
    owner.sessionId,
    owner.branchId,
    owner.subtitleId,
    owner.contextRevision,
    owner.kind,
    owner.targetId,
  ].join("\u0000");
}

class DefaultGenerationTaskCoordinator implements GenerationTaskCoordinator {
  private readonly startsByActiveOwner = new Map<
    string,
    {
      readonly owner: GenerationTaskStart;
      readonly result: Promise<GenerationRun>;
    }
  >();
  private readonly startsByTaskId = new Map<
    string,
    {
      readonly owner: GenerationTaskStart;
      readonly result: Promise<GenerationRun>;
    }
  >();

  constructor(
    private readonly dependencies: GenerationTaskCoordinatorDependencies,
  ) {}

  async start(inputOwner: GenerationTaskStart): Promise<GenerationRun> {
    const owner = createTaskOwner(inputOwner);
    const startOwner: GenerationTaskStart = Object.freeze({
      ...owner,
      contextHash: inputOwner.contextHash ?? null,
      conversationRevision:
        inputOwner.conversationRevision ?? owner.expectedOwnerRevision,
      modelHash: inputOwner.modelHash ?? null,
      promptHash: inputOwner.promptHash ?? null,
      runRevision: inputOwner.runRevision ?? 0,
    });
    const taskStart = this.startsByTaskId.get(owner.taskId);
    if (taskStart !== undefined) {
      if (hasSameTaskOwner(taskStart.owner, startOwner)) {
        return taskStart.result;
      }
      throw new GenerationTaskConflictError(
        "The generation task ID belongs to another owner",
      );
    }
    const ownerKey = activeOwnerKey(owner);
    const activeStart = this.startsByActiveOwner.get(ownerKey);
    if (activeStart !== undefined) {
      if (hasSameTaskOwner(activeStart.owner, startOwner)) {
        return activeStart.result;
      }
      throw new GenerationTaskConflictError(
        "The generation owner already has an active task",
      );
    }

    const now = this.dependencies.now();
    const operation = this.dependencies.store.begin(
      createGenerationRun({
        ...owner,
        browserSessionId: this.dependencies.browserSessionId,
        completionSequence: null,
        createdAt: now,
        errorCode: null,
        partialOutput: "",
        promptHash: startOwner.promptHash,
        modelHash: startOwner.modelHash,
        contextHash: startOwner.contextHash,
        conversationRevision: startOwner.conversationRevision,
        runId: this.dependencies.createRunId(),
        runRevision: startOwner.runRevision,
        status: "queued",
        stopReason: null,
        updatedAt: now,
      }),
    );
    const inFlight = Object.freeze({ owner: startOwner, result: operation });
    this.startsByTaskId.set(owner.taskId, inFlight);
    this.startsByActiveOwner.set(ownerKey, inFlight);
    const clearInFlight = (): void => {
      if (this.startsByTaskId.get(owner.taskId) === inFlight) {
        this.startsByTaskId.delete(owner.taskId);
      }
      if (this.startsByActiveOwner.get(ownerKey) === inFlight) {
        this.startsByActiveOwner.delete(ownerKey);
      }
    };
    // Observe both terminal paths directly. Chaining a bare `finally()` from a
    // rejected start promise can create a second, unobserved rejection even
    // though the caller correctly observes the promise returned by start().
    void operation.then(clearInFlight, clearInFlight);
    return operation;
  }

  async stop(inputOwner: TaskOwner): Promise<GenerationRun | null> {
    const owner = createTaskOwner(inputOwner);
    const stopped = await this.dependencies.store.stopByUser(
      owner,
      this.dependencies.now(),
    );
    if (stopped === null) return null;
    try {
      await this.dependencies.executorRegistry.abort(owner);
    } catch {
      // Abort is best-effort. The committed terminal state rejects late events.
    }
    return stopped;
  }

  async applyEvent(event: unknown): Promise<GenerationRun | null> {
    if (!isGenerationRuntimeEvent(event)) return null;
    return this.dependencies.store.applyEvent(event, this.dependencies.now());
  }
}

export function createGenerationTaskCoordinator(
  dependencies: GenerationTaskCoordinatorDependencies,
): GenerationTaskCoordinator {
  return new DefaultGenerationTaskCoordinator(dependencies);
}

export interface BrowserSessionGenerationReconciliationInput {
  readonly browserSessionId: string;
  readonly executorRegistry: GenerationExecutorRegistry;
  readonly now: () => number;
  readonly store: GenerationRunReconciliationStore;
}

/**
 * A background restart retains an active run only after its exact executor
 * owner has been re-bound. The store owns the final transactional re-check.
 */
export async function reconcileGenerationTasksForBrowserSession(
  input: BrowserSessionGenerationReconciliationInput,
): Promise<readonly GenerationRun[]> {
  const candidates = await input.store.listQueuedOrRunning();
  const reconciled: GenerationRun[] = [];
  for (const candidate of candidates) {
    const run = createGenerationRun(candidate);
    let hasLiveExecutor = false;
    if (
      run.browserSessionId === input.browserSessionId &&
      input.executorRegistry.rebind !== undefined &&
      (await input.executorRegistry.hasLiveExecutor?.(run)) === true
    ) {
      try {
        await input.executorRegistry.rebind(run);
        hasLiveExecutor = true;
      } catch {
        // A failed rebind is indistinguishable from a lost executor lease.
      }
    }
    const persisted = await input.store.reconcileAfterBackgroundStart(run, {
      browserSessionId: input.browserSessionId,
      hasLiveExecutor,
      now: input.now(),
    });
    if (persisted !== null) reconciled.push(persisted);
  }
  return Object.freeze(reconciled);
}

export type { GenerationExecutorRegistry } from "./executor-registry";
