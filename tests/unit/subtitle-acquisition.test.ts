import { describe, expect, it, vi } from "vitest";

import {
  createSubtitleAcquisitionCoordinator,
  type SubtitleAcquisitionRuntime,
} from "../../src/application/subtitle-acquisition";

const videoKey = "bvid:BV1xx411c7mD:cid:30000000099:p:1" as const;
const otherVideoKey = "bvid:BV1xx411c7mD:cid:30000000100:p:2" as const;
const tracks = [
  {
    language: "zh-CN",
    name: "中文（自动生成）",
    source: "ai" as const,
    trackId: "id:1001",
  },
  {
    language: "en-US",
    name: "English",
    source: "official" as const,
    trackId: "id:1002",
  },
];

describe("SubtitleAcquisitionCoordinator", () => {
  it.each([
    ["AUTHENTICATION_REQUIRED", "需要先登录 Bilibili，再重新查找字幕。"],
    ["PERMISSION_DENIED", "当前 Bilibili 账号无权访问该字幕轨道。"],
    ["SUBTITLE_URL_EXPIRED", "字幕地址已过期，请重新查找轨道后再试。"],
    ["VALIDATION_FAILED", "字幕数据与当前视频不一致，已停止保存。"],
  ] as const)(
    "maps %s to a stable user-facing diagnostic",
    async (code, expectedMessage) => {
      const runtime: SubtitleAcquisitionRuntime = {
        acquire: vi.fn(),
        listTracks: vi.fn(async () => {
          throw {
            code,
            message: "raw provider detail must not reach the UI",
            retryable: code === "SUBTITLE_URL_EXPIRED",
          };
        }),
      };
      const coordinator = createSubtitleAcquisitionCoordinator({ runtime });

      await expect(coordinator.discover(videoKey)).resolves.toMatchObject({
        error: { code, message: expectedMessage },
        phase: "error",
      });
    },
  );

  it("将无轨道视频稳定提示为没有可用的 B 站字幕，而不是网络错误", async () => {
    const runtime: SubtitleAcquisitionRuntime = {
      acquire: vi.fn(),
      listTracks: vi.fn(async () => []),
    };
    const coordinator = createSubtitleAcquisitionCoordinator({ runtime });

    await expect(coordinator.discover(videoKey)).resolves.toMatchObject({
      error: {
        code: "SUBTITLE_NOT_FOUND",
        message: "该视频没有可用的 B 站字幕。",
        retryable: false,
      },
      phase: "error",
    });
  });

  it("publishes finding, selection, acquisition, and success as controlled states", async () => {
    const runtime: SubtitleAcquisitionRuntime = {
      acquire: vi.fn(async () => ({
        rowCount: 1,
        subtitleId: "subtitle-acquired",
        videoKey,
      })),
      listTracks: vi.fn(async () => tracks),
    };
    const onChange = vi.fn();
    const coordinator = createSubtitleAcquisitionCoordinator({
      onChange,
      runtime,
    });

    await expect(coordinator.discover(videoKey)).resolves.toMatchObject({
      phase: "selecting",
      selectedTrackId: "id:1001",
      tracks,
    });
    expect(onChange.mock.calls[0]?.[0]).toMatchObject({ phase: "finding" });
    expect(onChange.mock.calls[1]?.[0]).toMatchObject({ phase: "selecting" });

    expect(coordinator.select("id:1002")).toMatchObject({
      phase: "selecting",
      selectedTrackId: "id:1002",
    });
    const acquiring = coordinator.acquire(videoKey);
    expect(coordinator.snapshot()).toMatchObject({ phase: "acquiring" });
    await expect(acquiring).resolves.toMatchObject({
      phase: "success",
      rowCount: 1,
      selectedTrackId: "id:1002",
    });
    expect(runtime.acquire).toHaveBeenCalledWith(videoKey, "id:1002");
  });

  it("cancels track selection without a write and suppresses duplicate discovery", async () => {
    let resolveTracks: ((value: typeof tracks) => void) | undefined;
    const runtime: SubtitleAcquisitionRuntime = {
      acquire: vi.fn(),
      listTracks: vi.fn(
        () =>
          new Promise<typeof tracks>((resolve) => {
            resolveTracks = resolve;
          }),
      ),
    };
    const coordinator = createSubtitleAcquisitionCoordinator({ runtime });

    const first = coordinator.discover(videoKey);
    const duplicate = coordinator.discover(videoKey);
    resolveTracks?.(tracks);
    await Promise.all([first, duplicate]);
    expect(runtime.listTracks).toHaveBeenCalledOnce();

    expect(coordinator.cancel()).toMatchObject({
      phase: "idle",
      tracks: [],
    });
    expect(runtime.acquire).not.toHaveBeenCalled();
  });

  it("keeps a late discovery from an old video out of the current selection", async () => {
    let resolveFirst: ((value: typeof tracks) => void) | undefined;
    const otherTracks = [
      {
        language: "ja-JP",
        name: "日本語",
        source: "official" as const,
        trackId: "id:2001",
      },
    ];
    const runtime: SubtitleAcquisitionRuntime = {
      acquire: vi.fn(),
      listTracks: vi.fn((requestedVideoKey) => {
        if (requestedVideoKey === videoKey) {
          return new Promise<typeof tracks>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(otherTracks);
      }),
    };
    const coordinator = createSubtitleAcquisitionCoordinator({ runtime });

    const first = coordinator.discover(videoKey);
    await expect(coordinator.discover(otherVideoKey)).resolves.toMatchObject({
      phase: "selecting",
      selectedTrackId: "id:2001",
      tracks: otherTracks,
    });
    resolveFirst?.(tracks);
    await first;

    expect(coordinator.snapshot()).toMatchObject({
      phase: "selecting",
      selectedTrackId: "id:2001",
      tracks: otherTracks,
    });
    expect(runtime.listTracks).toHaveBeenCalledTimes(2);
  });

  it("does not acquire a track discovered for a different video", async () => {
    const runtime: SubtitleAcquisitionRuntime = {
      acquire: vi.fn(),
      listTracks: vi.fn(async () => tracks),
    };
    const coordinator = createSubtitleAcquisitionCoordinator({ runtime });

    await coordinator.discover(videoKey);
    await expect(coordinator.acquire(otherVideoKey)).resolves.toMatchObject({
      phase: "selecting",
      selectedTrackId: "id:1001",
    });

    expect(runtime.acquire).not.toHaveBeenCalled();
  });

  it("lets an old confirmed request finish without overwriting a new context", async () => {
    let resolveAcquire:
      | ((value: {
          rowCount: number;
          subtitleId: string;
          videoKey: typeof videoKey;
        }) => void)
      | undefined;
    const otherTracks = [
      {
        language: "ja-JP",
        name: "日本語",
        source: "official" as const,
        trackId: "id:2001",
      },
    ];
    const runtime: SubtitleAcquisitionRuntime = {
      acquire: vi.fn(
        () =>
          new Promise<{
            rowCount: number;
            subtitleId: string;
            videoKey: typeof videoKey;
          }>((resolve) => {
            resolveAcquire = resolve;
          }),
      ),
      listTracks: vi.fn(async (requestedVideoKey) =>
        requestedVideoKey === videoKey ? tracks : otherTracks,
      ),
    };
    const coordinator = createSubtitleAcquisitionCoordinator({ runtime });

    await coordinator.discover(videoKey);
    const oldAcquisition = coordinator.acquire(videoKey);
    coordinator.reset();
    await coordinator.discover(otherVideoKey);
    resolveAcquire?.({
      rowCount: 1,
      subtitleId: "subtitle-old-context",
      videoKey,
    });
    await oldAcquisition;

    expect(coordinator.snapshot()).toMatchObject({
      phase: "selecting",
      selectedTrackId: "id:2001",
      tracks: otherTracks,
    });
    expect(runtime.acquire).toHaveBeenCalledOnce();
  });
});
