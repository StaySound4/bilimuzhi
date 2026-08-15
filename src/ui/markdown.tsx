import { t } from "../i18n";
import type { UiLanguage } from "../i18n/languages";
import { Fragment, type ComponentChildren, type JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import katex from "katex";
import "katex/dist/katex.min.css";

import {
  CLOCK_TIME_RANGE_PATTERN,
  COMPACT_TIME_RANGE_PATTERN,
  compactTimeLabel,
  parseTimeSeconds,
  type TimeMarkerSubtitleRow,
  type ValidatedMarkdownTimeLink,
} from "../application/time-marker";

/**
 * Renders a conservative Markdown subset into Preact nodes. The renderer never
 * builds raw HTML, so untrusted model output and untrusted subtitle text cannot
 * inject markup, scripts, event handlers or non-http(s) URLs.
 */

type InlineToken =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "code"; readonly value: string }
  | { readonly kind: "strong"; readonly value: string }
  | { readonly kind: "emphasis"; readonly value: string }
  | { readonly kind: "latex"; readonly value: string }
  | { readonly kind: "latex-fallback"; readonly value: string }
  | {
      readonly kind: "time-link";
      readonly seconds: number;
      readonly value: string;
    }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly value: string;
    }
  | {
      readonly kind: "remote-image";
      readonly url: string;
      readonly value: string;
    }
  | {
      readonly kind: "rejected-image";
      readonly value: string;
    };

const INLINE_PATTERN = new RegExp(
  "(!\\[[^\\]\\n]*\\]\\([^)\\s]+\\))|(`[^`\\n]+`)|(\\\\\\([^\\n]+?\\\\\\))|(\\*\\*[^*\\n]+\\*\\*)|(__[^_\\n]+__)|(\\*[^*\\n]+\\*)|(_[^_\\n]+_)|(\\[[^\\]\\n]*\\]\\([^)\\s]+\\))|(\\[[^\\]\\n]+\\](?!\\())|((?<![\\p{L}\\p{N}[])" +
    COMPACT_TIME_RANGE_PATTERN +
    "(?![\\p{L}\\p{N}\\]]))|((?<![\\p{L}\\p{N}[])" +
    CLOCK_TIME_RANGE_PATTERN +
    "(?![\\p{L}\\p{N}\\]]))|(\\$[^$\\n]+\\$)",
  "u",
);
const BARE_TIME_TOKEN_PATTERN = new RegExp(
  `^${COMPACT_TIME_RANGE_PATTERN}$`,
  "u",
);

interface NormalizedInlineTimeLinks {
  readonly links: readonly ValidatedMarkdownTimeLink[];
  readonly text: string;
}

