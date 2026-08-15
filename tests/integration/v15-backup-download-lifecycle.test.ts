import { describe, expect, it, vi } from "vitest";

import {
  ChromeBackupDownloadError,
  createChromeBackupDownloadRuntime,
  type ChromeBackupDownloadDelta,
  type ChromeBackupDownloadDependencies,
  type ChromeBackupDownloadItem,
} from "../../src/infrastructure/chrome-backup-download";

type DownloadOutcome =
  | { readonly kind: "fulfilled"; readonly value: unknown }
  | { readonly error: unknown; readonly kind: "rejected" };

function observe(promise: Promise<unknown>): Promise<DownloadOutcome> {
  return promise.then(
    (value) => ({ kind: "fulfilled" as const, value }),
    (error: unknown) => ({ error, kind: "rejected" as const }),
  );
}

function createHarness(input?: {
  readonly download?: () => Promise<number | undefined>;
  readonly search?: (query: {
    readonly id: number;
  }) => Promise<readonly ChromeBackupDownloadItem[]>;
}) {
  let listener: ((delta: ChromeBackupDownloadDelta) => void) | undefined;
  const download = vi.fn(input?.download ?? (async () => 73));
  const search = vi.fn(
    input?.search ??
      (async () => [
        {
          filename: "D:\\Bilimuzhi备份\\v15-complete.json",
          id: 73,
          state: "complete" as const,
        },
      ]),
  );
  const addListener = vi.fn(
    (next: (delta: ChromeBackupDownloadDelta) => void) => {
      listener = next;
    },
  );
  const removeListener = vi.fn();
  const revokeObjectURL = vi.fn();
  const dependencies: ChromeBackupDownloadDependencies = {
    createObjectURL: vi.fn(() => "blob:chrome-extension://muzhi/v15-backup"),
    downloads: {
      download,
      onChanged: { addListener, removeListener },
      search,
      show: vi.fn(async () => undefined),
    },
    revokeObjectURL,
  };
  return {
    addListener,
    dependencies,
    download,
    emit(delta: ChromeBackupDownloadDelta): void {
      listener?.(delta);
    },
    get listener() {
      return listener;
    },
    removeListener,
    revokeObjectURL,
    search,
  };
}

function exportFixture(
  runtime: ReturnType<typeof createChromeBackupDownloadRuntime>,
) {
  return runtime.exportJson({
    fileName: "v15-suggested-name.json",
    json: '{"fixture":"backup"}',
  });
}

