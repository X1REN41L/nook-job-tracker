import type { STARTUP_PAGES } from "@/lib/settings-values";

export type ApplicationPageName = (typeof STARTUP_PAGES)[number] | "table";
export type DashboardSection = "overview" | "analytics";
