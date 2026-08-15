import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AppearanceControls,
  DEFAULT_APPEARANCE_PREFERENCE,
} from "../../src/ui/appearance";
import { ConversationSplitter } from "../../src/ui/conversation-splitter";

afterEach(cleanup);

describe("appearance and conversation controls", () => {
  it("publishes the selected theme and exposes no accent selector", () => {
    const onChange = vi.fn();
    render(
      <AppearanceControls
        onChange={onChange}
        preference={DEFAULT_APPEARANCE_PREFERENCE}
      />,
    );

    fireEvent.input(screen.getByRole("combobox", { name: "主题" }), {
      target: { value: "dark" },
    });
    expect(onChange).toHaveBeenLastCalledWith({ theme: "dark" });
    expect(screen.queryByRole("combobox", { name: "强调色" })).toBeNull();
  });

  it("responds to pointer drag and double click but has no keyboard resize path", () => {
    const onWidthChange = vi.fn();
    render(
      <ConversationSplitter
        getContainerWidth={() => 800}
        onWidthChange={onWidthChange}
        width={300}
      />,
    );
    const splitter = screen.getByRole("separator", {
      name: "拖动调整会话栏宽度",
    });

    fireEvent.pointerDown(splitter, { button: 0, clientX: 100 });
    fireEvent.pointerMove(window, { clientX: 180 });
    expect(onWidthChange).toHaveBeenLastCalledWith(360);
    fireEvent.pointerUp(window);

    fireEvent.dblClick(splitter);
    expect(onWidthChange).toHaveBeenLastCalledWith(220);
    fireEvent.keyDown(splitter, { key: "ArrowRight" });
    expect(onWidthChange).toHaveBeenCalledTimes(2);
  });
});

describe("semantic palette contract", () => {
  it("keeps the dark filled-primary foreground on the on-accent token", () => {
    const css = readFileSync(resolve("src/ui/ai-chat-shell.css"), "utf8");
    expect(css).toContain("--muzhi-canvas: #f6f8fb");
    expect(css).toContain("--muzhi-canvas: #0e1116");
    expect(css).toContain("--muzhi-on-accent: #0d1520");
    expect(css).toContain("color: var(--muzhi-on-accent)");
  });
});
