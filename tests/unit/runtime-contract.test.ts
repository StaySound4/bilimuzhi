import { describe, expect, it } from "vitest";

import {
  ACQUISITION_RUNTIME_PROTOCOL_VERSION,
  EXTENSION_ERROR_CODES,
  RUNTIME_PROTOCOL_VERSION,
  isAcquisitionRuntimeCommand,
  isAcquisitionRuntimeEvent,
  isExtensionError,
  isRuntimeCommand,
  isRuntimeEvent,
  type RuntimeCommand,
  type RuntimeEvent,
} from "../../src/application/runtime-contract";

const envelope = {
  protocolVersion: RUNTIME_PROTOCOL_VERSION,
  requestId: "request-1",
} as const;

describe("RuntimeCommand contract", () => {
  const commands = [
    {
      ...envelope,
      type: "muzhi.video.resolve",
      payload: { input: { kind: "current-tab", tabId: 42 } },
    },
    {
      ...envelope,
      type: "muzhi.video.resolve",
      payload: { input: { kind: "identifier", value: "BV1qTNP6QE4n?p=2" } },
    },
    {
      ...envelope,
      type: "muzhi.subtitle.tracks.list",
      payload: {
        videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
      },
    },
    {
      ...envelope,
      type: "muzhi.subtitle.acquire",
      payload: {
        videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
        method: "direct",
        trackId: "id:1002",
      },
    },
    {
      ...envelope,
      type: "muzhi.subtitle.acquire",
      payload: {
        videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
        method: "speech",
        languageMode: "mixed",
      },
    },
    {
      ...envelope,
      type: "muzhi.video.seek",
      payload: {
        videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
        seconds: 75.5,
      },
    },
    {
      ...envelope,
      type: "muzhi.video.time.read",
      payload: {
        videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
      },
    },
  ] satisfies RuntimeCommand[];

  it.each(commands)("accepts $type", (command) => {
    expect(isRuntimeCommand(command)).toBe(true);
  });

  it.each([
    { ...commands[0], protocolVersion: 2 },
    { ...commands[0], requestId: " " },
    { ...commands[0], type: "muzhi.unknown" },
    {
      ...commands[0],
      payload: { input: { kind: "current-tab", tabId: 0 } },
    },
    {
      ...commands[1],
      payload: { input: { kind: "identifier", value: "" } },
    },
    { ...commands[3], payload: { ...commands[3].payload, method: "auto" } },
    {
      ...commands[3],
      payload: { ...commands[3].payload, videoKey: "BV1qTNP6QE4n" },
    },
    {
      ...commands[2],
      payload: {
        videoKey: commands[2].payload.videoKey,
        method: "direct",
      },
    },
    {
      ...commands[2],
      payload: { ...commands[2].payload, trackId: "https://signed.example" },
    },
    {
      ...commands[2],
      payload: { ...commands[2].payload, languageMode: "mixed" },
    },
    {
      ...commands[4],
      payload: { ...commands[4].payload, trackId: "id:1002" },
    },
    { ...commands[5], payload: { ...commands[5].payload, seconds: -1 } },
    {
      ...commands[5],
      payload: { ...commands[5].payload, seconds: Number.NaN },
    },
    { ...commands[6], payload: { videoKey: "BV1qTNP6QE4n" } },
    { ...commands[0], rawResponse: { data: "provider payload" } },
  ])("rejects an invalid command", (command) => {
    expect(isRuntimeCommand(command)).toBe(false);
  });
});

