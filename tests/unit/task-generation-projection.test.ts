import { describe, expect, it } from "vitest";

import {
  advanceGenerationBranchReadCursor,
  createGenerationTaskProjection,
} from "../../src/application/task/generation-projection";
import {
  createGenerationRun,
  createSession,
  createSubtitleBranch,
} from "../../src/domain";

const videoKey = "bvid:BV1xx411c7mD:cid:12:p:1" as const;

function createBranch(
  input: Partial<ReturnType<typeof createSubtitleBranch>> = {},
) {
  return createSubtitleBranch({
    activeSubtitleId: "subtitle-a",
    branchId: "branch-a",
    completionSequence: 2,
    contextRevision: 1,
    createdAt: 1,
    detectedLanguage: null,
    language: "en",
    lastOpenedAt: 1,
    lastReadCompletionSequence: 1,
    lastSelectedAt: 1,
    requestedLanguageMode: null,
    sessionId: "session-a",
    source: "bilibili",
    title: null,
    updatedAt: 1,
    videoKey,
    ...input,
  });
}

function createRun() {
  return createGenerationRun({
    branchId: "branch-a",
    browserSessionId: "browser-a",
    completionSequence: null,
    contextRevision: 1,
    createdAt: 1,
    errorCode: null,
    expectedOwnerRevision: 1,
    kind: "chat",
    partialOutput: "",
    runId: "run-a",
    sessionId: "session-a",
    status: "running",
    stopReason: null,
    subtitleId: "subtitle-a",
    targetId: "thread-a",
    taskId: "task-a",
    updatedAt: 1,
  });
}

describe("generation task projection", () => {
  it.each(["preparing", "requesting", "streaming", "validating", "saving"])(
    "keeps the exact persisted %s phase visibly non-terminal",
    (status) => {
      const branch = createBranch();
      const session = createSession({
        activeBranchId: "branch-a",
        createdAt: 1,
        customTitle: false,
        lastActivityAt: 1,
        selectionRevision: 1,
        sessionId: "session-a",
        title: "Video",
        updatedAt: 1,
        videoKey,
      });
      const run = createGenerationRun({
        ...createRun(),
        status: status as Parameters<typeof createGenerationRun>[0]["status"],
      });

      expect(
        createGenerationTaskProjection({
          branches: [branch],
          runs: [run],
          sessions: [session],
        }).sessions[0],
      ).toMatchObject({ running: true, sessionId: "session-a" });
    },
  );

  it("derives running and unread at the exact Branch, then aggregates only at Session", () => {
    const branch = createBranch();
    const session = createSession({
      activeBranchId: "branch-a",
      createdAt: 1,
      customTitle: false,
      lastActivityAt: 1,
      selectionRevision: 1,
      sessionId: "session-a",
      title: "Video",
      updatedAt: 1,
      videoKey,
    });

    const projection = createGenerationTaskProjection({
      branches: [branch],
      runs: [createRun()],
      sessions: [session],
    });

    expect(projection.branches).toEqual([
      expect.objectContaining({
        branchId: "branch-a",
        running: true,
        unread: true,
      }),
    ]);
    expect(projection.sessions).toEqual([
      expect.objectContaining({
        sessionId: "session-a",
        running: true,
        unread: true,
      }),
    ]);
  });

  it("only advances the read cursor for the exact entered Branch and never mutates Session state", () => {
    const branch = createBranch();
    const read = advanceGenerationBranchReadCursor(branch, {
      branchId: "branch-a",
      now: 10,
      sessionId: "session-a",
    });
    expect(read).toMatchObject({
      completionSequence: 2,
      lastReadCompletionSequence: 2,
      updatedAt: 10,
    });
    expect(branch.lastReadCompletionSequence).toBe(1);
    expect(() =>
      advanceGenerationBranchReadCursor(branch, {
        branchId: "branch-other",
        now: 10,
        sessionId: "session-a",
      }),
    ).toThrow(/exact branch/i);
  });
});
