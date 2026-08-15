/** PNG 工具模块声明（对应 scripts/visual-evidence/png.mjs）。 */

export function sha256Hex(buffer: Uint8Array): string;
export function isPng(buffer: Uint8Array): boolean;
export function parsePngSize(buffer: Uint8Array): {
  width: number;
  height: number;
};
export function createPngBuffer(
  width: number,
  height: number,
  rgb?: readonly [number, number, number],
): Uint8Array;
export function parseCssColor(value: string): [number, number, number] | null;
export function relativeLuminance(
  rgb: readonly [number, number, number],
): number;
