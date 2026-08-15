import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { AiChatShellProps } from "../../src/ui/ai-chat-shell";
import { ChatWorkspace } from "../../src/ui/chat/chat-workspace";
import { InsightWorkspace } from "../../src/ui/insights/insight-workspace";
import {
  createArtifact,
  createBranchPlacement,
  createChatMessage,
  createChatThread,
  createGenerationRun,
  createSession,
  createSubtitleBranch,
  createSubtitleSnapshot,
  type Artifact,
  type GenerationRun,
} from "../../src/domain";

type RuntimeSubscription = (event: never) => void;

const videoKey = "bvid:BV1Q541167Qg:cid:1:p:1" as const;
const sessionId = "session-production-reasoning";
const branchId = "branch-production-reasoning";
const subtitleId = "subtitle-production-reasoning";
const summaryArtifactId = "artifact-production-summary";
const summaryBody = "最终总结正文";
const summaryReasoning = "供应商显式推理";
const chatBody = "ChatMessage 正文不能充当 reasoning";
const chatReasoning = "Chat 显式 reasoning";

const session = createSession({
  activeBranchId: branchId,
  createdAt: 1,
  customTitle: false,
  lastActivityAt: 1,
  selectionRevision: 1,
  sessionId,
  title: "Production reasoning fixture",
  updatedAt: 1,
  videoBound: true,
  videoKey,
});

const branch = createSubtitleBranch({
  activeSubtitleId: subtitleId,
  branchId,
  contextRevision: 13,
  createdAt: 1,
  detectedLanguage: null,
  language: "zh-CN",
  lastOpenedAt: 1,
  lastSelectedAt: 1,
  requestedLanguageMode: null,
  sessionId,
  source: "bilibili",
  title: "Production reasoning fixture",
  updatedAt: 1,
  videoKey,
});

const subtitle = createSubtitleSnapshot({
  branchId,
  contentHash: "sha256:production-reasoning-fixture",
  createdAt: 1,
  language: "zh-CN",
  rows: [
    {
      endMs: 1_000,
      lineId: "line-production-reasoning",
      startMs: 0,
      text: "真实字幕正文",
    },
  ],
  sessionId,
  source: "bilibili",
  status: "active",
  subtitleId,
  videoKey,
});

const placement = createBranchPlacement({
  branchId,
  deletionReason: null,
  location: "workspace",
  order: 0,
  purgeAfter: null,
  retentionStartedAt: null,
  sessionId,
  trashedAt: null,
  trashOrigin: null,
  trashOriginFolderId: null,
  trashOriginPathSnapshot: null,
});

const snapshot = Object.freeze({
  restoredWorkspace: Object.freeze({
    activeMode: "summary" as const,
    branch,
    placement,
    scrollTopByMode: Object.freeze({
      chat: 0,
      segments: 0,
      summary: 0,
      timeline: 0,
    }),
    session,
    subtitle,
  }),
  sessions: Object.freeze([session]),
});

function summaryArtifact(input: {
  readonly revision: number;
  readonly status: "generating" | "ready";
}): Artifact {
  return createArtifact({
    artifactId: summaryArtifactId,
    artifactRevision: input.revision,
    branchId,
    content: input.status === "ready" ? summaryBody : "",
    contextRevision: branch.contextRevision,
    createdAt: 1,
    errorCode: null,
    kind: "summary",
    modelId: "reasoning-model",
    segments: [],
    sessionId,
    status: input.status,
    subtitleId,
    updatedAt: input.revision + 1,
  });
}

function summaryRun(runId: string, revision: number): GenerationRun {
  return createGenerationRun({
    branchId,
    browserSessionId: "browser-production-reasoning",
    completionSequence: null,
    contextRevision: branch.contextRevision,
    createdAt: revision,
    errorCode: null,
    expectedOwnerRevision: revision,
    kind: "summary",
    partialOutput: "",
    runId,
    sessionId,
    status: "streaming",
    stopReason: null,
    subtitleId,
    targetId: summaryArtifactId,
    taskId: `task-${runId}`,
    updatedAt: revision,
  });
}

const thread = createChatThread({
  branchId,
  chatThreadId: "thread-production-reasoning",
  conversationRevision: 1,
  createdAt: 1,
  order: 0,
  sessionId,
  subtitleId,
  title: "Provider reasoning",
  updatedAt: 1,
});

const chatMessage = createChatMessage({
  chatThreadId: thread.chatThreadId,
  content: chatBody,
  createdAt: 1,
  generationRunId: "run-chat-production-reasoning",
  messageId: "message-chat-production-reasoning",
  order: 0,
  role: "assistant",
  status: "complete",
  updatedAt: 1,
});

