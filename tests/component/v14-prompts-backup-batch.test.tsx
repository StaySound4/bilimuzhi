import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
  BatchWorkspace,
  type BatchWorkspaceProps,
} from "../../src/ui/batch/batch-workspace";
import {
  InsightWorkspace,
  type InsightWorkspaceProps,
} from "../../src/ui/insights/insight-workspace";
import { createBatchJob } from "../../src/domain";
import {
  PromptManagerDialog,
  type PromptManagerDialogProps,
  type PromptManagerPreset,
} from "../../src/ui/prompts/prompt-manager-dialog";
import {
  SettingsDrawer,
  type SettingsDrawerProps,
} from "../../src/ui/settings/settings-drawer";

type PromptKind = "chat" | "summary";

interface V14PromptManagerDialogProps extends Omit<
  PromptManagerDialogProps,
  "kind" | "onCreatePreset" | "onCopyPreset"
> {
  readonly kind: PromptKind;
  readonly onCopyPreset: (presetId: string) => boolean | void;
  readonly onCreatePreset: (input: {
    readonly kind: PromptKind;
    readonly sourcePresetId: string | null;
  }) => boolean | void;
  readonly onReorderPreset: (input: {
    readonly presetId: string;
    readonly toIndex: number;
  }) => boolean | void;
}

interface V14SettingsDrawerProps extends SettingsDrawerProps {
  readonly backupCounts: {
    readonly archive: number;
    readonly languageModels: number;
    readonly prompts: { readonly chat: number; readonly summary: number };
    readonly trash: number;
    readonly workspace: number;
  };
  readonly backupSelectedGroups: readonly (
    | "api-keys"
    | "application-ai"
    | "archive"
    | "prompts"
    | "trash"
    | "workspace"
  )[];
  readonly lastBackupExportPath: string | null;
  readonly onBackupGroupChange: (input: {
    readonly group:
      | "api-keys"
      | "application-ai"
      | "archive"
      | "prompts"
      | "trash"
      | "workspace";
    readonly selected: boolean;
  }) => void;
  readonly onCopyBackupExportPath: () => void;
  readonly onOpenBackupExportFolder: () => void;
}

interface V14BatchWorkspaceProps extends BatchWorkspaceProps {
  readonly recognizedSingleVideoPages?: {
    readonly currentPage: number;
    readonly totalPages: number;
  };
  readonly singleVideoPageSelection?: "all" | "current";
  readonly onSingleVideoPageSelectionChange?: (
    selection: "all" | "current",
  ) => void;
}

const V14PromptManagerDialog =
  PromptManagerDialog as unknown as FunctionComponent<V14PromptManagerDialogProps>;
const V14SettingsDrawer =
  SettingsDrawer as FunctionComponent<V14SettingsDrawerProps>;
const V14BatchWorkspace =
  BatchWorkspace as FunctionComponent<V14BatchWorkspaceProps>;

