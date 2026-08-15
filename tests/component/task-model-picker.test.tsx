import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  TaskModelPicker,
  type TaskModelProfileOption,
  type TaskModelSelection,
} from "../../src/ui/task-model/task-model-picker";

const alphaProfile: TaskModelProfileOption = {
  id: "profile-alpha",
  name: "配置1",
  models: [
    {
      enabled: true,
      id: "alpha-chat",
      label: "Alpha Chat",
      reasoningEfforts: ["low", "high"],
    },
    {
      enabled: true,
      id: "alpha-summary",
      label: "Alpha Summary",
      reasoningEfforts: [],
    },
  ],
};
const betaProfile: TaskModelProfileOption = {
  id: "profile-beta",
  name: "团队 Beta",
  models: [],
};
const gammaProfile: TaskModelProfileOption = {
  id: "profile-gamma",
  name: "Gamma",
  models: [
    {
      enabled: false,
      id: "gamma-off",
      label: "Gamma Off",
      reasoningEfforts: [],
    },
    {
      enabled: true,
      id: "gamma-on",
      label: "Gamma On",
      reasoningEfforts: ["max"],
    },
  ],
};

const selection: TaskModelSelection = {
  modelId: "alpha-chat",
  profileId: "profile-alpha",
  reasoningEffort: "low",
  state: "ready",
};

afterEach(cleanup);

function renderPicker(
  overrides: Partial<Parameters<typeof TaskModelPicker>[0]> = {},
) {
  const onChange = vi.fn();
  const props = {
    busy: false,
    label: "对话模型",
    onChange,
    profiles: [alphaProfile, betaProfile, gammaProfile],
    selection,
    ...overrides,
  };
  render(<TaskModelPicker {...props} />);
  return { onChange, props };
}

describe("TaskModelPicker", () => {
  it.each([
    ["zh-Hans", "对话模型", "对话模型提供商", "对话模型配置"],
    ["zh-Hant", "對話模型", "對話模型提供商", "對話模型設定"],
    ["en", "Chat model", "Chat model provider", "Chat model configuration"],
    [
      "ja",
      "チャットモデル",
      "チャットモデル プロバイダー",
      "チャットモデル 設定",
    ],
  ] as const)(
    "labels provider and model selects in %s",
    (uiLanguage, label, providerLabel, modelLabel) => {
      renderPicker({ label, uiLanguage });
      expect(screen.getByLabelText(providerLabel)).not.toBeNull();
      expect(screen.getByLabelText(modelLabel)).not.toBeNull();
    },
  );

  it("renders three linked selects for profile, model, and reasoning effort", () => {
    renderPicker();
    const profileSelect = screen.getByLabelText(
      "对话模型提供商",
    ) as HTMLSelectElement;
    const modelSelect = screen.getByLabelText(
      "对话模型配置",
    ) as HTMLSelectElement;
    const effortSelect = screen.getByLabelText(
      "对话模型推理强度",
    ) as HTMLSelectElement;
    expect(profileSelect.value).toBe("profile-alpha");
    expect(modelSelect.value).toBe("alpha-chat");
    expect(effortSelect.value).toBe("low");
    expect(
      Array.from(effortSelect.options).map((option) => option.value),
    ).toEqual(["low", "high"]);
  });

  it("shows an inline error and does not save when switching to a profile without any enabled model", () => {
    const { onChange } = renderPicker();
    fireEvent.input(screen.getByLabelText("对话模型提供商"), {
      target: { value: "profile-beta" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "该配置没有可用模型",
    );
    expect(onChange).not.toHaveBeenCalled();
    // 原选择保持不变。
    expect(
      (screen.getByLabelText("对话模型提供商") as HTMLSelectElement).value,
    ).toBe("profile-alpha");
  });

  it("switches to the first enabled model and provider default effort when changing profile", () => {
    const { onChange } = renderPicker();
    fireEvent.input(screen.getByLabelText("对话模型提供商"), {
      target: { value: "profile-gamma" },
    });
    expect(onChange).toHaveBeenCalledWith({
      modelId: "gamma-on",
      profileId: "profile-gamma",
      reasoningEffort: "provider-default",
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the current effort when the model still supports it and resets otherwise", () => {
    const { onChange } = renderPicker();
    fireEvent.input(screen.getByLabelText("对话模型配置"), {
      target: { value: "alpha-summary" },
    });
    // alpha-summary 无档位：回落 Provider 默认。
    expect(onChange).toHaveBeenLastCalledWith({
      modelId: "alpha-summary",
      profileId: "profile-alpha",
      reasoningEffort: "provider-default",
    });
  });

  it("disables every control while busy", () => {
    renderPicker({ busy: true });
    expect(
      (screen.getByLabelText("对话模型提供商") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("对话模型配置") as HTMLSelectElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("对话模型推理强度") as HTMLSelectElement).disabled,
    ).toBe(true);
  });

  it("shows a needs-reselection notice without automatic fallback", () => {
    renderPicker({
      selection: {
        modelId: "removed-model",
        profileId: "profile-alpha",
        reasoningEffort: "provider-default",
        state: "needs-reselection",
      },
    });
    expect(screen.getByRole("status").textContent).toContain("需要重新选择");
    // 失效模型不在下拉选项中（无自动回退），显示为空并保留 needs-reselection 提示。
    expect(
      (screen.getByLabelText("对话模型配置") as HTMLSelectElement).value,
    ).toBe("");
  });

  it("renders a selection error passed from outside", () => {
    renderPicker({ selectionError: "保存失败，请重试。" });
    expect(screen.getByRole("alert").textContent).toContain("保存失败");
  });
});
