import {
  MAX_TAG_NAME_LENGTH,
  MAX_TAGS_PER_WORKSPACE,
  createArchiveSessionTags,
  createTag,
  type ArchiveSessionTags,
  type Tag,
} from "../../domain";
import { StorageError } from "../../application/storage";
import { requestResult, transactionDone } from "./idb-requests";

function readTag(value: unknown): Tag {
  return createTag(value as Tag);
}

function readSessionTags(value: unknown): ArchiveSessionTags {
  return createArchiveSessionTags(value as ArchiveSessionTags);
}

function tagIdFromName(name: string): string {
  return `tag:${name.trim()}`;
}

/**
 * 标签仓储（v9 扁平化）：标签全局唯一、按创建顺序排序；会话标签关联只在归档区存在。
 */
export class IndexedDbTagRepository {
  constructor(private readonly database: IDBDatabase) {}

  async listTags(): Promise<readonly Tag[]> {
    try {
      const transaction = this.database.transaction("tags", "readonly");
      const values = (await requestResult(
        transaction.objectStore("tags").getAll(),
      )) as readonly unknown[];
      await transactionDone(transaction);
      return Object.freeze(
        [...values]
          .map(readTag)
          .sort((left, right) => left.order - right.order),
      );
    } catch (error) {
      throw normalizeTagError(error);
    }
  }

  async listSessionTags(): Promise<readonly ArchiveSessionTags[]> {
    try {
      const transaction = this.database.transaction(
        "archiveSessionTags",
        "readonly",
      );
      const values = (await requestResult(
        transaction.objectStore("archiveSessionTags").getAll(),
      )) as readonly unknown[];
      await transactionDone(transaction);
      return Object.freeze(values.map(readSessionTags));
    } catch (error) {
      throw normalizeTagError(error);
    }
  }

  /** 创建标签：重名拒绝、总数上限、名称长度上限。 */
  async createTag(name: string): Promise<Tag> {
    const normalizedName = name.trim();
    if (normalizedName.length === 0) {
      throw new StorageError("标签名不能为空");
    }
    if (normalizedName.length > MAX_TAG_NAME_LENGTH) {
      throw new StorageError(`标签名不能超过 ${MAX_TAG_NAME_LENGTH} 个字`);
    }
    try {
      const transaction = this.database.transaction("tags", "readwrite");
      const store = transaction.objectStore("tags");
      const existing = (await requestResult(
        store.getAll(),
      )) as readonly unknown[];
      if (existing.some((value) => readTag(value).name === normalizedName)) {
        throw new StorageError("标签名已存在");
      }
      if (existing.length >= MAX_TAGS_PER_WORKSPACE) {
        throw new StorageError(`标签数量已达上限 ${MAX_TAGS_PER_WORKSPACE}`);
      }
      const order =
        existing
          .map(readTag)
          .reduce((max, tag) => Math.max(max, tag.order), -1) + 1;
      const tag = createTag({
        name: normalizedName,
        order,
        tagId: tagIdFromName(normalizedName),
      });
      store.put(tag);
      await transactionDone(transaction);
      return tag;
    } catch (error) {
      throw normalizeTagError(error);
    }
  }

  /** 删除标签：所有会话引用一并移除。 */
  async deleteTag(tagId: string): Promise<void> {
    try {
      const transaction = this.database.transaction(
        ["archiveSessionTags", "tags"],
        "readwrite",
      );
      transaction.objectStore("tags").delete(tagId);
      const allTags = (await requestResult(
        transaction.objectStore("archiveSessionTags").getAll(),
      )) as readonly unknown[];
      for (const value of allTags) {
        const record = readSessionTags(value);
        if (record.tagIds.includes(tagId)) {
          transaction.objectStore("archiveSessionTags").put(
            createArchiveSessionTags({
              sessionId: record.sessionId,
              tagIds: record.tagIds.filter((id) => id !== tagId),
            }),
          );
        }
      }
      await transactionDone(transaction);
    } catch (error) {
      throw normalizeTagError(error);
    }
  }

