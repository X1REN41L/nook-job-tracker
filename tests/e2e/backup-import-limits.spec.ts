import { randomUUID } from "node:crypto";


import { deleteApplication, exportBackup, expect, test, sameOriginMutationHeaders } from "./api-helpers";

const maxFileBytes = 10 * 1024 * 1024;
const settings = {
  theme: "system", startupPage: "dashboard", staleApplicationThreshold: 15,
  motion: "system", timeFormat: "system", weekStart: "system", sidebarCollapsed: false, archivedExpanded: false,
};

test("backup import rejects invalid files, reviews duplicates, and accepts a large file", async ({ page, request }) => {
  test.setTimeout(120_000);
  const importRequests: string[] = [];
  await page.route("**/api/applications/import", async (route) => {
    if (route.request().method() === "POST") importRequests.push(route.request().postData() ?? "");
    await route.continue();
  });

  let seedId: string | undefined;
  const largeId = randomUUID();
  try {
    const created = await request.post("/api/applications", {
      headers: sameOriginMutationHeaders,
      data: { company: `Import duplicate ${randomUUID()}`, role: "Duplicate review", status: "APPLIED", appliedDate: "2026-09-22" },
    });
    expect(created.status()).toBe(201);
    const { application: seed } = await created.json();
    seedId = seed.id;
    const initialCount = (await (await request.get("/api/applications")).json()).applications.length;

    await page.goto("/jobs");
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("button", { name: "Backup & restore" }).click();
    const input = dialog.locator('input[type="file"]');

    await input.setInputFiles({ name: "oversized.json", mimeType: "application/json", buffer: Buffer.alloc(maxFileBytes + 1, 0x20) });
    await expect(dialog.getByRole("alert")).toHaveText("Unsupported or invalid Nook version 1 backup");
    expect(importRequests).toHaveLength(0);
    expect((await (await request.get("/api/applications")).json()).applications).toHaveLength(initialCount);

    const overCount = { version: 1, applications: Array(5_001).fill(null), settings };
    await input.setInputFiles({ name: "too-many.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(overCount)) });
    await expect(dialog.getByRole("alert")).toHaveText("Unsupported or invalid Nook version 1 backup");
    expect(importRequests).toHaveLength(0);
    expect((await (await request.get("/api/applications")).json()).applications).toHaveLength(initialCount);

    await input.setInputFiles({ name: "malformed.json", mimeType: "application/json", buffer: Buffer.from("{not json") });
    await expect(dialog.getByRole("alert")).toHaveText("Unsupported or invalid Nook version 1 backup");
    expect(importRequests).toHaveLength(0);

    const seedExport = await exportBackup(request);
    const duplicate = { ...seedExport.applications.find((item: { id: string }) => item.id === seedId), id: randomUUID() };
    await input.setInputFiles({
      name: "duplicate.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ version: 1, applications: [duplicate], settings })),
    });
    const duplicateDialog = page.getByRole("dialog", { name: "Possible duplicate" });
    await expect(duplicateDialog).toBeVisible();
    expect(importRequests).toHaveLength(0);
    await duplicateDialog.getByRole("button", { name: "Cancel import" }).click();

    const now = new Date().toISOString();
    const nearLimitBackup = {
      version: 1,
      applications: [{
        id: largeId, company: "Near limit import", role: "Large backup", status: "APPLIED", archived: false,
        source: null, appliedDate: "2026-09-22T00:00:00.000Z", followUpDate: null, followUpNote: null, interviewDatePromptDismissed: false, interviews: [], contacts: [],
        notes: null, jobUrl: null, createdAt: now, lastUpdated: now,
        events: Array.from({ length: 2_200 }, () => ({
          id: randomUUID(), type: "NOTE_ADDED", detail: "x".repeat(5_000),
          fromStatus: null, toStatus: null, createdAt: now,
        })),
      }],
      settings,
    };
    const nearLimitFile = Buffer.from(JSON.stringify(nearLimitBackup));
    expect(nearLimitFile.byteLength).toBeGreaterThan(maxFileBytes);
    await input.setInputFiles({ name: "near-limit.json", mimeType: "application/json", buffer: nearLimitFile });
    await expect(page.locator(".nook-toast")).toContainText("Imported 1 applications", { timeout: 30_000 });
    expect(importRequests).toHaveLength(1);
    const imported = await exportBackup(request);
    expect(imported.applications.some((item: { id: string }) => item.id === largeId)).toBe(true);
  } finally {
    await Promise.all([seedId, largeId].filter((id): id is string => Boolean(id)).map((id) =>
      deleteApplication(request, id),
    ));
  }
});
