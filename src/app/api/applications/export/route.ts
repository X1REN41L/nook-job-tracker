import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readSettings } from "@/lib/database-settings";

export async function GET() {
  try {
    const [applications, stored] = await Promise.all([
      prisma.application.findMany({ include: { events: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } }),
      readSettings(),
    ]);
    return NextResponse.json({
      version: 1,
      applications: applications.map(({ events, revision, ...application }) => {
        void revision;
        return { ...application, events: events.map(({ id, type, fromStatus, toStatus, detail, emailSnippet, createdAt }) => ({ id, type, fromStatus, toStatus, detail, emailSnippet, createdAt })) };
      }),
      settings: stored.settings,
    });
  } catch (error) { return apiError(error); }
}
