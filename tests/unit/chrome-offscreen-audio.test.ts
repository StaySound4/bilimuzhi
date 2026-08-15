import { describe, expect, it, vi } from "vitest";

import {
  ASR_TRANSIENT_CACHE_NAME,
  createChromeOffscreenAudioChunkProcessor,
  installChromeOffscreenAudioListener,
} from "../../src/infrastructure/chrome-offscreen-audio";

function createCacheStorage() {
  const values = new Map<string, Response>();
  const cache = {
    delete: vi.fn(async (request: RequestInfo) =>
      values.delete(typeof request === "string" ? request : request.url),
    ),
    keys: vi.fn(async () => [...values.keys()].map((url) => new Request(url))),
    match: vi.fn(async (request: RequestInfo) =>
      values.get(typeof request === "string" ? request : request.url)?.clone(),
    ),
    put: vi.fn(async (request: RequestInfo, response: Response) => {
      values.set(
        typeof request === "string" ? request : request.url,
        response.clone(),
      );
    }),
  } as unknown as Cache;
  return {
    cache,
    cacheStorage: {
      open: vi.fn(async (name: string) => {
        expect(name).toBe(ASR_TRANSIENT_CACHE_NAME);
        return cache;
      }),
    } as unknown as CacheStorage,
    values,
  };
}

