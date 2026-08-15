import type { SubtitleLanguageMode } from "../../domain";
import {
  openBilimuzhiDatabase,
  type OpenBilimuzhiDatabaseOptions,
} from "./muzhi-database";

export type StoredSpeechLanguage = "中文" | "英文" | "其他" | "混合";

export function mapStoredSpeechLanguage(
  language: StoredSpeechLanguage,
): SubtitleLanguageMode {
  if (language === "中文") return "zh";
  if (language === "英文") return "en";
  if (language === "其他") return "other";
  return "mixed";
}

export function createBilimuzhiDatabaseBootstrap(
  loadSpeechLanguage: () => Promise<StoredSpeechLanguage>,
  open: typeof openBilimuzhiDatabase = openBilimuzhiDatabase,
): (options?: OpenBilimuzhiDatabaseOptions) => Promise<IDBDatabase> {
  let defaultMode: Promise<SubtitleLanguageMode> | null = null;
  return async (options = {}) => {
    defaultMode ??= loadSpeechLanguage().then(mapStoredSpeechLanguage);
    return open({
      ...options,
      defaultSpeechLanguageMode: await defaultMode,
    });
  };
}