  /** 替换式写入会话标签（归档区打/取消标签即时生效）。 */
  async setSessionTags(
    sessionId: string,
    tagIds: readonly string[],
  ): Promise<ArchiveSessionTags> {
    try {
      const transaction = this.database.transaction(
        ["archiveSessionTags", "tags"],
        "readwrite",
      );
      const known = (await requestResult(
        transaction.objectStore("tags").getAll(),
      )) as readonly unknown[];
      const knownIds = new Set(known.map((value) => readTag(value).tagId));
      if (tagIds.some((tagId) => !knownIds.has(tagId))) {
        throw new StorageError("引用了不存在的标签");
      }
      const record = createArchiveSessionTags({ sessionId, tagIds });
      transaction.objectStore("archiveSessionTags").put(record);
      await transactionDone(transaction);
      return record;
    } catch (error) {
      throw normalizeTagError(error);
    }
  }

  /** 删除会话标签记录（从归档区删除/恢复回工作区时调用）。 */
  async removeSessionTags(sessionId: string): Promise<void> {
    try {
      const transaction = this.database.transaction(
        "archiveSessionTags",
        "readwrite",
      );
      transaction.objectStore("archiveSessionTags").delete(sessionId);
      await transactionDone(transaction);
    } catch (error) {
      throw normalizeTagError(error);
    }
  }

  /** 重命名标签（全局唯一；会话关联按 tagId 引用自动同步）。 */
  async renameTag(tagId: string, name: string): Promise<Tag> {
    const normalized = name.trim();
    if (normalized.length === 0) throw new StorageError("标签名不能为空");
    if (normalized.length > MAX_TAG_NAME_LENGTH) {
      throw new StorageError(`标签名不能超过 ${MAX_TAG_NAME_LENGTH} 个字`);
    }
    try {
      const transaction = this.database.transaction("tags", "readwrite");
      const store = transaction.objectStore("tags");
      const existing = await requestResult(store.get(tagId));
      if (existing === undefined) throw new StorageError("标签不存在");
      const all = (await requestResult(store.getAll())) as readonly unknown[];
      if (all.some((value) => readTag(value).name === normalized)) {
        throw new StorageError("标签名已存在");
      }
      const tag = createTag({ ...readTag(existing), name: normalized });
      store.put(tag);
      await transactionDone(transaction);
      return tag;
    } catch (error) {
      throw normalizeTagError(error);
    }
  }

  /** 拖拽排序：将标签移动到 beforeTagId 之前（null = 追加到末尾）。 */
  async moveTag(tagId: string, beforeTagId: string | null): Promise<Tag> {
    try {
      const transaction = this.database.transaction("tags", "readwrite");
      const store = transaction.objectStore("tags");
      const existing = await requestResult(store.get(tagId));
      if (existing === undefined) throw new StorageError("标签不存在");
      const all = (await requestResult(store.getAll())) as readonly unknown[];
      const peers = all
        .map(readTag)
        .filter((tag) => tag.tagId !== tagId)
        .sort((left, right) => left.order - right.order);
      const index =
        beforeTagId === null
          ? peers.length
          : peers.findIndex((tag) => tag.tagId === beforeTagId);
      const insertIndex = index < 0 ? peers.length : index;
      peers.splice(insertIndex, 0, readTag(existing));
      const updated = peers.map((tag, order) => createTag({ ...tag, order }));
      for (const tag of updated) store.put(tag);
      await transactionDone(transaction);
      return updated.find((tag) => tag.tagId === tagId)!;
    } catch (error) {
      throw normalizeTagError(error);
    }
  }
}

function normalizeTagError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  return new StorageError(
    error instanceof Error ? error.message : "The Bilimuzhi tag store failed",
  );
}
