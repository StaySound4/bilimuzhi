import { describe, expect, it } from "vitest";

import {
  createZipArchive,
  safeZipPath,
} from "../../src/infrastructure/zip-writer";
import * as zipWriterModule from "../../src/infrastructure/zip-writer";

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function strictCrc32(value: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xed_b8_83_20 : crc >>> 1;
    }
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

describe("safeZipPath", () => {
  it.each([
    { expected: "a_b.srt", value: "a/b.srt" },
    { expected: "a_b.srt", value: "a\\b.srt" },
    { expected: "__etc_passwd", value: "../etc/passwd" },
    { expected: "C__x.txt", value: "C:/x.txt" },
    { expected: "a_b_c.txt", value: "a<b>c.txt" },
  ])("normalizes $value", ({ expected, value }) => {
    expect(safeZipPath(value, "fallback.txt")).toBe(expected);
  });

  it("falls back when nothing usable remains", () => {
    expect(safeZipPath("   ", "fallback.txt")).toBe("fallback.txt");
    expect(safeZipPath("...", "fallback.txt")).toBe("fallback.txt");
  });

  it("removes control characters that would corrupt extraction", () => {
    expect(safeZipPath("a\u0000b\u001fc.txt", "fallback.txt")).toBe(
      "a_b_c.txt",
    );
  });
});

describe("createZipArchive", () => {
  it("awaits Blob bytes and writes strict local and central CRC/size metadata", async () => {
    type AsyncZipFactory = (
      entries: readonly {
        readonly content: Blob | string;
        readonly path: string;
      }[],
    ) => Promise<Blob>;
    const createZipArchiveAsync = Reflect.get(
      zipWriterModule,
      "createZipArchiveAsync",
    ) as AsyncZipFactory | undefined;
    expect(createZipArchiveAsync).toBeTypeOf("function");

    const source = Uint8Array.of(0, 255, 17, 33, 128);
    const archive = await createZipArchiveAsync!([
      {
        content: new Blob([source], { type: "image/webp" }),
        path: "image.webp",
      },
    ]);
    const data = await bytes(archive);
    const view = new DataView(data.buffer);
    const expectedCrc = strictCrc32(source);

    expect(readUint32(view, 0)).toBe(0x04_03_4b_50);
    expect(readUint32(view, 14)).toBe(expectedCrc);
    expect(readUint32(view, 18)).toBe(source.byteLength);
    expect(readUint32(view, 22)).toBe(source.byteLength);
    const localNameLength = readUint16(view, 26);
    const localExtraLength = readUint16(view, 28);
    const contentOffset = 30 + localNameLength + localExtraLength;
    expect(data.slice(contentOffset, contentOffset + source.length)).toEqual(
      source,
    );

    const centralOffset = contentOffset + source.byteLength;
    expect(readUint32(view, centralOffset)).toBe(0x02_01_4b_50);
    expect(readUint32(view, centralOffset + 16)).toBe(expectedCrc);
    expect(readUint32(view, centralOffset + 20)).toBe(source.byteLength);
    expect(readUint32(view, centralOffset + 24)).toBe(source.byteLength);
    expect(readUint32(view, centralOffset + 42)).toBe(0);

    const endOffset = data.length - 22;
    expect(readUint32(view, endOffset)).toBe(0x06_05_4b_50);
    expect(readUint32(view, endOffset + 16)).toBe(centralOffset);
  });

  it("preserves processed image blobs as binary ZIP entries", async () => {
    const binaryZipWriter = createZipArchive as unknown as (
      entries: readonly {
        readonly content: Blob | string;
        readonly path: string;
      }[],
    ) => Blob;
    const source = Uint8Array.of(0, 255, 17, 33, 128);
    const data = await bytes(
      binaryZipWriter([
        {
          content: new Blob([source], { type: "image/webp" }),
          path: "image.webp",
        },
      ]),
    );
    const view = new DataView(data.buffer);
    const nameLength = readUint16(view, 26);
    const extraLength = readUint16(view, 28);
    const contentOffset = 30 + nameLength + extraLength;
    expect(data.slice(contentOffset, contentOffset + source.length)).toEqual(
      source,
    );
  });

  it("writes a readable stored archive with UTF-8 names", async () => {
    const blob = createZipArchive([
      { content: "第一段字幕", path: "第一集.srt" },
      { content: "second", path: "second.srt" },
    ]);
    const data = await bytes(blob);
    const view = new DataView(data.buffer);

    expect(blob.type).toBe("application/zip");
    // Local file header signature.
    expect(view.getUint32(0, true)).toBe(0x04_03_4b_50);
    // Bit 11 (UTF-8 names) must be set on the first local header.
    expect(readUint16(view, 6) & 0x08_00).toBe(0x08_00);
    // End of central directory signature and entry count.
    const endOffset = data.length - 22;
    expect(view.getUint32(endOffset, true)).toBe(0x06_05_4b_50);
    expect(readUint16(view, endOffset + 8)).toBe(2);
    expect(readUint16(view, endOffset + 10)).toBe(2);
  });

  it("keeps duplicate names unique instead of overwriting an entry", async () => {
    const blob = createZipArchive([
      { content: "one", path: "same.srt" },
      { content: "two", path: "same.srt" },
    ]);
    const text = new TextDecoder().decode(await bytes(blob));

    expect(text).toContain("same.srt");
    expect(text).toContain("same-2.srt");
  });

  it("produces a valid empty archive", async () => {
    const data = await bytes(createZipArchive([]));
    expect(data.length).toBe(22);
    expect(new DataView(data.buffer).getUint32(0, true)).toBe(0x06_05_4b_50);
  });
});
