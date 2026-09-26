"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { getStartupPage } from "@/lib/general-preferences";

export function StartupRedirect() {
  const router = useRouter();
  useEffect(() => {
    const path = { dashboard: "/dashboard", "job-board": "/jobs", interviews: "/interviews" }[getStartupPage()];
    router.replace(path);
  }, [router]);
  return null;
}
