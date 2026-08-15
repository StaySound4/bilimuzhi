#!/usr/bin/env node
/**
 * QA build：与生产 build 相同，但设置 VITE_QA_HARNESS=1，
 * 使 vite.config.ts 额外构建 qa-harness 入口（仅测试/视觉验收使用）。
 *
 * 生产 `npm run build` 不设置该变量 → dist/extension 无 qa-harness 产物。
 */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, ["scripts/clean-extension-build.mjs"], {});
run("npx", ["vite", "build"], { VITE_QA_HARNESS: "1" });
run("npx", ["vite", "build", "--config", "vite.content.config.ts"], {});
