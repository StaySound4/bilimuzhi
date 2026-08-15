import { readFile } from "node:fs/promises";

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import type { FunctionComponent } from "preact";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  ChatWorkspace,
  type ChatWorkspaceProps,
} from "../../src/ui/chat/chat-workspace";
import {
  InsightWorkspace,
  type InsightWorkspaceProps,
} from "../../src/ui/insights/insight-workspace";
import type {
  RemoteMarkdownImageRequest,
  RemoteMarkdownImageResult,
} from "../../src/ui/markdown";

type ProductionRemoteImageLoader = (
  request: RemoteMarkdownImageRequest,
) => Promise<RemoteMarkdownImageResult>;

interface ProductionChatWorkspaceProps extends ChatWorkspaceProps {
  readonly onLoadRemoteImage: ProductionRemoteImageLoader;
}

interface ProductionInsightWorkspaceProps extends InsightWorkspaceProps {
  readonly onLoadRemoteImage: ProductionRemoteImageLoader;
}

const ProductionChatWorkspace =
  ChatWorkspace as FunctionComponent<ProductionChatWorkspaceProps>;
const ProductionInsightWorkspace =
  InsightWorkspace as FunctionComponent<ProductionInsightWorkspaceProps>;

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function chatProps(
  overrides: Partial<ChatWorkspaceProps> = {},
): ChatWorkspaceProps {
  return {
    activeThreadId: "thread-production-images",
    messages: [],
    onCopyMessage: vi.fn(),
    onCreateThread: vi.fn(),
    onDeleteThread: vi.fn(),
    onExportThread: vi.fn(),
    onRenameThread: vi.fn(),
    onRequestMessageMutation: vi.fn(),
    onRetryMessage: vi.fn(),
    onSelectThread: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    threads: [{ id: "thread-production-images", title: "图片回答" }],
    ...overrides,
  };
}

