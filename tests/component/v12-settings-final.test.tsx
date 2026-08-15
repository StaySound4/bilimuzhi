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

type TaskKind = "chat" | "segments" | "summary";

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

interface V12TaskChoice {
  readonly kind: TaskKind;
  readonly modelId: string;
  readonly profileId: string;
  readonly reasoningEffort: string;
  readonly state: "ready" | "needs-reselection";
}

interface V12SettingsDrawerProps extends SettingsDrawerProps {
  readonly groqKeyProjection: {
    readonly configured: boolean;
    readonly lastFour: string | null;
    readonly masked: string;
  };
  readonly onCreateProfile: () => void;
  readonly onCheckProfileAvailability: (profileId: string) => void;
  readonly onDeleteProfile: (profileId: string) => void;
  readonly onOpenBackupExport: () => void;
  readonly onOpenBackupImport: () => void;
  readonly onReorderProfile: (input: {
    readonly profileId: string;
    readonly toIndex: number;
  }) => void;
  readonly onRevealProviderKey: (profileId: string) => Promise<string>;
  readonly profiles: readonly V12ProfileOption[];
  readonly selectedProfileId: string;
  readonly taskChoices: readonly V12TaskChoice[];
}

const V12SettingsDrawer =
  SettingsDrawer as FunctionComponent<V12SettingsDrawerProps>;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function v12Props(
  overrides: Partial<V12SettingsDrawerProps> = {},
): V12SettingsDrawerProps {
  return {
    apiKey: "",
    apiKeyConfigured: true,
    applyRetentionTo: "future",
    baseUrl: "https://alpha.example.test/v1",
    customRetentionDays: "14",
    exportPreference: { format: "txt", includeTimestamps: true },
    groqApiKey: "",
    groqApiKeyConfigured: true,
    groqKeyProjection: {
      configured: true,
      lastFour: "5519",
      masked: "•••• 5519",
    },
    modelId: "alpha-chat",
    models: [
      {
        id: "alpha-chat",
        label: "Alpha Chat",
        reasoningEfforts: ["low", "high"],
      },
    ],
    onClose: vi.fn(),
    onAddManualProfileModel: vi.fn(),
    onCreateProfile: vi.fn(),
    onDeleteProfile: vi.fn(),
    onDiscoverModels: vi.fn(),
    onExportPreferenceChange: vi.fn(),
    onModelChange: vi.fn(),
    onOpenBackupExport: vi.fn(),
    onOpenBackupImport: vi.fn(),
    onPromptTemplateChange: vi.fn(),
    onProviderChange: vi.fn(),
    onReorderProfileModel: vi.fn(),
    onReorderProfile: vi.fn(),
    onCheckProfileAvailability: vi.fn(),
    onRetentionChange: vi.fn(),
    onRevealProviderKey: vi.fn(async () => "provider-key-for-tests-4821"),
    onSaveGroqKey: vi.fn(),
    onSaveProviderKey: vi.fn(),
    onSetProfileModelEnabled: vi.fn(),
    onTestProvider: vi.fn(),
    onThemeChange: vi.fn(),
    onUpdateProfile: vi.fn(),
    open: true,
    profiles: [
      {
        apiKey: {
          configured: true,
          lastFour: "4821",
          masked: "•••• 4821",
        },
        baseUrl: "https://alpha.example.test/v1",
        hostPermission: "granted",
        id: "profile-alpha",
        models: [
          {
            enabled: true,
            id: "alpha-chat",
            label: "Alpha Chat",
            reasoningEfforts: ["low", "high"],
            reasoningOverride: null,
            verification: "verified",
          },
          {
            enabled: true,
            id: "alpha-summary",
            label: "Alpha Summary（未验证）",
            reasoningEfforts: [],
            reasoningOverride: null,
            verification: "unverified",
          },
        ],
        name: "配置1",
      },
      {
        apiKey: { configured: false, lastFour: null, masked: "未保存" },
        baseUrl: "https://beta.example.test/v1",
        hostPermission: "missing",
        id: "profile-beta",
        models: [
          {
            enabled: true,
            id: "beta-segments",
            label: "Beta Segments",
            reasoningEfforts: ["low"],
            reasoningOverride: null,
            verification: "verified",
          },
        ],
        name: "团队 Beta",
      },
    ],
    promptTemplate: "",
    protocol: "openai-compatible",
    providerId: "profile-alpha",
    providers: [{ id: "profile-alpha", label: "配置1" }],
    reasoningEffort: "high",
    retention: "7",
    selectedProfileId: "profile-alpha",
    taskChoices: [
      {
        kind: "chat",
        modelId: "alpha-chat",
        profileId: "profile-alpha",
        reasoningEffort: "high",
        state: "ready",
      },
      {
        kind: "summary",
        modelId: "alpha-summary",
        profileId: "profile-alpha",
        reasoningEffort: "provider-default",
        state: "ready",
      },
      {
        kind: "segments",
        modelId: "beta-segments",
        profileId: "profile-beta",
        reasoningEffort: "low",
        state: "needs-reselection",
      },
    ],
    theme: "system",
    uiLanguage: "zh-Hans",
    onUiLanguageChange: vi.fn(),
    ...overrides,
  };
}

