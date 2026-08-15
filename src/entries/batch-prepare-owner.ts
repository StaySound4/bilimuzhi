export type BatchPrepareOwner = Readonly<{
  generation: number;
  mode: "append-existing";
  operationId: string;
  ownerJobId: string;
}>;

export interface BatchPrepareEventIdentity {
  readonly batchJobId: string;
  readonly operationId?: string;
  readonly status: string;
}

export function createAppendBatchPrepareOwner(
  generation: number,
  targetBatchJobId: string,
  operationId: string,
): BatchPrepareOwner {
  return Object.freeze({
    generation,
    mode: "append-existing",
    operationId,
    ownerJobId: targetBatchJobId,
  });
}

export function acceptBatchPrepareEvent(
  owner: BatchPrepareOwner | undefined,
  event: BatchPrepareEventIdentity,
): Readonly<{
  accepted: boolean;
  owner: BatchPrepareOwner | undefined;
}> {
  if (!owner) return Object.freeze({ accepted: false, owner });
  return Object.freeze({
    accepted:
      event.batchJobId === owner.ownerJobId &&
      event.operationId === owner.operationId,
    owner,
  });
}
