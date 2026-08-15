import { afterEach, describe, expect, it, vi } from "vitest";
import { indexedDB as fakeIndexedDB } from "fake-indexeddb";

import { AuthorizedMediaGatewayError } from "../../src/application/authorized-media-gateway";
import {
  createSpeechAcquisitionCoordinator,
  type SpeechAcquisitionRecord,
  type SpeechAcquisitionStore,
} from "../../src/application/asr/speech-acquisition-coordinator";
import { createSpeechAcquisitionExecutor } from "../../src/application/asr/speech-acquisition-executor";
import type { SubtitleAcquisitionOwner } from "../../src/application/subtitle-acquisition-contract";
import {
  createSubtitleSnapshot,
  createVideoRef,
  type VideoKey,
} from "../../src/domain";
import { mergeTimestampedChunkRows } from "../../src/infrastructure/asr/chunk-merger";
import { GroqWhisperError } from "../../src/infrastructure/asr/groq-provider";
import {
  requestResult,
  transactionDone,
} from "../../src/infrastructure/indexeddb/idb-requests";
import { openBilimuzhiDatabase } from "../../src/infrastructure/indexeddb/muzhi-database";
import { IndexedDbSessionRepository } from "../../src/infrastructure/indexeddb/session-repository";
import { IndexedDbSubtitleRepository } from "../../src/infrastructure/indexeddb/subtitle-repository";

const databaseNames: string[] = [];

async function deleteDatabase(name: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = fakeIndexedDB.deleteDatabase(name);
    request.addEventListener("success", () => resolve(), { once: true });
    request.addEventListener("error", () => reject(request.error), {
      once: true,
    });
  });
}

afterEach(async () => {
  await Promise.all(databaseNames.splice(0).map(deleteDatabase));
});

function createStore(seed: readonly SpeechAcquisitionRecord[] = []) {
  const records = new Map(seed.map((record) => [record.owner.taskId, record]));
  const checkpointHistory: SpeechAcquisitionRecord["checkpoint"][] = [];
  const progressHistory: SpeechAcquisitionRecord["progress"][] = [];
  const store: SpeechAcquisitionStore = {
    async begin(record) {
      const running = Object.freeze({ ...record, status: "running" as const });
      records.set(record.owner.taskId, running);
      return running;
    },
    async finish(owner, input) {
      const current = records.get(owner.taskId);
      if (!current) return null;
      const terminal: SpeechAcquisitionRecord = Object.freeze({
        ...current,
        errorCode: input.status === "failed" ? input.errorCode : null,
        status: input.status,
        updatedAt: input.now,
      });
      records.set(owner.taskId, terminal);
      return terminal;
    },
    async get(owner) {
      return records.get(owner.taskId) ?? null;
    },
    async listActive() {
      return [...records.values()].filter(
        (record) => record.status === "queued" || record.status === "running",
      );
    },
    async updateCheckpoint(owner, input) {
      const current = records.get(owner.taskId);
      if (!current) return null;
      const updated = Object.freeze({
        ...current,
        checkpoint: input.checkpoint,
        progress: input.progress,
        updatedAt: input.now,
      });
      records.set(owner.taskId, updated);
      checkpointHistory.push(input.checkpoint);
      progressHistory.push(input.progress);
      return updated;
    },
  };
  return { checkpointHistory, progressHistory, records, store };
}

async function createFixture() {
  const name = `muzhi-speech-chain-${crypto.randomUUID()}`;
  databaseNames.push(name);
  const database = await openBilimuzhiDatabase({
    factory: fakeIndexedDB,
    name,
  });
  const video = createVideoRef({
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
    cid: 30_000_000_001,
    durationSec: 120,
    page: 1,
    title: "语音全链路",
  });
  const session = await new IndexedDbSessionRepository(database, {
    createSessionId: () => "session-speech",
    now: () => 1_000,
  }).create(video);
  const repository = new IndexedDbSubtitleRepository(database, {
    now: () => 2_000,
  });
  return { database, repository, session, video };
}

function media(videoKey: VideoKey) {
  return {
    byteLength: 3,
    bytes: new Uint8Array([1, 2, 3]),
    durationMs: 120_000,
    mediaIdentity: "sha256:fixture-media" as const,
    mimeType: "audio/mp4",
    videoKey,
  };
}

