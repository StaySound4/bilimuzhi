import { describe, expect, it, vi } from "vitest";

import {
  RUNTIME_PROTOCOL_VERSION,
  type RuntimeCommand,
  type RuntimeEvent,
} from "../../src/application/runtime-contract";
import type { VideoKey } from "../../src/domain";
import { installChromeContentPlayerRelay } from "../../src/infrastructure/chrome-content-player-relay";
import {
  createChromePlayerRuntimeClient,
  type ChromePlayerRuntimeClientDependencies,
} from "../../src/infrastructure/chrome-player-runtime";

const videoKey =
  "bvid:BV1Q541167Qg:cid:30000000007:p:7" as const satisfies VideoKey;
const seconds = 42.5;

interface OpenTargetConfirmation {
  readonly canonicalUrl: string;
  readonly seconds: number;
  readonly videoKey: VideoKey;
}

interface V14PlayerRuntimeDependencies extends ChromePlayerRuntimeClientDependencies {
  readonly confirmOpenTarget: (
    confirmation: OpenTargetConfirmation,
  ) => Promise<boolean>;
}

type RelayListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

type SeekCommand = Extract<RuntimeCommand, { type: "muzhi.video.seek" }>;

function createRouteHarness(input: {
  readonly confirm: boolean;
  readonly exactTabs?: readonly { readonly id: number; readonly url: string }[];
}) {
  let relayListener: RelayListener | undefined;
  const confirmOpenTarget = vi.fn(async () => input.confirm);
  const query = vi.fn(async (queryInfo: Record<string, unknown>) => {
    if (queryInfo.active === true) {
      return [{ id: 1, url: "chrome://extensions/" }];
    }
    return input.exactTabs ?? [];
  });
  const create = vi.fn(async ({ url }: { readonly url: string }) => ({
    id: 88,
    url,
  }));
  const update = vi.fn(async () => undefined);
  const sendToContent = vi.fn(
    async (tabId: number, command: SeekCommand): Promise<RuntimeEvent> => {
      if (!Number.isSafeInteger(tabId) || tabId <= 0) {
        throw new Error("The relay fixture requires a positive tab id");
      }
      return {
        payload: command.payload,
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.video.seeked",
      };
    },
  );

  installChromeContentPlayerRelay(
    {
      runtime: {
        onMessage: {
          addListener(listener: RelayListener) {
            relayListener = listener;
          },
        },
      },
      tabs: { create, query, sendMessage: sendToContent, update },
    },
    { allocateSeekSequence: async () => 1 },
  );

  const sendMessage = vi.fn(
    (command: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        if (!relayListener?.(command, {}, resolve)) {
          reject(new Error("The player relay rejected the command"));
        }
      }),
  );
  const dependencies: V14PlayerRuntimeDependencies = {
    confirmOpenTarget,
    createRequestId: () => "v14-player-route",
  };
  const client = createChromePlayerRuntimeClient(
    { runtime: { sendMessage } },
    dependencies,
  );

  return {
    client,
    confirmOpenTarget,
    create,
    query,
    sendMessage,
    sendToContent,
    update,
  };
}

describe("v14 explicit player route", () => {
  it("activates an exact BVID/page tab and seeks even when the original page is stale", async () => {
    const exactUrl = "https://www.bilibili.com/video/BV1Q541167Qg?p=7";
    const route = createRouteHarness({
      confirm: false,
      exactTabs: [{ id: 77, url: exactUrl }],
    });

    await expect(route.client.navigate(videoKey, seconds)).resolves.toBe(
      "seeked",
    );

    expect(route.confirmOpenTarget).not.toHaveBeenCalled();
    expect(route.create).not.toHaveBeenCalled();
    expect(route.update).toHaveBeenCalledWith(77, { active: true });
    expect(route.sendToContent).toHaveBeenCalledWith(
      77,
      expect.objectContaining({
        payload: { seconds, videoKey },
        type: "muzhi.video.seek",
      }),
    );
  });

  it("asks before opening a missing target and cancellation has zero side effects", async () => {
    const route = createRouteHarness({ confirm: false });

    await expect(route.client.navigate(videoKey, seconds)).resolves.toBe(
      "cancelled",
    );

    expect(route.confirmOpenTarget).toHaveBeenCalledOnce();
    expect(route.confirmOpenTarget).toHaveBeenCalledWith({
      canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=7&t=42.5",
      seconds,
      videoKey,
    });
    expect(route.create).not.toHaveBeenCalled();
    expect(route.sendToContent).not.toHaveBeenCalled();
  });

  it("opens a single-part canonical URL without inventing p=1", async () => {
    const singlePart =
      "bvid:BV1n9uA6KEcW:cid:40593459287:p:1" as const satisfies VideoKey;
    const route = createRouteHarness({ confirm: false });

    await expect(route.client.navigate(singlePart, 72)).resolves.toBe(
      "cancelled",
    );
    expect(route.confirmOpenTarget).toHaveBeenCalledWith({
      canonicalUrl: "https://www.bilibili.com/video/BV1n9uA6KEcW?t=72",
      seconds: 72,
      videoKey: singlePart,
    });
  });

  it("opens the canonical URL and reports success only after the new player confirms seek", async () => {
    const route = createRouteHarness({ confirm: true });

    await expect(route.client.navigate(videoKey, seconds)).resolves.toBe(
      "seeked",
    );

    expect(route.confirmOpenTarget).toHaveBeenCalledOnce();
    expect(route.create).toHaveBeenCalledOnce();
    const createdUrl = new URL(route.create.mock.calls[0][0].url);
    expect(createdUrl.origin).toBe("https://www.bilibili.com");
    expect(createdUrl.pathname).toBe("/video/BV1Q541167Qg");
    expect(createdUrl.searchParams.get("p")).toBe("7");
    expect(createdUrl.searchParams.get("t")).toBe(String(seconds));
    expect(route.sendToContent).toHaveBeenCalledWith(
      88,
      expect.objectContaining({ payload: { seconds, videoKey } }),
    );
  });
});
