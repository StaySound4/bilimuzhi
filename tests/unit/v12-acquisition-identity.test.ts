import { describe, expect, it, vi } from "vitest";

import { createBranchSubtitleAcquisitionService } from "../../src/application/branch-subtitle-acquisition";
import {
  createSubtitleAcquisitionCoordinator,
  type SubtitleAcquisitionRuntime,
} from "../../src/application/subtitle-acquisition";
import type { DirectSubtitleAcquirer } from "../../src/application/subtitle-gateway";
import {
  SubtitleRepositoryError,
  type BranchSubtitleRepository,
  type InitialSubtitleCommitResult,
} from "../../src/application/subtitle-repository";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoRef,
} from "../../src/domain";

const p2Video = createVideoRef({
  aid: 88_000_022,
  bvid: "BV1Q541167Qg",
  canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
  cid: 30_000_000_022,
  page: 2,
  title: "当前精确 P2",
});

const p2Session = createSession({
  activeBranchId: null,
  createdAt: 1_000,
  customTitle: false,
  lastActivityAt: 1_000,
  selectionRevision: 4,
  sessionId: "session-p2",
  title: p2Video.title,
  updatedAt: 1_000,
  videoKey: p2Video.videoKey,
});

function committed(
  branchId: string,
  subtitleId: string,
  text: string,
): InitialSubtitleCommitResult {
  const subtitle = createSubtitleSnapshot({
    branchId,
    contentHash: `sha256:${subtitleId}`,
    createdAt: 2_000,
    language: "zh-CN",
    rows: [{ endMs: 2_000, startMs: 1_000, text }],
    sessionId: p2Session.sessionId,
    source: "bilibili",
    status: "active",
    subtitleId,
    videoKey: p2Video.videoKey,
  });
  return {
    branch: createSubtitleBranch({
      activeSubtitleId: subtitleId,
      branchId,
      contextRevision: 8,
      createdAt: 2_000,
      detectedLanguage: null,
      language: "zh-CN",
      lastOpenedAt: 2_000,
      lastSelectedAt: 2_000,
      requestedLanguageMode: null,
      sessionId: p2Session.sessionId,
      source: "bilibili",
      title: null,
      updatedAt: 2_000,
      videoKey: p2Video.videoKey,
    }),
    placement: createBranchPlacement({
      branchId,
      deletionReason: null,
      location: "workspace",
      order: 2_000,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: p2Session.sessionId,
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    }),
    session: createSession({
      ...p2Session,
      activeBranchId: branchId,
      selectionRevision: 5,
      updatedAt: 2_000,
    }),
    subtitle,
  };
}

function repository(
  commitAcquisition: BranchSubtitleRepository["commitAcquisition"] = vi.fn(
    async (owner, subtitle) =>
      committed(
        owner.draftBranchId,
        subtitle.subtitleId,
        subtitle.rows[0].text,
      ),
  ),
): BranchSubtitleRepository {
  return {
    beginAcquisition: vi.fn(async () => ({
      expectedContextRevision: 8,
      session: p2Session,
      video: p2Video,
    })),
    commitAcquisition,
    commitInitialAcquisition: vi.fn(),
    finishAcquisition: vi.fn(async () => undefined),
    readAcquisitionContext: vi.fn(async () => ({
      expectedContextRevision: 8,
      session: p2Session,
      video: p2Video,
    })),
  };
}

function staged(branchId: string, subtitleId: string, text: string) {
  return createSubtitleSnapshot({
    branchId,
    contentHash: `sha256:${subtitleId}`,
    createdAt: 1_900,
    language: "zh-CN",
    rows: [{ endMs: 2_000, startMs: 1_000, text }],
    sessionId: p2Session.sessionId,
    source: "bilibili",
    status: "staged",
    subtitleId,
    videoKey: p2Video.videoKey,
  });
}

