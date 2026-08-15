#!/usr/bin/env node
/**
 * 视觉证据完整性门 — 公共入口。
 *
 * 冻结命令：
 *   npm run check:visual-evidence -- --profile fixture
 *   npm run check:visual-evidence -- --profile ticket --ticket <NN>
 *   npm run check:visual-evidence -- --profile final
 *   npm run check:visual-evidence                                # 无参数默认 final
 *   npm run check:visual-evidence -- --audit-dir <dir>           # 审计旧目录（只读，不修改）
 *
 * 规则来源：Ticket 01 与 spec §D13。任何规则失败 exit 1；报告只输出路径、hash、
 * 元数据与错误原因，不输出敏感数据。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePngSize, sha256Hex } from "./visual-evidence/png.mjs";
import {
  findMissingRequired,
  resolveProfile,
  validateDuplicateHashes,
  validateEnums,
  validateExceptions,
  validateFileField,
  validateFilenameContract,
  validateHash,
  validateManifestShape,
  validatePageIdentity,
  validatePngSize,
  validateScenarioCounts,
  validateTheme,
} from "./visual-evidence/rules.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..");

const DEFAULT_EVIDENCE_DIR = join(
  ROOT,
  "docs",
  "design-audit-screenshots",
  "muzhi-ui-remediation",
);
const DEFAULT_MATRIX_PATH = join(
  ROOT,
  "scripts",
  "visual-evidence",
  "matrix.json",
);
const DEFAULT_FIXTURE_DIR = join(ROOT, "tests", "fixtures", "visual-evidence");

/** 解析命令行参数（不依赖外部库）。 */
export function parseArgs(argv) {
  const args = {
    profile: undefined,
    ticket: undefined,
    evidenceDir: DEFAULT_EVIDENCE_DIR,
    matrixPath: DEFAULT_MATRIX_PATH,
    fixtureDir: DEFAULT_FIXTURE_DIR,
    auditDirs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`缺少参数值：${arg}`);
      return argv[++i];
    };
    switch (arg) {
      case "--profile":
        args.profile = next();
        break;
      case "--ticket":
        args.ticket = next();
        break;
      case "--evidence-dir":
        args.evidenceDir = resolve(ROOT, next());
        break;
      case "--matrix":
        args.matrixPath = resolve(ROOT, next());
        break;
      case "--fixture-dir":
        args.fixtureDir = resolve(ROOT, next());
        break;
      case "--audit-dir":
        args.auditDirs.push(resolve(ROOT, next()));
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

/** 加载 matrix JSON 并做最小结构校验。 */
export function loadMatrix(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (
    raw.schemaVersion !== 1 ||
    typeof raw.surfaces !== "object" ||
    typeof raw.profiles !== "object"
  ) {
    throw new Error(`matrix.json 结构不合法：${path}`);
  }
  return raw;
}

/**
 * 扫描证据目录并校验。
 * 返回 { entries, errors, warnings }；entries 元素含 file/sha256/surface/state/theme/viewport/viewportWidth。
 */
/** 构建全局 required 组合集合（所有 profile 登记的 surface|state|theme|width）。 */
export function buildGlobalRequiredSet(matrix) {
  const set = new Set();
  for (const profile of Object.values(matrix.profiles ?? {})) {
    for (const req of profile.required ?? []) {
      for (const theme of req.themes) {
        for (const width of req.widths) {
          set.add(`${req.surface}|${req.state}|${theme}|${width}`);
        }
      }
    }
  }
  return set;
}

export function scanEvidenceDir(dir, matrix, { requiredSet } = {}) {
  const entries = [];
  const errors = [];
  const warnings = [];
  const globalRequired = requiredSet ?? buildGlobalRequiredSet(matrix);
  if (!existsSync(dir)) {
    return { entries, errors: [`证据目录不存在：${dir}`], warnings };
  }
  const files = readdirSync(dir);
  const pngFiles = files.filter((f) => f.toLowerCase().endsWith(".png"));
  const manifestFiles = files.filter((f) =>
    f.toLowerCase().endsWith(".png.json"),
  );

  for (const png of pngFiles) {
    const pngPath = join(dir, png);
    const manifestPath = join(dir, `${png}.json`);
    if (!existsSync(manifestPath)) {
      errors.push(`PNG 缺少 manifest：${png}`);
      continue;
    }
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch (err) {
      errors.push(`manifest 不是合法 JSON：${png}.json（${err.message}）`);
      continue;
    }
    let shapeErrors = validateManifestShape(manifest, matrix);
    if (shapeErrors.length > 0) {
      errors.push(...shapeErrors.map((e) => `${png}: ${e}`));
      continue;
    }
    let pngBuf;
    try {
      pngBuf = readFileSync(pngPath);
    } catch (err) {
      errors.push(`无法读取 PNG：${png}（${err.message}）`);
      continue;
    }
    let pngSize;
    try {
      pngSize = parsePngSize(pngBuf);
    } catch (err) {
      errors.push(`PNG 头解析失败：${png}（${err.message}）`);
      continue;
    }
    const actualSha256 = sha256Hex(pngBuf);
    const fileErrors = validateFileField(manifest.file, png);
    const hashErrors = validateHash(manifest.sha256, actualSha256);
    const sizeErrors = validatePngSize(
      manifest.viewport,
      manifest.deviceScaleFactor,
      pngSize,
    );
    const enumErrors = validateEnums(manifest, matrix);
    const themeErrors = validateTheme(manifest, matrix);
    const countErrors = validateScenarioCounts(
      manifest,
      matrix.minimumCounts ?? {},
      matrix.emptyStates ?? ["empty"],
    );
    const pageErrors = validatePageIdentity(manifest, matrix);
    const nameErrors = validateFilenameContract(png, manifest, matrix);
    const entryErrors = [
      ...fileErrors,
      ...hashErrors,
      ...sizeErrors,
      ...enumErrors,
      ...themeErrors,
      ...countErrors,
      ...pageErrors,
      ...nameErrors,
    ];
    if (entryErrors.length > 0) {
      errors.push(...entryErrors.map((e) => `${png}: ${e}`));
      continue;
    }
    const [vw] = manifest.viewport.split("x").map(Number);
    entries.push({
      file: png,
      sha256: actualSha256,
      surface: manifest.surface,
      state: manifest.state,
      theme: manifest.theme,
      viewport: manifest.viewport,
      viewportWidth: vw,
    });
  }

  // 孤儿 manifest（无对应 PNG）
  for (const mf of manifestFiles) {
    const pngName = mf.slice(0, -".json".length);
    if (!pngFiles.includes(pngName)) {
      errors.push(`manifest 指向缺失的 PNG：${mf}`);
    }
  }

  // exceptions.json（人工重复 hash 豁免，required state 禁止豁免）
  const exceptionsPath = join(
    dir,
    matrix.exceptions?.file ?? "exceptions.json",
  );
  let exceptions = [];
  if (existsSync(exceptionsPath)) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(exceptionsPath, "utf8"));
    } catch (err) {
      errors.push(`exceptions.json 不是合法 JSON（${err.message}）`);
    }
    if (raw !== undefined) {
      exceptions = validateExceptions(raw, {
        maxAgeDays: matrix.exceptions?.maxAgeDays ?? 90,
      });
      for (const ex of exceptions) {
        if (ex.invalidReason) {
          errors.push(
            `exceptions.json 条目无效（hash=${ex.hash}）：${ex.invalidReason}`,
          );
        }
      }
    }
  }

  // 重复 hash（Light/Dark、跨 surface、跨 required state 复用即阻断）
  const dup = validateDuplicateHashes(entries, exceptions, {
    requiredSet: globalRequired,
  });
  errors.push(...dup.errors);
  warnings.push(...dup.warnings);

  return { entries, errors, warnings };
}

