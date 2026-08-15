import { t } from "../../i18n";
import type { MessageKey } from "../../i18n/messages";
import type {
  OutputLanguagePreference,
  UiLanguage,
} from "../../i18n/languages";
import { useRef, useState } from "preact/hooks";

import type { GenerationFailurePresentation } from "../../application/generation-runtime-contract";
import { compactTimeLabel } from "../../application/time-marker";
import type { VideoKey } from "../../domain";
import {
  deriveValidatedMarkdownTimeLinks,
  Markdown,
  type MarkdownSubtitleRow,
  type MarkdownTimeLinkValidationScope,
  type RemoteMarkdownImageRequest,
  type RemoteMarkdownImageResult,
  type ValidatedMarkdownTimeLink,
} from "../markdown";
import { BilimuzhiIcon } from "../icons";
import { CompactActionMenu } from "../primitives/compact-action-menu";
import { TaskContextInspector } from "../primitives/task-context-inspector";
import { taskContextSummaryParts } from "../task-model/task-context-summary";
import { WorkspaceEmptyState } from "../primitives/workspace-empty-state";
import {
  TaskModelPicker,
  type TaskModelProfileOption,
  type TaskModelSelection,
  type TaskModelSelectionInput,
} from "../task-model/task-model-picker";
import "../primitives/task-context-inspector.css";
import "../primitives/workspace-empty-state.css";
import "./chat-workspace.css";

export interface ChatThreadOption {
  readonly id: string;
  readonly title: string;
}

export interface ChatWorkspaceMessage {
  readonly id: string;
  readonly role: "assistant" | "user";
  readonly content: string;
  readonly attachments?: readonly ChatWorkspaceMessageAttachment[];
  readonly reasoning?: string;
  readonly retryable?: boolean;
  readonly failure?: GenerationFailurePresentation;
  readonly incomplete?: boolean;
  readonly status: "complete" | "failed" | "streaming";
  readonly followingTurnCount?: number;
  readonly validatedTimeLinks?: readonly ValidatedMarkdownTimeLink[];
}

export interface ChatWorkspaceMessageAttachment {
  readonly attachmentId: string;
  readonly currentTimeMs: number;
  readonly name: string;
  readonly subtitleContextRevision: number;
  readonly subtitleId: string;
  readonly thumbnailUrl: string;
  readonly videoKey: VideoKey;
}

export interface ChatMessageMutationIntent {
  readonly kind: "edit-and-resend" | "regenerate";
  readonly messageId: string;
  readonly content?: string;
  readonly requiresConfirmation: boolean;
  readonly deletedTurnCount: number;
}

export type ChatActionResult = boolean | void | Promise<boolean | void>;

export interface ChatWorkspaceAttachment {
  readonly attachmentId: string;
  readonly currentTimeMs: number;
  readonly name: string;
  readonly subtitleContextRevision: number;
  readonly subtitleId: string;
  readonly thumbnailUrl?: string;
  readonly videoKey: VideoKey;
}

/**
 * The exact, currently executable chat generation owner. Persisted message
 * state deliberately does not satisfy this contract: after a Side Panel
 * restart a `streaming` message may remain while its executor no longer
 * exists.
 */
export interface ActiveChatGenerationRun {
  readonly conversationId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly sessionId: string;
  readonly status: "preparing" | "requesting" | "streaming";
  readonly stoppable: true;
}

export type ImageCapability = "supported" | "unknown" | "unsupported";

export interface ChatControlPromptOption {
  readonly id: string;
  readonly name: string;
}

