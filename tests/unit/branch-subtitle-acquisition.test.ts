import { describe, expect, it, vi } from "vitest";

import {
  createBranchSubtitleAcquisitionService,
  type StartDirectSubtitleAcquisitionInput,
} from "../../src/application/branch-subtitle-acquisition";
import {
  SubtitleRepositoryError,
  type BranchSubtitleRepository,
  type InitialSubtitleCommitResult,
} from "../../src/application/subtitle-repository";
import type { DirectSubtitleAcquirer } from "../../src/application/subtitle-gateway";
import {
  createBranchPlacement,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  createVideoRef,
} from "../../src/domain";

function createFixture() {
  const video = createVideoRef({
    aid: 88_000_002,
    bvid: "BV1Q541167Qg",
    canonicalUrl: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    cid: 30_000_000_002,
    page: 2,
    title: "精确分 P",
  });
  const session = createSession({
    activeBranchId: null,
    createdAt: 1_000,
    customTitle: false,
    lastActivityAt: 1_000,
    selectionRevision: 4,
    sessionId: "session-1",
    title: video.title,
    updatedAt: 1_000,
    videoKey: video.videoKey,
  });
  return { session, video };
}

function createCommittedResult(
  branchId: string,
  subtitleId: string,
): InitialSubtitleCommitResult {
  const { session, video } = createFixture();
  const subtitle = createSubtitleSnapshot({
    branchId,
    contentHash: `sha256:${subtitleId}`,
    createdAt: 2_000,
    language: "zh-CN",
    rows: [{ endMs: 1_000, startMs: 0, text: subtitleId }],
    sessionId: session.sessionId,
    source: "bilibili",
    status: "active",
    subtitleId,
    videoKey: video.videoKey,
  });
  const branch = createSubtitleBranch({
    activeSubtitleId: subtitle.subtitleId,
    branchId,
    contextRevision: 1,
    createdAt: subtitle.createdAt,
    detectedLanguage: null,
    language: subtitle.language,
    lastOpenedAt: subtitle.createdAt,
    lastSelectedAt: subtitle.createdAt,
    requestedLanguageMode: null,
    sessionId: session.sessionId,
    source: subtitle.source,
    title: null,
    updatedAt: subtitle.createdAt,
    videoKey: video.videoKey,
  });
  const placement = createBranchPlacement({
    branchId,
    deletionReason: null,
    location: "workspace",
    order: subtitle.createdAt,
    purgeAfter: null,
    retentionStartedAt: null,
    sessionId: session.sessionId,
    trashedAt: null,
    trashOrigin: null,
    trashOriginFolderId: null,
    trashOriginPathSnapshot: null,
  });
  return {
    branch,
    placement,
    session: createSession({
      ...session,
      activeBranchId: branchId,
      selectionRevision: 5,
      updatedAt: subtitle.createdAt,
    }),
    subtitle,
  };
}

function createRepository(): BranchSubtitleRepository {
  const { session, video } = createFixture();
  return {
    beginAcquisition: vi.fn(async () => ({
      expectedContextRevision: 1,
      session,
      video,
    })),
    commitAcquisition: vi.fn(async (owner) =>
      createCommittedResult(owner.draftBranchId, `subtitle-${owner.taskId}`),
    ),
    commitInitialAcquisition: vi.fn(),
    finishAcquisition: vi.fn(async () => undefined),
    readAcquisitionContext: vi.fn(async () => ({
      expectedContextRevision: 1,
      session,
      video,
    })),
  };
}

