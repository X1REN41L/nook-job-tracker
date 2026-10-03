import { stagedDuplicate } from "@/lib/backup-duplicate-review";
import { isAllowedHost } from "@/lib/allowed-host";
import { checkMutationHeaders } from "@/lib/mutation-request";
import { cancelStagedBackup, readStagedPage, stagedOutcome } from "@/lib/backup-staging";
import { backupOperationError } from "@/lib/backup-operation-response";

type Context = { params: Promise<{ token: string }> };
export async function GET(request: Request, context: Context) {
  if (!isAllowedHost(request.headers.get("host"))) return Response.json({ error: "Host is not allowed" }, { status: 403 });
  const token = (await context.params).token;
  if (new URL(request.url).searchParams.get("status") === "1") {
    try { return Response.json(stagedOutcome(token), { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return backupOperationError(error); }
  }
  const candidate = new URL(request.url).searchParams.get("candidate");
  if (candidate !== null) {
    const position = Number(candidate);
    if (!Number.isSafeInteger(position) || position < 0) return Response.json({ error: "Invalid candidate position" }, { status: 400 });
    try { return Response.json({ match: await stagedDuplicate(token, position) }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return backupOperationError(error); }
  }
  const after = Number(new URL(request.url).searchParams.get("after") ?? -1);
  if (!Number.isSafeInteger(after) || after < -1) return Response.json({ error: "Invalid page cursor" }, { status: 400 });
  try { return Response.json(await readStagedPage((await context.params).token, after), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return backupOperationError(error); }
}
export async function DELETE(request: Request, context: Context) {
  const checked = checkMutationHeaders(request);
  if (!checked.ok) return checked.response;
  try { await cancelStagedBackup((await context.params).token); return new Response(null, { status: 204 }); }
  catch (error) { return backupOperationError(error); }
}