let latestShellProps: AiChatShellProps | undefined;
let artifactSubscription: RuntimeSubscription | undefined;
let chatSubscription: RuntimeSubscription | undefined;
const clipboardWrite = vi.fn<(text: string) => Promise<void>>(
  async () => undefined,
);

function ProductionConsumers(props: AiChatShellProps): ComponentChildren {
  latestShellProps = props;
  const { chat, summary } = props;
  return (
    <main>
      {summary ? (
        <section aria-label="production-summary-consumer">
          <InsightWorkspace {...summary} />
        </section>
      ) : null}
      {chat ? (
        <section aria-label="production-chat-consumer">
          <ChatWorkspace {...chat} />
        </section>
      ) : null}
    </main>
  );
}

const emptyProjection = Object.freeze({
  archive: Object.freeze({
    folders: Object.freeze([
      Object.freeze({
        childFolderIds: Object.freeze([]),
        folderId: "archive-root",
        isRoot: true,
        order: 0,
        parentFolderId: null,
        sessionIds: Object.freeze([]),
        title: "归档",
      }),
    ]),
    sessions: Object.freeze([]),
  }),
  trash: Object.freeze({ sessions: Object.freeze([]) }),
  workspace: Object.freeze({ sessions: Object.freeze([]) }),
});

function asyncProxy(overrides: Record<string, unknown> = {}) {
  return new Proxy(overrides, {
    get(target, property) {
      if (property in target) return target[property as string];
      return vi.fn(async () => undefined);
    },
  });
}

