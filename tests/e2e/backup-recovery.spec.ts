import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("a failed status undo keeps Undo available for retry", async ({ page, request }) => {
  const created = await request.post("/api/applications", { data: {
    company: `Undo retry ${randomUUID()}`, role: "Restore check", status: "APPLIED", appliedDate: "2026-09-22",
  } });
  expect(created.status()).toBe(201);
  const { application } = await created.json();
  try {
    const archived = await request.patch(`/api/applications/${application.id}`, { data: { archived: true } });
    expect(archived.status()).toBe(200);
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    const row = page.locator(`[data-application-id="${application.id}"]`);
    await page.getByRole("button", { name: /^Archived\s+\d+$/ }).click();
    await row.getByRole("button", { name: "Restore", exact: true }).click();
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    await expect(undo).toBeVisible();

    await page.route(`**/api/applications/${application.id}`, async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary failure" }) });
      } else await route.continue();
    });
    await undo.click();
    await expect(page.locator(".nook-toast").getByText("Temporary failure")).toBeVisible();
    await expect(undo).toBeVisible();
    await page.unroute(`**/api/applications/${application.id}`);
    const retry = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${application.id}`));
    await undo.click();
    expect((await retry).status()).toBe(200);
    const exported = await (await request.get("/api/applications/export")).json();
    const restored = exported.applications.find((item: { id: string }) => item.id === application.id);
    expect(restored.status).toBe("APPLIED");
    expect(restored.archived).toBe(true);
  } finally {
    await request.delete(`/api/applications/${application.id}`);
  }
});

test("settings storage failure reports committed imported applications separately", async ({ page, request }) => {
  const created = await request.post("/api/applications", { data: {
    company: `Storage check ${randomUUID()}`, role: "Import check", status: "APPLIED", appliedDate: "2026-09-22",
  } });
  expect(created.status()).toBe(201);
  const { application } = await created.json();
  const importedId = randomUUID();
  try {
    const exported = await (await request.get("/api/applications/export")).json();
    const record = exported.applications.find((item: { id: string }) => item.id === application.id);
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "nook-sidebar-collapsed") throw new DOMException("Storage unavailable", "QuotaExceededError");
        return original.call(this, key, value);
      };
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Backup & Restore" }).click();
    await settings.locator('input[type="file"]').setInputFiles({
      name: "storage-failure.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...exported, settings: {
        theme: "system", defaultBoard: "APPLIED", motion: "system", boards: [],
        sidebarCollapsed: false, archivedExpanded: false,
      }, applications: [{ ...record, id: importedId, company: `${record.company} restored`, events: [] }] })),
    });
    await expect(page.getByText("Imported 1 applications; skipped 0; settings could not be restored")).toBeVisible();
    const after = await (await request.get("/api/applications/export")).json();
    expect(after.applications.some((item: { id: string }) => item.id === importedId)).toBe(true);
  } finally {
    await request.delete(`/api/applications/${importedId}`);
    await request.delete(`/api/applications/${application.id}`);
  }
});
