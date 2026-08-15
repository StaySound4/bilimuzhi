/** 视觉证据完整性门规则模块声明（对应 scripts/visual-evidence/rules.mjs）。 */

export const REQUIRED_MANIFEST_FIELDS: readonly string[];
export const REQUIRED_COMPUTED_STYLE_KEYS: readonly string[];

export interface ResolveProfileResult {
  readonly ok: boolean;
  readonly profile: "fixture" | "ticket" | "final" | null;
  readonly ticket: string | null;
  readonly error: string | null;
}

export function resolveProfile(input: {
  readonly profile?: string;
  readonly ticket?: string;
}): ResolveProfileResult;

export interface ParsedFilename {
  readonly surface: string;
  readonly state: string;
  readonly theme: string;
  readonly width: number;
  readonly commit: string;
}

export function parseFilename(
  filename: string,
  surfaces: Record<string, unknown>,
): ParsedFilename | null;

export interface EvidenceMatrix {
  readonly schemaVersion: number;
  readonly document: string;
  readonly exceptions?: {
    readonly maxAgeDays?: number;
    readonly file?: string;
  };
  readonly surfaces: Record<
    string,
    {
      readonly activeTabs: readonly string[];
      readonly pages: readonly string[];
    }
  >;
  readonly themes: readonly string[];
  readonly emptyStates: readonly string[];
  readonly states: readonly string[];
  readonly minimumCounts?: Record<string, Record<string, number>>;
  readonly profiles: Record<
    string,
    { readonly required: readonly RequiredState[] }
  >;
}

export interface RequiredState {
  readonly surface: string;
  readonly state: string;
  readonly themes: readonly string[];
  readonly widths: readonly number[];
}

export function validateManifestShape(manifest: unknown): string[];
export function validateFileField(
  file: string,
  actualPngName: string,
): string[];
export function validateHash(
  manifestSha256: string,
  actualSha256: string,
): string[];
export function validatePngSize(
  viewport: string,
  deviceScaleFactor: number,
  pngSize: { readonly width: number; readonly height: number },
): string[];
export function validateEnums(
  manifest: Record<string, unknown>,
  matrix: EvidenceMatrix,
): string[];
export function validateTheme(manifest: Record<string, unknown>): string[];
export function validateScenarioCounts(
  manifest: Record<string, unknown>,
  minimumCounts: Record<string, Record<string, number>>,
): string[];
export function validatePageIdentity(
  manifest: Record<string, unknown>,
  matrix: EvidenceMatrix,
): string[];
export function validateFilenameContract(
  filename: string,
  manifest: Record<string, unknown>,
  matrix: EvidenceMatrix,
): string[];

export interface EvidenceEntry {
  readonly file: string;
  readonly sha256: string;
  readonly surface: string;
  readonly state: string;
  readonly theme: string;
  readonly viewport: string;
  readonly viewportWidth: number;
}

export interface ExceptionEntry {
  readonly hash: string;
  readonly files: readonly string[];
  readonly reason: string;
  readonly reviewer: string;
  readonly date: string;
  readonly invalidReason: string | null;
}

export function validateDuplicateHashes(
  entries: readonly EvidenceEntry[],
  exceptions: readonly ExceptionEntry[],
  options?: { readonly requiredSet?: ReadonlySet<string> },
): { readonly errors: readonly string[]; readonly warnings: readonly string[] };

export function validateExceptions(
  raw: unknown,
  options: { readonly maxAgeDays: number },
): ExceptionEntry[];

export function findMissingRequired(
  required: readonly RequiredState[],
  entries: readonly EvidenceEntry[],
): string[];
