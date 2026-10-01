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
    // Board colors and the sidebar application list are gone; drop the keys older saves still carry so the rest of the settings survive.
    const stored: unknown = JSON.parse(value);
    if (stored && typeof stored === "object") {
      delete (stored as { boards?: unknown }).boards;
      delete (stored as { allApplicationsExpanded?: unknown }).allApplicationsExpanded;
    }
    // Saves from before the time format or week start settings keep their other settings and follow the browser's locale.
    return settingsSchema.parse({ timeFormat: "system", weekStart: "system", ...(stored as object) });
  } catch (error) {
    console.error("Invalid persisted settings; using defaults", error);
    return defaultSettings;
  }
}
