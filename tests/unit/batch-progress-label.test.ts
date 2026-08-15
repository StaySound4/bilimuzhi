import { describe, expect, it } from "vitest";

import { progressLabel } from "../../src/ui/batch/batch-labels";
import type { BatchItem } from "../../src/domain";

function speechItem(
  overrides: Partial<BatchItem> & {
    readonly progress: NonNullable<BatchItem["progress"]>;
  },
): BatchItem {
  return {
    acquisitionMethod: "speech",
    batchItemId: "item-1",
    batchJobId: "job-1",
    errorCode: null,
    retryable: false,
    selectedLanguage: null,
    selectedTrackId: null,
    speechLanguageMode: "zh",
    speechOwner: null,
    status: "running",
    title: "测试视频",
    videoKey: "bilibili:1",
    ...overrides,
  } as BatchItem;
}

describe("progressLabel (batch speech bytes)", () => {
  it("shows downloading/preparing stages in megabytes with percent", () => {
    const label = progressLabel(
      "zh-Hans",
      speechItem({
        progress: {
          completed: 12 * 1_048_576,
          stage: "preparing",
          total: 48 * 1_048_576,
          unit: "bytes",
        },
      }),
    );
    // "准备中 已处理 12.0 MB / 48.0 MB · 25%"
    expect(label).toMatch(/12\.0 MB/);
    expect(label).toMatch(/48\.0 MB/);
    expect(label).toMatch(/25%/);
  });

  it("shows count-unit preparing stages as x/y instead of megabytes", () => {
    const label = progressLabel(
      "zh-Hans",
      speechItem({
        progress: {
          completed: 2,
          stage: "preparing",
          total: 12,
          unit: "count",
        },
      }),
    );
    expect(label).toContain("2/12");
    expect(label).not.toContain("MB");
  });

  it("shows transcribing stages as chunk counts", () => {
    const label = progressLabel(
      "zh-Hans",
      speechItem({
        progress: {
          completed: 3,
          stage: "transcribing",
          total: 10,
          unit: "count",
        },
      }),
    );
    expect(label).toContain("3/10");
  });

  it("shows only the completed bytes when total is unknown", () => {
    const label = progressLabel(
      "zh-Hans",
      speechItem({
        progress: {
          completed: 6 * 1_048_576,
          stage: "preparing",
          total: 0,
          unit: "bytes",
        },
      }),
    );
    expect(label).toMatch(/6\.0 MB/);
    expect(label).not.toMatch(/\/ 0\.0 MB/);
  });
});
