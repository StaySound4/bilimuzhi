import { describe, expect, it } from "vitest";

import { createSubtitleExport } from "../../src/application/subtitle-export";

describe("createSubtitleExport", () => {
  it("creates a download-ready SRT artifact", () => {
    expect(
      createSubtitleExport({
        format: "srt",
        rows: [
          { endMs: 3_500, startMs: 1_234, text: "第一句" },
          { endMs: 68_000, startMs: 65_000, text: "第二句" },
        ],
        title: "演示/视频",
      }),
    ).toEqual({
      content: [
        "1",
        "00:00:01,234 --> 00:00:03,500",
        "第一句",
        "",
        "2",
        "00:01:05,000 --> 00:01:08,000",
        "第二句",
        "",
      ].join("\n"),
      filename: "演示_视频.srt",
      mimeType: "application/x-subrip;charset=utf-8",
    });
  });

  it("creates a timestamped plain-text artifact", () => {
    expect(
      createSubtitleExport({
        format: "txt",
        rows: [
          { endMs: 1_000, startMs: 0, text: "开头" },
          { endMs: 3_724_000, startMs: 3_723_456, text: "结尾" },
        ],
        title: "演示",
      }),
    ).toEqual({
      content: "[00:00:00.000] 开头\n[01:02:03.456] 结尾",
      filename: "演示.txt",
      mimeType: "text/plain;charset=utf-8",
    });
  });

  it("keeps each plain-text subtitle on one timestamped line", () => {
    expect(
      createSubtitleExport({
        format: "txt",
        rows: [
          {
            endMs: 1_000,
            startMs: 0,
            text: "  第一行\n\t第二行  ",
          },
        ],
        title: "演示",
      }).content,
    ).toBe("[00:00:00.000] 第一行 第二行");
  });

  it("creates a Markdown table artifact with escaped cell text", () => {
    expect(
      createSubtitleExport({
        format: "markdown",
        rows: [{ endMs: 14_000, startMs: 12_000, text: "A | B \\ C" }],
        title: "演示标题",
      }),
    ).toEqual({
      content: [
        "# 演示标题",
        "",
        "| 时间 | 字幕 |",
        "| --- | --- |",
        "| 00:00:12.000 | A \\| B \\\\ C |",
      ].join("\n"),
      filename: "演示标题.md",
      mimeType: "text/markdown;charset=utf-8",
    });
  });

  it("keeps Markdown headings and table rows on a single line", () => {
    const artifact = createSubtitleExport({
      format: "markdown",
      rows: [
        {
          endMs: 2_000,
          startMs: 1_000,
          text: "  第一行\n\t第二行  ",
        },
      ],
      title: "  演示\n标题  ",
    });

    expect(artifact.content).toBe(
      [
        "# 演示 标题",
        "",
        "| 时间 | 字幕 |",
        "| --- | --- |",
        "| 00:00:01.000 | 第一行 第二行 |",
      ].join("\n"),
    );
  });

  it("exports untrusted Markdown title and subtitle text without raw HTML", () => {
    const artifact = createSubtitleExport({
      format: "markdown",
      rows: [
        {
          endMs: 2_000,
          startMs: 1_000,
          text: "<script>alert('字幕')</script> & text",
        },
      ],
      title: "<img src=x onerror=alert(1)>",
    });

    expect(artifact.content).toBe(
      [
        "# &lt;img src=x onerror=alert(1)&gt;",
        "",
        "| 时间 | 字幕 |",
        "| --- | --- |",
        "| 00:00:01.000 | &lt;script&gt;alert('字幕')&lt;/script&gt; &amp; text |",
      ].join("\n"),
    );
  });

  it("normalizes Unicode and replaces Windows-forbidden filename characters", () => {
    expect(
      createSubtitleExport({
        format: "txt",
        rows: [{ endMs: 1_000, startMs: 0, text: "字幕" }],
        title: "Cafe\u0301/片:段*?",
      }).filename,
    ).toBe("Café_片_段__.txt");
  });

  it("guards unusable Windows filename stems", () => {
    const filenameFor = (title: string) =>
      createSubtitleExport({
        format: "txt",
        rows: [{ endMs: 1_000, startMs: 0, text: "字幕" }],
        title,
      }).filename;

    expect([
      filenameFor("CON"),
      filenameFor("nul.report"),
      filenameFor("a\u0000b\u001fc"),
      filenameFor("trailing. "),
      filenameFor(" . "),
    ]).toEqual([
      "_CON.txt",
      "_nul.report.txt",
      "a_b_c.txt",
      "trailing.txt",
      "字幕.txt",
    ]);
  });

  it("limits the complete filename without splitting Unicode surrogate pairs", () => {
    const artifact = createSubtitleExport({
      format: "txt",
      rows: [{ endMs: 1_000, startMs: 0, text: "字幕" }],
      title: "😀".repeat(100),
    });

    expect(artifact.filename).toBe(`${"😀".repeat(88)}.txt`);
  });
});
