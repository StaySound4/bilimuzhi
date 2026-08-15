import { describe, expect, it } from "vitest";

import {
  createBatchItem,
  createBatchJob,
  nextBatchListName,
  readBatchItemFromStored,
} from "../../src/domain";

describe("Batch list expand domain", () => {
  it("supports a named empty list and computes the smallest available default name", () => {
    const job = createBatchJob({
      batchJobId: "job-empty",
      browserSessionId: "browser-1",
      createdAt: 1,
      method: "direct",
      name: "新建列表3",
      sourceKind: "empty-list",
      sourceLabel: "新建列表3",
      status: "ready",
      updatedAt: 1,
    });

    expect(job.name).toBe("新建列表3");
    expect(nextBatchListName(["新建列表1", "新建列表3"])).toBe("新建列表2");
  });

  it("normalizes legacy selection and maps the speech request language independently", () => {
    const item = readBatchItemFromStored(
      createBatchItem({
        batchItemId: "item-1",
        batchJobId: "job-1",
        bvid: "BV1b7411N798",
        errorCode: null,
        order: 0,
        page: 1,
        rowCount: 0,
        selected: true,
        selectedLanguage: "en-US",
        status: "pending",
        title: "video",
        trackId: null,
        updatedAt: 1,
        videoKey: null,
      }),
    );

    expect(item.selected).toBe(false);
    expect(item.speechLanguageMode).toBe("en");
    // 迁移后旧 selectedLanguage 退役：不再承担直接字幕轨道语言偏好（spec §8）。
    expect(item.selectedLanguage).toBeNull();
  });

  it("keeps an explicitly persisted speechLanguageMode and retires selectedLanguage", () => {
    const item = readBatchItemFromStored(
      createBatchItem({
        batchItemId: "item-1",
        batchJobId: "job-1",
        bvid: "BV1b7411N798",
        errorCode: null,
        order: 0,
        page: 1,
        rowCount: 0,
        selected: true,
        selectedLanguage: "zh-CN",
        speechLanguageMode: "other",
        status: "pending",
        title: "video",
        trackId: null,
        updatedAt: 1,
        videoKey: null,
      }),
    );
    expect(item.speechLanguageMode).toBe("other");
    expect(item.selectedLanguage).toBeNull();
  });
  it("accepts a genuinely source-free empty list", () => {
    const job = createBatchJob({
      batchJobId: "job-empty-source",
      browserSessionId: "browser-1",
      createdAt: 1,
      name: "新建列表1",
      status: "ready",
      updatedAt: 1,
    });
    expect(job).toMatchObject({ name: "新建列表1" });
    expect(job).not.toHaveProperty("sourceKind");
    expect(job).not.toHaveProperty("sourceLabel");
  });

  it("rejects invalid speech language modes and accepts an injected default", () => {
    const base = {
      batchItemId: "item-language",
      batchJobId: "job-1",
      bvid: "BV1b7411N798",
      errorCode: null,
      order: 0,
      page: 1,
      rowCount: 0,
      selected: false,
      status: "pending" as const,
      title: "video",
      trackId: null,
      updatedAt: 1,
      videoKey: null,
    };
    expect(() =>
      createBatchItem({ ...base, speechLanguageMode: "bad" as never }),
    ).toThrow();
    expect(createBatchItem(base, "zh").speechLanguageMode).toBe("zh");
  });
});
