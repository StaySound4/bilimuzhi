import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/preact";
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
    baseUrl: "https://api.example.test/v1",
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
    profiles: [],
    promptTemplate: "",
    protocol: "openai-compatible",
    providers: [],
    providerId: "",
    reasoningEffort: "auto",
    retention: "30",
    selectedProfileId: "",
    taskChoices: [],
    theme: "light",
    uiLanguage: "zh-Hans",
    ...overrides,
  };
}

afterEach(cleanup);

describe("Ollama provider type (ticket 08)", () => {
  it("offers the Ollama preset with the localhost endpoint and no key requirement", () => {
    const onCreateProfile = vi.fn();
    render(<V12SettingsDrawer {...props({ onCreateProfile })} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));
    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));

    const dialog = screen.getByRole("dialog", { name: "新建语言模型配置" });
    fireEvent.input(
      within(dialog).getByRole("combobox", { name: "Provider" }),
      {
        target: { value: "ollama" },
      },
    );
    const baseUrl = within(dialog).getByLabelText(
      "Base URL",
    ) as HTMLInputElement;
    expect(baseUrl.value).toBe("http://localhost:11434/v1");
    fireEvent.input(within(dialog).getByLabelText("配置名称"), {
      target: { value: "Ollama" },
    });
    // Ollama 无 key：key 可空，仍能保存。
    fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));
    expect(onCreateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "",
        baseUrl: "http://localhost:11434/v1",
        name: "Ollama",
      }),
    );
  });

  it("still requires a key for non-Ollama presets", () => {
    const onCreateProfile = vi.fn();
    render(<V12SettingsDrawer {...props({ onCreateProfile })} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));
    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));

    const dialog = screen.getByRole("dialog", { name: "新建语言模型配置" });
    fireEvent.input(within(dialog).getByLabelText("配置名称"), {
      target: { value: "OpenAI" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));
    expect(onCreateProfile).not.toHaveBeenCalled();
  });
});