const promptPresets: readonly PromptManagerPreset[] = Object.freeze([
  Object.freeze({
    builtIn: true,
    content:
      "只根据当前视频字幕回答问题；没有依据时明确说明，并把可验证时间标记放在观点附近。",
    id: "builtin-chat",
    name: "Bilimuzhi默认",
  }),
  Object.freeze({
    builtIn: true,
    content:
      "提炼最重要的结论、事实与必要背景，保持简洁，并为关键观点附上准确时间标记。",
    id: "builtin-summary-concise",
    name: "简要",
  }),
  Object.freeze({
    builtIn: true,
    content:
      "按内容推进总结主要观点、事实、背景和论证关系，在完整性与阅读长度之间保持平衡。",
    id: "builtin-summary-balanced",
    name: "平衡",
  }),
  Object.freeze({
    builtIn: true,
    content:
      "按章节详细总结字幕中的事实、概念背景、论证过程、反例和结论，并保留准确时间标记。",
    id: "builtin-summary-detailed",
    name: "详细",
  }),
  Object.freeze({
    builtIn: false,
    content: "团队自定义总结正文",
    id: "custom-summary-team",
    name: "团队总结",
  }),
]);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function promptManagerProps(
  overrides: Partial<V14PromptManagerDialogProps> = {},
): V14PromptManagerDialogProps {
  return {
    defaultPresetId: "builtin-summary-concise",
    kind: "summary",
    onClose: vi.fn(),
    onCopyPreset: vi.fn(),
    onCreatePreset: vi.fn(),
    onDeletePreset: vi.fn(),
    onReorderPreset: vi.fn(),
    onSelectPreset: vi.fn(),
    onSetDefaultPreset: vi.fn(),
    onUpdatePreset: vi.fn(),
    presets: promptPresets.filter(({ id }) => !id.startsWith("builtin-chat")),
    selectedPresetId: "builtin-summary-concise",
    ...overrides,
  };
}

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
  overrides: Partial<V14SettingsDrawerProps> = {},
): V14SettingsDrawerProps {
  return {
    apiKey: "",
    apiKeyConfigured: false,
    applyRetentionTo: "future",
    backupCounts: {
      archive: 4,
      languageModels: 2,
      prompts: { chat: 2, summary: 3 },
      trash: 1,
      workspace: 7,
    },
    backupSelectedGroups: ["application-ai", "prompts"],
    baseUrl: "https://api.example.test/v1",
    customRetentionDays: "30",
    exportPreference: { format: "markdown", includeTimestamps: true },
    groqApiKey: "",
    groqApiKeyConfigured: true,
    lastBackupExportPath: "C:\\Users\\tester\\Downloads\\muzhi-backup.json",
    modelId: "",
    models: [],
    onBackupGroupChange: vi.fn(),
    onClose: vi.fn(),
    onCopyBackupExportPath: vi.fn(),
    onDiscoverModels: vi.fn(),
    onExportPreferenceChange: vi.fn(),
    onModelChange: vi.fn(),
    onOpenBackupExport: vi.fn(),
    onOpenBackupExportFolder: vi.fn(),
    onOpenBackupImport: vi.fn(),
    onPromptTemplateChange: vi.fn(),
    onProviderChange: vi.fn(),
    onRetentionChange: vi.fn(),
    onSaveGroqKey: vi.fn(),
    onSaveProviderKey: vi.fn(),
    onTestProvider: vi.fn(),
    onThemeChange: vi.fn(),
    open: true,
    profiles: [],
    promptTemplate: "",
    protocol: "openai-compatible",
    providerId: "",
    providers: [],
    reasoningEffort: "",
    retention: "forever",
    selectedProfileId: "",
    taskChoices: [],
    theme: "system",
    uiLanguage: "zh-Hans",
    onUiLanguageChange: vi.fn(),
    ...overrides,
  };
}

function batchProps(
  overrides: Partial<V14BatchWorkspaceProps> = {},
): V14BatchWorkspaceProps {
  return {
    includeAllPages: false,
    input: "https://www.bilibili.com/video/BV1wyTF6ZEWb?p=2",
    hasLists: false,
    speechConfigured: true,
    speechLanguageMode: "mixed",
    speechRoutingMode: "balanced",
    onCancel: vi.fn(),
    onExport: vi.fn(),
    onIncludeAllPagesChange: vi.fn(),
    onInputChange: vi.fn(),
    onLanguagePreferenceChange: vi.fn(),
    onPrepare: vi.fn(),
    onSelectionChange: vi.fn(),
    onSingleVideoPageSelectionChange: vi.fn(),
    onStart: vi.fn(),
    onFetchByCurrentPage: vi.fn(),
    sourceKind: "single-video",
    ...overrides,
  };
}

