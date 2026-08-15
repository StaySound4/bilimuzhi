import type { SubtitleRow } from "../domain";

export type SubtitleExportFormat = "markdown" | "srt" | "txt";

export interface CreateSubtitleExportInput {
  readonly format: SubtitleExportFormat;
  readonly includeTimestamps?: boolean;
  readonly rows: readonly SubtitleRow[];
  readonly title: string;
}

export interface SubtitleExportArtifact {
  readonly content: string;
  readonly filename: string;
  readonly mimeType: string;
}

export interface SessionArchiveEntry {
  readonly content: Blob | string;
  readonly path: string;
}

export interface SessionArchiveAttachment {
  readonly attachmentId: string;
  readonly blob: Blob;
  readonly messageId: string | null;
  readonly mimeType: string;
  readonly name: string;
  readonly sessionId: string;
}

const MAX_FILENAME_UTF16_LENGTH = 180;

function safeArchivePath(value: string, fallback: string): string {
  const normalized = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return "_";
      return '\\/:*?"<>|'.includes(character) ? "_" : character;
    })
    .join("")
    .replace(/\.{2,}/gu, "_")
    .replace(/^\.+/u, "_")
    .trim()
    .slice(0, 120)
    .replace(/[.\s]+$/u, "");
  return /^[_.\s]*$/u.test(normalized) ? fallback : normalized;
}

export function createSessionArchiveEntries(input: {
  readonly attachments?: readonly SessionArchiveAttachment[];
  readonly includeAttachments?: boolean;
  readonly sessionId: string;
  readonly textEntries: readonly SessionArchiveEntry[];
}): readonly SessionArchiveEntry[] {
  const entries: SessionArchiveEntry[] = input.textEntries.map((entry, index) =>
    Object.freeze({
      content: entry.content,
      path: safeArchivePath(entry.path, `subtitle-${index + 1}.txt`),
    }),
  );
  if (!input.includeAttachments) return Object.freeze(entries);
  for (const attachment of input.attachments ?? []) {
    if (
      attachment.sessionId !== input.sessionId ||
      attachment.messageId === null ||
      !(attachment.blob instanceof Blob) ||
      (attachment.mimeType !== "image/png" &&
        attachment.mimeType !== "image/jpeg" &&
        attachment.mimeType !== "image/webp") ||
      attachment.blob.type !== attachment.mimeType ||
      attachment.blob.size <= 0 ||
      attachment.blob.size > 5 * 1_024 * 1_024
    ) {
      continue;
    }
    const extension =
      attachment.mimeType === "image/png"
        ? "png"
        : attachment.mimeType === "image/jpeg"
          ? "jpg"
          : "webp";
    entries.push(
      Object.freeze({
        content: attachment.blob,
        path: safeArchivePath(
          attachment.name,
          `attachment-${attachment.attachmentId}.${extension}`,
        ),
      }),
    );
  }
  return Object.freeze(entries);
}

function formatTimestamp(milliseconds: number, separator: "," | "."): string {
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const remainder = milliseconds % 1_000;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(remainder).padStart(3, "0")}`;
}

function createSrt(
  rows: readonly SubtitleRow[],
  includeTimestamps: boolean,
): string {
  return rows
    .map((row, index) => {
      const lines = [String(index + 1)];
      if (includeTimestamps) {
        lines.push(
          `${formatTimestamp(row.startMs, ",")} --> ${formatTimestamp(row.endMs, ",")}`,
        );
      }
      lines.push(row.text);
      lines.push("");
      return lines.join("\n");
    })
    .join("\n");
}

function createTxt(
  rows: readonly SubtitleRow[],
  includeTimestamps: boolean,
): string {
  return rows
    .map((row) => {
      const parts: string[] = [];
      if (includeTimestamps) {
        parts.push(`[${formatTimestamp(row.startMs, ".")}]`);
      }
      parts.push(normalizeInlineText(row.text));
      return parts.join(" ");
    })
    .join("\n");
}

function normalizeInlineText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function escapeMarkdownHtml(value: string): string {
  return normalizeInlineText(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function createMarkdown(
  rows: readonly SubtitleRow[],
  title: string,
  includeTimestamps: boolean,
): string {
  const lines = [`# ${escapeMarkdownHtml(title)}`, ""];
  if (!includeTimestamps) return lines[0]!;
  const headers = [...(includeTimestamps ? ["时间"] : []), "字幕"];
  lines.push(
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
  );
  for (const row of rows) {
    const text = escapeMarkdownHtml(row.text)
      .replaceAll("\\", "\\\\")
      .replaceAll("|", "\\|");
    const cells = [
      ...(includeTimestamps ? [formatTimestamp(row.startMs, ".")] : []),
      text,
    ];
    lines.push(`| ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function truncateUtf16(value: string, maximumLength: number): string {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maximumLength) {
      break;
    }
    result += character;
  }
  return result;
}

function createFilename(title: string, extension: string): string {
  let stem = Array.from(title.normalize("NFC").trim(), (character) =>
    character.charCodeAt(0) < 32 ? "_" : character,
  )
    .join("")
    .replace(/[<>:"/\\|?*]/gu, "_")
    .replace(/[. ]+$/gu, "");
  if (stem.length === 0) {
    stem = "字幕";
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(stem)) {
    stem = `_${stem}`;
  }
  stem = truncateUtf16(
    stem,
    MAX_FILENAME_UTF16_LENGTH - extension.length - 1,
  ).replace(/[. ]+$/gu, "");
  return `${stem}.${extension}`;
}

export function createSubtitleExport({
  format,
  includeTimestamps = true,
  rows,
  title,
}: CreateSubtitleExportInput): SubtitleExportArtifact {
  if (format === "markdown") {
    return Object.freeze({
      content: createMarkdown(rows, title, includeTimestamps),
      filename: createFilename(title, "md"),
      mimeType: "text/markdown;charset=utf-8",
    });
  }

  if (format === "txt") {
    return Object.freeze({
      content: createTxt(rows, includeTimestamps),
      filename: createFilename(title, "txt"),
      mimeType: "text/plain;charset=utf-8",
    });
  }

  return Object.freeze({
    content: createSrt(rows, includeTimestamps),
    filename: createFilename(title, "srt"),
    mimeType: "application/x-subrip;charset=utf-8",
  });
}
