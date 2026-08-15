import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionWorkspaceCoordinator } from "../../src/application/session-workspace";
import {
  InsightWorkspace,
  type InsightWorkspaceProps,
} from "../../src/ui/insights/insight-workspace";
import {
  SettingsDrawer,
  type SettingsDrawerProps,
  type V12ProviderProfileOption,
  type V12TaskChoice,
} from "../../src/ui/settings/settings-drawer";

afterEach(cleanup);

const groqProfile: V12ProviderProfileOption = {
  apiKey: { configured: true, lastFour: "1300", masked: "••••1300" },
  baseUrl: "https://api.groq.com/openai/v1",
  hostPermission: "granted",
  id: "groq",
  models: [
    {
      enabled: true,
      id: "whisper-large-v3",
      label: "Whisper Large V3",
      reasoningEfforts: [],
      reasoningOverride: null,
      verification: "verified",
    },
    {
      enabled: true,
      id: "whisper-large-v3-turbo",
      label: "Whisper Large V3 Turbo",
      reasoningEfforts: [],
      reasoningOverride: null,
      verification: "verified",
    },
  ],
  name: "Groq",
};

const deepSeekProfile: V12ProviderProfileOption = {
  apiKey: { configured: true, lastFour: "5713", masked: "••••5713" },
  baseUrl: "https://api.deepseek.com",
  hostPermission: "granted",
  id: "deepseek",
  models: [
    {
      enabled: true,
      id: "deepseek-chat",
      label: "DeepSeek Chat",
      reasoningEfforts: [],
      reasoningOverride: null,
      verification: "verified",
    },
    {
      enabled: true,
      id: "deepseek-reasoner",
      label: "DeepSeek Reasoner",
      reasoningEfforts: [],
      reasoningOverride: null,
      verification: "verified",
    },
  ],
  name: "DeepSeek",
};

const taskChoices: readonly V12TaskChoice[] = [
  {
    kind: "chat",
    modelId: "deepseek-chat",
    profileId: "deepseek",
    reasoningEffort: "",
    state: "ready",
  },
  {
    kind: "summary",
    modelId: "deepseek-reasoner",
    profileId: "deepseek",
    reasoningEffort: "",
    state: "ready",
  },
  {
    kind: "segments",
    modelId: "whisper-large-v3-turbo",
    profileId: "groq",
    reasoningEffort: "",
    state: "ready",
  },
];

function insightProps(
  overrides: Partial<InsightWorkspaceProps> = {},
): InsightWorkspaceProps {
  return {
    content: "",
    hasSubtitle: true,
    instruction: "",
    kind: "summary",
    onClear: vi.fn(),
    onExport: vi.fn(),
    onGenerate: vi.fn(),
    onInstructionChange: vi.fn(),
    onStop: vi.fn(),
    phase: "idle",
    segments: [],
    ...overrides,
  };
}

function settingsProps(
  overrides: Partial<SettingsDrawerProps> = {},
): SettingsDrawerProps {
  return {
    open: true,
    apiKey: "",
    apiKeyConfigured: false,
    groqApiKey: "",
    groqApiKeyConfigured: false,
    theme: "system",
    uiLanguage: "zh-Hans",
    onUiLanguageChange: vi.fn(),
    providers: [],
    providerId: "",
    baseUrl: "",
    protocol: "openai-compatible",
    models: [],
    modelId: "",
    reasoningEffort: "",
    retention: "forever",
    customRetentionDays: "30",
    applyRetentionTo: "future",
    exportPreference: { format: "markdown", includeTimestamps: true },
    promptTemplate: "",
    profiles: [groqProfile, deepSeekProfile],
    selectedProfileId: "groq",
    taskChoices,
    onClose: vi.fn(),
    onSaveGroqKey: vi.fn(),
    onSaveProviderKey: vi.fn(),
    onTestProvider: vi.fn(),
    onThemeChange: vi.fn(),
    onProviderChange: vi.fn(),
    onDiscoverModels: vi.fn(),
    onModelChange: vi.fn(),
    onRetentionChange: vi.fn(),
    onExportPreferenceChange: vi.fn(),
    onPromptTemplateChange: vi.fn(),
    onTaskModelChange: vi.fn(),
    onCreateProfile: vi.fn(),
    onAddManualProfileModel: vi.fn(),
    onDeleteProfile: vi.fn(),
    onDiscoverProfileModels: vi.fn(),
    onReorderProfileModel: vi.fn(),
    onReorderProfile: vi.fn(),
    onCheckProfileAvailability: vi.fn(),
    onRevealProviderKey: vi.fn(async () => "non-sensitive-test-value"),
    onSetProfileModelEnabled: vi.fn(),
    onUpdateProfile: vi.fn(),
    ...overrides,
  };
}

