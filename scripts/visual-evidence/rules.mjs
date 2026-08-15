#!/usr/bin/env node
/**
 * 视觉证据完整性门 — 校验规则（纯函数，可测试）。
 *
 * 规则来源：Ticket 01（.scratch/muzhi-ui-remediation/issues/01-evidence-reset.md）
 * 与 spec §D13（.workflow/specs/2026-08-11-muzhi-ui-remediation.md）。
 *
 * 本模块不访问文件系统；所有输入由调用方（入口脚本或测试）提供。
 */
import { basename } from "node:path";
import { URL } from "node:url";

import { parseCssColor, relativeLuminance } from "./png.mjs";

/** manifest 必需字段（D13 清单）。 */
export const REQUIRED_MANIFEST_FIELDS = [
  "file",
  "sha256",
  "commit",
  "surface",
  "state",
  "theme",
  "viewport",
  "deviceScaleFactor",
  "scenarioId",
  "activeTab",
  "interactionStep",
  "themeAttribute",
  "computedStyles",
  "scenarioCounts",
  "url",
  "capturedAt",
];

/** 计算样式必须包含的关键键（spec D13：canvas/background/text/accent）。 */
export const REQUIRED_COMPUTED_STYLE_KEYS = [
  "canvas",
  "background",
  "text",
  "accent",
];

/** 文件名契约：<surface>-<state>-<theme>-w<width>-<shortCommit>.png */
export const FILENAME_PATTERN =
  /^(?<prefix>.+)-(?<theme>light|dark)-w(?<width>\d+)-(?<commit>[0-9a-f]{7,40})\.png$/i;

/** 校验 profile 参数，返回 { ok, profile, ticket, error }。 */
export function resolveProfile({ profile, ticket }) {
  if (
    profile !== undefined &&
    !["fixture", "ticket", "final"].includes(profile)
  ) {
    return {
      ok: false,
      profile: null,
      ticket: null,
      error: `未知 profile：${profile}（允许 fixture|ticket|final）`,
    };
  }
  if (profile === "ticket" && !ticket) {
    return {
      ok: false,
      profile: null,
      ticket: null,
      error: "--profile ticket 必须同时提供 --ticket <NN>",
    };
  }
  if (ticket && profile && profile !== "ticket") {
    return {
      ok: false,
      profile: null,
      ticket: null,
      error: `--ticket 只允许与 --profile ticket 搭配（当前 ${profile}）`,
    };
  }
  const resolvedProfile = profile ?? (ticket ? "ticket" : "final");
  const resolvedTicket = resolvedProfile === "ticket" ? ticket : null;
  return {
    ok: true,
    profile: resolvedProfile,
    ticket: resolvedTicket,
    error: null,
  };
}

/**
 * 解析文件名 → { surface, state, theme, width, commit }。
 * 从尾部解析 -theme-w<width>-<commit>.png，再以已知 surface 最长前缀匹配。
 */
export function parseFilename(filename, surfaces) {
  const m = FILENAME_PATTERN.exec(filename);
  if (!m) {
    return null;
  }
  const { prefix, theme, width, commit } = m.groups;
  const surfaceKeys = Object.keys(surfaces);
  let best = null;
  for (const surface of surfaceKeys) {
    if (prefix === surface) {
      best = { surface, state: "" };
      break;
    }
    if (prefix.startsWith(`${surface}-`)) {
      const state = prefix.slice(surface.length + 1);
      if (state && (!best || surface.length > best.surface.length)) {
        best = { surface, state };
      }
    }
  }
  if (!best) {
    return null;
  }
  return {
    surface: best.surface,
    state: best.state,
    theme: theme.toLowerCase(),
    width: Number(width),
    commit: commit.toLowerCase(),
  };
}

