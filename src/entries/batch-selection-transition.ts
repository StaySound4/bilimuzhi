import type { BatchJobView } from "../application/batch-runtime";

interface BatchSelectionClient {
  read(batchJobId: string): Promise<BatchJobView | null>;
  setSelection(
    batchJobId: string,
    selectedItemIds: readonly string[],
  ): Promise<BatchJobView | null>;
}

export async function selectBatchJobAfterClearingPrevious(
  client: BatchSelectionClient,
  previousBatchJobId: string | null,
  nextBatchJobId: string,
): Promise<BatchJobView | null> {
  if (previousBatchJobId !== null && previousBatchJobId !== nextBatchJobId) {
    await client.setSelection(previousBatchJobId, Object.freeze([]));
  }
  return client.read(nextBatchJobId);
}

export async function changeSurfaceAfterClearingBatchSelection<T>(
  client: Pick<BatchSelectionClient, "setSelection">,
  batchJobId: string | null,
  changeSurface: () => T,
): Promise<T> {
  if (batchJobId !== null) {
    await client.setSelection(batchJobId, Object.freeze([]));
  }
  return changeSurface();
}

export async function clearBatchSelectionForSurfaceChange(
  client: Pick<BatchSelectionClient, "setSelection">,
  batchJobId: string | null,
): Promise<void> {
  await changeSurfaceAfterClearingBatchSelection(
    client,
    batchJobId,
    () => undefined,
  );
}
