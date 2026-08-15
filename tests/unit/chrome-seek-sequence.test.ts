import { describe, expect, it, vi } from "vitest";

import { createChromeSeekSequenceAllocator } from "../../src/infrastructure/chrome-seek-sequence";

function sessionStorage(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    chrome: {
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: values.get(key) })),
          set: vi.fn(async (items: Record<string, unknown>) => {
            for (const [key, value] of Object.entries(items))
              values.set(key, value);
          }),
        },
      },
    },
    values,
  };
}

describe("Chrome seek sequence allocator", () => {
  it("串行分配并持久化 seek 序号", async () => {
    const { chrome, values } = sessionStorage();
    const allocate = createChromeSeekSequenceAllocator(chrome);

    await expect(
      Promise.all([allocate(), allocate(), allocate()]),
    ).resolves.toEqual([1, 2, 3]);
    expect(values.get("muzhi.player.seek-sequence.v1")).toBe(3);
  });

  it("session 存储读值短暂回退时仍保持当前 Worker 内单调", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ "muzhi.player.seek-sequence.v1": 8 })
      .mockResolvedValueOnce({ "muzhi.player.seek-sequence.v1": 7 });
    const allocate = createChromeSeekSequenceAllocator({
      storage: {
        session: { get, set: vi.fn(async () => undefined) },
      },
    });

    await expect(allocate()).resolves.toBe(9);
    await expect(allocate()).resolves.toBe(10);
  });

  it("Service Worker 重启后从 session 水位继续而不是回退", async () => {
    const { chrome } = sessionStorage({ "muzhi.player.seek-sequence.v1": 41 });

    await expect(createChromeSeekSequenceAllocator(chrome)()).resolves.toBe(42);
    await expect(createChromeSeekSequenceAllocator(chrome)()).resolves.toBe(43);
  });
});
