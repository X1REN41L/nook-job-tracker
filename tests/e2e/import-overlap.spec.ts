import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { sameOriginMutationHeaders } from "./api-helpers";

test("ignores a file selected during an import and accepts it after completion", async ({ page, request }) => {
  const first = { company: `Overlap first ${Date.now()}`, role: "Import overlap", status: "APPLIED", appliedDate: "2026-09-22" };
  const second = { company: `Overlap second ${Date.now()}`, role: "Import overlap", status: "APPLIED", appliedDate: "2026-09-22" };
  const posted: string[] = [];
  const savedIds: string[] = [];
  let startFirst!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => { startFirst = resolve; });
  const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });

  await page.route("**/api/applications/import", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posted.push(JSON.parse(route.request().postData() ?? "{}").applications[0].company);
    if (posted.length === 1) {
      startFirst();
      await firstReleased;
    }
    const response = await route.fetch();
    if (response.status() === 201) savedIds.push(...(await response.json()).applications.map(({ id }: { id: string }) => id));
    await route.fulfill({ response });
  });

  try {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Backup & Restore" }).click();
    const input = settings.locator('input[type="file"]');
    const select = (application: typeof first) => input.setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 1, applications: [{
        ...application, id: randomUUID(), archived: false, source: null, interviewDate: null,
        interviewDatePromptDismissed: false, notes: null, jobUrl: null,
        appliedDate: new Date(application.appliedDate).toISOString(),
        createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), events: [],
      }], settings: {
        theme: "system", defaultBoard: "APPLIED", startupPage: "dashboard", staleApplicationThreshold: 15,
        motion: "system", boards: [], sidebarCollapsed: false, archivedExpanded: false, allApplicationsExpanded: true,
      } })),
    });

    await select(first);
    await firstStarted;
    await select(second);
    releaseFirst();
    await expect(page.locator(".nook-toast")).toContainText("Imported 1 applications");
    expect(posted).toEqual([first.company]);

    await select(second);
    await expect.poll(() => savedIds.length).toBe(2);
    expect(posted).toEqual([first.company, second.company]);
  } finally {
    releaseFirst();
    await Promise.all(savedIds.map((id) => request.delete(`/api/applications/${id}`, { headers: sameOriginMutationHeaders })));
  }
});
