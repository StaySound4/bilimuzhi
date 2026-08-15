import { describe, expect, it, vi } from "vitest";

import {
  changeSurfaceAfterClearingBatchSelection,
  clearBatchSelectionForSurfaceChange,
  selectBatchJobAfterClearingPrevious,
} from "../../src/entries/batch-selection-transition";

describe("batch selection transitions", () => {
  it("clears the previous list before reading the next list without clearing the next list", async () => {
    const calls: string[] = [];
    const client = {
      read: vi.fn(async (batchJobId: string) => {
        calls.push(`read:${batchJobId}`);
        return { job: { batchJobId } } as never;
      }),
      setSelection: vi.fn(
        async (batchJobId: string, ids: readonly string[]) => {
          calls.push(`clear:${batchJobId}:${ids.length}`);
          return null;
        },
      ),
    };

    await selectBatchJobAfterClearingPrevious(client, "job-old", "job-new");

    expect(calls).toEqual(["clear:job-old:0", "read:job-new"]);
    expect(client.setSelection).not.toHaveBeenCalledWith("job-new", []);
  });

  it("awaits current selection clearing before changing surface", async () => {
    const calls: string[] = [];
    let release!: () => void;
    const persistence = new Promise<void>((resolve) => {
      release = resolve;
    });
    const setSelection = vi.fn(async () => {
      calls.push("clear:start");
      await persistence;
      calls.push("clear:done");
      return null;
    });

    const transition = changeSurfaceAfterClearingBatchSelection(
      { setSelection },
      "job-current",
      () => calls.push("surface:changed"),
    );
    await Promise.resolve();
    expect(calls).toEqual(["clear:start"]);

    release();
    await transition;
    expect(calls).toEqual(["clear:start", "clear:done", "surface:changed"]);
  });

  it("does not change surface when clearing selection fails", async () => {
    const changeSurface = vi.fn();
    const failure = new Error("selection failed");

    await expect(
      changeSurfaceAfterClearingBatchSelection(
        { setSelection: vi.fn(async () => Promise.reject(failure)) },
        "job-current",
        changeSurface,
      ),
    ).rejects.toBe(failure);
    expect(changeSurface).not.toHaveBeenCalled();
  });

  it("clears the current batch list when leaving its surface", async () => {
    const setSelection = vi.fn(async () => null);

    await clearBatchSelectionForSurfaceChange({ setSelection }, "job-current");

    expect(setSelection).toHaveBeenCalledWith("job-current", []);
  });
});
