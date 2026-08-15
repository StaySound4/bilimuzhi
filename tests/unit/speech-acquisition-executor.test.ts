import { describe, expect, it, vi } from "vitest";

import { createSpeechAcquisitionExecutor } from "../../src/application/asr/speech-acquisition-executor";
import type { SpeechAcquisitionRecord } from "../../src/application/asr/speech-acquisition-coordinator";
import type { BranchSubtitleRepository } from "../../src/application/subtitle-repository";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoRef,
} from "../../src/domain";

const video = createVideoRef({
  bvid: "BV1Q541167Qg",
  canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
  cid: 30_000_000_001,
  durationSec: 100,
  page: 1,
  title: "语音测试",
});
const session = createSession({
  activeBranchId: null,
  createdAt: 1,
  customTitle: false,
  lastActivityAt: 1,
  selectionRevision: 2,
  sessionId: "session-1",
  title: video.title,
  updatedAt: 1,
  videoKey: video.videoKey,
});
const owner = Object.freeze({
  acquisitionId: "acquisition-1",
  draftBranchId: "branch-1",
  expectedContextRevision: 1,
  expectedSelectionRevision: 2,
  sessionId: session.sessionId,
  taskId: "task-1",
  videoKey: video.videoKey,
});

function record(): SpeechAcquisitionRecord {
  return Object.freeze({
    browserSessionId: "browser-1",
    checkpoint: null,
    createdAt: 1,
    errorCode: null,
    owner,
    parameters: {
      model: "whisper-large-v3",
      provider: "groq",
      requestedLanguageMode: "mixed",
      routingMode: "balanced",
    } as const,
    progress: {
      completedChunks: 0,
      stage: "preparing",
      totalChunks: 0,
    } as const,
    status: "running",
    updatedAt: 1,
  });
}

function repository(): BranchSubtitleRepository {
  return {
    beginAcquisition: vi.fn(async () => ({
      expectedContextRevision: 1,
      session,
      video,
    })),
    commitAcquisition: vi.fn(async (_owner, staged) => {
      const subtitle = createSubtitleSnapshot({ ...staged, status: "active" });
      const branch = createSubtitleBranch({
        activeSubtitleId: subtitle.subtitleId,
        branchId: subtitle.branchId,
        contextRevision: 1,
        createdAt: subtitle.createdAt,
        detectedLanguage: "zh",
        language: subtitle.language,
        lastOpenedAt: subtitle.createdAt,
        lastSelectedAt: subtitle.createdAt,
        requestedLanguageMode: "mixed",
        sessionId: subtitle.sessionId,
        source: "groq-whisper",
        title: null,
        updatedAt: subtitle.createdAt,
        videoKey: subtitle.videoKey,
      });
      return {
        branch,
        placement: createBranchPlacement({
          branchId: branch.branchId,
          deletionReason: null,
          location: "workspace",
          order: 2,
          purgeAfter: null,
          retentionStartedAt: null,
          sessionId: branch.sessionId,
          trashedAt: null,
          trashOrigin: null,
          trashOriginFolderId: null,
          trashOriginPathSnapshot: null,
        }),
        session: createSession({
          ...session,
          activeBranchId: branch.branchId,
          selectionRevision: 3,
          updatedAt: 2,
        }),
        subtitle,
      };
    }),
    commitInitialAcquisition: vi.fn(),
    finishAcquisition: vi.fn(async () => undefined),
    readAcquisitionContext: vi.fn(async () => ({
      expectedContextRevision: 1,
      session,
      video,
    })),
  };
}

