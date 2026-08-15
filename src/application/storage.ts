export type StorageFailureReason =
  "CONNECTION_INVALID" | "PERSISTED_DATA_INVALID" | "UNKNOWN";

export class StorageError extends Error {
  readonly code = "STORAGE_TRANSACTION_FAILED" as const;

  constructor(
    message: string,
    readonly retryable = false,
    readonly reason: StorageFailureReason = "UNKNOWN",
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export function isInvalidStorageConnectionError(error: unknown): boolean {
  if (error instanceof StorageError) {
    return error.reason === "CONNECTION_INVALID";
  }
  if (typeof error !== "object" || error === null) return false;
  const name = Reflect.get(error, "name");
  return name === "InvalidStateError" || name === "TransactionInactiveError";
}

export function normalizeStorageFailure(
  error: unknown,
  message: string,
): StorageError {
  if (error instanceof StorageError) return error;
  return isInvalidStorageConnectionError(error)
    ? new StorageError(message, true, "CONNECTION_INVALID")
    : new StorageError(message);
}

export function persistedDataStorageError(message: string): StorageError {
  return new StorageError(message, false, "PERSISTED_DATA_INVALID");
}