describe("v12 final settings UI (A11-A13)", () => {
  it("reveals the saved Groq key into the input when the eye is clicked on an empty configured field", async () => {
    const onRevealGroqKey = vi.fn(async () => "groq-secret-9876");
    render(
      <V12SettingsDrawer
        {...v12Props({
          onRevealGroqKey,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "语音转字幕" }));
    const input = screen.getByLabelText(
      "Groq 语音转字幕 Key",
    ) as HTMLInputElement;
    // 已配置但输入框为空:默认遮罩。
    expect(input.type).toBe("password");
    expect(input.value).toBe("");

    // 点眼睛:通过 reveal 取回明文并显示。
    fireEvent.click(screen.getByRole("button", { name: "显示密钥" }));
    await vi.waitFor(() => {
      expect(onRevealGroqKey).toHaveBeenCalledOnce();
    });
    await vi.waitFor(() => {
      expect(input.type).toBe("text");
    });
    expect(input.value).toBe("groq-secret-9876");

    // 再点:恢复遮罩。
    fireEvent.click(screen.getByRole("button", { name: "隐藏密钥" }));
    expect(input.type).toBe("password");
  });

  it("toggles the eye locally without reveal when the user already typed a draft", () => {
    const onRevealGroqKey = vi.fn(async () => "should-not-be-called");
    render(
      <V12SettingsDrawer
        {...v12Props({
          onRevealGroqKey,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "语音转字幕" }));
    const input = screen.getByLabelText(
      "Groq 语音转字幕 Key",
    ) as HTMLInputElement;
    fireEvent.input(input, { target: { value: "gsk-typed-draft" } });
    fireEvent.click(screen.getByRole("button", { name: "显示密钥" }));
    expect(onRevealGroqKey).not.toHaveBeenCalled();
    expect(input.type).toBe("text");
    expect(input.value).toBe("gsk-typed-draft");
  });

  it("exposes only Appearance, Speech, Language Models, Task Models, and Backup settings pages", () => {
    render(<V12SettingsDrawer {...v12Props()} />);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "外观",
      "语言",
      "语音转字幕",
      "语言模型配置",
      "备份",
    ]);
    expect(screen.queryByRole("tab", { name: "提示词" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "缓存" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "关于" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "导出" })).toBeNull();
  });

  it("renders ordered provider profiles with CRUD, manual-model, enablement, and ordering controls but no test-and-discover action", () => {
    const value = v12Props();
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    expect(
      screen.getByRole("button", { name: "新建语言模型配置" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("list", { name: "语言模型配置排序" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "上移配置 配置1" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "删除配置 配置1" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("button", { name: /测试.*探测.*配置1/ }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "为 配置1 手工添加模型" }),
    ).not.toBeNull();
    expect(
      (
        screen.getByRole("checkbox", {
          name: "启用模型 Alpha Chat",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(screen.getByText("Alpha Summary（未验证）")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "上移模型 Alpha Summary" }),
    ).not.toBeNull();

    fireEvent.input(screen.getByLabelText("配置1 手工模型 ID"), {
      target: { value: "alpha-manual" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "为 配置1 手工添加模型" }),
    );
    expect(value.onAddManualProfileModel).toHaveBeenCalledWith({
      modelId: "alpha-manual",
      profileId: "profile-alpha",
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "启用模型 Alpha Chat" }),
    );
    expect(value.onSetProfileModelEnabled).toHaveBeenCalledWith({
      enabled: false,
      modelId: "alpha-chat",
      profileId: "profile-alpha",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "上移模型 Alpha Summary" }),
    );
    expect(value.onReorderProfileModel).toHaveBeenCalledWith({
      modelId: "alpha-summary",
      profileId: "profile-alpha",
      toIndex: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "上移配置 团队 Beta" }));
    expect(value.onReorderProfile).toHaveBeenCalledWith({
      profileId: "profile-beta",
      toIndex: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));
    expect(
      screen.getByRole("dialog", { name: "新建语言模型配置" }),
    ).not.toBeNull();
    const createDialog = screen.getByRole("dialog", {
      name: "新建语言模型配置",
    });
    fireEvent.input(within(createDialog).getByLabelText("配置名称"), {
      target: { value: "新配置" },
    });
    fireEvent.input(within(createDialog).getByLabelText("API Key"), {
      target: { value: "sk-new-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(value.onCreateProfile).toHaveBeenCalledWith({
      apiKey: "sk-new-key",
      baseUrl: "https://api.openai.com/v1",
      name: "新配置",
      protocol: "openai-chat",
    });
    fireEvent.click(screen.getByRole("button", { name: "删除配置 团队 Beta" }));
    expect(
      screen.getByRole("alertdialog", { name: "删除语言模型配置" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认删除配置" }));
    expect(value.onDeleteProfile).toHaveBeenCalledWith("profile-beta");
  });

  it("retains an optional-permission-denied profile and displays the exact origin without ever offering all_urls", () => {
    render(
      <V12SettingsDrawer
        {...v12Props({ selectedProfileId: "profile-beta" })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));
    fireEvent.click(screen.getByRole("button", { name: "选择配置 团队 Beta" }));

    expect(screen.getByText("https://beta.example.test/v1")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "缺少精确主机权限，请先检测可用性。",
    );
    expect(document.body.textContent).not.toContain("<all_urls>");
    expect(
      screen.getByRole("button", { name: "检测 团队 Beta 可用性" }),
    ).not.toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "获取 团队 Beta 可用模型",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("keeps full keys out of the detail area and only reveals them through the explicit edit window", () => {
    const value = v12Props();
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));

    // 详情区不再有任何密钥输入；完整 Key 永不进入普通投影。
    expect(screen.queryByLabelText("配置1 API Key")).toBeNull();
    expect(document.body.innerHTML).not.toContain(
      "provider-key-for-tests-4821",
    );
    expect(value.onRevealProviderKey).not.toHaveBeenCalled();

    // 显式回填路径：打开编辑窗口才读取真实 Key。
    fireEvent.click(screen.getByRole("button", { name: "编辑配置 配置1" }));
    expect(value.onRevealProviderKey).toHaveBeenCalledWith("profile-alpha");
  });

  it("guards the detail probe buttons on missing permission and missing key", () => {
    const value = v12Props({ selectedProfileId: "profile-beta" });
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));
    fireEvent.click(screen.getByRole("button", { name: "选择配置 团队 Beta" }));

    // Beta 缺少主机权限且未保存 Key：检测可用性可点，获取模型禁用。
    expect(
      (
        screen.getByRole("button", {
          name: "检测 团队 Beta 可用性",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "获取 团队 Beta 可用模型",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("places Backup last and exposes six independent aria-pressed cards plus password and import-preflight controls", () => {
    const value = v12Props();
    render(<V12SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "备份" }));

    for (const group of [
      "应用与 AI 配置",
      "提示词",
      "工作区会话",
      "归档",
      "回收站",
    ]) {
      const card = screen.getByRole("button", { name: group });
      expect(card.getAttribute("aria-pressed")).toBe("true");
      expect(card.querySelector("svg")).not.toBeNull();
    }
    expect(screen.queryByRole("button", { name: /外观|主题/ })).toBeNull();
    const keyCard = screen.getByRole("button", { name: "API 与密钥" });
    expect(keyCard.getAttribute("aria-pressed")).toBe("false");
    expect(keyCard.querySelector("svg")).not.toBeNull();
    expect(screen.getByLabelText("备份密码（可选）")).not.toBeNull();
    expect(screen.getByRole("button", { name: "导出所选备份" })).not.toBeNull();
    expect(screen.getByLabelText("选择备份文件")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "导出所选备份" }));
    expect(value.onOpenBackupExport).toHaveBeenCalledOnce();
  });
});
