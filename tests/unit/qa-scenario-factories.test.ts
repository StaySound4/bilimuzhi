import { describe, expect, it } from "vitest";

import { getQaScenario, getQaScenarioIds } from "../../src/qa/scenarios";
import {
  makeBatchJobView,
  makeBatchSpies,
  makeBatchWorkspaceProps,
} from "../../src/qa/fixtures/batch";
import {
  makeChatMessages,
  makeChatProps,
  makeInsightProps,
  makeSegments,
  makeSessionDrawerProps,
  makeSessions,
  makeSubtitleRows,
  makeTimelineProps,
} from "../../src/qa/fixtures/surfaces";

describe("QA scenario 注册表", () => {
  it("scenario ID 全局唯一且非空", () => {
    const ids = getQaScenarioIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.trim().length).toBeGreaterThan(0);
    }
  });

  it("每个 scenario 提供 surface/state/counts/activeTab/expectedAnchors 与 props 工厂", () => {
    for (const id of getQaScenarioIds()) {
      const scenario = getQaScenario(id);
      expect(scenario, id).toBeDefined();
      expect(scenario!.surface.trim().length, id).toBeGreaterThan(0);
      expect(scenario!.state.trim().length, id).toBeGreaterThan(0);
      expect(scenario!.activeTab.trim().length, id).toBeGreaterThan(0);
      expect(scenario!.counts, id).toBeTruthy();
      expect(scenario!.expectedAnchors.length, id).toBeGreaterThan(0);
      expect(typeof scenario!.buildProps, id).toBe("function");
    }
  });

  it("counts 全部为非负整数且非零计数 key 可读", () => {
    for (const id of getQaScenarioIds()) {
      const scenario = getQaScenario(id)!;
      for (const [key, value] of Object.entries(scenario.counts)) {
        expect(Number.isInteger(value), `${id}.counts.${key}`).toBe(true);
        expect(value >= 0, `${id}.counts.${key}`).toBe(true);
      }
    }
  });

  it("Ticket 03 要求的核心 populated scenario 均已登记", () => {
    const required = [
      "batch-mixed-20",
      "batch-mixed-94",
      "batch-running",
      "batch-partial-failure",
      "batch-completed",
      "timeline-populated-20",
      "chat-populated",
      "chat-streaming",
      "chat-failed",
      "sessions-populated",
      "segments-populated",
      "summary-populated",
    ];
    for (const id of required) {
      expect(getQaScenario(id), id).toBeDefined();
    }
  });
});

describe("batch fixtures", () => {
  it("batch-mixed-20 恰好 20 项且五种状态计数与声明一致", () => {
    const view = makeBatchJobView({
      count: 20,
      distribution: [4, 3, 9, 3, 1],
    });
    expect(view.items).toHaveLength(20);
    const byStatus = new Map<string, number>();
    for (const item of view.items) {
      byStatus.set(item.status, (byStatus.get(item.status) ?? 0) + 1);
    }
    expect(byStatus.get("pending")).toBe(4);
    expect(byStatus.get("running")).toBe(3);
    expect(byStatus.get("succeeded")).toBe(9);
    expect(byStatus.get("failed")).toBe(3);
    expect(byStatus.get("cancelled")).toBe(1);
  });

  it("batch-mixed-94 恰好 94 项", () => {
    const view = makeBatchJobView({
      count: 94,
      distribution: [20, 12, 44, 13, 5],
    });
    expect(view.items).toHaveLength(94);
  });

  it("selected 项标记与选中计数一致", () => {
    const view = makeBatchJobView({
      count: 20,
      selectedCount: 2,
      distribution: [4, 3, 9, 3, 1],
    });
    expect(view.items.filter((item) => item.selected)).toHaveLength(2);
  });

  it("running job 提供 progress 投影", () => {
    const view = makeBatchJobView({ count: 20, jobStatus: "running" });
    expect(view.job.status).toBe("running");
    expect(view.progress).toBeDefined();
  });

  it("spy handler 签名覆盖必需 props（含 onStart/onSelectionChange）", () => {
    const props = makeBatchWorkspaceProps("light", {
      count: 20,
      distribution: [4, 3, 9, 3, 1],
    });
    expect(typeof props.onStart).toBe("function");
    expect(typeof props.onSelectionChange).toBe("function");
    expect(typeof props.onExport).toBe("function");
    expect(typeof props.onFetchByCurrentPage).toBe("function");
    expect(props.hasLists).toBe(true);
    expect(props.layoutStorage).toBeDefined();
    expect(props.view?.items).toHaveLength(20);
  });
});

