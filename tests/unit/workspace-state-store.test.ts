import { describe, expect, it, vi } from "vitest";

import type { WorkspaceState } from "../../src/application/workspace-restoration";
import {
  createChromeWorkspaceStateStore,
  WORKSPACE_STATE_STORAGE_KEY,
} from "../../src/infrastructure/chrome-workspace-state-store";

describe("createChromeWorkspaceStateStore", () => {
  it("loads exact version 1 state from the stable Bilimuzhi storage key", async () => {
    const state = {
      activeSessionId: "session-1",
      sessions: [
        {
          activeMode: "timeline",
          scrollTopByMode: {
            chat: 0,
            segments: 0,
            summary: 0,
            timeline: 120,
          },
          sessionId: "session-1",
        },
      ],
      version: 1,
    } satisfies WorkspaceState;
    const get = vi.fn(async () => ({
      [WORKSPACE_STATE_STORAGE_KEY]: state,
    }));
    const store = createChromeWorkspaceStateStore({
      get,
      set: async () => undefined,
    });

    await expect(store.load()).resolves.toEqual(state);
    expect(get).toHaveBeenCalledWith(WORKSPACE_STATE_STORAGE_KEY);
  });

  it("returns null when no workspace state has been saved", async () => {
    const store = createChromeWorkspaceStateStore({
      get: async () => ({}),
      set: async () => undefined,
    });

    await expect(store.load()).resolves.toBeNull();
  });

  it("rejects malformed stored data without exposing its contents", async () => {
    const store = createChromeWorkspaceStateStore({
      get: async () => ({
        [WORKSPACE_STATE_STORAGE_KEY]: {
          activeSessionId: "missing-session",
          sessions: [],
          version: 1,
        },
      }),
      set: async () => undefined,
    });

    await expect(store.load()).rejects.toMatchObject({
      code: "STORAGE_TRANSACTION_FAILED",
      message: "The saved Bilimuzhi workspace state is invalid",
      retryable: false,
    });
  });

  it("writes a validated defensive snapshot to the stable storage key", async () => {
    const state = {
      activeSessionId: "session-1",
      sessions: [
        {
          activeMode: "chat",
          scrollTopByMode: {
            chat: 80,
            segments: 20,
            summary: 30,
            timeline: 10,
          },
          sessionId: "session-1",
        },
      ],
      version: 1,
    } satisfies WorkspaceState;
    const set = vi.fn(async (items: Record<string, unknown>) => {
      void items;
    });
    const store = createChromeWorkspaceStateStore({
      get: async () => ({}),
      set,
    });

    await store.save(state);

    expect(set).toHaveBeenCalledWith({
      [WORKSPACE_STATE_STORAGE_KEY]: state,
    });
    const written = set.mock.calls[0]?.[0][WORKSPACE_STATE_STORAGE_KEY] as
      WorkspaceState | undefined;
    expect(Object.isFrozen(written)).toBe(true);
    expect(Object.isFrozen(written?.sessions)).toBe(true);
    expect(Object.isFrozen(written?.sessions[0]?.scrollTopByMode)).toBe(true);
  });

  it("normalizes Chrome storage failures as retryable safe errors", async () => {
    const readStore = createChromeWorkspaceStateStore({
      get: async () => {
        throw new Error("sensitive read failure");
      },
      set: async () => undefined,
    });
    const writeStore = createChromeWorkspaceStateStore({
      get: async () => ({}),
      set: async () => {
        throw new Error("sensitive write failure");
      },
    });
    const state = {
      activeSessionId: null,
      sessions: [],
      version: 1,
    } satisfies WorkspaceState;

    await expect(readStore.load()).rejects.toMatchObject({
      message: "Unable to read the Bilimuzhi workspace state",
      retryable: true,
    });
    await expect(writeStore.save(state)).rejects.toMatchObject({
      message: "Unable to save the Bilimuzhi workspace state",
      retryable: true,
    });
  });
});
