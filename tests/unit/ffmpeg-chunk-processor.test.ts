import { describe, expect, it, vi } from "vitest";

import { createFfmpegAudioChunkProcessor } from "../../src/infrastructure/asr/ffmpeg-chunk-processor";

function createEngine(outputs: readonly Uint8Array[]) {
  let readIndex = 0;
  return {
    deleteFile: vi.fn<(path: string) => Promise<void>>(async () => undefined),
    exec: vi.fn<
      (
        arguments_: readonly string[],
        onProgress?: (progress: number) => void,
      ) => Promise<number>
    >(async () => 0),
    readFile: vi.fn<(path: string) => Promise<Uint8Array>>(
      async () => outputs[readIndex++] ?? new Uint8Array([1]),
    ),
    terminate: vi.fn(),
    writeFile: vi.fn<(path: string, bytes: Uint8Array) => Promise<void>>(
      async () => undefined,
    ),
  };
}

describe("FFmpeg audio chunk processor", () => {
  it("loads lazily, creates unique files, and cleans every temporary file", async () => {
    const engine = createEngine([new Uint8Array([1, 2, 3])]);
    const load = vi.fn(async () => engine);
    const processor = createFfmpegAudioChunkProcessor({
      createOperationId: () => "task-1",
      load,
    });

    expect(load).not.toHaveBeenCalled();
    await expect(
      processor.prepare({
        bytes: new Uint8Array([1, 2, 3, 4]),
        durationMs: 10_000,
        mimeType: "audio/mp4",
        operationId: "ffmpeg-one",
      }),
    ).resolves.toEqual([
      {
        bytes: new Uint8Array([1, 2, 3]),
        endMs: 10_000,
        index: 0,
        mimeType: "audio/mp4",
        startMs: 0,
      },
    ]);
    expect(load).toHaveBeenCalledOnce();
    expect(engine.writeFile).toHaveBeenCalledWith(
      "task-1-input.bin",
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(engine.exec.mock.calls[0]?.[0]).toContain("task-1-r0-c0.m4a");
    // AAC 免重编码切片：直接复制音轨流，不经过 libmp3lame 重编码。
    const ffmpegArgs = engine.exec.mock.calls[0]?.[0] ?? [];
    expect(ffmpegArgs).toContain("-c");
    expect(ffmpegArgs).toContain("copy");
    expect(ffmpegArgs.join(" ")).not.toMatch(/libmp3lame|-b:a/);
    expect(engine.deleteFile).toHaveBeenCalledWith("task-1-r0-c0.m4a");
    expect(engine.deleteFile).toHaveBeenCalledWith("task-1-input.bin");
  });

  it("shrinks oversized exports using a new round filename", async () => {
    const engine = createEngine([
      new Uint8Array(24_000_001),
      new Uint8Array([1]),
    ]);
    const processor = createFfmpegAudioChunkProcessor({
      createOperationId: () => "task-2",
      load: async () => engine,
    });

    await processor.prepare({
      bytes: new Uint8Array(20),
      durationMs: 60_000,
      mimeType: "audio/mp4",
      operationId: "ffmpeg-two",
    });

    expect(engine.exec.mock.calls.map((call) => call[0]?.at(-1))).toEqual([
      // 第一轮 1 段超限后缩小：第二轮按更小时长切成 2 段。
      "task-2-r0-c0.m4a",
      "task-2-r1-c0.m4a",
      "task-2-r1-c1.m4a",
    ]);
  });

  it("terminates and reports AbortError when cancelled", async () => {
    const controller = new AbortController();
    const engine = createEngine([new Uint8Array([1])]);
    engine.exec.mockImplementationOnce(async () => {
      controller.abort();
      return 0;
    });
    const processor = createFfmpegAudioChunkProcessor({
      createOperationId: () => "task-3",
      load: async () => engine,
    });

    await expect(
      processor.prepare({
        bytes: new Uint8Array([1]),
        durationMs: 1_000,
        mimeType: "audio/mp4",
        operationId: "ffmpeg-three",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(engine.terminate).toHaveBeenCalledOnce();
    expect(engine.deleteFile).toHaveBeenCalledWith("task-3-input.bin");
  });

  it("forwards real FFmpeg progress through loading, encoding, and reading", async () => {
    const engine = createEngine([new Uint8Array([1, 2, 3])]);
    engine.exec.mockImplementationOnce(async (_arguments, onProgress) => {
      onProgress?.(0.25);
      onProgress?.(0.75);
      return 0;
    });
    const onProgress = vi.fn<
      (progress: {
        completedUnits: number;
        phase: "loading" | "encoding" | "reading";
        totalUnits: number;
      }) => Promise<void>
    >(async () => undefined);
    const processor = createFfmpegAudioChunkProcessor({
      createOperationId: () => "task-progress",
      load: async () => engine,
    });

    await processor.prepare({
      bytes: new Uint8Array([1, 2, 3, 4]),
      durationMs: 10_000,
      mimeType: "audio/mp4",
      operationId: "ffmpeg-four",
      onProgress,
    });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual(
      expect.arrayContaining([
        { completedUnits: 0, phase: "loading", totalUnits: 1 },
        { completedUnits: 1, phase: "loading", totalUnits: 1 },
        { completedUnits: 0.25, phase: "encoding", totalUnits: 1 },
        { completedUnits: 0.75, phase: "encoding", totalUnits: 1 },
        { completedUnits: 1, phase: "encoding", totalUnits: 1 },
        { completedUnits: 0, phase: "reading", totalUnits: 1 },
        { completedUnits: 1, phase: "reading", totalUnits: 1 },
      ]),
    );
  });
});
