export type BackupGroup =
  | "application-ai"
  | "archive"
  | "batch-archive"
  | "batch-trash"
  | "batch-workspace"
  | "prompts"
  | "trash"
  | "workspace";

export const BACKUP_GROUPS: readonly BackupGroup[] = Object.freeze([
  "application-ai",
  "prompts",
  "workspace",
  "archive",
  "trash",
  "batch-workspace",
  "batch-archive",
  "batch-trash",
]);

/** 批量备份组的统计明细（Ticket 06：批量标签系统已删除，不再统计标签）。 */
export interface BackupGroupStatistics {
  readonly items: number;
  readonly lists: number;
  readonly subtitles: number;
}

export type BackupStatisticsValue = number | BackupGroupStatistics;

export function isBatchBackupGroup(group: BackupGroup): boolean {
  return (
    group === "batch-workspace" ||
    group === "batch-archive" ||
    group === "batch-trash"
  );
}

export type BackupPlacement = "archive" | "trash" | "workspace";

export interface BackupImportRelocation {
  readonly branchCount: number;
  readonly from: BackupPlacement;
  readonly sessionId: string;
  readonly to: BackupPlacement;
}

export interface BackupImportValidation {
  readonly relocations: readonly BackupImportRelocation[];
}

export interface BackupDataPort {
  commitImport(input: {
    readonly groups: Partial<Record<BackupGroup, unknown>>;
    readonly importKeysOnly?: boolean;
    readonly preserveLocalKeys: boolean;
  }): Promise<void>;
  inspectLocal(): Promise<{
    readonly placements: Readonly<
      Record<"archive" | "trash" | "workspace", readonly string[]>
    >;
    readonly statistics: Readonly<Record<BackupGroup, BackupStatisticsValue>>;
  }>;
  readGroups(
    groups: readonly BackupGroup[],
  ): Promise<Partial<Record<BackupGroup, unknown>>>;
  readKeys(): Promise<{
    readonly groq: string | null;
    readonly providers: Readonly<Record<string, string>>;
  }>;
  validateImport?(input: {
    readonly groups: Partial<Record<BackupGroup, unknown>>;
    readonly importKeysOnly?: boolean;
    readonly preserveLocalKeys: boolean;
  }): Promise<BackupImportValidation | void>;
}

export interface BackupFileInspection {
  readonly availableGroups: readonly BackupGroup[];
  readonly containsSecrets: boolean;
  readonly containsUnencryptedSecrets: boolean;
  readonly encrypted: boolean;
}

export interface BackupImportPreview {
  readonly conflicts: readonly {
    readonly code: string;
    readonly sessionId?: string;
  }[];
  readonly includeKeys: boolean;
  /** 旧备份含已删除的批量标签数据（导入时静默跳过，UI 注明）。 */
  readonly ignoredBatchTags?: boolean;
  readonly relocations?: readonly BackupImportRelocation[];
  readonly selectedGroups: readonly BackupGroup[];
  readonly statistics: Readonly<
    Record<
      BackupGroup,
      {
        readonly incoming: BackupStatisticsValue;
        readonly replaced: BackupStatisticsValue;
      }
    >
  >;
}

export class BackupError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BackupError";
  }
}

interface PlainBackup {
  readonly containsUnencryptedSecrets?: true;
  readonly groups: Partial<Record<BackupGroup, unknown>>;
  readonly secrets?: {
    readonly groq: string | null;
    readonly providers: Readonly<Record<string, string>>;
  };
  readonly version: 1;
}

interface PreviewPayload {
  readonly groups: Partial<Record<BackupGroup, unknown>>;
  readonly importKeysOnly: boolean;
  readonly preserveLocalKeys: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

const BACKUP_BLOB_MARKER = "__muzhiV12BackupBlob";

async function sanitizeBackupValue(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    return {
      [BACKUP_BLOB_MARKER]: true,
      data: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
      mimeType: value.type,
    };
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((child) => sanitizeBackupValue(child)));
  }
  if (!isRecord(value)) return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      key === "appearance" ||
      key === "theme" ||
      /cookie|authorizationheader|signedmediaurl|signedurl|rawresponse/i.test(
        key,
      )
    ) {
      continue;
    }
    sanitized[key] = await sanitizeBackupValue(child);
  }
  return sanitized;
}

function restoreBackupValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(restoreBackupValue);
  if (!isRecord(value)) return value;
  if (
    value[BACKUP_BLOB_MARKER] === true &&
    typeof value.data === "string" &&
    typeof value.mimeType === "string"
  ) {
    try {
      return new Blob([base64ToBytes(value.data) as BlobPart], {
        type: value.mimeType,
      });
    } catch {
      throw new BackupError(
        "BACKUP_ATTACHMENT_INVALID",
        "备份中的附件内容无效。",
      );
    }
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      restoreBackupValue(child),
    ]),
  );
}

function validateGroups(
  groups: readonly BackupGroup[],
): readonly BackupGroup[] {
  if (
    groups.length === 0 ||
    new Set(groups).size !== groups.length ||
    groups.some((group) => !BACKUP_GROUPS.includes(group))
  ) {
    throw new BackupError("INVALID_BACKUP_GROUPS", "备份数据组无效。");
  }
  return [...groups];
}

function validateImportGroups(
  groups: readonly BackupGroup[],
  includeKeys: boolean,
): readonly BackupGroup[] {
  if (
    new Set(groups).size !== groups.length ||
    groups.some((group) => !BACKUP_GROUPS.includes(group)) ||
    (groups.length === 0 && !includeKeys)
  ) {
    throw new BackupError("INVALID_BACKUP_GROUPS", "备份数据组无效。");
  }
  return [...groups];
}

export function batchGroupCounts(value: unknown): BackupGroupStatistics {
  if (!isRecord(value)) return { items: 0, lists: 0, subtitles: 0 };
  return {
    items: Array.isArray(value.items) ? value.items.length : 0,
    lists: Array.isArray(value.jobs) ? value.jobs.length : 0,
    subtitles: Array.isArray(value.subtitles) ? value.subtitles.length : 0,
  };
}

/** 旧备份批量组是否携带已删除的标签数据（Ticket 06：导入时静默跳过并注明）。 */
export function hasIgnoredBatchTags(
  groups: Partial<Record<BackupGroup, unknown>>,
): boolean {
  return (["batch-workspace", "batch-archive", "batch-trash"] as const).some(
    (group) => {
      const value = groups[group];
      if (!isRecord(value)) return false;
      const tags = value.tags;
      const archiveTags = value.archiveTags;
      return (
        (Array.isArray(tags) && tags.length > 0) ||
        (Array.isArray(archiveTags) && archiveTags.length > 0)
      );
    },
  );
}

function incomingCount(
  group: BackupGroup,
  value: unknown,
): number | BackupGroupStatistics {
  if (isBatchBackupGroup(group)) return batchGroupCounts(value);
  if (!isRecord(value)) return value === undefined ? 0 : 1;
  if (
    (group === "workspace" || group === "archive" || group === "trash") &&
    Array.isArray(value.sessions)
  ) {
    return value.sessions.length;
  }
  if (group === "prompts" && Array.isArray(value.userPresets)) {
    return value.userPresets.length;
  }
  if (group === "application-ai" && Array.isArray(value.profiles)) {
    return value.profiles.length;
  }
  return Object.keys(value).length === 0 ? 0 : 1;
}

async function deriveEncryptionKey(
  crypto: Crypto,
  password: string,
  salt: Uint8Array,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      iterations: 120_000,
      name: "PBKDF2",
      salt: salt as BufferSource,
    },
    material,
    { length: 256, name: "AES-GCM" },
    false,
    [usage],
  );
}

async function encryptBackup(
  crypto: Crypto,
  password: string,
  backup: PlainBackup,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveEncryptionKey(crypto, password, salt, "encrypt");
  const ciphertext = await crypto.subtle.encrypt(
    { iv: iv as BufferSource, name: "AES-GCM" },
    key,
    new TextEncoder().encode(JSON.stringify(backup)),
  );
  return JSON.stringify({
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    encryption: {
      algorithm: "PBKDF2-SHA256/AES-256-GCM",
      iterations: 120_000,
      iv: bytesToBase64(iv),
      salt: bytesToBase64(salt),
    },
    kind: "muzhi-encrypted-backup",
    version: 1,
  });
}

function isEncryptedBackupJson(json: string): boolean {
  try {
    const decoded = JSON.parse(json) as unknown;
    return isRecord(decoded) && decoded.kind === "muzhi-encrypted-backup";
  } catch {
    return false;
  }
}