/** 校验 manifest 顶层结构（字段存在性与基本类型），返回错误数组。 */
export function validateManifestShape(manifest) {
  const errors = [];
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    Array.isArray(manifest)
  ) {
    return ["manifest 必须是 JSON 对象"];
  }
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!(field in manifest) || manifest[field] === undefined) {
      errors.push(`缺少必需字段 ${field}`);
    }
  }
  if (errors.length > 0) {
    return errors;
  }
  const stringFields = [
    "file",
    "sha256",
    "commit",
    "surface",
    "state",
    "theme",
    "scenarioId",
    "activeTab",
    "url",
    "capturedAt",
  ];
  for (const field of stringFields) {
    if (typeof manifest[field] !== "string") {
      errors.push(`字段 ${field} 必须是字符串`);
    }
  }
  if (!/^[0-9a-f]{64}$/.test(manifest.sha256)) {
    errors.push("sha256 必须是 64 位小写十六进制");
  }
  if (!/^\d+x\d+$/.test(manifest.viewport)) {
    errors.push("viewport 必须是 WxH 格式（如 1158x900）");
  }
  if (
    typeof manifest.deviceScaleFactor !== "number" ||
    !(manifest.deviceScaleFactor > 0)
  ) {
    errors.push("deviceScaleFactor 必须是正数");
  }
  if (
    !Number.isInteger(manifest.interactionStep) ||
    manifest.interactionStep < 0
  ) {
    errors.push("interactionStep 必须是非负整数");
  }
  if (
    typeof manifest.themeAttribute !== "object" ||
    manifest.themeAttribute === null
  ) {
    errors.push("themeAttribute 必须是对象 { name, value }");
  }
  if (
    typeof manifest.computedStyles !== "object" ||
    manifest.computedStyles === null ||
    Array.isArray(manifest.computedStyles)
  ) {
    errors.push("computedStyles 必须是对象");
  }
  if (
    typeof manifest.scenarioCounts !== "object" ||
    manifest.scenarioCounts === null ||
    Array.isArray(manifest.scenarioCounts)
  ) {
    errors.push("scenarioCounts 必须是对象");
  }
  if (Number.isNaN(Date.parse(manifest.capturedAt))) {
    errors.push("capturedAt 必须是可解析的 ISO 时间");
  }
  return errors;
}

/** 校验 file 字段与磁盘文件名一致（兼容 Windows 反斜杠路径）。 */
export function validateFileField(file, actualPngName) {
  const errors = [];
  if (typeof file !== "string" || file.trim() === "") {
    return ["file 不能为空"];
  }
  const normalized = basename(file.replaceAll("\\", "/"));
  if (normalized !== actualPngName) {
    errors.push(
      `manifest.file 指向 ${normalized}，与实际 PNG ${actualPngName} 不一致`,
    );
  }
  return errors;
}

/** 校验 sha256 与实际文件 hash 一致。 */
export function validateHash(manifestSha256, actualSha256) {
  if (manifestSha256.toLowerCase() !== actualSha256.toLowerCase()) {
    return [`sha256 不匹配：manifest=${manifestSha256}，实际=${actualSha256}`];
  }
  return [];
}

/** 校验 PNG 像素尺寸 = viewport × deviceScaleFactor。 */
export function validatePngSize(viewport, deviceScaleFactor, pngSize) {
  const [w, h] = viewport.split("x").map(Number);
  const expectedW = Math.round(w * deviceScaleFactor);
  const expectedH = Math.round(h * deviceScaleFactor);
  if (pngSize.width !== expectedW || pngSize.height !== expectedH) {
    return [
      `PNG 尺寸不匹配：实际 ${pngSize.width}x${pngSize.height}，期望 ${expectedW}x${expectedH}（viewport ${viewport} × scale ${deviceScaleFactor}）`,
    ];
  }
  return [];
}

/** 校验 surface/state/theme 枚举。 */
export function validateEnums(
  manifest,
  { surfaces, states, themes, emptyStates },
) {
  const errors = [];
  if (!surfaces[manifest.surface]) {
    errors.push(`未知 surface：${manifest.surface}`);
  }
  if (!states.includes(manifest.state)) {
    errors.push(`未知 state：${manifest.state}`);
  } else if (emptyStates.includes(manifest.state)) {
    // 空态合法；继续
  }
  if (!themes.includes(manifest.theme)) {
    errors.push(`未知 theme：${manifest.theme}（允许 ${themes.join("|")}）`);
  }
  return errors;
}

