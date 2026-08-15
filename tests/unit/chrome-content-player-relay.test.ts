import { describe, expect, it, vi } from "vitest";

import { RUNTIME_PROTOCOL_VERSION } from "../../src/application/runtime-contract";
import { installChromeContentPlayerRelay } from "../../src/infrastructure/chrome-content-player-relay";
import { installContentPlayerBridge } from "../../src/infrastructure/content-player-bridge";

const command = {
  payload: {
    seconds: 30,
    videoKey: "bvid:BV1Q541167Qg:cid:30000000001:p:2",
  },
  protocolVersion: RUNTIME_PROTOCOL_VERSION,
  requestId: "relay-request",
  type: "muzhi.video.seek",
} as const;

type RelayListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean;

function installRelayWithContentDelivery(input: {
  readonly firstDelivery: Promise<void>;
  readonly secondDelivery: Promise<void>;
  readonly writes: number[];
}): RelayListener {
  let relayListener: RelayListener | undefined;
  let contentListener: RelayListener | undefined;
  let currentTime = input.writes.at(-1) ?? 0;
  const seekedListeners = new Set<() => void>();
  const video = {
    addEventListener(_type: "seeked", listener: () => void) {
      seekedListeners.add(listener);
    },
    duration: 120,
    get currentTime() {
      return currentTime;
    },
    removeEventListener(_type: "seeked", listener: () => void) {
      seekedListeners.delete(listener);
    },
    set currentTime(value: number) {
      input.writes.push(value);
      currentTime = value;
      queueMicrotask(() => {
        for (const listener of [...seekedListeners]) listener();
      });
    },
  };
  installContentPlayerBridge(
    {
      runtime: {
        onMessage: {
          addListener(listener: RelayListener) {
            contentListener = listener;
          },
        },
      },
    },
    {
      defaultView: {
        __INITIAL_STATE__: { videoData: { cid: 30000000001 } },
      },
      location: {
        href: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
      },
      querySelectorAll: () => [video],
    },
  );
  let sequence = 0;
  installChromeContentPlayerRelay(
    {
      runtime: {
        onMessage: {
          addListener(listener: RelayListener) {
            relayListener = listener;
          },
        },
      },
      tabs: {
        query: vi.fn(async () => [
          { id: 27, url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2" },
        ]),
        sendMessage: vi.fn(
          async (_tabId: number, message: unknown): Promise<unknown> => {
            const type = (message as { type?: unknown }).type;
            if (type === "muzhi.video.seek.watermark") {
              contentListener?.(message, {}, () => undefined);
              return undefined;
            }
            const requestId = (message as { requestId?: unknown }).requestId;
            await (requestId === "delayed-first"
              ? input.firstDelivery
              : input.secondDelivery);
            return await new Promise<unknown>((resolve) => {
              if (!contentListener?.(message, {}, resolve)) {
                throw new Error("Content bridge rejected the relayed command");
              }
            });
          },
        ),
      },
    },
    { allocateSeekSequence: async () => (sequence += 1) },
  );
  if (relayListener === undefined) {
    throw new Error("Relay listener was not installed");
  }
  return relayListener;
}

describe("Chrome content player relay", () => {
  it("opens the exact missing part only after confirmation and then waits for seek success", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    const query = vi.fn(async (queryInfo: Record<string, unknown>) =>
      queryInfo.active === true ? [{ id: 1, url: "chrome://extensions/" }] : [],
    );
    const create = vi.fn(async (input: { readonly url: string }) => ({
      id: 44,
      status: "complete",
      url: input.url,
    }));
    let playerConfirmed = false;
    let releaseSeeked: (() => void) | undefined;
    const sendMessage = vi.fn((tabId: number, message: unknown) => {
      expect(tabId).toBe(44);
      expect(message).toMatchObject({
        ...command,
        seekDispatch: { sequence: 1 },
      });
      return new Promise<unknown>((resolve) => {
        releaseSeeked = () => {
          playerConfirmed = true;
          resolve({
            payload: command.payload,
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            requestId: command.requestId,
            type: "muzhi.video.seeked",
          });
        };
      });
    });
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: {
          create,
          query,
          sendMessage,
          update: vi.fn(async () => undefined),
        },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const responses: unknown[] = [];
    const confirmationStates: boolean[] = [];

    expect(
      listener?.(command, {}, (response) => {
        confirmationStates.push(playerConfirmed);
        responses.push(response);
      }),
    ).toBe(true);
    await vi.waitFor(() => expect(responses).toHaveLength(1));
    expect(create).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(responses[0]).toMatchObject({
      error: {
        code: "VIDEO_NOT_BOUND",
        message: expect.stringMatching(/确认/),
        retryable: true,
      },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.command.failed",
    });

    expect(
      listener?.(command, {}, (response) => {
        confirmationStates.push(playerConfirmed);
        responses.push(response);
      }),
    ).toBe(true);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledWith({
      url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2&t=30",
    });
    expect(responses).toHaveLength(1);
    expect(releaseSeeked).toEqual(expect.any(Function));
    releaseSeeked?.();

    await vi.waitFor(() => expect(responses).toHaveLength(2));
    expect(confirmationStates).toEqual([false, true]);
    expect(responses[1]).toMatchObject({
      payload: command.payload,
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.video.seeked",
    });
  });

  it("relays only a guarded player command to the active tab", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn(function (this: unknown, registered) {
        expect(this).toBe(onMessage);
        listener = registered;
      }),
    };
    const query = vi.fn(async () => [
      { id: 17, url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2" },
    ]);
    const sendMessage = vi.fn(async (tabId: number, message: unknown) => ({
      payload: {
        seconds: (message as typeof command).payload.seconds,
        videoKey: (message as typeof command).payload.videoKey,
      },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: (message as typeof command).requestId,
      type: "muzhi.video.seeked",
    }));
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: { query, sendMessage },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const sendResponse = vi.fn();

    expect(listener?.({ type: "muzhi.unknown" }, {}, sendResponse)).toBe(false);
    expect(listener?.(command, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(query).toHaveBeenCalledWith({
      active: true,
      lastFocusedWindow: true,
    });
    expect(sendMessage).toHaveBeenCalledWith(
      17,
      expect.objectContaining({
        ...command,
        seekDispatch: { sequence: 1 },
      }),
    );
    expect(sendResponse).toHaveBeenCalledWith({
      payload: command.payload,
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.video.seeked",
    });
  });

  it("returns a stable failure when no active tab can receive the command", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((_registered) => {
        listener = _registered;
      }),
    };
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: { query: vi.fn(async () => []), sendMessage: vi.fn() },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const sendResponse = vi.fn();

    listener?.(command, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "VIDEO_NOT_BOUND" }),
        type: "muzhi.command.failed",
      }),
    );
  });

  it("injects the packaged bridge once for an already-open Bilibili tab before retrying", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((_registered) => {
        listener = _registered;
      }),
    };
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce({
        payload: command.payload,
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.video.seeked",
      });
    const executeScript = vi.fn(async () => undefined);
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        scripting: { executeScript },
        tabs: {
          query: vi.fn(async () => [
            { id: 17, url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2" },
          ]),
          sendMessage,
        },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const sendResponse = vi.fn();

    listener?.(command, {}, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1));
    expect(executeScript).toHaveBeenCalledWith({
      files: ["content-script.js"],
      target: { tabId: 17 },
    });
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendResponse).toHaveBeenCalledWith({
      payload: command.payload,
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.video.seeked",
    });
  });

  it("does not spend the mount retry budget on a stable page identity mismatch", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    const mismatch = {
      error: {
        code: "VIDEO_NOT_BOUND",
        message: "wrong exact page",
        retryable: false,
      },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.command.failed",
    } as const;
    const sendMessage = vi.fn(async () => mismatch);
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: {
          query: vi.fn(async (queryInfo: Record<string, unknown>) =>
            queryInfo.active === true
              ? [{ id: 1, url: "chrome://extensions/" }]
              : [
                  {
                    id: 27,
                    url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
                  },
                ],
          ),
          sendMessage,
        },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const sendResponse = vi.fn();

    listener?.(command, {}, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("waits finitely for the exact already-open target tab when its player mounts late", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    const exactUrl = "https://www.bilibili.com/video/BV1Q541167Qg?p=2";
    const query = vi.fn(async (queryInfo: Record<string, unknown>) =>
      queryInfo.active === true
        ? [{ id: 1, url: "chrome://extensions/" }]
        : [{ id: 27, url: exactUrl }],
    );
    const delayed = {
      error: {
        code: "UNSUPPORTED_CAPABILITY",
        message: "player is still mounting",
        retryable: false,
      },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.command.failed",
    } as const;
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(delayed)
      .mockResolvedValueOnce(delayed)
      .mockResolvedValueOnce({
        payload: command.payload,
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.video.seeked",
      });
    const create = vi.fn();
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: {
          create,
          query,
          sendMessage,
          update: vi.fn(async () => undefined),
        },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const sendResponse = vi.fn();

    expect(listener?.(command, {}, sendResponse)).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    });
    expect(create).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(
      3,
      27,
      expect.objectContaining({
        ...command,
        seekDispatch: { sequence: 1 },
      }),
    );
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: command.payload,
        type: "muzhi.video.seeked",
      }),
    );
  });

  it("连续跳转时取消旧 seek 重试，旧目标不会在新跳转后再次写回播放器", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    const first = {
      ...command,
      payload: { ...command.payload, seconds: 10 },
      requestId: "seek-first",
    } as const;
    const second = {
      ...command,
      payload: { ...command.payload, seconds: 80 },
      requestId: "seek-second",
    } as const;
    const attempts: number[] = [];
    const sendMessage = vi.fn(async (_tabId: number, message: typeof first) => {
      attempts.push(message.payload.seconds);
      if (message.requestId === first.requestId) {
        return {
          error: {
            code: "UNSUPPORTED_CAPABILITY",
            message: "player is still mounting",
            retryable: true,
          },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: message.requestId,
          type: "muzhi.command.failed",
        } as const;
      }
      return {
        payload: message.payload,
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: message.requestId,
        type: "muzhi.video.seeked",
      } as const;
    });
    const update = vi.fn(async () => undefined);
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: {
          query: vi.fn(async (queryInfo: Record<string, unknown>) =>
            queryInfo.active === true
              ? [{ id: 1, url: "chrome://extensions/" }]
              : [
                  {
                    id: 27,
                    url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
                  },
                ],
          ),
          sendMessage,
          update,
        },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();

    listener?.(first, {}, firstResponse);
    await vi.waitFor(() =>
      expect(
        sendMessage.mock.calls.filter(
          ([, message]) =>
            (message as { requestId?: unknown }).requestId === first.requestId,
        ),
      ).toHaveLength(1),
    );
    listener?.(second, {}, secondResponse);
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledOnce());
    await new Promise((resolve) => globalThis.setTimeout(resolve, 350));

    expect(update).toHaveBeenCalledExactlyOnceWith(27, { active: true });
    expect(attempts).toEqual([10, 80]);
    expect(firstResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
        requestId: first.requestId,
        type: "muzhi.command.failed",
      }),
    );
  });

  it("旧 seek 的在途成功迟到时转换为中断，不向调用方回放成功", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    const first = {
      ...command,
      payload: { ...command.payload, seconds: 10 },
      requestId: "inflight-first",
    } as const;
    const second = {
      ...command,
      payload: { ...command.payload, seconds: 80 },
      requestId: "inflight-second",
    } as const;
    let releaseFirstSeek: (() => void) | undefined;
    const sendMessage = vi.fn((_tabId: number, message: typeof first) => {
      if (message.requestId === first.requestId) {
        return new Promise<unknown>((resolve) => {
          releaseFirstSeek = () =>
            resolve({
              payload: message.payload,
              protocolVersion: RUNTIME_PROTOCOL_VERSION,
              requestId: message.requestId,
              type: "muzhi.video.seeked",
            });
        });
      }
      return Promise.resolve({
        payload: message.payload,
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: message.requestId,
        type: "muzhi.video.seeked",
      });
    });
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: {
          query: vi.fn(async () => [
            { id: 27, url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2" },
          ]),
          sendMessage,
        },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();

    listener?.(first, {}, firstResponse);
    await vi.waitFor(() =>
      expect(
        sendMessage.mock.calls.filter(
          ([, message]) =>
            (message as { requestId?: unknown }).requestId === first.requestId,
        ),
      ).toHaveLength(1),
    );
    listener?.(second, {}, secondResponse);
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledOnce());
    releaseFirstSeek?.();
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledOnce());

    expect(firstResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
        requestId: first.requestId,
        type: "muzhi.command.failed",
      }),
    );
    expect(firstResponse).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "muzhi.video.seeked" }),
    );
  });

  it("旧 sendMessage 被取代后即使迟到 reject 也不再注入内容脚本", async () => {
    let listener: RelayListener | undefined;
    const onMessage = {
      addListener: vi.fn((registered: RelayListener) => {
        listener = registered;
      }),
    };
    const first = {
      ...command,
      payload: { ...command.payload, seconds: 10 },
      requestId: "reject-first",
    } as const;
    const second = {
      ...command,
      payload: { ...command.payload, seconds: 80 },
      requestId: "reject-second",
    } as const;
    let rejectFirst: ((error: Error) => void) | undefined;
    const sendMessage = vi.fn((_tabId: number, message: unknown) => {
      if (
        (message as { type?: unknown }).type === "muzhi.video.seek.watermark"
      ) {
        return Promise.resolve(undefined);
      }
      if ((message as { requestId?: unknown }).requestId === first.requestId) {
        return new Promise<unknown>((_resolve, reject) => {
          rejectFirst = reject;
        });
      }
      const current = message as typeof second;
      return Promise.resolve({
        payload: current.payload,
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: current.requestId,
        type: "muzhi.video.seeked",
      });
    });
    const executeScript = vi.fn(async () => undefined);
    let sequence = 0;
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        scripting: { executeScript },
        tabs: {
          query: vi.fn(async () => [
            { id: 27, url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2" },
          ]),
          sendMessage,
        },
      },
      { allocateSeekSequence: async () => (sequence += 1) },
    );
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();

    listener?.(first, {}, firstResponse);
    await vi.waitFor(() => expect(rejectFirst).toEqual(expect.any(Function)));
    listener?.(second, {}, secondResponse);
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledOnce());
    rejectFirst?.(new Error("Receiving end does not exist"));
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledOnce());

    expect(executeScript).not.toHaveBeenCalled();
    expect(firstResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
      }),
    );
  });

  it("查询标签页期间被新 seek 取代时，不写确认状态也不打开旧目标页面", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    let releaseFirstActiveQuery: (() => void) | undefined;
    let activeQueryCount = 0;
    const query = vi.fn((queryInfo: Record<string, unknown>) => {
      if (queryInfo.active === true && activeQueryCount++ === 0) {
        return new Promise<unknown[]>((resolve) => {
          releaseFirstActiveQuery = () => resolve([]);
        });
      }
      return Promise.resolve([]);
    });
    const create = vi.fn(async (input: { readonly url: string }) => ({
      id: 44,
      url: input.url,
    }));
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: { create, query, sendMessage: vi.fn() },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const first = {
      ...command,
      payload: { ...command.payload, seconds: 10 },
      requestId: "query-seek-first",
    } as const;
    const second = {
      ...command,
      payload: { ...command.payload, seconds: 80 },
      requestId: "query-seek-second",
    } as const;
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();

    listener?.(first, {}, firstResponse);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    listener?.(second, {}, secondResponse);
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledOnce());
    releaseFirstActiveQuery?.();
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledOnce());

    expect(create).not.toHaveBeenCalled();
    expect(firstResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
        requestId: first.requestId,
      }),
    );
  });

  it("创建旧目标页期间被新 seek 取代时，关闭旧页且不向其发送 seek", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    const query = vi.fn(async () => []);
    let releaseCreate: (() => void) | undefined;
    const create = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          releaseCreate = () =>
            resolve({
              id: 44,
              url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2&t=10",
            });
        }),
    );
    const remove = vi.fn(async () => undefined);
    const sendMessage = vi.fn();
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: { create, query, remove, sendMessage },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const first = {
      ...command,
      payload: { ...command.payload, seconds: 10 },
      requestId: "create-seek-first",
    } as const;
    const second = {
      ...command,
      payload: { ...command.payload, seconds: 80 },
      requestId: "create-seek-second",
    } as const;
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();

    listener?.(first, {}, firstResponse);
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledOnce());
    listener?.(first, {}, firstResponse);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    listener?.(second, {}, secondResponse);
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledOnce());
    releaseCreate?.();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith(44));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(firstResponse).toHaveBeenLastCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
        requestId: first.requestId,
      }),
    );
  });

  it("跨视频的新 seek 也会取消旧视频查询，避免旧 owner 迟到执行", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    let releaseFirstQuery: (() => void) | undefined;
    let queryCount = 0;
    const query = vi.fn(() => {
      if (queryCount++ === 0) {
        return new Promise<unknown[]>((resolve) => {
          releaseFirstQuery = () => resolve([]);
        });
      }
      return Promise.resolve([]);
    });
    const create = vi.fn();
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: { create, query, sendMessage: vi.fn() },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const first = {
      ...command,
      requestId: "cross-owner-first",
    } as const;
    const second = {
      ...command,
      payload: {
        seconds: 80,
        videoKey: "bvid:BV17x411w7KC:cid:30000000002:p:1",
      },
      requestId: "cross-owner-second",
    } as const;
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();

    listener?.(first, {}, firstResponse);
    await vi.waitFor(() => expect(query).toHaveBeenCalledTimes(1));
    listener?.(second, {}, secondResponse);
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledOnce());
    releaseFirstQuery?.();
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledOnce());

    expect(create).not.toHaveBeenCalled();
    expect(firstResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
        requestId: first.requestId,
      }),
    );
  });

  it("新 seek 后拒绝旧确认 requestId 重放，不打开旧目标页", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered) => {
        listener = registered;
      }),
    };
    const create = vi.fn();
    installChromeContentPlayerRelay(
      {
        runtime: { onMessage },
        tabs: { create, query: vi.fn(async () => []), sendMessage: vi.fn() },
      },
      { allocateSeekSequence: async () => 1 },
    );
    const first = {
      ...command,
      payload: { ...command.payload, seconds: 10 },
      requestId: "replay-old-seek",
    } as const;
    const second = {
      ...command,
      payload: { ...command.payload, seconds: 80 },
      requestId: "replay-new-seek",
    } as const;
    const firstConfirmation = vi.fn();
    const secondConfirmation = vi.fn();
    const replayResponse = vi.fn();

    listener?.(first, {}, firstConfirmation);
    await vi.waitFor(() => expect(firstConfirmation).toHaveBeenCalledOnce());
    listener?.(second, {}, secondConfirmation);
    await vi.waitFor(() => expect(secondConfirmation).toHaveBeenCalledOnce());
    listener?.(first, {}, replayResponse);
    await vi.waitFor(() => expect(replayResponse).toHaveBeenCalledOnce());

    expect(create).not.toHaveBeenCalled();
    expect(replayResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
        requestId: first.requestId,
      }),
    );
  });

  it("向所有 B 站 tab 广播新水位，跨 tab 迟到旧 seek 不会回写", async () => {
    type ContentListener = (
      message: unknown,
      sender: unknown,
      sendResponse: (response: unknown) => void,
    ) => boolean | void;
    const contentListeners = new Map<number, ContentListener>();
    const writesByTab = new Map<number, number[]>();
    for (const tabId of [11, 22]) {
      const writes: number[] = [];
      writesByTab.set(tabId, writes);
      let currentTime = 0;
      installContentPlayerBridge(
        {
          runtime: {
            onMessage: {
              addListener(listener: ContentListener) {
                contentListeners.set(tabId, listener);
              },
            },
          },
        },
        {
          defaultView: {
            __INITIAL_STATE__: { videoData: { cid: 30000000001 } },
          },
          location: {
            href: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
          },
          querySelectorAll: () => [
            {
              addEventListener() {},
              duration: 120,
              get currentTime() {
                return currentTime;
              },
              removeEventListener() {},
              set currentTime(value: number) {
                writes.push(value);
                currentTime = value;
              },
            },
          ],
        },
      );
    }
    let relayListener: RelayListener | undefined;
    let releaseOldDelivery: (() => void) | undefined;
    const oldDelivery = new Promise<void>((resolve) => {
      releaseOldDelivery = resolve;
    });
    let activeTabId = 11;
    let sequence = 0;
    installChromeContentPlayerRelay(
      {
        runtime: {
          onMessage: {
            addListener(listener: RelayListener) {
              relayListener = listener;
            },
          },
        },
        tabs: {
          query: vi.fn(async (queryInfo: Record<string, unknown>) =>
            queryInfo.active === true
              ? [
                  {
                    id: activeTabId,
                    url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
                  },
                ]
              : [
                  {
                    id: 11,
                    url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
                  },
                  {
                    id: 22,
                    url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
                  },
                ],
          ),
          sendMessage: vi.fn(async (tabId: number, message: unknown) => {
            if (
              tabId === 11 &&
              (message as { requestId?: unknown }).requestId === "cross-tab-old"
            ) {
              await oldDelivery;
            }
            return await new Promise<unknown>((resolve) => {
              const keepChannel = contentListeners.get(tabId)?.(
                message,
                {},
                resolve,
              );
              if (!keepChannel) resolve(undefined);
            });
          }),
        },
      },
      { allocateSeekSequence: async () => (sequence += 1) },
    );
    const oldResponse = vi.fn();
    const newResponse = vi.fn();

    relayListener?.(
      {
        ...command,
        payload: { ...command.payload, seconds: 10 },
        requestId: "cross-tab-old",
      },
      {},
      oldResponse,
    );
    await vi.waitFor(() => expect(writesByTab.get(11)).toEqual([]));
    activeTabId = 22;
    relayListener?.(
      {
        ...command,
        payload: { ...command.payload, seconds: 80 },
        requestId: "cross-tab-new",
      },
      {},
      newResponse,
    );
    await vi.waitFor(() => expect(writesByTab.get(22)).toEqual([80]));
    releaseOldDelivery?.();
    await vi.waitFor(() => expect(oldResponse).toHaveBeenCalledOnce());

    expect(writesByTab.get(11)).toEqual([]);
    expect(oldResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
      }),
    );
  });

  it("较新的 seek 已到达内容端时，relay 中迟到的旧命令不会回拉播放器", async () => {
    let releaseFirstDelivery: (() => void) | undefined;
    const firstDelivery = new Promise<void>((resolve) => {
      releaseFirstDelivery = resolve;
    });
    const writes: number[] = [];
    const listener = installRelayWithContentDelivery({
      firstDelivery,
      secondDelivery: Promise.resolve(),
      writes,
    });
    const first = {
      ...command,
      payload: { ...command.payload, seconds: 10 },
      requestId: "delayed-first",
    } as const;
    const second = {
      ...command,
      payload: { ...command.payload, seconds: 80 },
      requestId: "delivered-second",
    } as const;
    const firstResponse = vi.fn();
    const secondResponse = vi.fn();

    listener(first, {}, firstResponse);
    listener(second, {}, secondResponse);
    await vi.waitFor(() => expect(secondResponse).toHaveBeenCalledOnce());
    releaseFirstDelivery?.();
    await vi.waitFor(() => expect(firstResponse).toHaveBeenCalledOnce());

    expect(writes).toEqual([80]);
    expect(firstResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
        requestId: first.requestId,
        type: "muzhi.command.failed",
      }),
    );
  });
});
