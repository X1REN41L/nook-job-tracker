import { prisma } from "@/lib/prisma";
import { settingsSchema } from "@/lib/backup-settings-schema";
import { defaultSettings } from "@/lib/settings-defaults";

export async function readSettings() {
  const row = await prisma.settings.findUnique({ where: { id: 1 } });
  return row ? { settings: settingsSchema.parse(JSON.parse(row.value)), revision: row.revision } : { settings: defaultSettings, revision: 0 };
}
