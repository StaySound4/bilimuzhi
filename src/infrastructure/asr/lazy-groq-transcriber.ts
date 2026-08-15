import type {
  GroqChunkTranscriber,
  GroqWhisperProvider,
} from "../../application/asr-contract";
import { GroqWhisperError } from "./groq-provider";
import { createGroqChunkTranscriber } from "./groq-transcriber";

export interface LazySharedGroqChunkTranscriberDependencies {
  readonly createProvider: () => Promise<GroqWhisperProvider>;
  readonly now: () => number;
}

interface TranscriberState {
  promise: Promise<GroqChunkTranscriber>;
  ready: boolean;
}

function shouldReloadProvider(error: unknown): boolean {
  return (
    error instanceof GroqWhisperError &&
    (error.code === "AUTHENTICATION_REQUIRED" ||
      error.code === "PERMISSION_DENIED")
  );
}

export function createLazySharedGroqChunkTranscriber(
  dependencies: LazySharedGroqChunkTranscriberDependencies,
): GroqChunkTranscriber {
  let state: TranscriberState | null = null;

  const createState = (): TranscriberState => {
    const next: TranscriberState = {
      promise: Promise.resolve(null as never),
      ready: false,
    };
    next.promise = dependencies.createProvider().then((provider) => {
      next.ready = true;
      return createGroqChunkTranscriber({
        now: dependencies.now,
        provider,
      });
    });
    return next;
  };

  return Object.freeze({
    async transcribe(input: Parameters<GroqChunkTranscriber["transcribe"]>[0]) {
      const active = (state ??= createState());
      try {
        const transcriber = await active.promise;
        return await transcriber.transcribe(input);
      } catch (error) {
        if (
          state === active &&
          (!active.ready || shouldReloadProvider(error))
        ) {
          state = null;
        }
        throw error;
      }
    },
  });
}
