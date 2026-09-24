import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("duplicate import gives the warning dialog focus while Settings stays open", async ({ page, request }) => {
  const application = {
    company: `Focus import ${Date.now()}`,
    role: "Duplicate focus check",
    status: "APPLIED",
    appliedDate: "2026-09-22",
    source: "Playwright",
    notes: "",
    jobUrl: "",
  };
  const response = await request.post("/api/applications", { data: application });
  expect(response.status()).toBe(201);
  const { application: saved } = await response.json();

  try {
    await page.goto("/");
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Backup & Restore" }).click();
    const exported = await (await request.get("/api/applications/export")).json();
    await settings.locator('input[type="file"]').setInputFiles({
      name: "duplicate-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...exported, settings: {
        theme: "system", defaultBoard: "APPLIED", motion: "system", boards: [],
        sidebarCollapsed: false, archivedExpanded: false,
      }, applications: [{ ...exported.applications.find((item: { id: string }) => item.id === saved.id), id: randomUUID() }] })),
    });

    const warning = page.getByRole("dialog", { name: "Possible duplicate" });
    await expect(settings).toBeVisible();
    await expect(warning).toBeVisible();
    await expect(warning.getByRole("button", { name: "Cancel import" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(warning.getByRole("button", { name: "Add anyway" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(warning.getByRole("button", { name: "Back to job form" })).toBeFocused();

    await warning.getByRole("button", { name: "Back to job form" }).click();
    await expect(warning).toBeHidden();
    await expect(settings).toBeVisible();
    await page.getByRole("button", { name: "Add job" }).evaluate((button: HTMLButtonElement) => button.focus());
    await expect(settings.getByRole("button", { name: "Close settings" })).toBeFocused();
  } finally {
    await request.delete(`/api/applications/${saved.id}`);
  }
});
