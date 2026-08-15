/**
 * T-B2 诊断脚本(不控浏览器,纯脚本驱动真实源码):
 * 复现"时间轴同步/定位按钮常驻灰 + 黄框持续"的失效时序。
 *
 * 真实模块:parseBilibiliPageIdentity、PageStaleMonitor、currentPageSync。
 * attemptAutoRebind 判定序列复刻自 sidepanel.tsx(修复前 6360-6436)。
 * 诊断结论(2026-08-15):
 *   场景1:URL 规范化(身份相同)不误报;SPA 中间态丢失 p 参数才 stale。
 *   场景2(根因):新打开标签页加载途中解析失败,旧版 3 次重试(约 4.4s)
 *     耗尽后无恢复路径,且单次 sync 会在 URL 中间态误解析 → 常驻灰/黄框。
 *     修复:稳定等待(syncStableCurrentPage)+ 8 次指数退避(约 48s)。
 *   场景3:规范化瞬态解析成 p=1 → mismatch;URL 恢复后靠页面事件重绑。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageStaleMonitor } from "../../src/infrastructure/page-stale-monitor";
import { createCurrentPageSyncBridge } from "../../src/infrastructure/current-page-sync";
import {
  AUTO_REBIND_MAX_ATTEMPTS,
  AUTO_REBIND_MISMATCH_MAX_ATTEMPTS,
  AUTO_REBIND_RETRY_DELAYS,
} from "../../src/application/auto-rebind-policy";

function createTabsHarness() {
  let activeTab: { id: number; url: string } = { id: 1, url: "" };
  const activated: Array<(tabId: number) => void> = [];
  const urlChanged: Array<(tabId: number, url: string) => void> = [];
  return {
    tabs: {
      async get(tabId: number) {
        if (tabId !== activeTab.id) return {};
        return { url: activeTab.url };
      },
      async getActiveTabId() {
        return activeTab.id;
      },
      onActivated(listener: (tabId: number) => void) {
        activated.push(listener);
        return () => undefined;
      },
      onUrlChanged(listener: (tabId: number, url: string) => void) {
        urlChanged.push(listener);
        return () => undefined;
      },
    },
    fireActivated(tabId: number) {
      activated.forEach((l) => l(tabId));
    },
    fireUrlChanged(url: string) {
      urlChanged.forEach((l) => l(activeTab.id, url));
    },
    setActiveTab(tab: { id: number; url: string }) {
      activeTab = tab;
    },
  };
}

interface ResolverOptions {
  readonly fail?: boolean;
  /** 返回的 page(用于模拟 URL 规范化瞬态解析成 p=1)。 */
  readonly page?: number;
  readonly videoKey?: string;
}

function createResolver(options: ResolverOptions = {}) {
  return {
    resolve: async () => {
      if (options.fail) {
        throw new Error("NETWORK_ERROR: view API unavailable");
      }
      return {
        bvid: "BV1EW411u7th",
        cid: 606,
        page: options.page ?? 6,
        title: "诊断视频",
        canonicalUrl: "https://www.bilibili.com/video/BV1EW411u7th?p=6",
        videoKey: options.videoKey ?? "bvid:BV1EW411u7th:cid:606:p:6",
      };
    },
  };
}

// 复刻 attemptAutoRebind 判定序列(sidepanel.tsx:6360-6436)。
function createAutoRebindReplica(options: {
  readonly currentPageSync: ReturnType<typeof createCurrentPageSyncBridge>;
  readonly subtitleVideoKey: string;
}) {
  const state = {
    attempts: 0,
    inFlight: false,
    mismatch: false,
    rebinds: 0,
    lastFailure: null as null | string,
  };
  const attempt = async (): Promise<void> => {
    if (state.inFlight) return;
    state.inFlight = true;
    try {
      const synced = await options.currentPageSync.sync();
      if (synced.video.videoKey !== options.subtitleVideoKey) {
        // 6377-6392:mismatch → 保持灰,短延迟重试一次
        state.mismatch = true;
        state.attempts += 1;
        state.lastFailure = "mismatch";
        if (state.attempts <= AUTO_REBIND_MISMATCH_MAX_ATTEMPTS) {
          setTimeout(() => void attempt(), 1500);
        }
        return;
      }
      state.mismatch = false;
      state.rebinds += 1;
      state.attempts = 0;
      state.lastFailure = null;
    } catch {
      // 6408-6421:解析失败 → 短退避重试最多 3 次,之后交给下一次页面事件
      state.mismatch = false;
      state.attempts += 1;
      state.lastFailure = "resolve-failed";
      if (state.attempts <= AUTO_REBIND_MAX_ATTEMPTS) {
        const delayMs =
          AUTO_REBIND_RETRY_DELAYS[
            Math.min(state.attempts - 1, AUTO_REBIND_RETRY_DELAYS.length - 1)
          ] ?? 15_000;
        setTimeout(() => void attempt(), delayMs);
      }
    } finally {
      state.inFlight = false;
    }
  };
  return { state, attempt };
}

const SUBTITLE_KEY = "bvid:BV1EW411u7th:cid:606:p:6";

afterEach(() => {
  vi.useRealTimers();
});

