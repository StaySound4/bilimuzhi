import { describe, expect, it } from "vitest";

import { createGenerationRun } from "../../src/domain";
import { stopActiveGenerationRun } from "../../src/infrastructure/indexeddb/generation-run-stopping";

function inflightRun(status: string) {
  const completed = status === "completed";
  const failed = status === "failed";
  return createGenerationRun({
    branchId: "branch-1",
    browserSessionId: "browser",
    completionSequence: completed ? 1 : null,
    contextRevision: 1,
    createdAt: 100,
    errorCode: failed ? "PROVIDER_ERROR" : null,
    expectedOwnerRevision: 0,
    kind: "summary",
    partialOutput: "",
    runId: "run-1",
    sessionId: "session-1",
    status: status as never,
    stopReason: status === "stopped" ? ("user" as const) : null,
    subtitleId: "subtitle-1",
    targetId: "target-1",
    taskId: "task-1",
    updatedAt: 100,
  });
}

describe("stopActiveGenerationRun", () => {
  it("stops every in-flight status with the owner-deleted reason", () => {
    for (const status of [
      "queued",
      "running",
      "preparing",
      "requesting",
      "streaming",
      "validating",
      "saving",
    ]) {
      const stopped = stopActiveGenerationRun(inflightRun(status), 200);
      expect(stopped).not.toBeNull();
      expect(stopped).toMatchObject({
        status: "stopped",
        stopReason: "owner-deleted",
      });
    }
  });

  it("leaves terminal statuses untouched", () => {
    for (const status of [
      "stopped",
      "cancelled",
      "completed",
      "interrupted",
      "failed",
    ]) {
      expect(stopActiveGenerationRun(inflightRun(status), 200)).toBeNull();
    }
  });
});
