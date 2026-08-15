import {
  createTaskOwner,
  type GenerationRun,
  type TaskOwner,
} from "../../domain";

export interface GenerationExecutor {
  readonly owner: TaskOwner;
  abort(): Promise<void> | void;
  rebind?(run: GenerationRun): Promise<void> | void;
}

export interface GenerationExecutorRegistry {
  abort(owner: TaskOwner): Promise<void> | void;
  hasLiveExecutor?(owner: TaskOwner): Promise<boolean> | boolean;
  rebind?(run: GenerationRun): Promise<void> | void;
}

export interface MutableGenerationExecutorRegistry extends GenerationExecutorRegistry {
  register(executor: GenerationExecutor): () => void;
}

function hasSameTaskOwner(left: TaskOwner, right: TaskOwner): boolean {
  return (
    left.taskId === right.taskId &&
    left.sessionId === right.sessionId &&
    left.branchId === right.branchId &&
    left.subtitleId === right.subtitleId &&
    left.contextRevision === right.contextRevision &&
    left.kind === right.kind &&
    left.targetId === right.targetId &&
    left.expectedOwnerRevision === right.expectedOwnerRevision
  );
}

/**
 * Keeps only in-memory executor leases. Generation data remains in the
 * repository; a background restart therefore never mistakes this registry
 * for durable task state.
 */
export function createGenerationExecutorRegistry(): MutableGenerationExecutorRegistry {
  const executors = new Map<string, GenerationExecutor>();

  return Object.freeze({
    async abort(inputOwner: TaskOwner): Promise<void> {
      const owner = createTaskOwner(inputOwner);
      const executor = executors.get(owner.taskId);
      if (executor !== undefined && hasSameTaskOwner(executor.owner, owner)) {
        await executor.abort();
      }
    },
    hasLiveExecutor(inputOwner: TaskOwner): boolean {
      const owner = createTaskOwner(inputOwner);
      const executor = executors.get(owner.taskId);
      return executor !== undefined && hasSameTaskOwner(executor.owner, owner);
    },
    async rebind(run: GenerationRun): Promise<void> {
      const executor = executors.get(run.taskId);
      if (executor === undefined || !hasSameTaskOwner(executor.owner, run)) {
        throw new Error("The generation executor lease is not live");
      }
      await executor.rebind?.(run);
    },
    register(inputExecutor: GenerationExecutor): () => void {
      const owner = createTaskOwner(inputExecutor.owner);
      const executor: GenerationExecutor = Object.freeze({
        abort: inputExecutor.abort.bind(inputExecutor),
        owner,
        rebind:
          inputExecutor.rebind === undefined
            ? undefined
            : inputExecutor.rebind.bind(inputExecutor),
      });
      const existing = executors.get(owner.taskId);
      if (existing !== undefined && !hasSameTaskOwner(existing.owner, owner)) {
        throw new Error(
          "The generation task ID already belongs to another owner",
        );
      }
      executors.set(owner.taskId, executor);
      return () => {
        if (executors.get(owner.taskId) === executor) {
          executors.delete(owner.taskId);
        }
      };
    },
  });
}
