import { describe, expect, it, vi } from "vitest";

import {
  reconcileGenerationTasksForBrowserSession,
  type GenerationExecutorRegistry,
  type GenerationRunReconciliationStore,
} from "../../src/application/task/generation-task-coordinator";
import { reconcileGenerationRunAfterBackgroundStart } from "../../src/application/generation-runtime-contract";
import { createGenerationRun, type GenerationRun } from "../../src/domain";

function createRun(input: Partial<GenerationRun> = {}): GenerationRun {
  return createGenerationRun({
    branchId: "branch-a",
    browserSessionId: "browser-a",
    completionSequence: null,
    contextRevision: 1,
    createdAt: 1,
    errorCode: null,
    expectedOwnerRevision: 2,
    kind: "chat",
    partialOutput: "saved output",
    runId: "run-a",
    sessionId: "session-a",
    status: "running",
    stopReason: null,
    subtitleId: "subtitle-a",
    targetId: "thread-a",
    taskId: "task-a",
    updatedAt: 2,
    ...input,
  });
}

function createStore(
  runs: readonly GenerationRun[],
): GenerationRunReconciliationStore & {
  readonly runs: GenerationRun[];
} {
  const mutable = [...runs];
  return {
    runs: mutable,
    async applyEvent() {
      return null;
    },
    async begin(run) {
      mutable.push(run);
      return run;
    },
    async listQueuedOrRunning() {
      return mutable.filter(
        (run) => run.status === "queued" || run.status === "running",
      );
    },
    async reconcileAfterBackgroundStart(run, input) {
      const index = mutable.findIndex(
        (candidate) => candidate.runId === run.runId,
      );
      if (index < 0) return null;
      const persisted = reconcileGenerationRunAfterBackgroundStart(
        mutable[index],
        input,
      );
      mutable[index] = persisted;
      return persisted;
    },
    async stopByUser() {
      return null;
    },
  };
}

describe("browser-session generation reconciliation", () => {
  it("only rebinds a same-browser run when an exact live executor exists", async () => {
    const store = createStore([createRun()]);
    const registry: GenerationExecutorRegistry = {
      abort: vi.fn(),
      hasLiveExecutor: vi.fn(async () => true),
      rebind: vi.fn(async () => undefined),
    };

    const result = await reconcileGenerationTasksForBrowserSession({
      browserSessionId: "browser-a",
      executorRegistry: registry,
      now: () => 10,
      store,
    });

    expect(result).toEqual([store.runs[0]]);
    expect(registry.rebind).toHaveBeenCalledWith(store.runs[0]);
    expect(store.runs[0].status).toBe("running");
  });

  it("atomically interrupts same-browser runs with no executor and cross-browser runs without rebind", async () => {
    const sameBrowser = createRun();
    const oldBrowser = createRun({
      browserSessionId: "browser-old",
      runId: "run-old",
      taskId: "task-old",
    });
    const store = createStore([sameBrowser, oldBrowser]);
    const registry: GenerationExecutorRegistry = {
      abort: vi.fn(),
      hasLiveExecutor: vi.fn(async () => false),
      rebind: vi.fn(async () => undefined),
    };

    await reconcileGenerationTasksForBrowserSession({
      browserSessionId: "browser-a",
      executorRegistry: registry,
      now: () => 10,
      store,
    });

    expect(store.runs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          partialOutput: "saved output",
          runId: "run-a",
          status: "interrupted",
          updatedAt: 10,
        }),
        expect.objectContaining({
          partialOutput: "saved output",
          runId: "run-old",
          status: "interrupted",
          updatedAt: 10,
        }),
      ]),
    );
    expect(registry.rebind).not.toHaveBeenCalled();
  });
});
