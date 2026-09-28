import type { STARTUP_PAGES } from "@/lib/settings-values";

export type ApplicationPageName = (typeof STARTUP_PAGES)[number];
export type DashboardSection = "overview" | "analytics" | "stale";
