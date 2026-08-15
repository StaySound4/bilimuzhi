/**
 * Ticket 13 P1-1：Fluid tab indicator 动效证据（位置日志）。
 * 生成 normal 连续移动 + reduced-motion 立即切换的位置采样 JSON。
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/design-audit-screenshots/muzhi-ui-remediation");

async function main() {
  const extDir = join(ROOT, "dist/extension").replaceAll("\\", "/");
  const context = await chromium.launchPersistentContext("", {
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    channel: "chromium",
    headless: true,
  });
  let [sw] = context.serviceWorkers();
  sw ??= await context.waitForEvent("serviceworker");
  const extId = new URL(sw.url()).host;
  const page = await context.newPage();
  await page.setViewportSize({ width: 1158, height: 900 });
  await page.goto(`chrome-extension://${extId}/qa-harness.html?scenario=sessions-populated`);
  await page.waitForSelector(".muzhi-app");
  const tabs = page.getByRole("tab");
  const tabCount = await tabs.count();
  // 采样函数：读取 indicator left（CSS transform）
  const sample = () => page.evaluate(() => {
    const ind = document.querySelector(".muzhi-shell__tab-indicator");
    if (!ind) return null;
    const rect = ind.getBoundingClientRect();
    return { left: Math.round(rect.left), width: Math.round(rect.width) };
  });

  // Normal：点击分段 tab，采样 10 帧（220ms 过渡内）
  const normalSamples = [];
  await tabs.nth(1).click();
  for (let i = 0; i < 10; i++) {
    normalSamples.push({ frame: i, at: i * 25, ...(await sample()) });
    await page.waitForTimeout(25);
  }
  // 等待动画完成再采最终位置
  await page.waitForTimeout(400);
  normalSamples.push({ frame: 10, at: 250, ...(await sample()) });

  // Reduced motion：模拟 prefers-reduced-motion
  const contextRM = await chromium.launchPersistentContext("", {
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
    channel: "chromium",
    headless: true,
    reducedMotion: "reduce",
  });
  let [swRM] = contextRM.serviceWorkers();
  swRM ??= await contextRM.waitForEvent("serviceworker");
  const extIdRM = new URL(swRM.url()).host;
  const pageRM = await contextRM.newPage();
  await pageRM.setViewportSize({ width: 1158, height: 900 });
  await pageRM.goto(`chrome-extension://${extIdRM}/qa-harness.html?scenario=sessions-populated`);
  await pageRM.waitForSelector(".muzhi-app");
  const tabsRM = pageRM.getByRole("tab");
  const rmSamples = [];
  await tabsRM.nth(2).click();
  for (let i = 0; i < 5; i++) {
    rmSamples.push({ frame: i, at: i * 25, ...(await pageRM.evaluate(() => {
      const ind = document.querySelector(".muzhi-shell__tab-indicator");
      if (!ind) return { left: null, width: null };
      const rect = ind.getBoundingClientRect();
      return { left: Math.round(rect.left), width: Math.round(rect.width) };
    })) });
    await pageRM.waitForTimeout(25);
  }

  const report = {
    capturedAt: new Date().toISOString(),
    commit: "working-tree",
    description: "Fluid tab indicator 动效证据：normal 连续移动采样 + reduced-motion 立即切换采样",
    normal: { samples: normalSamples, movedContinuously: normalSamples.some((s, i) => i > 0 && s.left !== normalSamples[0].left) },
    reducedMotion: { samples: rmSamples, immediate: rmSamples.every((s, i) => i === 0 || s.left === rmSamples[0].left) },
    tabCount,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const outPath = join(OUT_DIR, "shell-tabs-indicator-motion.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("written", outPath);
  console.log("normal first/last left:", normalSamples[0]?.left, "->", normalSamples.at(-1)?.left);
  console.log("reduced first/all left:", rmSamples[0]?.left, JSON.stringify(rmSamples.map((s) => s.left)));
  await context.close();
  await contextRM.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
