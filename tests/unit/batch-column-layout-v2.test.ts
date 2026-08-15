/**
 * Ticket 05 单元契约：列布局 v2（顺序/可见性/宽度/全文本）模型与旧布局迁移。
 */
import { describe, expect, it } from "vitest";

import {
  defaultBatchColumnLayoutV2,
  migrateBatchColumnLayoutV1,
  moveColumnV2,
  minColumnWidthV2,
  parseBatchColumnLayoutV2,
  reorderBatchColumnV2,
  toggleColumnVisibilityV2,
  type BatchColumnLayoutV2,
} from "../../src/ui/batch/batch-column-layout-v2";
import { DEFAULT_BATCH_COLUMN_ORDER } from "../../src/ui/batch/batch-contracts";

describe("batch-column-layout-v2", () => {
  it("Ticket 03：状态/操作列最小宽度按四语言最宽内容量测锁定", () => {
    // 操作列：2 图标按钮横排 + 第 3 图标位预留（30px×3 + 2×4px gap
    // + td padding 20px ≈ 118）
    // 状态列：四语言最宽徽标自然宽（en 203px）+ td padding 20px ≈ 228
    expect(minColumnWidthV2("actions")).toBe(118);
    expect(minColumnWidthV2("status")).toBe(228);
    // 默认宽度 ≥ 最小宽度（状态列默认 240 ≥ 228）。
    const layout = defaultBatchColumnLayoutV2();
    expect(layout.widths.actions).toBeGreaterThanOrEqual(
      minColumnWidthV2("actions"),
    );
    expect(layout.widths.status).toBeGreaterThanOrEqual(
      minColumnWidthV2("status"),
    );
  });

  it("默认顺序：序号、标题、字幕状态、操作、作者、发布日期、视频身份；序号恒第一", () => {
    const layout = defaultBatchColumnLayoutV2();
    expect(layout.order).toEqual(DEFAULT_BATCH_COLUMN_ORDER);
    expect(layout.order[0]).toBe("index");
    expect(layout.forceFullText).toBe(false);
    // 默认全部可见；序号/状态/操作不可隐藏。
    for (const id of layout.order) {
      expect(layout.visible[id]).not.toBe(false);
    }
  });

  it("v2 解析校验：序号恒第一、列唯一、可见性只允许可隐藏列、宽度齐全", () => {
    const good = defaultBatchColumnLayoutV2();
    expect(parseBatchColumnLayoutV2(good)).toEqual(good);

    // 序号不在第一 → 拒绝
    const badOrder = { ...good, order: [...good.order.slice(1), "index"] };
    expect(parseBatchColumnLayoutV2(badOrder)).toBeNull();
    // 列重复 → 拒绝
    const dup = { ...good, order: [...good.order, "title"] };
    expect(parseBatchColumnLayoutV2(dup)).toBeNull();
    // 试图隐藏序号 → 拒绝
    const hideIndex = { ...good, visible: { ...good.visible, index: false } };
    expect(parseBatchColumnLayoutV2(hideIndex)).toBeNull();
    // 缺宽度 → 拒绝
    const missingWidth = {
      ...good,
      widths: { ...good.widths },
    } as BatchColumnLayoutV2;
    delete (missingWidth.widths as Record<string, number>).actions;
    expect(parseBatchColumnLayoutV2(missingWidth)).toBeNull();
    // 非法宽度 → 拒绝
    const badWidth = {
      ...good,
      widths: { ...good.widths, title: -5 },
    };
    expect(parseBatchColumnLayoutV2(badWidth)).toBeNull();
    // 空值 → 拒绝
    expect(parseBatchColumnLayoutV2(null)).toBeNull();
    expect(parseBatchColumnLayoutV2("nope")).toBeNull();
  });

  it("旧 v1 布局安全迁移：顺序/可见性用默认，宽度与全文本开关保留", () => {
    const v1 = {
      columns: [
        { fixed: true, forceFull: true, id: "index", minChars: 3, width: 64 },
        {
          fixed: true,
          forceFull: true,
          id: "status",
          minChars: 12,
          width: 220,
        },
        { fixed: false, forceFull: true, id: "title", minChars: 8, width: 400 },
        {
          fixed: false,
          forceFull: true,
          id: "author",
          minChars: 4,
          width: 140,
        },
        {
          fixed: false,
          forceFull: true,
          id: "published",
          minChars: 6,
          width: 140,
        },
        {
          fixed: false,
          forceFull: true,
          id: "identity",
          minChars: 8,
          width: 200,
        },
        {
          fixed: true,
          forceFull: true,
          id: "actions",
          minChars: 4,
          width: 120,
        },
      ],
      forceFullText: true,
    };
    const migrated = migrateBatchColumnLayoutV1(v1);
    expect(migrated.order).toEqual(DEFAULT_BATCH_COLUMN_ORDER);
    expect(migrated.widths.title).toBe(400);
    expect(migrated.forceFullText).toBe(true);
    for (const id of DEFAULT_BATCH_COLUMN_ORDER) {
      expect(migrated.visible[id]).not.toBe(false);
    }
    // v1 含已删除 language 列 → 忽略
    const v1WithLanguage = {
      ...v1,
      columns: [
        ...v1.columns,
        {
          fixed: false,
          forceFull: false,
          id: "language",
          minChars: 4,
          width: 80,
        },
      ],
    };
    const migrated2 = migrateBatchColumnLayoutV1(v1WithLanguage);
    expect(migrated2.order).toEqual(DEFAULT_BATCH_COLUMN_ORDER);
  });

  it("移动/排序/可见性切换保持序号恒第一", () => {
    let layout = defaultBatchColumnLayoutV2();
    // title 上移（index 不动）
    layout = moveColumnV2(layout, "title", -1);
    expect(layout.order).toEqual([
      "index",
      "title",
      "status",
      "actions",
      "author",
      "published",
      "identity",
    ]);
    layout = moveColumnV2(layout, "identity", -2);
    expect(layout.order).toEqual([
      "index",
      "title",
      "status",
      "actions",
      "identity",
      "author",
      "published",
    ]);
    // index 试图移动 → 不变
    const before = layout;
    expect(moveColumnV2(layout, "index", 1)).toEqual(before);
    // 恢复默认顺序
    layout = reorderBatchColumnV2(layout, DEFAULT_BATCH_COLUMN_ORDER);
    expect(layout.order[0]).toBe("index");
    // 隐藏 title
    layout = toggleColumnVisibilityV2(layout, "title");
    expect(layout.visible.title).toBe(false);
    // 试图隐藏 index → 不变
    expect(toggleColumnVisibilityV2(layout, "index")).toEqual(layout);
  });
});