export interface ChatWorkspaceProps {
  readonly uiLanguage?: UiLanguage;
  readonly availability?: "no-subtitle" | "no-video" | "ready";
  readonly activeGenerationRun?: ActiveChatGenerationRun | null;
  readonly activeThreadId: string | null;
  readonly attachments?: readonly ChatWorkspaceAttachment[];
  readonly busy?: boolean;
  readonly controlPromptOptions?: readonly ChatControlPromptOption[];
  readonly messages: readonly ChatWorkspaceMessage[];
  readonly generationStatus?:
    | "preparing"
    | "requesting"
    | "streaming"
    | "validating"
    | "saving"
    | "interrupted"
    | "failed"
    | "cancelled";
  readonly incomplete?: boolean;
  readonly imageCapability?: ImageCapability;
  readonly errorMessage?: string;
  readonly subtitleRows?: readonly MarkdownSubtitleRow[];
  readonly timeLinkScope?: MarkdownTimeLinkValidationScope;
  readonly validatedTimeLinks?: readonly ValidatedMarkdownTimeLink[];
  readonly threads: readonly ChatThreadOption[];
  readonly onSelectThread: (threadId: string) => ChatActionResult;
  readonly onCreateThread: () => ChatActionResult;
  readonly onRenameThread: (threadId: string) => ChatActionResult;
  readonly onDeleteThread: (threadId: string) => ChatActionResult;
  readonly onExportThread: (threadId: string) => void;
  readonly onLoadRemoteImage?: (
    request: RemoteMarkdownImageRequest,
  ) => Promise<RemoteMarkdownImageResult>;
  readonly onManageControlPrompts?: () => void;
  readonly onSend: (
    threadId: string,
    content: string,
    attachmentIds?: readonly string[],
  ) => ChatActionResult;
  readonly onAttachImages?: (files: readonly File[]) => ChatActionResult;
  readonly onClearAttachments?: () => void;
  readonly onSelectControlPrompt?: (presetId: string) => ChatActionResult;
  readonly onRemoveAttachment?: (attachmentId: string) => ChatActionResult;
  readonly onSeekAttachment?: (input: {
    readonly currentTimeMs: number;
    readonly subtitleContextRevision: number;
    readonly subtitleId: string;
    readonly videoKey: VideoKey;
  }) => void;
  readonly onSeek?: (seconds: number) => void;
  readonly onStop: (owner: ActiveChatGenerationRun) => ChatActionResult;
  readonly onCopyMessage: (messageId: string) => void;
  readonly onRetryMessage: (messageId: string) => ChatActionResult;
  readonly onRequestMessageMutation: (
    intent: ChatMessageMutationIntent,
  ) => ChatActionResult;
  readonly supportsImageAttachments?: boolean;
  readonly selectedControlPromptId?: string;
  readonly taskModelProfiles?: readonly TaskModelProfileOption[];
  readonly taskModelSelection?: TaskModelSelection | null;
  readonly taskContextError?: string;
  readonly taskContextPending?: boolean;
  readonly onTaskModelChange?: (next: TaskModelSelectionInput) => void;
  /** 输出语言偏好（per-mode 弱约束默认值）；会话发出首条消息后锁定。 */
  readonly outputLanguage?: OutputLanguagePreference;
  readonly outputLanguageLocked?: boolean;
  readonly onOutputLanguageChange?: (
    language: OutputLanguagePreference,
  ) => void;
}

function isSafeThumbnailUrl(value: string): boolean {
  return value.startsWith("blob:");
}

function attachmentClockLabel(currentTimeMs: number): string {
  return compactTimeLabel(Math.max(0, Math.floor(currentTimeMs / 1_000)));
}

/** @deprecated 使用公共时间标记契约；保留导出以兼容既有消费者。 */
export const deriveCompactValidatedMarkdownTimeLinks =
  deriveValidatedMarkdownTimeLinks;

function validatedMessageTimeLinks(
  message: ChatWorkspaceMessage,
  shared: readonly ValidatedMarkdownTimeLink[],
  rows: readonly MarkdownSubtitleRow[],
  scope?: MarkdownTimeLinkValidationScope,
): readonly ValidatedMarkdownTimeLink[] {
  const links = new Map<string, ValidatedMarkdownTimeLink>();
  for (const link of [
    ...shared,
    ...(message.validatedTimeLinks ?? []),
    ...deriveValidatedMarkdownTimeLinks(message.content, rows, scope),
  ]) {
    links.set(link.label, link);
  }
  return Object.freeze([...links.values()]);
}

