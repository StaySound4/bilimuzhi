import type { SubtitleRow } from "../../domain";
import type { UiLanguage } from "../../i18n/languages";
import type { SubtitleContextPlan } from "./context-plan";
import { defaultPromptFor, type PromptTaskKind } from "./prompt-defaults";
import { PROMPT_LANGUAGE_PACKS } from "./prompt-language-pack";
import type { AiPromptMessage } from "./provider-contract";

export interface PromptVideoMeta {
  readonly bvid: string;
  readonly durationSec: number | null;
  readonly title: string;
}

export interface BuildPromptInput {
  readonly contextPlan: SubtitleContextPlan;
  readonly kind: PromptTaskKind;
  readonly meta: PromptVideoMeta;
  /** Conversation turns, chat only, oldest first. */
  readonly history?: readonly {
    readonly content: string;
    readonly role: "assistant" | "user";
  }[];
  readonly question?: string;
  readonly rows: readonly SubtitleRow[];

  /** The user-owned policy. Falls back to this mode's default when blank. */
  readonly userPrompt?: string | null;
  /**
   * AI 输出默认语言（docs/i18n-spec.md §5）：per-mode 弱约束默认值。
   * 缺省回退 zh-Hans。内核提示词整体使用该语言书写；
   * 用户在本轮明确要求其他语言时以用户要求为准。
   */
  readonly outputLanguage?: UiLanguage;
}

function safeText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function escapeReference(value: string): string {
  return value.replaceAll(
    "</untrusted_subtitle_reference>",
    "&lt;/untrusted_subtitle_reference>",
  );
}

function formatClock(totalMs: number): string {
  const seconds = Math.max(0, Math.floor(totalMs / 1_000));
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3_600))}:${pad(
    Math.floor((seconds % 3_600) / 60),
  )}:${pad(seconds % 60)}`;
}

/**
 * Tells the model where the subtitle timeline actually starts, bends and ends.
 * Without it models reliably summarise only the first third of a long video.
 */
export function coverageBlock(rows: readonly SubtitleRow[]): string {
  if (rows.length === 0) return "";
  const first = rows[0];
  const middle = rows[Math.floor(rows.length / 2)];
  const last = rows[rows.length - 1];
  return PROMPT_LANGUAGE_PACKS["zh-Hans"].coverageBlock({
    count: rows.length,
    firstClock: formatClock(first.startMs),
    lastClock: formatClock(last.startMs),
    middleClock: formatClock(middle.startMs),
  });
}

function subtitleBlock(contextPlan: SubtitleContextPlan): string {
  const reference = contextPlan.chunks
    .map((chunk) => escapeReference(chunk.text))
    .join("\n\n");
  return `<untrusted_subtitle_reference>\n${reference}\n</untrusted_subtitle_reference>`;
}

function historyBlock(input: BuildPromptInput): readonly AiPromptMessage[] {
  return (input.history ?? []).map((turn) =>
    Object.freeze({ content: turn.content, role: turn.role }),
  );
}

/**
 * Composes the trusted system layer, the user-owned policy, the built-in rules
 * and the untrusted subtitle reference into one provider request.
 *
 * 内核提示词（角色行、内置规则、元数据、覆盖提示）整体使用
 * 输出默认语言书写（PROMPT_LANGUAGE_PACKS），让模型稳定跟随目标语言；
 * 字幕参考永远保持原文，不随语言包翻译。
 */
export function buildTaskPrompt(
  input: BuildPromptInput,
): readonly AiPromptMessage[] {
  const pack = PROMPT_LANGUAGE_PACKS[input.outputLanguage ?? "zh-Hans"];
  // Segmentation is a fixed application protocol. Unlike summary and chat it
  // intentionally has no user-controlled prompt layer: allowing arbitrary
  // text here could weaken the line-owned schema and advertisement rules.
  const userPolicy =
    input.kind === "segments"
      ? ""
      : safeText(input.userPrompt) ||
        defaultPromptFor(input.kind, input.outputLanguage ?? "zh-Hans");
  const roleLine = pack.roleLine[input.kind];
  const builtIn =
    input.kind === "segments"
      ? pack.segmentsFormatRule
      : `${pack.timeLinkRule}${
          input.kind === "chat" ? `\n${pack.chatLinkDensityRule}` : ""
        }${
          input.kind === "summary" ? `\n${pack.summaryTimeLinkObligation}` : ""
        }`;

  const taskContract = [
    roleLine,
    builtIn,
    input.outputLanguage === undefined
      ? ""
      : pack.outputLanguageRule(pack.nativeName),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");

  const question = safeText(input.question);
  const currentRequest =
    input.kind === "chat"
      ? `${pack.currentQuestionLabel}\n${question}`
      : `${pack.currentRequestLabel}\n${question || pack.startOutputPrompt}`;
  const userMessage =
    input.outputLanguage === undefined
      ? currentRequest
      : `${currentRequest}\n\n${pack.userTurnLanguageNote}`;
  const trustedMetadata = [
    pack.coverageBlock({
      count: input.rows.length,
      firstClock:
        input.rows.length > 0 ? formatClock(input.rows[0].startMs) : "00:00:00",
      lastClock:
        input.rows.length > 0
          ? formatClock(input.rows[input.rows.length - 1].startMs)
          : "00:00:00",
      middleClock:
        input.rows.length > 0
          ? formatClock(input.rows[Math.floor(input.rows.length / 2)].startMs)
          : "00:00:00",
    }),
    pack.metaBlock({
      bvid: input.meta.bvid,
      clockLimit:
        input.meta.durationSec !== null && input.meta.durationSec > 0
          ? formatClock(Math.round(input.meta.durationSec) * 1_000)
          : null,
      durationHuman:
        input.meta.durationSec !== null && input.meta.durationSec > 0
          ? (() => {
              const total = Math.max(0, Math.round(input.meta.durationSec));
              const hours = Math.floor(total / 3_600);
              const minutes = Math.floor((total % 3_600) / 60);
              return hours > 0
                ? `约 ${hours} 小时 ${minutes} 分钟`
                : `约 ${minutes} 分钟`;
            })()
          : null,
      title: input.meta.title,
    }),
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");

  return Object.freeze([
    Object.freeze({ content: pack.systemRules, role: "system" as const }),
    ...(input.outputLanguage === undefined
      ? []
      : [
          Object.freeze({
            content: pack.outputLanguageRule(pack.nativeName),
            role: "system" as const,
          }),
        ]),
    Object.freeze({ content: taskContract, role: "system" as const }),
    ...(userPolicy.length > 0
      ? [
          Object.freeze({
            content: `${pack.userPolicyHeader}\n${userPolicy}`,
            role: "system" as const,
          }),
        ]
      : []),
    ...historyBlock(input),
    Object.freeze({ content: userMessage, role: "user" as const }),
    Object.freeze({ content: trustedMetadata, role: "system" as const }),
    Object.freeze({
      content: subtitleBlock(input.contextPlan),
      role: "system" as const,
    }),
    ...(input.outputLanguage === undefined
      ? []
      : [
          Object.freeze({
            content: pack.finalLanguageReminder,
            role: "system" as const,
          }),
        ]),
  ]);
}
