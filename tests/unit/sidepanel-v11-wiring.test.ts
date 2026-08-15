import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

let sidepanelSource = "";
let buildInsightComposition = "";
let chatComposition = "";

beforeAll(async () => {
  sidepanelSource = await readFile(
    new URL(
      "../../src/entries/sidepanel.tsx",
      import.meta.url,
    ) as unknown as string,
    "utf8",
  );
  buildInsightComposition = sidepanelSource.slice(
    sidepanelSource.indexOf("const buildInsight ="),
    sidepanelSource.indexOf("const chatScope ="),
  );
  chatComposition = sidepanelSource.slice(
    sidepanelSource.indexOf("const chat: ChatWorkspaceProps"),
    sidepanelSource.indexOf("const archive: ArchiveWorkspaceProps"),
  );
});

describe("Side Panel v11 composition seam", () => {
  it("passes the attachment queue, handlers, v12 capability projection, and attachment ids through the real ChatWorkspace composition", () => {
    expect(chatComposition).toContain("attachments:");
    expect(chatComposition).toContain("onAttachImages:");
    expect(chatComposition).toContain("onRemoveAttachment:");
    expect(chatComposition).toContain("onClearAttachments:");
    expect(chatComposition).toContain("imageCapability:");
    expect(chatComposition).not.toContain("supportsImageAttachments:");
    expect(chatComposition).toMatch(
      /onSend:\s*\(threadId,\s*content,\s*attachmentIds\)/,
    );
    expect(chatComposition).toMatch(
      /chatClient\.send\(\{[\s\S]*attachmentIds[\s\S]*threadId/,
    );
  });

  it("projects every durable non-terminal GenerationRun phase into both Chat and Insight rather than only queued/running", () => {
    for (const status of [
      "preparing",
      "requesting",
      "streaming",
      "validating",
      "saving",
    ]) {
      expect(buildInsightComposition).toContain(`run.status === "${status}"`);
    }
    expect(buildInsightComposition).toContain("generationStatus:");
    expect(chatComposition).toContain("generationStatus:");
  });

  it("passes subtitle-derived validated links through the actual entry composition without a parallel summary detail seam", () => {
    expect(buildInsightComposition).toContain("validatedTimeLinks:");
    expect(chatComposition).toContain("validatedTimeLinks:");
    expect(sidepanelSource).not.toContain("summaryDetail");
    expect(buildInsightComposition).not.toMatch(/summaryDetail/);
  });

  it("keeps the selected artifact control preset separate from the per-click requirement across the real Side Panel generation seam", () => {
    expect(sidepanelSource).toMatch(
      /const controlPromptFor =[\s\S]*selectedPromptPresetIds\[kind\][\s\S]*return selected\?\.content/,
    );
    expect(buildInsightComposition).toMatch(
      /userPrompt:\s*kind === "summary" \? controlPromptFor\(kind\) : ""/,
    );
    expect(buildInsightComposition).toMatch(
      /userInstruction:[\s\S]{0,160}kind === "summary"[\s\S]{0,160}artifactInstructionByKind\.get\(kind\)[\s\S]{0,80}: ""/,
    );
    expect(buildInsightComposition).not.toMatch(
      /userInstruction:\s*\[[\s\S]{0,240}controlPromptFor\(kind\)[\s\S]{0,240}artifactInstructionByKind/,
    );
  });

  it("removes the session attachment ZIP archive path entirely (v16)", () => {
    expect(sidepanelSource).not.toContain("exportSessionArchive");
    expect(sidepanelSource).not.toContain("createSessionArchiveEntries");
  });

  it("routes user replay through the existing edit-and-resend runtime using the original content", () => {
    expect(chatComposition).toMatch(
      /intent\.kind === "regenerate"[\s\S]*chatClient\.regenerate\([\s\S]*:\s*await chatClient\.editAndResend\(\{[\s\S]*content:\s*intent\.content[\s\S]*targetMessageId:\s*intent\.messageId/,
    );
    expect(chatComposition).not.toContain('intent.kind === "replay-user"');
  });

  it("auto-discovers models after saving a provider key without failing the save on probe errors", () => {
    const saveComposition = sidepanelSource.slice(
      sidepanelSource.indexOf("onSaveProviderKey: (apiKey) => {"),
      sidepanelSource.indexOf("onTestProvider: () => {"),
    );
    expect(saveComposition).toContain("await discoverProviderModels();");
    expect(saveComposition).toMatch(
      /t\(uiLanguage, "settings\.providerSavedModels", \{\s*count: discoveredModels\.length,?\s*\}\)/,
    );
    expect(saveComposition).toMatch(
      /catch \(error\)[\s\S]*t\(uiLanguage, "settings\.providerSavedProbeFailed", \{\s*error: safeSessionActionMessage\(error, uiLanguage\),?\s*\}\)/,
    );
  });

  it("exposes the full declared reasoning effort set in v12 profile projections", () => {
    const profileComposition = sidepanelSource.slice(
      sidepanelSource.indexOf("const v12ProfileOptions"),
      sidepanelSource.indexOf("const v12TaskChoices"),
    );
    expect(profileComposition).toContain(
      "reasoningEfforts: capabilities?.supportedReasoningEfforts ?? []",
    );
    expect(profileComposition).not.toMatch(/effort === "low"/u);
    expect(profileComposition).toContain("discoveredModels.find");
  });

  it("wires the two-step probe actions and append-style discovery into the v12 settings drawer", () => {
    const settingsComposition = sidepanelSource.slice(
      sidepanelSource.indexOf("onCheckProfileAvailability: (profileId) =>"),
      sidepanelSource.indexOf(
        "onSetProfileModelEnabled: ({ enabled, modelId, profileId }) =>",
      ),
    );
    expect(settingsComposition).toContain(
      "settingsStore.ensureProfileHostPermission(profileId)",
    );
    expect(settingsComposition).toContain("await reloadV12Settings();");
    expect(settingsComposition).toContain(
      "settingsStore.discoverProfileModels(profileId)",
    );
    expect(settingsComposition).not.toContain("onReplaceProviderKey");
    expect(sidepanelSource).toContain("onRevealProviderKey: (profileId) =>");
    expect(sidepanelSource).toContain("onSpeechLanguageChange");
    expect(sidepanelSource).not.toContain("onSelectTaskConfiguration");
  });

  it("injects the per-mode task model picker into chat and insight workspaces and persists changes", () => {
    const chatComposition = sidepanelSource.slice(
      sidepanelSource.indexOf("const chat: ChatWorkspaceProps ="),
      sidepanelSource.indexOf("const settings: SettingsDrawerProps ="),
    );
    expect(chatComposition).toContain(
      "taskModelProfiles: taskModelProfileOptions()",
    );
    expect(chatComposition).toContain(
      'taskModelSelection: projectTaskChoice("chat")',
    );
    expect(chatComposition).toContain(
      'onTaskModelChange: (next) => saveTaskModelSelection("chat", next)',
    );
    expect(sidepanelSource).toContain(
      "taskModelSelection: projectTaskChoice(kind),",
    );
    expect(sidepanelSource).toContain("const saveTaskModelSelection = (");
    expect(sidepanelSource).toContain(".saveTaskSelection(kind, {");
    expect(sidepanelSource).toContain(
      "chatImageCapability = await loadChatImageCapability();",
    );
    expect(sidepanelSource).toContain(
      "const taskModelSaveErrorByKind = new Map<BilimuzhiTaskKind, string>();",
    );
    expect(sidepanelSource).toContain(
      "const taskModelSavePendingKinds = new Set<BilimuzhiTaskKind>();",
    );
    expect(sidepanelSource).toContain(
      "taskContextError: taskModelSaveErrorByKind.get(kind)",
    );
    expect(sidepanelSource).toContain(
      "taskContextPending: taskModelSavePendingKinds.has(kind)",
    );
    expect(chatComposition).toContain(
      'taskContextError: taskModelSaveErrorByKind.get("chat")',
    );
    expect(chatComposition).toContain(
      'taskContextPending: taskModelSavePendingKinds.has("chat")',
    );
  });

  it("wires the selected summary prompt preset as the single summary policy seam", () => {
    expect(sidepanelSource).toContain("summaryPromptPresetOptions:");
    expect(sidepanelSource).toContain("selectedSummaryPromptPresetId:");
    expect(sidepanelSource).toContain("selectedPromptPresetIds.summary");
    expect(sidepanelSource).toContain(
      'selectPromptPreset("summary", presetId)',
    );
    expect(sidepanelSource).toContain(
      'userPrompt: kind === "summary" ? controlPromptFor(kind) : ""',
    );
  });
});
