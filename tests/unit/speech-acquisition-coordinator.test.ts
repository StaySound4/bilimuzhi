import { describe, expect, it, vi } from "vitest";

import {
  createSpeechAcquisitionCoordinator,
  type SpeechAcquisitionRecord,
  type SpeechAcquisitionStore,
} from "../../src/application/asr/speech-acquisition-coordinator";
import { createVideoRef } from "../../src/domain";

const video = createVideoRef({
  bvid: "BV1Q541167Qg",
  canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
  cid: 30_000_000_001,
  page: 1,
  title: "语音测试",
});

const parameters = Object.freeze({
  model: "whisper-large-v3",
  provider: "groq" as const,
  requestedLanguageMode: "mixed" as const,
  routingMode: "balanced" as const,
});

function createStore(seed: readonly SpeechAcquisitionRecord[] = []) {
  const records = new Map(seed.map((record) => [record.owner.taskId, record]));
  const store: SpeechAcquisitionStore = {
    begin: vi.fn(async (record) => {
      records.set(record.owner.taskId, { ...record, status: "running" });
      return records.get(record.owner.taskId)!;
    }),
    finish: vi.fn(async (owner, input) => {
      const current = records.get(owner.taskId);
      if (!current) return null;
      const updated = {
        ...current,
        errorCode: input.status === "failed" ? input.errorCode : null,
        status: input.status,
        updatedAt: input.now,
      } as SpeechAcquisitionRecord;
      records.set(owner.taskId, updated);
      return updated;
    }),
    get: vi.fn(async (owner) => records.get(owner.taskId) ?? null),
    listActive: vi.fn(async () =>
      [...records.values()].filter(
        (record) => record.status === "queued" || record.status === "running",
      ),
    ),
    updateCheckpoint: vi.fn(async (owner, input) => {
      const current = records.get(owner.taskId);
      if (!current) return null;
      const updated = {
        ...current,
        checkpoint: input.checkpoint,
        progress: input.progress,
        updatedAt: input.now,
      };
      records.set(owner.taskId, updated);
      return updated;
    }),
  };
  return { records, store };
}

function createCoordinator(
  store: SpeechAcquisitionStore,
  executor: Parameters<
    typeof createSpeechAcquisitionCoordinator
  >[0]["executor"],
  browserSessionId = "browser-1",
  inactivityTimeoutMs?: number,
) {
  return createSpeechAcquisitionCoordinator({
    browserSessionId,
    createAcquisitionId: () => "acquisition-1",
    createDraftBranchId: () => "branch-1",
    createTaskId: () => "task-1",
    executor,
    now: () => 2_000,
    readOwnerContext: async () => ({
      expectedContextRevision: 1,
      expectedSelectionRevision: 4,
      sessionId: "session-1",
    }),
    store,
    ...(inactivityTimeoutMs === undefined ? {} : { inactivityTimeoutMs }),
  });
}

