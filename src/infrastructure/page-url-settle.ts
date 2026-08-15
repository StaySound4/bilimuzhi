/**
 * URL 稳定等待（v16 D6 冻结原型）：
 * B 站视频页打开时 URL 依次经过长地址中间态 → 裸 BV → `/?p=22` 稳定态；
 * 消费前必须等待连续两次读取相同，避免在中间态误解析（裸 BV 无 `p` 时误绑 P1）。
 * 读取失败（非视频页等）直接向上抛，由调用方映射为页面错误文案。
 */

export interface SettlePageUrlOptions {
  /** 轮询间隔（默认 300ms）。 */
  readonly intervalMs?: number;
  /** 稳定等待上限（默认 3000ms）；超时返回最后一次读取值。 */
  readonly maxWaitMs?: number;
}

export async function settlePageUrl(
  getUrl: () => Promise<string>,
  options: SettlePageUrlOptions = {},
): Promise<string> {
  const intervalMs = options.intervalMs ?? 300;
  const maxWaitMs = options.maxWaitMs ?? 3_000;
  let previous = await getUrl();
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    await sleep(intervalMs);
    if (Date.now() > deadline) return previous;
    const current = await getUrl();
    if (current === previous) return current;
    previous = current;
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
