import { describe, expect, it } from "vitest";

import {
  deriveValidatedMarkdownTimeLinks,
  type MarkdownSubtitleRow,
  type ValidatedMarkdownTimeLink,
} from "../../src/ui/markdown";

interface IdentifiedSubtitleRow extends MarkdownSubtitleRow {
  readonly lineId: string;
}

interface TimeLinkValidationScope {
  readonly activeVideoKey: string;
  readonly subtitleVideoKey: string;
}

type V11TimeLinkDeriver = (
  text: string,
  rows: readonly IdentifiedSubtitleRow[],
  scope: TimeLinkValidationScope,
) => readonly ValidatedMarkdownTimeLink[];

const deriveV11 =
  deriveValidatedMarkdownTimeLinks as unknown as V11TimeLinkDeriver;

const VIDEO_PAGE_1 = "bvid:BV1xx411c7mD:cid:101:p:1";
const VIDEO_PAGE_2 = "bvid:BV1xx411c7mD:cid:102:p:2";
const rows = Object.freeze([
  Object.freeze({
    endMs: 7_000,
    lineId: "line-a",
    startMs: 5_000,
    text: "真实字幕行",
  }),
]);

describe("v11 validated Markdown time links", () => {
  it("maps only a normalized closed marker or real line reference in the active subtitle range", () => {
    expect(
      deriveV11("时间 [00:05]；字幕 [line-a]", rows, {
        activeVideoKey: VIDEO_PAGE_1,
        subtitleVideoKey: VIDEO_PAGE_1,
      }),
    ).toEqual([
      { label: "00:05", seconds: 5 },
      { label: "line-a", seconds: 5 },
    ]);
  });

  it("degrades identity mismatch, page mismatch, out-of-range, incomplete, and ordinary URLs to inert text", () => {
    const text = [
      "[00:05]",
      "[line-a]",
      "[00:09]",
      "[00:",
      "[外链](https://www.bilibili.com/video/BV1xx411c7mD?p=1&t=5)",
    ].join(" ");

    expect(
      deriveV11(text, rows, {
        activeVideoKey: VIDEO_PAGE_2,
        subtitleVideoKey: VIDEO_PAGE_1,
      }),
    ).toEqual([]);
  });

  it("does not derive current-video, other-video, or other-page Bilibili time URLs as subtitle-backed seek references", () => {
    expect(
      deriveV11(
        [
          "[00:05](https://www.bilibili.com/video/BV1xx411c7mD?p=1&t=5)",
          "[00:05](https://www.bilibili.com/video/BV1xx411c7mD?p=2&t=5)",
          "[00:05](https://www.bilibili.com/video/BV17x411w7KC?p=1&t=5)",
        ].join(" "),
        rows,
        {
          activeVideoKey: VIDEO_PAGE_1,
          subtitleVideoKey: VIDEO_PAGE_1,
        },
      ),
    ).toEqual([]);
  });
});
