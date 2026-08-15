import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runBatchCommand,
  type BatchCommandRunnerHooks,
} from "../../src/ui/batch/batch-command-runner";

function createHooks() {
  let busy = false;
  let errorMessage: string | undefined;
  let statusMessage: string | undefined;
  const rendered: number[] = [];
  const hooks: BatchCommandRunnerHooks = {
    isBusy: () => busy,
    onError: (message) => {
      errorMessage = message;
    },
    onRender: () => {
      rendered.push(rendered.length);
    },
    onStatus: (message) => {
      statusMessage = message;
    },
    setBusy: (value) => {
      busy = value;
    },
  };
  return {
    hooks,
    snapshot: () => ({
      busy,
      errorMessage,
      rendered: rendered.length,
      statusMessage,
    }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runBatchCommand", () => {
  it("releases busy and reports success on the happy path", async () => {
    const { hooks, snapshot } = createHooks();
    const result = await runBatchCommand(hooks, async () => undefined, {
      errorText: "失败了",
      successText: "成功了",
      timeoutMs: 10_000,
      timeoutText: "超时了",
    });
    expect(result).toBe(true);
    expect(snapshot()).toMatchObject({
      busy: false,
      errorMessage: undefined,
      statusMessage: "成功了",
    });
    expect(snapshot().rendered).toBeGreaterThanOrEqual(2);
  });

  it("releases busy and surfaces the failure text on rejection", async () => {
    const { hooks, snapshot } = createHooks();
    const result = await runBatchCommand(
      hooks,
      async () => {
        throw new Error("boom");
      },
      {
        errorText: "失败了",
        timeoutMs: 10_000,
        timeoutText: "超时了",
      },
    );
    expect(result).toBe(false);
    expect(snapshot()).toMatchObject({
      busy: false,
      errorMessage: "失败了",
      statusMessage: undefined,
    });
  });

  it("prefers a mapped error text when the action throws a typed error", async () => {
    const { hooks, snapshot } = createHooks();
    const result = await runBatchCommand(
      hooks,
      async () => {
        throw Object.assign(new Error("specific"), { code: "SPECIFIC" });
      },
      {
        errorText: (error) =>
          (error as { code?: string }).code === "SPECIFIC"
            ? "具体错误"
            : "通用错误",
        timeoutMs: 10_000,
        timeoutText: "超时了",
      },
    );
    expect(result).toBe(false);
    expect(snapshot().errorMessage).toBe("具体错误");
  });

  it("releases busy and shows the timeout text when the action hangs", async () => {
    const { hooks, snapshot } = createHooks();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resultPromise = runBatchCommand(hooks, () => pending, {
      errorText: "失败了",
      timeoutMs: 10_000,
      timeoutText: "超时了",
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(snapshot().busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    const result = await resultPromise;
    expect(result).toBe(false);
    expect(snapshot()).toMatchObject({
      busy: false,
      errorMessage: "超时了",
    });
    release();
  });

  it("releases busy exactly once when the action settles after the timeout", async () => {
    const { hooks, snapshot } = createHooks();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resultPromise = runBatchCommand(hooks, () => pending, {
      errorText: "失败了",
      timeoutMs: 5_000,
      timeoutText: "超时了",
    });
    await vi.advanceTimersByTimeAsync(5_001);
    expect(await resultPromise).toBe(false);
    const afterTimeout = snapshot();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(snapshot()).toEqual(afterTimeout);
    expect(snapshot().busy).toBe(false);
  });

  it("refuses to start while busy", async () => {
    const { hooks } = createHooks();
    hooks.setBusy(true);
    const action = vi.fn(async () => undefined);
    const result = await runBatchCommand(hooks, action, {
      errorText: "失败了",
      timeoutMs: 10_000,
      timeoutText: "超时了",
    });
    expect(result).toBe(false);
    expect(action).not.toHaveBeenCalled();
  });

  it("runs a forced command even while busy (delete must interrupt preparation)", async () => {
    const { hooks, snapshot } = createHooks();
    hooks.setBusy(true);
    const action = vi.fn(async () => undefined);
    const result = await runBatchCommand(hooks, action, {
      errorText: "失败了",
      force: true,
      successText: "删除了",
      timeoutMs: 10_000,
      timeoutText: "超时了",
    });
    expect(result).toBe(true);
    expect(action).toHaveBeenCalledOnce();
    expect(snapshot()).toMatchObject({ busy: false, statusMessage: "删除了" });
  });

  it("waits indefinitely when no timeout is configured (prepare/start stay pending)", async () => {
    const { hooks, snapshot } = createHooks();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const resultPromise = runBatchCommand(hooks, () => pending, {
      errorText: "失败了",
      timeoutText: "超时了",
    });
    // 远超默认 10s 也不超时：prepare 解析 104 个分 P 必须保持等待。
    await vi.advanceTimersByTimeAsync(120_000);
    expect(snapshot().busy).toBe(true);
    release();
    expect(await resultPromise).toBe(true);
    expect(snapshot().busy).toBe(false);
  });
});
