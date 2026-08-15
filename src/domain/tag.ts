import {
  assertNonEmptyString,
  assertNonNegativeSafeInteger,
} from "./validation";

/**
 * 标签系统领域模型（v9 扁平化）：归档区会话级标签。
 * - 标签全局唯一、名称唯一；扁平结构，无类、无组合；
 * - 标签只在归档区存在：归档 = 白板；删除/恢复 → 关联记录删除。
 */

/** 标签总数上限。 */
export const MAX_TAGS_PER_WORKSPACE = 200;
/** 单个标签名长度上限（字符）。 */
export const MAX_TAG_NAME_LENGTH = 20;

export interface Tag {
  readonly tagId: string;
  readonly name: string;
  readonly order: number;
}

/** 归档区会话的标签关联（sessionId 为归档区会话主键）。 */
export interface ArchiveSessionTags {
  readonly sessionId: string;
  readonly tagIds: readonly string[];
}

export function createTag(input: Tag): Tag {
  assertNonEmptyString(input.tagId, "tagId");
  assertNonEmptyString(input.name, "name");
  if (input.name.trim().length > MAX_TAG_NAME_LENGTH) {
    throw new Error(`标签名不能超过 ${MAX_TAG_NAME_LENGTH} 个字`);
  }
  assertNonNegativeSafeInteger(input.order, "order");
  return Object.freeze({
    name: input.name.trim(),
    order: input.order,
    tagId: input.tagId.trim(),
  });
}

export function createArchiveSessionTags(
  input: ArchiveSessionTags,
): ArchiveSessionTags {
  assertNonEmptyString(input.sessionId, "sessionId");
  const tagIds = input.tagIds.map((tagId) => {
    assertNonEmptyString(tagId, "tagId");
    return tagId.trim();
  });
  if (new Set(tagIds).size !== tagIds.length) {
    throw new Error("会话标签不能重复");
  }
  return Object.freeze({ sessionId: input.sessionId.trim(), tagIds });
}
