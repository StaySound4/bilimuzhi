import type { ChromeWorkspaceStorageArea } from "./chrome-workspace-state-store";

export interface ChromeSidePanelTab {
  readonly url?: string;
}

export type ChromeTabActivationListener = (tabId: number) => void;
export type ChromeTabUrlChangeListener = (tabId: number, url: string) => void;

export interface ChromeSidePanelTabsApi {
  get(tabId: number): Promise<ChromeSidePanelTab>;
  getActiveTabId(): Promise<number>;
  onActivated(listener: ChromeTabActivationListener): () => void;
  onUrlChanged(listener: ChromeTabUrlChangeListener): () => void;
}

export interface ChromeSidePanelApi {
  readonly storage: ChromeWorkspaceStorageArea;
  readonly tabs: ChromeSidePanelTabsApi;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unavailable(): Error {
  return new Error("Chrome Side Panel APIs are unavailable");
}

interface ChromeEventApi {
  addListener(listener: (...args: unknown[]) => void): void;
  removeListener(listener: (...args: unknown[]) => void): void;
  readonly target: Record<string, unknown>;
}

function getEventApi(value: unknown): ChromeEventApi | null {
  if (!isObject(value)) return null;
  const addListener = Reflect.get(value, "addListener") as unknown;
  const removeListener = Reflect.get(value, "removeListener") as unknown;
  if (
    typeof addListener !== "function" ||
    typeof removeListener !== "function"
  ) {
    return null;
  }
  return Object.freeze({
    addListener: addListener as ChromeEventApi["addListener"],
    removeListener: removeListener as ChromeEventApi["removeListener"],
    target: value,
  });
}

export function createChromeSidePanelApi(
  chromeValue: unknown,
): ChromeSidePanelApi {
  if (!isObject(chromeValue)) {
    throw unavailable();
  }
  const storage = Reflect.get(chromeValue, "storage") as unknown;
  const tabs = Reflect.get(chromeValue, "tabs") as unknown;
  const local = isObject(storage)
    ? (Reflect.get(storage, "local") as unknown)
    : null;
  const storageGet = isObject(local)
    ? (Reflect.get(local, "get") as unknown)
    : null;
  const storageSet = isObject(local)
    ? (Reflect.get(local, "set") as unknown)
    : null;
  const tabsGet = isObject(tabs) ? (Reflect.get(tabs, "get") as unknown) : null;
  const tabsQuery = isObject(tabs)
    ? (Reflect.get(tabs, "query") as unknown)
    : null;
  const onActivated = isObject(tabs)
    ? getEventApi(Reflect.get(tabs, "onActivated"))
    : null;
  const onUpdated = isObject(tabs)
    ? getEventApi(Reflect.get(tabs, "onUpdated"))
    : null;

  if (
    !isObject(local) ||
    !isObject(tabs) ||
    typeof storageGet !== "function" ||
    typeof storageSet !== "function" ||
    typeof tabsGet !== "function" ||
    typeof tabsQuery !== "function" ||
    onActivated === null ||
    onUpdated === null
  ) {
    throw unavailable();
  }

  return Object.freeze({
    storage: Object.freeze({
      async get(key: string): Promise<Record<string, unknown>> {
        const result: unknown = await Reflect.apply(storageGet, local, [key]);
        if (!isObject(result)) {
          throw new Error("Chrome local storage returned an invalid result");
        }
        return Object.freeze({ ...result });
      },
      async set(items: Record<string, unknown>): Promise<void> {
        await Reflect.apply(storageSet, local, [items]);
      },
    }),
    tabs: Object.freeze({
      async get(tabId: number): Promise<ChromeSidePanelTab> {
        if (!Number.isSafeInteger(tabId) || tabId <= 0) {
          throw new Error("The browser tab identity is invalid");
        }
        const result: unknown = await Reflect.apply(tabsGet, tabs, [tabId]);
        if (
          !isObject(result) ||
          (result.url !== undefined && typeof result.url !== "string")
        ) {
          throw new Error("The browser tab is invalid");
        }
        return Object.freeze(
          result.url === undefined ? {} : { url: result.url },
        );
      },
      async getActiveTabId(): Promise<number> {
        const result: unknown = await Reflect.apply(tabsQuery, tabs, [
          { active: true, lastFocusedWindow: true },
        ]);
        const activeTab = Array.isArray(result) ? result[0] : null;
        const tabId = isObject(activeTab) ? activeTab.id : null;
        if (!Number.isSafeInteger(tabId) || Number(tabId) <= 0) {
          throw new Error("The active browser tab is unavailable");
        }
        return Number(tabId);
      },
      onActivated(listener: ChromeTabActivationListener): () => void {
        const wrapped = (value: unknown): void => {
          const tabId = isObject(value) ? value.tabId : null;
          if (Number.isSafeInteger(tabId) && Number(tabId) > 0) {
            listener(Number(tabId));
          }
        };
        Reflect.apply(onActivated.addListener, onActivated.target, [wrapped]);
        return () =>
          Reflect.apply(onActivated.removeListener, onActivated.target, [
            wrapped,
          ]);
      },
      onUrlChanged(listener: ChromeTabUrlChangeListener): () => void {
        const wrapped = (tabId: unknown, change: unknown): void => {
          const url = isObject(change) ? change.url : null;
          if (
            Number.isSafeInteger(tabId) &&
            Number(tabId) > 0 &&
            typeof url === "string"
          ) {
            listener(Number(tabId), url);
          }
        };
        Reflect.apply(onUpdated.addListener, onUpdated.target, [wrapped]);
        return () =>
          Reflect.apply(onUpdated.removeListener, onUpdated.target, [wrapped]);
      },
    }),
  });
}