function openModelProfiles(): void {
  fireEvent.click(screen.getByRole("tab", { name: /语言模型配置/ }));
}

describe("v13 A5 settings public surface", () => {
  it("removes summary font controls and all historical-configuration wording", () => {
    const { unmount } = render(
      <InsightWorkspace
        {...insightProps({
          content: "一段总结",
          phase: "ready",
        })}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /字体/ })).toBeNull();
    expect(screen.queryByRole("slider", { name: /字号|字体大小/ })).toBeNull();
    expect(screen.queryByText(/字体设置|总结字体/)).toBeNull();
    unmount();

    render(<SettingsDrawer {...settingsProps()} />);
    expect(document.body.textContent ?? "").not.toMatch(
      /历史配置|原有配置|旧配置|迁移配置/,
    );
  });

  it("keeps the Groq speech key as the only password field outside the edit window", () => {
    render(<SettingsDrawer {...settingsProps()} />);

    // 详情区不再有 Provider Key 输入（Q5：Key 交互收敛到编辑窗口显式回填路径）。
    openModelProfiles();
    expect(screen.queryByLabelText(/API Key|API Key.*Groq/i)).toBeNull();

    // 语音转字幕 tab 的 Groq Key 仍是 password + 唯一眼睛图标。
    fireEvent.click(screen.getByRole("tab", { name: "语音转字幕" }));
    const key = screen.getByLabelText(
      "Groq 语音转字幕 Key",
    ) as HTMLInputElement;
    expect(key.type).toBe("password");
    const eye = screen.getByRole("button", {
      name: /显示.*Key|隐藏.*Key|显示密钥|隐藏密钥/i,
    });
    expect(eye.querySelector("svg")).not.toBeNull();
    expect(
      screen.getAllByRole("button", {
        name: /显示.*Key|隐藏.*Key|显示密钥|隐藏密钥/i,
      }),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: /临时显示|替换.*密钥|替换.*Key/i }),
    ).toBeNull();
  });

  it("renders one draggable card per model with accessible up and down icon controls", () => {
    render(<SettingsDrawer {...settingsProps()} />);
    openModelProfiles();
    const list = screen.getByRole("list", { name: "Groq 模型排序" });
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(groqProfile.models.length);

    for (const [index, card] of cards.entries()) {
      expect(card.getAttribute("draggable")).toBe("true");
      const model = groqProfile.models[index];
      const up = within(card).getByRole("button", {
        name: new RegExp(`上移.*${model.label}|${model.label}.*上移`),
      });
      const down = within(card).getByRole("button", {
        name: new RegExp(`下移.*${model.label}|${model.label}.*下移`),
      });
      expect(up.querySelector("svg")).not.toBeNull();
      expect(down.querySelector("svg")).not.toBeNull();
      expect((up as HTMLButtonElement).disabled).toBe(index === 0);
      expect((down as HTMLButtonElement).disabled).toBe(
        index === cards.length - 1,
      );
    }
  });

  it("keeps the official Groq key link in the speech tab and both frozen Whisper model choices in the detail list", () => {
    render(<SettingsDrawer {...settingsProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "语音转字幕" }));
    const link = screen.getByRole("link", {
      name: /Groq.*(?:Key|密钥)|获取.*Groq/i,
    });
    expect(link.getAttribute("href")).toBe("https://console.groq.com/keys");
    expect(link.getAttribute("target")).toBe("_blank");

    openModelProfiles();
    expect(screen.getByText("whisper-large-v3")).not.toBeNull();
    expect(screen.getByText("whisper-large-v3-turbo")).not.toBeNull();
  });

  it("refreshes every settings projection immediately after a profile is deleted", async () => {
    const onDeleteProfile = vi.fn();
    const initial = settingsProps({ onDeleteProfile });
    const { rerender } = render(<SettingsDrawer {...initial} />);
    openModelProfiles();
    fireEvent.click(screen.getByRole("button", { name: "删除配置 Groq" }));
    expect(
      screen.getByRole("alertdialog", { name: "删除语言模型配置" }),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "确认删除配置" }));
    expect(onDeleteProfile).toHaveBeenCalledWith("groq");

    const projectedChoices = taskChoices.map((choice) =>
      choice.profileId === "groq"
        ? {
            ...choice,
            profileId: "deepseek",
            modelId: "deepseek-chat",
            state: "needs-reselection" as const,
          }
        : choice,
    );
    rerender(
      <SettingsDrawer
        {...settingsProps({
          profiles: [deepSeekProfile],
          selectedProfileId: "deepseek",
          taskChoices: projectedChoices,
          onDeleteProfile,
        })}
      />,
    );

    await waitFor(() => expect(screen.queryByText("Groq")).toBeNull());
    expect(
      screen.getByRole("button", { name: "选择配置 DeepSeek" }),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("whisper-large-v3-turbo");
    // 设置页不再提供任务模型集中配置（分散到各模式界面顶部）。
    expect(screen.queryByRole("tab", { name: "任务模型" })).toBeNull();
  });
});

