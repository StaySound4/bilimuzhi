import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SettingsDrawer,
  type SettingsDrawerProps,
} from "../../src/ui/settings/settings-drawer";
import type { FunctionComponent } from "preact";

interface PromptPresetOption {
  readonly builtIn: boolean;
  readonly content: string;
  readonly id: string;
  readonly kind: "chat" | "segments" | "summary";
  readonly name: string;
}

interface V11SettingsDrawerProps extends SettingsDrawerProps {
  readonly defaultPromptPresetIds: Readonly<
    Record<"chat" | "segments" | "summary", string>
  >;
  readonly onCopyPromptPreset: (presetId: string) => void;
  readonly onCreatePromptPreset: (kind: PromptPresetOption["kind"]) => void;
  readonly onDeletePromptPreset: (presetId: string) => void;
  readonly onExportPromptPresets: (format: "json" | "text") => void;
  readonly onImportPromptPresets: (format: "json" | "text") => void;
  readonly onRestoreBuiltInPrompt: (kind: PromptPresetOption["kind"]) => void;
  readonly onSelectDefaultPromptPreset: (value: {
    readonly kind: PromptPresetOption["kind"];
    readonly presetId: string;
  }) => void;
  readonly promptPresets: readonly PromptPresetOption[];
  readonly selectedPromptPresetIds: Readonly<
    Record<"chat" | "segments" | "summary", string>
  >;
}

const V11SettingsDrawer =
  SettingsDrawer as FunctionComponent<V11SettingsDrawerProps>;

afterEach(cleanup);

function props(
  overrides: Partial<SettingsDrawerProps> = {},
): SettingsDrawerProps {
  return {
    apiKey: "sk-local-secret",
    apiKeyConfigured: true,
    applyRetentionTo: "future",
    baseUrl: "https://api.example.test",
    customRetentionDays: "14",
    exportPreference: { format: "txt", includeTimestamps: true },
    groqApiKey: "gsk-local-secret",
    groqApiKeyConfigured: true,
    modelId: "model-a",
    models: [
      { id: "model-a", label: "Model A", reasoningEfforts: ["low", "high"] },
    ],
    onClose: vi.fn(),
    onDiscoverModels: vi.fn(),
    onExportPreferenceChange: vi.fn(),
    onModelChange: vi.fn(),
    onPromptTemplateChange: vi.fn(),
    onProviderChange: vi.fn(),
    onRetentionChange: vi.fn(),
    onSaveGroqKey: vi.fn(),
    onSaveProviderKey: vi.fn(),
    onTestProvider: vi.fn(),
    onThemeChange: vi.fn(),
    open: true,
    promptTemplate: "",
    protocol: "openai-compatible",
    providerId: "openai",
    providers: [{ id: "openai", label: "OpenAI-compatible" }],
    reasoningEffort: "low",
    retention: "7",
    theme: "system",
    uiLanguage: "zh-Hans",
    onUiLanguageChange: vi.fn(),
    ...overrides,
  };
}

