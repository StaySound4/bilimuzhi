import type {
  ChromeSidePanelTabsApi,
  ChromeTabActivationListener,
  ChromeTabUrlChangeListener,
} from "./chrome-sidepanel-api";
import {
  isSameBilibiliPage,
  parseBilibiliPageIdentity,
  type BilibiliPageIdentity,
} from "./bilibili-page-identity";

export type PageStaleReason = "tab-activated" | "url-changed" | null;

export interface PageStaleState {
  readonly activeTabId: number | null;
  readonly revision: number;
  readonly stale: boolean;
  readonly reason: PageStaleReason;
}

export type PageStaleListener = (state: PageStaleState) => void;

function freezeState(
  activeTabId: number | null,
  revision: number,
  stale: boolean,
  reason: PageStaleReason,
): PageStaleState {
  return Object.freeze({ activeTabId, reason, revision, stale });
}

export class PageStaleMonitor {
  private state = freezeState(null, 0, false, null);
  private pageIdentity: BilibiliPageIdentity | null = null;
  private stopActivated: (() => void) | null = null;
  private stopUrlChanged: (() => void) | null = null;

  constructor(
    private readonly tabs: ChromeSidePanelTabsApi,
    private readonly onChange: PageStaleListener,
  ) {}

  snapshot(): PageStaleState {
    return this.state;
  }

  async start(): Promise<PageStaleState> {
    this.stop();
    const activeTabId = await this.tabs.getActiveTabId();
    const activeTab = await this.tabs.get(activeTabId);
    this.pageIdentity = parseBilibiliPageIdentity(activeTab.url);
    this.state = freezeState(activeTabId, this.state.revision, false, null);
    const onActivated: ChromeTabActivationListener = (tabId) => {
      if (tabId === this.state.activeTabId) return;
      this.pageIdentity = null;
      this.publish(tabId, true, "tab-activated");
    };
    const onUrlChanged: ChromeTabUrlChangeListener = (tabId, url) => {
      if (tabId !== this.state.activeTabId) return;
      const nextIdentity = parseBilibiliPageIdentity(url);
      if (isSameBilibiliPage(this.pageIdentity, nextIdentity)) {
        this.pageIdentity = nextIdentity;
        return;
      }
      this.pageIdentity = nextIdentity;
      if (this.state.stale) return;
      this.publish(tabId, true, "url-changed");
    };
    this.stopActivated = this.tabs.onActivated(onActivated);
    this.stopUrlChanged = this.tabs.onUrlChanged(onUrlChanged);
    return this.state;
  }

  markSynchronized(tabId: number, url?: string): PageStaleState {
    if (tabId !== this.state.activeTabId || !this.state.stale)
      return this.state;
    if (url !== undefined) {
      this.pageIdentity = parseBilibiliPageIdentity(url);
    }
    this.publish(tabId, false, null);
    return this.state;
  }

  stop(): void {
    this.stopActivated?.();
    this.stopUrlChanged?.();
    this.stopActivated = null;
    this.stopUrlChanged = null;
  }

  private publish(
    activeTabId: number,
    stale: boolean,
    reason: PageStaleReason,
  ): void {
    this.state = freezeState(
      activeTabId,
      this.state.revision + 1,
      stale,
      reason,
    );
    this.onChange(this.state);
  }
}
