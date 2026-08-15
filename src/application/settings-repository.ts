import type { TrashRetentionApplyMode, TrashRetentionPolicy } from "../domain";
import type { AiModelSelection, BilimuzhiSettings } from "./settings-contract";

/** Credential-free application port. API keys remain in infrastructure. */
export interface SettingsRepository {
  load(): Promise<BilimuzhiSettings>;
  save(settings: BilimuzhiSettings): Promise<BilimuzhiSettings>;
  updateRetention(input: {
    readonly applyMode: TrashRetentionApplyMode;
    readonly policy: TrashRetentionPolicy;
  }): Promise<BilimuzhiSettings>;
  selectModel(selection: AiModelSelection): Promise<BilimuzhiSettings>;
}
