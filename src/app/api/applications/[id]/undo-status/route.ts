import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { apiError, isDatabaseContention, parseRequest } from "@/lib/api";
import { applicationInclude, type StoredApplication } from "@/lib/application-record";
import { applicationStatusUndoSchema } from "@/lib/application-schema";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma, serializeWrite } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };
class StaleStatusEvent extends Error {}

function revisionConflict(application: StoredApplication) {
  return NextResponse.json({
    error: "Application changed since it was loaded. The current version is included so you can review it.",
    application,
  }, { status: 409 });
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const { id } = await params;
    const undo = parseRequest(applicationStatusUndoSchema, parseMutationJson(checked.body));

    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const current = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
        if (!current) return NextResponse.json({ error: "Application not found" }, { status: 404 });
        if (current.revision !== undo.revision) return revisionConflict(current);

        const result = await serializeWrite(() => prisma.$transaction(async (transaction) => {
          const updated = await transaction.application.updateMany({
            where: { id, revision: undo.revision },
            data: { revision: { increment: 1 } },
          });
          if (!updated.count) return null;

          const latest = await transaction.applicationEvent.findFirst({
            where: { applicationId: id, type: "STATUS_CHANGE" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          if (latest?.id !== undo.expectedLatestStatusEventId || latest.toStatus !== current.status || !latest.fromStatus) {
            throw new StaleStatusEvent();
          }
          await transaction.applicationEvent.delete({ where: { id: latest.id } });
          if (undo.promptInterviewId) {
            await transaction.interview.deleteMany({ where: { id: undo.promptInterviewId, applicationId: id } });
          }
          return transaction.application.update({
            where: { id },
            data: {
              status: latest.fromStatus,
              archived: undo.archived,
              interviewDatePromptDismissed: undo.interviewDatePromptDismissed,
            },
            include: applicationInclude,
          });
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));

        if (result) return NextResponse.json({ application: result });
        const latest = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
        return latest ? revisionConflict(latest) : NextResponse.json({ error: "Application not found" }, { status: 404 });
      } catch (error) {
        if (error instanceof StaleStatusEvent) {
          const latest = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
          return latest ? revisionConflict(latest) : NextResponse.json({ error: "Application not found" }, { status: 404 });
        }
        if (!isDatabaseContention(error) || attempt === 5) throw error;
      }
    }
    throw new Error("Status undo retry limit reached");
  } catch (error) {
    return apiError(error, "applications/item/undo-status");
  }
}
