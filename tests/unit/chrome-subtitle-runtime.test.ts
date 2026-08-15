import { describe, expect, it, vi } from "vitest";

import { RUNTIME_PROTOCOL_VERSION } from "../../src/application/runtime-contract";
import {
  ChromeSubtitleRuntimeError,
  createChromeSubtitleRuntimeClient,
  installChromeSubtitleRuntimeListener,
} from "../../src/infrastructure/chrome-subtitle-runtime";

const videoKey = "bvid:BV1xx411c7mD:cid:30000000099:p:1" as const;

describe("Chrome subtitle runtime client", () => {
  it("sends exact list/acquire envelopes and accepts only correlated events", async () => {
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          payload: {
            tracks: [
              {
                language: "en-US",
                name: "English",
                source: "official",
                trackId: "id:1002",
              },
            ],
            videoKey,
          },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: "request-list",
          type: "muzhi.subtitle.tracks.listed",
        })
        .mockResolvedValueOnce({
          payload: {
            rowCount: 1,
            subtitleId: "subtitle-runtime",
            videoKey,
          },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: "request-acquire",
          type: "muzhi.subtitle.acquired",
        }),
    };
    const requestIds = ["request-list", "request-acquire"];
    const client = createChromeSubtitleRuntimeClient(
      { runtime },
      { createRequestId: () => requestIds.shift() ?? "unexpected" },
    );

    await expect(client.listTracks(videoKey)).resolves.toEqual([
      {
        language: "en-US",
        name: "English",
        source: "official",
        trackId: "id:1002",
      },
    ]);
    await expect(client.acquire(videoKey, "id:1002")).resolves.toEqual({
      rowCount: 1,
      subtitleId: "subtitle-runtime",
      videoKey,
    });
    expect(runtime.sendMessage.mock.calls).toEqual([
      [
        {
          payload: { videoKey },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: "request-list",
          type: "muzhi.subtitle.tracks.list",
        },
      ],
      [
        {
          payload: { method: "direct", trackId: "id:1002", videoKey },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: "request-acquire",
          type: "muzhi.subtitle.acquire",
        },
      ],
    ]);
  });

  it("surfaces sanitized command failures and rejects uncorrelated responses", async () => {
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "请先登录 B 站后再获取字幕。",
            retryable: false,
          },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: "request-failed",
          type: "muzhi.command.failed",
        })
        .mockResolvedValueOnce({
          payload: { tracks: [], videoKey },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: "wrong-request",
          type: "muzhi.subtitle.tracks.listed",
        }),
    };
    const requestIds = ["request-failed", "request-list"];
    const client = createChromeSubtitleRuntimeClient(
      { runtime },
      { createRequestId: () => requestIds.shift() ?? "unexpected" },
    );

    await expect(client.listTracks(videoKey)).rejects.toEqual(
      expect.objectContaining<Partial<ChromeSubtitleRuntimeError>>({
        code: "AUTHENTICATION_REQUIRED",
        message: "请先登录 B 站后再获取字幕。",
        retryable: false,
      }),
    );
    await expect(client.listTracks(videoKey)).rejects.toMatchObject({
      code: "INTERNAL_ERROR",
      message: "扩展字幕响应无效，请重试。",
      retryable: false,
    });
  });

  it("does not expose a closed asynchronous response channel to the UI", async () => {
    const rawTransportError =
      "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received";
    const client = createChromeSubtitleRuntimeClient(
      {
        runtime: {
          sendMessage: vi.fn().mockRejectedValue(new Error(rawTransportError)),
        },
      },
      { createRequestId: () => "request-closed-channel" },
    );

    await expect(client.listTracks(videoKey)).rejects.toEqual(
      expect.objectContaining<Partial<ChromeSubtitleRuntimeError>>({
        code: "INTERNAL_ERROR",
        message: "无法连接扩展字幕后台，请重试。",
        retryable: true,
      }),
    );
    await expect(client.acquire(videoKey, "id:1002")).rejects.not.toThrow(
      rawTransportError,
    );
  });
});

describe("Chrome subtitle runtime listener", () => {
  it("ignores unknown messages and keeps the response channel open for valid commands", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const onMessage = {
      addListener: vi.fn((registered: typeof listener) => {
        listener = registered;
      }),
    };
    const handler = vi.fn(async (command) => ({
      payload: { tracks: [], videoKey: command.payload.videoKey },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.subtitle.tracks.listed" as const,
    }));
    installChromeSubtitleRuntimeListener({ runtime: { onMessage } }, handler);
    const sendResponse = vi.fn();

    expect(listener?.({ type: "unknown" }, {}, sendResponse)).toBe(false);
    expect(handler).not.toHaveBeenCalled();
    expect(
      listener?.(
        {
          payload: { videoKey },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: "request-listener",
          type: "muzhi.subtitle.tracks.list",
        },
        {},
        sendResponse,
      ),
    ).toBe(true);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
    expect(handler).toHaveBeenCalledOnce();
  });
});
