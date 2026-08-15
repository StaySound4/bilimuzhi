import { describe, expect, it } from "vitest";

import {
  acceptBatchPrepareEvent,
  createAppendBatchPrepareOwner,
} from "../../src/entries/batch-prepare-owner";

describe("batch prepare owner", () => {
  it("accepts progress only for the existing target job and current operation", () => {
    const owner = createAppendBatchPrepareOwner(
      3,
      "job-current",
      "append-operation-3",
    );

    expect(
      acceptBatchPrepareEvent(owner, {
        batchJobId: "job-current",
        operationId: "append-operation-3",
        status: "preparing",
      }),
    ).toEqual({ accepted: true, owner });
    expect(
      acceptBatchPrepareEvent(owner, {
        batchJobId: "job-current",
        operationId: "append-operation-old",
        status: "preparing",
      }).accepted,
    ).toBe(false);
    expect(
      acceptBatchPrepareEvent(owner, {
        batchJobId: "job-other",
        operationId: "append-operation-3",
        status: "preparing",
      }).accepted,
    ).toBe(false);
  });

  it("rejects late append events after cancel or delete unregisters the owner", () => {
    const lateEvent = {
      batchJobId: "job-current",
      operationId: "append-operation-old",
      status: "preparing" as const,
    };

    expect(acceptBatchPrepareEvent(undefined, lateEvent).accepted).toBe(false);
  });
});
