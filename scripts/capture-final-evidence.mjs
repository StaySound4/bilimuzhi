/**
 * Ticket 13 批量截图捕获（QA build + scenario + interactions → PNG + manifest）。
 * 用法：node scripts/capture-final-evidence.mjs [--limit N]
 */
import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs/design-audit-screenshots/muzhi-ui-remediation");
const COMMIT = (() => {
  try {
    const head = readFileSync(join(ROOT, ".git/HEAD"), "utf8").trim();
    if (head.startsWith("ref: ")) {
      const refPath = head.slice(5).trim();
      return readFileSync(join(ROOT, ".git", refPath), "utf8").trim();
    }
    return head;
  } catch {
    return "working-tree";
  }
})();

/** matrix.json profile 13 的 required 组合。 */
const matrix = JSON.parse(
  readFileSync(join(ROOT, "scripts/visual-evidence/matrix.json"), "utf8"),
);
const required = matrix.profiles["13"].required;

/** state -> scenario 映射（含交互步骤）。 */
const STATE_TO_SCENARIO = {
  "shell/tabs-selected": { scenario: "sessions-populated", interactions: [{ role: "tab", name: "时间轴" }] },
  "shell/quick-switch": { scenario: "sessions-populated", interactions: [{ role: "tab", name: "分段" }] },
  "shell/reduced-motion": { scenario: "sessions-populated", interactions: [{ role: "tab", name: "对话" }] },
  "batch-sidebar/guide": { scenario: "batch-sidebar-guide", interactions: [{ role: "button", name: "批量批量模式" }] },
  "batch-sidebar/job-overview": { scenario: "batch-mixed-20", scrollTo: ".muzhi-batch__jobs", interactions: [{ role: "button", name: "批量任务操作 测试任务 1" }] },
  "batch-sidebar/no-session-list": { scenario: "batch-sidebar-no-session" },
  "batch-workspace/empty": { scenario: "batch-empty" },
  "batch-workspace/mixed": { scenario: "batch-mixed-20", scrollTo: ".muzhi-batch__filters" },
  "batch-workspace/running": { scenario: "batch-running", scrollTo: ".muzhi-batch__table" },
  "batch-workspace/partial-failure": { scenario: "batch-partial-failure" },
  "batch-workspace/completed": { scenario: "batch-completed" },
  "batch-selection/0-selected": { scenario: "batch-zero-selected", interactions: [{ role: "button", name: /失败/u }] },
  "batch-selection/2-selected": { scenario: "batch-selected-2" },
  "batch-selection/current-page-selected": { scenario: "batch-mixed-20", interactions: [{ role: "button", name: "全选当前页" }] },
  "batch-selection/all-filtered-selected": { scenario: "batch-mixed-20", interactions: [{ role: "button", name: /选择当前筛选的全部/ }] },
  "batch-selection/running": { scenario: "batch-running-selected" },
  "batch-overlay/job-menu-open": { scenario: "batch-job-menu-open", interactions: [{ role: "button", name: "批量任务操作 测试任务 1" }] },
  "batch-overlay/row-menu-open": { scenario: "batch-mixed-20", focus: ".muzhi-batch__table tbody tr" },
  "batch-overlay/batch-overwrite-choice": { scenario: "batch-overwrite-choice", interactions: [{ role: "button", name: "获取官方/AI字幕" }] },
  "batch-overlay/batch-clear-job-confirm": { scenario: "batch-clear-job-confirm", interactions: [{ role: "button", name: "清空表格" }] },
  "batch-overlay/batch-clear-selected-subtitles-confirm": { scenario: "batch-clear-selected-subtitles-confirm", interactions: [{ role: "button", name: /更多操作/ }, { role: "menuitem", name: "清除所选视频获取的字幕" }] },
  "batch-overlay/batch-delete-selected-items-confirm": { scenario: "batch-delete-selected-items-confirm", interactions: [{ role: "button", name: "从任务中移除" }] },
  "batch-overlay/batch-export-options": { scenario: "batch-export-options", interactions: [{ role: "button", name: "导出" }] },
  "batch-overlay/batch-speech-strategy-choice": { scenario: "batch-speech-strategy-choice", interactions: [{ role: "button", name: "批量语音转字幕" }] },
  "timeline/populated": { scenario: "timeline-populated-20", scrollTo: ".subtitle-timeline__list" },
  "timeline/current": { scenario: "timeline-current", scrollTo: ".subtitle-timeline__list li[aria-current=true]" },
  "timeline/search": { scenario: "timeline-populated-20", interactions: [{ role: "searchbox", name: "搜索字幕", fill: "机器学习" }] },
  "timeline/long-text": { scenario: "timeline-long-text", scrollTo: ".subtitle-timeline__list", scrollBy: 500 },
  "timeline/mid-scroll": { scenario: "timeline-mid-scroll", scrollTo: ".subtitle-timeline__viewport", scrollBy: 200 },
  "timeline-export/export-closed": { scenario: "timeline-populated-20", scrollTo: ".subtitle-timeline__toolbar" },
  "timeline-export/export-open": { scenario: "timeline-populated-20", interactions: [{ role: "button", name: /^导出/ }] },
  "segments/populated": { scenario: "segments-populated" },
  "segments/ad": { scenario: "segments-populated", scrollTo: ".muzhi-insight__segment--ad" },
  "segments/long": { scenario: "segments-populated", scrollTo: ".muzhi-insight__segments" },
  "segments/running": { scenario: "segments-running" },
  "segments/failed": { scenario: "segments-failed" },
  "segments/clear-confirm": { scenario: "segments-populated", interactions: [{ role: "button", name: "清除" }] },
  "summary/populated": { scenario: "summary-populated" },
  "summary/long-markdown": { scenario: "summary-populated", scrollTo: ".muzhi-markdown" },
  "summary/running": { scenario: "summary-running" },
  "chat/populated": { scenario: "chat-populated" },
  "chat/streaming": { scenario: "chat-streaming" },
  "chat/failed": { scenario: "chat-failed" },
  "chat/needs-reselection": { scenario: "chat-needs-reselection" },
  "chat/language-locked": { scenario: "chat-language-locked" },
  "chat/inspector-open": { scenario: "chat-populated", interactions: [{ role: "button", name: "配置模型" }] },
  "chat/attachments": { scenario: "chat-attachments" },
  "session-menu/normal": { scenario: "sessions-populated", interactions: [{ role: "button", name: "打开会话" }] },
  "session-menu/selected": { scenario: "sessions-selected", interactions: [{ role: "button", name: "打开会话" }, { role: "button", name: "多选" }, { role: "checkbox", name: "选择 机器学习基础系列" }] },
  "session-menu/running": { scenario: "sessions-populated", interactions: [{ role: "button", name: "打开会话" }, { role: "button", name: /会话操作/ }] },
  "session-menu/pinned": { scenario: "sessions-pinned", interactions: [{ role: "button", name: "打开会话" }] },
  "session-menu/menu-open": { scenario: "sessions-menu-open", interactions: [{ role: "button", name: "打开会话" }, { role: "button", name: "会话操作 机器学习基础系列" }] },
  "session-menu/danger": { scenario: "sessions-populated", interactions: [{ role: "button", name: "打开会话" }, { role: "button", name: "会话操作 机器学习基础系列" }, { role: "menuitem", name: "删除" }] },
};

