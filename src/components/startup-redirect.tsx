"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getStartupPage } from "@/lib/general-preferences";
import { refreshSettings } from "@/lib/settings-store";

export function StartupRedirect() {
  const router = useRouter();
  useEffect(() => {
    void refreshSettings().catch(() => {}).finally(() => {
      const path = { dashboard: "/dashboard", "job-board": "/jobs", interviews: "/interviews" }[getStartupPage()];
      router.replace(path);
    });
  }, [router]);
  return null;
}
