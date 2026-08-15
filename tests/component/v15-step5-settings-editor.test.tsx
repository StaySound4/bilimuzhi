import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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

interface V15Step5DrawerProps extends SettingsDrawerProps {
  readonly groqKeyProjection: {
    readonly configured: boolean;
    readonly lastFour: string | null;
    readonly masked: string;
  };
  readonly onCreateProfile: (input: {
    readonly apiKey: string;
    readonly baseUrl: string;
    readonly name: string;
  }) => void;
  readonly onDeleteProfile: (profileId: string) => void;
  readonly onDeleteProfileModel: (input: {
    readonly modelId: string;
    readonly profileId: string;
  }) => void;
  readonly onDeleteProviderKey: (profileId: string) => void;
  readonly onOpenBackupExport: () => void;
  readonly onOpenBackupImport: () => void;
  readonly onReorderProfile: (input: {
    readonly profileId: string;
    readonly toIndex: number;
  }) => void;
  readonly onReplaceProviderKey: (input: {
    readonly apiKey: string;
    readonly profileId: string;
  }) => boolean | Promise<boolean>;
  readonly onRevealProviderKey: (profileId: string) => Promise<string>;
  readonly onUpdateProfile: (input: {
    readonly apiKey?: string;
    readonly baseUrl: string;
    readonly name?: string;
    readonly profileId: string;
  }) => void;
  readonly profiles: readonly V12ProfileOption[];
  readonly selectedProfileId: string;
  readonly taskChoices: readonly V12TaskChoice[];
}

const V15SettingsDrawer =
  SettingsDrawer as FunctionComponent<V15Step5DrawerProps>;

afterEach(cleanup);

const alphaProfile: V12ProfileOption = {
  apiKey: { configured: true, lastFour: "4821", masked: "•••• 4821" },
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
};

const betaProfile: V12ProfileOption = {
  apiKey: { configured: false, lastFour: null, masked: "未保存" },
  baseUrl: "https://beta.example.test/v1",
  hostPermission: "missing",
  id: "profile-beta",
  models: [],
  name: "团队 Beta",
};

const taskChoices: readonly V12TaskChoice[] = [
  {
    kind: "chat",
    modelId: "alpha-chat",
    profileId: "profile-alpha",
    reasoningEffort: "low",
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
    modelId: "",
    profileId: "profile-beta",
    reasoningEffort: "provider-default",
    state: "needs-reselection",
  },
];

function step5Props(
  overrides: Partial<V15Step5DrawerProps> = {},
): V15Step5DrawerProps {
  return {
    apiKey: "",
    apiKeyConfigured: false,
    applyRetentionTo: "future",
    baseUrl: "",
    customRetentionDays: "14",
    exportPreference: { format: "txt", includeTimestamps: true },
    groqApiKey: "",
    groqApiKeyConfigured: false,
    groqKeyProjection: {
      configured: false,
      lastFour: null,
      masked: "未保存",
    },
    modelId: "",
    models: [],
    open: true,
    onClose: vi.fn(),
    onCreateProfile: vi.fn(),
    onDeleteProfile: vi.fn(),
    onDeleteProfileModel: vi.fn(),
    onDeleteProviderKey: vi.fn(),
    onDiscoverModels: vi.fn(),
    onExportPreferenceChange: vi.fn(),
    onModelChange: vi.fn(),
    onOpenBackupExport: vi.fn(),
    onOpenBackupImport: vi.fn(),
    onPromptTemplateChange: vi.fn(),
    onProviderChange: vi.fn(),
    onReorderProfile: vi.fn(),
    onReplaceProviderKey: vi.fn(async () => true),
    onRevealProviderKey: vi.fn(async () => "real-secret-key-4821"),
    onRetentionChange: vi.fn(),
    onSaveGroqKey: vi.fn(),
    onSaveProviderKey: vi.fn(),
    onTaskModelChange: vi.fn(),
    onTestProvider: vi.fn(),
    onThemeChange: vi.fn(),
    onUpdateProfile: vi.fn(),
    profiles: [alphaProfile, betaProfile],
    promptTemplate: "",
    protocol: "openai-compatible",
    providerId: "",
    providers: [],
    reasoningEffort: "",
    retention: "forever",
    selectedProfileId: "profile-alpha",
    taskChoices,
    theme: "system",
    uiLanguage: "zh-Hans",
    onUiLanguageChange: vi.fn(),
    ...overrides,
  };
}

function openLanguageModels(): void {
  fireEvent.click(screen.getByRole("tab", { name: "语言模型配置" }));
}

