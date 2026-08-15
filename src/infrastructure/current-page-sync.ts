import type { CanonicalVideoResolver } from "../application/video-gateway";
import type { VideoRef } from "../domain";
import type { ChromeSidePanelTabsApi } from "./chrome-sidepanel-api";
import { settlePageUrl } from "./page-url-settle";
export interface CurrentPageSyncResult {
  readonly tabId: number;
  readonly video: VideoRef;
}

export interface CurrentPageSyncBridge {
  sync(): Promise<CurrentPageSyncResult>;
}

export function createCurrentPageSyncBridge(
  tabs: ChromeSidePanelTabsApi,
  resolver: CanonicalVideoResolver,
): CurrentPageSyncBridge {
  return Object.freeze({
    async sync(): Promise<CurrentPageSyncResult> {
      const tabId = await tabs.getActiveTabId();
      const video = await resolver.resolve({ kind: "current-tab", tabId });
      return Object.freeze({ tabId, video });
    },
  });
}

/**
 * v16 D6：稳定等待后同步当前页。settle 期间每次读取都做精确解析，
 * 连续两次 canonicalUrl 相同才消费；非视频页解析失败直接向上抛。
 */
export async function syncStableCurrentPage(
  bridge: CurrentPageSyncBridge,
  settle: (
    getUrl: () => Promise<string>,
    options?: { readonly intervalMs?: number; readonly maxWaitMs?: number },
  ) => Promise<string> = settlePageUrl,
): Promise<CurrentPageSyncResult> {
  let latest: CurrentPageSyncResult | null = null;
  await settle(async () => {
    latest = await bridge.sync();
    return latest.video.canonicalUrl;
  });
  if (latest === null) throw new Error("The current page never resolved");
  return latest;
}
