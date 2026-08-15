import { describe, expect, it, vi } from "vitest";

import { createBilimuzhiDatabaseBootstrap } from "../../src/infrastructure/indexeddb/muzhi-database-bootstrap";

describe("Bilimuzhi database bootstrap", () => {
  it("loads the persisted speech preference before the first shared open", async () => {
    const events: string[] = [];
    const load = vi.fn(async () => {
      events.push("preference");
      return "英文" as const;
    });
    const database = {} as IDBDatabase;
    const open = vi.fn(async (options) => {
      events.push(`open:${options.defaultSpeechLanguageMode}`);
      return database;
    });
    const bootstrap = createBilimuzhiDatabaseBootstrap(load, open);

    expect(await Promise.all([bootstrap(), bootstrap()])).toEqual([
      database,
      database,
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["preference", "open:en", "open:en"]);
  });
});
