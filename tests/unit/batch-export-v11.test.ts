import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { createSubtitleExport } from "../../src/application/subtitle-export";

let exportBatchComposition = "";

beforeAll(async () => {
  const sidepanelSource = await readFile(
    new URL(
      "../../src/entries/sidepanel.tsx",
      import.meta.url,
    ) as unknown as string,
    "utf8",
  );
  exportBatchComposition = sidepanelSource.slice(
    sidepanelSource.indexOf("const exportBatch ="),
    sidepanelSource.indexOf("const unsubscribeArtifacts ="),
  );
});

describe("batch export v11 contract", () => {
  it("collects an explicit frozen item-id scope without temporarily mutating BatchJob selection", () => {
    expect(exportBatchComposition).not.toContain("batchClient.setSelection");
    expect(exportBatchComposition).toMatch(
      /batchClient\.collectExport\(\s*current\.job\.batchJobId,\s*batchItemIds\s*\)/u,
    );
  });

  it("honors the onsite no-timestamps choice in generated TXT content", () => {
    const artifact = createSubtitleExport({
      format: "txt",
      includeTimestamps: false,
      rows: [{ endMs: 2_000, startMs: 1_000, text: "只保留字幕正文" }],
      title: "批量现场导出",
    } as Parameters<typeof createSubtitleExport>[0] & {
      readonly includeTimestamps: boolean;
    });

    expect(artifact.content).toBe("只保留字幕正文");
    expect(artifact.content).not.toContain("00:00:01");
  });
});
