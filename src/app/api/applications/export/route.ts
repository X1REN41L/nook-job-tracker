import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { settingsSchema } from "@/lib/backup-settings-schema";

const defaultSettings = settingsSchema.parse({
  theme: "system", defaultBoard: "APPLIED", motion: "system", boards: [],
  sidebarCollapsed: false, archivedExpanded: false,
});

export async function GET() {
  try {
    const applications = await prisma.application.findMany({ include: { events: { orderBy: { id: "asc" } } }, orderBy: { id: "asc" } });
    return NextResponse.json({ version: 2, applications: applications.map(({ events, ...application }) => ({ ...application, events: events.map(({ id, type, detail, emailSnippet, createdAt }) => ({ id, type, detail, emailSnippet, createdAt })) })), settings: defaultSettings });
  } catch (error) { return apiError(error); }
}
