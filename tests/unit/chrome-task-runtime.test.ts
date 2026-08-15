import { describe, expect, it } from "vitest";

import type { GenerationRunReconciliationStore } from "../../src/application/task";
import {
  createGenerationRun,
  type GenerationRun,
  type TaskOwner,
} from "../../src/domain";
import { createChromeTaskRuntime } from "../../src/infrastructure/chrome-task-runtime";

function createChromeSessionStorage() {
  const values = new Map<string, unknown>();
  return {
    chrome: {
      storage: {
        session: {
          async get(key: string): Promise<Record<string, unknown>> {
            return values.has(key) ? { [key]: values.get(key) } : {};
          },
          async set(items: Record<string, unknown>): Promise<void> {
            for (const [key, value] of Object.entries(items))
              values.set(key, value);
          },
        },
      },
    },
    values,
  };
}

const owner: TaskOwner = {
  branchId: "branch-a",
  contextRevision: 1,
  expectedOwnerRevision: 0,
  kind: "chat",
  sessionId: "session-a",
  subtitleId: "subtitle-a",
  targetId: "thread-a",
  taskId: "task-a",
};

function createRun(input: Partial<GenerationRun> = {}): GenerationRun {
  return createGenerationRun({
    ...owner,
    browserSessionId: "browser-session-a",
    completionSequence: null,
    createdAt: 1,
    errorCode: null,
    partialOutput: "saved",
    runId: "run-a",
    status: "running",
    stopReason: null,
    updatedAt: 1,
    ...input,
  });
}

describe("Chrome task runtime", () => {
  it("persists a browser-session identifier in chrome.storage.session and creates a new value after session storage clears", async () => {
    const { chrome, values } = createChromeSessionStorage();
    const generated = ["browser-session-a", "browser-session-b"];
    const runtime = createChromeTaskRuntime(chrome, {
      createBrowserSessionId: () => generated.shift() ?? "unexpected",
    });
    await expect(runtime.getBrowserSessionId()).resolves.toBe(
      "browser-session-a",
    );
    await expect(runtime.getBrowserSessionId()).resolves.toBe(
      "browser-session-a",
    );
    values.clear();
    await expect(runtime.getBrowserSessionId()).resolves.toBe(
      "browser-session-b",
    );
  });

  it("uses the full generation owner for rebind and abort leases", async () => {
    const { chrome } = createChromeSessionStorage();
    const runtime = createChromeTaskRuntime(chrome, {
      createBrowserSessionId: () => "browser-session-a",
    });
    const calls: string[] = [];
    const unregister = runtime.executors.register({
      abort: () => {
        calls.push("abort");
      },
      owner,
      rebind: () => {
        calls.push("rebind");
      },
    });
    const run = createRun();

    expect(await runtime.executors.hasLiveExecutor?.(run)).toBe(true);
    await runtime.executors.rebind?.(run);
    await runtime.executors.abort(owner);
    expect(calls).toEqual(["rebind", "abort"]);

    unregister();
    expect(await runtime.executors.hasLiveExecutor?.(run)).toBe(false);
  });

  it("reconciles each persisted candidate through the application owner registry", async () => {
    const { chrome } = createChromeSessionStorage();
    const runtime = createChromeTaskRuntime(chrome, {
      createBrowserSessionId: () => "browser-session-a",
    });
    const live = createRun();
    const orphan = createRun({
      browserSessionId: "browser-session-old",
      runId: "run-old",
      taskId: "task-old",
    });
    runtime.executors.register({
      abort: () => undefined,
      owner,
      rebind: () => undefined,
    });
    const runs = new Map([
      [live.runId, live],
      [orphan.runId, orphan],
    ]);
    const store: GenerationRunReconciliationStore = {
      async applyEvent() {
        return null;
      },
      async begin(run) {
        runs.set(run.runId, run);
        return run;
      },
      async listQueuedOrRunning() {
        return [...runs.values()];
      },
      async reconcileAfterBackgroundStart(run, input) {
        const current = runs.get(run.runId);
        if (current === undefined) return null;
        const next =
          current.browserSessionId === input.browserSessionId &&
          input.hasLiveExecutor
            ? current
            : createGenerationRun({
                ...current,
                status: "interrupted",
                updatedAt: input.now,
              });
        runs.set(next.runId, next);
        return next;
      },
      async stopByUser() {
        return null;
      },
    };

    await expect(
      runtime.reconcileAfterBackgroundStart(store, 123),
    ).resolves.toEqual([
      live,
      expect.objectContaining({
        partialOutput: "saved",
        runId: "run-old",
        status: "interrupted",
        updatedAt: 123,
      }),
    ]);
  });
});
