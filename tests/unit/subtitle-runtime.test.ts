import { describe, expect, it, vi } from "vitest";

import {
  RUNTIME_PROTOCOL_VERSION,
  type RuntimeCommand,
} from "../../src/application/runtime-contract";
import type { DirectSubtitleAcquirer } from "../../src/application/subtitle-gateway";
import type { BranchSubtitleAcquisitionService } from "../../src/application/branch-subtitle-acquisition";
import type { SubtitleRepository } from "../../src/application/subtitle-repository";
import { createSubtitleRuntimeHandler } from "../../src/application/subtitle-runtime";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoRef,
} from "../../src/domain";

function createContext() {
  const video = createVideoRef({
    aid: 88_000_099,
    bvid: "BV1xx411c7mD",
    canonicalUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    cid: 30_000_000_099,
    page: 1,
    title: "runtime test",
  });
  const session = createSession({
    activeBranchId: null,
    createdAt: 1_000,
    customTitle: false,
    lastActivityAt: 1_000,
    selectionRevision: 0,
    sessionId: "session-runtime",
    title: video.title,
    updatedAt: 1_000,
    videoKey: video.videoKey,
  });
  const staged = createSubtitleSnapshot({
    branchId: "branch-runtime",
    contentHash: "sha256:runtime",
    createdAt: 1_500,
    language: "en-US",
    rows: [{ endMs: 2_000, startMs: 1_000, text: "runtime subtitle" }],
    sessionId: session.sessionId,
    source: "bilibili",
    status: "staged",
    subtitleId: "subtitle-runtime",
    videoKey: video.videoKey,
  });
  const active = createSubtitleSnapshot({ ...staged, status: "active" });
  const branch = createSubtitleBranch({
    activeSubtitleId: active.subtitleId,
    branchId: active.branchId,
    contextRevision: 1,
    createdAt: active.createdAt,
    detectedLanguage: null,
    language: active.language,
    lastOpenedAt: active.createdAt,
    lastSelectedAt: active.createdAt,
    requestedLanguageMode: null,
    sessionId: active.sessionId,
    source: active.source,
    title: null,
    updatedAt: active.createdAt,
    videoKey: active.videoKey,
  });
  const placement = createBranchPlacement({
    branchId: branch.branchId,
    deletionReason: null,
    location: "workspace",
    order: branch.createdAt,
    purgeAfter: null,
    retentionStartedAt: null,
    sessionId: branch.sessionId,
    trashedAt: null,
    trashOrigin: null,
    trashOriginFolderId: null,
    trashOriginPathSnapshot: null,
  });
  return { active, branch, placement, session, staged, video };
}

function createCommand(
  command:
    | {
        type: "muzhi.subtitle.tracks.list";
        payload: {
          videoKey: ReturnType<typeof createContext>["video"]["videoKey"];
        };
      }
    | {
        type: "muzhi.subtitle.acquire";
        payload: {
          method: "direct";
          trackId: string;
          videoKey: ReturnType<typeof createContext>["video"]["videoKey"];
        };
      },
): RuntimeCommand {
  return {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    requestId: "request-runtime",
    ...command,
  } as RuntimeCommand;
}

