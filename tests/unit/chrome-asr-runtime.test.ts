import { describe, expect, it, vi } from "vitest";

import {
  SPEECH_RECORD_PREFIX,
  createChromeOffscreenSpeechRuntime,
  createChromeSpeechAcquisitionStore,
} from "../../src/infrastructure/chrome-asr-runtime";
import { createVideoRef } from "../../src/domain";

const video = createVideoRef({
  bvid: "BV1Q541167Qg",
  canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg",
  cid: 30_000_000_001,
  page: 1,
  title: "语音测试",
});

function createStorage() {
  const values: Record<string, unknown> = {};
  return {
    storage: {
      get: vi.fn(async (key: string | null) =>
        key === null ? { ...values } : { [key]: values[key] },
      ),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(values, items);
      }),
    },
    values,
  };
}

function record() {
  return {
    browserSessionId: "browser-1",
    checkpoint: null,
    createdAt: 1,
    errorCode: null,
    owner: {
      acquisitionId: "acquisition-1",
      draftBranchId: "branch-1",
      expectedContextRevision: 1,
      expectedSelectionRevision: 1,
      sessionId: "session-1",
      taskId: "task-1",
      videoKey: video.videoKey,
    },
    parameters: {
      model: "whisper-large-v3",
      provider: "groq" as const,
      requestedLanguageMode: "mixed" as const,
      routingMode: "balanced" as const,
    },
    progress: {
      completedChunks: 0,
      stage: "preparing" as const,
      totalChunks: 0,
    },
    status: "queued" as const,
    updatedAt: 1,
  };
}

describe("Chrome speech runtime persistence", () => {
  it("persists only safe task/checkpoint data and excludes terminal records from recovery", async () => {
    const { storage, values } = createStorage();
    const store = createChromeSpeechAcquisitionStore(storage);
    const started = await store.begin(record());
    expect(started.status).toBe("running");
    expect(JSON.stringify(values)).not.toContain("apiKey");
    expect(JSON.stringify(values)).not.toContain("https://");
    await expect(store.listActive()).resolves.toHaveLength(1);
    await store.finish(started.owner, { now: 2, status: "cancelled" });
    await expect(store.listActive()).resolves.toHaveLength(0);
    await expect(store.get(started.owner)).resolves.toMatchObject({
      status: "cancelled",
    });
    expect(values[`${SPEECH_RECORD_PREFIX}task-1`]).toMatchObject({
      status: "cancelled",
    });
  });

  it("deduplicates concurrent Offscreen document creation", async () => {
    let resolve!: () => void;
    const createDocument = vi.fn(
      async () =>
        await new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const runtime = createChromeOffscreenSpeechRuntime({
      createDocument,
      hasDocument: async () => false,
    });
    const first = runtime.ensureDocument();
    const second = runtime.ensureDocument();
    await Promise.resolve();
    expect(createDocument).toHaveBeenCalledOnce();
    resolve();
    await Promise.all([first, second]);
    expect(createDocument).toHaveBeenCalledWith({
      justification: "处理用户明确启动的语音转字幕任务",
      reasons: ["WORKERS"],
      url: "offscreen.html",
    });
  });

  it("reattaches safely when an older Chrome runtime reports an existing Offscreen document", async () => {
    const runtime = createChromeOffscreenSpeechRuntime({
      createDocument: vi.fn(async () => {
        throw new Error("Only a single offscreen document may be created.");
      }),
    });
    await expect(runtime.ensureDocument()).resolves.toBeUndefined();
  });

  it("allows ordinary subtitle text containing a URL while rejecting credential fields", async () => {
    const { storage, values } = createStorage();
    const store = createChromeSpeechAcquisitionStore(storage);
    const started = await store.begin(record());
    await store.updateCheckpoint(started.owner, {
      checkpoint: {
        browserSessionId: "browser-1",
        completedChunks: [
          {
            chunkIndex: 0,
            detectedLanguage: "zh",
            endMs: 1_000,
            model: "whisper-large-v3",
            transcript: {
              kind: "timed",
              rows: [
                {
                  endMs: 1_000,
                  startMs: 0,
                  text: "资料见 https://example.com",
                },
              ],
            },
          },
        ],
        mediaIdentity: "sha256:media",
        uncertainChunkIndex: null,
        uncertainChunkRetryCount: 0,
      },
      now: 2,
      progress: { completedChunks: 1, stage: "merging", totalChunks: 1 },
    });
    await expect(store.listActive()).resolves.toHaveLength(1);

    const key = `${SPEECH_RECORD_PREFIX}task-1`;
    values[key] = {
      ...(values[key] as Record<string, unknown>),
      apiKey: "must-not-load",
    };
    await expect(store.listActive()).resolves.toHaveLength(0);
  });
});