describe("v14 A6 prompt manager public surface", () => {
  it("shows the three complete summary originals as locked read-only presets and copies without creating data", () => {
    const value = promptManagerProps();
    render(<V14PromptManagerDialog {...value} />);

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "简要（内置）",
      "平衡（内置）",
      "详细（内置）",
      "团队总结",
    ]);
    const original = screen.getByLabelText(
      "查看内置提示词原件",
    ) as HTMLTextAreaElement;
    expect(original.readOnly).toBe(true);
    expect(original.value.length).toBeGreaterThan(24);
    expect(screen.getByLabelText("内置预设已锁定")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "删除预设" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "复制到粘贴板" }));
    expect(value.onCopyPreset).toHaveBeenCalledWith("builtin-summary-concise");
    expect(value.onCreatePreset).not.toHaveBeenCalled();
  });

  it("opens an explicit blank-or-copy-source choice before creating a preset", () => {
    const value = promptManagerProps();
    render(<V14PromptManagerDialog {...value} />);

    fireEvent.click(screen.getByRole("button", { name: "新建提示词" }));
    expect(value.onCreatePreset).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "选择新建提示词来源" });
    expect(
      within(dialog).getByRole("button", { name: "新建空白提示词" }),
    ).not.toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "复制于现有预设" }),
    ).not.toBeNull();
    expect(
      within(dialog).getByRole("combobox", { name: "复制来源" }),
    ).not.toBeNull();
  });

  it("exposes drag, up and down ordering for built-in and custom presets with bounded controls", () => {
    const value = promptManagerProps({
      selectedPresetId: "custom-summary-team",
    });
    render(<V14PromptManagerDialog {...value} />);

    const list = screen.getByRole("list", { name: "总结提示词排序" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.getAttribute("draggable") === "true")).toBe(
      true,
    );
    expect(
      (
        within(rows[0]).getByRole("button", {
          name: "上移 简要",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        within(rows.at(-1)!).getByRole("button", {
          name: "下移 团队总结",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    fireEvent.click(
      within(rows.at(-1)!).getByRole("button", { name: "上移 团队总结" }),
    );
    expect(value.onReorderPreset).toHaveBeenCalledWith({
      presetId: "custom-summary-team",
      toIndex: 2,
    });
  });

  it("removes the summary-only additional-requirement field", () => {
    render(<InsightWorkspace {...insightProps()} />);
    expect(screen.queryByLabelText("附加要求（可选）")).toBeNull();
    expect(screen.queryByText("附加要求（可选）")).toBeNull();
  });
});

describe("v14 A8 backup cards", () => {
  it("renders six keyboard buttons with icons, aria-pressed and live count tooltips", () => {
    render(<V14SettingsDrawer {...settingsProps()} />);
    fireEvent.click(screen.getByRole("tab", { name: "备份" }));

    const expectations = [
      ["应用与 AI 配置", null],
      ["提示词", "对话自定义 2 个，总结自定义 3 个"],
      ["工作区会话", "7 个项目"],
      ["归档", "4 个项目"],
      ["回收站", "1 个项目"],
      ["API 与密钥", "2 个语言模型配置；包含 Groq 语音密钥"],
    ] as const;

    for (const [label, tooltip] of expectations) {
      const card = screen.getByRole("button", { name: label });
      expect(card.querySelector("svg, [data-icon]")).not.toBeNull();
      expect(["true", "false"]).toContain(card.getAttribute("aria-pressed"));
      if (tooltip === null) {
        expect(card.getAttribute("title") ?? "").not.toMatch(/0 个|0项/u);
      } else {
        expect(card.getAttribute("title")).toContain(tooltip);
      }
    }
  });

  it("shows the completed final path and safe copy/open-folder actions", () => {
    const value = settingsProps();
    render(<V14SettingsDrawer {...value} />);
    fireEvent.click(screen.getByRole("tab", { name: "备份" }));

    expect(
      screen.getByText(
        "已导出到：C:\\Users\\tester\\Downloads\\muzhi-backup.json",
      ),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "复制导出路径" }));
    fireEvent.click(screen.getByRole("button", { name: "打开所在文件夹" }));
    expect(value.onCopyBackupExportPath).toHaveBeenCalledOnce();
    expect(value.onOpenBackupExportFolder).toHaveBeenCalledOnce();
  });
});

describe("v14 A9 batch input and authorization explanation", () => {
  function viewProps() {
    const job = createBatchJob({
      batchJobId: "v14-a9-job",
      browserSessionId: "browser",
      createdAt: 1,
      method: "direct",
      sourceKind: "single-video",
      sourceLabel: "A9 列表",
      status: "ready",
      updatedAt: 1,
    });
    return {
      hasLists: true,
      view: { job, items: [], overwriteCount: 0 },
    };
  }

  it("uses a single-column source surface inside the parse dialog without redundant visible labels or a permanent long support paragraph", async () => {
    const { container } = render(
      <V14BatchWorkspace {...batchProps(viewProps())} />,
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "解析并加入列表" })[0]!,
    );
    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });

    expect(
      within(dialog).getByRole("combobox", { name: "来源类型" }),
    ).not.toBeNull();
    expect(screen.getByLabelText("批量来源")).not.toBeNull();
    expect(
      within(dialog).queryByText("来源类型", { selector: "span" }),
    ).toBeNull();
    expect(
      within(dialog).queryByText("来源地址或关键词", { selector: "span" }),
    ).toBeNull();
    expect(container.textContent).not.toContain("支持：单个视频");
    const help = within(dialog).getByRole("button", {
      name: "查看支持的批量来源",
    });
    expect(help.getAttribute("title")).toMatch(/单个视频.*用户主页.*收藏夹/u);

    const css = await readFile(
      resolve("src/ui/batch/batch-workspace.css"),
      "utf8",
    );
    const sourceRule = css.slice(
      css.indexOf(".muzhi-batch__source-row"),
      css.indexOf(".muzhi-batch__field--source-input"),
    );
    expect(sourceRule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/u);
    expect(sourceRule).not.toMatch(/0\.35fr|repeat\(2|220px/u);
  });

  it("shows current/all only for a recognized multi-P video and publishes the explicit choice", () => {
    const value = batchProps({
      ...viewProps(),
      recognizedSingleVideoPages: { currentPage: 2, totalPages: 4 },
      singleVideoPageSelection: "current",
    });
    const { rerender } = render(<V14BatchWorkspace {...value} />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "解析并加入列表" })[0]!,
    );
    const dialog = screen.getByRole("dialog", { name: "解析并加入列表" });

    expect(
      (
        within(dialog).getByRole("radio", {
          name: "仅当前分 P",
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    fireEvent.click(
      within(dialog).getByRole("radio", { name: "包含全部分 P" }),
    );
    expect(value.onSingleVideoPageSelectionChange).toHaveBeenCalledWith("all");
    expect(within(dialog).queryByText("单视频按全部分 P 展开")).toBeNull();

    rerender(
      <V14BatchWorkspace
        {...batchProps({
          ...viewProps(),
          input: "https://www.bilibili.com/video/BV1wyTF6ZEWb",
          recognizedSingleVideoPages: { currentPage: 1, totalPages: 1 },
        })}
      />,
    );
    expect(
      within(dialog).queryByRole("radio", { name: "仅当前分 P" }),
    ).toBeNull();
    expect(
      within(dialog).queryByRole("radio", { name: "包含全部分 P" }),
    ).toBeNull();
  });

  it("批量工作区的帮助按钮已迁移到 shell header(BatchWorkspace 内不再渲染)", () => {
    const onHelpClick = vi.fn();
    render(
      <V14BatchWorkspace {...batchProps({ ...viewProps(), onHelpClick })} />,
    );
    // 旧行为:批量工作区自身渲染"批量工作区帮助"按钮。
    // 新行为:按钮统一由 AiChatShell header-actions 承载(批量/会话共用,
    // 右上角紧贴主题设置),安全文案由帮助 Dialog 承载(见 ai-chat-shell.test)。
    expect(screen.queryByRole("button", { name: "批量工作区帮助" })).toBeNull();
  });
});
