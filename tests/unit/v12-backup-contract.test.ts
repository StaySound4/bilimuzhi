import { describe, expect, it, vi } from "vitest";

import * as settingsInfrastructure from "../../src/infrastructure/chrome-settings-store";

type BackupGroup =
  "application-ai" | "archive" | "prompts" | "trash" | "workspace";

interface BackupExportResult {
  readonly fileName: string;
  readonly json: string;
  readonly notice: string;
}

interface BackupImportPreview {
  readonly conflicts: readonly {
    readonly code: string;
    readonly sessionId?: string;
  }[];
  readonly relocations?: readonly {
    readonly branchCount: number;
    readonly from: "archive" | "trash" | "workspace";
    readonly sessionId: string;
    readonly to: "archive" | "trash" | "workspace";
  }[];
  readonly selectedGroups: readonly BackupGroup[];
  readonly statistics: Readonly<
    Record<
      BackupGroup,
      { readonly incoming: number; readonly replaced: number }
    >
  >;
}

interface BackupDataPort {
  commitImport(input: {
    readonly groups: Partial<Record<BackupGroup, unknown>>;
    readonly importKeysOnly?: boolean;
    readonly preserveLocalKeys: boolean;
  }): Promise<void>;
  inspectLocal(): Promise<{
    readonly placements: Readonly<
      Record<"archive" | "trash" | "workspace", readonly string[]>
    >;
    readonly statistics: Readonly<Record<BackupGroup, number>>;
  }>;
  readGroups(
    groups: readonly BackupGroup[],
  ): Promise<Partial<Record<BackupGroup, unknown>>>;
  readKeys(): Promise<{
    readonly groq: string | null;
    readonly providers: Readonly<Record<string, string>>;
  }>;
  validateImport(input: {
    readonly groups: Partial<Record<BackupGroup, unknown>>;
    readonly importKeysOnly?: boolean;
    readonly preserveLocalKeys: boolean;
  }): Promise<{
    readonly relocations: readonly {
      readonly branchCount: number;
      readonly from: "archive" | "trash" | "workspace";
      readonly sessionId: string;
      readonly to: "archive" | "trash" | "workspace";
    }[];
  }>;
}

interface V12BackupRuntime {
  commitImport(input: {
    readonly confirmation: "replace-selected-groups";
    readonly preview: BackupImportPreview;
  }): Promise<void>;
  exportBackup(input: {
    readonly confirmPlaintextSecrets?: boolean;
    readonly groups: readonly BackupGroup[];
    readonly includeKeys: boolean;
    readonly password?: string;
  }): Promise<BackupExportResult>;
  previewImport(input: {
    readonly groups: readonly BackupGroup[];
    readonly json: string;
    readonly password?: string;
  }): Promise<BackupImportPreview>;
}

type CreateV12BackupRuntime = (dependencies: {
  readonly crypto: Crypto;
  readonly data: BackupDataPort;
  readonly now: () => number;
  readonly randomUUID: () => string;
}) => V12BackupRuntime;

const allGroups: readonly BackupGroup[] = [
  "application-ai",
  "prompts",
  "workspace",
  "archive",
  "trash",
];

function createDataPort(overrides: Partial<BackupDataPort> = {}) {
  const data: BackupDataPort = {
    commitImport: vi.fn(async () => undefined),
    inspectLocal: vi.fn(async () => ({
      placements: {
        archive: ["session-local-archive"],
        trash: ["session-local-trash"],
        workspace: ["session-local-workspace"],
      },
      statistics: {
        "application-ai": 2,
        archive: 1,
        prompts: 2,
        trash: 1,
        workspace: 1,
      },
    })),
    validateImport: vi.fn(async ({ groups }) => {
      const workspace = groups.workspace as
        | { readonly sessions?: readonly { readonly sessionId?: string }[] }
        | undefined;
      return {
        relocations: workspace?.sessions?.some(
          (session) => session.sessionId === "session-local-archive",
        )
          ? [
              {
                branchCount: 0,
                from: "archive" as const,
                sessionId: "session-local-archive",
                to: "workspace" as const,
              },
            ]
          : [],
      };
    }),
    readGroups: vi.fn(async () => ({
      "application-ai": {
        appearance: { theme: "dark" },
        groq: { language: "中文", routing: "balanced" },
        profiles: [{ id: "profile-one", models: ["model-one"] }],
        summaryReading: { fontFamily: "proportional", fontSize: 16 },
        taskSelections: { chat: ["profile-one", "model-one"] },
      },
      archive: {
        folders: [{ id: "archive-root", title: "归档" }],
        sessions: [{ placement: "archive", sessionId: "session-archive" }],
      },
      prompts: {
        builtInRefs: ["summary-balanced"],
        userPresets: [{ id: "prompt-one", name: "我的总结" }],
      },
      trash: {
        sessions: [
          {
            deletedAt: 1_700_000_000_000,
            expiresAt: 1_700_604_800_000,
            placement: "trash",
            sessionId: "session-trash",
          },
        ],
      },
      workspace: {
        sessions: [
          {
            attachments: [{ attachmentId: "attachment-one" }],
            placement: "workspace",
            sessionId: "session-workspace",
          },
        ],
      },
    })),
    readKeys: vi.fn(async () => ({
      groq: "groq-key-for-tests-5519",
      providers: { "profile-one": "provider-key-for-tests-4821" },
    })),
    ...overrides,
  };
  return data;
}

