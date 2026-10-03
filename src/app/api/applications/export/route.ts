import { prisma } from "@/lib/prisma";
import { checkMutationHeaders } from "@/lib/mutation-request";
import { isAllowedHost } from "@/lib/allowed-host";
import { prepareBackupExport, downloadBackupExport } from "@/lib/backup-export";
import { backupOperationError } from "@/lib/backup-operation-response";

export async function POST(request: Request) {
  const check = checkMutationHeaders(request);
  if (!check.ok) return check.response;
  try {
    const databases = await prisma.$queryRawUnsafe<{ name: string; file: string }[]>("PRAGMA database_list");
    const database = databases.find((entry) => entry.name === "main")?.file;
    if (!database) throw new Error("Database unavailable");
    return Response.json(await prepareBackupExport(database, request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return backupOperationError(error); }
}

export async function GET(request: Request) {
  if (!isAllowedHost(request.headers.get("host"))) return Response.json({ error: "Host is not allowed" }, { status: 403 });
  try { return await downloadBackupExport(new URL(request.url).searchParams.get("token") ?? ""); }
  catch (error) { return backupOperationError(error); }
}
