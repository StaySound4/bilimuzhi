import {
  DomainValidationError,
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";

export type ChatMessageRole = "user" | "assistant";
export type ChatMessageStatus = "complete" | "failed" | "streaming";

export interface ChatThread {
  readonly chatThreadId: string;
  readonly sessionId: string;
  readonly branchId: string;
  readonly subtitleId: string;
  readonly title: string | null;
  readonly order: number;
  readonly conversationRevision: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ChatMessage {
  readonly messageId: string;
  readonly chatThreadId: string;
  readonly role: ChatMessageRole;
  readonly status: ChatMessageStatus;
  readonly content: string;
  readonly order: number;
  readonly generationRunId: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

function assertNullableNonEmptyString(value: unknown, field: string): void {
  if (value !== null) assertNonEmptyString(value, field);
}

function assertTimestampRange(
  createdAt: number,
  updatedAt: number,
  field: string,
): void {
  assertNonNegativeSafeInteger(createdAt, "createdAt");
  assertNonNegativeSafeInteger(updatedAt, "updatedAt");
  if (updatedAt < createdAt) {
    throw new DomainValidationError(field, `${field} cannot precede createdAt`);
  }
}

export function createChatThread(input: ChatThread): ChatThread {
  assertNonEmptyString(input.chatThreadId, "chatThreadId");
  assertNonEmptyString(input.sessionId, "sessionId");
  assertNonEmptyString(input.branchId, "branchId");
  assertNonEmptyString(input.subtitleId, "subtitleId");
  assertNullableNonEmptyString(input.title, "title");
  assertNonNegativeSafeInteger(input.order, "order");
  assertNonNegativeSafeInteger(
    input.conversationRevision,
    "conversationRevision",
  );
  assertTimestampRange(input.createdAt, input.updatedAt, "updatedAt");
  return Object.freeze({
    branchId: input.branchId.trim(),
    chatThreadId: input.chatThreadId.trim(),
    conversationRevision: input.conversationRevision,
    createdAt: input.createdAt,
    order: input.order,
    sessionId: input.sessionId.trim(),
    subtitleId: input.subtitleId.trim(),
    title: input.title?.trim() ?? null,
    updatedAt: input.updatedAt,
  });
}

export function createChatMessage(input: ChatMessage): ChatMessage {
  assertNonEmptyString(input.messageId, "messageId");
  assertNonEmptyString(input.chatThreadId, "chatThreadId");
  if (input.role !== "user" && input.role !== "assistant") {
    throw new DomainValidationError("role", "chat message role is unsupported");
  }
  if (
    input.status !== "complete" &&
    input.status !== "failed" &&
    input.status !== "streaming"
  ) {
    throw new DomainValidationError(
      "status",
      "chat message status is unsupported",
    );
  }
  if (typeof input.content !== "string" || input.content.length > 1_000_000) {
    throw new DomainValidationError(
      "content",
      "chat message content is invalid",
    );
  }
  // 允许图片-only 消息：user 消息正文可为空（配合附件展示），
  // 纯空发送由 UI/运行时按附件存在性把关。
  assertNullableNonEmptyString(input.generationRunId, "generationRunId");
  if (input.role === "user" && input.generationRunId !== null) {
    throw new DomainValidationError(
      "generationRunId",
      "user messages cannot own a generation run",
    );
  }
  assertNonNegativeSafeInteger(input.order, "order");
  assertTimestampRange(input.createdAt, input.updatedAt, "updatedAt");
  return Object.freeze({
    chatThreadId: input.chatThreadId.trim(),
    content: input.content,
    createdAt: input.createdAt,
    generationRunId: input.generationRunId?.trim() ?? null,
    messageId: input.messageId.trim(),
    order: input.order,
    role: input.role,
    status: input.status,
    updatedAt: input.updatedAt,
  });
}
