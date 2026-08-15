/**
 * Ticket 05 primitive demo（仅 QA build 引入）。
 * 用真实 CompactActionMenu / useAnchoredPopover / AppDialog 展示合同，
 * 供浏览器验证 anchor geometry、碰撞、键盘与焦点。
 */
import { useState } from "preact/hooks";

import { AppDialog } from "../ui/dialogs/app-dialog";
import { CompactActionMenu } from "../ui/primitives/compact-action-menu";
import { useAnchoredPopover } from "../ui/primitives/use-anchored-popover";

export function PrimitivesDemo() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const popover = useAnchoredPopover();

  return (
    <div class="qa-primitives-demo" style="padding: 24px">
      <h2>Primitive demo</h2>

      <section style="margin-bottom: 24px">
        <h3>CompactActionMenu（anchored，含 separator/danger/disabled）</h3>
        <CompactActionMenu
          ariaLabel="会话操作 测试会话"
          items={[
            {
              icon: "pencil",
              kind: "item",
              label: "重命名",
              onSelect: () => undefined,
            },
            {
              icon: "pin",
              kind: "item",
              label: "置顶",
              onSelect: () => undefined,
            },
            { kind: "separator" },
            {
              danger: true,
              icon: "trash",
              kind: "item",
              label: "删除",
              onSelect: () => undefined,
            },
            {
              disabled: true,
              kind: "item",
              label: "已禁用动作",
              onSelect: () => undefined,
            },
          ]}
        />
      </section>

      <section style="margin-bottom: 24px">
        <h3>Non-modal anchored popover（表单）</h3>
        <button
          aria-expanded={popover.open}
          aria-haspopup="dialog"
          onClick={popover.toggle}
          ref={popover.triggerRef}
          type="button"
        >
          导出选项
        </button>
        {popover.open ? (
          <div ref={popover.ref} role="dialog" style="position:absolute">
            <label>
              <input type="checkbox" /> 包含时间戳
            </label>
            <button onClick={popover.close} type="button">
              确定
            </button>
          </div>
        ) : null}
      </section>

      <section style="margin-bottom: 24px">
        <h3>Danger AppDialog（默认焦点在取消）</h3>
        <button onClick={() => setDialogOpen(true)} type="button">
          打开删除确认
        </button>
        {dialogOpen ? (
          <AppDialog
            confirmLabel="删除"
            danger
            onCancel={() => setDialogOpen(false)}
            onConfirm={() => setDialogOpen(false)}
            title="确认删除"
          />
        ) : null}
      </section>
    </div>
  );
}
