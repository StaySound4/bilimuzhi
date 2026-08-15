/**
 * QA scenario harness 类型（仅 `npm run build:qa` 构建引入，生产 build 不包含）。
 *
 * 规则来源：Ticket 03（.scratch/muzhi-ui-remediation/issues/03-browser-qa-scenarios.md）
 * 与 spec §D12。
 */
import type { AiChatShellProps } from "../ui/ai-chat-shell";

/** 用于断言/定位的锚点描述（role/name 或 CSS 选择器，至少一个命中即通过）。 */
export interface QaAnchor {
  readonly role?: string;
  /** 仅当 role 存在时使用（accessible name，支持正则字符串）。 */
  readonly name?: string | RegExp;
  readonly css?: string;
}

/** 打开交互状态（menu/overlay/dialog）所需的真实点击步骤。 */
export interface QaInteraction {
  /** 触发元素定位（role/name 或 css）；多步时用 steps。 */
  readonly trigger?: QaAnchor;
  /** 交互后等待出现的锚点。 */
  readonly expect: QaAnchor;
  /** 多步点击链（如 More menu → menuitem）；存在时忽略 trigger。 */
  readonly steps?: readonly QaAnchor[];
}

export type QaTheme = "light" | "dark";

export interface QaScenario {
  /** 稳定 scenario ID，如 `batch-mixed-20`。 */
  readonly id: string;
  /** surface 值（与 evidence matrix 的 surface 对齐）。 */
  readonly surface: string;
  /** state 值（与 evidence matrix 的 state 对齐）。 */
  readonly state: string;
  /** scenario 数据证明（manifest scenarioCounts 使用；值必须为非负整数）。 */
  readonly counts: Readonly<Record<string, number>>;
  /** 活动 surface/tab 标识。 */
  readonly activeTab: string;
  /** 默认主题（可被 URL `theme=` 覆盖）。 */
  readonly theme: QaTheme;
  /** 渲染稳定后必须可见的锚点。 */
  readonly expectedAnchors: readonly QaAnchor[];
  /** 需要真实交互才能到达的状态（如 overlay/menu）；执行后 expect 锚点必须可见。 */
  readonly interactions?: readonly QaInteraction[];
  /** 构造 AiChatShell props（真实组件投影，非静态 HTML）。 */
  readonly buildProps: (theme: QaTheme) => AiChatShellProps;
}

/** QA 页面暴露给浏览器 helper 的全局 API。 */
export interface QaHarnessWindowApi {
  readonly scenario: {
    readonly id: string;
    readonly surface: string;
    readonly state: string;
    readonly counts: Readonly<Record<string, number>>;
    readonly activeTab: string;
    readonly theme: QaTheme;
  };
  readonly expectedAnchors: readonly QaAnchor[];
  readonly interactions: readonly QaInteraction[];
  readonly getThemeAttribute: () => {
    readonly name: string;
    readonly value: string;
  };
  /** 读取关键计算样式（canvas/background/text/accent）。 */
  readonly getComputedStyles: () => {
    readonly canvas: string;
    readonly background: string;
    readonly text: string;
    readonly accent: string;
  };
  readonly setTheme: (theme: QaTheme) => void;
  readonly getTheme: () => QaTheme;
}

declare global {
  interface Window {
    __MUZHI_QA__?: QaHarnessWindowApi;
  }
}
