import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SingleSubtitleMigrationBlockedGate,
  SingleSubtitleMigrationGate,
} from "../../src/ui/single-subtitle-migration-gate";

afterEach(cleanup);

const preview = Object.freeze({
  affectedSessionCount: 2,
  artifactsToDelete: 3,
  attachmentsToDelete: 4,
  batchItemsToDelete: 0,
  branchesToDelete: 2,
  chatMessagesToDelete: 5,
  chatThreadsToDelete: 1,
  generationRunsToDelete: 6,
  requiresConfirmation: true,
  subtitleSnapshotsToDelete: 2,
});

describe("SingleSubtitleMigrationGate", () => {
  it("shows the destructive scope and blocks the workspace after cancellation", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn(async () => undefined);
    render(
      <SingleSubtitleMigrationGate
        onCancel={onCancel}
        onConfirm={onConfirm}
        preview={preview}
      />,
    );

    expect(screen.getByText("2 个会话需要整理")).not.toBeNull();
    expect(screen.getByText("将永久删除 2 份历史字幕上下文")).not.toBeNull();
    expect(screen.getAllByText("永久删除", { exact: false })).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "确认迁移" }).className,
    ).toContain("muzhi-btn--destructive");
    fireEvent.click(screen.getByRole("button", { name: "暂不迁移" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "完成迁移前不会进入工作区",
    );
  });

  it("runs the confirmed migration once and disables both actions", async () => {
    let complete!: () => void;
    const onConfirm = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    render(
      <SingleSubtitleMigrationGate
        onCancel={vi.fn()}
        onConfirm={onConfirm}
        preview={preview}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "确认迁移" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(
      (
        screen.getByRole("button", {
          name: "正在安全迁移…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "暂不迁移" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    complete();
  });

  it("blocks the workspace without exposing corrupt record details", () => {
    const onRetry = vi.fn();
    render(<SingleSubtitleMigrationBlockedGate onRetry={onRetry} />);

    expect(
      screen.getByRole("heading", { name: "暂时无法安全升级" }),
    ).not.toBeNull();
    expect(screen.getByRole("alert").textContent).toContain(
      "没有删除或改写任何旧数据",
    );
    expect(document.body.textContent).not.toContain("branch-missing");
    fireEvent.click(screen.getByRole("button", { name: "重新检查" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
