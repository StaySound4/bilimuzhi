const SEEK_SEQUENCE_STORAGE_KEY = "muzhi.player.seek-sequence.v1";

interface ChromeSessionStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSessionStorage(chromeValue: unknown): ChromeSessionStorageArea {
  if (!isRecord(chromeValue)) {
    throw new Error("Chrome seek sequence APIs are unavailable");
  }
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
      if (!isRecord(result)) {
        throw new Error("Chrome session storage is invalid");
      }
      return Object.freeze({ ...result });
    },
    async set(items: Record<string, unknown>): Promise<void> {
      await Reflect.apply(set, session, [items]);
    },
  });
}

export function createChromeSeekSequenceAllocator(
  chromeValue: unknown,
): () => Promise<number> {
  const storage = readSessionStorage(chromeValue);
  let allocation = Promise.resolve();
  let highWatermark = 0;

  return (): Promise<number> => {
    const next = allocation.then(async () => {
      const stored = await storage.get(SEEK_SEQUENCE_STORAGE_KEY);
      const current = stored[SEEK_SEQUENCE_STORAGE_KEY];
      const storedSequence =
        Number.isSafeInteger(current) && Number(current) >= 0
          ? Number(current)
          : 0;
      const nextSequence = Math.max(storedSequence, highWatermark) + 1;
      if (!Number.isSafeInteger(nextSequence)) {
        throw new Error("The seek dispatch sequence is exhausted");
      }
      await storage.set({ [SEEK_SEQUENCE_STORAGE_KEY]: nextSequence });
      highWatermark = nextSequence;
      return nextSequence;
    });
    allocation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
}