describe("v15 step5 profile editor window and card icon actions", () => {
  it("opens a create window with provider, name, URL, and key fields and saves only valid input", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();

    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));
    expect(
      screen.getByRole("dialog", { name: "新建语言模型配置" }),
    ).not.toBeNull();

    const dialog = screen.getByRole("dialog", { name: "新建语言模型配置" });
    const name = within(dialog).getByLabelText("配置名称") as HTMLInputElement;
    const baseUrl = within(dialog).getByLabelText(
      "Base URL",
    ) as HTMLInputElement;
    const apiKey = within(dialog).getByLabelText("API Key") as HTMLInputElement;

    // 全空保存：内联报错、不关窗、不保存。
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(screen.getByRole("alert").textContent).toContain("配置名称");
    expect(value.onCreateProfile).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "新建语言模型配置" }),
    ).not.toBeNull();

    // 名称重复：报错不保存。
    fireEvent.input(name, { target: { value: "配置1" } });
    fireEvent.input(baseUrl, {
      target: { value: "https://new.example.test/v1" },
    });
    fireEvent.input(apiKey, { target: { value: "sk-new-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(screen.getByRole("alert").textContent).toContain("已存在");
    expect(value.onCreateProfile).not.toHaveBeenCalled();

    // 名称合法后保存成功，字段透传。
    fireEvent.input(name, { target: { value: "  新配置  " } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(value.onCreateProfile).toHaveBeenCalledWith({
      apiKey: "sk-new-key",
      baseUrl: "https://new.example.test/v1",
      name: "新配置",
      protocol: "openai-chat",
    });
  });

  it("keeps the modal confirmation layer above the row menus in the settings stack", async () => {
    const css = await readFile(
      resolve("src/ui/settings/settings-drawer.css"),
      "utf8",
    );
    // 编辑/删除确认层必须高于行内三点菜单（z-index 20）。
    expect(css).toMatch(
      /\.muzhi-settings__confirmation-layer\s*\{[^}]*z-index:\s*40;/s,
    );
    expect(css).toMatch(
      /\.muzhi-settings__(?:profile|model)-order-actions\s*\{[^}]*z-index:\s*20;/s,
    );
  });

  it("closes the row menu when edit opens the modal layer so it never covers the window", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();

    fireEvent.click(screen.getByRole("button", { name: "配置操作 配置1" }));
    expect(
      document.querySelector(".muzhi-settings__row-menu[open]"),
    ).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "编辑配置 配置1" }));
    // 编辑窗口弹出时三点菜单必须已收起，不再遮挡对话框。
    expect(
      document.querySelector(".muzhi-settings__row-menu[open]"),
    ).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "编辑语言模型配置" }),
    ).not.toBeNull();
  });

  it("prefills built-in provider recommended URL when the provider changes", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));

    const dialog = screen.getByRole("dialog", { name: "新建语言模型配置" });
    const provider = within(dialog).getByLabelText(
      "Provider",
    ) as HTMLSelectElement;
    fireEvent.input(provider, { target: { value: "deepseek" } });
    const baseUrl = within(dialog).getByLabelText(
      "Base URL",
    ) as HTMLInputElement;
    expect(baseUrl.value).toBe("https://api.deepseek.com");
  });

  it("opens an edit window prefilled from the profile and passes name/URL/key through on save", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();

    fireEvent.click(screen.getByRole("button", { name: "编辑配置 配置1" }));
    const dialog = screen.getByRole("dialog", { name: "编辑语言模型配置" });
    expect(dialog).not.toBeNull();
    expect(
      (within(dialog).getByLabelText("配置名称") as HTMLInputElement).value,
    ).toBe("配置1");
    expect(
      (within(dialog).getByLabelText("Base URL") as HTMLInputElement).value,
    ).toBe("https://alpha.example.test/v1");

    fireEvent.input(within(dialog).getByLabelText("API Key"), {
      target: { value: "sk-edited-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(value.onUpdateProfile).toHaveBeenCalledWith({
      apiKey: "sk-edited-key",
      baseUrl: "https://alpha.example.test/v1",
      name: "配置1",
      profileId: "profile-alpha",
      protocol: "openai-chat",
    });
  });

  it("keeps card icon actions in a fixed edit/delete/up/down order with accessible labels", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();

    const list = screen.getByRole("list", { name: "语言模型配置排序" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(2);

    const firstCardActions = within(cards[0]!).getAllByRole("button");
    const firstLabels = firstCardActions.map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(firstLabels.slice(-4)).toEqual([
      "编辑配置 配置1",
      "删除配置 配置1",
      "上移配置 配置1",
      "下移配置 配置1",
    ]);

    const down = within(cards[0]!).getByRole("button", {
      name: "下移配置 配置1",
    });
    expect(down.querySelector("svg")).not.toBeNull();
    fireEvent.click(down);
    expect(value.onReorderProfile).toHaveBeenCalledWith({
      profileId: "profile-alpha",
      toIndex: 1,
    });

    const lastCardUp = within(cards[1]!).getByRole("button", {
      name: "上移配置 团队 Beta",
    });
    fireEvent.click(lastCardUp);
    expect(value.onReorderProfile).toHaveBeenLastCalledWith({
      profileId: "profile-beta",
      toIndex: 0,
    });
  });

  it("shows the affected task choices before deleting a profile and only removes after confirmation", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();

    fireEvent.click(screen.getByRole("button", { name: "删除配置 配置1" }));
    expect(
      screen.getByRole("alertdialog", { name: "删除语言模型配置" }),
    ).not.toBeNull();
    expect(screen.getByText("受影响任务：对话、总结")).not.toBeNull();
    expect(value.onDeleteProfile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认删除配置" }));
    expect(value.onDeleteProfile).toHaveBeenCalledWith("profile-alpha");
  });

  it("supports deleting and editing a model from its card", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "选择配置 配置1" }));

    const list = screen.getByRole("list", { name: "配置1 模型排序" });
    const cards = within(list).getAllByRole("listitem");
    const chatCard = cards.find((card) =>
      card.textContent?.includes("Alpha Chat"),
    )!;

    const modelActions = within(chatCard).getAllByRole("button");
    const modelLabels = modelActions.map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(modelLabels).toContain("编辑模型 Alpha Chat");
    expect(modelLabels).toContain("删除模型 Alpha Chat");

    fireEvent.click(
      within(chatCard).getByRole("button", { name: "删除模型 Alpha Chat" }),
    );
    expect(
      screen.getByRole("alertdialog", { name: "删除模型" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认删除模型" }));
    expect(value.onDeleteProfileModel).toHaveBeenCalledWith({
      modelId: "alpha-chat",
      profileId: "profile-alpha",
    });

    fireEvent.click(
      within(chatCard).getByRole("button", { name: "编辑模型 Alpha Chat" }),
    );
    const modelDialog = screen.getByRole("dialog", { name: "编辑模型" });
    expect(modelDialog).not.toBeNull();
    expect(
      (within(modelDialog).getByLabelText("模型 ID") as HTMLInputElement).value,
    ).toBe("alpha-chat");
  });

  it("renders profile cards with name and status without historical migration wording", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();

    expect(screen.getAllByText("配置1").length).toBeGreaterThan(0);
    expect(screen.getByText("团队 Beta")).not.toBeNull();
    const bodyText = document.body.textContent ?? "";
    expect(bodyText).toContain("•••• 4821");
    expect(bodyText).toContain("未保存");
    expect(screen.getByText("缺少主机权限", { exact: false })).not.toBeNull();
    expect(bodyText).not.toMatch(/原有配置|旧设置|迁移配置/);
  });

  it("keeps the create-window API key fully empty without masked placeholder residue", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));
    const dialog = screen.getByRole("dialog", { name: "新建语言模型配置" });
    const apiKey = within(dialog).getByLabelText("API Key") as HTMLInputElement;
    expect(apiKey.value).toBe("");
    expect(apiKey.placeholder).toBe("输入 API Key");
    expect(apiKey.placeholder).not.toContain("••••");
  });

  it("refills the real key into the edit window and lets the eye toggle reveal for copying", async () => {
    const onRevealProviderKey = vi.fn(async () => "real-secret-key-4821");
    const value = step5Props({ onRevealProviderKey });
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "编辑配置 配置1" }));
    const dialog = screen.getByRole("dialog", { name: "编辑语言模型配置" });
    const apiKey = within(dialog).getByLabelText("API Key") as HTMLInputElement;
    await waitFor(() =>
      expect(onRevealProviderKey).toHaveBeenCalledWith("profile-alpha"),
    );
    await waitFor(() => expect(apiKey.value).toBe("real-secret-key-4821"));
    expect(apiKey.type).toBe("password");
    fireEvent.click(within(dialog).getByRole("button", { name: "显示密钥" }));
    expect(apiKey.type).toBe("text");
    expect(apiKey.value).toBe("real-secret-key-4821");
    expect(apiKey.placeholder).not.toContain("••••");
  });

  it("keeps the saved key when editing only the name without retyping", async () => {
    const onUpdateProfile = vi.fn();
    const value = step5Props({
      onRevealProviderKey: vi.fn(async () => "real-secret-key-4821"),
      onUpdateProfile,
    });
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "编辑配置 配置1" }));
    const dialog = screen.getByRole("dialog", { name: "编辑语言模型配置" });
    await waitFor(() => expect(value.onUpdateProfile).not.toHaveBeenCalled());
    fireEvent.input(within(dialog).getByLabelText("配置名称"), {
      target: { value: "新名字" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() =>
      expect(onUpdateProfile).toHaveBeenCalledWith({
        baseUrl: "https://alpha.example.test/v1",
        name: "新名字",
        profileId: "profile-alpha",
        protocol: "openai-chat",
      }),
    );
    expect(onUpdateProfile.mock.calls[0]![0].apiKey).toBeUndefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("replaces the key only when the user types a new one into the edit window", async () => {
    const value = step5Props({
      onRevealProviderKey: vi.fn(async () => "real-secret-key-4821"),
    });
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "编辑配置 配置1" }));
    const dialog = screen.getByRole("dialog", { name: "编辑语言模型配置" });
    const apiKey = within(dialog).getByLabelText("API Key") as HTMLInputElement;
    await waitFor(() => expect(apiKey.value).toBe("real-secret-key-4821"));
    fireEvent.input(apiKey, { target: { value: "sk-replacement-key" } });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    await waitFor(() =>
      expect(value.onUpdateProfile).toHaveBeenCalledWith({
        apiKey: "sk-replacement-key",
        baseUrl: "https://alpha.example.test/v1",
        name: "配置1",
        profileId: "profile-alpha",
        protocol: "openai-chat",
      }),
    );
  });

  it("keeps the confirm layer open and the card visible when deletion fails", async () => {
    const onDeleteProfile = vi.fn(async () => false);
    const value = step5Props({ onDeleteProfile });
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "删除配置 配置1" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除配置" }));
    await waitFor(() =>
      expect(onDeleteProfile).toHaveBeenCalledWith("profile-alpha"),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("alertdialog", { name: "删除语言模型配置" }),
      ).not.toBeNull(),
    );
    expect(screen.getAllByText("配置1").length).toBeGreaterThan(0);
  });

  it("closes the confirm layer and removes the card after a successful delete", async () => {
    const onDeleteProfile = vi.fn(async () => true);
    const value = step5Props({ onDeleteProfile });
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "删除配置 配置1" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除配置" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("alertdialog", { name: "删除语言模型配置" }),
      ).toBeNull(),
    );
  });

  it("shows the two-step probe actions in the detail area and gates model fetching on permission", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();

    // 详情区只保留探测操作与手工模型 ID，不再有重复 Key 输入。
    expect(screen.queryByLabelText(/API Key|保存密钥/)).toBeNull();

    // alpha 权限已就绪：获取可用模型可点。
    fireEvent.click(screen.getByRole("button", { name: "选择配置 配置1" }));
    expect(
      screen.getByRole("button", { name: "检测 配置1 可用性" }),
    ).not.toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: "获取 配置1 可用模型",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);

    // beta 缺少权限：获取按钮禁用。
    fireEvent.click(screen.getByRole("button", { name: "选择配置 团队 Beta" }));
    expect(
      (
        screen.getByRole("button", {
          name: "获取 团队 Beta 可用模型",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "缺少精确主机权限",
    );
  });

  it("still requires a key when creating a new configuration", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();
    fireEvent.click(screen.getByRole("button", { name: "新建语言模型配置" }));
    const dialog = screen.getByRole("dialog", { name: "新建语言模型配置" });
    fireEvent.input(within(dialog).getByLabelText("配置名称"), {
      target: { value: "全新配置" },
    });
    fireEvent.input(within(dialog).getByLabelText("Base URL"), {
      target: { value: "https://fresh.example.test/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));
    expect(screen.getByRole("alert").textContent).toContain("API Key 不能为空");
    expect(value.onCreateProfile).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "新建语言模型配置" }),
    ).not.toBeNull();
  });
});

