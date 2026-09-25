import { Prisma, Status } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { applicationEditSchema, applicationMutationSchema } from "@/lib/application-schema";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredUndoSnapshots } from "@/lib/undo-snapshots";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const application = await prisma.application.findUnique({
      where: { id },
    });
    if (!application) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    return NextResponse.json({ application });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const { id } = await params;
    const { revision, ...input } = applicationEditSchema.parse(parseMutationJson(checked.body));
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
    const mutation = applicationMutationSchema.parse(parseMutationJson(checked.body));
    if ("archived" in mutation && !("status" in mutation)) {
      const result = await updateApplication(id, mutation.revision, { archived: mutation.archived });
      if (!result) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      if (result.conflict) return revisionConflict(result.application);
      return NextResponse.json({ application: result.application });
    }
    const { revision, status, archived, interviewDate, interviewDatePromptDismissed } = mutation as Extract<typeof mutation, { status: Status }>;
    const result = await updateApplication(id, revision, { status, archived, interviewDate, interviewDatePromptDismissed }, status);
    if (!result) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    if (result.conflict) return revisionConflict(result.application);
    return NextResponse.json({ application: result.application });
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const current = await transaction.application.findUnique({ where: { id } });
        if (!current) return null;
        if (current.revision !== expectedRevision) return { application: current, conflict: true as const };

        const updated = await transaction.application.updateMany({
          where: { id: current.id, revision: expectedRevision },
          data: { ...data, revision: { increment: 1 } },
        });
        if (!updated.count) {
          const latest = await transaction.application.findUnique({ where: { id } });
          return latest ? { application: latest, conflict: true as const } : null;
        }
        if (nextStatus && current.status !== nextStatus) {
          await transaction.applicationEvent.create({
            data: {
              applicationId: current.id,
              type: "STATUS_CHANGE",
              detail: `${current.status} → ${nextStatus}`,
            },
          });
        }
        const application = await transaction.application.findUniqueOrThrow({ where: { id } });
        return { application, conflict: false as const };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const canRetry = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2;
      if (!canRetry) throw error;
    }
  }
  throw new Error("Application update retry limit reached");
}

function revisionConflict(application: NonNullable<Awaited<ReturnType<typeof prisma.application.findUnique>>>) {
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
      const expiresAt = new Date(Date.now() + 10 * 60_000);
      const deleted = await prisma.$transaction(async (transaction) => {
        const application = await transaction.application.findUnique({ where: { id }, include: { events: true } });
        if (!application) return null;
        await transaction.undoSnapshot.create({ data: { token, applicationId: id, payload: JSON.stringify(application), expiresAt } });
        await transaction.application.delete({ where: { id } });
        return true;
      });
      if (!deleted) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      return NextResponse.json({ token, expiresAt: expiresAt.toISOString() });
    }
    const result = await prisma.application.deleteMany({ where: { id } });
    if (!result.count) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
