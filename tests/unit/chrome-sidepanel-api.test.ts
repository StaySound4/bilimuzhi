import { describe, expect, it, vi } from "vitest";

import { createChromeSidePanelApi } from "../../src/infrastructure/chrome-sidepanel-api";

describe("createChromeSidePanelApi", () => {
  it("adapts local storage and active tab calls with their original receivers", async () => {
    const local = {
      get: vi.fn(function (this: unknown, key: string) {
        expect(this).toBe(local);
        return Promise.resolve({ [key]: { version: 1 } });
      }),
      set: vi.fn(function (this: unknown, items: Record<string, unknown>) {
        expect(this).toBe(local);
        expect(items).toEqual({ saved: true });
        return Promise.resolve();
      }),
    };
    const tabs = {
      get: vi.fn(function (this: unknown, tabId: number) {
        expect(this).toBe(tabs);
        return Promise.resolve({ id: tabId, url: "https://example.com" });
      }),
      query: vi.fn(function (this: unknown, query: Record<string, unknown>) {
        expect(this).toBe(tabs);
        expect(query).toEqual({ active: true, lastFocusedWindow: true });
        return Promise.resolve([{ id: 17 }]);
      }),
      onActivated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };
    const api = createChromeSidePanelApi({ storage: { local }, tabs });

    await expect(api.storage.get("muzhi.workspace.v1")).resolves.toEqual({
      "muzhi.workspace.v1": { version: 1 },
    });
    await api.storage.set({ saved: true });
    await expect(api.tabs.get(17)).resolves.toEqual({
      url: "https://example.com",
    });
    await expect(api.tabs.getActiveTabId()).resolves.toBe(17);
  });

  it("adapts active-tab and URL subscriptions without publishing malformed events", () => {
    let activatedListener: ((value: unknown) => void) | undefined;
    let updatedListener:
      ((tabId: unknown, change: unknown) => void) | undefined;
    const onActivated = {
      addListener: vi.fn(function (this: unknown, listener) {
        expect(this).toBe(onActivated);
        activatedListener = listener;
      }),
      removeListener: vi.fn(function (this: unknown) {
        expect(this).toBe(onActivated);
      }),
    };
    const onUpdated = {
      addListener: vi.fn(function (this: unknown, listener) {
        expect(this).toBe(onUpdated);
        updatedListener = listener;
      }),
      removeListener: vi.fn(function (this: unknown) {
        expect(this).toBe(onUpdated);
      }),
    };
    const api = createChromeSidePanelApi({
      storage: { local: { get: async () => ({}), set: async () => undefined } },
      tabs: {
        get: async () => ({}),
        onActivated,
        onUpdated,
        query: async () => [{ id: 17 }],
      },
    });
    const activated = vi.fn();
    const urlChanged = vi.fn();
    const stopActivated = api.tabs.onActivated(activated);
    const stopUpdated = api.tabs.onUrlChanged(urlChanged);

    activatedListener?.({ tabId: 17 });
    activatedListener?.({ tabId: 0 });
    updatedListener?.(17, {
      url: "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    });
    updatedListener?.(17, { status: "loading" });
    expect(activated).toHaveBeenCalledExactlyOnceWith(17);
    expect(urlChanged).toHaveBeenCalledExactlyOnceWith(
      17,
      "https://www.bilibili.com/video/BV1Q541167Qg?p=2",
    );
    stopActivated();
    stopUpdated();
    expect(onActivated.removeListener).toHaveBeenCalledOnce();
    expect(onUpdated.removeListener).toHaveBeenCalledOnce();
  });

  it.each([null, {}, { storage: { local: {} }, tabs: {} }])(
    "rejects unavailable Chrome APIs %#",
    (chromeValue) => {
      expect(() => createChromeSidePanelApi(chromeValue)).toThrow(
        "Chrome Side Panel APIs are unavailable",
      );
    },
  );

  it("rejects an invalid active tab identity", async () => {
    const api = createChromeSidePanelApi({
      storage: {
        local: {
          get: async () => ({}),
          set: async () => undefined,
        },
      },
      tabs: {
        get: async () => ({}),
        onActivated: {
          addListener: () => undefined,
          removeListener: () => undefined,
        },
        onUpdated: {
          addListener: () => undefined,
          removeListener: () => undefined,
        },
        query: async () => [{ id: 0 }],
      },
    });

    await expect(api.tabs.getActiveTabId()).rejects.toThrow(
      "The active browser tab is unavailable",
    );
  });
});