function createRuntime() {
  const listeners: Array<
    (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean
  > = [];
  const runtime = {
    onMessage: {
      addListener: (listener: (typeof listeners)[number]) => {
        listeners.push(listener);
      },
      removeListener: (listener: (typeof listeners)[number]) => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    },
    sendMessage: vi.fn(
      async (message: unknown) =>
        await new Promise<unknown>((resolve, reject) => {
          let responded = false;
          const sendResponse = (value: unknown): void => {
            responded = true;
            resolve(value);
          };
          const accepted = listeners.some((listener) =>
            listener(message, {}, sendResponse),
          );
          if (!accepted && !responded)
            reject(new Error("No message listener accepted command"));
        }),
    ),
  };
  return { chromeValue: { runtime }, listeners, runtime };
}

describe("Chrome Offscreen audio bridge", () => {
  it("acknowledges preparation before long audio work so Chrome never waits on one message channel", async () => {
    const { cache, cacheStorage } = createCacheStorage();
    const { chromeValue, listeners } = createRuntime();
    let finishPreparation!: (
      chunks: readonly {
        bytes: Uint8Array;
        endMs: number;
        index: number;
        mimeType: string;
        startMs: number;
      }[],
    ) => void;
    const prepare = vi.fn(
      async () =>
        await new Promise<
          readonly {
            bytes: Uint8Array;
            endMs: number;
            index: number;
            mimeType: string;
            startMs: number;
          }[]
        >((resolve) => {
          finishPreparation = resolve;
        }),
    );
    installChromeOffscreenAudioListener(chromeValue, { prepare }, cacheStorage);
    const inputCacheUrl = "https://muzhi.invalid/asr/operation-channel/input";
    await cache.put(
      inputCacheUrl,
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "audio/mp4" },
      }),
    );
    const sendResponse = vi.fn();

    expect(
      listeners[0]?.(
        {
          durationMs: 1_000,
          inputCacheUrl,
          mimeType: "audio/mp4",
          operationId: "operation-channel",
          type: "muzhi.offscreen.audio.prepare",
          version: 2,
        },
        {},
        sendResponse,
      ),
    ).toBe(false);
    expect(sendResponse).toHaveBeenCalledOnce();
    expect(sendResponse).toHaveBeenCalledWith({
      operationId: "operation-channel",
      type: "muzhi.offscreen.audio.accepted",
      version: 2,
    });

    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledOnce();
    finishPreparation([
      {
        bytes: new Uint8Array([7, 8]),
        endMs: 1_000,
        index: 0,
        mimeType: "audio/mp4",
        startMs: 0,
      },
    ]);
    await vi.waitFor(() => expect(cache.put).toHaveBeenCalledTimes(2));
  });

  it("reattaches after a lost prepare acknowledgement instead of failing the whole speech task", async () => {
    const { cacheStorage } = createCacheStorage();
    const { chromeValue, runtime } = createRuntime();
    const prepare = vi.fn(async () => [
      {
        bytes: new Uint8Array([9, 8]),
        endMs: 2_000,
        index: 0,
        mimeType: "audio/mp4",
        startMs: 0,
      },
    ]);
    installChromeOffscreenAudioListener(chromeValue, { prepare }, cacheStorage);
    const dispatch = runtime.sendMessage.getMockImplementation();
    if (!dispatch) throw new Error("Missing fake Chrome message dispatcher");
    let droppedAcknowledgement = false;
    runtime.sendMessage.mockImplementation(async (message: unknown) => {
      const response = await dispatch(message);
      if (
        !droppedAcknowledgement &&
        typeof message === "object" &&
        message !== null &&
        Reflect.get(message, "type") === "muzhi.offscreen.audio.prepare"
      ) {
        droppedAcknowledgement = true;
        throw new Error(
          "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
        );
      }
      return response;
    });
    const client = createChromeOffscreenAudioChunkProcessor(
      chromeValue,
      {
        createDocument: vi.fn(async () => undefined),
        hasDocument: async () => true,
      },
      cacheStorage,
    );

    await expect(
      client.prepare({
        bytes: new Uint8Array([1, 2, 3]),
        durationMs: 2_000,
        mimeType: "audio/mp4",
        operationId: "operation-lost-ack",
      }),
    ).resolves.toEqual([
      {
        bytes: new Uint8Array([9, 8]),
        endMs: 2_000,
        index: 0,
        mimeType: "audio/mp4",
        startMs: 0,
      },
    ]);
    expect(droppedAcknowledgement).toBe(true);
    expect(prepare).toHaveBeenCalledOnce();
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      operationId: "operation-lost-ack",
      type: "muzhi.offscreen.audio.release",
      version: 2,
    });
  });

  it("moves bytes through transient Cache Storage and cleans every operation artifact", async () => {
    const { cacheStorage, values } = createCacheStorage();
    const { chromeValue, runtime } = createRuntime();
    installChromeOffscreenAudioListener(
      chromeValue,
      {
        prepare: vi.fn(async (input) => {
          await input.onProgress?.({
            completedUnits: 0.5,
            phase: "encoding",
            totalUnits: 1,
          });
          return [
            {
              bytes: new Uint8Array([7, 8]),
              endMs: 1_000,
              index: 0,
              mimeType: "audio/mp4",
              startMs: 0,
            },
          ];
        }),
      },
      cacheStorage,
    );
    const createDocument = vi.fn(async () => undefined);
    const client = createChromeOffscreenAudioChunkProcessor(
      chromeValue,
      { createDocument, hasDocument: async () => false },
      cacheStorage,
    );
    const onProgress = vi.fn(async () => undefined);

    await expect(
      client.prepare({
        bytes: new Uint8Array([1, 2, 3]),
        durationMs: 1_000,
        mimeType: "audio/mp4",
        operationId: "operation-1",
        onProgress,
      }),
    ).resolves.toEqual([
      {
        bytes: new Uint8Array([7, 8]),
        endMs: 1_000,
        index: 0,
        mimeType: "audio/mp4",
        startMs: 0,
      },
    ]);
    expect(createDocument).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({
      completedUnits: 0.5,
      phase: "encoding",
      totalUnits: 1,
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "operation-1",
        type: "muzhi.offscreen.audio.prepare",
      }),
    );
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      operationId: "operation-1",
      type: "muzhi.offscreen.audio.release",
      version: 2,
    });
    expect(values.size).toBe(0);
  });

  it("restarts a released operation instead of reusing deleted chunk cache", async () => {
    const { cacheStorage } = createCacheStorage();
    const { chromeValue } = createRuntime();
    const prepare = vi.fn(async () => [
      {
        bytes: new Uint8Array([4, 2]),
        endMs: 1_000,
        index: 0,
        mimeType: "audio/mp4",
        startMs: 0,
      },
    ]);
    installChromeOffscreenAudioListener(chromeValue, { prepare }, cacheStorage);
    const client = createChromeOffscreenAudioChunkProcessor(
      chromeValue,
      {
        createDocument: vi.fn(async () => undefined),
        hasDocument: async () => true,
      },
      cacheStorage,
    );
    const input = {
      bytes: new Uint8Array([1, 2, 3]),
      durationMs: 1_000,
      mimeType: "audio/mp4",
      operationId: "operation-resume",
    } as const;

    await expect(client.prepare(input)).resolves.toHaveLength(1);
    await expect(client.prepare(input)).resolves.toHaveLength(1);

    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
