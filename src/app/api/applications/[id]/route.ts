import { Prisma, Status } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError, isDatabaseContention, parseRequest } from "@/lib/api";
import { applicationInclude, type StoredApplication } from "@/lib/application-record";
import { applicationEditSchema, applicationMutationSchema } from "@/lib/application-schema";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma, serializeWrite } from "@/lib/prisma";
import { nextStatusEventTime, statusTransitionDetail } from "@/lib/status-history";
import { cleanupExpiredUndoSnapshots, UNDO_SNAPSHOT_TTL_MS } from "@/lib/undo-snapshots";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const application = await prisma.application.findUnique({
      where: { id },
      include: { ...applicationInclude, events: { select: { id: true, type: true, fromStatus: true, toStatus: true, detail: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    if (!application) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    const { events, ...record } = application;
    return NextResponse.json({ application: record, events });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const { id } = await params;
    const { revision, ...input } = parseRequest(applicationEditSchema, parseMutationJson(checked.body));
    const result = await updateApplication(id, revision, input, input.status);
    if (!result) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    if (result.conflict) return revisionConflict(result.application);
    return NextResponse.json({ application: result.application });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const { id } = await params;
    const mutation = parseRequest(applicationMutationSchema, parseMutationJson(checked.body));
    if (!("status" in mutation)) {
      const data = "archived" in mutation ? { archived: mutation.archived } : { followUpDate: mutation.followUpDate };
      const result = await updateApplication(id, mutation.revision, data);
      if (!result) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      if (result.conflict) return revisionConflict(result.application);
      return NextResponse.json({ application: result.application });
    }
    const { revision, status, archived, interviewDatePromptDismissed } = mutation;
    const result = await updateApplication(id, revision, { status, archived, interviewDatePromptDismissed }, status);
    if (!result) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    if (result.conflict) return revisionConflict(result.application);
    return NextResponse.json({ application: result.application, latestStatusEventId: result.latestStatusEventId ?? null });
  } catch (error) {
    return apiError(error);
  }
}

async function updateApplication(
  id: string,
  expectedRevision: number,
  data: Prisma.ApplicationUpdateManyMutationInput,
  nextStatus?: Status,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const current = await prisma.application.findUnique({ where: { id }, include: applicationInclude });
      if (!current) return null;
      if (current.revision !== expectedRevision) return { application: current, conflict: true as const };
      const leavingInterview = current.status === Status.INTERVIEW && nextStatus !== undefined && nextStatus !== Status.INTERVIEW;
      return await serializeWrite(() => prisma.$transaction(async (transaction) => {
        const updated = await transaction.application.updateMany({
          where: { id: current.id, revision: expectedRevision },
          data: { ...data, ...(leavingInterview && { interviewDatePromptDismissed: false }), revision: { increment: 1 } },
        });
        if (!updated.count) {
          const latest = await transaction.application.findUnique({ where: { id }, include: applicationInclude });
          return latest ? { application: latest, conflict: true as const } : null;
        }
        let latestStatusEventId: string | null = null;
        if (nextStatus && current.status !== nextStatus) {
          const latestEvent = await transaction.applicationEvent.findFirst({
            where: { applicationId: current.id },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          });
          const event = await transaction.applicationEvent.create({
            data: {
              applicationId: current.id,
              type: "STATUS_CHANGE",
              fromStatus: current.status,
              toStatus: nextStatus,
              detail: statusTransitionDetail(current.status, nextStatus),
              createdAt: nextStatusEventTime(latestEvent?.createdAt ?? null),
            },
          });
          latestStatusEventId = event.id;
        }
        const application = await transaction.application.findUniqueOrThrow({ where: { id }, include: applicationInclude });
        return { application, conflict: false as const, latestStatusEventId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }));
    } catch (error) {
      const canRetry = isDatabaseContention(error) && attempt < 5;
      if (!canRetry) throw error;
    }
  }
  throw new Error("Application update retry limit reached");
}

function revisionConflict(application: StoredApplication) {
  return NextResponse.json({
    error: "Application changed since it was loaded. The current version is included so you can review it.",
    application,
  }, { status: 409 });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    await cleanupExpiredUndoSnapshots();
    const { id } = await params;
    if (new URL(request.url).searchParams.get("undoable") === "1") {
      const token = randomUUID();
      const expiresAt = new Date(Date.now() + UNDO_SNAPSHOT_TTL_MS);
      const deleted = await serializeWrite(() => prisma.$transaction(async (transaction) => {
        const application = await transaction.application.findUnique({ where: { id }, include: { events: true, interviews: true, contacts: true } });
        if (!application) return null;
        await transaction.undoSnapshot.create({ data: { token, applicationId: id, payload: JSON.stringify(application), expiresAt } });
        await transaction.application.delete({ where: { id } });
        return true;
      }));
      if (!deleted) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      return NextResponse.json({ token, expiresAt: expiresAt.toISOString() });
    }
    // Plain DELETE is retained for callers that need permanent deletion; the UI uses ?undoable=1.
    const result = await serializeWrite(() => prisma.application.deleteMany({ where: { id } }));
    if (!result.count) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