interface InlineTimeOccurrence {
  readonly end: number;
  readonly link: ValidatedMarkdownTimeLink;
  readonly start: number;
  readonly wrapped: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function linkEndSeconds(link: ValidatedMarkdownTimeLink): number {
  const rangeEnd = link.label.split(/[–-]/u).at(-1);
  if (rangeEnd === undefined) return link.seconds;
  const parsed = parseTimeSeconds(rangeEnd);
  if (parsed !== null) return parsed;
  // UI 容错回退：application 层拒绝 s 前大于 60 的紧凑 token（如 "77s"），
  // 但作为范围终点它仍可解析出纯数字秒数，用于聚类边界与终点显示。
  const secondsOnly = /^(\d+)s$/u.exec(rangeEnd);
  return secondsOnly === null ? link.seconds : Number(secondsOnly[1]);
}

function collectInlineTimeOccurrences(
  text: string,
  links: readonly ValidatedMarkdownTimeLink[],
): readonly InlineTimeOccurrence[] {
  const blockedRanges = [
    /!\[[^\]\n]*\]\([^)\s]+\)/gu,
    /`[^`\n]+`/gu,
    /\\\([^\n]+?\\\)/gu,
    /\[[^\]\n]*\]\([^)\s]+\)/gu,
    /\$[^$\n]+\$/gu,
  ].flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) =>
      Object.freeze({ end: match.index + match[0].length, start: match.index }),
    ),
  );
  const occurrences: InlineTimeOccurrence[] = [];
  for (const link of links) {
    const wrappedPattern = new RegExp(`\\[${escapeRegex(link.label)}\\]`, "gu");
    const isBareTime =
      BARE_TIME_TOKEN_PATTERN.test(link.label) ||
      new RegExp(`^${CLOCK_TIME_RANGE_PATTERN}$`, "u").test(link.label);
    const barePattern = isBareTime
      ? new RegExp(
          `(?<![\\p{L}\\p{N}[])${escapeRegex(link.label)}(?![\\p{L}\\p{N}\\]])`,
          "gu",
        )
      : null;
    for (const pattern of [wrappedPattern, barePattern]) {
      if (pattern === null) continue;
      for (const match of text.matchAll(pattern)) {
        let precedingSlashCount = 0;
        for (let index = match.index - 1; index >= 0; index -= 1) {
          if (text[index] !== "\\") break;
          precedingSlashCount += 1;
        }
        if (precedingSlashCount % 2 === 1) continue;
        const end = match.index + match[0].length;
        if (
          blockedRanges.some(
            (blocked) => match.index < blocked.end && end > blocked.start,
          )
        ) {
          continue;
        }
        occurrences.push({
          end,
          link,
          start: match.index,
          wrapped: match[0].startsWith("["),
        });
      }
    }
  }
  return occurrences;
}
function normalizeInlineTimeLinks(
  text: string,
  links: readonly ValidatedMarkdownTimeLink[],
  policy: "all" | "one-per-block",
): NormalizedInlineTimeLinks {
  if (policy === "all") return { links, text };
  const orderedOccurrences = [
    ...collectInlineTimeOccurrences(text, links),
  ].sort((left, right) => left.start - right.start || right.end - left.end);
  // 文本位置重叠的匹配保留更长者（如 "77s" 与 "62s–77s" 子串重叠）。
  const occurrences: InlineTimeOccurrence[] = [];
  for (const occurrence of orderedOccurrences) {
    const overlappingIndex = occurrences.findIndex(
      (existing) =>
        occurrence.start < existing.end && occurrence.end > existing.start,
    );
    if (overlappingIndex < 0) {
      occurrences.push(occurrence);
      continue;
    }
    const existing = occurrences[overlappingIndex];
    if (occurrence.end - occurrence.start > existing.end - existing.start) {
      occurrences[overlappingIndex] = occurrence;
    }
  }
  occurrences.sort((left, right) => left.start - right.start);
  if (occurrences.length === 0) return { links: [], text };
  // 先在链接级别按时间区间聚类：同一时间段的多种表述（62s、62s–77s、
  // 77s）归为一组；时间不重叠的链接各自独立。组内所有出现位置合并为
  // 一个规范范围控件放在第一个位置，其余位置删除。没有文本出现的
  // 范围链接（如 62s–77s）也参与聚类，把两侧单点桥接为同一范围。
  interface LinkCluster {
    readonly links: ValidatedMarkdownTimeLink[];
    readonly occurrences: InlineTimeOccurrence[];
  }
  const clusters: LinkCluster[] = [];
  for (const link of links) {
    const start = link.seconds;
    const end = linkEndSeconds(link);
    const cluster = clusters.find((candidate) =>
      candidate.links.some((member) => {
        const memberStart = member.seconds;
        const memberEnd = linkEndSeconds(member);
        return start <= memberEnd && end >= memberStart;
      }),
    );
    if (cluster === undefined) {
      clusters.push({ links: [link], occurrences: [] });
    } else {
      cluster.links.push(link);
    }
  }
  for (const occurrence of occurrences) {
    const cluster = clusters.find((candidate) =>
      candidate.links.includes(occurrence.link),
    );
    if (cluster !== undefined) cluster.occurrences.push(occurrence);
  }
  const replacements: readonly {
    readonly end: number;
    readonly rendered: string;
    readonly seconds: number | null;
    readonly start: number;
  }[] = clusters.flatMap((cluster) => {
    if (cluster.occurrences.length === 0) return [];
    const rangeStartSeconds = Math.min(
      ...cluster.links.map((link) => link.seconds),
    );
    const rangeEndSeconds = Math.max(
      ...cluster.links.map((link) => linkEndSeconds(link)),
    );
    const label =
      rangeStartSeconds === rangeEndSeconds
        ? compactTimeLabel(rangeStartSeconds)
        : `${compactTimeLabel(rangeStartSeconds)}–${compactTimeLabel(rangeEndSeconds)}`;
    return cluster.occurrences.map((occurrence, index) => ({
      end: occurrence.end,
      rendered: index === 0 ? (occurrence.wrapped ? `[${label}]` : label) : "",
      seconds: index === 0 ? rangeStartSeconds : null,
      start: occurrence.start,
    }));
  });
  const normalized = [...replacements].sort(
    (left, right) => right.start - left.start,
  );
  let normalizedText = text;
  const normalizedLinks: ValidatedMarkdownTimeLink[] = [];
  for (const replacement of normalized) {
    normalizedText = `${normalizedText.slice(0, replacement.start)}${replacement.rendered}${normalizedText.slice(replacement.end)}`;
    if (replacement.seconds !== null) {
      const label = replacement.rendered.replace(/^\[|\]$/gu, "");
      normalizedLinks.push(
        Object.freeze({ label, seconds: replacement.seconds }),
      );
    }
  }
  return { links: Object.freeze(normalizedLinks), text: normalizedText };
}
export function safeLinkHref(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.toString();
}

function safeRemoteMarkdownImageUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 2_048) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    /\.svg$/i.test(url.pathname)
  ) {
    return null;
  }
  return url.toString();
}

export interface MarkdownSubtitleRow extends TimeMarkerSubtitleRow {
  readonly text: string;
}

export {
  deriveValidatedMarkdownTimeLinks,
  type MarkdownTimeLinkValidationScope,
  type ValidatedMarkdownTimeLink,
} from "../application/time-marker";

function isBilibiliTimeUrl(href: string): boolean {
  try {
    const url = new URL(href);
    const hostname = url.hostname.toLowerCase();
    return (
      (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) &&
      /^\/video\//u.test(url.pathname) &&
      url.searchParams.has("t")
    );
  } catch {
    return false;
  }
}

function safeLatexSource(value: string): string | null {
  const source = value.trim().replaceAll("\\\\", "\\");
  if (
    source.length === 0 ||
    source.length > 2_000 ||
    /[<>]|\\(?:begin|class|def|href|html|id|includegraphics|newcommand|require|style|url)\b/i.test(
      source,
    )
  ) {
    return null;
  }
  return source;
}

function renderTimeLinkValue(label: string, seconds: number): string {
  const range = /^(.+?)[–-](.+)$/u.exec(label);
  if (range === null) return compactTimeLabel(seconds);
  const start = parseTimeSeconds(range[1]);
  const end = parseTimeSeconds(range[2]);
  if (start === null || end === null) return label;
  return `${compactTimeLabel(start)}–${compactTimeLabel(end)}`;
}

function tokenizeInline(
  input: string,
  validatedTimeLinks: readonly ValidatedMarkdownTimeLink[],
): readonly InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = input;
  while (rest.length > 0) {
    const match = INLINE_PATTERN.exec(rest);
    if (match === null || match.index === undefined) {
      tokens.push({ kind: "text", value: rest });
      break;
    }
    if (match.index > 0) {
      tokens.push({ kind: "text", value: rest.slice(0, match.index) });
    }
    const raw = match[0];
    const escapedStart = (() => {
      let slashCount = 0;
      for (let index = match.index - 1; index >= 0; index -= 1) {
        if (rest[index] !== "\\") break;
        slashCount += 1;
      }
      return slashCount % 2 === 1;
    })();
    rest = rest.slice(match.index + raw.length);
    if (raw.startsWith("![")) {
      const separator = raw.indexOf("](");
      const label = raw.slice(2, separator).trim();
      const url = safeRemoteMarkdownImageUrl(raw.slice(separator + 2, -1));
      tokens.push(
        url === null
          ? { kind: "rejected-image", value: label }
          : { kind: "remote-image", url, value: label },
      );
      continue;
    }
    if (raw.startsWith("`")) {
      tokens.push({ kind: "code", value: raw.slice(1, -1) });
      continue;
    }
    if (raw.startsWith("\\(")) {
      const source = escapedStart ? null : safeLatexSource(raw.slice(2, -2));
      tokens.push(
        source === null
          ? { kind: "text", value: raw }
          : { kind: "latex", value: source },
      );
      continue;
    }
    if (raw.startsWith("**") || raw.startsWith("__")) {
      tokens.push({ kind: "strong", value: raw.slice(2, -2) });
      continue;
    }
    if (raw.startsWith("[")) {
      if (!raw.includes("](")) {
        const label = raw.slice(1, -1);
        const validated = validatedTimeLinks.find(
          (candidate) =>
            candidate.label === label &&
            Number.isFinite(candidate.seconds) &&
            candidate.seconds >= 0,
        );
        if (validated === undefined) {
          tokens.push({ kind: "text", value: raw });
        } else {
          tokens.push({
            kind: "time-link",
            seconds: validated.seconds,
            value: renderTimeLinkValue(label, validated.seconds),
          });
        }
        continue;
      }
      const separator = raw.indexOf("](");
      const label = raw.slice(1, separator);
      const href = safeLinkHref(raw.slice(separator + 2, -1));
      if (href === null || isBilibiliTimeUrl(href)) {
        tokens.push({ kind: "text", value: label.length > 0 ? label : raw });
      } else {
        tokens.push({
          href,
          kind: "link",
          value: label.length > 0 ? label : href,
        });
      }
      continue;
    }
    const validatedBareTime = validatedTimeLinks.find(
      (candidate) =>
        candidate.label === raw &&
        Number.isFinite(candidate.seconds) &&
        candidate.seconds >= 0,
    );
    if (validatedBareTime !== undefined) {
      tokens.push({
        kind: "time-link",
        seconds: validatedBareTime.seconds,
        value: renderTimeLinkValue(raw, validatedBareTime.seconds),
      });
      continue;
    }
    if (BARE_TIME_TOKEN_PATTERN.test(raw)) {
      tokens.push({ kind: "text", value: raw });
      continue;
    }
    if (raw.startsWith("$")) {
      const sourceText = raw.slice(1, -1);
      const closingEscaped = /(?:^|[^\\])(?:\\\\)*\\$/.test(raw.slice(0, -1));
      const looksLikeCurrency = /^\s*\d+(?:[.,]\d+)?(?:\s|[，,。.元]|$)/u.test(
        sourceText,
      );
      const source =
        escapedStart || closingEscaped || looksLikeCurrency
          ? null
          : safeLatexSource(sourceText);
      tokens.push(
        source === null
          ? { kind: "text", value: raw }
          : { kind: "latex", value: source },
      );
      continue;
    }
    tokens.push({ kind: "emphasis", value: raw.slice(1, -1) });
  }
  return tokens;
}

