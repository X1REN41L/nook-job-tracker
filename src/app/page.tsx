import { redirect } from "next/navigation";
import { readSettings } from "@/lib/database-settings";

export default async function HomePage() {
  const { settings } = await readSettings();
  redirect({ dashboard: "/dashboard", "job-board": "/jobs", interviews: "/interviews" }[settings.startupPage]);
}
