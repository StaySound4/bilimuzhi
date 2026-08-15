import type { SubtitleRow } from "../domain";

export async function hashSubtitleRows(
  rows: readonly SubtitleRow[],
): Promise<string> {
  const canonical = JSON.stringify(
    rows.map((row) => [row.startMs, row.endMs, row.text]),
  );
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical),
    ),
  );
  const hexadecimal = [...digest]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hexadecimal}`;
}
