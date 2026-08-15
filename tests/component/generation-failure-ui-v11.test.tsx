import { cleanup, render, within } from "@testing-library/preact";
import type { FunctionComponent } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MESSAGES, type MessageKey } from "../../src/i18n/messages";

import {
  describeGenerationFailure,
  GENERATION_FAILURE_CODES,
  type GenerationFailureCode,
  type GenerationFailurePresentation,
} from "../../src/application/generation-runtime-contract";
import {
  ChatWorkspace,
  type ChatWorkspaceMessage,
  type ChatWorkspaceProps,
} from "../../src/ui/chat/chat-workspace";
import {
  InsightWorkspace,
  type InsightWorkspaceProps,
} from "../../src/ui/insights/insight-workspace";

afterEach(cleanup);

interface V11FailedMessage extends ChatWorkspaceMessage {
  readonly failure: GenerationFailurePresentation;
  readonly incomplete: boolean;
}

interface V11ChatWorkspaceProps extends ChatWorkspaceProps {
  readonly messages: readonly V11FailedMessage[];
}

interface V11InsightWorkspaceProps extends InsightWorkspaceProps {
  readonly failure: GenerationFailurePresentation;
}

const V11ChatWorkspace =
  ChatWorkspace as FunctionComponent<V11ChatWorkspaceProps>;
const V11InsightWorkspace =
  InsightWorkspace as FunctionComponent<V11InsightWorkspaceProps>;

function chatProps(code: GenerationFailureCode): V11ChatWorkspaceProps {
  const failure = describeGenerationFailure({
    code,
    hasPartialOutput: true,
    hasPreviousArtifact: false,
    kind: "chat",
  });
  return {
    activeThreadId: "thread-v11",
    messages: [
      {
        content: "已经确认的部分回答",
        failure,
        id: `message-${code}`,
        incomplete: failure.incomplete,
        retryable: failure.retryable,
        role: "assistant",
        status: "failed",
      },
    ],
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
    threads: [{ id: "thread-v11", title: "失败定位" }],
  };
}

function artifactProps(code: GenerationFailureCode): V11InsightWorkspaceProps {
  const failure = describeGenerationFailure({
    code,
    hasPartialOutput: true,
    hasPreviousArtifact: false,
    kind: "summary",
  });
  return {
    content: "已经确认的部分总结",
    failure,
    hasSubtitle: true,
    incomplete: failure.incomplete,
    instruction: "",
    kind: "summary",
    onClear: vi.fn(),
    onExport: vi.fn(),
    onGenerate: vi.fn(),
    onInstructionChange: vi.fn(),
    onStop: vi.fn(),
    phase: "failed",
    segments: [],
  };
}

function hasRetryDecision(
  placement: HTMLElement | null,
  retryable: boolean,
): boolean {
  if (placement === null) return false;
  const queries = within(placement);
  return retryable
    ? queries.queryByRole("button", { name: /重试/ }) !== null
    : /不可.*重试|不能.*重试/.test(placement.textContent ?? "");
}

describe("v11 located generation failure UI", () => {
  it.each(GENERATION_FAILURE_CODES)(
    "renders %s on its concrete failed chat message and artifact with action, incomplete, and retry decision",
    (code) => {
      const chat = chatProps(code);
      const artifact = artifactProps(code);
      const view = render(
        <main>
          <div data-testid="chat-failure-host">
            <V11ChatWorkspace {...chat} />
          </div>
          <div data-testid="artifact-failure-host">
            <V11InsightWorkspace {...artifact} />
          </div>
        </main>,
      );

      const chatHost = view.getByTestId("chat-failure-host");
      const artifactHost = view.getByTestId("artifact-failure-host");
      const chatPlacement = chatHost.querySelector<HTMLElement>(
        `[data-generation-failure-code="${code}"]`,
      );
      const artifactPlacement = artifactHost.querySelector<HTMLElement>(
        `[data-generation-failure-code="${code}"]`,
      );

      expect({
        artifactAction:
          artifactPlacement?.textContent?.includes(
            MESSAGES["zh-Hans"][artifact.failure.action as MessageKey],
          ) ?? false,
        artifactIncomplete:
          !artifact.failure.incomplete ||
          (artifactPlacement?.textContent?.includes("不完整") ?? false),
        artifactLocated:
          artifactPlacement !== null &&
          artifactPlacement.closest(".muzhi-insight__result") !== null,
        artifactRetryDecision: hasRetryDecision(
          artifactPlacement,
          artifact.failure.retryable,
        ),
        chatAction:
          chatPlacement?.textContent?.includes(
            MESSAGES["zh-Hans"][chat.messages[0].failure.action as MessageKey],
          ) ?? false,
        chatIncomplete:
          !chat.messages[0].failure.incomplete ||
          (chatPlacement?.textContent?.includes("不完整") ?? false),
        chatLocated:
          chatPlacement !== null && chatPlacement.closest("article") !== null,
        chatRetryDecision: hasRetryDecision(
          chatPlacement,
          chat.messages[0].failure.retryable,
        ),
        leakedGlobalAlert:
          chatHost.querySelector(".muzhi-chat > [role='alert']") !== null ||
          artifactHost.querySelector(".muzhi-insight > [role='alert']") !==
            null,
      }).toEqual({
        artifactAction: true,
        artifactIncomplete: true,
        artifactLocated: true,
        artifactRetryDecision: true,
        chatAction: true,
        chatIncomplete: true,
        chatLocated: true,
        chatRetryDecision: true,
        leakedGlobalAlert: false,
      });
    },
  );

  it("uses one themed retry action per retryable failure", () => {
    const chat = chatProps("NETWORK_ERROR");
    const artifact = artifactProps("NETWORK_ERROR");
    const view = render(
      <main>
        <div data-testid="chat-retry-host">
          <V11ChatWorkspace {...chat} />
        </div>
        <div data-testid="artifact-retry-host">
          <V11InsightWorkspace {...artifact} />
        </div>
      </main>,
    );
    const chatHost = within(view.getByTestId("chat-retry-host"));
    const artifactHost = within(view.getByTestId("artifact-retry-host"));

    expect(chatHost.getAllByRole("button", { name: "重试生成" })).toHaveLength(
      1,
    );
    expect(chatHost.queryByRole("button", { name: "重试回答" })).toBeNull();
    expect(
      chatHost.getByRole("button", { name: "重试生成" }).className,
    ).toContain("muzhi-chat__retry-action");
    expect(
      artifactHost.getByRole("button", { name: "重试生成" }).className,
    ).toContain("muzhi-insight__retry-action");
  });
});
