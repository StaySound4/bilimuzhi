import { describe, expect, it } from "vitest";

import {
  CANONICAL_COLUMN_IDS,
  defaultBatchColumnLayout,
  parseBatchColumnLayout,
} from "../../src/ui/batch/batch-column-layout";

describe("batch column layout (Ticket 04 canonical model)", () => {
  it("uses the canonical seven-column order for the default layout", () => {
    expect(
      defaultBatchColumnLayout().columns.map((column) => column.id),
    ).toEqual([
      "index",
      "status",
      "title",
      "author",
      "published",
      "identity",
      "actions",
    ]);
    expect(
      defaultBatchColumnLayout().columns.find((column) => column.id === "title")
        ?.width,
    ).toBe(360);
    expect(
      defaultBatchColumnLayout().columns.find(
        (column) => column.id === "actions",
      ),
    ).toBeDefined();
    expect(
      defaultBatchColumnLayout().columns.find(
        (column) => column.id === ("language" as never),
      ),
    ).toBeUndefined();
  });

  it("exposes canonical column ids without the deprecated language column", () => {
    expect(CANONICAL_COLUMN_IDS).toEqual([
      "index",
      "status",
      "title",
      "author",
      "published",
      "identity",
      "actions",
    ]);
    expect(CANONICAL_COLUMN_IDS).not.toContain("language");
  });

  it("projects a legacy saved order: language ignored, actions width kept, missing canonical defaulted", () => {
    const legacy = {
      columns: [
        { fixed: true, forceFull: true, id: "index", minChars: 3, width: 64 },
        {
          fixed: true,
          forceFull: true,
          id: "status",
          minChars: 22,
          width: 320,
        },
        {
          fixed: true,
          forceFull: true,
          id: "language",
          minChars: 6,
          width: 150,
        },
        { fixed: false, forceFull: true, id: "title", minChars: 8, width: 240 },
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
          minChars: 6,
          width: 110,
        },
      ],
      forceFullText: true,
    };
    const parsed = parseBatchColumnLayout(legacy);
    // 输出恒为 canonical 七列（language 不再投影）。
    expect(parsed?.columns.map((column) => column.id)).toEqual(
      CANONICAL_COLUMN_IDS,
    );
    // canonical ID 使用其保存宽度；actions 使用旧保存宽度；language 宽度被忽略。
    expect(parsed?.columns.find((column) => column.id === "title")?.width).toBe(
      240,
    );
    expect(
      parsed?.columns.find((column) => column.id === "status")?.width,
    ).toBe(320);
    expect(
      parsed?.columns.find((column) => column.id === "actions")?.width,
    ).toBe(110);
    expect(parsed?.forceFullText).toBe(true);
  });

  it("loads a legacy layout without triggering a save (no write-back marker)", () => {
    const legacy = {
      columns: [
        { fixed: true, forceFull: true, id: "index", minChars: 3, width: 64 },
        {
          fixed: true,
          forceFull: true,
          id: "status",
          minChars: 22,
          width: 320,
        },
        {
          fixed: true,
          forceFull: true,
          id: "actions",
          minChars: 6,
          width: 110,
        },
        { fixed: false, forceFull: true, id: "title", minChars: 8, width: 240 },
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
      ],
      forceFullText: false,
    };
    const parsed = parseBatchColumnLayout(legacy);
    expect(parsed).not.toBeNull();
    // 投影本身不携带任何「已迁移」标记；保存时机由组件层控制。
    expect(parsed?.forceFullText).toBe(false);
  });

  it("rejects duplicate or empty saved column sets", () => {
    const layout = defaultBatchColumnLayout();
    expect(
      parseBatchColumnLayout({
        ...layout,
        columns: [...layout.columns.slice(0, 6), layout.columns[0]],
      }),
    ).toBeNull();
    // 缺失列（非空）接受：投影补默认；重复 ID 拒绝。
    const partial = parseBatchColumnLayout({
      ...layout,
      columns: layout.columns.slice(0, 6),
    });
    expect(partial?.columns.map((column) => column.id)).toEqual(
      CANONICAL_COLUMN_IDS,
    );
    expect(parseBatchColumnLayout({ ...layout, columns: [] })).toBeNull();
  });

  it("rejects unknown column ids in saved data", () => {
    const layout = defaultBatchColumnLayout();
    const columns = layout.columns.map((column) => ({ ...column }));
    columns[3] = { ...columns[3]!, id: "unknown" as never };
    expect(parseBatchColumnLayout({ ...layout, columns })).toBeNull();
  });
});
