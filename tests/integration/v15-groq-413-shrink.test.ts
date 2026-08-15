import { describe, expect, it, vi } from "vitest";

import {
  ASR_MAX_SHRINK_ROUNDS,
  GROQ_SAFE_MAX_AUDIO_BYTES,
  type AudioChunkProcessor,
  type GroqWhisperProvider,
  type PreparedAudioChunk,
} from "../../src/application/asr-contract";
import { createSpeechAcquisitionExecutor } from "../../src/application/asr/speech-acquisition-executor";
import { GroqWhisperError } from "../../src/infrastructure/asr/groq-provider";
import { createGroqChunkTranscriber } from "../../src/infrastructure/asr/groq-transcriber";

const TURBO = "whisper-large-v3-turbo" as const;
const videoKey = "bvid:BV1xx411c7mD:cid:30000000113:p:1" as const;
const owner = Object.freeze({
  acquisitionId: "acquisition-v15-413",
  draftBranchId: "branch-v15-413",
  expectedContextRevision: 1,
  expectedSelectionRevision: 4,
  sessionId: "session-v15-413",
  taskId: "task-v15-413",
  videoKey,
});

type PrepareInput = Parameters<AudioChunkProcessor["prepare"]>[0] & {
  /** Optional v15 collaborator seam: a stricter local encode ceiling. */
  readonly maxChunkBytes?: number;
};

function record() {
  return Object.freeze({
    browserSessionId: "browser-v15",
    checkpoint: null,
    createdAt: 1_000,
    errorCode: null,
    owner,
    parameters: Object.freeze({
      model: "whisper-large-v3",
      provider: "groq" as const,
      requestedLanguageMode: "mixed" as const,
      routingMode: "turbo-first" as const,
    }),
    progress: Object.freeze({
      completedChunks: 0,
      stage: "preparing" as const,
      totalChunks: 0,
    }),
    status: "running" as const,
    updatedAt: 1_000,
  });
}

function prepared(bytes: Readonly<Uint8Array>): PreparedAudioChunk {
  return Object.freeze({
    bytes,
    endMs: 60_000,
    index: 0,
    mimeType: "audio/mp4",
    startMs: 0,
  });
}

function createRepository() {
  const oldSubtitleContext = {
    rows: [{ endMs: 1_000, startMs: 0, text: "old subtitle remains" }],
    subtitleId: "subtitle-old",
  };
  const originalOldSubtitle = structuredClone(oldSubtitleContext);
  const beginAcquisition = vi.fn(async () => undefined);
  const finishAcquisition = vi.fn(async () => undefined);
  const commitAcquisition = vi.fn(async (_owner, staged) => {
    oldSubtitleContext.rows = structuredClone(staged.rows);
    oldSubtitleContext.subtitleId = staged.subtitleId;
    return {
      branch: { branchId: staged.branchId },
      placement: {},
      session: {},
      subtitle: staged,
    };
  });
  const repository = {
    beginAcquisition,
    commitAcquisition,
    finishAcquisition,
    readAcquisitionContext: vi.fn(async () => ({
      expectedContextRevision: 1,
      session: { selectionRevision: 4 },
      video: {
        bvid: "BV1xx411c7mD",
        canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
        cid: 30_000_000_113,
        page: 1,
        title: "v15 413 fixture",
        videoKey,
      },
    })),
  };
  return {
    beginAcquisition,
    commitAcquisition,
    finishAcquisition,
    oldSubtitleContext,
    originalOldSubtitle,
    repository,
  };
}

function createExecutor(input: {
  readonly prepare: AudioChunkProcessor["prepare"];
  readonly repository: ReturnType<typeof createRepository>["repository"];
  readonly providerTranscribe: GroqWhisperProvider["transcribe"];
}) {
  return createSpeechAcquisitionExecutor({
    chunkProcessor: { prepare: input.prepare },
    createSubtitleId: () => "subtitle-v15-413",
    hashRows: async () => "sha256:v15-413",
    mediaGateway: {
      acquireCompleteAudio: vi.fn(async () => ({
        byteLength: 8,
        bytes: new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]),
        durationMs: 60_000,
        mediaIdentity: "sha256:v15-413-media",
        mimeType: "audio/mp4",
        videoKey,
      })),
    },
    mergeTimedRows: (_existing, incoming) => incoming,
    now: () => 2_000,
    repository: input.repository as never,
    transcriber: createGroqChunkTranscriber({
      now: () => 2_000,
      provider: { transcribe: input.providerTranscribe },
    }),
  });
}

function execute(executor: ReturnType<typeof createSpeechAcquisitionExecutor>) {
  return executor.execute({
    onCheckpoint: vi.fn(async () => undefined),
    record: record(),
    signal: new AbortController().signal,
  });
}

