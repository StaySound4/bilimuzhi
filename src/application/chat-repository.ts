import type {
  ChatMessage,
  ChatThread,
  GenerationRun,
  ImageAttachment,
  ImageAttachmentMimeType,
} from "../domain";
import type { AttachmentTurnBinding } from "./attachment-repository";
import type { ChatTruncationIntent } from "./chat-truncation-contract";

export type ChatThreadScope = Pick<
  ChatThread,
  "sessionId" | "branchId" | "subtitleId"
>;

export interface ChatTruncationInput {
  readonly chatThreadId: string;
  readonly targetMessageId: string;
  readonly intent: ChatTruncationIntent;
  readonly expectedConversationRevision: number;
  readonly editedContent?: string;
}

export interface ChatMutationCommit {
  readonly thread: ChatThread | null;
  readonly deletedMessageIds: readonly string[];
  readonly cancelledRuns: readonly GenerationRun[];
  readonly replacementMessage: ChatMessage | null;
}

/** A Provider output after magic-byte validation and pixel re-encoding. */
export interface SanitizedProviderImageOutput {
  readonly blob: Blob;
  readonly height: number;
  readonly mimeType: ImageAttachmentMimeType;
  readonly thumbnailBlob: Blob;
  readonly width: number;
}

export interface ChatRepository {
  listThreads(scope: ChatThreadScope): Promise<readonly ChatThread[]>;
  getThread(chatThreadId: string): Promise<ChatThread | null>;
  listMessages(chatThreadId: string): Promise<readonly ChatMessage[]>;
  createThread(thread: ChatThread): Promise<ChatThread>;
  renameThread(chatThreadId: string, title: string | null): Promise<ChatThread>;
  appendMessage(message: ChatMessage): Promise<ChatMessage>;
  appendTurn(
    user: ChatMessage,
    assistant: ChatMessage,
    attachmentBinding?: AttachmentTurnBinding,
  ): Promise<readonly [ChatMessage, ChatMessage]>;
  /** Mirrors only an exact, still-authoritative persisted run version. */
  applyAssistantRun(run: GenerationRun): Promise<ChatMessage | null>;
  /** 按精确 runId 读取持久化 run（历史失败消息的投影来源）。 */
  listRuns(runIds: readonly string[]): Promise<readonly GenerationRun[]>;
  /** Atomically binds sanitized Provider outputs to an exact completed turn. */
  commitAssistantImageOutputs?(input: {
    readonly images: readonly SanitizedProviderImageOutput[];
    readonly messageId: string;
    readonly run: GenerationRun;
  }): Promise<readonly ImageAttachment[] | null>;
  truncate(input: ChatTruncationInput): Promise<ChatMutationCommit>;
  deleteThread(chatThreadId: string): Promise<ChatMutationCommit>;
}
