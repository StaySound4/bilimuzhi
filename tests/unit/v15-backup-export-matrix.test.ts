import { describe, expect, it, vi } from "vitest";

import {
  createV12BackupRuntime,
  type BackupDataPort,
} from "../../src/application/backup";

const applicationAiFixture = Object.freeze({
  profiles: Object.freeze([
    Object.freeze({ id: "fixture-profile", models: ["fixture-model"] }),
  ]),
  taskSelections: Object.freeze({
    chat: Object.freeze(["fixture-profile", "fixture-model"]),
  }),
});

const workspaceFixture = Object.freeze({
  sessions: Object.freeze([
    Object.freeze({
      placement: "workspace",
      sessionId: "whole-backup-password-fixture",
    }),
  ]),
});

function createData(): BackupDataPort {
  return {
    commitImport: vi.fn(async () => undefined),
    inspectLocal: vi.fn(async () => ({
      placements: { archive: [], trash: [], workspace: [] },
      statistics: {
        "application-ai": 0,
        archive: 0,
        prompts: 0,
        trash: 0,
        "batch-archive": 0,
        "batch-trash": 0,
        "batch-workspace": 0,
        workspace: 0,
      },
    })),
    readGroups: vi.fn(async () => ({
      "application-ai": applicationAiFixture,
      workspace: workspaceFixture,
    })),
    readKeys: vi.fn(async () => ({
      groq: "fixture-groq-key-1782",
      providers: { "fixture-provider": "fixture-provider-key-8401" },
    })),
  };
}

function createSubject(data = createData()) {
  return {
    data,
    runtime: createV12BackupRuntime({
      crypto: globalThis.crypto,
      data,
      now: () => 1_700_000_000_000,
      randomUUID: () => "v15-backup-matrix",
    }),
  };
}

describe("v15 backup password and key matrix (B1)", () => {
  it("inspects plaintext and encrypted files before the user chooses import groups", async () => {
    const { runtime } = createSubject();
    const plaintext = await runtime.exportBackup({
      confirmPlaintextSecrets: true,
      groups: ["application-ai", "workspace"],
      includeKeys: true,
    });
    const encrypted = await runtime.exportBackup({
      groups: ["prompts", "workspace"],
      includeKeys: false,
      password: "fixture inspection password",
    });

    await expect(
      runtime.inspectBackupFile({ json: plaintext.json }),
    ).resolves.toEqual({
      availableGroups: ["application-ai", "workspace"],
      containsSecrets: true,
      containsUnencryptedSecrets: true,
      encrypted: false,
    });
    await expect(
      runtime.inspectBackupFile({ json: encrypted.json }),
    ).rejects.toMatchObject({ code: "BACKUP_PASSWORD_REQUIRED" });
    await expect(
      runtime.inspectBackupFile({
        json: encrypted.json,
        password: "fixture inspection password",
      }),
    ).resolves.toEqual({
      availableGroups: ["workspace"],
      containsSecrets: false,
      containsUnencryptedSecrets: false,
      encrypted: true,
    });
  });
  it.each([false, true])(
    "encrypts the entire selected backup whenever a non-empty password is supplied (includeKeys=%s)",
    async (includeKeys) => {
      const { data, runtime } = createSubject();

      const exported = await runtime.exportBackup({
        groups: ["workspace"],
        includeKeys,
        password: "fixture backup password",
      });
      const envelope = JSON.parse(exported.json) as Record<string, unknown>;

      expect.soft(envelope).toMatchObject({
        ciphertext: expect.any(String),
        encryption: {
          algorithm: "PBKDF2-SHA256/AES-256-GCM",
          iterations: 120_000,
          iv: expect.any(String),
          salt: expect.any(String),
        },
        kind: "muzhi-encrypted-backup",
        version: 1,
      });
      expect.soft(exported.json).not.toContain("whole-backup-password-fixture");
      expect.soft(exported.json).not.toContain("fixture-groq-key-1782");
      expect.soft(exported.json).not.toContain("fixture-provider-key-8401");
      expect(data.readKeys).toHaveBeenCalledTimes(includeKeys ? 1 : 0);

      await expect(
        runtime.previewImport({
          groups: ["workspace"],
          json: exported.json,
          password: "fixture backup password",
        }),
      ).resolves.toMatchObject({
        conflicts: [],
        selectedGroups: ["workspace"],
      });
    },
  );

  it("keeps keyless exports plaintext only when no password is supplied", async () => {
    const { data, runtime } = createSubject();
    const exported = await runtime.exportBackup({
      groups: ["workspace"],
      includeKeys: false,
    });

    expect(JSON.parse(exported.json)).toMatchObject({
      groups: { workspace: workspaceFixture },
      version: 1,
    });
    expect(exported.json).not.toContain("containsUnencryptedSecrets");
    expect(data.readKeys).not.toHaveBeenCalled();
  });

  it("requires the plaintext-key confirmation and marks the confirmed unencrypted export", async () => {
    const { runtime } = createSubject();

    await expect(
      runtime.exportBackup({
        groups: ["workspace"],
        includeKeys: true,
      }),
    ).rejects.toMatchObject({ code: "PLAINTEXT_KEYS_CONFIRMATION_REQUIRED" });

    const exported = await runtime.exportBackup({
      confirmPlaintextSecrets: true,
      groups: ["workspace"],
      includeKeys: true,
    });
    expect(JSON.parse(exported.json)).toMatchObject({
      containsUnencryptedSecrets: true,
      secrets: {
        groq: "fixture-groq-key-1782",
        providers: { "fixture-provider": "fixture-provider-key-8401" },
      },
      version: 1,
    });
    expect(exported.fileName).toContain("包含未加密密钥");
    expect(exported.notice).toContain("包含未加密密钥");
  });

  it("round-trips encrypted included keys into the application-ai import group", async () => {
    const { data, runtime } = createSubject();
    const exported = await runtime.exportBackup({
      groups: ["application-ai"],
      includeKeys: true,
      password: "fixture encrypted import password",
    });

    await expect(
      runtime.previewImport({
        groups: ["application-ai"],
        json: exported.json,
        password: "wrong fixture password",
      }),
    ).rejects.toMatchObject({ code: "BACKUP_DECRYPTION_FAILED" });
    expect(data.commitImport).not.toHaveBeenCalled();

    const preview = await runtime.previewImport({
      groups: ["application-ai"],
      json: exported.json,
      password: "fixture encrypted import password",
    });
    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    expect(data.commitImport).toHaveBeenCalledOnce();
    expect(data.commitImport).toHaveBeenCalledWith({
      groups: {
        "application-ai": {
          ...applicationAiFixture,
          apiKeys: {
            groq: "fixture-groq-key-1782",
            providers: {
              "fixture-provider": "fixture-provider-key-8401",
            },
          },
        },
      },
      importKeysOnly: false,
      preserveLocalKeys: false,
    });
  });

  it("round-trips a current keyless export while preserving local keys", async () => {
    const { data, runtime } = createSubject();
    const exported = await runtime.exportBackup({
      groups: ["application-ai"],
      includeKeys: false,
    });
    const preview = await runtime.previewImport({
      groups: ["application-ai"],
      json: exported.json,
    });

    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });

    expect(data.commitImport).toHaveBeenCalledWith({
      groups: { "application-ai": applicationAiFixture },
      importKeysOnly: false,
      preserveLocalKeys: true,
    });
  });
});
