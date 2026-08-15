import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createChromeOffscreenSpeechTaskKeepalive,
  installChromeOffscreenSpeechTaskKeepaliveListener,
} from "../../src/infrastructure/chrome-offscreen-keepalive";

type Listener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

function createRuntime() {
  const listeners: Listener[] = [];
  const runtime = {
    onMessage: {
      addListener(listener: Listener) {
        listeners.push(listener);
      },
    },
    sendMessage: vi.fn(async (message: unknown) => {
      let response: unknown;
      for (const listener of [...listeners]) {
        listener(message, {}, (value) => {
          response = value;
        });
      }
      return response;
    }),
  };
  return { chromeValue: { runtime }, listeners, runtime };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Chrome Offscreen speech task keepalive", () => {
  it("acknowledges leases synchronously and pulses only while work is active", async () => {
    vi.useFakeTimers();
    const { chromeValue, listeners, runtime } = createRuntime();
    installChromeOffscreenSpeechTaskKeepaliveListener(chromeValue, 1_000);
    const sendResponse = vi.fn();

    expect(
      listeners[0]?.(
        {
          operationId: "speech-task-1",
          type: "muzhi.offscreen.keepalive.acquire",
          version: 1,
        },
        {},
        sendResponse,
      ),
    ).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith({
      operationId: "speech-task-1",
      type: "muzhi.offscreen.keepalive.acknowledged",
      version: 1,
    });

    await vi.advanceTimersByTimeAsync(1_000);
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      activeOperations: 1,
      type: "muzhi.service-worker.keepalive",
      version: 1,
    });

    listeners[0]?.(
      {
        operationId: "speech-task-1",
        type: "muzhi.offscreen.keepalive.release",
        version: 1,
      },
      {},
      vi.fn(),
    );
    runtime.sendMessage.mockClear();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("reattaches an idempotent lease when its first acknowledgement is lost", async () => {
    const { chromeValue, runtime } = createRuntime();
    installChromeOffscreenSpeechTaskKeepaliveListener(chromeValue, 20_000);
    const dispatch = runtime.sendMessage.getMockImplementation();
    if (!dispatch) throw new Error("Missing fake message dispatcher");
    let dropped = false;
    runtime.sendMessage.mockImplementation(async (message: unknown) => {
      const response = await dispatch(message);
      if (
        !dropped &&
        typeof message === "object" &&
        message !== null &&
        Reflect.get(message, "type") === "muzhi.offscreen.keepalive.acquire"
      ) {
        dropped = true;
        throw new Error(
          "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
        );
      }
      return response;
    });
    const createDocument = vi.fn(async () => undefined);
    const keepalive = createChromeOffscreenSpeechTaskKeepalive(chromeValue, {
      createDocument,
      hasDocument: async () => false,
    });

    const release = await keepalive.acquire("speech-task-2");
    expect(dropped).toBe(true);
    expect(createDocument).toHaveBeenCalledOnce();
    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);

    await release();
    expect(runtime.sendMessage).toHaveBeenLastCalledWith({
      operationId: "speech-task-2",
      type: "muzhi.offscreen.keepalive.release",
      version: 1,
    });
  });
});
