import { describe, expect, it } from "vitest";

import {
  deriveValidatedTimeMarkers,
  type TimeMarkerSubtitleRow,
} from "../../src/application/time-marker";

const videoKey = "bvid:BV1Q541167Qg:cid:30000000001:p:2";
const scope = {
  activeVideoKey: videoKey,
  subtitleVideoKey: videoKey,
};
const rows = Object.freeze<readonly TimeMarkerSubtitleRow[]>([
  Object.freeze({ endMs: 8_000, startMs: 0 }),
  Object.freeze({ endMs: 18_000, startMs: 12_000 }),
  Object.freeze({ endMs: 28_000, startMs: 22_000 }),
]);

describe("生成内容时间标记放置策略", () => {
  it("只允许命中真实字幕行的段落时间点和范围端点", () => {
    expect(
      deriveValidatedTimeMarkers(
        "空隙点 10s\n空隙范围 8s–20s\n有效范围 12s–27s",
        rows,
        scope,
      ),
    ).toEqual([
      { endSeconds: 27, kind: "range", label: "12s–27s", seconds: 12 },
    ]);
  });

  it("拒绝当前字幕整体时间轴之外的时间", () => {
    expect(
      deriveValidatedTimeMarkers("有效 7s\n越界 28s", rows, scope),
    ).toEqual([{ endSeconds: 7, kind: "point", label: "7s", seconds: 7 }]);
  });
});
