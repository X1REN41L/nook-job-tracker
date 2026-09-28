import { prisma } from "@/lib/prisma";
import { settingsSchema } from "@/lib/backup-settings-schema";
import { defaultSettings } from "@/lib/settings-defaults";

export async function readSettings() {
  const row = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!row) return { settings: defaultSettings, revision: 0 };
  return { settings: parseStoredSettings(row.value), revision: row.revision };
}

export function parseStoredSettings(value: string) {
  try {
    return settingsSchema.parse(JSON.parse(value));
  } catch (error) {
    console.error("Invalid persisted settings; using defaults", error);
    return defaultSettings;
  }
}