describe("T-B2 诊断:页面身份同步状态机", () => {
  it("场景1:分享链接规范化(身份相同)不 stale;短暂丢失 p 参数才会 stale", async () => {
    const harness = createTabsHarness();
    let stale = false;
    harness.setActiveTab({
      id: 1,
      url: "https://www.bilibili.com/video/BV1EW411u7th/?p=6&t=183.73&vd_source=fce69507408a421c246758e442ed4a3b",
    });
    const monitor = new PageStaleMonitor(harness.tabs, (s) => {
      stale = s.stale;
    });
    await monitor.start();
    // B 站规范化:去 vd_source → 去 t → 身份相同 → 不 stale
    for (const url of [
      "https://www.bilibili.com/video/BV1EW411u7th/?p=6&t=183.73",
      "https://www.bilibili.com/video/BV1EW411u7th/?p=6",
    ]) {
      harness.fireUrlChanged(url);
      expect(stale).toBe(false);
    }
    // SPA 中间态丢失 p 参数 → 身份变 p=1 → stale(此后靠重绑恢复)
    harness.fireUrlChanged("https://www.bilibili.com/video/BV1EW411u7th");
    expect(stale).toBe(true);
  });

  it("场景2(修复验证):退避窗口覆盖新 tab 加载期,且失败链可恢复", async () => {
    // (a) 生产退避策略:累计窗口必须覆盖典型页面加载(≥40s),
    //     上限 ≥ 6 次(诊断时第 6 次尝试才成功)。
    const cumulative = AUTO_REBIND_RETRY_DELAYS.reduce((sum, d) => sum + d, 0);
    expect(AUTO_REBIND_MAX_ATTEMPTS).toBeGreaterThanOrEqual(6);
    expect(cumulative).toBeGreaterThanOrEqual(40_000);

    // (b) 小链验证:前 2 次解析失败,第 3 次成功 → 自动恢复(生产退避表驱动)。
    vi.useFakeTimers();
    const harness = createTabsHarness();
    const monitor = new PageStaleMonitor(harness.tabs, () => undefined);
    await monitor.start();
    let calls = 0;
    const resolver = createResolver();
    const originalResolve = resolver.resolve;
    resolver.resolve = async () => {
      calls += 1;
      if (calls <= 2) throw new Error("NETWORK_ERROR: view API unavailable");
      return originalResolve();
    };
    const syncBridge = createCurrentPageSyncBridge(
      harness.tabs,
      resolver as never,
    );
    const replica = createAutoRebindReplica({
      currentPageSync: syncBridge,
      subtitleVideoKey: SUBTITLE_KEY,
    });
    harness.setActiveTab({
      id: 2,
      url: "https://www.bilibili.com/video/BV1EW411u7th?p=6&t=183.73",
    });
    harness.fireActivated(2);
    await replica.attempt();
    expect(replica.state.lastFailure).toBe("resolve-failed");
    // 第 2 次重试(800ms)仍失败,第 3 次(1.5s)成功 → 恢复
    await vi.advanceTimersByTimeAsync(800);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(0);
    expect(replica.state.rebinds).toBe(1);
    expect(replica.state.lastFailure).toBeNull();
    expect(calls).toBe(3);
    expect(replica.state.attempts).toBe(0);
  });

  it("场景3(复现):URL 规范化瞬态解析成 p=1 → mismatch → 灰;恢复 p=6 后自动恢复", async () => {
    vi.useFakeTimers();
    const harness = createTabsHarness();
    const monitor = new PageStaleMonitor(harness.tabs, () => undefined);
    await monitor.start();
    let page = 1; // 瞬态:URL 中间态无 p 参数 → 解析成 p=1
    const resolver = createResolver();
    const originalResolve = resolver.resolve;
    resolver.resolve = async () => {
      if (page === 6) return originalResolve();
      return {
        bvid: "BV1EW411u7th",
        cid: 601,
        page: 1,
        title: "诊断视频",
        canonicalUrl: "https://www.bilibili.com/video/BV1EW411u7th",
        videoKey: "bvid:BV1EW411u7th:cid:601:p:1",
      };
    };
    const syncBridge = createCurrentPageSyncBridge(
      harness.tabs,
      resolver as never,
    );
    const replica = createAutoRebindReplica({
      currentPageSync: syncBridge,
      subtitleVideoKey: SUBTITLE_KEY,
    });
    // 用户已在视频页,stale 由任意一次 URL 瞬态触发
    harness.setActiveTab({
      id: 1,
      url: "https://www.bilibili.com/video/BV1EW411u7th",
    });
    harness.fireUrlChanged("https://www.bilibili.com/video/BV1EW411u7th");
    await replica.attempt();
    // p=1 解析 → mismatch(灰);生产代码仅重试一次(6377-6392)
    expect(replica.state.lastFailure).toBe("mismatch");
    expect(replica.state.rebinds).toBe(0);
    // URL 恢复 ?p=6 → 下一次页面事件 → 重绑成功
    page = 6;
    harness.setActiveTab({
      id: 1,
      url: "https://www.bilibili.com/video/BV1EW411u7th?p=6",
    });
    harness.fireUrlChanged("https://www.bilibili.com/video/BV1EW411u7th?p=6");
    await replica.attempt();
    expect(replica.state.rebinds).toBe(1);
    expect(replica.state.lastFailure).toBeNull();
  });
});
