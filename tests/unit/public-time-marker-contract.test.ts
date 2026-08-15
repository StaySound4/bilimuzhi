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
  Object.freeze({ endMs: 3_800_000, lineId: "line-a", startMs: 0 }),
]);

describe("公共时间标记契约", () => {
  it("解析时间点、范围和各自独立的相邻标记", () => {
    expect(
      deriveValidatedTimeMarkers(
        "[25s][3m48s] [72s] [1h2m3s] [5m38s–6m45s] [60s] [61s] [59s]",
        rows,
        scope,
      ),
    ).toEqual([
      { endSeconds: 25, kind: "point", label: "25s", seconds: 25 },
      { endSeconds: 228, kind: "point", label: "3m48s", seconds: 228 },
      {
        endSeconds: 3_723,
        kind: "point",
        label: "1h2m3s",
        seconds: 3_723,
      },
      {
        endSeconds: 405,
        kind: "range",
        label: "5m38s–6m45s",
        seconds: 338,
      },
      { endSeconds: 60, kind: "point", label: "60s", seconds: 60 },
      { endSeconds: 59, kind: "point", label: "59s", seconds: 59 },
    ]);
  });

  it("按字幕右开区间验证整秒桶，不把恰好结束于该秒的上一行误当成证据", () => {
    const boundaryRows = Object.freeze<readonly TimeMarkerSubtitleRow[]>([
      Object.freeze({ endMs: 3_000, startMs: 2_000 }),
      Object.freeze({ endMs: 4_200, startMs: 3_180 }),
    ]);

    expect(deriveValidatedTimeMarkers("2s 3s", boundaryRows, scope)).toEqual([
      { endSeconds: 2, kind: "point", label: "2s", seconds: 2 },
      { endSeconds: 3, kind: "point", label: "3s", seconds: 3 },
    ]);
    expect(
      deriveValidatedTimeMarkers(
        "3s",
        [Object.freeze({ endMs: 3_000, startMs: 2_000 })],
        scope,
      ),
    ).toEqual([]);
  });

  it("在流式尾部未闭合时只提交此前完整标记，不错误黏连", () => {
    expect(deriveValidatedTimeMarkers("先看 [25s][3m", rows, scope)).toEqual([
      { endSeconds: 25, kind: "point", label: "25s", seconds: 25 },
    ]);
  });

  it("将缺失 owner、无效、逆序、越界和跨视频标记保留为普通文字", () => {
    expect(deriveValidatedTimeMarkers("[25s]", rows)).toEqual([]);
    expect(
      deriveValidatedTimeMarkers(
        "[3m99s] [6m45s–5m38s] [1h3m21s] [3m48s",
        rows,
        scope,
      ),
    ).toEqual([]);
    expect(
      deriveValidatedTimeMarkers("[25s]", rows, {
        activeVideoKey: "bvid:BV1OTHER0000:cid:9:p:1",
        subtitleVideoKey: videoKey,
      }),
    ).toEqual([]);
  });
});
