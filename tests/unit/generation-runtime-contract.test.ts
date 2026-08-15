import { describe, expect, it } from "vitest";

import {
  GENERATION_RUNTIME_PROTOCOL_VERSION,
  canApplyGenerationRuntimeEvent,
  isGenerationRuntimeEvent,
  reconcileGenerationRunAfterBackgroundStart,
} from "../../src/application/generation-runtime-contract";
import { createTrashRetentionSetting } from "../../src/application/settings-contract";
import { createGenerationRun } from "../../src/domain";

interface V11GenerationSnapshot {
  readonly contextHash: string | null;
  readonly conversationRevision: number;
  readonly modelHash: string | null;
  readonly promptHash: string | null;
  readonly runRevision: number;
}

type V11GenerationRun = ReturnType<typeof createGenerationRun> &
  V11GenerationSnapshot;

const SNAPSHOT = Object.freeze({
  contextHash:
    "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  conversationRevision: 4,
  modelHash:
    "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  promptHash:
    "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  runRevision: 2,
});

const owner = {
  branchId: "branch-b",
  contextRevision: 2,
  expectedOwnerRevision: 4,
  kind: "chat" as const,
  sessionId: "session-b",
  subtitleId: "subtitle-b",
  targetId: "thread-b",
  taskId: "task-b",
};

const deltaEvent = {
  ...owner,
  payload: { delta: "持续输出" },
  protocolVersion: GENERATION_RUNTIME_PROTOCOL_VERSION,
  requestId: "request-b",
  type: "muzhi.generation.delta" as const,
};

function createRunningRun() {
  return createGenerationRun({
    ...owner,
    browserSessionId: "browser-session-b",
    completionSequence: null,
    createdAt: 1,
    errorCode: null,
    partialOutput: "已有输出",
    runId: "run-b",
    status: "running",
    stopReason: null,
    updatedAt: 2,
  });
}

describe("generation runtime contract", () => {
  it.each(["preparing", "requesting", "streaming", "validating", "saving"])(
    "accepts the persisted non-terminal %s phase as authoritative",
    (status) => {
      expect(
        isGenerationRuntimeEvent({
          ...owner,
          payload: { status },
          protocolVersion: GENERATION_RUNTIME_PROTOCOL_VERSION,
          requestId: `request-${status}`,
          type: "muzhi.generation.status",
        }),
      ).toBe(true);
    },
  );

  it("accepts complete owner-correlated events and rejects unknown event fields", () => {
    expect(isGenerationRuntimeEvent(deltaEvent)).toBe(true);
    expect(isGenerationRuntimeEvent({ ...deltaEvent, unexpected: true })).toBe(
      false,
    );
    expect(
      isGenerationRuntimeEvent({
        ...deltaEvent,
        payload: { completionSequence: 1, output: "完成" },
        type: "muzhi.generation.completed",
      }),
    ).toBe(true);
  });

  it("rejects late events when owner revision, target, or run status changed", () => {
    const running = createRunningRun();
    expect(canApplyGenerationRuntimeEvent(running, deltaEvent)).toBe(true);
    expect(
      canApplyGenerationRuntimeEvent(running, {
        ...deltaEvent,
        expectedOwnerRevision: 3,
      }),
    ).toBe(false);
    expect(
      canApplyGenerationRuntimeEvent(
        createGenerationRun({
          ...running,
          completionSequence: 1,
          status: "completed",
          updatedAt: 3,
        }),
        deltaEvent,
      ),
    ).toBe(false);
  });

  it("captures only safe prompt/model/context hashes plus conversation and run revisions", () => {
    const run = createGenerationRun({
      ...createRunningRun(),
      ...SNAPSHOT,
      prompt: "SYSTEM PROMPT with sk-secret-value",
    } as Parameters<typeof createGenerationRun>[0]) as V11GenerationRun;

    expect(run).toMatchObject(SNAPSHOT);
    expect(JSON.stringify(run)).not.toContain("SYSTEM PROMPT");
    expect(JSON.stringify(run)).not.toContain("sk-secret-value");
  });

  it("reuses the exact safe snapshot across retry/continue while incrementing only run revision", () => {
    const original = createGenerationRun({
      ...createRunningRun(),
      ...SNAPSHOT,
    } as Parameters<typeof createGenerationRun>[0]) as V11GenerationRun;
    const retry = createGenerationRun({
      ...original,
      completionSequence: null,
      errorCode: null,
      runId: "run-retry",
      runRevision: original.runRevision + 1,
      status: "queued",
      stopReason: null,
      updatedAt: 3,
    } as Parameters<typeof createGenerationRun>[0]) as V11GenerationRun;

    expect(retry).toMatchObject({
      contextHash: original.contextHash,
      conversationRevision: original.conversationRevision,
      modelHash: original.modelHash,
      promptHash: original.promptHash,
      runRevision: 3,
    });
  });

  it.each([
    [
      "promptHash",
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ],
    [
      "modelHash",
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ],
    [
      "contextHash",
      "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ],
    ["conversationRevision", 3],
    ["runRevision", 1],
  ] as const)(
    "rejects a late event whose captured %s no longer matches the run snapshot",
    (field, staleValue) => {
      const run = createGenerationRun({
        ...createRunningRun(),
        ...SNAPSHOT,
      } as Parameters<typeof createGenerationRun>[0]) as V11GenerationRun;
      const matching = { ...deltaEvent, ...SNAPSHOT };
      const stale = { ...matching, [field]: staleValue };

      expect(
        canApplyGenerationRuntimeEvent(
          run,
          matching as unknown as Parameters<
            typeof canApplyGenerationRuntimeEvent
          >[1],
        ),
      ).toBe(true);
      expect(
        canApplyGenerationRuntimeEvent(
          run,
          stale as unknown as Parameters<
            typeof canApplyGenerationRuntimeEvent
          >[1],
        ),
      ).toBe(false);
    },
  );

  it("normalizes a legacy run without snapshot fields to non-secret compatibility defaults", () => {
    const legacy = createRunningRun() as V11GenerationRun;

    expect(legacy).toMatchObject({
      contextHash: null,
      conversationRevision: legacy.expectedOwnerRevision,
      modelHash: null,
      promptHash: null,
      runRevision: 0,
    });
  });

  it("keeps a live same-browser executor and interrupts orphaned runs without losing output", () => {
    const running = createRunningRun();
    expect(
      reconcileGenerationRunAfterBackgroundStart(running, {
        browserSessionId: "browser-session-b",
        hasLiveExecutor: true,
        now: 10,
      }),
    ).toBe(running);

    expect(
      reconcileGenerationRunAfterBackgroundStart(running, {
        browserSessionId: "browser-session-new",
        hasLiveExecutor: false,
        now: 10,
      }),
    ).toMatchObject({
      partialOutput: "已有输出",
      status: "interrupted",
      updatedAt: 10,
    });
  });

  it("normalizes only the versioned trash-retention setting", () => {
    expect(
      createTrashRetentionSetting({
        key: "trashRetention",
        policy: { durationDays: 365, kind: "duration" },
        updatedAt: 10,
      }),
    ).toEqual({
      key: "trashRetention",
      policy: { durationDays: 365, kind: "duration" },
      updatedAt: 10,
    });
    expect(() =>
      createTrashRetentionSetting({
        key: "other" as "trashRetention",
        policy: { kind: "forever" },
        updatedAt: 10,
      }),
    ).toThrow(/setting key/i);
  });
});