describe("v12 exact subtitle acquisition identity (A1)", () => {
  it("carries the frozen requestOwner and pageRevision names in addition to every exact video/track/session field", async () => {
    const service = createBranchSubtitleAcquisitionService({
      createAcquisitionId: () => "acquisition-current",
      createDraftBranchId: () => "branch-current",
      createTaskId: () => "task-current",
      directAcquirer: async (input) =>
        staged(input.branchId!, "subtitle-current", "当前 P2 正文"),
      repository: repository(),
    });

    const handle = await service.startDirect({
      operationRevision: 17,
      requestId: "request-current",
      trackId: "track:official:zh:22",
      videoKey: p2Video.videoKey,
    });

    expect(Object.isFrozen(handle.owner)).toBe(true);
    expect(handle.owner).toMatchObject({
      aid: 88_000_022,
      bvid: "BV1Q541167Qg",
      cid: 30_000_000_022,
      page: 2,
      sessionId: "session-p2",
      subtitleContextRevision: 8,
      trackId: "track:official:zh:22",
    });
    expect(Reflect.get(handle.owner, "requestOwner")).toBe("request-current");
    expect(Reflect.get(handle.owner, "pageRevision")).toBe(17);
    await expect(handle.result).resolves.toMatchObject({
      subtitle: { rows: [{ text: "当前 P2 正文" }] },
    });
  });

  it("lets a newly bound request commit while a late old-page body is rejected", async () => {
    let resolveOld: ((value: ReturnType<typeof staged>) => void) | undefined;
    const oldBody = new Promise<ReturnType<typeof staged>>((resolve) => {
      resolveOld = resolve;
    });
    let currentRequest = "";
    const commits: string[] = [];
    const commitAcquisition: BranchSubtitleRepository["commitAcquisition"] =
      vi.fn(async (owner, subtitle) => {
        if (owner.requestId !== currentRequest) {
          throw new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "late owner cannot commit",
          );
        }
        commits.push(subtitle.rows[0].text);
        return committed(
          owner.draftBranchId,
          subtitle.subtitleId,
          subtitle.rows[0].text,
        );
      });
    const directAcquirer: DirectSubtitleAcquirer = vi.fn(async (input) =>
      input.trackId.endsWith(":old")
        ? oldBody
        : staged(input.branchId!, "subtitle-current", "当前 P2 正文"),
    );
    const service = createBranchSubtitleAcquisitionService({
      createAcquisitionId: () => globalThis.crypto.randomUUID(),
      createDraftBranchId: () => globalThis.crypto.randomUUID(),
      createTaskId: () => globalThis.crypto.randomUUID(),
      directAcquirer,
      repository: repository(commitAcquisition),
    });

    currentRequest = "request-old";
    const old = await service.startDirect({
      operationRevision: 16,
      requestId: currentRequest,
      trackId: "track:official:zh:old",
      videoKey: p2Video.videoKey,
    });
    currentRequest = "request-current";
    const current = await service.startDirect({
      operationRevision: 17,
      requestId: currentRequest,
      trackId: "track:official:zh:22",
      videoKey: p2Video.videoKey,
    });
    resolveOld?.(
      staged(old.owner.draftBranchId, "subtitle-old", "旧页面错误正文"),
    );

    const [oldResult, currentResult] = await Promise.allSettled([
      old.result,
      current.result,
    ]);
    expect(oldResult.status).toBe("rejected");
    expect(currentResult).toMatchObject({ status: "fulfilled" });
    expect(commits).toEqual(["当前 P2 正文"]);
  });

  it("clears historical tracks when the current exact target has no subtitle", async () => {
    const oldVideoKey = "bvid:BV1Q541167Qg:cid:30000000021:p:1" as const;
    const runtime: SubtitleAcquisitionRuntime = {
      acquire: vi.fn(),
      listTracks: vi.fn(async (videoKey) =>
        videoKey === oldVideoKey
          ? [
              {
                language: "zh-CN",
                name: "旧 P1 字幕",
                source: "official" as const,
                trackId: "track:p1",
              },
            ]
          : [],
      ),
    };
    const coordinator = createSubtitleAcquisitionCoordinator({ runtime });

    await coordinator.discover(oldVideoKey);
    await expect(coordinator.discover(p2Video.videoKey)).resolves.toMatchObject(
      {
        error: { code: "SUBTITLE_NOT_FOUND" },
        phase: "error",
        selectedTrackId: null,
        tracks: [],
      },
    );
    expect(coordinator.snapshot().tracks).not.toContainEqual(
      expect.objectContaining({ trackId: "track:p1" }),
    );
    expect(runtime.acquire).not.toHaveBeenCalled();
  });
});

describe("real Bilibili evidence boundary", () => {
  it.skip("not-run:user-acceptance — confirms first-attempt text on an actual ordinary/multi-P page", () => {
    // A deterministic seam cannot prove the user's live login state or
    // the text displayed by Bilibili's current player.
  });
});
