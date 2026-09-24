import { Prisma, Status } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { applicationInputSchema, applicationMutationSchema } from "@/lib/application-schema";
import { prisma } from "@/lib/prisma";

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
    const { id } = await params;
    const input = applicationInputSchema.parse(await request.json());
    const application = await updateApplication(id, input, input.status);
    if (!application) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    return NextResponse.json({ application });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    const mutation = applicationMutationSchema.parse(await request.json());
    if ("archived" in mutation && !("status" in mutation)) {
      const application = await prisma.application.updateMany({
        where: { id },
        data: { archived: mutation.archived },
      });
      if (!application.count) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      return NextResponse.json({ application: await prisma.application.findUniqueOrThrow({ where: { id } }) });
    }
    const { status, archived, interviewDate, interviewDatePromptDismissed } = mutation as Extract<typeof mutation, { status: Status }>;
    const application = await updateApplication(id, { status, archived, interviewDate, interviewDatePromptDismissed }, status);
    if (!application) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    return NextResponse.json({ application });
  } catch (error) {
    return apiError(error);
  }
}

async function updateApplication(
  id: string,
  data: Prisma.ApplicationUpdateInput,
  nextStatus: Status,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const current = await transaction.application.findUnique({ where: { id } });
        if (!current) return null;

        const application = await transaction.application.update({
          where: { id: current.id },
          data,
        });
        if (current.status !== nextStatus) {
          await transaction.applicationEvent.create({
            data: {
              applicationId: current.id,
              type: "STATUS_CHANGE",
              detail: `${current.status} → ${nextStatus}`,
            },
          });
        }
        return application;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      const canRetry = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2;
      if (!canRetry) throw error;
    }
  }
  throw new Error("Application update retry limit reached");
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    const { id } = await params;
    if (new URL(request.url).searchParams.get("undoable") === "1") {
      const token = randomUUID();
      const deleted = await prisma.$transaction(async (transaction) => {
        const application = await transaction.application.findUnique({ where: { id }, include: { events: true } });
        if (!application) return null;
        await transaction.undoSnapshot.create({ data: { token, applicationId: id, payload: JSON.stringify(application), expiresAt: new Date(Date.now() + 10 * 60_000) } });
        await transaction.application.delete({ where: { id } });
        return true;
      });
      if (!deleted) return NextResponse.json({ error: "Application not found" }, { status: 404 });
      return NextResponse.json({ token });
    }
    const result = await prisma.application.deleteMany({ where: { id } });
    if (!result.count) return NextResponse.json({ error: "Application not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
