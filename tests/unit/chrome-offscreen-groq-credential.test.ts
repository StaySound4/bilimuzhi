import { describe, expect, it, vi } from "vitest";

import { resolveGroqApiKeyFromStorage } from "../../src/infrastructure/chrome-offscreen-groq";
import { SETTINGS_SECRET_STORAGE_KEY } from "../../src/infrastructure/chrome-settings-store";
import {
  V12_SETTINGS_SECRET_STORAGE_KEY,
  V13_SETTINGS_SECRET_STORAGE_KEY,
} from "../../src/infrastructure/provider-profile-settings";

function createStorage(seed: Record<string, unknown> = {}) {
  const values = { ...seed };
  const storage = {
    get: vi.fn(async (key: string) => ({ [key]: values[key] })),
  };
  return { storage, values };
}

describe("resolveGroqApiKeyFromStorage", () => {
  it("prefers the v13 secret bucket (where saveV12GroqApiKey persists)", async () => {
    const { storage } = createStorage({
      [V13_SETTINGS_SECRET_STORAGE_KEY]: {
        groqApiKey: "gsk-v13-secret",
        providerApiKeys: {},
        removedProviderKeyIds: [],
        version: 13,
      },
      [V12_SETTINGS_SECRET_STORAGE_KEY]: {
        groqApiKey: "gsk-v12-stale",
        providerApiKeys: {},
        removedProviderKeyIds: [],
        version: 12,
      },
    });
    const loadLegacy = vi.fn();
    await expect(
      resolveGroqApiKeyFromStorage(storage, { loadLegacy }),
    ).resolves.toBe("gsk-v13-secret");
    expect(loadLegacy).not.toHaveBeenCalled();
  });

  it("falls back to the v12 bucket when v13 has no key", async () => {
    const { storage } = createStorage({
      [V12_SETTINGS_SECRET_STORAGE_KEY]: {
        groqApiKey: "gsk-v12-key",
        providerApiKeys: {},
        removedProviderKeyIds: [],
        version: 12,
      },
    });
    const loadLegacy = vi.fn();
    await expect(
      resolveGroqApiKeyFromStorage(storage, { loadLegacy }),
    ).resolves.toBe("gsk-v12-key");
    expect(loadLegacy).not.toHaveBeenCalled();
  });

  it("falls back to the legacy v2 secret bucket", async () => {
    const { storage } = createStorage({
      [SETTINGS_SECRET_STORAGE_KEY]: {
        groqApiKey: "gsk-legacy-key",
        version: 2,
      },
    });
    const loadLegacy = vi.fn();
    await expect(
      resolveGroqApiKeyFromStorage(storage, { loadLegacy }),
    ).resolves.toBe("gsk-legacy-key");
    expect(loadLegacy).toHaveBeenCalledOnce();
  });

  it("returns null when no bucket holds a Groq key", async () => {
    const { storage } = createStorage();
    await expect(
      resolveGroqApiKeyFromStorage(storage, { loadLegacy: vi.fn() }),
    ).resolves.toBeNull();
  });

  it("returns null for a v13 record without a valid key", async () => {
    const { storage } = createStorage({
      [V13_SETTINGS_SECRET_STORAGE_KEY]: {
        groqApiKey: null,
        providerApiKeys: {},
        removedProviderKeyIds: [],
        version: 13,
      },
    });
    await expect(
      resolveGroqApiKeyFromStorage(storage, { loadLegacy: vi.fn() }),
    ).resolves.toBeNull();
  });
});
