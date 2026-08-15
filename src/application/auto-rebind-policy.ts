/**
 * T-B2:stale 自动重绑的退避策略(生产代码与诊断/回归测试共用同一份,
 * 避免测试复刻逻辑漂移)。
 *
 * 窗口约 48s,覆盖新打开标签页的加载期与 B 站 URL 规范化
 * (长地址→裸 BV→?p=N)过渡;mismatch 重试窗口更短,仅在 URL
 * 瞬态误报时兜底。
 */
export const AUTO_REBIND_RETRY_DELAYS = Object.freeze([
  800, 1_500, 2_500, 4_000, 6_000, 8_000, 10_000, 15_000,
]);

export const AUTO_REBIND_MAX_ATTEMPTS = AUTO_REBIND_RETRY_DELAYS.length;

export const AUTO_REBIND_MISMATCH_MAX_ATTEMPTS = 4;