/** 审计旧目录：只读扫描 PNG，报告重复 hash 组（不要求 manifest，不修改文件）。 */
export function auditDir(dir) {
  const report = { dir, pngCount: 0, duplicateGroups: [] };
  if (!existsSync(dir)) {
    return { ...report, error: `审计目录不存在：${dir}` };
  }
  const walk = (d) => {
    const out = [];
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        out.push(...walk(p));
      } else if (name.toLowerCase().endsWith(".png")) {
        out.push(p);
      }
    }
    return out;
  };
  const pngs = walk(dir);
  report.pngCount = pngs.length;
  const byHash = new Map();
  for (const p of pngs) {
    const h = sha256Hex(readFileSync(p));
    if (!byHash.has(h)) byHash.set(h, []);
    byHash.get(h).push(p);
  }
  for (const [hash, files] of byHash) {
    if (files.length > 1) {
      report.duplicateGroups.push({ hash, files });
    }
  }
  return report;
}

/** fixture profile：每个子目录作为独立证据目录校验；valid-* 必须通过，invalid-* 必须失败。 */
export function runFixtureProfile(fixtureDir, matrix) {
  const results = [];
  const errors = [];
  if (!existsSync(fixtureDir)) {
    return {
      ok: false,
      errors: [`fixture 目录不存在：${fixtureDir}`],
      results,
    };
  }
  const subdirs = readdirSync(fixtureDir)
    .filter((n) => statSync(join(fixtureDir, n)).isDirectory())
    .sort();
  if (subdirs.length === 0) {
    return { ok: false, errors: ["fixture 目录为空"], results };
  }
  let ok = true;
  for (const sub of subdirs) {
    const expected = sub.startsWith("valid")
      ? "pass"
      : sub.startsWith("invalid")
        ? "fail"
        : "unexpected";
    const {
      entries,
      errors: scanErrors,
      warnings,
    } = scanEvidenceDir(join(fixtureDir, sub), matrix);
    const passed = scanErrors.length === 0;
    const expectedOk = expected === "pass";
    if (expected === "unexpected") {
      errors.push(`fixture 子目录必须以 valid- 或 invalid- 开头：${sub}`);
      ok = false;
    } else if (passed !== expectedOk) {
      errors.push(
        `fixture 子目录 ${sub} 期望 ${expectedOk ? "通过" : "失败"}，实际 ${passed ? "通过" : "失败"}`,
      );
      ok = false;
    }
    results.push({
      subdir: sub,
      expected,
      passed,
      errors: scanErrors,
      warnings,
      entryCount: entries.length,
    });
  }
  return { ok, errors, results };
}

