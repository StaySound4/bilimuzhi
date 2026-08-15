import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

let speechPanelSource = "";
let timelineSource = "";

beforeAll(async () => {
  [speechPanelSource, timelineSource] = await Promise.all([
    readFile(
      new URL(
        "../../src/ui/asr/speech-acquisition-panel.tsx",
        import.meta.url,
      ) as unknown as string,
      "utf8",
    ),
    readFile(
      new URL(
        "../../src/ui/subtitle-timeline.tsx",
        import.meta.url,
      ) as unknown as string,
      "utf8",
    ),
  ]);
});

describe("v12 speech byte progress contract (A3/A4)", () => {
  it("presents preparation and encoding as processed MB plus percent, never as opaque chunk units", () => {
    expect(speechPanelSource).toContain("formatMegabytes");
    expect(speechPanelSource).toContain("boundedPercent");
    expect(speechPanelSource).toMatch(
      /t\(lang, "speech\.encodingPartial", \{ completed \}\)/u,
    );

    const activityMessage = speechPanelSource.slice(
      speechPanelSource.indexOf("function activityMessage"),
      speechPanelSource.indexOf("function phaseMessage"),
    );
    expect(activityMessage).not.toMatch(
      /completedUnits\}\s*\/\s*\$\{Math\.max\([^)]*totalUnits/u,
    );
  });

  it("renders unknown totals as an indeterminate byte progress rather than inventing a denominator", () => {
    expect(speechPanelSource).toMatch(
      /totalBytes\s*===\s*null[\s\S]{0,160}value:\s*undefined/u,
    );
    expect(speechPanelSource).toMatch(
      /t\(lang, "speech\.encodingPartial", \{ completed \}\)/u,
    );
    expect(speechPanelSource).toMatch(
      /function formatMegabytes[\s\S]{0,160}\.toFixed\(1\)\} MB/u,
    );
  });
});

describe("v12 one line-owned timeline contract (A4)", () => {
  it("requires the active player owner to match the displayed subtitle owner before seek or locate can run", () => {
    expect(timelineSource).toContain("subtitleOwner");
    expect(timelineSource).toContain("playerOwner");
    expect(timelineSource).toMatch(
      /subtitleOwner[\s\S]{0,240}(?:videoKey|bvid)[\s\S]{0,240}playerOwner/u,
    );
    expect(timelineSource).toMatch(
      /ownerMatches[\s\S]{0,320}(?:onSeek|onLocateCurrent)/u,
    );
  });

  it("does not fork the seek implementation by direct-versus-speech source", () => {
    expect(timelineSource).toContain("onSeek(row.startMs / 1_000)");
    expect(timelineSource).not.toMatch(
      /(?:source|method)\s*===\s*["'](?:direct|speech)["'][\s\S]{0,160}onSeek/u,
    );
  });
});
