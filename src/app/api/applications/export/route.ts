import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { readSettings } from "@/lib/database-settings";
import { storedChildren } from "@/lib/backup-snapshot";

export async function GET() {
  try {
    const [applications, stored] = await Promise.all([
      prisma.application.findMany({
        include: { events: { orderBy: { id: "asc" } }, interviews: { orderBy: { id: "asc" } }, contacts: { orderBy: { id: "asc" } } },
        orderBy: { id: "asc" },
      }),
      readSettings(),
    ]);
    return NextResponse.json({
      version: 1,
      applications: applications.map(({ events, interviews, contacts, revision, ...application }) => {
        void revision;
        return { ...application, ...storedChildren({ events, interviews, contacts }) };
      }),
      settings: stored.settings,
    });
  } catch (error) { return apiError(error); }
}
