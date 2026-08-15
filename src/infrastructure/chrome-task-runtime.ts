import {
  createGenerationExecutorRegistry,
  reconcileGenerationTasksForBrowserSession,
  type GenerationRunReconciliationStore,
  type MutableGenerationExecutorRegistry,
} from "../application/task";
import type { GenerationRun } from "../domain";

const BROWSER_SESSION_STORAGE_KEY = "muzhi.browser-session.v1";

export interface ChromeTaskRuntimeDependencies {
  readonly createBrowserSessionId: () => string;
}

interface ChromeSessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    !value.includes("://") &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function readSessionStorage(chromeValue: unknown): ChromeSessionStorageArea {
  if (!isRecord(chromeValue))
    throw new Error("Chrome task APIs are unavailable");
  const storage = Reflect.get(chromeValue, "storage") as unknown;
  const session = isRecord(storage)
    ? (Reflect.get(storage, "session") as unknown)
    : null;
  const get = isRecord(session)
    ? (Reflect.get(session, "get") as unknown)
    : null;
  const set = isRecord(session)
    ? (Reflect.get(session, "set") as unknown)
    : null;
  if (
    session === null ||
    typeof get !== "function" ||
    typeof set !== "function"
  ) {
    throw new Error("Chrome session storage is unavailable");
  }
  return Object.freeze({
    async get(key: string): Promise<Record<string, unknown>> {
      const result = await Reflect.apply(get, session, [key]);
      if (!isRecord(result))
        throw new Error("Chrome session storage is invalid");
      return Object.freeze({ ...result });
    },
    async set(items: Record<string, unknown>): Promise<void> {
      await Reflect.apply(set, session, [items]);
    },
  });
}

export interface ChromeTaskRuntime {
  readonly executors: MutableGenerationExecutorRegistry;
  getBrowserSessionId(): Promise<string>;
  reconcileAfterBackgroundStart(
    store: GenerationRunReconciliationStore,
    now: number,
  ): Promise<readonly GenerationRun[]>;
}

export function createChromeTaskRuntime(
  chromeValue: unknown,
  dependencies: ChromeTaskRuntimeDependencies,
): ChromeTaskRuntime {
  const storage = readSessionStorage(chromeValue);
  const executors = createGenerationExecutorRegistry();

  async function getBrowserSessionId(): Promise<string> {
    const stored = await storage.get(BROWSER_SESSION_STORAGE_KEY);
    const existing = stored[BROWSER_SESSION_STORAGE_KEY];
    if (isSafeIdentifier(existing)) return existing;
    const next = dependencies.createBrowserSessionId();
    if (!isSafeIdentifier(next)) {
      throw new Error("The generated browser session identity is invalid");
    }
    await storage.set({ [BROWSER_SESSION_STORAGE_KEY]: next });
    return next;
  }

  return Object.freeze({
    executors,
    getBrowserSessionId,
    async reconcileAfterBackgroundStart(
      store: GenerationRunReconciliationStore,
      now: number,
    ): Promise<readonly GenerationRun[]> {
      if (!Number.isSafeInteger(now) || now < 0) {
        throw new Error("The Bilimuzhi task recovery clock is invalid");
      }
      return reconcileGenerationTasksForBrowserSession({
        browserSessionId: await getBrowserSessionId(),
        executorRegistry: executors,
        now: () => now,
        store,
      });
    },
  });
}
