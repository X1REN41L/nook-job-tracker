import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, parseRequest } from "@/lib/api";
import { applicationInclude } from "@/lib/application-record";
import { applicationRestoreSnapshotSchema, storedChildren } from "@/lib/backup-snapshot";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma, serializeWrite } from "@/lib/prisma";
import { cleanupExpiredUndoSnapshots } from "@/lib/undo-snapshots";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    await cleanupExpiredUndoSnapshots();
    const { id } = await params;
    const { token } = parseRequest(z.object({ token: z.uuid() }).strict(), parseMutationJson(checked.body));
    const result = await serializeWrite(() => prisma.$transaction(async (tx) => {
      const held = await tx.undoSnapshot.findUnique({ where: { token } });
      if (!held || held.applicationId !== id || held.expiresAt <= new Date()) return { status: 404 as const };
      if (await tx.application.findUnique({ where: { id }, select: { id: true } })) return { status: 409 as const };
      const stored = JSON.parse(held.payload);
      const { events, interviews, contacts, ...data } = applicationRestoreSnapshotSchema.parse({ ...stored, ...storedChildren(stored) });
      const application = await tx.application.create({
        data: { ...data, events: { create: events }, interviews: { create: interviews }, contacts: { create: contacts } },
        include: applicationInclude,
      });
      await tx.undoSnapshot.delete({ where: { token } });
      return { status: 201 as const, application };
    }));
    if (result.status === 404) return NextResponse.json({ error: "Restore token expired or already used" }, { status: 404 });
    if (result.status === 409) return NextResponse.json({ error: "Application ID already exists" }, { status: 409 });
    return NextResponse.json({ application: result.application }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Application or event ID already exists" }, { status: 409 });
    return apiError(error, "applications/item/restore");
  }
}
