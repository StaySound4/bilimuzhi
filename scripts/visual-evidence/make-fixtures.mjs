#!/usr/bin/env node
/**
 * 生成 Ticket 01 视觉证据检查器的测试夹具（tests/fixtures/visual-evidence/）。
 *
 * 用法：node scripts/visual-evidence/make-fixtures.mjs
 *
 * 夹具目录命名：valid-* 必须整体通过检查；invalid-* 必须整体失败。
 * 重新生成会覆盖夹具目录（它们是检查器的固定输入，需要保持确定性）。
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createPngBuffer, sha256Hex } from "./png.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, "..", "..");
const FIXTURE_ROOT = join(ROOT, "tests", "fixtures", "visual-evidence");

const COMMIT = "abc1234";
const EXT_ID = "abcdefghijklmnopqrstuvwxyzabcdef";
const CAPTURED_AT = "2026-08-11T10:00:00.000Z";

const LIGHT_STYLES = {
  canvas: "#f6f8fb",
  background: "#ffffff",
  text: "#172033",
  accent: "#1769e8",
};
const DARK_STYLES = {
  canvas: "#0f1722",
  background: "#151f2d",
  text: "#edf3ff",
  accent: "#1769e8",
};

/** 构造一个合法 manifest 基底。 */
function baseManifest({
  file,
  surface,
  state,
  theme,
  viewport = "520x900",
  styles,
  counts,
  scenarioId,
  activeTab = "timeline",
  url,
}) {
  return {
    file,
    sha256: "", // 由调用方填
    commit: COMMIT,
    surface,
    state,
    theme,
    viewport,
    deviceScaleFactor: 1,
    scenarioId,
    activeTab,
    interactionStep: 0,
    themeAttribute: { name: "data-theme", value: theme },
    computedStyles: styles,
    scenarioCounts: counts,
    url:
      url ??
      `chrome-extension://${EXT_ID}/sidepanel.html?scenario=${scenarioId}`,
    capturedAt: CAPTURED_AT,
  };
}

