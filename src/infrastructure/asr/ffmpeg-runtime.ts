import type { FfmpegEngine } from "./ffmpeg-chunk-processor";

let enginePromise: Promise<FfmpegEngine> | null = null;

export async function loadBundledFfmpeg(): Promise<FfmpegEngine> {
  if (enginePromise) return enginePromise;
  const loading: Promise<FfmpegEngine> = (async () => {
    const [{ FFmpeg }, coreModule, wasmModule] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/core?url"),
      import("@ffmpeg/core/wasm?url"),
    ]);
    const ffmpeg = new FFmpeg();
    await ffmpeg.load({
      coreURL: coreModule.default,
      wasmURL: wasmModule.default,
    });
    const engine: FfmpegEngine = Object.freeze({
      deleteFile: (path: string) => ffmpeg.deleteFile(path),
      exec: async (
        arguments_: readonly string[],
        onProgress?: (progress: number) => void,
      ) => {
        const listener = (event: { progress: number }): void => {
          onProgress?.(event.progress);
        };
        if (onProgress) ffmpeg.on("progress", listener);
        try {
          return await ffmpeg.exec([...arguments_]);
        } finally {
          if (onProgress) ffmpeg.off("progress", listener);
        }
      },
      readFile: async (path: string) => {
        const value = await ffmpeg.readFile(path);
        if (typeof value === "string") return new TextEncoder().encode(value);
        return Uint8Array.from(value);
      },
      terminate: () => {
        ffmpeg.terminate();
        enginePromise = null;
      },
      writeFile: (path: string, bytes: Uint8Array) =>
        ffmpeg.writeFile(path, bytes),
    });
    return engine;
  })().catch((error: unknown) => {
    enginePromise = null;
    throw error;
  });
  enginePromise = loading;
  return loading;
}
