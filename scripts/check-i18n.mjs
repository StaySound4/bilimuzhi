#!/usr/bin/env node
/**
 * i18n 规格检查（docs/i18n-spec.md §3/§8）。
 *
 * 扫描 src/ui 与 sidepanel 提示/错误文案，断言无未登记裸中文：
 *  - 引号包裹且含中文的字符串字面量必须能在 messages.ts 的 zh-Hans 值集合中找到；
 *  - 模板字符串（含 `${...}` 插值）按占位符归一后比对；
 *  - JSX 裸文本节点（`>中文<`）同样比对（字符串正则的盲区）；
 *  - 注释行与纯技术标识（URL/时间戳/文件名等）不参与比对；
 *  - 数据渲染点（标题/字幕/标签名等插值处）以插值表达式出现，天然不含裸中文；
 *  - 产品名「Bilimuzhi」等专有名词豁免。
 *
 * 白名单（不扫描）：src/application/ai（提示词模块）、
 * src/application 下 provider-*.ts（供应商错误原文）、
 * src/infrastructure（存储/运行时内部消息）、测试目录。
 *
 * 用法：node scripts/check-i18n.mjs
 * 退出码：0 全部通过；1 存在未登记裸中文。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { URL, fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const UI_DIR = join(ROOT, "src", "ui");
const SIDEPANEL = join(ROOT, "src", "entries", "sidepanel.tsx");
const MESSAGES = join(ROOT, "src", "i18n", "messages.ts");

/** 收集 messages.ts zh-Hans 值集合。 */
function collectRegisteredTexts() {
  const src = readFileSync(MESSAGES, "utf-8");
  const start = src.indexOf("const zhHans");
  const end = src.indexOf("export type MessageKey");
  if (start < 0 || end < 0) {
    throw new Error("check-i18n: 无法定位 zhHans 文案块");
  }
  const block = src.slice(start, end);
  const values = new Set();
  const re = /^\s*"[a-zA-Z0-9.]+":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm;
  let match;
  while ((match = re.exec(block)) !== null) {
    const raw = match[1]
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .replace(/\{(\w+)\}/g, "{}");
    values.add(raw);
  }
  return values;
}

/** 提取一行中引号包裹且含中文的字符串字面量。 */
const STRING_LITERAL_RE =
  /(["'`])((?:(?!\1)[^\\]|\\.)*\s*[\u4e00-\u9fff](?:(?!\1)[^\\]|\\.)*)\1/g;

function collectLineStrings(line) {
  const hits = [];
  let match;
  STRING_LITERAL_RE.lastIndex = 0;
  while ((match = STRING_LITERAL_RE.exec(line)) !== null) {
    hits.push(match[2]);
  }
  return hits;
}

/** 提取 JSX 裸文本节点（`>中文<`，无引号包裹；字符串正则扫不到）。 */
const JSX_TEXT_RE = />([^<>{}]*[\u4e00-\u9fff][^<>{}]*)</g;

function collectLineJsxText(line) {
  const hits = [];
  let match;
  JSX_TEXT_RE.lastIndex = 0;
  while ((match = JSX_TEXT_RE.exec(line)) !== null) {
    hits.push(match[1].trim());
  }
  return hits;
}

/** 归一：模板插值 `${...}` -> 占位符，登记值 {param} -> 占位符。 */
function normalize(text) {
  return text
    .replace(/\$\{[^}]*\}/g, "{}")
    .replace(/\{\w+\}/g, "{}")
    .trim();
}

function isCommentOrDirective(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("<!--") ||
    trimmed.startsWith("import") ||
    trimmed.startsWith("export")
  );
}

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const registered = collectRegisteredTexts();
const violations = [];
/** 产品名等专有名词豁免（保持原文不翻译）。 */
const EXEMPT_TEXTS = new Set(["Bilimuzhi", "智谱", "Groq 官方", "自定义端点"]);

function scanFile(file) {
  const src = readFileSync(file, "utf-8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentOrDirective(line)) continue;
    for (const raw of collectLineStrings(line)) {
      const text = raw.trim();
      if (text.length === 0) continue;
      const normalized = normalize(text);
      if (registered.has(normalized) || EXEMPT_TEXTS.has(text)) continue;
      violations.push({
        file: relative(ROOT, file),
        line: i + 1,
        text: text.length > 80 ? `${text.slice(0, 80)}…` : text,
      });
    }
    for (const text of collectLineJsxText(line)) {
      if (text.length === 0) continue;
      if (registered.has(text) || EXEMPT_TEXTS.has(text)) continue;
      violations.push({
        file: relative(ROOT, file),
        line: i + 1,
        text: `[JSX 文本] ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`,
      });
    }
  }
}

const files = collectFiles(UI_DIR);
files.push(SIDEPANEL);
for (const file of files) {
  scanFile(file);
}

if (violations.length > 0) {
  console.error(
    `check-i18n: 发现 ${violations.length} 处未登记裸中文（docs/i18n-spec.md §3 必须翻译；` +
      "新文案请登记到 src/i18n/messages.ts 四种语言）：",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.text}`);
  }
  process.exitCode = 1;
} else {
  console.log(`check-i18n: 通过（${files.length} 个文件，无未登记裸中文）`);
}