/** 写一张 PNG 及其 manifest（sha256 自动填充）。返回文件名。 */
function writeEvidence(
  dir,
  pngName,
  {
    rgb,
    surface,
    state,
    theme,
    styles,
    counts,
    scenarioId,
    viewport = "520x900",
    activeTab,
    url,
    sha256Override,
  },
) {
  const pngBuf = createPngBuffer(...viewport.split("x").map(Number), rgb);
  const pngPath = join(dir, pngName);
  writeFileSync(pngPath, pngBuf);
  const manifest = baseManifest({
    file: pngName,
    surface,
    state,
    theme,
    viewport,
    styles,
    counts,
    scenarioId,
    activeTab,
    url,
  });
  manifest.sha256 = sha256Override ?? sha256Hex(pngBuf);
  writeFileSync(
    join(dir, `${pngName}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return pngName;
}

function resetDir(name) {
  const dir = join(FIXTURE_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

function main() {
  if (!existsSync(FIXTURE_ROOT)) {
    mkdirSync(FIXTURE_ROOT, { recursive: true });
  }
  const created = [];

  // 1. valid-minimal：合法 light + dark 各一张（hash 不同、主题样式真实）
  {
    const dir = resetDir("valid-minimal");
    writeEvidence(dir, `shell-tabs-selected-light-w520-${COMMIT}.png`, {
      rgb: [0xf6, 0xf8, 0xfb],
      surface: "shell",
      state: "tabs-selected",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { tabs: 4 },
      scenarioId: "shell-tabs-selected",
      activeTab: "timeline",
    });
    writeEvidence(dir, `shell-tabs-selected-dark-w520-${COMMIT}.png`, {
      rgb: [0x0f, 0x17, 0x22],
      surface: "shell",
      state: "tabs-selected",
      theme: "dark",
      styles: DARK_STYLES,
      counts: { tabs: 4 },
      scenarioId: "shell-tabs-selected",
      activeTab: "timeline",
    });
    created.push(dir);
  }

  // 2. invalid-duplicate-hash：同一 PNG 字节复制为两张（Light=Dark 复用）
  {
    const dir = resetDir("invalid-duplicate-hash");
    const pngBuf = createPngBuffer(520, 900, [0x88, 0x88, 0x88]);
    const hash = sha256Hex(pngBuf);
    for (const theme of ["light", "dark"]) {
      const name = `batch-workspace-mixed-${theme}-w520-${COMMIT}.png`;
      writeFileSync(join(dir, name), pngBuf);
      const manifest = baseManifest({
        file: name,
        surface: "batch-workspace",
        state: "mixed",
        theme,
        styles: theme === "light" ? LIGHT_STYLES : DARK_STYLES,
        counts: { batchItems: 20 },
        scenarioId: "batch-mixed-20",
        activeTab: "batch",
      });
      manifest.sha256 = hash;
      writeFileSync(
        join(dir, `${name}.json`),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }
    created.push(dir);
  }

  // 3. invalid-hash-mismatch：manifest sha256 与真实不符
  {
    const dir = resetDir("invalid-hash-mismatch");
    writeEvidence(dir, `timeline-populated-light-w520-${COMMIT}.png`, {
      rgb: [0xf6, 0xf8, 0xfb],
      surface: "timeline",
      state: "populated",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { subtitleRows: 20 },
      scenarioId: "timeline-populated-20",
      activeTab: "timeline",
      sha256Override: "0".repeat(64),
    });
    created.push(dir);
  }

  // 4. invalid-size-mismatch：viewport 声明与 PNG 像素尺寸不符
  {
    const dir = resetDir("invalid-size-mismatch");
    // PNG 实际 320x200，viewport 声明 520x900
    const pngBuf = createPngBuffer(320, 200, [0xf6, 0xf8, 0xfb]);
    const name = `chat-populated-light-w520-${COMMIT}.png`;
    writeFileSync(join(dir, name), pngBuf);
    const manifest = baseManifest({
      file: name,
      surface: "chat",
      state: "populated",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { messages: 6 },
      scenarioId: "chat-populated",
      activeTab: "chat",
    });
    manifest.sha256 = sha256Hex(pngBuf);
    writeFileSync(
      join(dir, `${name}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    created.push(dir);
  }

  // 5. invalid-theme-fake：manifest 声明 dark，但 computedStyles 是 light 方向（伪造主题）
  {
    const dir = resetDir("invalid-theme-fake");
    writeEvidence(dir, `segments-populated-dark-w520-${COMMIT}.png`, {
      rgb: [0x0f, 0x17, 0x22],
      surface: "segments",
      state: "populated",
      theme: "dark",
      styles: LIGHT_STYLES, // 伪造：dark 声明却用 light 样式
      counts: { segments: 6 },
      scenarioId: "segments-populated",
      activeTab: "segments",
    });
    created.push(dir);
  }

  // 6. invalid-theme-attribute：themeAttribute 不含主题关键字
  {
    const dir = resetDir("invalid-theme-attribute");
    const pngBuf = createPngBuffer(520, 900, [0x0f, 0x17, 0x22]);
    const name = `summary-populated-light-w520-${COMMIT}.png`;
    writeFileSync(join(dir, name), pngBuf);
    const manifest = baseManifest({
      file: name,
      surface: "summary",
      state: "populated",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { paragraphs: 3 },
      scenarioId: "summary-populated",
      activeTab: "summary",
    });
    manifest.sha256 = sha256Hex(pngBuf);
    manifest.themeAttribute = { name: "data-theme", value: "dark" }; // 与 theme=light 冲突
    writeFileSync(
      join(dir, `${name}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    created.push(dir);
  }

  // 7. invalid-zero-counts：populated state 的 scenarioCounts 全 0
  {
    const dir = resetDir("invalid-zero-counts");
    writeEvidence(dir, `batch-workspace-mixed-light-w520-${COMMIT}.png`, {
      rgb: [0xf6, 0xf8, 0xfb],
      surface: "batch-workspace",
      state: "mixed",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { batchItems: 0, succeeded: 0, failed: 0 },
      scenarioId: "batch-mixed-20",
      activeTab: "batch",
    });
    created.push(dir);
  }

  // 8. invalid-missing-manifest：PNG 存在但无 manifest
  {
    const dir = resetDir("invalid-missing-manifest");
    writeFileSync(
      join(dir, `timeline-populated-light-w520-${COMMIT}.png`),
      createPngBuffer(520, 900, [0xf6, 0xf8, 0xfb]),
    );
    created.push(dir);
  }

  // 9. invalid-orphan-manifest：manifest 存在但 PNG 缺失
  {
    const dir = resetDir("invalid-orphan-manifest");
    const name = `timeline-populated-light-w520-${COMMIT}.png`;
    const manifest = baseManifest({
      file: name,
      surface: "timeline",
      state: "populated",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { subtitleRows: 20 },
      scenarioId: "timeline-populated-20",
      activeTab: "timeline",
    });
    manifest.sha256 = "a".repeat(64);
    writeFileSync(
      join(dir, `${name}.json`),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    created.push(dir);
  }

  // 10. invalid-unknown-surface
  {
    const dir = resetDir("invalid-unknown-surface");
    writeEvidence(dir, `unknown-surface-populated-light-w520-${COMMIT}.png`, {
      rgb: [0xf6, 0xf8, 0xfb],
      surface: "unknown-surface",
      state: "populated",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { items: 1 },
      scenarioId: "unknown",
      activeTab: "timeline",
    });
    created.push(dir);
  }

  // 11. invalid-unknown-state
  {
    const dir = resetDir("invalid-unknown-state");
    writeEvidence(dir, `timeline-mystery-light-w520-${COMMIT}.png`, {
      rgb: [0xf6, 0xf8, 0xfb],
      surface: "timeline",
      state: "mystery",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { subtitleRows: 20 },
      scenarioId: "timeline-mystery",
      activeTab: "timeline",
    });
    created.push(dir);
  }

  // 12. invalid-unknown-theme
  {
    const dir = resetDir("invalid-unknown-theme");
    writeEvidence(dir, `timeline-populated-sepia-w520-${COMMIT}.png`, {
      rgb: [0xf6, 0xf8, 0xfb],
      surface: "timeline",
      state: "populated",
      theme: "sepia",
      styles: LIGHT_STYLES,
      counts: { subtitleRows: 20 },
      scenarioId: "timeline-populated-20",
      activeTab: "timeline",
    });
    created.push(dir);
  }

  // 13. invalid-exception-expired：重复 hash + 过期 exception（非 required 组合）
  {
    const dir = resetDir("invalid-exception-expired");
    const pngBuf = createPngBuffer(520, 900, [0x77, 0x77, 0x77]);
    const hash = sha256Hex(pngBuf);
    const names = [];
    for (const commit of ["abc1234", "abc1235"]) {
      const name = `settings-rename-light-w520-${commit}.png`;
      writeFileSync(join(dir, name), pngBuf);
      const manifest = baseManifest({
        file: name,
        surface: "settings",
        state: "rename",
        theme: "light",
        styles: LIGHT_STYLES,
        counts: { profiles: 1 },
        scenarioId: "settings-rename",
        activeTab: "settings",
        url: `chrome-extension://${EXT_ID}/settings.html`,
      });
      manifest.sha256 = hash;
      manifest.commit = commit;
      writeFileSync(
        join(dir, `${name}.json`),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      names.push(name);
    }
    writeFileSync(
      join(dir, "exceptions.json"),
      `${JSON.stringify([{ hash, files: names, reason: "临时复用", reviewer: "tester", date: "2020-01-01" }], null, 2)}\n`,
    );
    created.push(dir);
  }

  // 14. invalid-exception-required：重复 hash 命中 required state，exception 不得豁免
  {
    const dir = resetDir("invalid-exception-required");
    const pngBuf = createPngBuffer(360, 900, [0x66, 0x66, 0x66]);
    const hash = sha256Hex(pngBuf);
    const names = [];
    for (const commit of ["abc1234", "abc1235"]) {
      const name = `batch-workspace-mixed-light-w360-${commit}.png`;
      writeFileSync(join(dir, name), pngBuf);
      const manifest = baseManifest({
        file: name,
        surface: "batch-workspace",
        state: "mixed",
        theme: "light",
        viewport: "360x900",
        styles: LIGHT_STYLES,
        counts: { batchItems: 20 },
        scenarioId: "batch-mixed-20",
        activeTab: "batch",
      });
      manifest.sha256 = hash;
      manifest.commit = commit;
      writeFileSync(
        join(dir, `${name}.json`),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      names.push(name);
    }
    writeFileSync(
      join(dir, "exceptions.json"),
      `${JSON.stringify([{ hash, files: names, reason: "required 不应豁免", reviewer: "tester", date: "2026-08-11" }], null, 2)}\n`,
    );
    created.push(dir);
  }

  // 15. invalid-url：URL 不是 chrome-extension 页面
  {
    const dir = resetDir("invalid-url");
    writeEvidence(dir, `session-menu-menu-open-light-w520-${COMMIT}.png`, {});
    created.push(dir);
  }

  // 16. invalid-active-tab：activeTab 不属于 surface
  {
    const dir = resetDir("invalid-active-tab");
    writeEvidence(dir, `timeline-populated-light-w520-${COMMIT}.png`, {
      rgb: [0xf6, 0xf8, 0xfb],
      surface: "timeline",
      state: "populated",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { subtitleRows: 20 },
      scenarioId: "timeline-populated-20",
      activeTab: "chat", // timeline 的合法 tab 是 timeline
    });
    created.push(dir);
  }

  // 17. invalid-filename：文件名不符合契约
  {
    const dir = resetDir("invalid-filename");
    writeEvidence(dir, `random-name.png`, {
      rgb: [0xf6, 0xf8, 0xfb],
      surface: "timeline",
      state: "populated",
      theme: "light",
      styles: LIGHT_STYLES,
      counts: { subtitleRows: 20 },
      scenarioId: "timeline-populated-20",
      activeTab: "timeline",
    });
    created.push(dir);
  }

  console.log(`已生成夹具：${created.length} 个目录 → ${FIXTURE_ROOT}`);
  for (const d of created) console.log(`  ${d}`);
}

main();