describe("Ticket 13 settings row hierarchy", () => {
  it("groups profile/model actions behind one overflow while preserving reorder", () => {
    const value = step5Props();
    render(<V15SettingsDrawer {...value} />);
    openLanguageModels();

    const profileList = screen.getByRole("list", { name: "语言模型配置排序" });
    const profileCard = within(profileList).getAllByRole("listitem")[0]!;
    const profileMenu = within(profileCard).getByRole("group");
    expect(
      within(profileMenu).getByRole("button", { name: "配置操作 配置1" }),
    ).not.toBeNull();
    fireEvent.click(
      within(profileMenu).getByRole("button", { name: "下移配置 配置1" }),
    );
    expect(value.onReorderProfile).toHaveBeenCalledWith({
      profileId: "profile-alpha",
      toIndex: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: "选择配置 配置1" }));
    const modelList = screen.getByRole("list", { name: "配置1 模型排序" });
    const modelCard = within(modelList).getAllByRole("listitem")[0]!;
    const modelMenu = within(modelCard).getByRole("group");
    expect(
      within(modelMenu).getByRole("button", { name: "模型操作 Alpha Chat" }),
    ).not.toBeNull();
    expect(
      within(modelMenu).getByRole("button", { name: "删除模型 Alpha Chat" }),
    ).not.toBeNull();
  });
});