describe("subtitle runtime handler", () => {
  it("lists safe tracks from the authoritative persisted video context", async () => {
    const context = createContext();
    const repository: SubtitleRepository = {
      commitInitialAcquisition: vi.fn(),
      readAcquisitionContext: vi.fn(async () => ({
        expectedContextRevision: 1,
        session: context.session,
        video: context.video,
      })),
    };
    const listTracks = vi.fn(async () => [
      {
        language: "en-US",
        name: "English",
        source: "official" as const,
        trackId: "id:1002",
      },
    ]);
    const handler = createSubtitleRuntimeHandler({
      acquireDirect: vi.fn(),
      gateway: { acquire: vi.fn(), listTracks },
      repository,
    });

    await expect(
      handler(
        createCommand({
          payload: { videoKey: context.video.videoKey },
          type: "muzhi.subtitle.tracks.list",
        }),
      ),
    ).resolves.toEqual({
      payload: {
        tracks: [
          {
            language: "en-US",
            name: "English",
            source: "official",
            trackId: "id:1002",
          },
        ],
        videoKey: context.video.videoKey,
      },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: "request-runtime",
      type: "muzhi.subtitle.tracks.listed",
    });
    expect(repository.readAcquisitionContext).toHaveBeenCalledWith(
      context.video.videoKey,
    );
    expect(listTracks).toHaveBeenCalledWith(context.video);
  });

  it("does not publish acquired success before the atomic commit resolves", async () => {
    const context = createContext();
    let finishCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => {
      finishCommit = resolve;
    });
    const commitInitialAcquisition = vi.fn(async () => {
      await commitGate;
      return {
        branch: context.branch,
        placement: context.placement,
        session: context.session,
        subtitle: context.active,
      };
    });
    const repository: SubtitleRepository = {
      commitInitialAcquisition,
      readAcquisitionContext: vi.fn(async () => ({
        expectedContextRevision: 1,
        session: context.session,
        video: context.video,
      })),
    };
    const acquireDirect: DirectSubtitleAcquirer = vi.fn(
      async () => context.staged,
    );
    const handler = createSubtitleRuntimeHandler({
      acquireDirect,
      gateway: { acquire: vi.fn(), listTracks: vi.fn() },
      repository,
    });
    let settled = false;
    const handling = handler(
      createCommand({
        payload: {
          method: "direct",
          trackId: "id:1002",
          videoKey: context.video.videoKey,
        },
        type: "muzhi.subtitle.acquire",
      }),
    ).then((event) => {
      settled = true;
      return event;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(acquireDirect).toHaveBeenCalledWith({
      session: context.session,
      trackId: "id:1002",
      video: context.video,
    });
    finishCommit?.();

    await expect(handling).resolves.toEqual({
      payload: {
        rowCount: 1,
        subtitleId: context.active.subtitleId,
        videoKey: context.video.videoKey,
      },
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      requestId: "request-runtime",
      type: "muzhi.subtitle.acquired",
    });
    expect(commitInitialAcquisition).toHaveBeenCalledWith(context.staged);
  });

  it("uses the owner-correlated Branch acquisition service when it is supplied", async () => {
    const context = createContext();
    const repository: SubtitleRepository = {
      commitInitialAcquisition: vi.fn(),
      readAcquisitionContext: vi.fn(async () => ({
        expectedContextRevision: 1,
        session: context.session,
        video: context.video,
      })),
    };
    const startDirect = vi.fn(async () => ({
      cancel: vi.fn(async () => undefined),
      owner: {
        acquisitionId: "acquisition-runtime",
        draftBranchId: context.branch.branchId,
        expectedContextRevision: 1,
        expectedSelectionRevision: 0,
        sessionId: context.session.sessionId,
        taskId: "task-runtime",
        videoKey: context.video.videoKey,
      },
      result: Promise.resolve({
        branch: context.branch,
        placement: context.placement,
        session: context.session,
        subtitle: context.active,
      }),
    }));
    const branchAcquisition: BranchSubtitleAcquisitionService = { startDirect };
    const acquireDirect = vi.fn();
    const handler = createSubtitleRuntimeHandler({
      acquireDirect,
      branchAcquisition,
      gateway: { acquire: vi.fn(), listTracks: vi.fn() },
      repository,
    });

    await expect(
      handler(
        createCommand({
          payload: {
            method: "direct",
            trackId: "id:1002",
            videoKey: context.video.videoKey,
          },
          type: "muzhi.subtitle.acquire",
        }),
      ),
    ).resolves.toMatchObject({ type: "muzhi.subtitle.acquired" });
    expect(startDirect).toHaveBeenCalledWith({
      trackId: "id:1002",
      videoKey: context.video.videoKey,
    });
    expect(acquireDirect).not.toHaveBeenCalled();
    expect(repository.commitInitialAcquisition).not.toHaveBeenCalled();
  });

  it("ignores invalid envelopes and sanitizes unexpected failures", async () => {
    const context = createContext();
    const repository: SubtitleRepository = {
      commitInitialAcquisition: vi.fn(),
      readAcquisitionContext: vi.fn(async () => {
        throw new Error("SESSDATA=secret token=signed-url");
      }),
    };
    const handler = createSubtitleRuntimeHandler({
      acquireDirect: vi.fn(),
      gateway: { acquire: vi.fn(), listTracks: vi.fn() },
      repository,
    });

    await expect(
      handler({ type: "unknown", rawResponse: "secret" }),
    ).resolves.toBeUndefined();
    const failure = await handler(
      createCommand({
        payload: { videoKey: context.video.videoKey },
        type: "muzhi.subtitle.tracks.list",
      }),
    );
    expect(failure).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        message: "字幕操作失败，请重试。",
        retryable: false,
      },
      requestId: "request-runtime",
      type: "muzhi.command.failed",
    });
    expect(JSON.stringify(failure)).not.toMatch(/SESSDATA|token|signed-url/);
  });
});
