import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { within } from "@testing-library/preact";
import { AppDialog } from "../../src/ui/dialogs/app-dialog";
import { Markdown, safeLinkHref } from "../../src/ui/markdown";

afterEach(cleanup);

describe("AppDialog", () => {
  it("confirms a destructive action without a browser dialog", () => {
    const onConfirm = vi.fn();
    render(
      <AppDialog
        confirmLabel="永久删除"
        danger
        description="此操作无法撤销。"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        title="确认永久删除？"
      />,
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const actions = screen
      .getAllByRole("button")
      .filter((button) =>
        ["取消", "永久删除"].includes(button.textContent ?? ""),
      );
    expect(actions.map((button) => button.textContent)).toEqual([
      "取消",
      "永久删除",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "永久删除" }));

    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("cancels on Escape and on the backdrop", () => {
    const onCancel = vi.fn();
    render(
      <AppDialog
        confirmLabel="确认"
        onCancel={onCancel}
        onConfirm={vi.fn()}
        title="标题"
      />,
    );

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    fireEvent.click(screen.getByLabelText("关闭对话框背景"));

    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("returns the edited text of a prompt-style dialog", () => {
    const onConfirm = vi.fn();
    render(
      <AppDialog
        confirmLabel="保存名称"
        defaultValue="旧名称"
        inputLabel="对话名称"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        title="重命名对话"
      />,
    );

    fireEvent.input(screen.getByLabelText("对话名称"), {
      target: { value: "新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));

    expect(onConfirm).toHaveBeenCalledWith("新名称");
  });

  it("refuses to submit an empty required value", () => {
    const onConfirm = vi.fn();
    render(
      <AppDialog
        confirmLabel="保存名称"
        defaultValue=""
        inputLabel="对话名称"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        title="重命名对话"
      />,
    );

    expect(
      screen.getByRole("button", { name: "保存名称" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("submits multiple selected backup groups", () => {
    const onConfirm = vi.fn();
    render(
      <AppDialog
        confirmLabel="预检所选板块"
        defaultValue="workspace,archive"
        inputLabel="导入板块"
        multipleOptions
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        options={[
          { label: "工作区会话", value: "workspace" },
          { label: "归档", value: "archive" },
          { label: "回收站", value: "trash" },
        ]}
        title="选择要导入的板块"
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "归档" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "回收站" }));
    fireEvent.click(screen.getByRole("button", { name: "预检所选板块" }));

    expect(onConfirm).toHaveBeenCalledWith("workspace,trash");
  });

  it("uses a password input for encrypted backup prompts", () => {
    render(
      <AppDialog
        confirmLabel="解锁并核验"
        defaultValue=""
        inputLabel="备份密码"
        inputType="password"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="输入备份密码"
      />,
    );

    expect((screen.getByLabelText("备份密码") as HTMLInputElement).type).toBe(
      "password",
    );
  });

  it("selects a target from a fixed option list", () => {
    const onConfirm = vi.fn();
    render(
      <AppDialog
        confirmLabel="恢复到该文件夹"
        inputLabel="目标文件夹"
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        options={[
          { label: "归档（根目录）", value: "archive-root" },
          { label: "课程", value: "folder-1" },
        ]}
        title="选择恢复目标"
      />,
    );

    fireEvent.input(screen.getByLabelText("目标文件夹"), {
      target: { value: "folder-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复到该文件夹" }));

    expect(onConfirm).toHaveBeenCalledWith("folder-1");
  });

  it("traps focus from the last action back to the first action", () => {
    render(
      <AppDialog
        confirmLabel="确认"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="标题"
      />,
    );
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "确认" });
    confirm.focus();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
  });

  it("blocks every action while the owner action is in flight", () => {
    const onCancel = vi.fn();
    render(
      <AppDialog
        busy
        confirmLabel="确认"
        onCancel={onCancel}
        onConfirm={vi.fn()}
        title="标题"
      />,
    );

    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "确认" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("danger variant 默认焦点不落在危险按钮（取消在前）", () => {
    render(
      <AppDialog
        confirmLabel="删除"
        danger
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="确认删除"
      />,
    );
    const cancel = screen.getByRole("button", { name: "取消" });
    const confirm = screen.getByRole("button", { name: "删除" });
    expect(document.activeElement).toBe(cancel);
    expect(confirm.classList.contains("muzhi-dialog__danger")).toBe(true);
  });

  it("Escape/backdrop 关闭后焦点回到触发元素", () => {
    const trigger = document.createElement("button");
    trigger.textContent = "打开";
    document.body.append(trigger);
    trigger.focus();
    const { unmount } = render(
      <AppDialog
        confirmLabel="确认"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="标题"
      />,
    );
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});

describe("Markdown", () => {
  it("renders structure without injecting untrusted markup", () => {
    const { container } = render(
      <Markdown text={'## 标题\n<img src=x onerror="alert(1)">\n- 要点'} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(container.querySelectorAll("li")).toHaveLength(1);
  });

  it("keeps only http(s) links and marks them safe to open", () => {
    const { container } = render(
      <Markdown
        text={"[安全](https://example.com/a) 与 [危险](javascript:alert(1))"}
      />,
    );
    const links = container.querySelectorAll("a");

    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com/a");
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(container.textContent).toContain("危险");
  });

  it("renders fenced code as text rather than markup", () => {
    const { container } = render(
      <Markdown text={"```\n<script>alert(1)</script>\n```"} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toBe(
      "<script>alert(1)</script>",
    );
  });

  it("rejects non-http protocols and credential URLs", () => {
    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref("data:text/html,<script>")).toBeNull();
    expect(safeLinkHref("https://user:pass@example.com")).toBeNull();
    expect(safeLinkHref("https://example.com/a")).toBe("https://example.com/a");
  });
});

describe("AppDialog 单动作（纯帮助）模式", () => {
  it("只渲染一个「关闭」按钮，不出现取消", () => {
    render(
      <AppDialog
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        role="dialog"
        singleAction
        title="教程"
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "教程" });
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("关闭");
    expect(screen.queryByRole("button", { name: "取消" })).toBeNull();
  });

  it("Escape 与遮罩仍然关闭；确认按钮关闭", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <AppDialog
        onCancel={onCancel}
        onConfirm={onConfirm}
        role="dialog"
        singleAction
        title="教程"
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "教程" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
    fireEvent.click(
      document.querySelector(".muzhi-dialog-layer__backdrop") as HTMLElement,
    );
    expect(onCancel).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("普通确认 Dialog 的取消/确认能力不受影响", () => {
    render(
      <AppDialog
        confirmLabel="确认"
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        title="确认删除？"
      />,
    );
    expect(screen.getByRole("button", { name: "取消" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "确认" })).not.toBeNull();
  });
});