async function decodeBackup(
  crypto: Crypto,
  json: string,
  password?: string,
): Promise<PlainBackup> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(json) as unknown;
  } catch {
    throw new BackupError("BACKUP_JSON_INVALID", "备份 JSON 无法解析。");
  }
  if (isRecord(decoded) && decoded.kind === "muzhi-encrypted-backup") {
    if (!password) {
      throw new BackupError("BACKUP_PASSWORD_REQUIRED", "此备份需要密码。");
    }
    if (
      !isRecord(decoded.encryption) ||
      typeof decoded.encryption.iv !== "string" ||
      typeof decoded.encryption.salt !== "string" ||
      typeof decoded.ciphertext !== "string"
    ) {
      throw new BackupError("BACKUP_ENVELOPE_INVALID", "加密备份格式无效。");
    }
    try {
      const salt = base64ToBytes(decoded.encryption.salt);
      const iv = base64ToBytes(decoded.encryption.iv);
      const key = await deriveEncryptionKey(crypto, password, salt, "decrypt");
      const plaintext = await crypto.subtle.decrypt(
        { iv: iv as BufferSource, name: "AES-GCM" },
        key,
        base64ToBytes(decoded.ciphertext) as BufferSource,
      );
      decoded = JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
    } catch (error) {
      if (error instanceof BackupError) throw error;
      throw new BackupError(
        "BACKUP_DECRYPTION_FAILED",
        "备份密码错误或文件已损坏。",
      );
    }
  }
  if (
    !isRecord(decoded) ||
    decoded.version !== 1 ||
    !isRecord(decoded.groups)
  ) {
    throw new BackupError("BACKUP_SCHEMA_INVALID", "备份版本或结构无效。");
  }
  return restoreBackupValue(decoded) as PlainBackup;
}

