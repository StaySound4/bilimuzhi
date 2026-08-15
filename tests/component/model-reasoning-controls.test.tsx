import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { FunctionComponent } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SettingsDrawer,
  type SettingsDrawerProps,
} from "../../src/ui/settings/settings-drawer";

interface V12ProfileOption {
  readonly apiKey: {
    readonly configured: boolean;
    readonly lastFour: string | null;
    readonly masked: string;
  };
  readonly baseUrl: string;
  readonly hostPermission: "granted" | "missing";
  readonly id: string;
  readonly models: readonly {
    readonly enabled: boolean;
    readonly id: string;
    readonly label: string;
    readonly reasoningEfforts: readonly string[];
    readonly reasoningOverride: {
      readonly effort: string;
      readonly enabled: boolean;
    } | null;
    readonly verification: "unverified" | "verified";
  }[];
  readonly name: string;
}

interface V12SettingsDrawerProps extends SettingsDrawerProps {
  readonly profiles: readonly V12ProfileOption[];
  readonly selectedProfileId: string;
}

const V12SettingsDrawer =
  SettingsDrawer as FunctionComponent<V12SettingsDrawerProps>;

function props(
  overrides: Partial<V12SettingsDrawerProps> = {},
): V12SettingsDrawerProps {
  return {
    apiKey: "",
    baseUrl: "https://api.example.test/v1",
    apiKeyConfigured: true,
    applyRetentionTo: "future",
    busy: false,
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
            reasoningOverride: null,
            verification: "verified",
          },
          {
            enabled: true,
            id: "custom-model",
            label: "Custom Model",
            reasoningEfforts: [],
            reasoningOverride: null,
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
    taskChoices: [],
    selectedProfileId: "profile-alpha",
    theme: "light",
    uiLanguage: "zh-Hans",
    ...overrides,
  };
}

afterEach(cleanup);

describe("model reasoning controls (ticket 04)", () => {
  it("renders the thinking toggle, effort selector, and help hint for each model", () => {
    render(<V12SettingsDrawer {...props()} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    const toggles = screen.getAllByRole("checkbox", {
      name: /切换模型 .* 的思考开关/,
    });
    expect(toggles).toHaveLength(2);
    // 默认关闭：档位选择器禁用，开关未勾选。
    expect((toggles[0] as HTMLInputElement).checked).toBe(false);
    const select = screen.getAllByRole("combobox", { name: /推理档位/ })[0];
    expect((select as HTMLSelectElement).disabled).toBe(true);
    // 帮助文案（多语言登记，zh-Hans 渲染）。
    expect(
      screen.getAllByText(/实际强度以服务商文档为准/).length,
    ).toBeGreaterThan(0);
  });

  it("merges model capability efforts with custom efforts, deduplicated", () => {
    const value = props({ customReasoningEfforts: ["ultra", "max"] });
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "切换模型 DeepSeek Chat 的思考开关",
      }),
    );
    const select = screen.getAllByRole("combobox", { name: /推理档位/ })[0];
    const options = Array.from(select.querySelectorAll("option")).map(
      (option) => option.textContent,
    );
    // auto + 能力档位 + 自定义档位（max 去重，只出现一次）。
    expect(options).toEqual([
      "自动（跟随模型默认）",
      "none",
      "low",
      "high",
      "max",
      "ultra",
    ]);
  });

  it("emits onSetModelReasoning when the toggle is flipped", () => {
    const onSetModelReasoning = vi.fn();
    const value = props({ onSetModelReasoning });
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "切换模型 DeepSeek Chat 的思考开关",
      }),
    );
    expect(onSetModelReasoning).toHaveBeenCalledWith({
      effort: "auto",
      enabled: true,
      modelId: "deepseek-chat",
      profileId: "profile-alpha",
    });
  });

  it("emits onSetModelReasoning when an effort is selected", () => {
    const onSetModelReasoning = vi.fn();
    const value = props({
      onSetModelReasoning,
      profiles: [
        {
          ...props().profiles[0],
          models: [
            {
              ...props().profiles[0].models[0],
              reasoningOverride: { effort: "low", enabled: true },
            },
            props().profiles[0].models[1],
          ],
        },
      ],
    });
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    const select = screen.getAllByRole("combobox", { name: /推理档位/ })[0];
    expect((select as HTMLSelectElement).disabled).toBe(false);
    expect((select as HTMLSelectElement).value).toBe("low");
    fireEvent.change(select, { target: { value: "high" } });
    expect(onSetModelReasoning).toHaveBeenCalledWith({
      effort: "high",
      enabled: true,
      modelId: "deepseek-chat",
      profileId: "profile-alpha",
    });
  });

  it("turns thinking off through the toggle when a persisted override is enabled", () => {
    const onSetModelReasoning = vi.fn();
    const value = props({
      onSetModelReasoning,
      profiles: [
        {
          ...props().profiles[0],
          models: [
            {
              ...props().profiles[0].models[0],
              reasoningOverride: { effort: "max", enabled: true },
            },
            props().profiles[0].models[1],
          ],
        },
      ],
    });
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    const toggle = screen.getByRole("checkbox", {
      name: "切换模型 DeepSeek Chat 的思考开关",
    });
    // 已持久化的覆盖：开关开、选择器可用、档位回显。
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(
      (
        screen.getAllByRole("combobox", {
          name: /推理档位/,
        })[0] as HTMLSelectElement
      ).disabled,
    ).toBe(false);
    fireEvent.click(toggle);
    // 受控组件：关闭意图通过回调上抛，由父组件更新状态后选择器才会禁用。
    expect(onSetModelReasoning).toHaveBeenCalledWith({
      effort: "max",
      enabled: false,
      modelId: "deepseek-chat",
      profileId: "profile-alpha",
    });
  });

  it("reflects a persisted override without custom efforts in the list", () => {
    const value = props({
      profiles: [
        {
          ...props().profiles[0],
          models: [
            {
              ...props().profiles[0].models[0],
              reasoningOverride: { effort: "max", enabled: true },
            },
            props().profiles[0].models[1],
          ],
        },
      ],
    });
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    expect(
      (
        screen.getAllByRole("combobox", {
          name: /推理档位/,
        })[0] as HTMLSelectElement
      ).value,
    ).toBe("max");
  });
});