describe("BranchSubtitleAcquisitionService", () => {
  it("rejects a late first-page body after a newly bound operation owns the same VideoKey", async () => {
    const { session, video } = createFixture();
    let serial = 0;
    let activeOperationRevision = 0;
    let resolveOldBody:
      ((value: ReturnType<typeof createSubtitleSnapshot>) => void) | undefined;
    const oldBody = new Promise<ReturnType<typeof createSubtitleSnapshot>>(
      (resolve) => {
        resolveOldBody = resolve;
      },
    );
    const staged = (branchId: string, subtitleId: string, text: string) =>
      createSubtitleSnapshot({
        branchId,
        contentHash: `sha256:${subtitleId}`,
        createdAt: 2_000,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text }],
        sessionId: session.sessionId,
        source: "bilibili",
        status: "staged",
        subtitleId,
        videoKey: video.videoKey,
      });
    const repository: BranchSubtitleRepository = {
      beginAcquisition: vi.fn(async (owner) => {
        activeOperationRevision = Number(
          Reflect.get(owner, "operationRevision"),
        );
        return { expectedContextRevision: 1, session, video };
      }),
      commitAcquisition: vi.fn(async (owner, subtitle) => {
        if (
          Number(Reflect.get(owner, "operationRevision")) !==
          activeOperationRevision
        ) {
          throw new SubtitleRepositoryError(
            "VALIDATION_FAILED",
            "The acquisition owner is stale",
          );
        }
        const committed = createCommittedResult(
          owner.draftBranchId,
          subtitle.subtitleId,
        );
        return {
          ...committed,
          subtitle: createSubtitleSnapshot({ ...subtitle, status: "active" }),
        };
      }),
      commitInitialAcquisition: vi.fn(),
      finishAcquisition: vi.fn(async () => undefined),
      readAcquisitionContext: vi.fn(async () => ({
        expectedContextRevision: 1,
        session,
        video,
      })),
    };
    const directAcquirer: DirectSubtitleAcquirer = vi.fn(async (input) => {
      const call = vi.mocked(directAcquirer).mock.calls.length;
      return call === 1
        ? oldBody
        : staged(input.branchId!, "subtitle-current", "当前分 P 正文");
    });
    const service = createBranchSubtitleAcquisitionService({
      createAcquisitionId: () => `acquisition-${++serial}`,
      createDraftBranchId: () => `branch-${serial}`,
      createTaskId: () => `task-${serial}`,
      directAcquirer,
      repository,
    });
    const operation = (operationRevision: number) =>
      ({
        operationRevision,
        trackId: "official:zh:1",
        videoKey: video.videoKey,
      }) as StartDirectSubtitleAcquisitionInput;

    const oldHandle = await service.startDirect(operation(1));
    const currentHandle = await service.startDirect(operation(2));
    resolveOldBody?.(
      staged(oldHandle.owner.draftBranchId, "subtitle-old", "旧页面错误正文"),
    );
    const [oldOutcome, currentOutcome] = await Promise.allSettled([
      oldHandle.result,
      currentHandle.result,
    ]);

    expect(repository.readAcquisitionContext).toHaveBeenCalledTimes(2);
    expect(currentHandle.owner).not.toEqual(oldHandle.owner);
    expect(currentHandle.owner).toMatchObject({
      aid: video.aid,
      bvid: video.bvid,
      cid: video.cid,
      operationRevision: 2,
      page: video.page,
      sessionId: session.sessionId,
      subtitleContextRevision: 1,
      trackId: "official:zh:1",
    });
    expect(oldOutcome.status).toBe("rejected");
    expect(currentOutcome).toMatchObject({
      status: "fulfilled",
      value: {
        subtitle: {
          rows: [{ text: "当前分 P 正文" }],
        },
      },
    });
  });

  it("deduplicates an active exact direct request and commits its owner branch", async () => {
    const { video } = createFixture();
    const repository = createRepository();
    const directAcquirer: DirectSubtitleAcquirer = vi.fn(async (input) =>
      createSubtitleSnapshot({
        branchId: input.branchId!,
        contentHash: "sha256:direct",
        createdAt: 2_000,
        language: "zh-CN",
        rows: [{ endMs: 1_000, startMs: 0, text: "direct" }],
        sessionId: input.session.sessionId,
        source: "bilibili",
        status: "staged",
        subtitleId: "subtitle-direct",
        videoKey: input.video.videoKey,
      }),
    );
    const service = createBranchSubtitleAcquisitionService({
      createAcquisitionId: () => "acquisition-1",
      createDraftBranchId: () => "branch-1",
      createTaskId: () => "task-1",
      directAcquirer,
      repository,
    });

    const first = service.startDirect({
      trackId: "official:zh:1",
      videoKey: video.videoKey,
    });
    const duplicate = service.startDirect({
      trackId: "official:zh:1",
      videoKey: video.videoKey,
    });
    expect(duplicate).toBe(first);

    const handle = await first;
    await expect(handle.result).resolves.toMatchObject({
      branch: { branchId: "branch-1" },
      subtitle: { status: "active" },
    });
    expect(repository.beginAcquisition).toHaveBeenCalledOnce();
    expect(directAcquirer).toHaveBeenCalledOnce();
    expect(repository.commitAcquisition).toHaveBeenCalledWith(
      handle.owner,
      expect.objectContaining({ branchId: "branch-1", status: "staged" }),
    );
  });

  it("isolates different direct tracks into distinct owner branches", async () => {
    const { video } = createFixture();
    const repository = createRepository();
    let serial = 0;
    const service = createBranchSubtitleAcquisitionService({
      createAcquisitionId: () => `acquisition-${++serial}`,
      createDraftBranchId: () => `branch-${serial}`,
      createTaskId: () => `task-${serial}`,
      directAcquirer: async (input) =>
        createSubtitleSnapshot({
          branchId: input.branchId!,
          contentHash: `sha256:${input.trackId}`,
          createdAt: 2_000,
          language: "zh-CN",
          rows: [{ endMs: 1_000, startMs: 0, text: input.trackId }],
          sessionId: input.session.sessionId,
          source: "bilibili",
          status: "staged",
          subtitleId: `subtitle-${input.trackId}`,
          videoKey: input.video.videoKey,
        }),
      repository,
    });

    const [first, second] = await Promise.all([
      service.startDirect({
        trackId: "official:zh:1",
        videoKey: video.videoKey,
      }),
      service.startDirect({
        trackId: "official:en:1",
        videoKey: video.videoKey,
      }),
    ]);

    expect(first.owner.draftBranchId).not.toBe(second.owner.draftBranchId);
    await expect(
      Promise.all([first.result, second.result]),
    ).resolves.toHaveLength(2);
    expect(repository.beginAcquisition).toHaveBeenCalledTimes(2);
    expect(repository.commitAcquisition).toHaveBeenCalledTimes(2);
  });

  it("marks a failed direct operation before returning its original error", async () => {
    const { video } = createFixture();
    const repository = createRepository();
    const service = createBranchSubtitleAcquisitionService({
      createAcquisitionId: () => "acquisition-failed",
      createDraftBranchId: () => "branch-failed",
      createTaskId: () => "task-failed",
      directAcquirer: async () => {
        throw new SubtitleRepositoryError("VALIDATION_FAILED", "invalid track");
      },
      repository,
    });

    const handle = await service.startDirect({
      trackId: "official:bad:1",
      videoKey: video.videoKey,
    });
    await expect(handle.result).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    expect(repository.commitAcquisition).not.toHaveBeenCalled();
    expect(repository.finishAcquisition).toHaveBeenCalledWith(
      handle.owner,
      "failed",
    );
  });
});
