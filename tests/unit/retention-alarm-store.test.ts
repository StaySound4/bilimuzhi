import { describe, expect, it, vi } from "vitest";

import {
  RetentionAlarmStore,
  TRASH_RETENTION_ALARM_NAME,
} from "../../src/infrastructure/retention-alarm-store";

describe("RetentionAlarmStore", () => {
  it("schedules the exact next purge deadline and clears an empty schedule", async () => {
    const create = vi.fn();
    const clear = vi.fn(async () => true);
    const getNextPurgeAt = vi
      .fn<() => Promise<number | null>>()
      .mockResolvedValueOnce(5_000)
      .mockResolvedValueOnce(null);
    const store = new RetentionAlarmStore({
      alarms: { clear, create },
      retentionRepository: { getNextPurgeAt },
      trashRepository: {
        permanentlyDeleteExpiredTrashBranches: vi.fn(async () => []),
      },
    });

    await expect(store.synchronize()).resolves.toBe(5_000);
    expect(create).toHaveBeenCalledWith(TRASH_RETENTION_ALARM_NAME, {
      when: 5_000,
    });
    await expect(store.synchronize()).resolves.toBeNull();
    expect(clear).toHaveBeenCalledWith(TRASH_RETENTION_ALARM_NAME);
  });

  it("purges through the repository and reschedules only for the owned alarm", async () => {
    const create = vi.fn();
    const clear = vi.fn(async () => true);
    const permanentlyDeleteExpiredTrashBranches = vi.fn(async () => [
      "branch-a",
    ]);
    const store = new RetentionAlarmStore({
      alarms: { clear, create },
      retentionRepository: { getNextPurgeAt: vi.fn(async () => 9_000) },
      trashRepository: { permanentlyDeleteExpiredTrashBranches },
    });

    await expect(store.handleAlarm("other", 7_000)).resolves.toEqual([]);
    expect(permanentlyDeleteExpiredTrashBranches).not.toHaveBeenCalled();
    await expect(
      store.handleAlarm(TRASH_RETENTION_ALARM_NAME, 7_000),
    ).resolves.toEqual(["branch-a"]);
    expect(permanentlyDeleteExpiredTrashBranches).toHaveBeenCalledWith(7_000);
    expect(create).toHaveBeenCalledWith(TRASH_RETENTION_ALARM_NAME, {
      when: 9_000,
    });
  });
});
