export interface ZipEntry {
  readonly content: Blob | string;
  readonly path: string;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? (value >>> 1) ^ 0xed_b8_83_20 : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/**
 * Keeps a ZIP path safe: no drive letters, absolute roots, parent traversal,
 * backslashes or characters that break extraction on Windows.
 */
export function safeZipPath(value: string, fallback: string): string {
  const normalized = [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      if (code < 0x20 || code === 0x7f) return "_";
      return '\\/:*?"<>|'.includes(character) ? "_" : character;
    })
    .join("")
    .replace(/^\.+/, "_")
    .trim();
  const bounded = normalized.slice(0, 120).replace(/[.\s]+$/, "");
  // A name made only of separators carries no user meaning and would collide
  // across entries, so it falls back to the caller's stable name.
  return /^[_.\s]*$/.test(bounded) ? fallback : bounded;
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xff_ff, true);
}

/**
 * Builds a stored (uncompressed) ZIP archive. Subtitle exports are small text
 * files, so avoiding a compression dependency keeps the extension payload and
 * its licence matrix minimal.
 */
function buildZipArchive(
  entries: readonly ZipEntry[],
  resolvedBlobs?: ReadonlyMap<Blob, Uint8Array<ArrayBuffer>>,
): Blob {
  const encoder = new TextEncoder();
  const localParts: BlobPart[] = [];
  const centralParts: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const seen = new Set<string>();

  for (const [index, entry] of entries.entries()) {
    let path = safeZipPath(entry.path, `subtitle-${index + 1}.txt`);
    let suffix = 1;
    while (seen.has(path.toLowerCase())) {
      suffix += 1;
      const dot = path.lastIndexOf(".");
      path =
        dot > 0
          ? `${path.slice(0, dot)}-${suffix}${path.slice(dot)}`
          : `${path}-${suffix}`;
    }
    seen.add(path.toLowerCase());

    const nameBytes = encoder.encode(path);
    const content =
      typeof entry.content === "string"
        ? encoder.encode(entry.content)
        : (resolvedBlobs?.get(entry.content) ?? entry.content);
    const contentLength =
      content instanceof Blob ? content.size : content.length;
    // Blob byte access is asynchronous in browser contexts. Keeping the Blob
    // as a BlobPart preserves its exact processed bytes synchronously; CRC is
    // available for text entries and left zero for opaque binary entries.
    const checksum = content instanceof Blob ? 0 : crc32(content);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04_03_4b_50);
    writeUint16(localView, 4, 20);
    // Bit 11 marks UTF-8 file names so CJK titles extract correctly.
    writeUint16(localView, 6, 0x08_00);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0x00_21);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, contentLength);
    writeUint32(localView, 22, contentLength);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, content);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02_01_4b_50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0x08_00);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0x00_21);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, contentLength);
    writeUint32(centralView, 24, contentLength);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, offset);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + contentLength;
  }

  const centralSize = centralParts.reduce(
    (total, part) => total + part.length,
    0,
  );
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06_05_4b_50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, offset);
  writeUint16(endView, 20, 0);

  return new Blob([...localParts, ...centralParts, end], {
    type: "application/zip",
  });
}

/**
 * Compatibility path for existing synchronous text-only callers. Blob parts
 * are preserved byte-for-byte, but callers that require strict binary CRC
 * metadata must use `createZipArchiveAsync`.
 */
export function createZipArchive(entries: readonly ZipEntry[]): Blob {
  return buildZipArchive(entries);
}

/**
 * Builds a strict stored ZIP after reading every distinct Blob exactly once.
 * Both local and central headers receive the real CRC-32 and byte sizes.
 */
export async function createZipArchiveAsync(
  entries: readonly ZipEntry[],
): Promise<Blob> {
  const reads = new Map<Blob, Promise<Uint8Array<ArrayBuffer>>>();
  for (const entry of entries) {
    if (entry.content instanceof Blob && !reads.has(entry.content)) {
      reads.set(
        entry.content,
        entry.content
          .arrayBuffer()
          .then((buffer) => new Uint8Array(buffer as ArrayBuffer)),
      );
    }
  }
  const resolved = new Map<Blob, Uint8Array<ArrayBuffer>>();
  for (const [blob, read] of reads) resolved.set(blob, await read);
  return buildZipArchive(entries, resolved);
}