beforeAll(async () => {
  document.body.innerHTML = '<div id="app"></div>';
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: Object.freeze({ writeText: clipboardWrite }),
  });

  const storageValues: Record<string, unknown> = {};
  const storage = Object.freeze({
    async get(key: string) {
      return key in storageValues ? { [key]: storageValues[key] } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(storageValues, items);
    },
  });
  const chromeValue = {
    permissions: {
      contains: vi.fn(async () => false),
      remove: vi.fn(async () => true),
      request: vi.fn(async () => true),
    },
    runtime: {
      onMessage: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      sendMessage: vi.fn(async () => undefined),
    },
  };
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: chromeValue,
  });

  const artifactClient = asyncProxy({
    clear: vi.fn(async () => null),
    generate: vi.fn(),
    list: vi.fn(async () => [
      summaryArtifact({ revision: 1, status: "ready" }),
    ]),
    queryActiveRuns: vi.fn(async () => []),
    stop: vi.fn(async () => null),
    subscribe: vi.fn((listener: RuntimeSubscription) => {
      artifactSubscription = listener;
      return vi.fn();
    }),
  });
  const chatClient = asyncProxy({
    listMessages: vi.fn(async () => [chatMessage]),
    listRuns: vi.fn(async () => []),
    listThreads: vi.fn(async () => [thread]),
    subscribe: vi.fn((listener: RuntimeSubscription) => {
      chatSubscription = listener;
      return vi.fn();
    }),
  });

  vi.doMock("../../src/ui/ai-chat-shell", () => ({
    AiChatShell: ProductionConsumers,
  }));
  vi.doMock("../../src/application/session-workspace", () => ({
    createSessionWorkspaceCoordinator: () =>
      asyncProxy({
        initialize: vi.fn(async () => snapshot),
        saveView: vi.fn(async () => undefined),
      }),
  }));
  vi.doMock("../../src/infrastructure/chrome-sidepanel-api", () => ({
    createChromeSidePanelApi: () => ({ storage, tabs: asyncProxy() }),
  }));
  vi.doMock("../../src/infrastructure/current-page-sync", () => ({
    createCurrentPageSyncBridge: () => ({
      sync: vi.fn(async () => {
        throw new Error("fixture has no current page");
      }),
    }),
  }));
  vi.doMock("../../src/infrastructure/chrome-artifact-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-artifact-runtime")
    >("../../src/infrastructure/chrome-artifact-runtime");
    return {
      ...actual,
      createChromeArtifactRuntimeClient: () => artifactClient,
    };
  });
  vi.doMock("../../src/infrastructure/chrome-chat-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-chat-runtime")
    >("../../src/infrastructure/chrome-chat-runtime");
    return {
      ...actual,
      createChromeChatRuntimeClient: () => chatClient,
    };
  });
  vi.doMock(
    "../../src/infrastructure/chrome-remote-markdown-image-runtime",
    () => ({
      createChromeRemoteMarkdownImageRuntimeClient: () => ({
        dispose: vi.fn(),
        load: vi.fn(async () => {
          throw new Error("remote images are outside this fixture");
        }),
      }),
    }),
  );
  vi.doMock("../../src/infrastructure/chrome-batch-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-batch-runtime")
    >("../../src/infrastructure/chrome-batch-runtime");
    return {
      ...actual,
      createChromeBatchRuntimeClient: () =>
        asyncProxy({
          listJobs: vi.fn(async () => []),
          subscribe: vi.fn(() => vi.fn()),
        }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-player-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-player-runtime")
    >("../../src/infrastructure/chrome-player-runtime");
    return {
      ...actual,
      createChromePlayerRuntimeClient: () =>
        asyncProxy({ readTime: vi.fn(async () => null) }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-speech-runtime", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/infrastructure/chrome-speech-runtime")
    >("../../src/infrastructure/chrome-speech-runtime");
    return {
      ...actual,
      createChromeSpeechRuntimeClient: () =>
        asyncProxy({ active: vi.fn(async () => []) }),
    };
  });
  vi.doMock("../../src/infrastructure/chrome-subtitle-runtime", () => ({
    createChromeSubtitleRuntimeClient: () => asyncProxy(),
  }));
  vi.doMock("../../src/infrastructure/page-stale-monitor", () => ({
    PageStaleMonitor: class {
      markSynchronized() {}
      async start() {}
      stop() {}
    },
  }));
  vi.doMock("../../src/infrastructure/indexeddb/muzhi-database", () => ({
    ROOT_ARCHIVE_FOLDER_ID: "archive-root",
    createV12BackupDataPort: () => asyncProxy(),
    openBilimuzhiDatabase: vi.fn(async () => ({ close: vi.fn() })),
  }));
  vi.doMock(
    "../../src/infrastructure/indexeddb/single-subtitle-migration",
    () => ({
      inspectSingleSubtitleMigration: vi.fn(async () => ({
        requiresConfirmation: false,
      })),
      migrateToSingleSubtitleContexts: vi.fn(async () => undefined),
    }),
  );
  vi.doMock(
    "../../src/infrastructure/indexeddb/workspace-projection-repository",
    () => ({
      IndexedDbWorkspaceProjectionRepository: class {
        async load() {
          return emptyProjection;
        }
      },
    }),
  );
  vi.doMock("../../src/infrastructure/indexeddb/attachment-repository", () => ({
    createIndexedDbAttachmentRepository: () =>
      asyncProxy({
        listByMessage: vi.fn(async () => []),
        maintainOwnership: vi.fn(async () => ({
          deletedAttachmentIds: [],
        })),
        readStatistics: vi.fn(async () => ({ attachmentCount: 0 })),
      }),
  }));
  for (const [modulePath, exportName] of [
    [
      "../../src/infrastructure/indexeddb/archive-repository",
      "IndexedDbArchiveRepository",
    ],
    [
      "../../src/infrastructure/indexeddb/trash-repository",
      "IndexedDbTrashRepository",
    ],
    [
      "../../src/infrastructure/indexeddb/retention-repository",
      "IndexedDbRetentionRepository",
    ],
    [
      "../../src/infrastructure/indexeddb/workspace-restoration-repository",
      "IndexedDbWorkspaceRestorationRepository",
    ],
    [
      "../../src/infrastructure/indexeddb/session-repository",
      "IndexedDbSessionRepository",
    ],
  ] as const) {
    vi.doMock(modulePath, () => ({ [exportName]: class {} }));
  }

  await import("../../src/entries/sidepanel");
  await waitFor(() => {
    expect(latestShellProps?.summary).toBeDefined();
    expect(latestShellProps?.chat).toBeDefined();
    expect(artifactSubscription).toBeTypeOf("function");
    expect(chatSubscription).toBeTypeOf("function");
  });
});

afterEach(() => {
  clipboardWrite.mockClear();
});

afterAll(() => {
  globalThis.dispatchEvent(new Event("pagehide"));
  cleanup();
  vi.doUnmock("../../src/ui/ai-chat-shell");
});

function artifactUpdated(artifact: Artifact, run: GenerationRun) {
  artifactSubscription?.({
    payload: {
      artifact,
      artifactId: artifact.artifactId,
      kind: artifact.kind,
      partialOutput: run.partialOutput,
      progress: {
        completedChunks: 1,
        stage: "reducing",
        totalChunks: 1,
      },
      run,
    },
    protocolVersion: 1,
    type: "muzhi.artifact.updated",
  } as never);
}