describe("timeline fixtures", () => {
  it("20+ 行且含 long-text 无空格行", () => {
    const rows = makeSubtitleRows(24);
    expect(rows.length).toBeGreaterThanOrEqual(20);
    const hasLongNoSpace = rows.some((row) => /https:\/\/\S+/.test(row.text));
    expect(hasLongNoSpace).toBe(true);
    const props = makeTimelineProps(rows);
    expect(props.rows).toHaveLength(24);
    expect(typeof props.onSeek).toBe("function");
    expect(typeof props.onExport).toBe("function");
  });
});

describe("chat fixtures", () => {
  it("至少 6 轮消息且含 streaming 与长 Markdown", () => {
    const messages = makeChatMessages();
    expect(messages.length).toBeGreaterThanOrEqual(6);
    expect(messages.some((m) => m.status === "streaming")).toBe(true);
    expect(
      messages.some(
        (m) => m.content.includes("```") || m.content.includes("|"),
      ),
    ).toBe(true);
  });

  it("chat props 覆盖必需 handler 与模型状态", () => {
    const props = makeChatProps();
    expect(typeof props.onSend).toBe("function");
    expect(typeof props.onStop).toBe("function");
    expect(typeof props.onRetryMessage).toBe("function");
    expect(props.threads.length).toBeGreaterThan(0);
    expect(props.taskModelSelection?.state).toBe("ready");
  });
});

describe("sessions fixtures", () => {
  it("构造 4 个会话且 indicators 覆盖 running/unread", () => {
    const sessions = makeSessions();
    expect(sessions).toHaveLength(4);
    const props = makeSessionDrawerProps();
    expect(props.sessions).toHaveLength(4);
    expect(Object.values(props.indicators ?? {}).some((i) => i.running)).toBe(
      true,
    );
    expect(Object.values(props.indicators ?? {}).some((i) => i.unread)).toBe(
      true,
    );
    expect(props.pinnedSessionIds).toContain("qa-session-001");
  });
});

describe("insights fixtures", () => {
  it("segments 6+ 行且含广告段", () => {
    const segments = makeSegments();
    expect(segments.length).toBeGreaterThanOrEqual(6);
    expect(segments.some((s) => s.isAdvertisement)).toBe(true);
  });

  it("summary props 提供长 Markdown 内容", () => {
    const props = makeInsightProps("summary");
    expect(props.content).toContain("#");
    expect(props.content.length).toBeGreaterThan(100);
    expect(props.kind).toBe("summary");
  });
});

describe("QA fixture 无敏感字段", () => {
  it("fixture 数据不包含 Cookie/API Key/令牌/真实凭据模式", () => {
    const textDump = JSON.stringify({
      batch: makeBatchWorkspaceProps("light", { count: 20 }),
      chat: makeChatProps(),
      insights: makeInsightProps("summary"),
      sessions: makeSessions(),
      timeline: makeTimelineProps(makeSubtitleRows(24)),
    });
    const sensitivePatterns = [
      /SESSDATA/i,
      /bili_jct/i,
      /DedeUserID/i,
      /sk-[a-zA-Z0-9]{20,}/,
      /api[_-]?key["']?\s*[:=]\s*["'][a-zA-Z0-9]{16,}/,
      /bearer\s+[a-zA-Z0-9._-]{20,}/i,
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    for (const pattern of sensitivePatterns) {
      expect(textDump.match(pattern), pattern.toString()).toBeNull();
    }
  });

  it("handler 记录调用但不产生外部副作用（spy 可调用且返回 undefined）", () => {
    const { props } = makeBatchSpies();
    expect(props.onCancel()).toBeUndefined();
    expect(props.onStart("direct")).toBeUndefined();
  });
});