/**
 * 校验主题真实性：
 * 1. themeAttribute.value 必须包含主题关键字（light/dark），防止只改文件名；
 * 2. computedStyles 的 text/canvas 亮度必须符合该主题的明暗方向；
 * 3. computedStyles 必须包含 canvas/background/text/accent。
 */
export function validateTheme(manifest) {
  const errors = [];
  const { theme, themeAttribute, computedStyles } = manifest;

  if (typeof themeAttribute !== "object" || themeAttribute === null) {
    return ["themeAttribute 必须是对象"];
  }
  const attrValue = String(themeAttribute.value ?? "").toLowerCase();
  if (!attrValue.includes(theme)) {
    errors.push(
      `themeAttribute.value=${attrValue} 不包含主题关键字 ${theme}（Light/Dark 不能只改文件名）`,
    );
  }
  if (typeof computedStyles !== "object" || computedStyles === null) {
    return [...errors, "computedStyles 必须是对象"];
  }
  for (const key of REQUIRED_COMPUTED_STYLE_KEYS) {
    if (typeof computedStyles[key] !== "string") {
      errors.push(`computedStyles 缺少关键键 ${key}`);
    }
  }
  if (errors.length > 0) {
    return errors;
  }
  const parsed = {};
  for (const key of REQUIRED_COMPUTED_STYLE_KEYS) {
    parsed[key] = parseCssColor(computedStyles[key]);
    if (!parsed[key]) {
      errors.push(
        `computedStyles.${key} 不是可解析的颜色：${computedStyles[key]}`,
      );
    }
  }
  if (errors.length > 0) {
    return errors;
  }
  const textLum = relativeLuminance(parsed.text);
  const canvasLum = relativeLuminance(parsed.canvas);
  if (theme === "dark") {
    if (!(textLum > 0.5)) {
      errors.push(
        `dark 主题 text 亮度 ${textLum.toFixed(3)} 应 > 0.5（浅色文字），疑似主题伪造`,
      );
    }
    if (!(canvasLum < 0.5)) {
      errors.push(
        `dark 主题 canvas 亮度 ${canvasLum.toFixed(3)} 应 < 0.5（深色画布），疑似主题伪造`,
      );
    }
  } else if (theme === "light") {
    if (!(textLum < 0.5)) {
      errors.push(
        `light 主题 text 亮度 ${textLum.toFixed(3)} 应 < 0.5（深色文字），疑似主题伪造`,
      );
    }
    if (!(canvasLum > 0.5)) {
      errors.push(
        `light 主题 canvas 亮度 ${canvasLum.toFixed(3)} 应 > 0.5（浅色画布），疑似主题伪造`,
      );
    }
  }
  return errors;
}

/**
 * 状态证明：populated 类 state 的 scenarioCounts 必须为正；
 * 登记了 minimumCounts 的 (surface,state) 必须达到阈值；值必须是非负整数。
 */
export function validateScenarioCounts(manifest, minimumCounts, emptyStates = ["empty"]) {
  const errors = [];
  const { surface, state, scenarioCounts } = manifest;
  for (const [key, value] of Object.entries(scenarioCounts)) {
    if (!Number.isInteger(value) || value < 0) {
      errors.push(
        `scenarioCounts.${key} 必须是非负整数，实际 ${JSON.stringify(value)}`,
      );
    }
  }
  if (errors.length > 0) {
    return errors;
  }
  const isPopulated = !isStrictEmptyState(manifest, emptyStates);
  if (isPopulated) {
    const totals = Object.values(scenarioCounts);
    if (totals.length === 0 || Math.max(...totals) === 0) {
      errors.push(
        `populated 类 state「${state}」的 scenarioCounts 不能为 0（空态不能代替 populated）`,
      );
    }
  }
  const thresholds = minimumCounts[`${surface}:${state}`];
  if (thresholds) {
    for (const [key, min] of Object.entries(thresholds)) {
      const actual = scenarioCounts[key];
      if (actual === undefined) {
        errors.push(
          `state「${surface}:${state}」要求 scenarioCounts.${key}，manifest 缺失`,
        );
      } else if (actual < min) {
        errors.push(
          `state「${surface}:${state}」的 scenarioCounts.${key}=${actual} 低于最小阈值 ${min}`,
        );
      }
    }
  }
  return errors;
}

