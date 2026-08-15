import { describe, expect, it, vi } from "vitest";

import {
  RUNTIME_PROTOCOL_VERSION,
  type RuntimeCommand,
} from "../../src/application/runtime-contract";
import {
  ChromePlayerRuntimeError,
  createChromePlayerRuntimeClient,
} from "../../src/infrastructure/chrome-player-runtime";

const videoKey = "bvid:BV1Q541167Qg:cid:30000000001:p:2" as const;

describe("Chrome player runtime client", () => {
  it("correlates exact time reads and seek commands", async () => {
    const sendMessage = vi.fn(async (command: RuntimeCommand) => {
      if (command.type === "muzhi.video.time.read") {
        return {
          payload: {
            currentTimeMs: 75_500,
            videoKey: command.payload.videoKey,
          },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          type: "muzhi.video.time.reported",
        };
      }
      if (command.type === "muzhi.video.seek") {
        return {
          payload: {
            seconds: command.payload.seconds,
            videoKey: command.payload.videoKey,
          },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          type: "muzhi.video.seeked",
        };
      }
      throw new Error("Unexpected player runtime command");
    });
    const client = createChromePlayerRuntimeClient(
      { runtime: { sendMessage } },
      {
        confirmOpenTarget: vi.fn(async () => false),
        createRequestId: () => "player-request",
      },
    );

    await expect(client.readTime(videoKey)).resolves.toBe(75_500);
    await expect(client.navigate(videoKey, 30)).resolves.toBe("seeked");
    await expect(client.navigate(videoKey, 30)).resolves.toBe("seeked");
    expect(sendMessage.mock.calls.map(([command]) => command)).toEqual([
      {
        payload: { videoKey },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: "player-request",
        type: "muzhi.video.time.read",
      },
      {
        payload: { seconds: 30, videoKey },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: "player-request",
        type: "muzhi.video.seek",
      },
      {
        payload: { seconds: 30, videoKey },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: "player-request",
        type: "muzhi.video.seek",
      },
    ]);
  });

  it("keeps content-script failures and rejects uncorrelated events", async () => {
    const client = createChromePlayerRuntimeClient(
      {
        runtime: {
          sendMessage: vi
            .fn()
            .mockResolvedValueOnce({
              error: {
                code: "VIDEO_NOT_BOUND",
                message: "当前页面不匹配",
                retryable: false,
              },
              protocolVersion: RUNTIME_PROTOCOL_VERSION,
              requestId: "player-request",
              type: "muzhi.command.failed",
            })
            .mockResolvedValueOnce({
              payload: { currentTimeMs: 1, videoKey },
              protocolVersion: RUNTIME_PROTOCOL_VERSION,
              requestId: "another-request",
              type: "muzhi.video.time.reported",
            }),
        },
      },
      {
        confirmOpenTarget: vi.fn(async () => false),
        createRequestId: () => "player-request",
      },
    );

    await expect(client.readTime(videoKey)).rejects.toEqual(
      expect.objectContaining({
        code: "VIDEO_NOT_BOUND",
        message: "当前页面不匹配",
        retryable: false,
      } satisfies Partial<ChromePlayerRuntimeError>),
    );
    await expect(client.readTime(videoKey)).rejects.toBeInstanceOf(
      ChromePlayerRuntimeError,
    );
  });

  it("reports cancellation distinctly instead of a false successful seek", async () => {
    const client = createChromePlayerRuntimeClient(
      {
        runtime: {
          sendMessage: vi.fn(async (command: RuntimeCommand) => ({
            error: {
              code: "VIDEO_NOT_BOUND",
              message: "未找到目标页",
              retryable: true,
            },
            protocolVersion: RUNTIME_PROTOCOL_VERSION,
            requestId: command.requestId,
            type: "muzhi.command.failed",
          })),
        },
      },
      {
        confirmOpenTarget: vi.fn(async () => false),
        createRequestId: () => "cancelled-player-request",
      },
    );

    await expect(client.navigate(videoKey, 30)).resolves.toBe("cancelled");
  });

  it("Worker 在确认期间重启时再次建立确认状态并完成第三次发送", async () => {
    const sendMessage = vi
      .fn()
      .mockImplementationOnce(async (command: RuntimeCommand) => ({
        error: {
          code: "VIDEO_NOT_BOUND",
          message: "请确认打开目标页",
          retryable: true,
        },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.command.failed",
      }))
      .mockImplementationOnce(async (command: RuntimeCommand) => ({
        error: {
          code: "VIDEO_NOT_BOUND",
          message: "Worker 重启后重新建立确认状态",
          retryable: true,
        },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.command.failed",
      }))
      .mockImplementationOnce(async (command: RuntimeCommand) => ({
        payload:
          command.type === "muzhi.video.seek"
            ? command.payload
            : { seconds: 30, videoKey },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.video.seeked",
      }));
    const confirmOpenTarget = vi.fn(async () => true);
    const client = createChromePlayerRuntimeClient(
      { runtime: { sendMessage } },
      {
        confirmOpenTarget,
        createRequestId: () => "worker-restart-confirmation",
      },
    );

    await expect(client.navigate(videoKey, 30)).resolves.toBe("seeked");
    expect(confirmOpenTarget).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(
      sendMessage.mock.calls.map(([message]) => message.requestId),
    ).toEqual([
      "worker-restart-confirmation",
      "worker-restart-confirmation",
      "worker-restart-confirmation",
    ]);
  });

  it("第二次发送期间 owner 失效时不执行 Worker 重启恢复的第三次发送", async () => {
    let current = true;
    const sendMessage = vi
      .fn()
      .mockImplementationOnce(async (command: RuntimeCommand) => ({
        error: {
          code: "VIDEO_NOT_BOUND",
          message: "请确认打开目标页",
          retryable: true,
        },
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        type: "muzhi.command.failed",
      }))
      .mockImplementationOnce(async (command: RuntimeCommand) => {
        current = false;
        return {
          error: {
            code: "VIDEO_NOT_BOUND",
            message: "Worker 重启后重新建立确认状态",
            retryable: true,
          },
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          type: "muzhi.command.failed",
        };
      });
    const client = createChromePlayerRuntimeClient(
      { runtime: { sendMessage } },
      {
        confirmOpenTarget: vi.fn(async () => true),
        createRequestId: () => "stale-during-worker-restart",
      },
    );

    await expect(client.navigate(videoKey, 30, () => current)).resolves.toBe(
      "cancelled",
    );
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not retry the seek after confirmation when the owner became stale", async () => {
    const sendMessage = vi.fn(async (command: RuntimeCommand) => ({
      error: {
        code: "VIDEO_NOT_BOUND",
        message: "未找到目标页",
        retryable: true,
      },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.command.failed",
    }));
    let current = true;
    const client = createChromePlayerRuntimeClient(
      { runtime: { sendMessage } },
      {
        confirmOpenTarget: vi.fn(async () => {
          current = false;
          return true;
        }),
        createRequestId: () => "stale-after-confirmation",
      },
    );

    await expect(client.navigate(videoKey, 30, () => current)).resolves.toBe(
      "cancelled",
    );
    expect(sendMessage).toHaveBeenCalledOnce();
  });

  it("does not expose a closed asynchronous response channel to the UI", async () => {
    const rawTransportError =
      "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received";
    const client = createChromePlayerRuntimeClient(
      {
        runtime: {
          sendMessage: vi.fn().mockRejectedValue(new Error(rawTransportError)),
        },
      },
      {
        confirmOpenTarget: vi.fn(async () => false),
        createRequestId: () => "player-closed-channel",
      },
    );

    await expect(client.readTime(videoKey)).rejects.toEqual(
      expect.objectContaining<Partial<ChromePlayerRuntimeError>>({
        code: "INTERNAL_ERROR",
        message: "无法连接当前视频播放器，请重试。",
        retryable: true,
      }),
    );
    await expect(client.navigate(videoKey, 30)).rejects.not.toThrow(
      rawTransportError,
    );
  });
});
