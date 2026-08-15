/**
 * QA harness 页面组件（仅 QA build 引入）。
 *
 * 职责：
 * 1. 从 URL query 读取 scenario id 与 theme；
 * 2. 用真实 AiChatShell 组件 + 内存 props 投影渲染（非静态 HTML）；
 * 3. 暴露 window.__MUZHI_QA__（scenario proof / theme attribute / computed styles）；
 * 4. 支持运行时切换主题（真实 DOM attribute 与计算样式随之变化）。
 */
import { useEffect, useMemo, useState } from "preact/hooks";

import type { UiLanguage } from "../i18n/languages";
import { setIconLanguage } from "../ui/icons";
import type { AiChatShellProps } from "../ui/ai-chat-shell";
import { AiChatShell } from "../ui/ai-chat-shell";
import { PrimitivesDemo } from "./primitives-demo";
import { getQaScenario, getQaScenarioIds } from "./scenarios";
import type { QaTheme } from "./types";
function readQuery(): URLSearchParams {
  return new URLSearchParams(globalThis.location.search);
}

function resolveTheme(raw: string | null, fallback: QaTheme): QaTheme {
  return raw === "dark" ? "dark" : raw === "light" ? "light" : fallback;
}

/** 读取 .muzhi-app 根元素的主题属性（真实 DOM attribute）。 */
function readThemeAttribute(): { name: string; value: string } {
  const app = document.querySelector(".muzhi-app");
  if (app === null) {
    return { name: "data-theme", value: "" };
  }
  return {
    name: "data-theme",
    value: app.getAttribute("data-theme") ?? "",
  };
}

/** 读取关键计算样式（canvas/background/text/accent）。 */
function readComputedStyles(): {
  canvas: string;
  background: string;
  text: string;
  accent: string;
} {
  const app = document.querySelector(".muzhi-app");
  const fallback = { canvas: "", background: "", text: "", accent: "" };
  if (app === null) {
    return fallback;
  }
  const style = globalThis.getComputedStyle(app);
  const read = (variable: string): string => {
    const value = style.getPropertyValue(variable).trim();
    return value.length > 0
      ? value
      : (fallback[variable as keyof typeof fallback] ?? "");
  };
  return {
    accent: read("--muzhi-accent"),
    background: read("--muzhi-surface-1"),
    canvas: read("--muzhi-canvas"),
    text: read("--muzhi-text"),
  };
}

export function QaHarness() {
  const query = useMemo(readQuery, []);
  const scenarioId = query.get("scenario") ?? "";
  const scenario = getQaScenario(scenarioId);
  const [theme, setTheme] = useState<QaTheme>(() =>
    resolveTheme(query.get("theme"), scenario?.theme ?? "light"),
  );

  useEffect(() => {
    if (scenario === undefined) {
      return;
    }
    const api = {
      expectedAnchors: scenario.expectedAnchors,
      interactions: scenario.interactions ?? [],
      getComputedStyles: readComputedStyles,
      getTheme: () => theme,
      getThemeAttribute: readThemeAttribute,
      scenario: {
        activeTab: scenario.activeTab,
        counts: scenario.counts,
        id: scenario.id,
        state: scenario.state,
        surface: scenario.surface,
        theme,
      },
      setTheme: (next: QaTheme) => {
        setTheme(next);
      },
    };
    (globalThis as unknown as { __MUZHI_QA__?: typeof api }).__MUZHI_QA__ = api;
    return () => {
      delete (globalThis as unknown as { __MUZHI_QA__?: typeof api })
        .__MUZHI_QA__;
    };
  }, [scenario, theme]);

  if (scenario === undefined) {
    const available = Array.from(getQaScenarioIds());
    return (
      <div class="muzhi-app" data-theme={theme}>
        <main class="muzhi-shell" aria-label="Bilimuzhi QA">
          <h1>未知 QA scenario：{scenarioId}</h1>
          <p>可用：</p>
          <ul>
            {available.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </main>
      </div>
    );
  }
  if (scenario.id === "primitives-demo") {
    return (
      <div class="muzhi-app" data-theme={theme}>
        <PrimitivesDemo />
      </div>
    );
  }

  const langParam = query.get("lang") ?? "zh-Hans";
  const resolvedLang: UiLanguage =
    langParam === "zh-Hant" || langParam === "en" || langParam === "ja"
      ? langParam
      : "zh-Hans";
  setIconLanguage(resolvedLang);
  // 四语言验收：深度覆盖 fixture 中全部 uiLanguage（子组件各自持有）。
  const localized = applyLanguage(
    scenario.buildProps(theme),
    resolvedLang,
  ) as AiChatShellProps;
  return <AiChatShell {...localized} uiLanguage={resolvedLang} />;
}

/** 递归把 props 树中所有 `uiLanguage` 字段替换为目标语言（QA 专用）。 */
function applyLanguage(value: unknown, lang: UiLanguage): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => applyLanguage(item, lang));
  }
  if (typeof value === "object" && value !== null) {
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      next[key] =
        key === "uiLanguage" && typeof child === "string"
          ? lang
          : applyLanguage(child, lang);
    }
    return next;
  }
  return value;
}