function artifactReasoning(input: {
  readonly artifactId: string;
  readonly kind: "segments" | "summary";
  readonly runId: string;
  readonly text: string;
}) {
  artifactSubscription?.({
    payload: input,
    protocolVersion: 1,
    type: "muzhi.artifact.reasoning",
  } as never);
}

describe("v13 Provider reasoning real SidePanel production composition", () => {
  it("routes only explicit current-owner reasoning to independent Summary/Chat display and copy actions", async () => {
    const summaryConsumer = screen.getByRole("region", {
      name: "production-summary-consumer",
    });
    const chatConsumer = screen.getByRole("region", {
      name: "production-chat-consumer",
    });

    expect(within(summaryConsumer).getByText(summaryBody)).not.toBeNull();
    expect(within(chatConsumer).getByText(chatBody)).not.toBeNull();
    expect(
      within(chatConsumer).queryByRole("group", { name: "思考过程" }),
    ).toBeNull();

    const run1 = summaryRun("run-summary-production-1", 2);
    const run2 = summaryRun("run-summary-production-2", 3);
    await act(async () => {
      artifactUpdated(
        summaryArtifact({ revision: 2, status: "generating" }),
        run1,
      );
      artifactReasoning({
        artifactId: "artifact-wrong",
        kind: "summary",
        runId: run1.runId,
        text: "wrong-artifact",
      });
      artifactReasoning({
        artifactId: summaryArtifactId,
        kind: "segments",
        runId: run1.runId,
        text: "wrong-kind",
      });
      artifactReasoning({
        artifactId: summaryArtifactId,
        kind: "summary",
        runId: "run-wrong",
        text: "wrong-run",
      });
      artifactReasoning({
        artifactId: summaryArtifactId,
        kind: "summary",
        runId: run1.runId,
        text: "first-current-reasoning",
      });
    });

    await waitFor(() => {
      expect(within(summaryConsumer).queryByText("wrong-artifact")).toBeNull();
      expect(within(summaryConsumer).queryByText("wrong-kind")).toBeNull();
      expect(within(summaryConsumer).queryByText("wrong-run")).toBeNull();
      expect(
        within(summaryConsumer).getByText("first-current-reasoning"),
      ).not.toBeNull();
    });

    await act(async () => {
      artifactUpdated(
        summaryArtifact({ revision: 3, status: "generating" }),
        run2,
      );
      artifactReasoning({
        artifactId: summaryArtifactId,
        kind: "summary",
        runId: run1.runId,
        text: "late-owner",
      });
      artifactReasoning({
        artifactId: summaryArtifactId,
        kind: "summary",
        runId: run2.runId,
        text: summaryReasoning,
      });
      artifactUpdated(summaryArtifact({ revision: 3, status: "ready" }), run2);
      chatSubscription?.({
        payload: {
          runId: chatMessage.generationRunId,
          text: chatReasoning,
          threadId: thread.chatThreadId,
        },
        protocolVersion: 1,
        type: "muzhi.chat.reasoning",
      } as never);
    });

    await waitFor(() => {
      expect(within(summaryConsumer).getByText(summaryBody)).not.toBeNull();
      expect(
        within(summaryConsumer).getByText(summaryReasoning),
      ).not.toBeNull();
      expect(within(summaryConsumer).queryByText("late-owner")).toBeNull();
      expect(within(chatConsumer).getByText(chatBody)).not.toBeNull();
      expect(within(chatConsumer).getByText(chatReasoning)).not.toBeNull();
    });

    const summaryReasoningGroup = within(summaryConsumer).getByRole("group", {
      name: "思考过程",
    });
    fireEvent.click(
      within(summaryConsumer).getByRole("button", { name: "复制总结" }),
    );
    fireEvent.click(
      within(summaryReasoningGroup).getByRole("button", {
        name: "复制思考过程",
      }),
    );
    const chatAnswer = within(chatConsumer).getByRole("article", {
      name: "回答",
    });
    fireEvent.click(
      within(chatAnswer).getByRole("button", { name: "复制回答" }),
    );
    // 对话回答只保留一个复制按钮（复制正文）；思考过程复制仅用于洞察区。
    expect(
      within(chatAnswer).queryByRole("button", { name: "复制思考过程" }),
    ).toBeNull();

    expect(clipboardWrite.mock.calls.map(([text]) => text)).toEqual([
      summaryBody,
      summaryReasoning,
      chatBody,
    ]);
  });
});
