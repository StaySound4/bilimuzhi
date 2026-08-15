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
    profiles: [
      {
        apiKey: { configured: true, lastFour: "4821", masked: "•••• 4821" },
        baseUrl: "https://api.openai.com/v1",
        hostPermission: "granted",
        id: "profile-openai",
        models: [],
        name: "OpenAI",
      },
    ],
    promptTemplate: "",
    protocol: "openai-compatible",
    providers: [],
    providerId: "profile-openai",
    reasoningEffort: "auto",
    retention: "30",
    selectedProfileId: "profile-openai",
    taskChoices: [],
    theme: "light",
    uiLanguage: "zh-Hans",
    ...overrides,
  };
}

afterEach(cleanup);

describe("provider protocol option (ticket 07)", () => {
  it("offers chat/completions and responses options in the create form", () => {
    render(<V12SettingsDrawer {...props()} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));
    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));

    const dialog = screen.getByRole("dialog", { name: "新建语言模型配置" });
    const select = within(dialog).getByRole("combobox", { name: "协议" });
    const options = Array.from(select.querySelectorAll("option")).map(
      (option) => option.value,
    );
    expect(options).toEqual(["openai-chat", "openai-responses"]);
    // OpenAI 官方预设默认 openai-chat，可切换到 responses。
    expect((select as HTMLSelectElement).value).toBe("openai-chat");
  });

  it("sends the selected protocol when creating a profile", () => {
    const onCreateProfile = vi.fn();
    render(<V12SettingsDrawer {...props({ onCreateProfile })} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));
    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));

    const dialog = screen.getByRole("dialog", { name: "新建语言模型配置" });
    fireEvent.input(within(dialog).getByRole("combobox", { name: "协议" }), {
      target: { value: "openai-responses" },
    });
    fireEvent.input(within(dialog).getByLabelText("配置名称"), {
      target: { value: "OpenAI Responses" },
    });
    fireEvent.input(within(dialog).getByLabelText("Base URL"), {
      target: { value: "https://api.openai.com/v1" },
    });
    fireEvent.input(within(dialog).getByLabelText("API Key"), {
      target: { value: "provider-key-for-tests-4821" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存配置" }));

    expect(onCreateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: "openai-responses",
      }),
    );
  });

  it("pre-fills the saved protocol when editing a profile", () => {
    render(
      <V12SettingsDrawer
        {...props({
          profiles: [
            {
              apiKey: {
                configured: true,
                lastFour: "4821",
                masked: "•••• 4821",
              },
              baseUrl: "https://api.example.test/v1",
              hostPermission: "granted",
              id: "profile-openai",
              models: [],
              name: "OpenAI",
            },
          ],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑配置 OpenAI" }));

    const dialog = screen.getByRole("dialog", { name: "编辑语言模型配置" });
    const select = within(dialog).getByRole("combobox", { name: "协议" });
    // 旧值协议（openai-compatible/openai）回填为 openai-chat。
    expect((select as HTMLSelectElement).value).toBe("openai-chat");
  });
});
