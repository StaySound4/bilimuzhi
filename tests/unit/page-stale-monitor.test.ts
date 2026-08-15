import { describe, expect, it, vi } from "vitest";

import type {
  ChromeSidePanelTabsApi,
  ChromeTabActivationListener,
  ChromeTabUrlChangeListener,
} from "../../src/infrastructure/chrome-sidepanel-api";
import { PageStaleMonitor } from "../../src/infrastructure/page-stale-monitor";

function createTabs(initialUrl?: string): {
  readonly tabs: ChromeSidePanelTabsApi;
  emitActivated(tabId: number): void;
  emitUrlChanged(tabId: number, url: string): void;
} {
  let onActivated: ChromeTabActivationListener | undefined;
  let onUrlChanged: ChromeTabUrlChangeListener | undefined;
  return {
    emitActivated(tabId) {
      onActivated?.(tabId);
    },
    emitUrlChanged(tabId, url) {
      onUrlChanged?.(tabId, url);
    },
    tabs: {
      get: async () => (initialUrl === undefined ? {} : { url: initialUrl }),
      getActiveTabId: async () => 17,
      onActivated(listener) {
        onActivated = listener;
        return () => {
          onActivated = undefined;
        };
      },
      onUrlChanged(listener) {
        onUrlChanged = listener;
        return () => {
          onUrlChanged = undefined;
        };
      },
    },
  };
}

describe("PageStaleMonitor", () => {
  it("ignores cosmetic Bilibili URL rewrites but marks a real part change stale", async () => {
    const source = createTabs(
      "https://www.bilibili.com/video/BV1zt4y1z72D?vd_source=test&spm_id_from=333.788.videopod.episodes&p=7",
    );
    const changes = vi.fn();
    const monitor = new PageStaleMonitor(source.tabs, changes);

    await monitor.start();
    source.emitUrlChanged(
      17,
      "https://www.bilibili.com/video/BV1zt4y1z72D/?p=7",
    );

    expect(monitor.snapshot()).toEqual({
      activeTabId: 17,
      reason: null,
      revision: 0,
      stale: false,
    });
    expect(changes).not.toHaveBeenCalled();

    source.emitUrlChanged(
      17,
      "https://www.bilibili.com/video/BV1zt4y1z72D?p=8",
    );
    expect(monitor.snapshot()).toEqual({
      activeTabId: 17,
      reason: "url-changed",
      revision: 1,
      stale: true,
    });
    expect(changes).toHaveBeenCalledOnce();
  });

  it("marks only tab or URL changes stale and never replaces the workspace itself", async () => {
    const source = createTabs();
    const changes = vi.fn();
    const monitor = new PageStaleMonitor(source.tabs, changes);

    await expect(monitor.start()).resolves.toEqual({
      activeTabId: 17,
      reason: null,
      revision: 0,
      stale: false,
    });
    source.emitUrlChanged(
      18,
      "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    );
    expect(changes).not.toHaveBeenCalled();
    source.emitUrlChanged(
      17,
      "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    );
    expect(monitor.snapshot()).toEqual({
      activeTabId: 17,
      reason: "url-changed",
      revision: 1,
      stale: true,
    });
    source.emitActivated(18);
    expect(monitor.snapshot()).toEqual({
      activeTabId: 18,
      reason: "tab-activated",
      revision: 2,
      stale: true,
    });
    expect(monitor.markSynchronized(17)).toMatchObject({ stale: true });
    expect(monitor.markSynchronized(18)).toEqual({
      activeTabId: 18,
      reason: null,
      revision: 3,
      stale: false,
    });
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it("unsubscribes both Chrome event listeners when stopped", async () => {
    const source = createTabs();
    const monitor = new PageStaleMonitor(source.tabs, vi.fn());
    await monitor.start();
    monitor.stop();
    source.emitActivated(18);
    source.emitUrlChanged(
      17,
      "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    );
    expect(monitor.snapshot()).toMatchObject({ activeTabId: 17, stale: false });
  });
});