function afterSuccessfulAction(
  action: () => ChatActionResult,
  onSuccess: () => void,
): void {
  try {
    const result = action();
    if (
      typeof result === "object" &&
      result !== null &&
      "then" in result &&
      typeof result.then === "function"
    ) {
      void Promise.resolve(result).then(
        (succeeded) => {
          if (succeeded !== false) onSuccess();
        },
        () => undefined,
      );
      return;
    }
    if (result !== false) onSuccess();
  } catch {
    // The action owner renders the error and the local draft remains intact.
  }
}

function mutationIntent(
  message: ChatWorkspaceMessage,
  kind: ChatMessageMutationIntent["kind"],
  content?: string,
): ChatMessageMutationIntent {
  const deletedTurnCount = message.followingTurnCount ?? 0;
  return {
    content,
    deletedTurnCount,
    kind,
    messageId: message.id,
    requiresConfirmation: deletedTurnCount > 0,
  };
}

function MessageActions({
  lang,
  busy,
  message,
  onCopyMessage,
  onRequestMessageMutation,
  onRetryMessage,
}: Pick<
  ChatWorkspaceProps,
  "busy" | "onCopyMessage" | "onRequestMessageMutation" | "onRetryMessage"
> & { readonly lang: UiLanguage; readonly message: ChatWorkspaceMessage }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isStreaming = message.status === "streaming";

  if (message.role === "user") {
    if (editing) {
      return (
        <div
          className="muzhi-chat__edit"
          aria-label={t(lang, "chat.editMessage")}
        >
          <textarea
            aria-label={t(lang, "chat.editMessage")}
            disabled={busy}
            onInput={(event) => setDraft(event.currentTarget.value)}
            value={draft}
          />
          <button
            aria-label={t(lang, "chat.resendMessage")}
            disabled={busy || draft.trim().length === 0}
            onClick={() =>
              afterSuccessfulAction(
                () =>
                  onRequestMessageMutation(
                    mutationIntent(message, "edit-and-resend", draft.trim()),
                  ),
                () => setEditing(false),
              )
            }
            type="button"
          >
            <BilimuzhiIcon name="send" title={t(lang, "chat.resendMessage")} />
          </button>
          <button
            aria-label={t(lang, "chat.cancelEditMessage")}
            disabled={busy}
            onClick={() => setEditing(false)}
            type="button"
          >
            <BilimuzhiIcon name="close" title={t(lang, "chat.cancelEdit")} />
          </button>
        </div>
      );
    }
    return (
      <div
        className="muzhi-chat__message-actions"
        aria-label={t(lang, "chat.questionActions")}
      >
        <button
          aria-label={t(lang, "chat.copyQuestion")}
          className="muzhi-chat__icon-button"
          disabled={busy || isStreaming}
          onClick={() => onCopyMessage(message.id)}
          type="button"
        >
          <BilimuzhiIcon name="copy" title={t(lang, "chat.copyQuestion")} />
        </button>
        {message.attachments?.length ? null : (
          <button
            aria-label={t(lang, "chat.regenerateOriginal")}
            className="muzhi-chat__icon-button"
            disabled={
              busy || isStreaming || message.content.trim().length === 0
            }
            onClick={() =>
              onRequestMessageMutation(
                mutationIntent(
                  message,
                  "edit-and-resend",
                  message.content.trim(),
                ),
              )
            }
            type="button"
          >
            <BilimuzhiIcon
              name="retry"
              title={t(lang, "chat.regenerateOriginal")}
            />
          </button>
        )}
        <button
          aria-label={t(lang, "chat.editAndResendQuestion")}
          className="muzhi-chat__icon-button"
          disabled={busy || isStreaming}
          onClick={() => setEditing(true)}
          type="button"
        >
          <BilimuzhiIcon
            name="pencil"
            title={t(lang, "chat.editAndResendQuestion")}
          />
        </button>
      </div>
    );
  }

  if (message.status === "failed") {
    if (message.failure) return null;
    if (message.retryable === false) {
      return (
        <span className="muzhi-chat__message-action-note">
          t(lang, "chat.notRetryable")
        </span>
      );
    }
    return (
      <button
        aria-label={t(lang, "chat.retryAnswer")}
        className="muzhi-chat__icon-button"
        disabled={busy}
        onClick={() => onRetryMessage(message.id)}
        type="button"
      >
        <BilimuzhiIcon name="retry" title={t(lang, "chat.retryAnswer")} />
      </button>
    );
  }

  return (
    <div
      className="muzhi-chat__message-actions"
      aria-label={t(lang, "chat.answerActions")}
    >
      <button
        aria-label={t(lang, "chat.copyAnswer")}
        className="muzhi-chat__icon-button"
        disabled={busy || isStreaming}
        onClick={() => onCopyMessage(message.id)}
        type="button"
      >
        <BilimuzhiIcon name="copy" title={t(lang, "chat.copyAnswer")} />
      </button>
      <button
        aria-label={t(lang, "chat.regenerateAnswer")}
        className="muzhi-chat__icon-button"
        disabled={busy || isStreaming}
        onClick={() =>
          onRequestMessageMutation(mutationIntent(message, "regenerate"))
        }
        type="button"
      >
        <BilimuzhiIcon name="retry" title={t(lang, "chat.regenerateAnswer")} />
      </button>
    </div>
  );
}

