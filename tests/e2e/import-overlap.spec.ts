
import { randomUUID } from "node:crypto";

import { deleteApplication, expect, test } from "./api-helpers";

test("ignores a file selected during an import and accepts it after completion", async ({ page, request }) => {
  const first = { company: `Overlap first ${Date.now()}`, role: "Import overlap", status: "APPLIED", appliedDate: "2026-09-22" };
  const second = { company: `Overlap second ${Date.now()}`, role: "Import overlap", status: "APPLIED", appliedDate: "2026-09-22" };
  const posted: string[] = [];
  const savedIds: string[] = [];
  let committed = 0;
  let startFirst!: () => void;
  let releaseFirst!: () => void;
  const firstStarted = new Promise<void>((resolve) => { startFirst = resolve; });
  const firstReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });

  await page.route("**/api/applications/import/upload", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const selected = JSON.parse(route.request().postData() ?? "{}").applications[0];
    posted.push(selected.company);
    savedIds.push(selected.id);
    if (posted.length === 1) {
      startFirst();
      await firstReleased;
    }
    const response = await route.fetch();
    await route.fulfill({ response });
  });

  await page.route("**/api/applications/import", async (route) => {
    const response = await route.fetch();
    if (response.status() === 201) {
      expect((await response.json()).created).toBe(1);
      committed += 1;
    }
    await route.fulfill({ response });
  });

  try {
    await page.goto("/jobs");
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Backup & restore" }).click();
    const input = settings.locator('input[type="file"]');
    const select = (application: typeof first) => input.setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 1, applications: [{
        ...application, id: randomUUID(), archived: false, source: null, followUpDate: null, followUpNote: null,
        interviewDatePromptDismissed: false, notes: null, jobUrl: null, interviews: [], contacts: [],
        appliedDate: new Date(application.appliedDate).toISOString(),
        createdAt: new Date().toISOString(), lastUpdated: new Date().toISOString(), events: [],
      }], settings: {
        theme: "system", startupPage: "dashboard", staleApplicationThreshold: 15,
        motion: "system", timeFormat: "system", weekStart: "system", sidebarCollapsed: false, archivedExpanded: false,
      } })),
    });

    await select(first);
    await firstStarted;
    await select(second);
    releaseFirst();
    await expect(page.locator(".nook-toast")).toContainText("Imported 1 applications");
    expect(posted).toEqual([first.company]);

    await select(second);
    // Wait for the second import to commit, so cleanup deletes it and no upload is still in flight when the test ends.
    await expect.poll(() => committed).toBe(2);
    expect(posted).toEqual([first.company, second.company]);
  } finally {
    releaseFirst();
    await Promise.all(savedIds.map((id) => deleteApplication(request, id)));
  }
});
