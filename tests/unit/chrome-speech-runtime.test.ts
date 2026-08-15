import { describe, expect, it, vi } from "vitest";

import { SPEECH_RUNTIME_PROTOCOL_VERSION } from "../../src/application/asr/speech-runtime";
import {
  ChromeSpeechRuntimeError,
  createChromeSpeechRuntimeClient,
  installChromeSpeechRuntimeListener,
} from "../../src/infrastructure/chrome-speech-runtime";

const videoKey = "bvid:BV1xx411c7mD:cid:30000000099:p:1" as const;
const owner = Object.freeze({
  acquisitionId: "acquisition-1",
  draftBranchId: "branch-1",
  expectedContextRevision: 1,
  expectedSelectionRevision: 2,
  sessionId: "session-1",
  taskId: "task-1",
  videoKey,
});

describe("Chrome speech runtime", () => {
  it("starts, lists, polls, and cancels only correlated owner commands", async () => {
    const running = {
      browserSessionId: "browser-1",
      checkpoint: null,
      createdAt: 1,
      errorCode: null,
      owner,
      parameters: {
        model: "whisper-large-v3",
        provider: "groq",
        requestedLanguageMode: "mixed",
        routingMode: "balanced",
      },
      progress: { completedChunks: 1, stage: "transcribing", totalChunks: 3 },
      status: "running",
      updatedAt: 2,
    } as const;
    const runtime = {
      sendMessage: vi
        .fn()
        .mockResolvedValueOnce({
          payload: { owner },
          protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
          requestId: "start",
          type: "muzhi.speech.started",
        })
        .mockResolvedValueOnce({
          payload: { records: [running] },
          protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
          requestId: "active",
          type: "muzhi.speech.active-listed",
        })
        .mockResolvedValueOnce({
          payload: { record: running },
          protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
          requestId: "status",
          type: "muzhi.speech.statused",
        })
        .mockResolvedValueOnce({
          payload: { cancelled: true, owner },
          protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
          requestId: "cancel",
          type: "muzhi.speech.cancelled",
        }),
    };
    const ids = ["start", "active", "status", "cancel"];
    const client = createChromeSpeechRuntimeClient(
      { runtime },
      () => ids.shift() ?? "unexpected",
    );

    await expect(
      client.start({
        requestedLanguageMode: "mixed",
        routingMode: "balanced",
        videoKey,
      }),
    ).resolves.toEqual(owner);
    await expect(client.active(videoKey)).resolves.toEqual([running]);
    await expect(client.status(owner)).resolves.toEqual(running);
    await expect(client.cancel(owner)).resolves.toBe(true);
    expect(JSON.stringify(runtime.sendMessage.mock.calls)).not.toContain(
      "apiKey",
    );
  });

  it("surfaces only sanitized failures", async () => {
    const runtime = {
      sendMessage: vi.fn(async () => ({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "请先在设置中保存并测试 Groq 密钥。",
          retryable: false,
        },
        protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
        requestId: "failed",
        type: "muzhi.speech.failed",
      })),
    };
    const client = createChromeSpeechRuntimeClient({ runtime }, () => "failed");
    await expect(client.active(videoKey)).rejects.toEqual(
      expect.objectContaining<Partial<ChromeSpeechRuntimeError>>({
        code: "AUTHENTICATION_REQUIRED",
        message: "请先在设置中保存并测试 Groq 密钥。",
        retryable: false,
      }),
    );
  });

  it("reattaches a persisted start when Chrome closes the reply channel after accepting it", async () => {
    const running = {
      browserSessionId: "browser-1",
      checkpoint: null,
      createdAt: 1,
      errorCode: null,
      owner: { ...owner, taskId: "start-lost-reply" },
      parameters: {
        model: "whisper-large-v3",
        provider: "groq",
        requestedLanguageMode: "mixed",
        routingMode: "balanced",
      },
      progress: { completedChunks: 0, stage: "preparing", totalChunks: 0 },
      status: "running",
      updatedAt: 2,
    } as const;
    const runtime = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
          ),
        )
        .mockResolvedValueOnce({
          payload: { records: [running] },
          protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
          requestId: "active-after-loss",
          type: "muzhi.speech.active-listed",
        }),
    };
    const ids = ["start-lost-reply", "active-after-loss"];
    const client = createChromeSpeechRuntimeClient(
      { runtime },
      () => ids.shift() ?? "unexpected",
    );

    await expect(
      client.start({
        requestedLanguageMode: "mixed",
        routingMode: "balanced",
        videoKey,
      }),
    ).resolves.toEqual(running.owner);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("retries an idempotent status query when Chrome replaces a short-lived message channel", async () => {
    const runtime = {
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(
          new Error(
            "A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received",
          ),
        )
        .mockResolvedValueOnce({
          payload: { record: null },
          protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
          requestId: "status-retry",
          type: "muzhi.speech.statused",
        }),
    };
    const client = createChromeSpeechRuntimeClient(
      { runtime },
      () => "status-retry",
    );

    await expect(client.status(owner)).resolves.toBeNull();
    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("keeps the response channel open only for valid speech commands", async () => {
    let listener:
      | ((
          message: unknown,
          sender: unknown,
          sendResponse: (response: unknown) => void,
        ) => boolean)
      | undefined;
    const handler = vi.fn(async (command) => ({
      payload: { records: [] },
      protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
      requestId: command.requestId,
      type: "muzhi.speech.active-listed" as const,
    }));
    installChromeSpeechRuntimeListener(
      {
        runtime: {
          onMessage: {
            addListener: (value: typeof listener) => {
              listener = value;
            },
          },
        },
      },
      handler,
    );
    const sendResponse = vi.fn();
    expect(listener?.({ type: "unknown" }, {}, sendResponse)).toBe(false);
    expect(
      listener?.(
        {
          payload: { videoKey },
          protocolVersion: SPEECH_RUNTIME_PROTOCOL_VERSION,
          requestId: "active",
          type: "muzhi.speech.active",
        },
        {},
        sendResponse,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledOnce());
  });
});