describe("speech acquisition executor", () => {
  it("checkpoints every chunk, merges timestamps, and commits a new Groq branch", async () => {
    const repo = repository();
    const transcribe = vi
      .fn()
      .mockResolvedValueOnce({
        detectedLanguage: "zh",
        model: "whisper-large-v3-turbo",
        transcript: {
          kind: "timed",
          rows: [{ endMs: 5_000, startMs: 0, text: "第一段" }],
        },
      })
      .mockResolvedValueOnce({
        detectedLanguage: "zh",
        model: "whisper-large-v3",
        transcript: {
          kind: "timed",
          rows: [{ endMs: 5_000, startMs: 4_000, text: "第二段" }],
        },
      });
    const executor = createSpeechAcquisitionExecutor({
      chunkProcessor: {
        prepare: async () => [
          {
            bytes: new Uint8Array([1]),
            endMs: 60_000,
            index: 0,
            mimeType: "audio/mpeg",
            startMs: 0,
          },
          {
            bytes: new Uint8Array([2]),
            endMs: 100_000,
            index: 1,
            mimeType: "audio/mpeg",
            startMs: 56_000,
          },
        ],
      },
      createSubtitleId: () => "subtitle-1",
      hashRows: async () => "sha256:rows",
      mediaGateway: {
        acquireCompleteAudio: async () => ({
          byteLength: 2,
          bytes: new Uint8Array([1, 2]),
          durationMs: 100_000,
          mediaIdentity: "sha256:media",
          mimeType: "audio/mp4",
          videoKey: video.videoKey,
        }),
      },
      mergeTimedRows: (existing, incoming, start, overlap) => [
        ...existing,
        ...incoming
          .filter((row) => row.endMs > overlap)
          .map((row) => ({
            ...row,
            endMs: start + row.endMs,
            startMs: start + Math.max(row.startMs, overlap),
          })),
      ],
      now: () => 2,
      repository: repo,
      transcriber: { transcribe },
    });
    const checkpoints: unknown[] = [];

    await expect(
      executor.execute({
        onCheckpoint: async (checkpoint, progress) => {
          checkpoints.push({ checkpoint, progress });
        },
        record: record(),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      branchId: "branch-1",
      detectedLanguage: "zh",
      rowCount: 2,
      subtitleId: "subtitle-1",
    });
    expect(checkpoints.length).toBeGreaterThanOrEqual(5);
    expect(repo.beginAcquisition).toHaveBeenCalledWith(owner, {
      mediaIdentity: "sha256:media",
      method: "speech",
      model: "whisper-large-v3",
      provider: "groq",
      requestedLanguageMode: "mixed",
    });
    expect(repo.commitAcquisition).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({ source: "groq-whisper", status: "staged" }),
    );
  });

  it("rolls back the staged acquisition when cancellation is requested", async () => {
    const repo = repository();
    const executor = createSpeechAcquisitionExecutor({
      chunkProcessor: { prepare: vi.fn() },
      createSubtitleId: () => "subtitle-1",
      hashRows: async () => "sha256:rows",
      mediaGateway: { acquireCompleteAudio: vi.fn() },
      mergeTimedRows: () => [],
      now: () => 2,
      repository: repo,
      transcriber: { transcribe: vi.fn() },
    });

    await executor.cancel(owner);

    expect(repo.finishAcquisition).toHaveBeenCalledWith(owner, "cancelled");
  });

  it("rejects changed media during recovery before reusing old chunks", async () => {
    const repo = repository();
    const executor = createSpeechAcquisitionExecutor({
      chunkProcessor: { prepare: vi.fn() },
      createSubtitleId: () => "subtitle-1",
      hashRows: async () => "sha256:rows",
      mediaGateway: {
        acquireCompleteAudio: async () => ({
          byteLength: 1,
          bytes: new Uint8Array([1]),
          durationMs: 100_000,
          mediaIdentity: "sha256:new-media",
          mimeType: "audio/mp4",
          videoKey: video.videoKey,
        }),
      },
      mergeTimedRows: () => [],
      now: () => 2,
      repository: repo,
      transcriber: { transcribe: vi.fn() },
    });
    const resumed = {
      ...record(),
      checkpoint: {
        browserSessionId: "browser-1",
        completedChunks: [],
        mediaIdentity: "sha256:old-media",
        uncertainChunkIndex: null,
        uncertainChunkRetryCount: 0 as const,
      },
    };
    await expect(
      executor.execute({
        onCheckpoint: vi.fn(),
        record: resumed,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_IDENTITY_CHANGED" });
    expect(repo.beginAcquisition).not.toHaveBeenCalled();
  });

  it("forwards cancellation into media acquisition and checkpoints real media and prepare progress", async () => {
    const repo = repository();
    const controller = new AbortController();
    const mediaProgress = Object.freeze({
      completedBytes: 2,
      phase: "downloading" as const,
      totalBytes: 2,
    });
    const prepareProgress = Object.freeze({
      completedUnits: 1,
      phase: "encoding" as const,
      totalUnits: 1,
    });
    let receivedSignal: AbortSignal | undefined;
    const executor = createSpeechAcquisitionExecutor({
      chunkProcessor: {
        prepare: async (input) => {
          await input.onProgress?.(prepareProgress);
          return [
            {
              bytes: new Uint8Array([1]),
              endMs: 100_000,
              index: 0,
              mimeType: "audio/mpeg",
              startMs: 0,
            },
          ];
        },
      },
      createSubtitleId: () => "subtitle-progress",
      hashRows: async () => "sha256:rows",
      mediaGateway: {
        acquireCompleteAudio: async (_video, options) => {
          receivedSignal = options?.signal;
          await options?.onProgress?.(mediaProgress);
          return {
            byteLength: 2,
            bytes: new Uint8Array([1, 2]),
            durationMs: 100_000,
            mediaIdentity: "sha256:media",
            mimeType: "audio/mp4",
            videoKey: video.videoKey,
          };
        },
      },
      mergeTimedRows: (_existing, incoming) => incoming,
      now: () => 2,
      repository: repo,
      transcriber: {
        transcribe: async () => ({
          detectedLanguage: "zh",
          model: "whisper-large-v3",
          transcript: {
            kind: "timed",
            rows: [{ endMs: 1_000, startMs: 0, text: "完成" }],
          },
        }),
      },
    });
    const progress: unknown[] = [];

    await expect(
      executor.execute({
        onCheckpoint: async (_checkpoint, nextProgress) => {
          progress.push(nextProgress);
        },
        record: record(),
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ subtitleId: "subtitle-progress" });

    expect(receivedSignal).toBe(controller.signal);
    expect(progress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activity: mediaProgress,
          stage: "preparing",
        }),
        expect.objectContaining({
          activity: prepareProgress,
          stage: "preparing",
        }),
      ]),
    );
  });
});
