import { describe, expect, it } from "vitest";

import * as subtitleExportModule from "../../src/application/subtitle-export";
import { createSubtitleExport } from "../../src/application/subtitle-export";

interface SessionArchiveEntry {
  readonly content: Blob | string;
  readonly path: string;
}

interface SessionArchiveAttachment {
  readonly attachmentId: string;
  readonly blob: Blob;
  readonly messageId: string | null;
  readonly mimeType: string;
  readonly name: string;
  readonly sessionId: string;
}

type CreateSessionArchiveEntries = (input: {
  readonly attachments: readonly SessionArchiveAttachment[];
  readonly includeAttachments: boolean;
  readonly sessionId: string;
  readonly textEntries: readonly SessionArchiveEntry[];
}) => readonly SessionArchiveEntry[];

const textEntries = [
  { content: "txt", path: "字幕/../危险标题.txt" },
  { content: "srt", path: "字幕/危险标题.srt" },
  { content: "markdown", path: "字幕/危险标题.md" },
] as const;

const attachments: readonly SessionArchiveAttachment[] = [
  {
    attachmentId: "current-bound",
    blob: new Blob([Uint8Array.of(0, 255, 17, 33)], { type: "image/webp" }),
    messageId: "message-current",
    mimeType: "image/webp",
    name: "../board.webp",
    sessionId: "session-current",
  },
  {
    attachmentId: "current-draft",
    blob: new Blob(["draft"], { type: "image/png" }),
    messageId: null,
    mimeType: "image/png",
    name: "draft.png",
    sessionId: "session-current",
  },
  {
    attachmentId: "other-bound",
    blob: new Blob(["other"], { type: "image/png" }),
    messageId: "message-other",
    mimeType: "image/png",
    name: "other.png",
    sessionId: "session-other",
  },
  {
    attachmentId: "unsafe-bound",
    blob: new Blob(["svg-script"], { type: "image/svg+xml" }),
    messageId: "message-unsafe",
    mimeType: "image/svg+xml",
    name: "unsafe.svg",
    sessionId: "session-current",
  },
];

describe("v11 session export attachment range", () => {
  it("excludes images by default and includes only current-session bound safe images when opted in", async () => {
    const createSessionArchiveEntries = Reflect.get(
      subtitleExportModule,
      "createSessionArchiveEntries",
    ) as CreateSessionArchiveEntries | undefined;
    expect(createSessionArchiveEntries).toBeTypeOf("function");

    const excluded = createSessionArchiveEntries!({
      attachments,
      includeAttachments: false,
      sessionId: "session-current",
      textEntries,
    });
    expect(excluded).toHaveLength(3);
    expect(excluded.every((entry) => typeof entry.content === "string")).toBe(
      true,
    );

    const included = createSessionArchiveEntries!({
      attachments,
      includeAttachments: true,
      sessionId: "session-current",
      textEntries,
    });
    const binaryEntries = included.filter(
      (entry): entry is SessionArchiveEntry & { readonly content: Blob } =>
        entry.content instanceof Blob,
    );
    expect(binaryEntries).toHaveLength(1);
    expect(await binaryEntries[0]!.content.arrayBuffer()).toEqual(
      Uint8Array.of(0, 255, 17, 33).buffer,
    );
    expect(included.map((entry) => entry.path).join("\n")).not.toMatch(
      /(?:\.\.|[\\/:])/u,
    );
    expect(included.map((entry) => entry.path).join("\n")).not.toMatch(
      /draft|other|unsafe/iu,
    );
  });

  it("keeps standalone TXT, SRT and Markdown artifacts text-only", () => {
    for (const format of ["txt", "srt", "markdown"] as const) {
      const artifact = createSubtitleExport({
        format,
        rows: [{ endMs: 1_000, startMs: 0, text: "字幕" }],
        title: "标题",
      });
      expect(artifact.content).toBeTypeOf("string");
      expect(artifact.content).not.toMatch(/attachment|image\//iu);
    }
  });
});
