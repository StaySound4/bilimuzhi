import { describe, expect, it } from "vitest";

import {
  CONVERSATION_SPLITTER_WIDTH_PX,
  DEFAULT_CONVERSATION_PANE_WIDTH_PX,
  MIN_MAIN_WORKSPACE_WIDTH_PX,
  clampConversationPaneWidth,
} from "../../src/ui/conversation-splitter";

describe("conversation pane width", () => {
  it("keeps the desktop preference inside the sidebar, percentage, and main-workspace bounds", () => {
    expect(clampConversationPaneWidth(220, 1_000)).toBe(220);
    expect(clampConversationPaneWidth(999, 1_000)).toBe(360);
    expect(clampConversationPaneWidth(1, 1_000)).toBe(180);
    expect(clampConversationPaneWidth(360, 520)).toBe(
      520 - MIN_MAIN_WORKSPACE_WIDTH_PX - CONVERSATION_SPLITTER_WIDTH_PX,
    );
  });

  it("falls back to the stable default for malformed dimensions", () => {
    expect(clampConversationPaneWidth(Number.NaN, 800)).toBe(
      DEFAULT_CONVERSATION_PANE_WIDTH_PX,
    );
    expect(clampConversationPaneWidth(220, Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_CONVERSATION_PANE_WIDTH_PX,
    );
  });
});