describe("speech acquisition coordinator", () => {
  it("deduplicates an exact running request and persists checkpoint progress", async () => {
    const { store } = createStore();
    const executor = {
      cancel: vi.fn(async () => undefined),
      execute: vi.fn(async (input) => {
        await input.onCheckpoint(
          {
            browserSessionId: "browser-1",
            completedChunks: [],
            mediaIdentity: "sha256:media",
            uncertainChunkIndex: 0,
            uncertainChunkRetryCount: 0,
          },
          { completedChunks: 0, stage: "transcribing", totalChunks: 2 },
        );
        return {
          branchId: "branch-1",
          detectedLanguage: "zh",
          rowCount: 10,
          subtitleId: "subtitle-1",
        };
      }),
    };
    const coordinator = createCoordinator(store, executor);

    const first = coordinator.start({ parameters, videoKey: video.videoKey });
    const duplicate = coordinator.start({
      parameters,
      videoKey: video.videoKey,
    });
    expect(duplicate).toBe(first);
    const handle = await first;
    await expect(handle.result).resolves.toMatchObject({ rowCount: 10 });
    expect(executor.execute).toHaveBeenCalledOnce();
    expect(store.updateCheckpoint).toHaveBeenCalledWith(
      handle.owner,
      expect.objectContaining({
        progress: { completedChunks: 0, stage: "transcribing", totalChunks: 2 },
      }),
    );
    expect(store.finish).toHaveBeenLastCalledWith(handle.owner, {
      now: 2_000,
      status: "completed",
    });
  });

  it("cancels the executor and persists a terminal cancelled state", async () => {
    const { store } = createStore();
    const executor = {
      cancel: vi.fn(async () => undefined),
      execute: vi.fn(
        async (input) =>
          await new Promise<never>((_resolve, reject) => {
            input.signal.addEventListener("abort", () =>
              reject(new DOMException("cancelled", "AbortError")),
            );
          }),
      ),
    };
    const coordinator = createCoordinator(store, executor);
    const handle = await coordinator.start({
      parameters,
      videoKey: video.videoKey,
    });
    await handle.cancel();
    await expect(handle.result).rejects.toMatchObject({ code: "CANCELLED" });
    expect(store.finish).toHaveBeenCalledWith(handle.owner, {
      now: 2_000,
      status: "cancelled",
    });
    expect(executor.cancel).toHaveBeenCalledWith(handle.owner);
  });

  it("restarts same-session download/preparation work and resumes durable chunk progress after Service Worker recycle", async () => {
    const owner = Object.freeze({
      acquisitionId: "acquisition-old",
      draftBranchId: "branch-old",
      expectedContextRevision: 1,
      expectedSelectionRevision: 2,
      sessionId: "session-1",
      taskId: "task-old",
      videoKey: video.videoKey,
    });
    const base: SpeechAcquisitionRecord = Object.freeze({
      browserSessionId: "browser-1",
      checkpoint: null,
      createdAt: 1_000,
      errorCode: null,
      owner,
      parameters,
      progress: {
        completedChunks: 0,
        stage: "preparing" as const,
        totalChunks: 0,
      },
      status: "running",
      updatedAt: 1_000,
    });
    const crossSession = {
      ...base,
      browserSessionId: "browser-old",
      owner: { ...owner, taskId: "task-cross" },
    } as SpeechAcquisitionRecord;
    const resumable = {
      ...base,
      checkpoint: {
        browserSessionId: "browser-1",
        completedChunks: [
          {
            chunkIndex: 0,
            detectedLanguage: "zh",
            endMs: 60_000,
            model: "whisper-large-v3-turbo" as const,
            transcript: {
              kind: "timed" as const,
              rows: [{ endMs: 1_000, startMs: 0, text: "已完成" }],
            },
          },
        ],
        mediaIdentity: "sha256:media",
        uncertainChunkIndex: null,
        uncertainChunkRetryCount: 0 as const,
      },
      owner: { ...owner, taskId: "task-resumable" },
      progress: {
        completedChunks: 1,
        stage: "transcribing" as const,
        totalChunks: 2,
      },
    } as SpeechAcquisitionRecord;
    const exhausted = {
      ...base,
      checkpoint: {
        browserSessionId: "browser-1",
        completedChunks: [],
        mediaIdentity: "sha256:media",
        uncertainChunkIndex: 1,
        uncertainChunkRetryCount: 1 as const,
      },
      owner: { ...owner, taskId: "task-exhausted" },
    } as SpeechAcquisitionRecord;
    const { store } = createStore([base, crossSession, exhausted, resumable]);
    const executor = {
      cancel: vi.fn(async () => undefined),
      execute: vi.fn(async () => ({
        branchId: "branch-old",
        detectedLanguage: "zh",
        rowCount: 1,
        subtitleId: "subtitle-old",
      })),
    };
    const coordinator = createCoordinator(store, executor);

    const recovered = await coordinator.recover();
    expect(recovered).toHaveLength(2);
    await Promise.all(recovered.map((handle) => handle.result));
    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(store.finish).not.toHaveBeenCalledWith(base.owner, {
      now: 2_000,
      status: "interrupted",
    });
    expect(store.finish).toHaveBeenCalledWith(crossSession.owner, {
      now: 2_000,
      status: "interrupted",
    });
    expect(store.finish).toHaveBeenCalledWith(exhausted.owner, {
      now: 2_000,
      status: "interrupted",
    });
  });

  it("fails a task that stops publishing progress instead of leaving it running forever", async () => {
    vi.useFakeTimers();
    try {
      const { store } = createStore();
      const executor = {
        cancel: vi.fn(async () => undefined),
        execute: vi.fn(
          async (input) =>
            await new Promise<never>((_resolve, reject) => {
              input.signal.addEventListener("abort", () =>
                reject(new DOMException("timed out", "AbortError")),
              );
            }),
        ),
      };
      const coordinator = createCoordinator(store, executor, "browser-1", 100);
      const handle = await coordinator.start({
        parameters,
        videoKey: video.videoKey,
      });
      const result = expect(handle.result).rejects.toMatchObject({
        code: "EXECUTION_FAILED",
      });

      await vi.advanceTimersByTimeAsync(101);

      await result;
      expect(executor.cancel).toHaveBeenCalledWith(handle.owner);
      expect(store.finish).toHaveBeenCalledWith(handle.owner, {
        errorCode: "TIMEOUT",
        now: 2_000,
        status: "failed",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels a persisted task for explicit owner deletion even without a live executor", async () => {
    const owner = Object.freeze({
      acquisitionId: "acquisition-old",
      draftBranchId: "branch-old",
      expectedContextRevision: 1,
      expectedSelectionRevision: 2,
      sessionId: "session-1",
      taskId: "task-old",
      videoKey: video.videoKey,
    });
    const persisted: SpeechAcquisitionRecord = Object.freeze({
      browserSessionId: "browser-1",
      checkpoint: null,
      createdAt: 1_000,
      errorCode: null,
      owner,
      parameters,
      progress: {
        completedChunks: 0,
        stage: "preparing",
        totalChunks: 0,
      } as const,
      status: "running",
      updatedAt: 1_000,
    });
    const { store } = createStore([persisted]);
    const executor = {
      cancel: vi.fn(async () => undefined),
      execute: vi.fn(),
    };
    const coordinator = createCoordinator(store, executor);

    await expect(coordinator.cancel(owner)).resolves.toBe(true);
    expect(executor.cancel).toHaveBeenCalledWith(owner);
    expect(store.finish).toHaveBeenCalledWith(owner, {
      now: 2_000,
      status: "cancelled",
    });
  });
});
