import { describe, expect, it } from "vitest";

import { AiProviderError } from "../../src/application/ai/provider-error";
import { BackupError } from "../../src/application/backup";
import { StorageError } from "../../src/application/storage";
import { VideoGatewayError } from "../../src/application/video-gateway";
import { ChatProtocolError } from "../../src/infrastructure/chrome-chat-runtime";
import {
  artifactFailureMessage,
  safeBackupExportMessage,
  safeSessionActionMessage,
  stableGenerationFailureCode,
} from "../../src/ui/error-presentation";

describe("safeSessionActionMessage", () => {
  it("maps every VideoGatewayError code to a stable Chinese message", () => {
    expect(
      safeSessionActionMessage(
        new VideoGatewayError("VALIDATION_FAILED", "raw", false),
      ),
    ).toContain("视频标识无效");
    expect(
      safeSessionActionMessage(
        new VideoGatewayError("VIDEO_NOT_BOUND", "raw", false),
      ),
    ).toContain("未找到可绑定的");
    expect(
      safeSessionActionMessage(
        new VideoGatewayError("NETWORK_ERROR", "raw", false),
      ),
    ).toContain("无法读取");
    expect(
      safeSessionActionMessage(
        new VideoGatewayError("UNSUPPORTED_CAPABILITY", "raw", false),
      ),
    ).toContain("暂不支持");
  });

  it("maps AiProviderError codes without leaking the raw message", () => {
    const message = safeSessionActionMessage(
      new AiProviderError("RATE_LIMITED", "raw provider body", true),
    );
    expect(message).toBe("AI Provider 请求过于频繁，请稍后重试。");
    expect(message).not.toContain("raw provider body");
  });

  it("maps StorageError connection invalidation and archive/trash hints", () => {
    expect(
      safeSessionActionMessage(
        new StorageError("db down", true, "CONNECTION_INVALID"),
      ),
    ).toContain("连接已失效");
    expect(
      safeSessionActionMessage(new StorageError("no archivable branch")),
    ).toContain("还没有可归档的字幕");
    expect(
      safeSessionActionMessage(new StorageError("trash update failed")),
    ).toContain("回收站");
    expect(safeSessionActionMessage(new StorageError("other", true))).toContain(
      "暂时不可用",
    );
  });

  it("keeps BackupError and V12SettingsError shape but hides nothing raw", () => {
    const message = safeSessionActionMessage(
      new BackupError("BACKUP_GENERATION_FAILED", "内部细节"),
    );
    expect(message).toContain("BACKUP_GENERATION_FAILED");
  });

  it("falls back to a stable generic message for unknown errors", () => {
    expect(safeSessionActionMessage(new Error("boom"))).toBe(
      "操作失败，请重试。",
    );
  });
});

describe("safeBackupExportMessage", () => {
  it("maps download lifecycle codes to user-facing copy", () => {
    expect(
      safeBackupExportMessage({ code: "DOWNLOAD_START_FAILED" }),
    ).toContain("无法启动备份下载");
    expect(
      safeBackupExportMessage({ code: "DOWNLOAD_PATH_MISSING" }),
    ).toContain("最终文件路径");
    expect(
      safeBackupExportMessage({ code: "DOWNLOAD_OPEN_FOLDER_FAILED" }),
    ).toContain("打开备份所在文件夹");
    expect(safeBackupExportMessage({ code: "UNKNOWN" })).toContain("请重试");
  });

  it("prefers BackupError instances with code and message", () => {
    const message = safeBackupExportMessage(
      new BackupError("BACKUP_GENERATION_FAILED", "生成失败"),
    );
    expect(message).toBe("生成失败（BACKUP_GENERATION_FAILED）");
  });
});

describe("stableGenerationFailureCode", () => {
  it("passes through known codes and normalises STOPPED_BY_USER", () => {
    expect(stableGenerationFailureCode("TIMEOUT")).toBe("TIMEOUT");
    expect(stableGenerationFailureCode("STOPPED_BY_USER")).toBe(
      "USER_CANCELLED",
    );
    expect(stableGenerationFailureCode(null)).toBeNull();
    expect(stableGenerationFailureCode("NOT_A_CODE")).toBeNull();
  });
});

describe("safeSessionActionMessage 附件相关错误映射（用户症状 2）", () => {
  it("附件 owner 失效给出明确文案而非兜底操作失败", () => {
    const message = safeSessionActionMessage(
      new Error("The Bilimuzhi image attachment owner is no longer authoritative"),
    );
    expect(message).toContain("图片已失效");
    expect(message).not.toContain("操作失败");
  });

  it("模型不支持附件给出明确文案", () => {
    const message = safeSessionActionMessage(
      new Error("selected model image attachment support is unavailable"),
    );
    expect(message).toContain("不支持发送图片");
    expect(message).not.toContain("操作失败");
  });
});

describe("safeSessionActionMessage 协议错误可见性（用户症状：操作失败）", () => {
  it("协议层错误显示可操作的稳定文案而非笼统操作失败", () => {
    const message = safeSessionActionMessage(
      new ChatProtocolError("Bilimuzhi AI 后台响应无效；请重新加载扩展后再试。"),
    );
    expect(message).toContain("重新加载扩展");
    expect(message).not.toContain("操作失败");
  });
});

describe("artifactFailureMessage", () => {
  it("renders a stable message for each known error code without leaking", () => {
    expect(artifactFailureMessage("TIMEOUT", "summary")).toContain(
      "检查网络或更换模型后重试",
    );
    expect(artifactFailureMessage("STOPPED_BY_USER", "segments")).toBe(
      "USER_CANCELLED：已取消；需要时可重新生成。",
    );
    expect(
      artifactFailureMessage("AUTHENTICATION_REQUIRED", "summary"),
    ).toContain("检查供应商凭据后重试");
    expect(artifactFailureMessage("WEIRD", "summary")).toBe(
      "生成未完成，请重试。",
    );
  });
});