describe("v15 Chrome backup saveAs lifecycle (B2-B4)", () => {
  it("queries the DownloadItem after download() so an already-complete item cannot lose the completion event", async () => {
    const harness = createHarness();
    const runtime = createChromeBackupDownloadRuntime(harness.dependencies);

    const pending = exportFixture(runtime);
    await vi.waitFor(() => expect(harness.addListener).toHaveBeenCalledOnce());

    expect.soft(harness.search).toHaveBeenCalledWith({ id: 73 });
    if (harness.search.mock.calls.length === 0) {
      harness.emit({ id: 73, state: { current: "complete" } });
    }
    const result = await pending;

    expect(result).toEqual({
      cancelled: false,
      downloadId: 73,
      filename: "D:\\Bilimuzhi备份\\v15-complete.json",
    });
    expect(harness.download).toHaveBeenCalledWith({
      filename: "v15-suggested-name.json",
      saveAs: true,
      url: "blob:chrome-extension://muzhi/v15-backup",
    });
    expect(harness.removeListener).toHaveBeenCalled();
    expect(harness.revokeObjectURL).toHaveBeenCalledWith(
      "blob:chrome-extension://muzhi/v15-backup",
    );
  });

  it("fails safely after a bounded status-confirmation window when Chrome remains in progress without an event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const rawFilename = "D:\\raw-provider-state\\must-not-leak.json";
    const harness = createHarness({
      search: async () => [
        { filename: rawFilename, id: 73, state: "in_progress" },
      ],
    });
    const runtime = createChromeBackupDownloadRuntime(harness.dependencies);

    try {
      const outcomePromise = observe(exportFixture(runtime));
      await vi.advanceTimersByTimeAsync(30_000);
      const outcome = await Promise.race([
        outcomePromise,
        Promise.resolve({ kind: "pending" as const }),
      ]);

      expect.soft(outcome).toMatchObject({
        error: {
          code: "DOWNLOAD_STATUS_UNCONFIRMED",
          message: expect.any(String),
          name: "ChromeBackupDownloadError",
          retryable: true,
        },
        kind: "rejected",
      });
      expect.soft(JSON.stringify(outcome)).not.toContain(rawFilename);
      expect.soft(harness.removeListener).toHaveBeenCalledOnce();
      expect.soft(harness.revokeObjectURL).toHaveBeenCalledOnce();
      expect(Date.now()).toBe(30_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats an undefined download ID as user cancellation and cleans the object URL without a false success", async () => {
    const harness = createHarness({ download: async () => undefined });
    const runtime = createChromeBackupDownloadRuntime(harness.dependencies);

    await expect(exportFixture(runtime)).resolves.toEqual({ cancelled: true });
    expect(harness.addListener).not.toHaveBeenCalled();
    expect(harness.search).not.toHaveBeenCalled();
    expect(harness.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("treats a USER_CANCELED saveAs rejection as cancellation instead of a download failure", async () => {
    const harness = createHarness({
      download: async () => {
        throw new Error("USER_CANCELED");
      },
    });
    const runtime = createChromeBackupDownloadRuntime(harness.dependencies);

    await expect(exportFixture(runtime)).resolves.toEqual({ cancelled: true });
    expect(harness.addListener).not.toHaveBeenCalled();
    expect(harness.search).not.toHaveBeenCalled();
    expect(harness.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("treats an interrupted DownloadItem with USER_CANCELED as cancellation and releases resources", async () => {
    const harness = createHarness({
      search: async () => [
        {
          error: "USER_CANCELED",
          filename: "",
          id: 73,
          state: "interrupted",
        },
      ],
    });
    const runtime = createChromeBackupDownloadRuntime(harness.dependencies);

    await expect(exportFixture(runtime)).resolves.toEqual({ cancelled: true });
    expect(harness.addListener).toHaveBeenCalledOnce();
    expect(harness.removeListener).toHaveBeenCalledOnce();
    expect(harness.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("re-queries an interrupted event so USER_CANCELED is still treated as cancellation", async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([
        { filename: "", id: 73, state: "in_progress" as const },
      ])
      .mockResolvedValueOnce([
        {
          error: "USER_CANCELED",
          filename: "",
          id: 73,
          state: "interrupted" as const,
        },
      ]);
    const harness = createHarness({ search });
    const runtime = createChromeBackupDownloadRuntime(harness.dependencies);
    const pending = exportFixture(runtime);

    await vi.waitFor(() => expect(harness.listener).toBeTypeOf("function"));
    await vi.waitFor(() => expect(search).toHaveBeenCalledOnce());
    harness.emit({ id: 73, state: { current: "interrupted" } });

    await expect(pending).resolves.toEqual({ cancelled: true });
    expect(search).toHaveBeenCalledTimes(2);
    expect(harness.removeListener).toHaveBeenCalledOnce();
    expect(harness.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "Chrome download rejection",
      () =>
        createHarness({
          download: async () => {
            throw new Error("raw download rejection fixture");
          },
        }),
      "raw download rejection fixture",
    ],
    [
      "DownloadItem status rejection",
      () =>
        createHarness({
          search: async () => {
            throw new Error("raw status rejection fixture");
          },
        }),
      "raw status rejection fixture",
    ],
  ] as const)(
    "maps %s to a stable safe retryable download error and cleans every resource",
    async (_label, create, rawMessage) => {
      const harness = create();
      const runtime = createChromeBackupDownloadRuntime(harness.dependencies);
      const outcomePromise = observe(exportFixture(runtime));

      if (rawMessage.includes("status")) {
        await vi.waitFor(() =>
          expect(harness.addListener).toHaveBeenCalledOnce(),
        );
        if (harness.search.mock.calls.length === 0) {
          harness.emit({ id: 73, state: { current: "complete" } });
        }
      }
      const outcome = await outcomePromise;

      expect.soft(outcome).toMatchObject({
        error: {
          code: expect.any(String),
          message: expect.any(String),
          name: "ChromeBackupDownloadError",
        },
        kind: "rejected",
      });
      if (outcome.kind === "rejected") {
        expect.soft(outcome.error).toBeInstanceOf(ChromeBackupDownloadError);
        expect.soft(String(outcome.error)).not.toContain(rawMessage);
      }
      expect(harness.revokeObjectURL).toHaveBeenCalledOnce();
      if (harness.addListener.mock.calls.length > 0) {
        expect(harness.removeListener).toHaveBeenCalled();
      }
    },
  );

  it.each([
    [
      "interrupted",
      [{ filename: "", id: 73, state: "interrupted" as const }],
      { id: 73, state: { current: "interrupted" as const } },
      "DOWNLOAD_INTERRUPTED",
    ],
    [
      "missing item",
      [],
      { id: 73, state: { current: "complete" as const } },
      "DOWNLOAD_ITEM_MISSING",
    ],
    [
      "missing final path",
      [{ filename: "   ", id: 73, state: "complete" as const }],
      { id: 73, state: { current: "complete" as const } },
      "DOWNLOAD_PATH_MISSING",
    ],
  ] as const)(
    "settles %s distinctly and releases its listener and object URL",
    async (_label, items, delta, expectedCode) => {
      const harness = createHarness({ search: async () => items });
      const runtime = createChromeBackupDownloadRuntime(harness.dependencies);
      const outcomePromise = observe(exportFixture(runtime));

      await vi.waitFor(() => expect(harness.listener).toBeTypeOf("function"));
      if (harness.search.mock.calls.length === 0) harness.emit(delta);
      const outcome = await outcomePromise;

      expect(outcome).toMatchObject({
        error: { code: expectedCode },
        kind: "rejected",
      });
      expect(harness.removeListener).toHaveBeenCalled();
      expect(harness.revokeObjectURL).toHaveBeenCalledOnce();
    },
  );
});
