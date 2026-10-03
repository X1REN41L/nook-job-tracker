import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { apiError, validationErrorResponse } from "@/lib/api";
import { commitStagedBackup } from "@/lib/backup-commit";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { BackupOperationError, withStagedBackup } from "@/lib/backup-staging";
import { backupOperationError } from "@/lib/backup-operation-response";
import { z } from "zod";

export async function POST(request: Request) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const token = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(parseMutationJson(checked.body));
    if (!token.success) return validationErrorResponse(token.error);
    const result = await withStagedBackup(token.data.token, (reader) => commitStagedBackup(reader, request.signal), request.signal);
    return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Backup ID conflicts with an existing record" }, { status: 409 });
    return error instanceof BackupOperationError ? backupOperationError(error) : apiError(error, "applications/import");
  }
}