describe("SettingsDrawer", () => {
  it("keeps the Groq speech key independent from the chat provider key", () => {
    const value = props();
    render(<SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    const input = screen.getByLabelText(
      "Groq 语音转字幕 Key",
    ) as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(
      screen
        .getByRole("link", { name: "前往 Groq 官方控制台创建 Key" })
        .getAttribute("href"),
    ).toBe("https://console.groq.com/keys");
    fireEvent.input(input, { target: { value: "gsk-new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Groq 语音密钥" }));
    expect(value.onSaveGroqKey).toHaveBeenCalledWith("gsk-new-secret");
    expect(value.onSaveProviderKey).not.toHaveBeenCalled();
  });

  it("toggles the Groq key eye between masked and plain text", () => {
    const value = props();
    render(<SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    const input = screen.getByLabelText(
      "Groq 语音转字幕 Key",
    ) as HTMLInputElement;

    // 初始:遮罩
    expect(input.type).toBe("password");
    const eye = screen.getByRole("button", { name: "显示密钥" });

    // 点击眼睛:明文
    fireEvent.click(eye);
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "隐藏密钥" })).not.toBeNull();

    // 再点:恢复遮罩
    fireEvent.click(screen.getByRole("button", { name: "隐藏密钥" }));
    expect(input.type).toBe("password");
  });

  it("keeps recycle-bin retention and global export preferences out of settings", () => {
    const value = props();
    render(<SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "缓存" }));
    expect(screen.queryByRole("combobox", { name: "回收站保留" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "外观" }));
    fireEvent.input(screen.getByRole("combobox", { name: "主题" }), {
      target: { value: "dark" },
    });
    expect(value.onThemeChange).toHaveBeenCalledWith("dark");
    expect(screen.queryByRole("tab", { name: "导出" })).toBeNull();
    expect(screen.queryByLabelText("默认导出格式")).toBeNull();
    expect(screen.queryByLabelText("导出时间戳")).toBeNull();
    expect(value.onExportPreferenceChange).not.toHaveBeenCalled();
  });

  it("traps Tab and restores focus after the drawer closes", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "打开设置";
    document.body.append(trigger);
    trigger.focus();
    const value = props();
    const view = render(<SettingsDrawer {...value} />);
    const dialog = screen.getByRole("dialog", { name: "设置" });
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(value.onClose).toHaveBeenCalledOnce();
    view.rerender(<SettingsDrawer {...value} open={false} />);
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
  it("configures a separate model and reasoning effort per AI task", () => {
    const value = props({
      onTaskModelChange: vi.fn(),
      taskModels: [
        { kind: "chat", label: "对话", modelId: "", reasoningEffort: "auto" },
        {
          kind: "segments",
          label: "分段",
          modelId: "model-a",
          reasoningEffort: "low",
        },
        {
          kind: "summary",
          label: "总结",
          modelId: "",
          reasoningEffort: "auto",
        },
      ],
    });
    render(<SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "任务模型" }));

    const chatModel = screen.getByLabelText("对话模型") as HTMLSelectElement;
    expect(chatModel.value).toBe("");
    expect(screen.getAllByRole("option", { name: "跟随默认模型" }).length).toBe(
      3,
    );
    expect(
      (screen.getByLabelText("分段推理强度") as HTMLSelectElement).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText("对话推理强度") as HTMLSelectElement).disabled,
    ).toBe(true);

    fireEvent.input(chatModel, { target: { value: "model-a" } });

    expect(value.onTaskModelChange).toHaveBeenCalledWith({
      kind: "chat",
      modelId: "model-a",
      reasoningEffort: "auto",
    });
  });

  it("only offers reasoning efforts the selected model really supports", () => {
    render(
      <SettingsDrawer
        {...props({
          models: [
            { id: "model-a", label: "Model A", reasoningEfforts: ["low"] },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "任务模型" }));

    expect(screen.getByRole("option", { name: "low" })).not.toBeNull();
    expect(screen.queryByRole("option", { name: "high" })).toBeNull();
  });

  it("shows the result of the last settings action inside the drawer", () => {
    const { rerender } = render(
      <SettingsDrawer
        {...props({
          feedback: { kind: "pending", text: "正在连接 Provider 并探测模型…" },
        })}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("正在连接");

    rerender(
      <SettingsDrawer
        {...props({
          feedback: { kind: "error", text: "AI Provider 密钥缺失或无效。" },
        })}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("密钥缺失");
  });

  it("keeps the speech key with the AI settings and drops the duplicated language control", () => {
    render(<SettingsDrawer {...props()} />);

    expect(screen.queryByRole("tab", { name: "语音转字幕" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    expect(screen.getByLabelText("Groq 语音转字幕 Key")).not.toBeNull();
    expect(screen.queryByLabelText("请求语言")).toBeNull();
  });

  it("manages named per-task prompt presets without allowing the built-in original to be overwritten", () => {
    const value: V11SettingsDrawerProps = {
      ...props(),
      defaultPromptPresetIds: {
        chat: "builtin-chat",
        segments: "builtin-segments",
        summary: "summary-team",
      },
      onCopyPromptPreset: vi.fn(),
      onCreatePromptPreset: vi.fn(),
      onDeletePromptPreset: vi.fn(),
      onExportPromptPresets: vi.fn(),
      onImportPromptPresets: vi.fn(),
      onRestoreBuiltInPrompt: vi.fn(),
      onSelectDefaultPromptPreset: vi.fn(),
      promptPresets: [
        {
          builtIn: true,
          content: "Bilimuzhi内置对话原件",
          id: "builtin-chat",
          kind: "chat",
          name: "Bilimuzhi默认",
        },
        {
          builtIn: false,
          content: "团队总结规范",
          id: "summary-team",
          kind: "summary",
          name: "团队总结",
        },
      ],
      selectedPromptPresetIds: {
        chat: "builtin-chat",
        segments: "builtin-segments",
        summary: "summary-team",
      },
    };
    render(<V11SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "提示词" }));

    expect(
      (
        screen.getByRole("combobox", {
          name: "对话提示词预设",
        }) as HTMLSelectElement
      ).value,
    ).toBe("builtin-chat");
    expect(
      (
        screen.getByRole("textbox", {
          name: "查看内置提示词原件",
        }) as HTMLTextAreaElement
      ).readOnly,
    ).toBe(true);
    expect(screen.getByRole("button", { name: "复制为新预设" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "新建预设" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "设为默认" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "恢复内置默认" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "导入纯文本" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "导入 JSON" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "导出纯文本" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "导出 JSON" })).not.toBeNull();
  });

  it("retires the legacy single-provider form and never offers duplicate provider selects", () => {
    const value = props();
    render(<SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "AI" }));
    expect(
      screen.queryByRole("button", { name: "保存 Provider 设置" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "测试连接并探测模型" }),
    ).toBeNull();
    expect(document.body.textContent).not.toContain("对话 Provider");
    expect(
      screen.queryByRole("button", { name: "新建语言模型配置" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "任务模型" }));
    expect(screen.getByRole("option", { name: "high" })).not.toBeNull();
  });
});