describe("RuntimeEvent contract", () => {
  const resolvedEvent = {
    ...envelope,
    type: "muzhi.video.resolved",
    payload: {
      video: {
        videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
        bvid: "BV1qTNP6QE4n",
        cid: 30_000_000_000,
        page: 1,
        title: "完整视频",
        canonicalUrl: "https://www.bilibili.com/video/BV1qTNP6QE4n/",
      },
    },
  } satisfies RuntimeEvent;
  const subtitleEvent = {
    ...envelope,
    type: "muzhi.subtitle.acquired",
    payload: {
      videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
      subtitleId: "subtitle-1",
      rowCount: 3,
    },
  } satisfies RuntimeEvent;
  const tracksEvent = {
    ...envelope,
    type: "muzhi.subtitle.tracks.listed",
    payload: {
      tracks: [
        {
          language: "zh-CN",
          name: "中文（自动生成）",
          source: "ai",
          trackId: "id:1001",
        },
        {
          language: "en-US",
          name: "English",
          source: "official",
          trackId: "id:1002",
        },
      ],
      videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
    },
  } satisfies RuntimeEvent;
  const seekedEvent = {
    ...envelope,
    type: "muzhi.video.seeked",
    payload: {
      videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
      seconds: 0,
    },
  } satisfies RuntimeEvent;
  const reportedTimeEvent = {
    ...envelope,
    type: "muzhi.video.time.reported",
    payload: {
      currentTimeMs: 75_500,
      videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
    },
  } satisfies RuntimeEvent;
  const failedEvent = {
    ...envelope,
    type: "muzhi.command.failed",
    error: {
      code: "ASR_MEDIA_INCOMPLETE",
      message: "仅取得试看媒体，未启动语音转写",
      retryable: false,
      details: { availableDurationMs: 179_979, expectedDurationMs: 1_135_341 },
    },
  } satisfies RuntimeEvent;
  const events = [
    resolvedEvent,
    tracksEvent,
    subtitleEvent,
    seekedEvent,
    reportedTimeEvent,
    failedEvent,
  ];

  it.each(events)("accepts $type", (event) => {
    expect(isRuntimeEvent(event)).toBe(true);
  });

  it.each([
    { ...resolvedEvent, protocolVersion: 0 },
    {
      ...resolvedEvent,
      payload: { video: { ...resolvedEvent.payload.video, cid: -1 } },
    },
    {
      ...tracksEvent,
      payload: {
        ...tracksEvent.payload,
        tracks: [...tracksEvent.payload.tracks, tracksEvent.payload.tracks[0]],
      },
    },
    {
      ...tracksEvent,
      payload: {
        ...tracksEvent.payload,
        tracks: [
          {
            ...tracksEvent.payload.tracks[0],
            subtitleUrl: "https://aisubtitle.hdslb.com/signed.json",
          },
        ],
      },
    },
    {
      ...resolvedEvent,
      payload: { video: { ...resolvedEvent.payload.video, title: "" } },
    },
    {
      ...resolvedEvent,
      payload: {
        video: {
          ...resolvedEvent.payload.video,
          videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:2",
        },
      },
    },
    { ...subtitleEvent, payload: { ...subtitleEvent.payload, rowCount: -1 } },
    { ...subtitleEvent, payload: { ...subtitleEvent.payload, rowCount: 0 } },
    { ...seekedEvent, payload: { ...seekedEvent.payload, seconds: Infinity } },
    {
      ...seekedEvent,
      payload: { ...seekedEvent.payload, videoKey: "BV1qTNP6QE4n" },
    },
    {
      ...reportedTimeEvent,
      payload: { ...reportedTimeEvent.payload, currentTimeMs: 12.5 },
    },
    {
      ...failedEvent,
      error: { ...failedEvent.error, code: "RAW_PROVIDER_ERROR" },
    },
    { ...resolvedEvent, type: "muzhi.task.delta" },
    { ...resolvedEvent, rawResponse: { owner: { mid: 1 } } },
    {
      ...tracksEvent,
      payload: {
        ...tracksEvent.payload,
        tracks: [
          {
            ...tracksEvent.payload.tracks[0],
            origin: "supporter-upload",
          },
        ],
      },
    },
    {
      ...tracksEvent,
      payload: {
        ...tracksEvent.payload,
        tracks: [{ ...tracksEvent.payload.tracks[0], origin: 1 }],
      },
    },
  ])("rejects an invalid event", (event) => {
    expect(isRuntimeEvent(event)).toBe(false);
  });

  it("accepts track origins in the tracks.listed payload", () => {
    expect(
      isRuntimeEvent({
        ...tracksEvent,
        payload: {
          ...tracksEvent.payload,
          tracks: [
            { ...tracksEvent.payload.tracks[0], origin: "user-upload" },
            { ...tracksEvent.payload.tracks[1], origin: "official-cc" },
          ],
        },
      }),
    ).toBe(true);
  });
});

describe("ExtensionError contract", () => {
  it("publishes unique stable error codes", () => {
    expect(new Set(EXTENSION_ERROR_CODES).size).toBe(
      EXTENSION_ERROR_CODES.length,
    );
    expect(EXTENSION_ERROR_CODES).toContain("AUTHENTICATION_REQUIRED");
    expect(EXTENSION_ERROR_CODES).toContain("PERMISSION_DENIED");
    expect(EXTENSION_ERROR_CODES).toContain("SUBTITLE_URL_EXPIRED");
    expect(EXTENSION_ERROR_CODES).toContain("ASR_MEDIA_INCOMPLETE");
  });

  it("accepts a known sanitized error", () => {
    expect(
      isExtensionError({
        code: "NETWORK_ERROR",
        message: "请求失败",
        retryable: true,
        details: { status: 503 },
      }),
    ).toBe(true);
  });

  it.each([
    { code: "UNKNOWN", message: "失败", retryable: false },
    { code: "NETWORK_ERROR", message: "", retryable: true },
    { code: "NETWORK_ERROR", message: "失败", retryable: "yes" },
    { code: "NETWORK_ERROR", message: "失败", retryable: true, details: [] },
    {
      code: "NETWORK_ERROR",
      message: "失败",
      retryable: true,
      rawResponse: "provider payload",
    },
  ])("rejects an invalid error", (error) => {
    expect(isExtensionError(error)).toBe(false);
  });
});

