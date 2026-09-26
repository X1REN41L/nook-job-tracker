import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { applicationRestoreSnapshotSchema } from "@/lib/backup-snapshot";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma } from "@/lib/prisma";
import { cleanupExpiredUndoSnapshots } from "@/lib/undo-snapshots";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    await cleanupExpiredUndoSnapshots();
    const { id } = await params;
    const { token } = z.object({ token: z.uuid() }).strict().parse(parseMutationJson(checked.body));
    const result = await prisma.$transaction(async (tx) => {
      const held = await tx.undoSnapshot.findUnique({ where: { token } });
      if (!held || held.applicationId !== id || held.expiresAt <= new Date()) return { status: 404 as const };
      if (await tx.application.findUnique({ where: { id }, select: { id: true } })) return { status: 409 as const };
      const stored = JSON.parse(held.payload);
      const snapshot = {
        ...stored,
        events: stored.events.map(({ id: eventId, type, fromStatus, toStatus, detail, emailSnippet, createdAt }: {
          id: string; type: string; fromStatus?: string | null; toStatus?: string | null;
          detail: string | null; emailSnippet: string | null; createdAt: string;
        }) => ({ id: eventId, type, fromStatus, toStatus, detail, emailSnippet, createdAt })),
      };
      const { events, ...data } = applicationRestoreSnapshotSchema.parse(snapshot);
      const application = await tx.application.create({ data: { ...data, events: { create: events } } });
      await tx.undoSnapshot.delete({ where: { token } });
      return { status: 201 as const, application };
    });
    if (result.status === 404) return NextResponse.json({ error: "Restore token expired or already used" }, { status: 404 });
    if (result.status === 409) return NextResponse.json({ error: "Application ID already exists" }, { status: 409 });
    return NextResponse.json({ application: result.application }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "Application or event ID already exists" }, { status: 409 });
    return apiError(error);
  }
}
