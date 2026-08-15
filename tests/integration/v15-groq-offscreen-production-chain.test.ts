import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { GroqWhisperModel } from "../../src/application/asr-contract";
import {
  createSpeechAcquisitionCoordinator,
  type SpeechAcquisitionRecord,
  type SpeechAcquisitionStore,
} from "../../src/application/asr/speech-acquisition-coordinator";
import { createSpeechAcquisitionExecutor } from "../../src/application/asr/speech-acquisition-executor";
import { createGroqChunkTranscriber } from "../../src/infrastructure/asr/groq-transcriber";

const videoKey = "bvid:BV1xx411c7mD:cid:30000000099:p:1" as const;

function recoveryRecord(): SpeechAcquisitionRecord {
  return Object.freeze({
    browserSessionId: "browser-v15",
    checkpoint: Object.freeze({
      browserSessionId: "browser-v15",
      completedChunks: Object.freeze([]),
      mediaIdentity: "sha256:v15-media",
      uncertainChunkIndex: 0,
      uncertainChunkRetryCount: 0,
    }),
    createdAt: 1_000,
    errorCode: null,
    owner: Object.freeze({
      acquisitionId: "acquisition-v15-recovery",
      draftBranchId: "branch-v15-recovery",
      expectedContextRevision: 1,
      expectedSelectionRevision: 2,
      sessionId: "session-v15-recovery",
      taskId: "task-v15-recovery",
      videoKey,
    }),
    parameters: Object.freeze({
      model: "whisper-large-v3",
      provider: "groq" as const,
      requestedLanguageMode: "mixed" as const,
      routingMode: "balanced" as const,
    }),
    progress: Object.freeze({
      completedChunks: 0,
      stage: "transcribing" as const,
      totalChunks: 1,
    }),
    status: "running" as const,
    updatedAt: 1_500,
  });
}

function createRecoveryStore(record: SpeechAcquisitionRecord) {
  let current = record;
  const checkpoints: SpeechAcquisitionRecord["checkpoint"][] = [];
  const store: SpeechAcquisitionStore = {
    begin: vi.fn(async (next) => next),
    finish: vi.fn(async (_owner, input) => {
      current = Object.freeze({
        ...current,
        errorCode: input.status === "failed" ? input.errorCode : null,
        status: input.status,
        updatedAt: input.now,
      });
      return current;
    }),
    get: vi.fn(async () => current),
    listActive: vi.fn(async () => [current]),
    updateCheckpoint: vi.fn(async (_owner, input) => {
      checkpoints.push(input.checkpoint);
      current = Object.freeze({
        ...current,
        checkpoint: input.checkpoint,
        progress: input.progress,
        updatedAt: input.now,
      });
      return current;
    }),
  };
  return { checkpoints, store };
}

