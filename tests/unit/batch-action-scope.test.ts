import { describe, expect, it } from "vitest";

import { freezeBatchActionScope } from "../../src/ui/batch/batch-action-scope";

describe("batch action scope", () => {
  it("freezes the active filter and actual selected ids against later UI changes", () => {
    const selectedIds = ["item-1", "item-2"];
    const scope = freezeBatchActionScope("succeeded", selectedIds);

    selectedIds.push("item-3");

    expect(scope).toEqual({
      filter: "succeeded",
      itemIds: ["item-1", "item-2"],
    });
    expect(Object.isFrozen(scope)).toBe(true);
    expect(Object.isFrozen(scope.itemIds)).toBe(true);
  });
});
