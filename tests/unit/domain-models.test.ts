import { describe, expect, it } from "vitest";

import {
  DomainValidationError,
  createSession,
  createSubtitleSnapshot,
  createVideoKey,
  createVideoRef,
  isVideoKey,
  isVideoRef,
  parseVideoKey,
  type Session,
  type SubtitleSnapshot,
  type VideoRef,
} from "../../src/domain";

const bvid = "BV1qTNP6QE4n";
const videoKey = `bvid:${bvid}:cid:30000000000:p:1` as const;

describe("VideoKey and VideoRef", () => {
  it("identifies each BVID, CID and page combination exactly", () => {
    expect(createVideoKey({ bvid, cid: 30_000_000_000, page: 1 })).toBe(
      videoKey,
    );
    expect(createVideoKey({ bvid, cid: 30_000_000_001, page: 1 })).not.toBe(
      videoKey,
    );
    expect(createVideoKey({ bvid, cid: 30_000_000_000, page: 2 })).not.toBe(
      videoKey,
    );
    expect(parseVideoKey(videoKey)).toEqual({
      bvid,
      cid: 30_000_000_000,
      page: 1,
    });
    expect(isVideoKey(videoKey)).toBe(true);
  });

  it.each([
    { bvid: "av123", cid: 1, page: 1 },
    { bvid: "BV1qTNP6QE4", cid: 1, page: 1 },
    { bvid, cid: 0, page: 1 },
    { bvid, cid: 1, page: 0 },
    { bvid, cid: Number.MAX_SAFE_INTEGER + 1, page: 1 },
  ])("rejects an invalid exact identity", (identity) => {
    expect(() => createVideoKey(identity)).toThrow(DomainValidationError);
  });

  it("creates a frozen video reference with a derived key", () => {
    const video: VideoRef = createVideoRef({
      bvid,
      cid: 30_000_000_000,
      aid: 123,
      page: 1,
      title: "  完整视频  ",
      canonicalUrl: `https://www.bilibili.com/video/${bvid}/`,
      coverUrl: "https://i0.hdslb.com/example.jpg",
      durationSec: 1_135.341,
    });

    expect(video).toEqual({
      videoKey,
      bvid,
      cid: 30_000_000_000,
      aid: 123,
      page: 1,
      title: "完整视频",
      canonicalUrl: `https://www.bilibili.com/video/${bvid}/`,
      coverUrl: "https://i0.hdslb.com/example.jpg",
      durationSec: 1_135.341,
    });
    expect(Object.isFrozen(video)).toBe(true);
    expect(isVideoRef(video)).toBe(true);
  });

  it.each([
    { canonicalUrl: "https://example.com/video/BV1qTNP6QE4n/" },
    { canonicalUrl: `http://www.bilibili.com/video/${bvid}/` },
    { canonicalUrl: `https://www.bilibili.com/video/BV1qTNP6QE4x/` },
    { durationSec: 0 },
    { title: " " },
  ])("rejects invalid video reference fields", (override) => {
    expect(() =>
      createVideoRef({
        bvid,
        cid: 30_000_000_000,
        page: 1,
        title: "完整视频",
        canonicalUrl: `https://www.bilibili.com/video/${bvid}/`,
        durationSec: 1_135.341,
        ...override,
      }),
    ).toThrow(DomainValidationError);
  });

  it("rejects a plain video reference whose key conflicts with its identity", () => {
    expect(
      isVideoRef({
        videoKey: `bvid:${bvid}:cid:30000000000:p:2`,
        bvid,
        cid: 30_000_000_000,
        page: 1,
        title: "完整视频",
        canonicalUrl: `https://www.bilibili.com/video/${bvid}/`,
      }),
    ).toBe(false);
  });

  it("requires the canonical URL part to match the exact page", () => {
    expect(() =>
      createVideoRef({
        bvid,
        cid: 30_000_000_001,
        page: 2,
        title: "第二分 P",
        canonicalUrl: `https://www.bilibili.com/video/${bvid}/`,
      }),
    ).toThrow(DomainValidationError);

    expect(
      createVideoRef({
        bvid,
        cid: 30_000_000_001,
        page: 2,
        title: "第二分 P",
        canonicalUrl: `https://www.bilibili.com/video/${bvid}/?p=2`,
      }).videoKey,
    ).toBe(`bvid:${bvid}:cid:30000000001:p:2`);
  });
});

