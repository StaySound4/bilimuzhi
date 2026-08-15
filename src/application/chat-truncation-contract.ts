import {
  createChatMessage,
  createChatThread,
  type ChatMessage,
  type ChatThread,
} from "../domain";

export type ChatTruncationIntent = "edit-user" | "regenerate-assistant";

export interface LinearChatTruncationPlan {
  readonly chatThreadId: string;
  readonly intent: ChatTruncationIntent;
  readonly targetMessageId: string;
  readonly deletedMessageIds: readonly string[];
  readonly cancelledGenerationRunIds: readonly string[];
  readonly nextConversationRevision: number;
}

export function createLinearChatTruncationPlan(
  inputThread: ChatThread,
  inputMessages: readonly ChatMessage[],
  targetMessageId: string,
  intent: ChatTruncationIntent,
): LinearChatTruncationPlan {
  const thread = createChatThread(inputThread);
  if (
    typeof targetMessageId !== "string" ||
    targetMessageId.trim().length === 0
  ) {
    throw new Error("The chat truncation target is invalid");
  }
  if (intent !== "edit-user" && intent !== "regenerate-assistant") {
    throw new Error("The chat truncation intent is unsupported");
  }
  if (thread.conversationRevision === Number.MAX_SAFE_INTEGER) {
    throw new Error("The chat conversation revision cannot advance");
  }

  const messages = inputMessages
    .map(createChatMessage)
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.messageId.localeCompare(right.messageId),
    );
  const seenIds = new Set<string>();
  const seenOrders = new Set<number>();
  for (const message of messages) {
    if (message.chatThreadId !== thread.chatThreadId) {
      throw new Error("The chat message is outside its thread");
    }
    if (seenIds.has(message.messageId) || seenOrders.has(message.order)) {
      throw new Error("The chat message order is not linear");
    }
    seenIds.add(message.messageId);
    seenOrders.add(message.order);
  }
  const targetIndex = messages.findIndex(
    (message) => message.messageId === targetMessageId,
  );
  if (targetIndex < 0) {
    throw new Error("The chat truncation target does not exist");
  }
  const target = messages[targetIndex];
  if (
    (intent === "edit-user" && target.role !== "user") ||
    (intent === "regenerate-assistant" && target.role !== "assistant")
  ) {
    throw new Error("The chat truncation target does not match its intent");
  }

  const deleted = messages.slice(targetIndex);
  const cancelledGenerationRunIds = [
    ...new Set(
      deleted.flatMap((message) =>
        message.generationRunId === null ? [] : [message.generationRunId],
      ),
    ),
  ];
  return Object.freeze({
    cancelledGenerationRunIds: Object.freeze(cancelledGenerationRunIds),
    chatThreadId: thread.chatThreadId,
    deletedMessageIds: Object.freeze(
      deleted.map((message) => message.messageId),
    ),
    intent,
    nextConversationRevision: thread.conversationRevision + 1,
    targetMessageId: target.messageId,
  });
}
