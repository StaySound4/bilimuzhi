#!/usr/bin/env node
/**
 * 生产 build 无 QA harness 隔离验证（Ticket 03）。
 *
 * 运行：node scripts/check-qa-harness-isolation.mjs [--expect <absent|present>]
 *
 * - 生产 `npm run build` 后运行（默认 expect absent）：dist/extension 不得出现
 *   qa-harness.html 或任何 qa-harness bundle 产物；
 * - `npm run build:qa` 后运行 `--expect present`：必须出现 qa-harness.html。
 *
 * 退出码：0 符合预期；1 不符合。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist", "extension");

const expectArg = process.argv.find((arg) => arg.startsWith("--expect="));
const expect = expectArg?.split("=")[1] ?? "absent";
if (expect !== "absent" && expect !== "present") {
  console.error(`--expect 必须为 absent|present，实际 ${expect}`);
  process.exit(2);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      out.push(...walk(p));
    } else {
      out.push(p);
    }
  }
  return out;
}

const hits = [];
if (existsSync(DIST)) {
  for (const file of walk(DIST)) {
    const relative = file.slice(DIST.length + 1).replaceAll("\\", "/");
    if (
      relative === "qa-harness.html" ||
      relative.includes("/qa-harness-") ||
      relative.endsWith("/qa-harness.html")
    ) {
      hits.push(relative);
    }
  }
  // bundle 内容级兜底：任何 js 中出现 qa-harness 标识也视为泄漏
  if (hits.length === 0) {
    for (const file of walk(DIST)) {
      if (!file.endsWith(".js")) continue;
      const content = readFileSync(file, "utf8");
      if (
        content.includes("qa-harness.html") ||
        content.includes("__MUZHI_QA__")
      ) {
        hits.push(`bundle 内容泄漏: ${file.slice(DIST.length + 1)}`);
      }
    }
  }
}

if (expect === "absent" && hits.length > 0) {
  console.error(`生产 build 泄漏 QA harness 产物：\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
if (expect === "present" && hits.length === 0) {
  console.error("QA build 缺少 qa-harness 产物");
  process.exit(1);
}
console.log(
  expect === "absent"
    ? "✓ 生产 build 无 QA harness 产物（qa-harness.html / bundle 内容均未泄漏）"
    : `✓ QA build 含 ${hits.length} 个 qa-harness 产物`,
);
