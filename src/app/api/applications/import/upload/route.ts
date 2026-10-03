import { checkMutationHeaders } from "@/lib/mutation-request";
import { stageBackupUpload } from "@/lib/backup-staging";
import { backupOperationError } from "@/lib/backup-operation-response";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const checked = checkMutationHeaders(request);
  if (!checked.ok) return checked.response;
  try { return Response.json(await stageBackupUpload(request), { status: 201, headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return backupOperationError(error); }
}
