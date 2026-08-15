import { describe, expect, it } from "vitest";
import {
  TIMELINE_SYNC_INITIAL,
  timelineSyncReducer,
  type TimelineSyncEvent,
  type TimelineSyncState,
} from "../../src/application/timeline-sync";

describe("timelineSyncReducer（idle/following/seeking + generation last-intent-wins）", () => {
  it("toggle-on 进入 following 并递增 generation", () => {
    const next = timelineSyncReducer(TIMELINE_SYNC_INITIAL, {
      kind: "toggle-on",
    });
    expect(next.phase).toBe("following");
    expect(next.generation).toBe(1);
  });

  it("toggle-off 回到 idle 并清空采样", () => {
    const following: TimelineSyncState = {
      generation: 3,
      lastSampleMs: 12_000,
      phase: "following",
    };
    const next = timelineSyncReducer(following, { kind: "toggle-off" });
    expect(next).toEqual({ generation: 4, phase: "idle" });
  });

  it("following 接受当前 generation 的采样并更新 lastSampleMs", () => {
    const following: TimelineSyncState = { generation: 2, phase: "following" };
    const next = timelineSyncReducer(following, {
      generation: 2,
      kind: "sample",
      timeMs: 45_000,
    });
    expect(next.phase).toBe("following");
    expect(next.lastSampleMs).toBe(45_000);
  });

  it("旧 generation 的采样 fail-close：丢弃且不改变状态", () => {
    const following: TimelineSyncState = {
      generation: 5,
      lastSampleMs: 10_000,
      phase: "following",
    };
    const next = timelineSyncReducer(following, {
      generation: 3,
      kind: "sample",
      timeMs: 99_000,
    });
    expect(next).toBe(following);
  });

  it("seeking 期间的采样一律丢弃（防旧采样回跳）", () => {
    const seeking: TimelineSyncState = {
      generation: 4,
      phase: "seeking",
      seekTargetMs: 60_000,
    };
    const next = timelineSyncReducer(seeking, {
      generation: 4,
      kind: "sample",
      timeMs: 12_000,
    });
    expect(next).toBe(seeking);
  });

  it("seek-intent 进入 seeking、递增 generation 并记录目标（last intent wins）", () => {
    const following: TimelineSyncState = { generation: 2, phase: "following" };
    const first = timelineSyncReducer(following, {
      kind: "seek-intent",
      targetMs: 30_000,
    });
    expect(first).toEqual({
      generation: 3,
      phase: "seeking",
      seekTargetMs: 30_000,
    });
    // 快速连续点击：第二次意图覆盖第一次
    const second = timelineSyncReducer(first, {
      kind: "seek-intent",
      targetMs: 60_000,
    });
    expect(second).toEqual({
      generation: 4,
      phase: "seeking",
      seekTargetMs: 60_000,
    });
  });

  it("seek-resolved 携带当前 generation 时进入 following 并采纳 seek 结果", () => {
    const seeking: TimelineSyncState = {
      generation: 4,
      phase: "seeking",
      seekTargetMs: 60_000,
    };
    const next = timelineSyncReducer(seeking, {
      generation: 4,
      kind: "seek-resolved",
      timeMs: 60_000,
    });
    expect(next).toEqual({
      generation: 5,
      lastSampleMs: 60_000,
      phase: "following",
    });
  });

  it("旧 seek 响应（generation 落后于最新意图）被丢弃，保持 seeking", () => {
    const seeking: TimelineSyncState = {
      generation: 4,
      phase: "seeking",
      seekTargetMs: 60_000,
    };
    const next = timelineSyncReducer(seeking, {
      generation: 3,
      kind: "seek-resolved",
      timeMs: 30_000,
    });
    expect(next).toBe(seeking);
  });

  it("seek-failed 回到 following，高亮恢复由后续采样决定", () => {
    const seeking: TimelineSyncState = {
      generation: 4,
      phase: "seeking",
      seekTargetMs: 60_000,
    };
    const next = timelineSyncReducer(seeking, {
      generation: 4,
      kind: "seek-failed",
    });
    expect(next).toEqual({ generation: 5, phase: "following" });
  });

  it("旧 seek-failed 响应同样被丢弃", () => {
    const seeking: TimelineSyncState = {
      generation: 6,
      phase: "seeking",
      seekTargetMs: 60_000,
    };
    const next = timelineSyncReducer(seeking, {
      generation: 5,
      kind: "seek-failed",
    });
    expect(next).toBe(seeking);
  });

  it("owner-lost 立即回到 idle 并递增 generation，后续旧采样全部失效", () => {
    const following: TimelineSyncState = {
      generation: 5,
      lastSampleMs: 12_000,
      phase: "following",
    };
    const lost = timelineSyncReducer(following, { kind: "owner-lost" });
    expect(lost).toEqual({ generation: 6, phase: "idle" });
    // owner 失效后，任何旧 generation 采样都不得复活状态
    const stale = timelineSyncReducer(lost, {
      generation: 5,
      kind: "sample",
      timeMs: 12_000,
    });
    expect(stale).toBe(lost);
  });

  it("idle 状态下不接受采样事件（即使 generation 匹配）", () => {
    const next = timelineSyncReducer(TIMELINE_SYNC_INITIAL, {
      generation: 0,
      kind: "sample",
      timeMs: 12_000,
    });
    expect(next).toBe(TIMELINE_SYNC_INITIAL);
  });

  it("owner-lost 后再 toggle-on 可重新开始跟随（generation 继续递增）", () => {
    let state = timelineSyncReducer(TIMELINE_SYNC_INITIAL, {
      kind: "toggle-on",
    });
    state = timelineSyncReducer(state, { kind: "owner-lost" });
    state = timelineSyncReducer(state, { kind: "toggle-on" });
    expect(state).toEqual({ generation: 3, phase: "following" });
  });
});

