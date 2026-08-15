import { installContentPlayerBridge } from "../infrastructure/content-player-bridge";
import { installContentMediaBridge } from "../infrastructure/content-media-bridge";

const chromeValue = Reflect.get(globalThis, "chrome") as {
  readonly runtime: { sendMessage(message: unknown): Promise<unknown> };
};

installContentPlayerBridge(chromeValue, document);
installContentMediaBridge(chromeValue.runtime, window);