/** 人类可读报告。 */
export function formatReport({
  profile,
  ticket,
  evidenceDir,
  scan,
  missing,
  fixture,
}) {
  const lines = [];
  lines.push(`profile: ${profile}${ticket ? ` (ticket ${ticket})` : ""}`);
  lines.push(`evidence dir: ${evidenceDir}`);
  if (scan) {
    lines.push(
      `PNG+manifest 配对：${scan.entries.length}，完整性错误：${scan.errors.length}，警告：${scan.warnings.length}`,
    );
    for (const w of scan.warnings) lines.push(`  [warn] ${w}`);
    for (const e of scan.errors) lines.push(`  [error] ${e}`);
  }
  if (missing && missing.length > 0) {
    lines.push(`required-state 缺失：${missing.length}`);
    for (const m of missing) lines.push(`  [missing] ${m}`);
  }
  if (fixture) {
    for (const r of fixture.results) {
      const tag = r.passed ? "PASS" : "FAIL";
      lines.push(`  fixture ${r.subdir}: ${tag} (expected ${r.expected})`);
      for (const e of r.errors) lines.push(`    [error] ${e}`);
    }
  }
  return lines.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`参数错误：${err.message}`);
    process.exit(2);
  }
  let matrix;
  try {
    matrix = loadMatrix(args.matrixPath);
  } catch (err) {
    console.error(`无法加载 matrix：${err.message}`);
    process.exit(2);
  }
  const resolved = resolveProfile({
    profile: args.profile,
    ticket: args.ticket,
  });
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exit(2);
  }

  // 审计模式：只读扫描旧目录（不要求 manifest、不修改文件），报告重复 hash 组。
  const auditReports = [];
  for (const dir of args.auditDirs) {
    const report = auditDir(dir);
    auditReports.push(report);
    if (report.error) {
      console.error(`[audit] ${dir}: ${report.error}`);
      continue;
    }
    console.log(
      `[audit] ${dir}: ${report.pngCount} 张 PNG，重复组 ${report.duplicateGroups.length}`,
    );
    for (const g of report.duplicateGroups) {
      console.log(`  [audit][dup] ${g.hash}`);
      for (const f of g.files) console.log(`    ${f}`);
    }
    if (report.duplicateGroups.length > 0) {
      console.log(
        `  [audit] 结论：该目录存在重复 hash，视觉签收不可信（只读审计，未修改任何文件）`,
      );
    }
  }
  // 仅审计（未指定 profile）时，审计报告即本次命令的产物
  if (
    args.profile === undefined &&
    args.ticket === undefined &&
    args.auditDirs.length > 0
  ) {
    const hasDup = auditReports.some((r) => r.duplicateGroups.length > 0);
    process.exit(hasDup ? 1 : 0);
  }
  let exitCode = 0;
  if (resolved.profile === "fixture") {
    const fixture = runFixtureProfile(args.fixtureDir, matrix);
    console.log(
      formatReport({
        profile: resolved.profile,
        evidenceDir: args.fixtureDir,
        fixture,
      }),
    );
    exitCode = fixture.ok ? 0 : 1;
  } else {
    const scan = scanEvidenceDir(args.evidenceDir, matrix);
    let missing = [];
    if (resolved.profile === "final") {
      missing = findMissingRequired(
        matrix.profiles["13"].required,
        scan.entries,
      );
    } else if (resolved.profile === "ticket") {
      const profileEntry = matrix.profiles[resolved.ticket];
      if (!profileEntry) {
        console.error(`matrix 中未登记 ticket ${resolved.ticket}`);
        process.exit(2);
      }
      missing = findMissingRequired(profileEntry.required, scan.entries);
    }
    console.log(
      formatReport({
        profile: resolved.profile,
        ticket: resolved.ticket,
        evidenceDir: args.evidenceDir,
        scan,
        missing,
      }),
    );
    if (scan.errors.length > 0 || missing.length > 0) {
      exitCode = 1;
    }
    if (scan.entries.length === 0) {
      console.error("[error] 零证据：证据目录没有任何合法 PNG+manifest");
      exitCode = 1;
    }
  }
  process.exit(exitCode);
}

// 供测试直接调用 main 时跳过
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  main();
}