export function createV12BackupRuntime(dependencies: {
  readonly crypto: Crypto;
  readonly data: BackupDataPort;
  readonly now: () => number;
  readonly randomUUID: () => string;
}) {
  const payloads = new WeakMap<object, PreviewPayload>();

  return {
    async inspectBackupFile(input: {
      readonly json: string;
      readonly password?: string;
    }): Promise<BackupFileInspection> {
      const backup = await decodeBackup(
        dependencies.crypto,
        input.json,
        input.password,
      );
      const availableGroups = BACKUP_GROUPS.filter(
        (group) => group in backup.groups,
      );
      if (availableGroups.length === 0) {
        throw new BackupError(
          "INVALID_BACKUP_GROUPS",
          "备份不包含可导入的数据组。",
        );
      }
      return Object.freeze({
        availableGroups: Object.freeze([...availableGroups]),
        containsSecrets: backup.secrets !== undefined,
        containsUnencryptedSecrets: backup.containsUnencryptedSecrets === true,
        encrypted: isEncryptedBackupJson(input.json),
      });
    },

    async commitImport(input: {
      readonly confirmation: "replace-selected-groups";
      readonly preview: BackupImportPreview;
    }): Promise<void> {
      if (input.confirmation !== "replace-selected-groups") {
        throw new BackupError(
          "BACKUP_IMPORT_CONFIRMATION_REQUIRED",
          "必须确认替换所选组。",
        );
      }
      const conflict = input.preview.conflicts[0];
      if (conflict !== undefined) {
        throw new BackupError(conflict.code, "备份与未选中的会话位置冲突。");
      }
      const payload = payloads.get(input.preview);
      if (!payload) {
        throw new BackupError("BACKUP_PREVIEW_STALE", "导入预检已失效。");
      }
      try {
        await dependencies.data.commitImport(payload);
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError(
          "BACKUP_IMPORT_TRANSACTION_FAILED",
          "导入提交失败，原数据保持不变。",
        );
      }
    },

    async exportBackup(input: {
      readonly confirmPlaintextSecrets?: boolean;
      readonly groups: readonly BackupGroup[];
      readonly includeKeys: boolean;
      readonly password?: string;
    }) {
      const groups = validateGroups(input.groups);
      if (
        input.includeKeys &&
        !input.password &&
        !input.confirmPlaintextSecrets
      ) {
        throw new BackupError(
          "PLAINTEXT_KEYS_CONFIRMATION_REQUIRED",
          "必须二次确认未加密密钥备份。",
        );
      }
      let plain: PlainBackup;
      try {
        const selected = await dependencies.data.readGroups(groups);
        const sanitizedGroups: Partial<Record<BackupGroup, unknown>> = {};
        for (const group of groups) {
          sanitizedGroups[group] = await sanitizeBackupValue(selected[group]);
        }
        plain = {
          groups: sanitizedGroups,
          version: 1,
          ...(input.includeKeys
            ? { secrets: await dependencies.data.readKeys() }
            : {}),
          ...(input.includeKeys && !input.password
            ? { containsUnencryptedSecrets: true as const }
            : {}),
        };
      } catch (error) {
        if (error instanceof BackupError) throw error;
        throw new BackupError(
          "BACKUP_EXPORT_GENERATION_FAILED",
          "无法生成备份内容，请重试。",
        );
      }
      const encrypted = Boolean(input.password);
      let json: string;
      try {
        json = encrypted
          ? await encryptBackup(dependencies.crypto, input.password!, plain)
          : JSON.stringify(plain);
      } catch {
        throw new BackupError(
          encrypted
            ? "BACKUP_ENCRYPTION_FAILED"
            : "BACKUP_EXPORT_SERIALIZATION_FAILED",
          encrypted
            ? "无法加密备份内容，请重试。"
            : "无法生成备份文件，请重试。",
        );
      }
      return {
        fileName: `muzhi-backup-${dependencies.now()}-${dependencies.randomUUID()}${
          input.includeKeys && !input.password ? "-包含未加密密钥" : ""
        }.json`,
        json,
        notice:
          input.includeKeys && !input.password
            ? "备份成功：包含未加密密钥"
            : "备份成功",
      };
    },

    async previewImport(input: {
      readonly groups: readonly BackupGroup[];
      readonly includeKeys?: boolean;
      readonly json: string;
      readonly password?: string;
    }): Promise<BackupImportPreview> {
      const selectedGroups = validateImportGroups(
        input.groups,
        input.includeKeys === true,
      );
      const backup = await decodeBackup(
        dependencies.crypto,
        input.json,
        input.password,
      );
      const local = await dependencies.data.inspectLocal();
      const groups: Partial<Record<BackupGroup, unknown>> = {};
      for (const group of selectedGroups) {
        if (!(group in backup.groups)) {
          throw new BackupError(
            "BACKUP_GROUP_MISSING",
            `备份缺少所选数据组：${group}`,
          );
        }
        groups[group] = backup.groups[group];
      }
      const includeKeys =
        input.includeKeys ??
        (backup.secrets !== undefined &&
          selectedGroups.includes("application-ai"));
      if (includeKeys) {
        if (backup.secrets === undefined) {
          throw new BackupError(
            "BACKUP_KEYS_MISSING",
            "备份不包含 API 与密钥。",
          );
        }
        groups["application-ai"] = {
          ...(isRecord(groups["application-ai"])
            ? groups["application-ai"]
            : {}),
          apiKeys: backup.secrets,
        };
      }
      const conflicts: Array<{ code: string; sessionId?: string }> = [];
      const preserveLocalKeys = !includeKeys;
      const importKeysOnly = includeKeys && selectedGroups.length === 0;
      let relocations: readonly BackupImportRelocation[] = [];
      if (dependencies.data.validateImport) {
        try {
          const validation = await dependencies.data.validateImport({
            groups,
            importKeysOnly,
            preserveLocalKeys,
          });
          relocations = validation?.relocations ?? [];
        } catch (error) {
          if (error instanceof BackupError) throw error;
          throw new BackupError(
            "BACKUP_IMPORT_VALIDATION_FAILED",
            "备份引用、附件或本地所有权校验失败。",
          );
        }
      }
      const statistics = Object.fromEntries(
        BACKUP_GROUPS.map((group) => [
          group,
          {
            incoming: selectedGroups.includes(group)
              ? incomingCount(group, groups[group])
              : 0,
            replaced: selectedGroups.includes(group)
              ? local.statistics[group]
              : 0,
          },
        ]),
      ) as BackupImportPreview["statistics"];
      const preview: BackupImportPreview = {
        conflicts,
        ignoredBatchTags: hasIgnoredBatchTags(groups),
        includeKeys,
        relocations: [...relocations],
        selectedGroups: [...selectedGroups],
        statistics,
      };
      payloads.set(preview, {
        groups,
        importKeysOnly,
        preserveLocalKeys,
      });
      return preview;
    },
  };
}
