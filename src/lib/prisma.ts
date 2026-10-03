import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaWriteQueue?: Promise<unknown> };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// SQLite has a single writer; a write from this process that overlaps an open interactive transaction stalls both
// until Prisma's socket and transaction timeouts expire, so run every write one at a time.
export function serializeWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = (globalForPrisma.prismaWriteQueue ?? Promise.resolve()).then(write);
  globalForPrisma.prismaWriteQueue = result.catch(() => undefined);
  return result;
}
