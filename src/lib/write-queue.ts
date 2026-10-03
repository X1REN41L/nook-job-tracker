const shared = globalThis as unknown as { prismaWriteQueue?: Promise<unknown>; prismaPendingWrites?: number };

export class WriteQueueFullError extends Error {}

// SQLite has one writer. A running operation may have at most 64 waiters behind it.
export function serializeWrite<T>(write: () => Promise<T>): Promise<T> {
  if ((shared.prismaPendingWrites ?? 0) >= 65) return Promise.reject(new WriteQueueFullError());
  shared.prismaPendingWrites = (shared.prismaPendingWrites ?? 0) + 1;
  const result = (shared.prismaWriteQueue ?? Promise.resolve()).then(write).finally(() => {
    shared.prismaPendingWrites!--;
  });
  shared.prismaWriteQueue = result.catch(() => undefined);
  return result;
}