describe("接线序列（模拟 sidepanel 完整流程，防止 seek 响应 generation 错位）", () => {
  it("toggle-on → 采样 → seek-intent → seek-resolved（意图 generation）→ 继续跟随", () => {
    let state = timelineSyncReducer(TIMELINE_SYNC_INITIAL, {
      kind: "toggle-on",
    });
    // 采样：携带发起时 generation（=1）
    state = timelineSyncReducer(state, {
      generation: 1,
      kind: "sample",
      timeMs: 12_000,
    });
    expect(state.lastSampleMs).toBe(12_000);
    // 行点击 seek：意图递增 generation（1 → 2）；响应必须携带意图后的 generation
    state = timelineSyncReducer(state, {
      kind: "seek-intent",
      targetMs: 60_000,
    });
    const intentGeneration = state.generation;
    expect(intentGeneration).toBe(2);
    // seek 期间旧采样（发起于意图前，gen=1）被丢弃
    state = timelineSyncReducer(state, {
      generation: 1,
      kind: "sample",
      timeMs: 12_000,
    });
    expect(state.phase).toBe("seeking");
    // 播放器 seek 成功：携带意图 generation 才被采纳
    state = timelineSyncReducer(state, {
      generation: intentGeneration,
      kind: "seek-resolved",
      timeMs: 60_000,
    });
    expect(state.phase).toBe("following");
    expect(state.lastSampleMs).toBe(60_000);
    // 之后新采样继续更新高亮
    state = timelineSyncReducer(state, {
      generation: 3,
      kind: "sample",
      timeMs: 61_500,
    });
    expect(state.lastSampleMs).toBe(61_500);
  });

  it("快速连续两次 seek：第一次响应被丢弃、第二次采纳，高亮停在最后目标", () => {
    let state = timelineSyncReducer(TIMELINE_SYNC_INITIAL, {
      kind: "toggle-on",
    });
    state = timelineSyncReducer(state, {
      kind: "seek-intent",
      targetMs: 30_000,
    });
    const firstIntent = state.generation; // 2
    state = timelineSyncReducer(state, {
      kind: "seek-intent",
      targetMs: 60_000,
    });
    const secondIntent = state.generation; // 3
    // 第一次 seek 的响应到达（携带旧意图 generation）：丢弃
    state = timelineSyncReducer(state, {
      generation: firstIntent,
      kind: "seek-resolved",
      timeMs: 30_000,
    });
    expect(state.phase).toBe("seeking");
    expect(state.seekTargetMs).toBe(60_000);
    // 第二次 seek 的响应到达：采纳
    state = timelineSyncReducer(state, {
      generation: secondIntent,
      kind: "seek-resolved",
      timeMs: 60_000,
    });
    expect(state.phase).toBe("following");
    expect(state.lastSampleMs).toBe(60_000);
  });
});

describe("事件代数：全部事件可序列化且类型封闭", () => {
  it("每种事件都能被 reducer 消费且不抛错", () => {
    const events: readonly TimelineSyncEvent[] = [
      { kind: "toggle-on" },
      { kind: "toggle-off" },
      { generation: 0, kind: "sample", timeMs: 1_000 },
      { kind: "seek-intent", targetMs: 2_000 },
      { generation: 0, kind: "seek-resolved", timeMs: 2_000 },
      { generation: 0, kind: "seek-failed" },
      { kind: "owner-lost" },
    ];
    let state = TIMELINE_SYNC_INITIAL;
    for (const event of events) {
      state = timelineSyncReducer(state, event);
    }
    expect(state.phase).toBe("idle");
  });
});
