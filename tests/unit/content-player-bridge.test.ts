import { describe, expect, it, vi } from "vitest";

import { RUNTIME_PROTOCOL_VERSION } from "../../src/application/runtime-contract";
import {
  handleContentPlayerCommand,
  installContentPlayerBridge,
  type ContentPageDocument,
  type PlaybackVideo,
} from "../../src/infrastructure/content-player-bridge";

const videoKey = "bvid:BV1Q541167Qg:cid:30000000001:p:2" as const;

function command(
  type: "muzhi.video.seek" | "muzhi.video.time.read",
  payload: Record<string, unknown>,
) {
  return {
    payload,
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    requestId: "player-request-1",
    type,
  };
}

function page(
  href: string,
  videos: readonly PlaybackVideo[],
): ContentPageDocument {
  return {
    defaultView: {
      __INITIAL_STATE__: {
        videoData: { cid: 30000000001 },
      },
    },
    location: { href },
    querySelectorAll: () => videos,
  };
}

describe("content player bridge", () => {
  it("prefers a video that actually advances across samples over a nominally playing stalled node", () => {
    const advancingVideo = {
      currentTime: 10,
      duration: 1_200,
      ended: false,
      hidden: false,
      isConnected: true,
      paused: false,
      getBoundingClientRect: () => ({ height: 540, width: 960 }),
    };
    const stalledSpaVideo = {
      currentTime: 264,
      duration: 1_200,
      ended: false,
      hidden: false,
      isConnected: true,
      paused: false,
      getBoundingClientRect: () => ({ height: 540, width: 960 }),
    };
    const document = page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [
      advancingVideo,
      stalledSpaVideo,
    ]);

    expect(
      handleContentPlayerCommand(
        document,
        command("muzhi.video.time.read", { videoKey }),
      ),
    ).toMatchObject({ payload: { currentTimeMs: 264_000 } });

    advancingVideo.currentTime = 11;

    expect(
      handleContentPlayerCommand(
        document,
        command("muzhi.video.time.read", { videoKey }),
      ),
    ).toMatchObject({
      payload: { currentTimeMs: 11_000, videoKey },
      type: "muzhi.video.time.reported",
    });
  });

  it("chooses the visible playing video instead of the first stale SPA video", () => {
    const staleVideo = {
      currentTime: 264,
      duration: 1_200,
      ended: false,
      hidden: false,
      isConnected: true,
      paused: true,
      getBoundingClientRect: () => ({ height: 540, width: 960 }),
    };
    const activeVideo = {
      currentTime: 486,
      duration: 1_200,
      ended: false,
      hidden: false,
      isConnected: true,
      paused: false,
      getBoundingClientRect: () => ({ height: 540, width: 960 }),
    };
    const document = page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [
      staleVideo,
      activeVideo,
    ]);

    expect(
      handleContentPlayerCommand(
        document,
        command("muzhi.video.time.read", { videoKey }),
      ),
    ).toMatchObject({
      payload: { currentTimeMs: 486_000, videoKey },
      type: "muzhi.video.time.reported",
    });
    expect(
      handleContentPlayerCommand(
        document,
        command("muzhi.video.seek", { seconds: 510, videoKey }),
      ),
    ).toMatchObject({
      error: { code: "UNSUPPORTED_CAPABILITY" },
      type: "muzhi.command.failed",
    });
    expect(activeVideo.currentTime).toBe(486);
    expect(staleVideo.currentTime).toBe(264);
  });

  it("reports a millisecond player position only for the matching exact page", () => {
    const response = handleContentPlayerCommand(
      page(`https://www.bilibili.com/video/BV1Q541167Qg?p=2`, [
        { currentTime: 75.5, duration: 120 },
      ]),
      command("muzhi.video.time.read", { videoKey }),
    );

    expect(response).toEqual({
      payload: { currentTimeMs: 75_500, videoKey },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: "player-request-1",
      type: "muzhi.video.time.reported",
    });
  });

  it("accepts the observed long URL query order for the exact requested part", () => {
    const observedVideoKey = "bvid:BV1zt4y1z72D:cid:283409666:p:7" as const;
    const document = page(
      "https://www.bilibili.com/video/BV1zt4y1z72D?vd_source=test&spm_id_from=333.788.videopod.episodes&p=7",
      [{ currentTime: 19, duration: 268 }],
    ) as ContentPageDocument & { defaultView: unknown };
    Object.assign(document, {
      defaultView: {
        __INITIAL_STATE__: { videoData: { cid: 283409666 } },
      },
    });
    const response = handleContentPlayerCommand(
      document,
      command("muzhi.video.time.read", { videoKey: observedVideoKey }),
    );

    expect(response).toMatchObject({
      payload: { currentTimeMs: 19_000, videoKey: observedVideoKey },
      type: "muzhi.video.time.reported",
    });
  });

  it("rejects a matching BVID/page when the exact CID differs", () => {
    const document = page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [
      { currentTime: 10, duration: 120 },
    ]) as ContentPageDocument & { defaultView: unknown };
    Object.assign(document, {
      defaultView: { __INITIAL_STATE__: { videoData: { cid: 999 } } },
    });

    expect(
      handleContentPlayerCommand(
        document,
        command("muzhi.video.time.read", { videoKey }),
      ),
    ).toMatchObject({
      error: { code: "VIDEO_NOT_BOUND" },
      type: "muzhi.command.failed",
    });
  });

  it("rejects a cross-page seek without mutating the current player", () => {
    const video = { currentTime: 10, duration: 120 };
    const response = handleContentPlayerCommand(
      page("https://www.bilibili.com/video/BV1Q541167Qg", [video]),
      command("muzhi.video.seek", { seconds: 30, videoKey }),
    );

    expect(response).toMatchObject({
      error: { code: "VIDEO_NOT_BOUND", retryable: false },
      type: "muzhi.command.failed",
    });
    expect(video.currentTime).toBe(10);
  });

  it("refuses to report seek success when the player cannot emit a seeked confirmation", () => {
    const video = { currentTime: 10, duration: 120 };
    const document = page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [
      video,
    ]);

    expect(
      handleContentPlayerCommand(
        document,
        command("muzhi.video.seek", { seconds: 30, videoKey }),
      ),
    ).toMatchObject({
      error: { code: "UNSUPPORTED_CAPABILITY", retryable: false },
      type: "muzhi.command.failed",
    });
    expect(video.currentTime).toBe(10);
    expect(
      handleContentPlayerCommand(
        document,
        command("muzhi.video.seek", { seconds: 121, videoKey }),
      ),
    ).toMatchObject({
      error: { code: "VALIDATION_FAILED", retryable: false },
      type: "muzhi.command.failed",
    });
    expect(video.currentTime).toBe(10);
  });

  it("returns a safe capability failure when the current page has no playable video", () => {
    expect(
      handleContentPlayerCommand(
        page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", []),
        command("muzhi.video.time.read", { videoKey }),
      ),
    ).toMatchObject({
      error: { code: "UNSUPPORTED_CAPABILITY", retryable: false },
      type: "muzhi.command.failed",
    });
  });

  it("installs one narrow runtime listener and ignores unrelated messages", () => {
    let registered:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void)
      | undefined;
    const onMessage = {
      addListener: vi.fn(function (this: unknown, listener) {
        expect(this).toBe(onMessage);
        registered = listener;
      }),
    };
    installContentPlayerBridge(
      { runtime: { onMessage } },
      page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [
        { currentTime: 1, duration: 120 },
      ]),
    );
    const sendResponse = vi.fn();

    expect(registered?.({ type: "muzhi.unknown" }, {}, sendResponse)).toBe(
      false,
    );
    expect(sendResponse).not.toHaveBeenCalled();
    expect(
      registered?.(
        command("muzhi.video.time.read", { videoKey }),
        {},
        sendResponse,
      ),
    ).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({ type: "muzhi.video.time.reported" }),
    );
  });

  it("does not acknowledge a seek from same-stack currentTime reflection before the player confirms it", async () => {
    let registered:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void)
      | undefined;
    const listeners = new Set<() => void>();
    let reflectedCurrentTime = 10;
    const video = {
      addEventListener(type: string, listener: () => void) {
        if (type === "seeked") listeners.add(listener);
      },
      duration: 120,
      get currentTime() {
        return reflectedCurrentTime;
      },
      removeEventListener(type: string, listener: () => void) {
        if (type === "seeked") listeners.delete(listener);
      },
      set currentTime(value: number) {
        // This mirrors the setter immediately, but deliberately does not emit
        // seeked until the real player acknowledgement below.
        reflectedCurrentTime = value;
      },
    };
    installContentPlayerBridge(
      {
        runtime: {
          onMessage: {
            addListener: vi.fn((listener) => {
              registered = listener;
            }),
          },
        },
      },
      page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [video]),
    );
    const sendResponse = vi.fn();

    expect(
      registered?.(
        command("muzhi.video.seek", { seconds: 30, videoKey }),
        {},
        sendResponse,
      ),
    ).toBe(true);
    expect(reflectedCurrentTime).toBe(30);
    expect(sendResponse).not.toHaveBeenCalled();

    for (const listener of [...listeners]) listener();

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { seconds: 30, videoKey },
        type: "muzhi.video.seeked",
      }),
    );
  });

  it("relayed seek 的精确页面身份不匹配时返回 VIDEO_NOT_BOUND", () => {
    let registered:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void)
      | undefined;
    installContentPlayerBridge(
      {
        runtime: {
          onMessage: {
            addListener: vi.fn((listener) => {
              registered = listener;
            }),
          },
        },
      },
      page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", []),
    );
    const sendResponse = vi.fn();

    expect(
      registered?.(
        {
          ...command("muzhi.video.seek", {
            seconds: 30,
            videoKey: "bvid:BV1Q541167Qg:cid:30000000002:p:2",
          }),
          seekDispatch: { sequence: 1 },
        },
        {},
        sendResponse,
      ),
    ).toBe(false);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "VIDEO_NOT_BOUND" }),
        type: "muzhi.command.failed",
      }),
    );
  });

  it("较新的 relayed seek 先到内容端时，迟到的旧命令不再回写播放器", async () => {
    let registered:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void)
      | undefined;
    const listeners = new Set<() => void>();
    const writes: number[] = [];
    let currentTime = 10;
    const video = {
      addEventListener(type: string, listener: () => void) {
        if (type === "seeked") listeners.add(listener);
      },
      duration: 120,
      get currentTime() {
        return currentTime;
      },
      removeEventListener(type: string, listener: () => void) {
        if (type === "seeked") listeners.delete(listener);
      },
      set currentTime(value: number) {
        writes.push(value);
        currentTime = value;
      },
    };
    installContentPlayerBridge(
      {
        runtime: {
          onMessage: {
            addListener: vi.fn((listener) => {
              registered = listener;
            }),
          },
        },
      },
      page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [video]),
    );
    const newerResponse = vi.fn();
    const staleResponse = vi.fn();
    const older = {
      ...command("muzhi.video.seek", { seconds: 10, videoKey }),
      requestId: "seek-older",
      seekDispatch: { sequence: 1 },
    };
    const newer = {
      ...command("muzhi.video.seek", { seconds: 80, videoKey }),
      requestId: "seek-newer",
      seekDispatch: { sequence: 2 },
    };

    expect(registered?.(newer, {}, newerResponse)).toBe(true);
    expect(currentTime).toBe(80);
    expect(registered?.(older, {}, staleResponse)).toBe(false);

    expect(writes).toEqual([80]);
    expect(staleResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
        requestId: older.requestId,
        type: "muzhi.command.failed",
      }),
    );

    for (const listener of [...listeners]) listener();
    await vi.waitFor(() => expect(newerResponse).toHaveBeenCalledOnce());
    expect(staleResponse).toHaveBeenCalledOnce();
    expect(staleResponse).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "muzhi.video.seeked" }),
    );
  });

  it("重复安装内容桥时复用同一水位且只注册一个 listener", async () => {
    const registered: Array<
      (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => boolean | void
    > = [];
    const writes: number[] = [];
    let currentTime = 0;
    const listeners = new Set<() => void>();
    const video = {
      addEventListener(_type: string, listener: () => void) {
        listeners.add(listener);
      },
      duration: 120,
      get currentTime() {
        return currentTime;
      },
      removeEventListener(_type: string, listener: () => void) {
        listeners.delete(listener);
      },
      set currentTime(value: number) {
        writes.push(value);
        currentTime = value;
      },
    };
    const chromeValue = {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => registered.push(listener)),
        },
      },
    };
    const document = page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [
      video,
    ]);

    installContentPlayerBridge(chromeValue, document);
    installContentPlayerBridge(chromeValue, document);

    expect(registered).toHaveLength(1);
    const currentResponse = vi.fn();
    expect(
      registered[0]?.(
        {
          ...command("muzhi.video.seek", { seconds: 80, videoKey }),
          requestId: "singleton-current",
          seekDispatch: { sequence: 2 },
        },
        {},
        currentResponse,
      ),
    ).toBe(true);
    const staleResponse = vi.fn();
    expect(
      registered[0]?.(
        {
          ...command("muzhi.video.seek", { seconds: 10, videoKey }),
          requestId: "singleton-stale",
          seekDispatch: { sequence: 1 },
        },
        {},
        staleResponse,
      ),
    ).toBe(false);

    expect(writes).toEqual([80]);
    expect(staleResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
      }),
    );
    for (const listener of [...listeners]) listener();
    await vi.waitFor(() => expect(currentResponse).toHaveBeenCalledOnce());
  });

  it("同一 runtime 重注入到新的 onMessage 时复用水位", () => {
    const firstListeners: Array<
      (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => boolean | void
    > = [];
    const secondListeners: typeof firstListeners = [];
    const runtime = {
      onMessage: {
        addListener: vi.fn((listener) => firstListeners.push(listener)),
      },
    };
    const writes: number[] = [];
    let currentTime = 0;
    const video = {
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
    };
    const document = page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [
      video,
    ]);

    installContentPlayerBridge({ runtime }, document);
    firstListeners[0]?.(
      {
        ...command("muzhi.video.seek", { seconds: 80, videoKey }),
        requestId: "reinjected-current",
        seekDispatch: { sequence: 2 },
      },
      {},
      vi.fn(),
    );
    runtime.onMessage = {
      addListener: vi.fn((listener) => secondListeners.push(listener)),
    };
    installContentPlayerBridge({ runtime }, document);
    const staleResponse = vi.fn();

    expect(secondListeners).toHaveLength(1);
    expect(
      secondListeners[0]?.(
        {
          ...command("muzhi.video.seek", { seconds: 10, videoKey }),
          requestId: "reinjected-stale",
          seekDispatch: { sequence: 1 },
        },
        {},
        staleResponse,
      ),
    ).toBe(false);
    expect(writes).toEqual([80]);
    expect(staleResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
      }),
    );
  });

  it("观察到有序 seek 后拒绝迟到的无序号旧协议命令", () => {
    let registered:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean | void)
      | undefined;
    const writes: number[] = [];
    let currentTime = 0;
    const video = {
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
    };
    installContentPlayerBridge(
      {
        runtime: {
          onMessage: {
            addListener: vi.fn((listener) => {
              registered = listener;
            }),
          },
        },
      },
      page("https://www.bilibili.com/video/BV1Q541167Qg?p=2", [video]),
    );
    const orderedResponse = vi.fn();
    registered?.(
      {
        ...command("muzhi.video.seek", { seconds: 80, videoKey }),
        requestId: "ordered-seek",
        seekDispatch: { sequence: 2 },
      },
      {},
      orderedResponse,
    );
    const legacyResponse = vi.fn();

    expect(
      registered?.(
        {
          ...command("muzhi.video.seek", { seconds: 10, videoKey }),
          requestId: "legacy-late",
        },
        {},
        legacyResponse,
      ),
    ).toBe(false);

    expect(writes).toEqual([80]);
    expect(legacyResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: "TASK_INTERRUPTED" }),
      }),
    );
  });
});
