import { describe, expect, it } from "vitest";

import { resolveTrashRestoreIntents } from "../../src/application/trash-restore-intents";

describe("resolveTrashRestoreIntents", () => {
  it("restores every branch to the workspace regardless of its trash origin", () => {
    const intents = [
      { branchId: "branch-1", kind: "branch", originKind: "workspace" },
      { branchId: "branch-2", kind: "branch", originKind: "archive" },
      {
        branchId: "branch-3",
        kind: "branch",
        originKind: "archive",
        originLabel: "归档 / 课程",
      },
    ] as const;

    expect(resolveTrashRestoreIntents(intents)).toEqual({
      branchIds: ["branch-1", "branch-2", "branch-3"],
      emptySessionIds: [],
    });
  });

  it("restores empty sessions to the workspace alongside branches", () => {
    const intents = [
      { branchId: "branch-1", kind: "branch", originKind: "archive" },
      { kind: "session", sessionId: "session-1" },
      { kind: "session", sessionId: "session-2" },
    ] as const;

    expect(resolveTrashRestoreIntents(intents)).toEqual({
      branchIds: ["branch-1"],
      emptySessionIds: ["session-1", "session-2"],
    });
  });

  it("returns empty groups for an empty intent list", () => {
    expect(resolveTrashRestoreIntents([])).toEqual({
      branchIds: [],
      emptySessionIds: [],
    });
  });
});
