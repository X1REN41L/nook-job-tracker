import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, validationErrorResponse } from "@/lib/api";
import { settingsSchema } from "@/lib/backup-settings-schema";
import { parseStoredSettings, readSettings } from "@/lib/database-settings";
import { checkMutationRequest, parseMutationJson } from "@/lib/mutation-request";
import { prisma, serializeWrite } from "@/lib/prisma";
import { defaultSettings } from "@/lib/settings-defaults";

const patchSchema = z.object({ revision: z.number().int().nonnegative(), changes: settingsSchema.partial().strict() }).strict();

export async function GET() {
  try { return NextResponse.json(await readSettings()); }
  catch (error) { return apiError(error, "settings"); }
}

export async function PATCH(request: Request) {
  try {
    const checked = await checkMutationRequest(request);
    if (!checked.ok) return checked.response;
    const parsed = patchSchema.safeParse(parseMutationJson(checked.body));
    if (!parsed.success) return validationErrorResponse(parsed.error);
    const { revision, changes } = parsed.data;
    const result = await serializeWrite(() => prisma.$transaction(async (tx) => {
      const row = await tx.settings.findUnique({ where: { id: 1 } });
      const current = row ? parseStoredSettings(row.value) : defaultSettings;
      if ((row?.revision ?? 0) !== revision) return { conflict: true, settings: current, revision: row?.revision ?? 0 };
      const settings = settingsSchema.parse({ ...current, ...changes });
      const value = JSON.stringify(settings);
      if (row) {
        const updated = await tx.settings.update({ where: { id: 1 }, data: { value, revision: { increment: 1 } } });
        return { conflict: false, settings, revision: updated.revision };
      }
      await tx.settings.create({ data: { id: 1, value, revision: 1 } });
      return { conflict: false, settings, revision: 1 };
    }));
    return NextResponse.json({ settings: result.settings, revision: result.revision }, { status: result.conflict ? 409 : 200 });
  } catch (error) { return apiError(error, "settings"); }
}
