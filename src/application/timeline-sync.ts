/**
 * 时间轴同步状态机（Ticket 08）。
 *
 * 三态：idle（未同步）/ following（跟随采样高亮）/ seeking（seek 进行中，
 * 高亮锁定目标行）。所有用户意图（开/关同步、seek、owner 失效）都递增
 * generation；采样与 seek 响应携带发起时的 generation，落后于当前
 * generation 的事件 fail-close 丢弃——旧采样、旧 seek 响应无法覆盖
 * 最新用户操作（last intent wins）。
 */
export type TimelineSyncPhase = "idle" | "following" | "seeking";

export interface TimelineSyncState {
  readonly phase: TimelineSyncPhase;
  /** 每次用户意图 +1；事件只有 generation 不落后才被采纳。 */
  readonly generation: number;
  /** phase === "seeking" 时的高亮目标（毫秒）。 */
  readonly seekTargetMs?: number;
  /** phase === "following" 时最近一次被接受的采样（毫秒）。 */
  readonly lastSampleMs?: number;
}

export type TimelineSyncEvent =
  | { readonly kind: "toggle-on" }
  | { readonly kind: "toggle-off" }
  | { readonly kind: "owner-lost" }
  | {
      readonly kind: "sample";
      /** 采样发起时的 generation；落后即丢弃。 */
      readonly generation: number;
      readonly timeMs: number;
    }
  | { readonly kind: "seek-intent"; readonly targetMs: number }
  | {
      readonly kind: "seek-resolved";
      /** seek 意图时的 generation；只有仍为最新意图时才采纳。 */
      readonly generation: number;
      readonly timeMs: number;
    }
  | { readonly kind: "seek-failed"; readonly generation: number };

export const TIMELINE_SYNC_INITIAL: TimelineSyncState = Object.freeze({
  generation: 0,
  phase: "idle",
});

export function timelineSyncReducer(
  state: TimelineSyncState,
  event: TimelineSyncEvent,
): TimelineSyncState {
  switch (event.kind) {
    case "toggle-on":
      return { generation: state.generation + 1, phase: "following" };
    case "toggle-off":
    case "owner-lost":
      return { generation: state.generation + 1, phase: "idle" };
    case "sample": {
      // 旧 generation 采样 fail-close；seeking 期间的采样不得覆盖 seek 目标。
      if (event.generation < state.generation) return state;
      if (state.phase !== "following") return state;
      return { ...state, lastSampleMs: event.timeMs };
    }
    case "seek-intent":
      // last intent wins：每次意图递增 generation 并替换目标。
      return {
        generation: state.generation + 1,
        phase: "seeking",
        seekTargetMs: event.targetMs,
      };
    case "seek-resolved": {
      // 只有最新意图的响应才被采纳；旧 seek 响应直接丢弃。
      if (event.generation !== state.generation) return state;
      return {
        generation: state.generation + 1,
        lastSampleMs: event.timeMs,
        phase: "following",
      };
    }
    case "seek-failed": {
      if (event.generation !== state.generation) return state;
      return { generation: state.generation + 1, phase: "following" };
    }
  }
}