/** 是否空态（空态允许 scenarioCounts 全 0）。 */
function isStrictEmptyState(manifest, emptyStates = ["empty"]) {
  return emptyStates.includes(manifest.state);
}

/**
 * 页面身份：URL 必须是 chrome-extension 页面，且 pathname 属于该 surface 的页面集合；
 * activeTab 必须属于该 surface 的合法 activeTabs。
 */
export function validatePageIdentity(manifest, { surfaces }) {
  const errors = [];
  const surfaceDef = surfaces[manifest.surface];
  if (!surfaceDef) {
    return [`未知 surface：${manifest.surface}`];
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(manifest.url);
  } catch {
    return [`url 不是合法 URL：${manifest.url}`];
  }
  if (parsedUrl.protocol !== "chrome-extension:") {
    errors.push(
      `url 必须是 chrome-extension 页面，实际协议 ${parsedUrl.protocol || "(无)"}`,
    );
  }
  const pathname =
    parsedUrl.pathname.split("/").filter(Boolean).pop() || "sidepanel.html";
  if (!surfaceDef.pages.includes(pathname)) {
    errors.push(
      `surface ${manifest.surface} 的 url 页面应为 ${surfaceDef.pages.join("|")}，实际 ${pathname}`,
    );
  }
  if (!surfaceDef.activeTabs.includes(manifest.activeTab)) {
    errors.push(
      `activeTab=${manifest.activeTab} 不属于 surface ${manifest.surface} 的 ${surfaceDef.activeTabs.join("|")}`,
    );
  }
  return errors;
}

/**
 * 校验文件名契约与 manifest 一致性（surface/state/theme/width/commit）。
 */
export function validateFilenameContract(filename, manifest, { surfaces }) {
  const errors = [];
  const parsed = parseFilename(filename, surfaces);
  if (!parsed) {
    return [
      `文件名不符合契约 <surface>-<state>-<theme>-w<width>-<shortCommit>.png：${filename}`,
    ];
  }
  if (parsed.surface !== manifest.surface) {
    errors.push(
      `文件名 surface=${parsed.surface} 与 manifest.surface=${manifest.surface} 不一致`,
    );
  }
  if (parsed.state && parsed.state !== manifest.state) {
    errors.push(
      `文件名 state=${parsed.state} 与 manifest.state=${manifest.state} 不一致`,
    );
  }
  if (parsed.theme !== manifest.theme) {
    errors.push(
      `文件名 theme=${parsed.theme} 与 manifest.theme=${manifest.theme} 不一致`,
    );
  }
  const [viewportW] = manifest.viewport.split("x").map(Number);
  if (parsed.width !== viewportW) {
    errors.push(
      `文件名宽度 w${parsed.width} 与 viewport 宽度 ${viewportW} 不一致`,
    );
  }
  const commit = String(manifest.commit).toLowerCase();
  if (!(commit.startsWith(parsed.commit) || parsed.commit.startsWith(commit))) {
    errors.push(
      `文件名 commit ${parsed.commit} 与 manifest.commit ${commit} 不一致`,
    );
  }
  return errors;
}

/**
 * 校验同一证据目录内的重复 hash（Light/Dark、跨 surface、跨 required state 复用即阻断）。
 * requiredStates: Set of "surface:state:theme:width" 属于当前 profile 的 required 组合。
 * exceptions: 解析后的 exceptions.json 数组。
 * 返回 { errors, warnings }。
 */
/**
 * 校验同一证据目录内的重复 hash（Light/Dark、跨 surface、跨 required state 复用即阻断）。
 * requiredSet: "surface|state|theme|width" 集合；命中 required 的重复组禁止 exception 豁免。
 * exceptions: 解析后的 exceptions.json 数组。
 * 返回 { errors, warnings }。
 */