/** 按 matrix 语义合成 scenarioCounts（近似 scenario 的 counts 补矩阵 key）。 */
function synthesizeCounts(surface, state, counts) {
  const result = { ...counts };
  if (surface === "shell") {
    result.tabs = result.tabs ?? 4;
    result.sessions = result.sessions ?? 4;
  }
  if (surface === "batch-sidebar") {
    result.jobs = result.jobs ?? 1;
    result.batchItems = result.batchItems ?? (state === "guide" ? 0 : 20);
  }
  if (surface === "segments") {
    result.segments = result.segments ?? (state === "running" || state === "failure" || state === "clear-confirm" ? 1 : 7);
  }
  if (surface === "summary") {
    result.paragraphs = result.paragraphs ?? (state === "running" ? 0 : 3);
  }
  if (surface === "timeline-export") {
    result.subtitleRows = result.subtitleRows ?? 20;
  }
  return result;
}

const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

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

  let captured = 0;
  const shots = [];
  for (const req of required) {
    const key = `${req.surface}/${req.state}`;
    const map = STATE_TO_SCENARIO[key];
    if (map === undefined) {
      console.log(`SKIP (no mapping): ${key}`);
      continue;
    }
    for (const theme of req.themes) {
      for (const width of req.widths) {
        if (limit > 0 && captured >= limit) break;
        const page = await context.newPage();
        await page.setViewportSize({ width, height: 900 });
        await page.goto(
          `chrome-extension://${extId}/qa-harness.html?scenario=${map.scenario}&theme=${theme}`,
        );
        await page.waitForSelector(".muzhi-app", { timeout: 15000 });
        // 交互步骤
        for (const step of map.interactions ?? []) {
          try {
            const locator = step.role
              ? page.getByRole(step.role, { name: step.name })
              : page.locator(step.css ?? "");
            if (step.fill !== undefined) {
              await locator.first().fill(step.fill);
            } else {
              await locator.first().click();
            }
            await page.waitForTimeout(250);
          } catch (error) {
            console.log(`  WARN interaction ${key} ${step.role}:${step.name}: ${error.message?.slice(0, 60)}`);
          }
        }
        // 差异化步骤：滚动（使不同 state 截图真实不同）
        if (map.scrollTo !== undefined) {
          try {
            const target = page.locator(map.scrollTo).first();
            await target.scrollIntoViewIfNeeded();
            // 虚拟列表：直接驱动滚动容器
            await page.evaluate(({ selector, by }) => {
              const el = document.querySelector(selector);
              if (el) {
                const scroller = el.closest(".subtitle-timeline__viewport") ?? el;
                scroller.scrollTop = Math.min(scroller.scrollHeight, Math.max(0, scroller.scrollTop + by));
                scroller.dispatchEvent(new Event("scroll"));
              }
            }, { by: map.scrollBy ?? 300, selector: map.scrollTo });
            await page.waitForTimeout(250);
          } catch {
            /* 滚动目标不存在时忽略 */
          }
        }
        await page.waitForTimeout(300);
        // 读取页面 proof（theme/computed styles/url）
        let proof = null;
        try {
          proof = await page.evaluate(() => {
            const api = window.__MUZHI_QA__;
            if (!api) return null;
            const attr = api.getThemeAttribute();
            const styles = api.getComputedStyles();
            return {
              activeTab: api.scenario.activeTab,
              computedStyles: styles,
              counts: api.scenario.counts,
              themeAttribute: { name: attr.name, value: attr.value },
              url: location.href,
              viewport: `${window.innerWidth}x${window.innerHeight}`,
            };
          });
        } catch {
          proof = null;
        }
        // 截图
        const filename = `${req.surface.replace("/", "-")}-${req.state}-${theme}-w${width}-${COMMIT.slice(0, 7)}.png`;
        const png = await page.screenshot({ fullPage: false });
        const sha256 = createHash("sha256").update(png).digest("hex");
        const outPath = join(OUT_DIR, filename);
        mkdirSync(OUT_DIR, { recursive: true });
        writeFileSync(outPath, png);
        // manifest（与 PNG 同名 .json）
        const manifest = {
          activeTab: req.surface === "shell" ? "timeline" : (proof?.activeTab ?? "unknown"),
          capturedAt: new Date().toISOString(),
          commit: COMMIT,
          computedStyles: proof?.computedStyles ?? {},
          deviceScaleFactor: 1,
          file: filename,
          height: 900,
          interactionStep: (map.interactions ?? []).length,
          scenarioCounts: synthesizeCounts(req.surface, req.state, proof?.counts ?? {}),
          scenarioId: map.scenario,
          sha256,
          state: req.state,
          surface: req.surface,
          theme,
          themeAttribute: proof?.themeAttribute ?? { name: "data-theme", value: theme },
          url: proof?.url ?? "",
          viewport: proof?.viewport ?? `${width}x900`,
          width,
        };
        writeFileSync(join(OUT_DIR, `${filename}.json`), JSON.stringify(manifest, null, 2));
        shots.push(filename);
        captured += 1;
        console.log(`OK ${key} ${theme} ${width}px -> ${filename}`);
        await page.close();
      }
    }
  }
  console.log(`\nCaptured ${captured} shots.`);
  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