function renderLatex(
  source: string,
  key: number,
  lang: UiLanguage,
): ComponentChildren {
  try {
    const markup = katex.renderToString(source, {
      displayMode: false,
      output: "htmlAndMathml",
      strict: "error",
      throwOnError: true,
      trust: false,
    });
    return (
      <span
        aria-label={t(lang, "markdown.mathFormula", { source })}
        class="muzhi-markdown__latex"
        data-latex={source}
        data-math-rendered="true"
        dangerouslySetInnerHTML={{ __html: markup }}
        key={key}
        role="math"
      />
    );
  } catch {
    return (
      <code
        aria-label={t(lang, "markdown.latexFailed")}
        data-latex-fallback="true"
        key={key}
      >
        {source}
      </code>
    );
  }
}

export interface RemoteMarkdownImageRequest {
  readonly alt: string;
  readonly url: string;
}

export interface RemoteMarkdownImageResult {
  readonly objectUrl: `blob:${string}`;
}

function RemoteMarkdownImage({
  lang,
  alt,
  onLoad,
  url,
}: {
  readonly lang: UiLanguage;
  readonly alt: string;
  readonly onLoad?: (
    request: RemoteMarkdownImageRequest,
  ) => Promise<RemoteMarkdownImageResult>;
  readonly url: string;
}): JSX.Element {
  const pending = useRef(false);
  const requestVersion = useRef(0);
  const ownedObjectUrl = useRef<`blob:${string}` | null>(null);
  const [state, setState] = useState<
    | { readonly kind: "idle" }
    | { readonly kind: "pending" }
    | { readonly kind: "failed" }
    | { readonly kind: "ready"; readonly objectUrl: `blob:${string}` }
  >({ kind: "idle" });

  useEffect(() => {
    pending.current = false;
    setState({ kind: "idle" });
    return () => {
      requestVersion.current += 1;
      pending.current = false;
      const objectUrl = ownedObjectUrl.current;
      ownedObjectUrl.current = null;
      const revokeObjectUrl = Reflect.get(URL, "revokeObjectURL");
      if (objectUrl !== null && typeof revokeObjectUrl === "function") {
        Reflect.apply(revokeObjectUrl, URL, [objectUrl]);
      }
    };
  }, [url]);

  if (state.kind === "ready") {
    return <img alt={alt} src={state.objectUrl} />;
  }
  const retry = state.kind === "failed";
  const load = async (): Promise<void> => {
    if (pending.current || onLoad === undefined) return;
    pending.current = true;
    const version = requestVersion.current;
    setState({ kind: "pending" });
    try {
      const result = await onLoad({ alt, url });
      if (
        typeof result !== "object" ||
        result === null ||
        typeof result.objectUrl !== "string" ||
        !result.objectUrl.startsWith("blob:") ||
        result.objectUrl.length > 2_048
      ) {
        throw new Error("The local Markdown image result is invalid");
      }
      if (version !== requestVersion.current) {
        const revokeObjectUrl = Reflect.get(URL, "revokeObjectURL");
        if (typeof revokeObjectUrl === "function") {
          Reflect.apply(revokeObjectUrl, URL, [result.objectUrl]);
        }
        return;
      }
      ownedObjectUrl.current = result.objectUrl;
      setState({ kind: "ready", objectUrl: result.objectUrl });
    } catch {
      if (version !== requestVersion.current) return;
      pending.current = false;
      setState({ kind: "failed" });
    }
  };
  return (
    <span class="muzhi-markdown__remote-image">
      <button
        aria-label={`${
          state.kind === "pending"
            ? t(lang, "markdown.loadingImage")
            : retry
              ? t(lang, "markdown.retryImage")
              : t(lang, "markdown.clickImage")
        }：${alt}`}
        disabled={state.kind === "pending" || onLoad === undefined}
        onClick={() => void load()}
        type="button"
      >
        {state.kind === "pending"
          ? t(lang, "markdown.loadingImage")
          : retry
            ? t(lang, "markdown.retryImage")
            : t(lang, "markdown.clickImage")}
      </button>
      {retry ? (
        <span role="status">{t(lang, "markdown.loadFailed")}</span>
      ) : null}
    </span>
  );
}