describe("Acquisition runtime v2 contract", () => {
  const owner = {
    acquisitionId: "acquisition-1",
    draftBranchId: "branch-draft-1",
    expectedContextRevision: 0,
    expectedSelectionRevision: 4,
    sessionId: "session-1",
    taskId: "task-1",
    videoKey: "bvid:BV1qTNP6QE4n:cid:30000000000:p:1",
  } as const;
  const directCommand = {
    payload: {
      ...owner,
      method: "direct",
      trackId: "official:zh-CN:1",
    },
    protocolVersion: ACQUISITION_RUNTIME_PROTOCOL_VERSION,
    requestId: "request-v2-1",
    type: "muzhi.subtitle.acquire",
  } as const;
  const speechCommand = {
    payload: {
      ...owner,
      mediaIdentity: "bilibili-video-audio-v1",
      method: "speech",
      model: "whisper-large-v3-turbo",
      provider: "groq",
      requestedLanguageMode: "mixed",
    },
    protocolVersion: ACQUISITION_RUNTIME_PROTOCOL_VERSION,
    requestId: "request-v2-2",
    type: "muzhi.subtitle.acquire",
  } as const;
  const listCommand = {
    payload: owner,
    protocolVersion: ACQUISITION_RUNTIME_PROTOCOL_VERSION,
    requestId: "request-v2-list",
    type: "muzhi.subtitle.tracks.list",
  } as const;

  it("accepts list, direct, and speech commands only with the full owner revisions", () => {
    expect(isAcquisitionRuntimeCommand(listCommand)).toBe(true);
    expect(isAcquisitionRuntimeCommand(directCommand)).toBe(true);
    expect(isAcquisitionRuntimeCommand(speechCommand)).toBe(true);
    expect(
      isAcquisitionRuntimeCommand({
        ...directCommand,
        payload: {
          ...directCommand.payload,
          expectedContextRevision: undefined,
        },
      }),
    ).toBe(false);
  });

  it.each([
    { ...directCommand.payload, apiKey: "secret" },
    { ...directCommand.payload, trackId: "https://signed.example/subtitle" },
    {
      ...speechCommand.payload,
      mediaIdentity: "https://signed.example/audio",
    },
    { ...speechCommand.payload, rawResponse: { id: 1 } },
  ])("rejects secret, URL, or raw provider fields", (payload) => {
    expect(isAcquisitionRuntimeCommand({ ...directCommand, payload })).toBe(
      false,
    );
  });

  it("accepts a correlated acquisition result carrying the original owner", () => {
    expect(
      isAcquisitionRuntimeEvent({
        payload: {
          ...owner,
          branchId: owner.draftBranchId,
          rowCount: 18,
          subtitleId: "subtitle-1",
        },
        protocolVersion: ACQUISITION_RUNTIME_PROTOCOL_VERSION,
        requestId: "request-v2-1",
        type: "muzhi.subtitle.acquired",
      }),
    ).toBe(true);
  });

  it("accepts correlated track and sanitized failure events", () => {
    expect(
      isAcquisitionRuntimeEvent({
        payload: {
          ...owner,
          tracks: [
            {
              language: "zh-CN",
              name: "中文（自动生成）",
              source: "ai",
              trackId: "ai:zh-CN:1",
            },
          ],
        },
        protocolVersion: ACQUISITION_RUNTIME_PROTOCOL_VERSION,
        requestId: "request-v2-list",
        type: "muzhi.subtitle.tracks.listed",
      }),
    ).toBe(true);
    expect(
      isAcquisitionRuntimeEvent({
        error: {
          code: "PERMISSION_DENIED",
          message: "当前账号无权读取该字幕",
          retryable: false,
        },
        payload: owner,
        protocolVersion: ACQUISITION_RUNTIME_PROTOCOL_VERSION,
        requestId: "request-v2-1",
        type: "muzhi.acquisition.failed",
      }),
    ).toBe(true);
  });

  it.each([
    { ...directCommand, requestId: "https://signed.example/request" },
    { ...directCommand, rawResponse: { id: 1 } },
    {
      ...directCommand,
      payload: { ...directCommand.payload, expectedSelectionRevision: 1.5 },
    },
    {
      payload: {
        ...owner,
        branchId: "another-branch",
        rowCount: 1,
        subtitleId: "subtitle-1",
      },
      protocolVersion: ACQUISITION_RUNTIME_PROTOCOL_VERSION,
      requestId: "request-v2-1",
      type: "muzhi.subtitle.acquired",
    },
    {
      payload: {
        ...owner,
        branchId: owner.draftBranchId,
        rowCount: Number.MAX_SAFE_INTEGER + 1,
        signedUrl: "https://signed.example/subtitle",
        subtitleId: "subtitle-1",
      },
      protocolVersion: ACQUISITION_RUNTIME_PROTOCOL_VERSION,
      requestId: "request-v2-1",
      type: "muzhi.subtitle.acquired",
    },
  ])("rejects an unbounded, uncorrelated, or extended v2 envelope", (value) => {
    expect(
      isAcquisitionRuntimeCommand(value) || isAcquisitionRuntimeEvent(value),
    ).toBe(false);
  });

  it("keeps v2 commands outside the legacy v1 guard", () => {
    expect(isRuntimeCommand(directCommand)).toBe(false);
  });
});