async function databaseCounts(database: IDBDatabase) {
  const transaction = database.transaction(
    ["generationRuns", "subtitleBranches", "subtitleSnapshots"],
    "readonly",
  );
  const [runs, branches, snapshots] = await Promise.all([
    requestResult(transaction.objectStore("generationRuns").getAll()),
    requestResult(transaction.objectStore("subtitleBranches").getAll()),
    requestResult(transaction.objectStore("subtitleSnapshots").getAll()),
  ]);
  await transactionDone(transaction);
  return { branches, runs, snapshots };
}

describe("speech acquisition full-chain fixture", () => {
  it("replaces an existing direct subtitle context with the completed speech result", async () => {
    const { database, repository, session, video } = await createFixture();
    const directOwner: SubtitleAcquisitionOwner = {
      acquisitionId: "acquisition-direct",
      draftBranchId: "branch-direct",
      expectedContextRevision: 1,
      expectedSelectionRevision: 0,
      sessionId: session.sessionId,
      taskId: "task-direct",
      videoKey: video.videoKey,
    };
    await repository.beginAcquisition(directOwner, {
      method: "direct",
      trackId: "official:zh:1",
    });
    await repository.commitAcquisition(
      directOwner,
      createSubtitleSnapshot({
        branchId: directOwner.draftBranchId,
        contentHash: "sha256:direct",
        createdAt: 1_500,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "直接字幕" }],
        sessionId: session.sessionId,
        source: "bilibili",
        status: "staged",
        subtitleId: "subtitle-direct",
        videoKey: video.videoKey,
      }),
    );
    const { store } = createStore();
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({
        detectedLanguage: "zh",
        model: "whisper-large-v3-turbo",
        transcript: {
          kind: "timed",
          rows: [{ endMs: 60_000, startMs: 0, text: "第一块" }],
        },
      })
      .mockResolvedValueOnce({
        detectedLanguage: "zh",
        model: "whisper-large-v3",
        transcript: {
          kind: "timed",
          rows: [{ endMs: 64_000, startMs: 4_000, text: "第二块" }],
        },
      });
    const coordinator = createSpeechAcquisitionCoordinator({
      browserSessionId: "browser-1",
      createAcquisitionId: () => "acquisition-speech",
      createDraftBranchId: () => "branch-speech",
      createTaskId: () => "task-speech",
      executor: createSpeechAcquisitionExecutor({
        chunkProcessor: {
          prepare: async () => [
            {
              bytes: new Uint8Array([1]),
              endMs: 64_000,
              index: 0,
              mimeType: "audio/mp4",
              startMs: 0,
            },
            {
              bytes: new Uint8Array([2]),
              endMs: 120_000,
              index: 1,
              mimeType: "audio/mp4",
              startMs: 60_000,
            },
          ],
        },
        createSubtitleId: () => "subtitle-speech",
        hashRows: async () => "sha256:speech",
        mediaGateway: {
          acquireCompleteAudio: async () => media(video.videoKey),
        },
        mergeTimedRows: mergeTimestampedChunkRows,
        now: () => 2_000,
        repository,
        transcriber: { transcribe },
      }),
      now: () => 2_000,
      readOwnerContext: async () => ({
        expectedContextRevision: 1,
        expectedSelectionRevision: 1,
        sessionId: session.sessionId,
      }),
      store,
    });

    try {
      const handle = await coordinator.start({
        parameters: {
          model: "whisper-large-v3",
          provider: "groq",
          requestedLanguageMode: "mixed",
          routingMode: "balanced",
        },
        videoKey: video.videoKey,
      });
      await expect(handle.result).resolves.toMatchObject({
        branchId: "branch-speech",
        subtitleId: "subtitle-speech",
      });
      const persisted = await databaseCounts(database);
      expect(persisted.branches).toEqual([
        expect.objectContaining({
          branchId: "branch-speech",
          requestedLanguageMode: "mixed",
          source: "groq-whisper",
        }),
      ]);
      expect(persisted.snapshots).toEqual([
        expect.objectContaining({
          branchId: "branch-speech",
          subtitleId: "subtitle-speech",
        }),
      ]);
      expect(await store.get(handle.owner)).toMatchObject({
        status: "completed",
      });
    } finally {
      database.close();
    }
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", "请先登录后重试。"],
    ["PERMISSION_DENIED", "当前账号无权播放完整媒体。"],
    ["MEDIA_INCOMPLETE", "只取得了试看媒体。"],
  ] as const)(
    "does not create a Branch for %s media",
    async (code, message) => {
      const { database, repository, session, video } = await createFixture();
      const { store } = createStore();
      const coordinator = createSpeechAcquisitionCoordinator({
        browserSessionId: "browser-1",
        createAcquisitionId: () => `acquisition-${code}`,
        createDraftBranchId: () => `branch-${code}`,
        createTaskId: () => `task-${code}`,
        executor: createSpeechAcquisitionExecutor({
          chunkProcessor: { prepare: vi.fn() },
          createSubtitleId: () => "subtitle-never",
          hashRows: async () => "sha256:never",
          mediaGateway: {
            acquireCompleteAudio: async () => {
              throw new AuthorizedMediaGatewayError(code, message, false);
            },
          },
          mergeTimedRows: mergeTimestampedChunkRows,
          now: () => 2_000,
          repository,
          transcriber: { transcribe: vi.fn() },
        }),
        now: () => 2_000,
        readOwnerContext: async () => ({
          expectedContextRevision: 1,
          expectedSelectionRevision: 0,
          sessionId: session.sessionId,
        }),
        store,
      });

      try {
        const handle = await coordinator.start({
          parameters: {
            model: "whisper-large-v3",
            provider: "groq",
            requestedLanguageMode: "zh",
            routingMode: "standard-first",
          },
          videoKey: video.videoKey,
        });
        await expect(handle.result).rejects.toMatchObject({ code });
        const persisted = await databaseCounts(database);
        expect(persisted.branches).toHaveLength(0);
        expect(persisted.snapshots).toHaveLength(0);
        expect(await store.get(handle.owner)).toMatchObject({
          errorCode: code,
          status: "failed",
        });
      } finally {
        database.close();
      }
    },
  );

  it.each([
    ["AUTHENTICATION_REQUIRED", false],
    ["RATE_LIMITED", true],
  ] as const)(
    "rolls back the acquisition when Groq returns %s",
    async (code, retryable) => {
      const { database, repository, session, video } = await createFixture();
      const { store } = createStore();
      const coordinator = createSpeechAcquisitionCoordinator({
        browserSessionId: "browser-1",
        createAcquisitionId: () => `acquisition-groq-${code}`,
        createDraftBranchId: () => `branch-groq-${code}`,
        createTaskId: () => `task-groq-${code}`,
        executor: createSpeechAcquisitionExecutor({
          chunkProcessor: {
            prepare: async () => [
              {
                bytes: new Uint8Array([1]),
                endMs: 120_000,
                index: 0,
                mimeType: "audio/mp4",
                startMs: 0,
              },
            ],
          },
          createSubtitleId: () => "subtitle-never",
          hashRows: async () => "sha256:never",
          mediaGateway: {
            acquireCompleteAudio: async () => media(video.videoKey),
          },
          mergeTimedRows: mergeTimestampedChunkRows,
          now: () => 2_000,
          repository,
          transcriber: {
            transcribe: async () => {
              throw new GroqWhisperError(
                code,
                "fixture provider failure",
                retryable,
                code === "RATE_LIMITED" ? 5 : 0,
              );
            },
          },
        }),
        now: () => 2_000,
        readOwnerContext: async () => ({
          expectedContextRevision: 1,
          expectedSelectionRevision: 0,
          sessionId: session.sessionId,
        }),
        store,
      });

      try {
        const handle = await coordinator.start({
          parameters: {
            model: "whisper-large-v3",
            provider: "groq",
            requestedLanguageMode: "mixed",
            routingMode: "balanced",
          },
          videoKey: video.videoKey,
        });
        await expect(handle.result).rejects.toMatchObject({ code });
        const persisted = await databaseCounts(database);
        expect(persisted.branches).toHaveLength(0);
        expect(persisted.snapshots).toHaveLength(0);
        expect(persisted.runs).toEqual([
          expect.objectContaining({ status: "failed", subtitleId: null }),
        ]);
        expect(await store.get(handle.owner)).toMatchObject({
          errorCode: code,
          status: "failed",
        });
      } finally {
        database.close();
      }
    },
  );

  it("recovers completed chunks and retries one uncertain chunk without duplicate Provider work", async () => {
    const { database, repository, session, video } = await createFixture();
    const owner: SubtitleAcquisitionOwner = Object.freeze({
      acquisitionId: "acquisition-recovery",
      draftBranchId: "branch-recovery",
      expectedContextRevision: 1,
      expectedSelectionRevision: 0,
      sessionId: session.sessionId,
      taskId: "task-recovery",
      videoKey: video.videoKey,
    });
    const seeded: SpeechAcquisitionRecord = Object.freeze({
      browserSessionId: "browser-1",
      checkpoint: Object.freeze({
        browserSessionId: "browser-1",
        completedChunks: Object.freeze([
          Object.freeze({
            chunkIndex: 0,
            detectedLanguage: "zh",
            endMs: 64_000,
            model: "whisper-large-v3-turbo",
            transcript: Object.freeze({
              kind: "timed" as const,
              rows: Object.freeze([
                Object.freeze({
                  endMs: 60_000,
                  startMs: 0,
                  text: "已完成分片",
                }),
              ]),
            }),
          }),
        ]),
        mediaIdentity: "sha256:fixture-media",
        uncertainChunkIndex: 1,
        uncertainChunkRetryCount: 0,
      }),
      createdAt: 1_000,
      errorCode: null,
      owner,
      parameters: Object.freeze({
        model: "whisper-large-v3",
        provider: "groq",
        requestedLanguageMode: "mixed",
        routingMode: "balanced",
      }),
      progress: Object.freeze({
        completedChunks: 1,
        stage: "transcribing",
        totalChunks: 2,
      }),
      status: "running",
      updatedAt: 1_500,
    });
    const { checkpointHistory, store } = createStore([seeded]);
    const transcribe = vi.fn(async () => ({
      detectedLanguage: "zh",
      model: "whisper-large-v3" as const,
      transcript: {
        kind: "timed" as const,
        rows: [{ endMs: 60_000, startMs: 4_000, text: "恢复分片" }],
      },
    }));
    const coordinator = createSpeechAcquisitionCoordinator({
      browserSessionId: "browser-1",
      createAcquisitionId: () => "unused",
      createDraftBranchId: () => "unused",
      createTaskId: () => "unused",
      executor: createSpeechAcquisitionExecutor({
        chunkProcessor: {
          prepare: async () => [
            {
              bytes: new Uint8Array([1]),
              endMs: 64_000,
              index: 0,
              mimeType: "audio/mp4",
              startMs: 0,
            },
            {
              bytes: new Uint8Array([2]),
              endMs: 120_000,
              index: 1,
              mimeType: "audio/mp4",
              startMs: 60_000,
            },
          ],
        },
        createSubtitleId: () => "subtitle-recovery",
        hashRows: async () => "sha256:recovery",
        mediaGateway: {
          acquireCompleteAudio: async () => media(video.videoKey),
        },
        mergeTimedRows: mergeTimestampedChunkRows,
        now: () => 2_000,
        repository,
        transcriber: { transcribe },
      }),
      now: () => 2_000,
      readOwnerContext: async () => null,
      store,
    });

    try {
      const [handle] = await coordinator.recover();
      await expect(handle?.result).resolves.toMatchObject({
        branchId: owner.draftBranchId,
        rowCount: 2,
      });
      expect(transcribe).toHaveBeenCalledOnce();
      expect(transcribe).toHaveBeenCalledWith(
        expect.objectContaining({
          chunk: expect.objectContaining({ index: 1 }),
        }),
      );
      expect(checkpointHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            uncertainChunkIndex: 1,
            uncertainChunkRetryCount: 1,
          }),
        ]),
      );
    } finally {
      database.close();
    }
  });

  it("cancels an in-flight Provider request and leaves no staged Branch or snapshot", async () => {
    const { database, repository, session, video } = await createFixture();
    const { store } = createStore();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const coordinator = createSpeechAcquisitionCoordinator({
      browserSessionId: "browser-1",
      createAcquisitionId: () => "acquisition-cancel",
      createDraftBranchId: () => "branch-cancel",
      createTaskId: () => "task-cancel",
      executor: createSpeechAcquisitionExecutor({
        chunkProcessor: {
          prepare: async () => [
            {
              bytes: new Uint8Array([1]),
              endMs: 120_000,
              index: 0,
              mimeType: "audio/mp4",
              startMs: 0,
            },
          ],
        },
        createSubtitleId: () => "subtitle-cancel",
        hashRows: async () => "sha256:cancel",
        mediaGateway: {
          acquireCompleteAudio: async () => media(video.videoKey),
        },
        mergeTimedRows: mergeTimestampedChunkRows,
        now: () => 2_000,
        repository,
        transcriber: {
          transcribe: async (input) => {
            markStarted();
            return await new Promise<never>((_resolve, reject) => {
              input.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("cancelled", "AbortError")),
                { once: true },
              );
            });
          },
        },
      }),
      now: () => 2_000,
      readOwnerContext: async () => ({
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: session.sessionId,
      }),
      store,
    });

    try {
      const handle = await coordinator.start({
        parameters: {
          model: "whisper-large-v3",
          provider: "groq",
          requestedLanguageMode: "zh",
          routingMode: "balanced",
        },
        videoKey: video.videoKey,
      });
      await started;
      await handle.cancel();
      await expect(handle.result).rejects.toMatchObject({ code: "CANCELLED" });
      const persisted = await databaseCounts(database);
      expect(persisted.branches).toHaveLength(0);
      expect(persisted.snapshots).toHaveLength(0);
      expect(persisted.runs).toEqual([
        expect.objectContaining({ status: "cancelled", subtitleId: null }),
      ]);
    } finally {
      database.close();
    }
  });

  it("cancels an in-flight media download before any staged acquisition is created", async () => {
    const { database, repository, session, video } = await createFixture();
    const { store } = createStore();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let mediaSignal: AbortSignal | undefined;
    const coordinator = createSpeechAcquisitionCoordinator({
      browserSessionId: "browser-1",
      createAcquisitionId: () => "acquisition-media-cancel",
      createDraftBranchId: () => "branch-media-cancel",
      createTaskId: () => "task-media-cancel",
      executor: createSpeechAcquisitionExecutor({
        chunkProcessor: { prepare: vi.fn() },
        createSubtitleId: () => "subtitle-never",
        hashRows: async () => "sha256:never",
        mediaGateway: {
          acquireCompleteAudio: async (_video, options) => {
            mediaSignal = options?.signal;
            markStarted();
            return await new Promise<never>((_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(new DOMException("cancelled", "AbortError")),
                { once: true },
              );
            });
          },
        },
        mergeTimedRows: mergeTimestampedChunkRows,
        now: () => 2_000,
        repository,
        transcriber: { transcribe: vi.fn() },
      }),
      now: () => 2_000,
      readOwnerContext: async () => ({
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: session.sessionId,
      }),
      store,
    });

    try {
      const handle = await coordinator.start({
        parameters: {
          model: "whisper-large-v3",
          provider: "groq",
          requestedLanguageMode: "zh",
          routingMode: "balanced",
        },
        videoKey: video.videoKey,
      });
      const cancelled = expect(handle.result).rejects.toMatchObject({
        code: "CANCELLED",
      });
      await started;
      await handle.cancel();
      await cancelled;
      expect(mediaSignal?.aborted).toBe(true);
      expect(await store.get(handle.owner)).toMatchObject({
        errorCode: null,
        status: "cancelled",
      });
      const persisted = await databaseCounts(database);
      expect(persisted.branches).toHaveLength(0);
      expect(persisted.snapshots).toHaveLength(0);
      expect(persisted.runs).toHaveLength(0);
    } finally {
      database.close();
    }
  });

  it("keeps the task running after audio download until chunk transcription, merge, and commit finish", async () => {
    const { database, repository, session, video } = await createFixture();
    const { progressHistory, records, store } = createStore();
    let finishTranscription!: (value: {
      detectedLanguage: string;
      model: "whisper-large-v3";
      transcript: {
        kind: "timed";
        rows: readonly { endMs: number; startMs: number; text: string }[];
      };
    }) => void;
    const transcribe = vi.fn(
      async () =>
        await new Promise<{
          detectedLanguage: string;
          model: "whisper-large-v3";
          transcript: {
            kind: "timed";
            rows: readonly { endMs: number; startMs: number; text: string }[];
          };
        }>((resolve) => {
          finishTranscription = resolve;
        }),
    );
    const coordinator = createSpeechAcquisitionCoordinator({
      browserSessionId: "browser-1",
      createAcquisitionId: () => "acquisition-download-is-not-complete",
      createDraftBranchId: () => "branch-download-is-not-complete",
      createTaskId: () => "task-download-is-not-complete",
      executor: createSpeechAcquisitionExecutor({
        chunkProcessor: {
          prepare: async () => [
            {
              bytes: new Uint8Array([1]),
              endMs: 120_000,
              index: 0,
              mimeType: "audio/mp4",
              startMs: 0,
            },
          ],
        },
        createSubtitleId: () => "subtitle-download-is-not-complete",
        hashRows: async () => "sha256:download-is-not-complete",
        mediaGateway: {
          acquireCompleteAudio: async (_video, options) => {
            await options?.onProgress?.({
              completedBytes: 3,
              phase: "downloading",
              totalBytes: 3,
            });
            return media(video.videoKey);
          },
        },
        mergeTimedRows: mergeTimestampedChunkRows,
        now: () => 2_000,
        repository,
        transcriber: { transcribe },
      }),
      now: () => 2_000,
      readOwnerContext: async () => ({
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: session.sessionId,
      }),
      store,
    });

    try {
      const handle = await coordinator.start({
        parameters: {
          model: "whisper-large-v3",
          provider: "groq",
          requestedLanguageMode: "zh",
          routingMode: "balanced",
        },
        videoKey: video.videoKey,
      });
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
      expect(records.get(handle.owner.taskId)).toMatchObject({
        progress: { completedChunks: 0, stage: "transcribing", totalChunks: 1 },
        status: "running",
      });
      expect(progressHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activity: {
              completedBytes: 3,
              phase: "downloading",
              totalBytes: 3,
            },
            stage: "preparing",
          }),
        ]),
      );

      finishTranscription({
        detectedLanguage: "zh",
        model: "whisper-large-v3",
        transcript: {
          kind: "timed",
          rows: [{ endMs: 120_000, startMs: 0, text: "完整转写结果" }],
        },
      });
      await expect(handle.result).resolves.toMatchObject({
        rowCount: 1,
        subtitleId: "subtitle-download-is-not-complete",
      });
      expect(records.get(handle.owner.taskId)?.status).toBe("completed");
    } finally {
      database.close();
    }
  });

  it("keeps a long preparation alive only when the processor publishes real progress", async () => {
    const { database, repository, session, video } = await createFixture();
    const { progressHistory, store } = createStore();
    const coordinator = createSpeechAcquisitionCoordinator({
      browserSessionId: "browser-1",
      createAcquisitionId: () => "acquisition-prepare-progress",
      createDraftBranchId: () => "branch-prepare-progress",
      createTaskId: () => "task-prepare-progress",
      executor: createSpeechAcquisitionExecutor({
        chunkProcessor: {
          prepare: async (input) => {
            for (let index = 1; index <= 3; index += 1) {
              await new Promise((resolve) => setTimeout(resolve, 50));
              await input.onProgress?.({
                completedUnits: index,
                phase: "encoding",
                totalUnits: 3,
              });
            }
            return [
              {
                bytes: new Uint8Array([1]),
                endMs: 120_000,
                index: 0,
                mimeType: "audio/mp4",
                startMs: 0,
              },
            ];
          },
        },
        createSubtitleId: () => "subtitle-prepare-progress",
        hashRows: async () => "sha256:prepare-progress",
        mediaGateway: {
          acquireCompleteAudio: async (_video, options) => {
            await options?.onProgress?.({
              completedBytes: 3,
              phase: "downloading",
              totalBytes: 3,
            });
            return media(video.videoKey);
          },
        },
        mergeTimedRows: mergeTimestampedChunkRows,
        now: () => 2_000,
        repository,
        transcriber: {
          transcribe: async () => ({
            detectedLanguage: "zh",
            model: "whisper-large-v3",
            transcript: {
              kind: "timed",
              rows: [{ endMs: 120_000, startMs: 0, text: "真实进度完成" }],
            },
          }),
        },
      }),
      inactivityTimeoutMs: 90,
      now: () => 2_000,
      readOwnerContext: async () => ({
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: session.sessionId,
      }),
      store,
    });

    try {
      const handle = await coordinator.start({
        parameters: {
          model: "whisper-large-v3",
          provider: "groq",
          requestedLanguageMode: "zh",
          routingMode: "balanced",
        },
        videoKey: video.videoKey,
      });
      await expect(handle.result).resolves.toMatchObject({
        subtitleId: "subtitle-prepare-progress",
      });
      expect(progressHistory).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            activity: {
              completedUnits: 3,
              phase: "encoding",
              totalUnits: 3,
            },
            stage: "preparing",
          }),
        ]),
      );
    } finally {
      database.close();
    }
  });
});