function renderInline(
  lang: UiLanguage,
  input: string,
  validatedTimeLinks: readonly ValidatedMarkdownTimeLink[],
  onSeek: ((seconds: number) => void) | undefined,
  onLoadRemoteImage:
    | ((
        request: RemoteMarkdownImageRequest,
      ) => Promise<RemoteMarkdownImageResult>)
    | undefined,
): ComponentChildren {
  // input/validatedTimeLinks 已由调用方（Markdown 组件顶层闭包）归一化；
  // 递归渲染（strong/emphasis 等嵌套）直接使用传入的链接。
  return tokenizeInline(input, validatedTimeLinks).map((token, index) => {
    switch (token.kind) {
      case "code":
        return <code key={index}>{token.value}</code>;
      case "strong":
        return (
          <strong key={index}>
            {renderInline(
              lang,
              token.value,
              validatedTimeLinks,
              onSeek,
              onLoadRemoteImage,
            )}
          </strong>
        );
      case "emphasis":
        return (
          <em key={index}>
            {renderInline(
              lang,
              token.value,
              validatedTimeLinks,
              onSeek,
              onLoadRemoteImage,
            )}
          </em>
        );
      case "link":
        return (
          <a
            href={token.href}
            key={index}
            rel="noopener noreferrer nofollow"
            target="_blank"
          >
            {token.value}
          </a>
        );
      case "latex":
        return renderLatex(token.value, index, lang);
      case "latex-fallback":
        return (
          <code
            aria-label={t(lang, "markdown.latexUnavailable")}
            data-latex-fallback="true"
            key={index}
          >
            {token.value}
          </code>
        );
      case "remote-image":
        return (
          <RemoteMarkdownImage
            lang={lang}
            alt={token.value || t(lang, "markdown.image")}
            key={index}
            onLoad={onLoadRemoteImage}
            url={token.url}
          />
        );
      case "rejected-image":
        return (
          <Fragment key={index}>
            {token.value || t(lang, "markdown.image")}
          </Fragment>
        );
      case "time-link":
        return (
          <button
            aria-label={`跳转到 ${token.value}`}
            class="muzhi-markdown__time-link"
            key={index}
            onClick={() => onSeek?.(token.seconds)}
            type="button"
          >
            {token.value}
          </button>
        );
      default:
        return (
          <Fragment key={index}>
            {token.value || t(lang, "markdown.image")}
          </Fragment>
        );
    }
  });
}

