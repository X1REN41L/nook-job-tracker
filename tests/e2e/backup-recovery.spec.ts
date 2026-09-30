import { randomUUID } from "node:crypto";


import { expect, test, resetSettings, sameOriginMutationHeaders } from "./api-helpers";

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
    const exported = await (await request.get("/api/applications/export")).json();
    const restored = exported.applications.find((item: { id: string }) => item.id === application.id);
    expect(restored.status).toBe("APPLIED");
    expect(restored.archived).toBe(true);
  } finally {
    await request.delete(`/api/applications/${application.id}`, { headers: sameOriginMutationHeaders });
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

  const exported = await (await request.get("/api/applications/export")).json();
  const backup = {
    ...exported,
    settings: {
      ...exported.settings,
      theme: "system",
      defaultBoard: "APPLIED",
      motion: "system",
      sidebarCollapsed: false,
      archivedExpanded: false,
    },
  };
  await settings.locator('input[type="file"]').setInputFiles({
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