describe("v13 A7 empty-session creation contract", () => {
  it("creates a distinct selected empty session on every request and fills the smallest title gap", async () => {
    const sessions = [
      {
        sessionId: "session-existing-1",
        title: "新建会话1",
        branchIds: [],
        pinned: false,
        sortOrder: 0,
        video: null,
      },
      {
        sessionId: "session-existing-3",
        title: "新建会话3",
        branchIds: [],
        pinned: false,
        sortOrder: 1,
        video: null,
      },
    ];
    const created: Array<Record<string, unknown>> = [];
    const repositoryTarget: Record<string, unknown> = {
      list: vi.fn(async () => [...sessions, ...created]),
      listByUpdatedAt: vi.fn(async () => [...sessions, ...created]),
      createEmpty: vi.fn(async (input: Record<string, unknown>) => {
        const value = {
          ...input,
          sessionId: `session-created-${created.length + 1}`,
          branchIds: [],
          pinned: false,
          sortOrder: sessions.length + created.length,
          video: null,
        };
        created.push(value);
        return value;
      }),
    };
    const repository = new Proxy(repositoryTarget, {
      get(target, property) {
        if (property in target) return target[property as string];
        return vi.fn(async () => undefined);
      },
    });
    const coordinator = createSessionWorkspaceCoordinator({
      gateway: { resolveCurrentVideo: vi.fn(async () => null) },
      repository,
      restorationRepository: { restoreWorkspace: vi.fn(async () => null) },
      stateStore: {
        load: vi.fn(async () => ({ activeSessionId: "session-existing-1" })),
        save: vi.fn(async () => undefined),
      },
    } as never) as unknown as {
      createSession?: () => Promise<{
        sessions: Array<Record<string, unknown>>;
        restoredWorkspace: { session: { sessionId: string } };
      }>;
    };

    expect(coordinator.createSession).toBeTypeOf("function");
    const first = await coordinator.createSession!();
    const second = await coordinator.createSession!();
    expect(created.map((session) => session.sessionId)).toEqual([
      "session-created-1",
      "session-created-2",
    ]);
    expect(created.map((session) => session.title)).toEqual([
      "新建会话2",
      "新建会话4",
    ]);
    expect(first.restoredWorkspace.session.sessionId).toBe("session-created-1");
    expect(second.restoredWorkspace.session.sessionId).toBe(
      "session-created-2",
    );
  });

  it("keeps a newly created session when page sync is non-video or fails and rejects a late owner revision", async () => {
    const coordinator = createSessionWorkspaceCoordinator({
      gateway: { resolveCurrentVideo: vi.fn(async () => null) },
      repository: new Proxy({}, { get: () => vi.fn(async () => []) }),
      restorationRepository: { restoreWorkspace: vi.fn(async () => null) },
      stateStore: {
        load: vi.fn(async () => null),
        save: vi.fn(async () => undefined),
      },
    } as never) as unknown as {
      createSession?: (
        input?: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      synchronizeCreatedSession?: (
        input: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
    };

    expect(coordinator.createSession).toBeTypeOf("function");
    expect(coordinator.synchronizeCreatedSession).toBeTypeOf("function");
    const snapshot = await coordinator.createSession!();
    const selected = (snapshot.restoredWorkspace as Record<string, unknown>)
      .session as Record<string, unknown>;

    const afterNoVideo = await coordinator.synchronizeCreatedSession!({
      sessionId: selected.sessionId,
      pageRevision: 2,
      video: null,
    });
    expect(
      (afterNoVideo.restoredWorkspace as Record<string, unknown>).session,
    ).toMatchObject({
      sessionId: selected.sessionId,
    });

    await expect(
      coordinator.synchronizeCreatedSession!({
        sessionId: selected.sessionId,
        pageRevision: 1,
        video: { bvid: "BV1-late-owner", cid: "late-cid" },
      }),
    ).rejects.toMatchObject({ code: "STALE_REQUEST_OWNER" });
  });
});
