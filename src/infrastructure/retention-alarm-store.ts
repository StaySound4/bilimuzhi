export const TRASH_RETENTION_ALARM_NAME = "muzhi.trash-retention-purge";

export interface RetentionAlarmApi {
  clear(name: string): boolean | Promise<boolean>;
  create(name: string, alarmInfo: { readonly when: number }): void;
}

export interface RetentionAlarmStoreDependencies {
  readonly alarms: RetentionAlarmApi;
  readonly retentionRepository: {
    getNextPurgeAt(): Promise<number | null>;
  };
  readonly trashRepository: {
    permanentlyDeleteExpiredTrashBranches(
      now: number,
    ): Promise<readonly string[]>;
  };
}

export class RetentionAlarmStore {
  constructor(private readonly dependencies: RetentionAlarmStoreDependencies) {}

  async synchronize(): Promise<number | null> {
    const nextPurgeAt =
      await this.dependencies.retentionRepository.getNextPurgeAt();
    if (nextPurgeAt === null) {
      await this.dependencies.alarms.clear(TRASH_RETENTION_ALARM_NAME);
      return null;
    }
    this.dependencies.alarms.create(TRASH_RETENTION_ALARM_NAME, {
      when: nextPurgeAt,
    });
    return nextPurgeAt;
  }

  async handleAlarm(
    alarmName: string,
    now: number,
  ): Promise<readonly string[]> {
    if (alarmName !== TRASH_RETENTION_ALARM_NAME) return Object.freeze([]);
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error("The Bilimuzhi retention alarm clock is invalid");
    }
    const purged =
      await this.dependencies.trashRepository.permanentlyDeleteExpiredTrashBranches(
        now,
      );
    await this.synchronize();
    return Object.freeze([...purged]);
  }
}