function summaryProps(
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

describe("v12 remote Markdown production consumers (A9/A13)", () => {
  it("takes ChatWorkspace through consent, one pending request, failure retry, and Blob-only success", async () => {
    const remoteUrl =
      "https://private-provider.example.test/chat.png?token=must-not-enter-dom";
    const first = deferred<RemoteMarkdownImageResult>();
    const second = deferred<RemoteMarkdownImageResult>();
    const onLoadRemoteImage = vi
      .fn<ProductionRemoteImageLoader>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { container } = render(
      <ProductionChatWorkspace
        {...chatProps({
          messages: [
            {
              content: `模型正文：![对话远程图](${remoteUrl})`,
              id: "assistant-production-image",
              role: "assistant",
              status: "complete",
            },
          ],
        })}
        onLoadRemoteImage={onLoadRemoteImage}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain(remoteUrl);
    expect(container.textContent).not.toContain("must-not-enter-dom");
    expect(onLoadRemoteImage).not.toHaveBeenCalled();

    const consent = screen.getByRole("button", {
      name: "点击加载图片：对话远程图",
    });
    fireEvent.click(consent);
    fireEvent.click(consent);

    expect(onLoadRemoteImage).toHaveBeenCalledOnce();
    expect(onLoadRemoteImage).toHaveBeenCalledWith({
      alt: "对话远程图",
      url: remoteUrl,
    });
    expect(
      (
        screen.getByRole("button", {
          name: "正在加载图片：对话远程图",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    first.reject({ code: "IMAGE_OUTPUT_REJECTED", retryable: true });
    const retry = await screen.findByRole("button", {
      name: "重试加载图片：对话远程图",
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain(remoteUrl);

    fireEvent.click(retry);
    expect(onLoadRemoteImage).toHaveBeenCalledTimes(2);
    second.resolve({
      objectUrl: "blob:chrome-extension://muzhi/local-chat-image",
    });

    const image = await screen.findByRole("img", { name: "对话远程图" });
    expect(image.getAttribute("src")).toBe(
      "blob:chrome-extension://muzhi/local-chat-image",
    );
    expect(container.innerHTML).not.toContain(remoteUrl);
    expect(container.querySelector(`a[href="${remoteUrl}"]`)).toBeNull();
  });

  it("wires Summary to the same consent loader while leaving dangerous image sources inert", async () => {
    const remoteUrl = "https://images.example.test/summary.png";
    const onLoadRemoteImage = vi
      .fn<ProductionRemoteImageLoader>()
      .mockResolvedValue({
        objectUrl: "blob:chrome-extension://muzhi/local-summary-image",
      });
    const { container } = render(
      <ProductionInsightWorkspace
        {...summaryProps({
          content: [
            `总结配图：![总结远程图](${remoteUrl})`,
            "危险来源：![危险图](javascript:alert(1))",
          ].join("\n\n"),
          phase: "ready",
        })}
        onLoadRemoteImage={onLoadRemoteImage}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain(remoteUrl);
    expect(screen.queryByRole("button", { name: /危险图/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /加载图片/ })).toHaveLength(1);
    expect(onLoadRemoteImage).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "点击加载图片：总结远程图" }),
    );

    expect(onLoadRemoteImage).toHaveBeenCalledOnce();
    expect(onLoadRemoteImage).toHaveBeenCalledWith({
      alt: "总结远程图",
      url: remoteUrl,
    });
    expect(
      (await screen.findByRole("img", { name: "总结远程图" })).getAttribute(
        "src",
      ),
    ).toBe("blob:chrome-extension://muzhi/local-summary-image");
    expect(container.innerHTML).not.toContain(remoteUrl);
    expect(container.querySelector("[onerror], [onclick]")).toBeNull();
  });
});

let chatWorkspaceSource = "";
let insightWorkspaceSource = "";
let serviceWorkerSource = "";
let sidepanelSource = "";

beforeAll(async () => {
  [
    chatWorkspaceSource,
    insightWorkspaceSource,
    serviceWorkerSource,
    sidepanelSource,
  ] = await Promise.all(
    [
      "../../src/ui/chat/chat-workspace.tsx",
      "../../src/ui/insights/insight-workspace.tsx",
      "../../src/entries/service-worker.ts",
      "../../src/entries/sidepanel.tsx",
    ].map((path) =>
      readFile(new URL(path, import.meta.url) as unknown as string, "utf8"),
    ),
  );
});

describe("v12 remote Markdown production composition (A9/A13)", () => {
  it("requires both real consumers and the self-bootstrapping SidePanel/SW runtime to share a concrete loader", () => {
    // The two tests above execute the real consumers. The extension entry is
    // self-bootstrapping and has no injectable composition root, so this narrow
    // companion prevents adding consumer-only optional props from satisfying the
    // production oracle without a concrete SidePanel -> SW loader.
    expect(chatWorkspaceSource).toMatch(
      /<Markdown[\s\S]{0,500}onLoadRemoteImage=\{onLoadRemoteImage\}/,
    );
    expect(insightWorkspaceSource).toMatch(
      /<Markdown[\s\S]{0,500}onLoadRemoteImage=\{onLoadRemoteImage\}/,
    );

    const buildInsightComposition = sidepanelSource.slice(
      sidepanelSource.indexOf("const buildInsight ="),
      sidepanelSource.indexOf("const chatScope ="),
    );
    const chatComposition = sidepanelSource.slice(
      sidepanelSource.indexOf("const chat: ChatWorkspaceProps"),
      sidepanelSource.indexOf("const archive: ArchiveWorkspaceProps"),
    );
    expect(buildInsightComposition).toMatch(
      /onLoadRemoteImage:\s*remoteMarkdownImageClient\.load/,
    );
    expect(chatComposition).toMatch(
      /onLoadRemoteImage:\s*remoteMarkdownImageClient\.load/,
    );
    expect(sidepanelSource).toContain(
      "createChromeRemoteMarkdownImageRuntimeClient",
    );
    expect(sidepanelSource).toMatch(
      /const remoteMarkdownImageClient\s*=\s*createChromeRemoteMarkdownImageRuntimeClient\(chromeValue\)/,
    );

    expect(serviceWorkerSource).toContain(
      "installChromeRemoteMarkdownImageRuntimeListener",
    );
    expect(serviceWorkerSource).toMatch(
      /installChromeRemoteMarkdownImageRuntimeListener\([\s\S]{0,1500}createProviderImageOutputProcessor/,
    );
  });
});