function requestLengths(
  calls: ReadonlyArray<Parameters<GroqWhisperProvider["transcribe"]>>,
): number[] {
  return calls.map(([request]) => request.chunk.bytes.byteLength);
}

describe("v15 server 413 local bounded shrink (G3/G5)", () => {
  it("re-encodes locally to a smaller target before one new Provider request and commits once", async () => {
    const largeBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const smallerBytes = new Uint8Array([1, 2, 3, 4]);
    const prepare = vi.fn(async (input: PrepareInput) => {
      if (input.maxChunkBytes === undefined) return [prepared(largeBytes)];
      if (
        input.maxChunkBytes <= 0 ||
        input.maxChunkBytes >= GROQ_SAFE_MAX_AUDIO_BYTES
      ) {
        throw new Error("The local shrink target was not strictly smaller");
      }
      return [prepared(smallerBytes)];
    });
    const providerTranscribe = vi
      .fn<GroqWhisperProvider["transcribe"]>()
      .mockRejectedValueOnce(
        new GroqWhisperError(
          "FILE_TOO_LARGE",
          "safe fixture 413 classification",
          false,
        ),
      )
      .mockResolvedValueOnce({
        detectedLanguage: "zh",
        transcript: {
          kind: "timed" as const,
          rows: [{ endMs: 1_000, startMs: 0, text: "smaller success" }],
        },
      });
    const fixture = createRepository();
    const executor = createExecutor({
      prepare,
      providerTranscribe,
      repository: fixture.repository,
    });

    await expect(execute(executor)).resolves.toMatchObject({
      rowCount: 1,
      subtitleId: "subtitle-v15-413",
    });

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(prepare.mock.calls[1]?.[0].maxChunkBytes).toBeGreaterThan(0);
    expect(prepare.mock.calls[1]?.[0].maxChunkBytes).toBeLessThan(
      GROQ_SAFE_MAX_AUDIO_BYTES,
    );
    expect(requestLengths(providerTranscribe.mock.calls)).toEqual([8, 4]);
    expect(
      providerTranscribe.mock.calls.map(([request]) => request.model),
    ).toEqual([TURBO, TURBO]);
    expect(fixture.commitAcquisition).toHaveBeenCalledOnce();
    expect(fixture.finishAcquisition).not.toHaveBeenCalled();
  });

  it("bounds repeated 413 shrinking and preserves the old subtitle when exhaustion remains too large", async () => {
    const prepare = vi.fn(async (input: PrepareInput) => {
      const callIndex = prepare.mock.calls.length;
      if (callIndex > ASR_MAX_SHRINK_ROUNDS + 1) {
        throw new Error("The executor exceeded the frozen local shrink bound");
      }
      if (callIndex > 1) {
        const previousTarget =
          prepare.mock.calls[callIndex - 2]?.[0].maxChunkBytes ??
          GROQ_SAFE_MAX_AUDIO_BYTES;
        if (
          input.maxChunkBytes === undefined ||
          input.maxChunkBytes <= 0 ||
          input.maxChunkBytes >= previousTarget
        ) {
          throw new Error("The local shrink target did not decrease");
        }
      }
      return [prepared(new Uint8Array(12 - callIndex))];
    });
    const providerTranscribe = vi.fn<GroqWhisperProvider["transcribe"]>(
      async () => {
        throw new GroqWhisperError(
          "FILE_TOO_LARGE",
          "safe fixture 413 classification",
          false,
        );
      },
    );
    const fixture = createRepository();
    const executor = createExecutor({
      prepare,
      providerTranscribe,
      repository: fixture.repository,
    });

    await expect(execute(executor)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });

    expect(prepare.mock.calls.length).toBeGreaterThan(1);
    expect(prepare.mock.calls.length).toBeLessThanOrEqual(
      ASR_MAX_SHRINK_ROUNDS + 1,
    );
    expect(providerTranscribe).toHaveBeenCalledTimes(prepare.mock.calls.length);
    const lengths = requestLengths(providerTranscribe.mock.calls);
    expect(
      lengths.every(
        (length, index) => index === 0 || length < lengths[index - 1]!,
      ),
    ).toBe(true);
    expect(
      providerTranscribe.mock.calls.every(
        ([request]) => request.model === TURBO,
      ),
    ).toBe(true);
    expect(fixture.commitAcquisition).not.toHaveBeenCalled();
    expect(fixture.finishAcquisition).toHaveBeenCalledWith(owner, "failed");
    expect(fixture.oldSubtitleContext).toEqual(fixture.originalOldSubtitle);
  });
});
