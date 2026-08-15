import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { FunctionComponent } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SettingsDrawer,
  type SettingsDrawerProps,
} from "../../src/ui/settings/settings-drawer";

interface V12SettingsDrawerProps extends SettingsDrawerProps {
  readonly profiles: NonNullable<SettingsDrawerProps["profiles"]>;
  readonly selectedProfileId: string;
}

const V12SettingsDrawer =
  SettingsDrawer as FunctionComponent<V12SettingsDrawerProps>;

function props(
  overrides: Partial<V12SettingsDrawerProps> = {},
): V12SettingsDrawerProps {
  return {
    apiKey: "",
    apiKeyConfigured: true,
    applyRetentionTo: "future",
    baseUrl: "https://alpha.example.test/v1",
    busy: false,
    customReasoningEfforts: ["ultra"],
    customRetentionDays: "30",
    exportPreference: { format: "markdown", includeTimestamps: true },
    groqApiKey: "",
    groqApiKeyConfigured: true,
    models: [],
    modelId: "",
    onClose: vi.fn(),
    onSaveGroqKey: vi.fn(),
    onSaveProviderKey: vi.fn(),
    onTestProvider: vi.fn(),
    onThemeChange: vi.fn(),
    onUiLanguageChange: vi.fn(),
    onProviderChange: vi.fn(),
    onDiscoverModels: vi.fn(),
    onModelChange: vi.fn(),
    onRetentionChange: vi.fn(),
    onExportPreferenceChange: vi.fn(),
    onPromptTemplateChange: vi.fn(),
    open: true,
    profiles: [
      {
        apiKey: { configured: true, lastFour: "4821", masked: "•••• 4821" },
        baseUrl: "https://alpha.example.test/v1",
        hostPermission: "granted",
        id: "profile-alpha",
        models: [
          {
            enabled: true,
            id: "deepseek-chat",
            label: "DeepSeek Chat",
            reasoningEfforts: ["none", "low", "high", "max"],
            reasoningOverride: { effort: "ultra", enabled: true },
            verification: "verified",
          },
        ],
        name: "配置1",
      },
    ],
    promptTemplate: "",
    protocol: "openai-compatible",
    providers: [],
    providerId: "profile-alpha",
    reasoningEffort: "auto",
    retention: "30",
    selectedProfileId: "profile-alpha",
    taskChoices: [],
    theme: "light",
    uiLanguage: "zh-Hans",
    ...overrides,
  };
}

afterEach(cleanup);

describe("custom reasoning efforts management (ticket 05)", () => {
  it("renders the custom effort manager with the persisted list", () => {
    render(<V12SettingsDrawer {...props()} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    expect(screen.getByRole("heading", { name: /自定义档位/ })).not.toBeNull();
    expect(screen.getByRole("textbox", { name: /自定义档位/ })).not.toBeNull();
    expect(
      screen.getByRole("list", { name: /自定义档位/ }).textContent,
    ).toContain("ultra");
  });

  it("adds a new custom effort through the callback", () => {
    const onAddCustomReasoningEffort = vi.fn();
    render(<V12SettingsDrawer {...props({ onAddCustomReasoningEffort })} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    fireEvent.input(screen.getByRole("textbox", { name: /自定义档位/ }), {
      target: { value: "think-3" },
    });
    fireEvent.click(screen.getByRole("button", { name: /添加.*档位/ }));
    expect(onAddCustomReasoningEffort).toHaveBeenCalledWith("think-3");
  });

  it("rejects an empty or duplicate draft locally before calling the callback", () => {
    const onAddCustomReasoningEffort = vi.fn();
    render(<V12SettingsDrawer {...props({ onAddCustomReasoningEffort })} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    fireEvent.input(screen.getByRole("textbox", { name: /自定义档位/ }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: /添加.*档位/ }));
    expect(onAddCustomReasoningEffort).not.toHaveBeenCalled();

    // 大小写不敏感查重：ULTRA 与已有 ultra 冲突。
    fireEvent.input(screen.getByRole("textbox", { name: /自定义档位/ }), {
      target: { value: "ULTRA" },
    });
    fireEvent.click(screen.getByRole("button", { name: /添加.*档位/ }));
    expect(onAddCustomReasoningEffort).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).not.toBeNull();
  });

  it("moves a custom effort up and down through callbacks", () => {
    const onMoveCustomReasoningEffort = vi.fn();
    render(
      <V12SettingsDrawer
        {...props({
          customReasoningEfforts: ["ultra", "think-3"],
          onMoveCustomReasoningEffort,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    fireEvent.click(screen.getByRole("button", { name: /下移.*ultra/ }));
    expect(onMoveCustomReasoningEffort).toHaveBeenCalledWith("ultra", "down");
    fireEvent.click(screen.getByRole("button", { name: /上移.*think-3/ }));
    expect(onMoveCustomReasoningEffort).toHaveBeenCalledWith("think-3", "up");
  });

  it("removes a custom effort and explains the fallback behaviour", () => {
    const onRemoveCustomReasoningEffort = vi.fn();
    render(<V12SettingsDrawer {...props({ onRemoveCustomReasoningEffort })} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    // 删除说明文案：引用该档位的模型回退到模型默认。
    expect(screen.getByText(/回退到模型默认/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /删除.*ultra/ }));
    expect(onRemoveCustomReasoningEffort).toHaveBeenCalledWith("ultra");
  });
});
