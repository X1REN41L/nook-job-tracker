import { randomUUID } from "node:crypto";


import { deleteApplication, exportBackup, expect, test, resetSettings, sameOriginMutationHeaders } from "./api-helpers";

test("a failed status undo keeps Undo available for retry", async ({ page, request }) => {
  const created = await request.post("/api/applications", { data: {
    company: `Undo retry ${randomUUID()}`, role: "Restore check", status: "APPLIED", appliedDate: "2026-09-22",
  }, headers: sameOriginMutationHeaders });
  expect(created.status()).toBe(201);
  const { application } = await created.json();
  try {
    const archived = await request.patch(`/api/applications/${application.id}`, { data: { revision: application.revision, archived: true }, headers: sameOriginMutationHeaders });
    expect(archived.status()).toBe(200);
    await page.goto("/jobs");
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
    const exported = await exportBackup(request);
    const restored = exported.applications.find((item: { id: string }) => item.id === application.id);
    expect(restored.status).toBe("APPLIED");
    expect(restored.archived).toBe(true);
  } finally {
    await deleteApplication(request, application.id);
  }
});

test("backup import restores the sidebar collapse preference", async ({ page, request }) => {
  await resetSettings(request, { sidebarCollapsed: true });
  await page.goto("/jobs");
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();

  const modifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "Meta" : "Control");
  await page.keyboard.press(`${modifier}+Shift+,`);
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Backup & restore" }).click();

  const exported = await exportBackup(request);
  const backup = {
    ...exported,
    settings: {
      ...exported.settings,
      theme: "system",
      motion: "system",
      sidebarCollapsed: false,
      archivedExpanded: false,
    },
  };
  const backupFile = settings.getByLabel("Choose backup file", { exact: true });
  await expect(backupFile).toHaveAttribute("type", "file");
  const fileChooserPromise = page.waitForEvent("filechooser");
  await settings.getByRole("button", { name: "Import", exact: true }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "sidebar-preference.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });

  await expect(page.getByText(/^Imported \d+ applications; skipped \d+; settings restored$/)).toBeVisible();
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
  expect((await (await request.get("/api/settings")).json()).settings.sidebarCollapsed).toBe(false);
  await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeFocused();
});

test("backup picker cancellation does nothing and an invalid file reports an error in Settings", async ({ page }) => {
  let importRequests = 0;
  await page.route("**/api/applications/import", async (route) => {
    if (route.request().method() === "POST") importRequests += 1;
    await route.continue();
  });

  await page.goto("/jobs");
  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  await expect(settingsButton).toBeEnabled();
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("button", { name: "Backup & restore" }).click();
  const importButton = settings.getByRole("button", { name: "Import", exact: true });

  let fileChooserPromise = page.waitForEvent("filechooser");
  await importButton.click();
  await (await fileChooserPromise).setFiles([]);
  await expect(settings).toBeVisible();
  await expect(importButton).toBeFocused();
  await expect(settings.getByRole("alert")).toHaveCount(0);
  await expect(settings.getByRole("status")).toHaveCount(0);
  expect(importRequests).toBe(0);

  fileChooserPromise = page.waitForEvent("filechooser");
  await importButton.click();
  await (await fileChooserPromise).setFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{invalid") });
  await expect(settings.getByRole("alert")).toHaveText("Unsupported or invalid Nook version 1 backup");
  expect(importRequests).toBe(0);
  await expect(settings.getByRole("button", { name: "Close settings" })).toBeFocused();

  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(settingsButton).toBeFocused();
});