interface MarkdownBlock {
  readonly kind:
    | "heading"
    | "paragraph"
    | "unordered-list"
    | "ordered-list"
    | "quote"
    | "code"
    | "table"
    | "thematic-break"
    | "latex-block";
  readonly items: readonly string[];
  readonly level: number;
}

function parseBlocks(markdown: string): readonly MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let listKind: "ordered-list" | "unordered-list" | null = null;
  let quote: string[] = [];
  let code: string[] | null = null;
  let latexBlock: {
    readonly closing: "$$" | "\\]";
    readonly opening: "$$" | "\\[";
    readonly lines: string[];
  } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    blocks.push({ items: [paragraph.join(" ")], kind: "paragraph", level: 0 });
    paragraph = [];
  };
  const flushList = (): void => {
    if (list.length === 0 || listKind === null) return;
    blocks.push({ items: [...list], kind: listKind, level: 0 });
    list = [];
    listKind = null;
  };
  const flushQuote = (): void => {
    if (quote.length === 0) return;
    blocks.push({ items: [quote.join(" ")], kind: "quote", level: 0 });
    quote = [];
  };
  const flushAll = (): void => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  const isTableDelimiter = (line: string): boolean => {
    const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");
    return (
      cells.length > 0 && cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
    );
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (/^\s*```/.test(line)) {
      if (code === null) {
        flushAll();
        code = [];
      } else {
        blocks.push({ items: [code.join("\n")], kind: "code", level: 0 });
        code = null;
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    if (latexBlock !== null) {
      if (line.trim() === latexBlock.closing) {
        blocks.push({
          items: [latexBlock.lines.join("\n")],
          kind: "latex-block",
          level: 0,
        });
        latexBlock = null;
      } else {
        latexBlock.lines.push(line);
      }
      continue;
    }
    if (line.trim().length === 0) {
      flushAll();
      continue;
    }
    if (/^\s{0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      flushAll();
      blocks.push({ items: [], kind: "thematic-break", level: 0 });
      continue;
    }
    const dollarLatexBlock = /^\s*\$\$([^\n]+?)\$\$\s*$/.exec(line);
    const bracketLatexBlock = /^\s*\\\[([^\n]+?)\\\]\s*$/.exec(line);
    if (dollarLatexBlock || bracketLatexBlock) {
      flushAll();
      blocks.push({
        items: [(dollarLatexBlock ?? bracketLatexBlock)![1]],
        kind: "latex-block",
        level: 0,
      });
      continue;
    }
    if (line.trim() === "$$" || line.trim() === "\\[") {
      flushAll();
      latexBlock = {
        closing: line.trim() === "$$" ? "$$" : "\\]",
        lines: [],
        opening: line.trim() as "$$" | "\\[",
      };
      continue;
    }
    if (
      line.includes("|") &&
      lineIndex + 1 < lines.length &&
      isTableDelimiter(lines[lineIndex + 1])
    ) {
      flushAll();
      const tableRows = [line];
      lineIndex += 2;
      while (lineIndex < lines.length && lines[lineIndex].includes("|")) {
        tableRows.push(lines[lineIndex]);
        lineIndex += 1;
      }
      lineIndex -= 1;
      blocks.push({ items: tableRows, kind: "table", level: 0 });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      blocks.push({
        items: [heading[2].trim()],
        kind: "heading",
        level: heading[1].length,
      });
      continue;
    }
    const quoted = /^>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (unordered) {
      flushParagraph();
      flushQuote();
      if (listKind !== "unordered-list") flushList();
      listKind = "unordered-list";
      list.push(unordered[1]);
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (listKind !== "ordered-list") flushList();
      listKind = "ordered-list";
      list.push(ordered[1]);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line.trim());
  }
  if (code !== null) {
    blocks.push({ items: [code.join("\n")], kind: "code", level: 0 });
  }
  if (latexBlock !== null) {
    paragraph.push([latexBlock.opening, ...latexBlock.lines].join("\n"));
  }
  flushAll();
  return Object.freeze(blocks);
}

export interface MarkdownProps {
  readonly uiLanguage?: UiLanguage;
  readonly className?: string;
  readonly onLoadRemoteImage?: (
    request: RemoteMarkdownImageRequest,
  ) => Promise<RemoteMarkdownImageResult>;
  readonly onSeek?: (seconds: number) => void;
  readonly streaming?: boolean;
  readonly text: string;
  readonly validatedTimeLinks?: readonly ValidatedMarkdownTimeLink[];
  readonly timeLinkGroupPolicy?: "all" | "one-per-block";
}

function splitTableRow(row: string): readonly string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function Markdown({
  uiLanguage,
  className,
  onLoadRemoteImage,
  onSeek,
  streaming = false,
  text,
  validatedTimeLinks = [],
  timeLinkGroupPolicy = "all",
}: MarkdownProps): JSX.Element {
  const lang = uiLanguage ?? "zh-Hans";
  const blocks = parseBlocks(text ?? "");
  // 分组策略只在顶层归一化一次：合并同一块内的连续时间标记后，
  // 渲染器直接消费归一化结果，不再逐层传递策略参数。
  const renderBlockInline = (input: string): ComponentChildren => {
    const normalized = normalizeInlineTimeLinks(
      input,
      validatedTimeLinks,
      timeLinkGroupPolicy,
    );
    return renderInline(
      lang,
      normalized.text,
      normalized.links,
      onSeek,
      onLoadRemoteImage,
    );
  };
  return (
    <div class={className ?? "muzhi-markdown"}>
      {blocks.map((block, index) => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "code") {
          return (
            <pre class="muzhi-markdown__code" key={key}>
              <code>{block.items[0]}</code>
            </pre>
          );
        }
        if (block.kind === "thematic-break") {
          return <hr key={key} />;
        }
        if (block.kind === "latex-block") {
          const source = safeLatexSource(block.items[0]);
          if (source === null) {
            return (
              <pre
                aria-label={t(lang, "markdown.latexUnavailable")}
                class="muzhi-markdown__latex-fallback"
                data-latex-fallback="true"
                key={key}
              >
                <code>{block.items[0]}</code>
              </pre>
            );
          }
          try {
            const markup = katex.renderToString(source, {
              displayMode: true,
              output: "htmlAndMathml",
              strict: "error",
              throwOnError: true,
              trust: false,
            });
            return (
              <div
                aria-label={t(lang, "markdown.mathFormula", { source })}
                class="muzhi-markdown__latex-block"
                data-latex={source}
                data-math-rendered="true"
                dangerouslySetInnerHTML={{ __html: markup }}
                key={key}
                role="math"
              />
            );
          } catch {
            return (
              <pre
                aria-label={t(lang, "markdown.latexFailed")}
                class="muzhi-markdown__latex-fallback"
                data-latex-fallback="true"
                key={key}
              >
                <code>{source}</code>
              </pre>
            );
          }
        }
        if (block.kind === "quote") {
          return (
            <blockquote
              class={
                streaming
                  ? "muzhi-markdown__quote--streaming"
                  : "muzhi-markdown__quote--complete"
              }
              key={key}
            >
              {renderBlockInline(block.items[0])}
            </blockquote>
          );
        }
        if (block.kind === "table") {
          const [header, ...body] = block.items.map(splitTableRow);
          return (
            <table key={key}>
              <thead>
                <tr>
                  {header.map((cell, cellIndex) => (
                    <th key={cellIndex} scope="col">
                      {renderBlockInline(cell)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{renderBlockInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        if (block.kind === "unordered-list") {
          return (
            <ul key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderBlockInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ordered-list") {
          return (
            <ol key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderBlockInline(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.kind === "heading") {
          const content = renderBlockInline(block.items[0]);
          if (block.level <= 1) return <h3 key={key}>{content}</h3>;
          if (block.level === 2) return <h4 key={key}>{content}</h4>;
          if (block.level === 3) return <h5 key={key}>{content}</h5>;
          return <h6 key={key}>{content}</h6>;
        }
        return <p key={key}>{renderBlockInline(block.items[0])}</p>;
      })}
    </div>
  );
}