export function validateDuplicateHashes(entries, exceptions, options = {}) {
  const { requiredSet = new Set() } = options;
  const errors = [];
  const warnings = [];
  const byHash = new Map();
  for (const entry of entries) {
    if (!byHash.has(entry.sha256)) {
      byHash.set(entry.sha256, []);
    }
    byHash.get(entry.sha256).push(entry);
  }
  for (const [hash, group] of byHash) {
    if (group.length < 2) {
      continue;
    }
    const fileNames = group.map((e) => e.file);
    const requiredHit = group.some((e) =>
      requiredSet.has(`${e.surface}|${e.state}|${e.theme}|${e.viewportWidth}`),
    );
    if (requiredHit) {
      errors.push(
        `重复 hash ${hash} 命中 required state（${fileNames.join(" = ")}）；required state 禁止 exception 豁免`,
      );
      continue;
    }
    const exception = exceptions.find((x) => x.hash === hash);
    if (exception && !exception.invalidReason) {
      const covered = fileNames.every((f) => exception.files.includes(f));
      if (covered) {
        warnings.push(
          `重复 hash ${hash.slice(0, 12)}… 已被例外豁免：${exception.reason}`,
        );
        continue;
      }
    }
    const detail = fileNames.join(" = ");
    errors.push(
      `重复 hash ${hash}：${detail}（Light/Dark、跨 surface 或跨 required state 复用同一图片）`,
    );
  }
  return { errors, warnings };
}

/** 校验 exceptions.json 结构、字段与过期。返回规范化后的数组（含 invalidReason 标注）。 */
export function validateExceptions(raw, { maxAgeDays }) {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [
      {
        hash: "(invalid)",
        files: [],
        reason: "",
        reviewer: "",
        date: "",
        invalidReason: "exceptions.json 必须是数组",
      },
    ];
  }
  const now = Date.now();
  return raw.map((x) => {
    const invalid = [];
    if (!x || typeof x !== "object") {
      return {
        hash: "(invalid)",
        files: [],
        reason: "",
        reviewer: "",
        date: "",
        invalidReason: "条目必须是对象",
      };
    }
    if (typeof x.hash !== "string" || !/^[0-9a-f]{64}$/.test(x.hash)) {
      invalid.push("hash 必须是 64 位十六进制");
    }
    if (
      !Array.isArray(x.files) ||
      x.files.length === 0 ||
      !x.files.every((f) => typeof f === "string")
    ) {
      invalid.push("files 必须是非空字符串数组");
    }
    if (typeof x.reason !== "string" || x.reason.trim() === "") {
      invalid.push("reason 必须为非空理由");
    }
    if (typeof x.reviewer !== "string" || x.reviewer.trim() === "") {
      invalid.push("reviewer 必须为非空审查人");
    }
    let dateValid = false;
    if (typeof x.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) {
      const t = Date.parse(`${x.date}T00:00:00Z`);
      if (!Number.isNaN(t)) {
        dateValid = true;
        const ageDays = (now - t) / 86400000;
        if (ageDays > maxAgeDays) {
          invalid.push(`例外已于 ${x.date} 过期（超过 ${maxAgeDays} 天）`);
        }
      }
    }
    if (!dateValid) {
      invalid.push("date 必须是 YYYY-MM-DD 有效日期");
    }
    return {
      hash: x.hash ?? "(invalid)",
      files: x.files ?? [],
      reason: x.reason ?? "",
      reviewer: x.reviewer ?? "",
      date: x.date ?? "",
      invalidReason: invalid.length > 0 ? invalid.join("；") : null,
    };
  });
}

/**
 * 检查 required-state 矩阵：evidence 是否覆盖 profile 登记的 (surface,state,theme,width) 组合。
 * 返回缺失组合列表。
 */
export function findMissingRequired(required, entries) {
  const missing = [];
  const present = new Set();
  for (const entry of entries) {
    present.add(
      `${entry.surface}|${entry.state}|${entry.theme}|${entry.viewportWidth}`,
    );
  }
  for (const req of required) {
    for (const theme of req.themes) {
      for (const width of req.widths) {
        const key = `${req.surface}|${req.state}|${theme}|${width}`;
        if (!present.has(key)) {
          missing.push(
            `缺少 required state：${req.surface}/${req.state}/${theme}@w${width}`,
          );
        }
      }
    }
  }
  return missing;
}