describe("v15 Groq Offscreen production chain (G2/G5)", () => {
  it("resumes one uncertain balanced chunk with only its remaining backup model", async () => {
    const record = recoveryRecord();
    const { checkpoints, store } = createRecoveryStore(record);
    const attemptedModels: GroqWhisperModel[] = [];
    const transcriber = createGroqChunkTranscriber({
      now: () => 2_000,
      provider: {
        transcribe: vi.fn(async (request) => {
          attemptedModels.push(request.model);
          return {
            detectedLanguage: "zh",
            transcript: {
              kind: "timed" as const,
              rows: [{ endMs: 1_000, startMs: 0, text: "recovered backup" }],
            },
          };
        }),
      },
    });
    const commitAcquisition = vi.fn(async (_owner, subtitle) => ({
      branch: { branchId: record.owner.draftBranchId },
      placement: {},
      session: {},
      subtitle,
    }));
    const repository = {
      beginAcquisition: vi.fn(async () => undefined),
      commitAcquisition,
      finishAcquisition: vi.fn(async () => undefined),
      readAcquisitionContext: vi.fn(async () => ({
        expectedContextRevision: 1,
        session: { selectionRevision: 2 },
        video: {
          bvid: "BV1xx411c7mD",
          canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
          cid: 30_000_000_099,
          page: 1,
          title: "v15 recovery fixture",
          videoKey,
        },
      })),
    };
    const executor = createSpeechAcquisitionExecutor({
      chunkProcessor: {
        prepare: vi.fn(async () => [
          {
            bytes: new Uint8Array([4, 2]),
            endMs: 1_000,
            index: 0,
            mimeType: "audio/mp4",
            startMs: 0,
          },
        ]),
      },
      createSubtitleId: () => "subtitle-v15-recovery",
      hashRows: async () => "sha256:v15-recovery",
      mediaGateway: {
        acquireCompleteAudio: vi.fn(async () => ({
          byteLength: 2,
          bytes: new Uint8Array([4, 2]),
          durationMs: 1_000,
          mediaIdentity: "sha256:v15-media",
          mimeType: "audio/mp4",
          videoKey,
        })),
      },
      mergeTimedRows: (_existingRows, chunkRows) => chunkRows,
      now: () => 2_000,
      repository: repository as never,
      transcriber,
    });
    const coordinator = createSpeechAcquisitionCoordinator({
      browserSessionId: "browser-v15",
      createAcquisitionId: () => "unused",
      createDraftBranchId: () => "unused",
      createTaskId: () => "unused",
      executor,
      now: () => 2_000,
      readOwnerContext: async () => null,
      store,
    });

    const [handle] = await coordinator.recover();
    await expect(handle?.result).resolves.toMatchObject({
      subtitleId: "subtitle-v15-recovery",
    });

    expect(attemptedModels).toEqual(["whisper-large-v3"]);
    expect(checkpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          uncertainChunkIndex: 0,
          uncertainChunkRetryCount: 1,
        }),
      ]),
    );
    expect(commitAcquisition).toHaveBeenCalledOnce();
  });

  it("STRUCTURAL: moves Groq ownership out of both Service Worker speech compositions", async () => {
    // The production entrypoints execute broad side effects at import time and
    // expose no injectable composition factory. This assertion is deliberately
    // limited to structural ownership; unit tests own request behavior.
    const [serviceWorkerSource, offscreenSource] = await Promise.all([
      readFile(resolve("src/entries/service-worker.ts"), "utf8"),
      readFile(resolve("src/entries/offscreen.ts"), "utf8"),
    ]);
    const batchSpeechStart = serviceWorkerSource.indexOf(
      "async function getBatchSpeechCoordinator",
    );
    const batchSpeechEnd = serviceWorkerSource.indexOf(
      "function batchSpeechSyntheticSession",
      batchSpeechStart,
    );
    const speechStart = serviceWorkerSource.indexOf(
      "async function getSpeechCoordinator",
    );
    const speechEnd = serviceWorkerSource.indexOf(
      "installChromeSubtitleRuntimeListener",
      speechStart,
    );

    expect(batchSpeechStart).toBeGreaterThanOrEqual(0);
    expect(batchSpeechEnd).toBeGreaterThan(batchSpeechStart);
    expect(speechStart).toBeGreaterThanOrEqual(0);
    expect(speechEnd).toBeGreaterThan(speechStart);

    const compositions = [
      serviceWorkerSource.slice(batchSpeechStart, batchSpeechEnd),
      serviceWorkerSource.slice(speechStart, speechEnd),
    ];
    for (const composition of compositions) {
      expect(composition.includes("createLazySharedGroqChunkTranscriber")).toBe(
        false,
      );
      expect(composition.includes("globalThis.fetch")).toBe(false);
    }

    const offscreenEntry = offscreenSource.toLowerCase();
    expect(offscreenEntry.includes("groq")).toBe(true);
    expect(offscreenEntry.includes("transcrib")).toBe(true);
  });
});