describe("Session", () => {
  const sessionInput = {
    sessionId: "session-1",
    videoKey,
    title: "完整视频",
    customTitle: false,
    activeBranchId: null,
    selectionRevision: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    lastActivityAt: 1_000,
  } satisfies Session;

  it("creates a frozen session with monotonic timestamps", () => {
    const session = createSession(sessionInput);

    expect(session).toEqual(sessionInput);
    expect(Object.isFrozen(session)).toBe(true);
  });

  it("does not retain undeclared caller fields", () => {
    const session = createSession({
      ...sessionInput,
      rawResponse: { owner: { mid: 1 } },
    } as Session);

    expect(session).not.toHaveProperty("rawResponse");
  });

  it.each([
    { sessionId: "" },
    { title: " " },
    { activeBranchId: "" },
    { selectionRevision: -1 },
    { updatedAt: 999 },
    { lastActivityAt: 999 },
    { createdAt: Number.NaN },
  ])("rejects an invalid session invariant", (override) => {
    expect(() => createSession({ ...sessionInput, ...override })).toThrow(
      DomainValidationError,
    );
  });
});

describe("SubtitleSnapshot", () => {
  const snapshotInput = {
    branchId: "branch-1",
    subtitleId: "subtitle-1",
    sessionId: "session-1",
    videoKey,
    source: "bilibili",
    language: "zh-CN",
    contentHash: "sha256:content-a",
    rows: [
      { startMs: 0, endMs: 1_000, text: "  第一行  " },
      { startMs: 900, endMs: 2_000, text: "第二行" },
    ],
    status: "active",
    createdAt: 2_000,
  } as const;

  it("creates an immutable snapshot with normalized rows", () => {
    const snapshot = createSubtitleSnapshot(snapshotInput);

    expect(snapshot.rows).toEqual([
      { startMs: 0, endMs: 1_000, text: "第一行" },
      { startMs: 900, endMs: 2_000, text: "第二行" },
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.rows)).toBe(true);
    expect(snapshot.rows.every(Object.isFrozen)).toBe(true);
  });

  it("allows reacquisition to use a new ID with the same content hash", () => {
    const first = createSubtitleSnapshot(snapshotInput);
    const second = createSubtitleSnapshot({
      ...snapshotInput,
      subtitleId: "subtitle-2",
      createdAt: 3_000,
    });

    expect(first.subtitleId).not.toBe(second.subtitleId);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it.each([
    { rows: [] },
    { rows: [{ startMs: -1, endMs: 1_000, text: "字幕" }] },
    { rows: [{ startMs: 1_000, endMs: 1_000, text: "字幕" }] },
    { rows: [{ startMs: 0, endMs: 1_000, text: " " }] },
    {
      rows: [
        { startMs: 1_000, endMs: 2_000, text: "第二行" },
        { startMs: 0, endMs: 1_000, text: "第一行" },
      ],
    },
    { source: "unknown" },
    { status: "deleted" },
    { language: "" },
    { contentHash: "" },
  ])("rejects an invalid subtitle invariant", (override) => {
    expect(() =>
      createSubtitleSnapshot({
        ...snapshotInput,
        ...override,
      } as Parameters<typeof createSubtitleSnapshot>[0]),
    ).toThrow(DomainValidationError);
  });

  it("does not freeze or retain the caller's mutable row array", () => {
    const inputRows = [{ startMs: 0, endMs: 1_000, text: "第一行" }];
    const snapshot: SubtitleSnapshot = createSubtitleSnapshot({
      ...snapshotInput,
      rows: inputRows,
    });

    inputRows.push({ startMs: 1_000, endMs: 2_000, text: "后来添加" });
    expect(Object.isFrozen(inputRows)).toBe(false);
    expect(snapshot.rows).toHaveLength(1);
  });
});
