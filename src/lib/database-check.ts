import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// Without npm run setup, Prisma has no .env or creates an empty database, and every page fails with only P2021 errors.
export async function warnIfDatabaseMissing(): Promise<void> {
  let ready = false;
  try {
    const tables = await prisma.$queryRaw<Array<{ name: string }>>(Prisma.sql`SELECT name FROM sqlite_master WHERE type = 'table'`);
    const names = new Set(tables.map((table) => table.name));
    ready = Object.values(Prisma.ModelName).every((model) => names.has(model));
  } catch {
    // An unreadable or unconfigured database gets the same hint.
  }
  if (!ready) console.error("Nook's database is not set up. Stop Nook, run npm run setup, then start Nook again.");
}
