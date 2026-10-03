import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export { serializeWrite, WriteQueueFullError } from "@/lib/write-queue";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Request failures are logged at the operation boundary without SQL, paths, or values.
    log: [],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
