import { redirect } from "next/navigation";
import { readSettings } from "@/lib/database-settings";
import { STARTUP_PAGE_PATHS } from "@/lib/settings-values";

export default async function HomePage() {
  const { settings } = await readSettings();
  redirect(STARTUP_PAGE_PATHS[settings.startupPage]);
}
