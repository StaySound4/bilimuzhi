import { createFfmpegAudioChunkProcessor } from "../infrastructure/asr/ffmpeg-chunk-processor";
import { loadBundledFfmpeg } from "../infrastructure/asr/ffmpeg-runtime";
import { installChromeOffscreenAudioListener } from "../infrastructure/chrome-offscreen-audio";
import { installChromeOffscreenGroqTranscriberListener } from "../infrastructure/chrome-offscreen-groq";
import { installChromeOffscreenSpeechTaskKeepaliveListener } from "../infrastructure/chrome-offscreen-keepalive";

export const offscreenAudioChunkProcessor = createFfmpegAudioChunkProcessor({
  createOperationId: () => globalThis.crypto.randomUUID(),
  load: loadBundledFfmpeg,
});

installChromeOffscreenAudioListener(
  Reflect.get(globalThis, "chrome") as unknown,
  offscreenAudioChunkProcessor,
);
installChromeOffscreenSpeechTaskKeepaliveListener(
  Reflect.get(globalThis, "chrome") as unknown,
);
installChromeOffscreenGroqTranscriberListener(
  Reflect.get(globalThis, "chrome") as unknown,
);

document.documentElement.dataset.muzhiOffscreen = "ready";