function createSubject(data = createDataPort()): V12BackupRuntime {
  const factory = (
    settingsInfrastructure as unknown as {
      readonly createV12BackupRuntime?: CreateV12BackupRuntime;
    }
  ).createV12BackupRuntime;
  expect(
    factory,
    "A13 requires createV12BackupRuntime at the settings/application boundary",
  ).toBeTypeOf("function");
  return factory!({
    crypto: globalThis.crypto,
    data,
    now: () => 1_700_000_000_000,
    randomUUID: () => "backup-id-for-tests",
  });
}

describe("v12 backup contract (A13)", () => {
  it("exports five independent groups with placement-owned dependencies while excluding appearance and forbidden browser credentials", async () => {
    const data = createDataPort();
    const result = await createSubject(data).exportBackup({
      groups: allGroups,
      includeKeys: false,
    });
    const decoded = JSON.parse(result.json) as Record<string, unknown>;

    expect(data.readGroups).toHaveBeenCalledWith(allGroups);
    expect(decoded).toMatchObject({
      groups: {
        "application-ai": expect.any(Object),
        archive: expect.any(Object),
        prompts: expect.any(Object),
        trash: expect.any(Object),
        workspace: expect.any(Object),
      },
      version: 1,
    });
    expect(result.fileName).toMatch(/\.json$/);
    expect(result.notice).not.toContain("未加密密钥");
    expect(result.json).not.toContain("appearance");
    expect(result.json).not.toContain("theme");
    expect(result.json).not.toContain("provider-key-for-tests-4821");
    expect(result.json).not.toContain("groq-key-for-tests-5519");
    expect(result.json).not.toMatch(
      /cookie|authorization header|signed(media)?url|rawresponse/i,
    );
  });

  it("defaults to no keys and uses randomized salt/IV encrypted envelopes only when a password is supplied", async () => {
    const runtime = createSubject();
    const first = await runtime.exportBackup({
      groups: ["application-ai"],
      includeKeys: true,
      password: "backup password for tests",
    });
    const second = await runtime.exportBackup({
      groups: ["application-ai"],
      includeKeys: true,
      password: "backup password for tests",
    });
    const firstEnvelope = JSON.parse(first.json) as {
      readonly encryption: { readonly iv: string; readonly salt: string };
    };
    const secondEnvelope = JSON.parse(second.json) as {
      readonly encryption: { readonly iv: string; readonly salt: string };
    };

    expect(first.json).not.toContain("provider-key-for-tests-4821");
    expect(first.json).not.toContain("groq-key-for-tests-5519");
    expect(firstEnvelope).toMatchObject({
      encryption: {
        algorithm: expect.any(String),
        iv: expect.any(String),
        salt: expect.any(String),
      },
      kind: "muzhi-encrypted-backup",
      version: 1,
    });
    expect(firstEnvelope.encryption.iv).not.toBe(secondEnvelope.encryption.iv);
    expect(firstEnvelope.encryption.salt).not.toBe(
      secondEnvelope.encryption.salt,
    );
  });

  it("requires an explicit second confirmation before writing plaintext keys and marks both file and success notice", async () => {
    const runtime = createSubject();
    await expect(
      runtime.exportBackup({
        groups: ["application-ai"],
        includeKeys: true,
      }),
    ).rejects.toMatchObject({ code: "PLAINTEXT_KEYS_CONFIRMATION_REQUIRED" });

    const result = await runtime.exportBackup({
      confirmPlaintextSecrets: true,
      groups: ["application-ai"],
      includeKeys: true,
    });
    expect(JSON.parse(result.json)).toMatchObject({
      containsUnencryptedSecrets: true,
      groups: { "application-ai": expect.any(Object) },
      version: 1,
    });
    expect(result.json).toContain("provider-key-for-tests-4821");
    expect(result.json).toContain("groq-key-for-tests-5519");
    expect(result.notice).toContain("包含未加密密钥");
  });

  it("previews parsing, version, migration, references, capacity, replacement counts, and placement conflicts with zero writes", async () => {
    const data = createDataPort();
    const runtime = createSubject(data);
    const backup = JSON.stringify({
      groups: {
        workspace: {
          sessions: [
            {
              dependencies: { subtitleId: "subtitle-one" },
              placement: "workspace",
              sessionId: "session-local-archive",
            },
          ],
        },
      },
      version: 1,
    });

    const preview = await runtime.previewImport({
      groups: ["workspace"],
      json: backup,
    });
    expect(preview.selectedGroups).toEqual(["workspace"]);
    expect(preview.statistics.workspace).toEqual({ incoming: 1, replaced: 1 });
    expect(preview.conflicts).toEqual([]);
    expect(preview.relocations).toContainEqual({
      branchCount: 0,
      from: "archive",
      sessionId: "session-local-archive",
      to: "workspace",
    });
    expect(data.commitImport).not.toHaveBeenCalled();
  });

  it("preserves local keys when the backup has none and replaces only explicitly selected groups", async () => {
    const data = createDataPort();
    const runtime = createSubject(data);
    const preview = await runtime.previewImport({
      groups: ["prompts", "workspace"],
      json: JSON.stringify({
        groups: {
          prompts: { userPresets: [{ id: "incoming-prompt" }] },
          workspace: { sessions: [{ sessionId: "incoming-session" }] },
        },
        version: 1,
      }),
    });

    await runtime.commitImport({
      confirmation: "replace-selected-groups",
      preview,
    });
    expect(data.commitImport).toHaveBeenCalledOnce();
    expect(data.commitImport).toHaveBeenCalledWith({
      groups: {
        prompts: { userPresets: [{ id: "incoming-prompt" }] },
        workspace: { sessions: [{ sessionId: "incoming-session" }] },
      },
      importKeysOnly: false,
      preserveLocalKeys: true,
    });
  });
});
