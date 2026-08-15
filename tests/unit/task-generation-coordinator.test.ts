import { describe, expect, it, vi } from "vitest";

import {
  GenerationTaskConflictError,
  createGenerationTaskCoordinator,
  type GenerationExecutorRegistry,
  type GenerationRunStore,
} from "../../src/application/task/generation-task-coordinator";
import {
  canApplyGenerationRuntimeEvent,
  type GenerationRuntimeEvent,
} from "../../src/application/generation-runtime-contract";
import {
  createGenerationRun,
  type GenerationRun,
  type TaskOwner,
} from "../../src/domain";

const owner: TaskOwner = {
  branchId: "branch-a",
  contextRevision: 2,
  expectedOwnerRevision: 3,
  kind: "chat",
  sessionId: "session-a",
  subtitleId: "subtitle-a",
  targetId: "thread-a",
  taskId: "task-a",
};

function hasSameOwner(left: TaskOwner, right: TaskOwner): boolean {
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

function createStore(
  initial: readonly GenerationRun[] = [],
): GenerationRunStore & {
  readonly runs: GenerationRun[];
} {
  const runs = [...initial];
  return {
    runs,
    async applyEvent(event, now) {
      const index = runs.findIndex((run) => run.taskId === event.taskId);
      if (index < 0 || !canApplyGenerationRuntimeEvent(runs[index], event)) {
        return null;
      }
      const run = runs[index];
      switch (event.type) {
        case "muzhi.generation.reasoning":
          return null;
        case "muzhi.generation.delta":
          runs[index] = createGenerationRun({
            ...run,
            partialOutput: `${run.partialOutput}${event.payload.delta}`,
            updatedAt: Math.max(now, run.updatedAt),
          });
          return runs[index];
        case "muzhi.generation.completed":
          // The repository owns durable completion ordering; event values are not authoritative.
          runs[index] = createGenerationRun({
            ...run,
            completionSequence: 77,
            partialOutput: event.payload.output,
            status: "completed",
            updatedAt: Math.max(now, run.updatedAt),
          });
          return runs[index];
        default:
          runs[index] = createGenerationRun({
            ...run,
            status: "running",
            updatedAt: Math.max(now, run.updatedAt),
          });
          return runs[index];
      }
    },
    async begin(run) {
      const sameTask = runs.find(
        (candidate) => candidate.taskId === run.taskId,
      );
      if (sameTask !== undefined) {
        if (hasSameOwner(sameTask, run)) return sameTask;
        throw new GenerationTaskConflictError(
          "The generation task ID belongs to another owner",
        );
      }
      if (
        runs.some(
          (candidate) =>
            (candidate.status === "queued" || candidate.status === "running") &&
            hasSameActiveOwner(candidate, run),
        )
      ) {
        throw new GenerationTaskConflictError(
          "The generation owner already has an active task",
        );
      }
      runs.push(run);
      return run;
    },
    async stopByUser(inputOwner, now) {
      const index = runs.findIndex((run) => run.taskId === inputOwner.taskId);
      if (
        index < 0 ||
        !hasSameOwner(runs[index], inputOwner) ||
        (runs[index].status !== "queued" && runs[index].status !== "running")
      ) {
        return null;
      }
      const stopped = createGenerationRun({
        ...runs[index],
        status: "stopped",
        stopReason: "user",
        updatedAt: Math.max(now, runs[index].updatedAt),
      });
      runs[index] = stopped;
      return stopped;
    },
  };
}

function createRegistry(): GenerationExecutorRegistry & {
  readonly abort: ReturnType<typeof vi.fn>;
} {
  return {
    abort: vi.fn(async () => undefined),
  };
}

function generationEvent(
  event: Omit<GenerationRuntimeEvent, keyof TaskOwner>,
): GenerationRuntimeEvent {
  return { ...owner, ...event } as GenerationRuntimeEvent;
}

describe("generation task coordinator", () => {
  it("replays the same task and owner but rejects a task replay with a different owner", async () => {
    const store = createStore();
    const coordinator = createGenerationTaskCoordinator({
      browserSessionId: "browser-a",
      createRunId: () => "run-a",
      executorRegistry: createRegistry(),
      now: () => 10,
      store,
    });

    const first = await coordinator.start(owner);
    const replay = await coordinator.start(owner);
    expect(replay).toBe(first);
    expect(store.runs).toHaveLength(1);

    await expect(
      coordinator.start({ ...owner, branchId: "branch-other" }),
    ).rejects.toBeInstanceOf(GenerationTaskConflictError);
  });

  it("coalesces concurrent replays before the durable task record exists", async () => {
    const store = createStore();
    const coordinator = createGenerationTaskCoordinator({
      browserSessionId: "browser-a",
      createRunId: () => "run-a",
      executorRegistry: createRegistry(),
      now: () => 10,
      store,
    });

    const [first, replay] = await Promise.all([
      coordinator.start(owner),
      coordinator.start(owner),
    ]);

    expect(replay).toBe(first);
    expect(store.runs).toHaveLength(1);
  });

  it("rejects a second active task for the exact active owner key", async () => {
    const store = createStore();
    const coordinator = createGenerationTaskCoordinator({
      browserSessionId: "browser-a",
      createRunId: () => "run-a",
      executorRegistry: createRegistry(),
      now: () => 10,
      store,
    });
    await coordinator.start(owner);

    await expect(
      coordinator.start({ ...owner, taskId: "task-b" }),
    ).rejects.toBeInstanceOf(GenerationTaskConflictError);
  });

  it("waits for atomic stopped/user persistence before attempting a best-effort executor abort", async () => {
    const store = createStore();
    const events: string[] = [];
    const registry: GenerationExecutorRegistry = {
      async abort() {
        events.push("abort");
      },
    };
    const coordinator = createGenerationTaskCoordinator({
      browserSessionId: "browser-a",
      createRunId: () => "run-a",
      executorRegistry: registry,
      now: () => 10,
      store: {
        ...store,
        async stopByUser(inputOwner, now) {
          const persisted = await store.stopByUser(inputOwner, now);
          if (persisted !== null) events.push("persist:stopped:user");
          return persisted;
        },
      },
    });
    await coordinator.start(owner);

    await coordinator.stop(owner);

    expect(events).toEqual(["persist:stopped:user", "abort"]);
    expect(store.runs[0]).toMatchObject({
      status: "stopped",
      stopReason: "user",
    });
  });

  it("delegates event compare-and-commit to the store, discarding reasoning and payload completion sequence", async () => {
    const store = createStore();
    const coordinator = createGenerationTaskCoordinator({
      browserSessionId: "browser-a",
      createRunId: () => "run-a",
      executorRegistry: createRegistry(),
      now: () => 10,
      store,
    });
    await coordinator.start(owner);

    expect(
      await coordinator.applyEvent(
        generationEvent({
          payload: { text: "private reasoning" },
          protocolVersion: 1,
          requestId: "request-a",
          type: "muzhi.generation.reasoning",
        }),
      ),
    ).toBeNull();
    expect(store.runs[0].partialOutput).toBe("");

    await coordinator.applyEvent(
      generationEvent({
        payload: { completionSequence: 1, output: "visible result" },
        protocolVersion: 1,
        requestId: "request-b",
        type: "muzhi.generation.completed",
      }),
    );
    expect(store.runs[0]).toMatchObject({
      completionSequence: 77,
      partialOutput: "visible result",
      status: "completed",
    });

    expect(
      await coordinator.applyEvent(
        generationEvent({
          payload: { delta: "late" },
          protocolVersion: 1,
          requestId: "request-c",
          type: "muzhi.generation.delta",
        }),
      ),
    ).toBeNull();
    expect(store.runs[0].partialOutput).toBe("visible result");
  });

  it("drops a late event when its owner has already been deleted", async () => {
    const coordinator = createGenerationTaskCoordinator({
      browserSessionId: "browser-a",
      createRunId: () => "run-a",
      executorRegistry: createRegistry(),
      now: () => 10,
      store: createStore(),
    });

    await expect(
      coordinator.applyEvent(
        generationEvent({
          payload: { delta: "late" },
          protocolVersion: 1,
          requestId: "request-deleted",
          type: "muzhi.generation.delta",
        }),
      ),
    ).resolves.toBeNull();
  });
});