export function ChatWorkspace({
  availability = "ready",
  uiLanguage,
  activeGenerationRun = null,
  activeThreadId,
  attachments = [],
  busy = false,
  controlPromptOptions = [],
  generationStatus,
  errorMessage,
  imageCapability: declaredImageCapability,
  incomplete = false,
  messages,
  onAttachImages,
  onClearAttachments,
  onCopyMessage,
  onCreateThread,
  onDeleteThread,
  onExportThread,
  onLoadRemoteImage,
  onManageControlPrompts,
  onRenameThread,
  onRequestMessageMutation,
  onRemoveAttachment,
  onRetryMessage,
  onSelectThread,
  onSelectControlPrompt,
  onSend,
  onSeek,
  onSeekAttachment,
  onStop,
  subtitleRows = [],
  timeLinkScope,
  threads,
  supportsImageAttachments = true,
  selectedControlPromptId,
  validatedTimeLinks = [],
  taskModelProfiles = [],
  taskModelSelection = null,
  taskContextError,
  taskContextPending = false,
  onTaskModelChange,
  outputLanguage = "zh-Hans",
  outputLanguageLocked = false,
  onOutputLanguageChange,
}: ChatWorkspaceProps) {
  const lang = uiLanguage ?? "zh-Hans";
  const [draft, setDraft] = useState("");
  const [composerError, setComposerError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // Ticket 11：secondary inspector 折叠（默认关闭，模型配置按需展开）。

  const composing = useRef(false);
  const sendLocked = useRef(false);
  // Ticket 11：textarea 1–5 行 auto-grow（超五行内部滚动）。
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const growComposer = (): void => {
    const el = composerTextareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };
  const hasActiveThread = activeThreadId !== null;
  const imageCapability =
    declaredImageCapability ??
    (supportsImageAttachments ? "supported" : "unsupported");
  const generationActive =
    generationStatus === "preparing" ||
    generationStatus === "requesting" ||
    generationStatus === "streaming" ||
    generationStatus === "validating" ||
    generationStatus === "saving";
  const stoppableGeneration =
    activeGenerationRun?.stoppable === true ? activeGenerationRun : null;
  const visibleMessages = (() => {
    const filtered = messages.filter(
      (message) =>
        message.role === "user" ||
        message.content.trim().length > 0 ||
        Boolean(message.reasoning?.trim()) ||
        Boolean(message.failure) ||
        Boolean(message.attachments && message.attachments.length > 0) ||
        // 流式消息仅在已有可见内容（正文或思考）时显示，
        // 避免空壳 streaming 消息堆积成空气泡。
        (message.status === "streaming" &&
          (message.content.trim().length > 0 ||
            Boolean(message.reasoning?.trim()))),
    );
    // 渲染层按 messageId 去重（保留最后一条）：
    // 任何数据层来源的重复消息都不会变成双气泡。
    const byId = new Map<string, ChatWorkspaceProps["messages"][number]>();
    for (const message of filtered) byId.set(message.id, message);
    return [...byId.values()];
  })();
  const hasStreamingAssistant = messages.some(
    (message) =>
      message.role === "assistant" &&
      message.status === "streaming" &&
      (message.content.trim().length > 0 ||
        Boolean(message.reasoning?.trim()) ||
        Boolean(message.failure)),
  );

  function send(): void {
    const content = draft.trim();
    if (hasStreamingAssistant) {
      setComposerError(t(lang, "chat.streamingBusy"));
      return;
    }
    if (
      activeThreadId === null ||
      (content.length === 0 && attachments.length === 0) ||
      sendLocked.current ||
      sending ||
      busy ||
      generationActive
    )
      return;
    if (attachments.length > 0 && imageCapability === "unsupported") {
      setComposerError(t(lang, "chat.imageMaybeUnsupported"));
    } else {
      setComposerError(null);
    }
    sendLocked.current = true;
    try {
      const result =
        attachments.length === 0
          ? onSend(activeThreadId, content)
          : onSend(
              activeThreadId,
              content,
              attachments.map((attachment) => attachment.attachmentId),
            );
      if (
        typeof result === "object" &&
        result !== null &&
        "then" in result &&
        typeof result.then === "function"
      ) {
        setSending(true);
        void Promise.resolve(result)
          .then((succeeded) => {
            if (succeeded !== false) {
              setDraft("");
              onClearAttachments?.();
            }
          })
          .catch(() => undefined)
          .finally(() => {
            sendLocked.current = false;
            setSending(false);
          });
        return;
      }
      if (result !== false) {
        setDraft("");
        onClearAttachments?.();
      }
      sendLocked.current = false;
    } catch {
      // The action owner renders the error. Preserve the draft for retry.
      sendLocked.current = false;
    }
  }

  return (
    <section className="muzhi-chat" aria-label={t(lang, "chat.workspaceAria")}>
      <header className="muzhi-chat__header">
        <label>
          <span>{t(lang, "shell.chat")}</span>
          <select
            aria-label={t(lang, "chat.selectThreadAria")}
            disabled={busy || threads.length === 0}
            onInput={(event) => onSelectThread(event.currentTarget.value)}
            value={activeThreadId ?? ""}
          >
            {threads.length === 0 ? (
              <option value="">{t(lang, "chat.noThreads")}</option>
            ) : null}
            {threads.map((thread) => (
              <option key={thread.id} value={thread.id}>
                {thread.title}
              </option>
            ))}
          </select>
        </label>
        <div className="muzhi-chat__thread-actions">
          <button
            aria-label={t(lang, "chat.newThread")}
            className="muzhi-chat__icon-button"
            disabled={busy}
            onClick={onCreateThread}
            title={t(lang, "chat.newThread")}
            type="button"
          >
            <BilimuzhiIcon name="plus" title={t(lang, "chat.newThread")} />
          </button>
          <button
            aria-label={t(lang, "chat.renameThread")}
            className="muzhi-chat__icon-button"
            disabled={busy || !hasActiveThread}
            onClick={() => activeThreadId && onRenameThread(activeThreadId)}
            title={t(lang, "chat.renameThread")}
            type="button"
          >
            <BilimuzhiIcon name="pencil" title={t(lang, "chat.renameThread")} />
          </button>
          <CompactActionMenu
            ariaLabel={t(lang, "chat.threadActionsAria")}
            items={[
              {
                disabled: busy || !hasActiveThread,
                icon: "download",
                kind: "item",
                label: t(lang, "chat.exportThread"),
                onSelect: () =>
                  activeThreadId && onExportThread(activeThreadId),
              },
              { kind: "separator" },
              {
                danger: true,
                disabled: busy || !hasActiveThread,
                icon: "trash",
                kind: "item",
                label: t(lang, "chat.deleteThread"),
                onSelect: () =>
                  activeThreadId && onDeleteThread(activeThreadId),
              },
            ]}
          />
        </div>
      </header>

      {!generationActive && incomplete ? (
        <p className="muzhi-chat__incomplete" role="status">
          {t(lang, "chat.incomplete")}
        </p>
      ) : null}

      {errorMessage ? (
        <p className="muzhi-chat__incomplete" role="alert">
          {errorMessage}
        </p>
      ) : null}

      <div className="muzhi-chat__messages" aria-live="polite">
        {visibleMessages.length === 0 ? (
          <WorkspaceEmptyState
            description={t(
              lang,
              availability === "no-video"
                ? "workspaceEmpty.noVideoDescription"
                : availability === "no-subtitle"
                  ? "workspaceEmpty.chatNoSubtitle"
                  : "workspaceEmpty.chatNoContent",
            )}
            title={t(
              lang,
              availability === "no-video"
                ? "workspaceEmpty.noVideoTitle"
                : availability === "no-subtitle"
                  ? "workspaceEmpty.noSubtitleTitle"
                  : "workspaceEmpty.chatNoContentTitle",
            )}
            variant={
              availability === "no-video"
                ? "no-video"
                : availability === "no-subtitle"
                  ? "no-subtitle"
                  : "no-content"
            }
          />
        ) : null}
        {visibleMessages.map((message) => (
          <article
            aria-label={
              message.role === "assistant"
                ? t(lang, "chat.answer")
                : t(lang, "chat.question")
            }
            className={`muzhi-chat__message muzhi-chat__message--${message.role}`}
            key={message.id}
          >
            {message.reasoning?.trim() ? (
              <details
                aria-label={t(lang, "chat.reasoningAria")}
                className="muzhi-chat__reasoning"
              >
                <summary>{t(lang, "chat.reasoningSummary")}</summary>
                <Markdown
                  uiLanguage={uiLanguage}
                  onLoadRemoteImage={onLoadRemoteImage}
                  onSeek={onSeek}
                  text={message.reasoning.trim()}
                  validatedTimeLinks={validatedMessageTimeLinks(
                    { ...message, content: message.reasoning.trim() },
                    validatedTimeLinks,
                    subtitleRows,
                    timeLinkScope,
                  )}
                />
              </details>
            ) : null}
            <div role={message.status === "streaming" ? "status" : undefined}>
              <Markdown
                onLoadRemoteImage={onLoadRemoteImage}
                onSeek={onSeek}
                text={message.content}
                validatedTimeLinks={validatedMessageTimeLinks(
                  message,
                  validatedTimeLinks,
                  subtitleRows,
                  timeLinkScope,
                )}
              />
            </div>
            {message.failure ? (
              <div
                className="muzhi-chat__message-failure"
                data-generation-failure-code={message.failure.code}
              >
                <p>
                  {message.failure.code}：
                  {t(lang, message.failure.action as MessageKey)}。
                </p>
                {message.incomplete || message.failure.incomplete ? (
                  <p>{t(lang, "chat.incomplete")}</p>
                ) : null}
                {message.failure.retryable ? (
                  <button
                    className="muzhi-chat__retry-action"
                    disabled={busy}
                    onClick={() => onRetryMessage(message.id)}
                    type="button"
                  >
                    {t(lang, "chat.retryGeneration")}
                  </button>
                ) : (
                  <p>{t(lang, "chat.notRetryableDirect")}</p>
                )}
              </div>
            ) : null}
            {message.attachments && message.attachments.length > 0 ? (
              <ul
                aria-label={t(lang, "chat.attachmentsAria")}
                className="muzhi-chat__message-attachments"
              >
                {message.attachments.map((attachment) => (
                  <li key={attachment.attachmentId}>
                    {isSafeThumbnailUrl(attachment.thumbnailUrl) ? (
                      <img
                        alt={attachment.name}
                        loading="lazy"
                        src={attachment.thumbnailUrl}
                      />
                    ) : (
                      <span className="muzhi-chat__unsafe-image" role="status">
                        {t(lang, "chat.imageUnsafe")}
                      </span>
                    )}
                    <button
                      aria-label={t(lang, "chat.seekAttachmentAria", {
                        time: attachmentClockLabel(attachment.currentTimeMs),
                      })}
                      onClick={() =>
                        onSeekAttachment?.({
                          currentTimeMs: attachment.currentTimeMs,
                          subtitleContextRevision:
                            attachment.subtitleContextRevision,
                          subtitleId: attachment.subtitleId,
                          videoKey: attachment.videoKey,
                        })
                      }
                      type="button"
                    >
                      {attachmentClockLabel(attachment.currentTimeMs)}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <MessageActions
              lang={lang}
              busy={busy}
              message={message}
              onCopyMessage={onCopyMessage}
              onRequestMessageMutation={onRequestMessageMutation}
              onRetryMessage={onRetryMessage}
            />
          </article>
        ))}
      </div>

      {taskModelProfiles.length > 0 && onTaskModelChange ? (
        <TaskContextInspector
          configureLabel={t(lang, "chat.configureModel")}
          status={
            taskContextError ??
            (taskContextPending
              ? t(lang, "taskModel.saving")
              : taskModelSelection?.state === "needs-reselection"
                ? t(lang, "chat.needsReselection")
                : outputLanguageLocked
                  ? t(lang, "chat.languageLocked")
                  : undefined)
          }
          summary={taskContextSummaryParts(
            lang,
            taskModelProfiles,
            taskModelSelection,
            outputLanguage,
          ).join(" · ")}
        >
          <TaskModelPicker
            uiLanguage={uiLanguage}
            busy={busy || sending || taskContextPending}
            label={t(lang, "chat.taskModelLabel")}
            onChange={onTaskModelChange}
            outputLanguage={outputLanguage}
            outputLanguageLocked={outputLanguageLocked}
            onOutputLanguageChange={onOutputLanguageChange}
            profiles={taskModelProfiles}
            selection={taskModelSelection}
            selectionError={taskContextError}
          />
          {controlPromptOptions.length > 0 ? (
            <div className="muzhi-chat__control-prompt-row">
              <label className="muzhi-chat__control-prompt">
                <span>{t(lang, "chat.controlPrompt")}</span>
                <select
                  aria-label={t(lang, "chat.controlPrompt")}
                  disabled={busy || sending}
                  onInput={(event) =>
                    onSelectControlPrompt?.(event.currentTarget.value)
                  }
                  value={
                    selectedControlPromptId ?? controlPromptOptions[0]?.id ?? ""
                  }
                >
                  {controlPromptOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </label>
              {onManageControlPrompts ? (
                <button
                  className="muzhi-chat__manage-prompts"
                  disabled={busy || sending}
                  onClick={onManageControlPrompts}
                  type="button"
                >
                  {t(lang, "chat.managePresets")}
                </button>
              ) : null}
            </div>
          ) : null}
        </TaskContextInspector>
      ) : null}

      <form
        className="muzhi-chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        {imageCapability === "unsupported" || imageCapability === "unknown" ? (
          <p className="muzhi-chat__attachment-hint" role="status">
            {imageCapability === "unknown"
              ? t(lang, "chat.imageCapabilityUnknown")
              : t(lang, "chat.imageCapabilityUnsupported")}
          </p>
        ) : null}
        <label
          className="muzhi-chat__attach-button muzhi-chat__icon-button"
          title={t(lang, "chat.addImage")}
        >
          <BilimuzhiIcon name="image" title={t(lang, "chat.addImage")} />
          <span className="muzhi-chat__visually-hidden">
            {t(lang, "chat.addImage")}
          </span>
          <input
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || sending}
            multiple
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []).slice(
                0,
                Math.max(0, 6 - attachments.length),
              );
              if (files.length > 0) onAttachImages?.(files);
              event.currentTarget.value = "";
            }}
            type="file"
          />
        </label>
        {attachments.length > 0 ? (
          <ul
            className="muzhi-chat__attachments"
            aria-label={t(lang, "chat.pendingImagesAria")}
          >
            {attachments.map((attachment, index) => (
              <li
                aria-label={t(lang, "chat.pendingImageAria", {
                  count: index + 1,
                })}
                key={attachment.attachmentId}
              >
                {attachment.thumbnailUrl &&
                isSafeThumbnailUrl(attachment.thumbnailUrl) ? (
                  <img
                    alt={t(lang, "chat.pendingImageAria", { count: index + 1 })}
                    loading="lazy"
                    src={attachment.thumbnailUrl}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="muzhi-chat__attachment-preview"
                  />
                )}
                {imageCapability === "unsupported" ? (
                  <span className="muzhi-chat__attachment-legacy-name">
                    {attachment.name}
                  </span>
                ) : null}
                <button
                  aria-label={t(lang, "chat.seekAddedImageAria", {
                    time: attachmentClockLabel(attachment.currentTimeMs),
                  })}
                  className="muzhi-chat__attachment-time"
                  onClick={() =>
                    onSeekAttachment?.({
                      currentTimeMs: attachment.currentTimeMs,
                      subtitleContextRevision:
                        attachment.subtitleContextRevision,
                      subtitleId: attachment.subtitleId,
                      videoKey: attachment.videoKey,
                    })
                  }
                  type="button"
                >
                  {attachmentClockLabel(attachment.currentTimeMs)}
                </button>
                {onRemoveAttachment ? (
                  <button
                    aria-label={t(lang, "chat.removeImageAria", {
                      count: index + 1,
                    })}
                    className="muzhi-chat__attachment-remove"
                    onClick={() => onRemoveAttachment(attachment.attachmentId)}
                    title={t(lang, "chat.removeImageAria", {
                      count: index + 1,
                    })}
                    type="button"
                  >
                    <svg
                      aria-hidden="true"
                      data-icon="close"
                      focusable="false"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="m6 6 12 12M18 6 6 18"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {composerError ? <p role="alert">{composerError}</p> : null}
        <textarea
          onInput={(event) => {
            setDraft(event.currentTarget.value);
            growComposer();
          }}
          ref={composerTextareaRef}
          aria-label={t(lang, "chat.inputAria")}
          rows={1}
          disabled={busy || !hasActiveThread || sending}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onKeyDown={(event) => {
            if (
              event.key !== "Enter" ||
              event.shiftKey ||
              event.repeat ||
              event.isComposing ||
              composing.current
            ) {
              return;
            }
            event.preventDefault();
            send();
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter(
              (file) =>
                file.type === "image/png" ||
                file.type === "image/jpeg" ||
                file.type === "image/webp",
            );
            if (files.length > 0 && onAttachImages) {
              event.preventDefault();
              onAttachImages(
                files.slice(0, Math.max(0, 6 - attachments.length)),
              );
            }
          }}
          placeholder={t(lang, "chat.inputPlaceholder")}
          value={draft}
        />
        <div className="muzhi-chat__composer-end">
          {generationActive ? (
            <p
              className="muzhi-chat__generation-status"
              data-generation-active="true"
              role="status"
            >
              <span aria-hidden="true" className="muzhi-chat__spinner" />
              {generationStatus === "preparing"
                ? t(lang, "chat.preparing")
                : generationStatus === "requesting"
                  ? t(lang, "chat.requesting")
                  : generationStatus === "streaming"
                    ? t(lang, "chat.streaming")
                    : generationStatus === "validating"
                      ? t(lang, "chat.validating")
                      : t(lang, "chat.saving")}
            </p>
          ) : null}
          {stoppableGeneration ? (
            <button
              aria-label={t(lang, "chat.stopGenerating")}
              className="muzhi-chat__composer-action muzhi-chat__stop"
              disabled={sending}
              onClick={() => onStop(stoppableGeneration)}
              title={t(lang, "chat.stopGenerating")}
              type="button"
            >
              <BilimuzhiIcon name="stop" title={t(lang, "chat.stopGenerating")} />
            </button>
          ) : (
            <button
              aria-label={
                sending ? t(lang, "chat.sending") : t(lang, "chat.sendMessage")
              }
              className="muzhi-chat__composer-action"
              disabled={
                busy ||
                !hasActiveThread ||
                sending ||
                (draft.trim().length === 0 && attachments.length === 0)
              }
              title={
                sending ? t(lang, "chat.sending") : t(lang, "chat.sendMessage")
              }
              type="submit"
            >
              <BilimuzhiIcon
                name="send"
                title={
                  sending
                    ? t(lang, "chat.sending")
                    : t(lang, "chat.sendMessage")
                }
              />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
