import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  createArchiveFolder,
  createArchiveSessionPlacement,
  createBranchPlacement,
  createContentOwner,
  createSubtitleBranch,
  createWorkspaceSessionPlacement,
} from "../../src/domain";

const videoKey = "bvid:BV1qTNP6QE4n:cid:30000000000:p:1" as const;

describe("SubtitleBranch", () => {
  const input = {
    activeSubtitleId: "subtitle-1",
    branchId: "branch-1",
    contextRevision: 1,
    createdAt: 1_000,
    detectedLanguage: null,
    language: "zh-CN",
    lastOpenedAt: 1_200,
    lastSelectedAt: 1_100,
    requestedLanguageMode: null,
    sessionId: "session-1",
    source: "bilibili",
    title: null,
    updatedAt: 1_200,
    videoKey,
  } as const;

  it("owns the active immutable subtitle and independent content revision", () => {
    const branch = createSubtitleBranch(input);

    expect(branch).toEqual({
      ...input,
      completionSequence: 0,
      lastReadCompletionSequence: 0,
    });
    expect(Object.isFrozen(branch)).toBe(true);
  });

  it.each([
    { branchId: "" },
    { activeSubtitleId: "" },
    { contextRevision: 0 },
    { requestedLanguageMode: "auto" },
    { requestedLanguageMode: "zh" },
    { detectedLanguage: "zh-CN" },
    { lastOpenedAt: 999 },
  ])("rejects an invalid branch invariant", (override) => {
    expect(() =>
      createSubtitleBranch({
        ...input,
        ...override,
      } as Parameters<typeof createSubtitleBranch>[0]),
    ).toThrow(DomainValidationError);
  });
});

describe("BranchPlacement", () => {
  it("expresses one workspace location without trash metadata", () => {
    const placement = createBranchPlacement({
      branchId: "branch-1",
      deletionReason: null,
      location: "workspace",
      order: 1_000,
      purgeAfter: null,
      retentionStartedAt: null,
      sessionId: "session-1",
      trashedAt: null,
      trashOrigin: null,
      trashOriginFolderId: null,
      trashOriginPathSnapshot: null,
    });

    expect(placement.location).toBe("workspace");
    expect(Object.isFrozen(placement)).toBe(true);
  });

  it("requires complete and monotonic trash lifetime metadata", () => {
    expect(() =>
      createBranchPlacement({
        branchId: "branch-1",
        deletionReason: "user",
        location: "trash",
        order: 1_000,
        purgeAfter: 1_500,
        retentionStartedAt: 1_100,
        sessionId: "session-1",
        trashedAt: 1_200,
        trashOrigin: "workspace",
        trashOriginFolderId: null,
        trashOriginPathSnapshot: null,
      }),
    ).toThrow(DomainValidationError);
  });

  it("keeps archive-origin metadata complete and rejects it for workspace origin", () => {
    expect(
      createBranchPlacement({
        branchId: "branch-1",
        deletionReason: "user",
        location: "trash",
        order: 1_000,
        purgeAfter: null,
        retentionStartedAt: 1_200,
        sessionId: "session-1",
        trashedAt: 1_200,
        trashOrigin: "archive",
        trashOriginFolderId: "folder-1",
        trashOriginPathSnapshot: "课程/归档",
      }),
    ).toMatchObject({
      trashOrigin: "archive",
      trashOriginFolderId: "folder-1",
    });
    expect(() =>
      createBranchPlacement({
        branchId: "branch-1",
        deletionReason: "user",
        location: "trash",
        order: 1_000,
        purgeAfter: null,
        retentionStartedAt: 1_200,
        sessionId: "session-1",
        trashedAt: 1_200,
        trashOrigin: "workspace",
        trashOriginFolderId: "folder-1",
        trashOriginPathSnapshot: "课程/归档",
      }),
    ).toThrow(DomainValidationError);
  });
});

describe("Session placements and archive folders", () => {
  it("normalizes and freezes the three session-level placement records", () => {
    const workspace = createWorkspaceSessionPlacement({
      order: 2,
      pinned: false,
      sessionId: " session-1 ",
    });
    const archive = createArchiveSessionPlacement({
      archivedAt: 3,
      folderId: " folder-1 ",
      order: 3,
      pinned: true,
      sessionId: " session-1 ",
    });
    const folder = createArchiveFolder({
      folderId: " folder-1 ",
      order: 4,
      parentFolderId: " archive-root ",
      title: " 课程 ",
    });

    expect(workspace).toEqual({
      order: 2,
      pinned: false,
      sessionId: "session-1",
    });
    expect(archive).toEqual({
      archivedAt: 3,
      folderId: "folder-1",
      order: 3,
      pinned: true,
      sessionId: "session-1",
    });
    expect(folder).toEqual({
      folderId: "folder-1",
      order: 4,
      parentFolderId: "archive-root",
      title: "课程",
    });
    expect([workspace, archive, folder].every(Object.isFrozen)).toBe(true);
  });

  it("rejects invalid pins and self-parenting archive folders", () => {
    expect(() =>
      createWorkspaceSessionPlacement({
        order: 0,
        pinned: "yes" as unknown as boolean,
        sessionId: "session-1",
      }),
    ).toThrow(DomainValidationError);
    expect(() =>
      createArchiveFolder({
        folderId: "folder-1",
        order: 0,
        parentFolderId: "folder-1",
        title: "循环",
      }),
    ).toThrow(DomainValidationError);
  });
});

describe("ContentOwner", () => {
  it("freezes the full Session/Branch/Snapshot revision chain", () => {
    expect(
      createContentOwner({
        branchId: "branch-1",
        contextRevision: 3,
        sessionId: "session-1",
        subtitleId: "subtitle-2",
      }),
    ).toEqual({
      branchId: "branch-1",
      contextRevision: 3,
      sessionId: "session-1",
      subtitleId: "subtitle-2",
    });
  });

  it("rejects a zero content revision because every owner names an active snapshot", () => {
    expect(() =>
      createContentOwner({
        branchId: "branch-1",
        contextRevision: 0,
        sessionId: "session-1",
        subtitleId: "subtitle-2",
      }),
    ).toThrow(DomainValidationError);
  });
});
