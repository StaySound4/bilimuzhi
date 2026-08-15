import { describe, expect, it } from "vitest";

import {
  APPEARANCE_STORAGE_KEY,
  defaultAppearanceState,
  isAppearanceState,
  isThemeMode,
  upgradeLegacyAppearanceState,
} from "../../src/ui/appearance-state";

describe("appearance-state", () => {
  it("keeps the stable storage key", () => {
    expect(APPEARANCE_STORAGE_KEY).toBe("muzhi.appearance.v1");
  });

  it("validates current v2 appearance state", () => {
    expect(
      isAppearanceState({
        appearance: { theme: "dark" },
        conversationPaneWidthPx: 320,
        version: 2,
      }),
    ).toBe(true);
    expect(
      isAppearanceState({
        appearance: { theme: "sepia" },
        conversationPaneWidthPx: 320,
        version: 2,
      }),
    ).toBe(false);
    expect(
      isAppearanceState({
        appearance: { theme: "dark" },
        conversationPaneWidthPx: 0,
        version: 2,
      }),
    ).toBe(false);
    expect(isAppearanceState({ version: 1 })).toBe(false);
    expect(isAppearanceState(null)).toBe(false);
  });

  it("upgrades a valid legacy v1 state to v2", () => {
    const upgraded = upgradeLegacyAppearanceState({
      appearance: { theme: "light" },
      conversationPaneWidthPx: 260,
      version: 1,
    });
    expect(upgraded).toEqual({
      appearance: { theme: "light" },
      conversationPaneWidthPx: 260,
      version: 2,
    });
  });

  it("rejects malformed legacy states instead of guessing", () => {
    expect(
      upgradeLegacyAppearanceState({
        appearance: { theme: "system" },
        conversationPaneWidthPx: -1,
        version: 1,
      }),
    ).toBeNull();
    expect(
      upgradeLegacyAppearanceState({
        appearance: { theme: "unknown" },
        conversationPaneWidthPx: 260,
        version: 1,
      }),
    ).toBeNull();
    expect(upgradeLegacyAppearanceState({ version: 3 })).toBeNull();
  });

  it("produces a frozen default state", () => {
    const state = defaultAppearanceState();
    expect(isAppearanceState(state)).toBe(true);
    expect(Object.isFrozen(state)).toBe(true);
    expect(state.appearance.theme).toBe("system");
  });

  it("accepts only the three theme modes", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("dark")).toBe(true);
    expect(isThemeMode("system")).toBe(true);
    expect(isThemeMode("auto")).toBe(false);
  });
});
