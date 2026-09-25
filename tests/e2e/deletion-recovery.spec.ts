import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import { sameOriginMutationHeaders } from "./api-helpers";

const ownedIds: string[] = [];
let sequence = 0;

async function createApplication(request: APIRequestContext) {
  sequence += 1;
  const company = `Recovery ${randomUUID()}`;
  const response = await request.post("/api/applications", {
    data: { company, role: `Delete flow ${sequence}`, status: "APPLIED", appliedDate: "2026-09-22" },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  const { application } = await response.json();
  ownedIds.push(application.id);
  return application as { id: string; company: string; role: string };
}

async function deleteThroughDashboard(page: Page, application: { id: string; company: string; role: string }) {
  await page.getByRole("button", { name: `Edit or archive ${application.role} at ${application.company}`, exact: true }).click();
  const editDialog = page.getByRole("dialog", { name: "Edit job" });
  await editDialog.getByRole("button", { name: "Delete", exact: true }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete application?" });
  const deletion = page.waitForResponse((response) =>
    response.request().method() === "DELETE" && new URL(response.url()).pathname === `/api/applications/${application.id}`,
  );
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
  const response = await deletion;
  expect(response.status()).toBe(200);
  const body = await response.json() as { token: string; expiresAt: string };
  expect(body.token).toEqual(expect.any(String));
  expect(Date.parse(body.expiresAt)).toBeGreaterThan(Date.now());
  expect(Date.parse(body.expiresAt)).toBeLessThanOrEqual(Date.now() + 10 * 60_000);
  return body;
}

test.beforeEach(async ({ page }) => {
  ownedIds.length = 0;
  sequence = 0;
  await page.addInitScript(() => {
    localStorage.removeItem("nook-sidebar-collapsed");
    localStorage.setItem("nook-archived-expanded", "true");
  });
});

test.afterEach(async ({ request }) => {
  await Promise.all(ownedIds.map((id) => request.delete(`/api/applications/${id}`, { headers: sameOriginMutationHeaders })));
});

test("the recovery control restores a deletion after the confirmation toast closes", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();

  await deleteThroughDashboard(page, application);
  const restore = page.getByRole("button", { name: `Restore ${application.company}`, exact: true });
  await expect(restore).toBeVisible();
  await expect(page.locator(".nook-toast")).toBeHidden({ timeout: 7000 });
  await expect(restore).toBeVisible();

  const restored = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/api/applications/${application.id}/restore`),
  );
  await restore.click();
  expect((await restored).status()).toBe(201);
  await expect(page.getByRole("button", { name: `Edit or archive ${application.role} at ${application.company}`, exact: true })).toBeVisible();
  await expect(restore).toBeHidden();
});

test("the toast timer pauses while hidden and recovery still works after returning", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
  await page.evaluate(() => {
    let visibility: DocumentVisibilityState = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => visibility === "hidden" });
    Object.defineProperty(window, "setTestVisibility", {
      value: (next: DocumentVisibilityState) => {
        visibility = next;
        document.dispatchEvent(new Event("visibilitychange"));
      },
    });
  });

  await deleteThroughDashboard(page, application);
  await page.evaluate(() => (window as unknown as { setTestVisibility: (visibility: DocumentVisibilityState) => void }).setTestVisibility("hidden"));
  await page.waitForTimeout(5500);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await page.evaluate(() => (window as unknown as { setTestVisibility: (visibility: DocumentVisibilityState) => void }).setTestVisibility("visible"));
  await expect(undo).toBeVisible();

  const restored = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/api/applications/${application.id}/restore`),
  );
  await undo.click();
  expect((await restored).status()).toBe(201);
  await expect(page.getByRole("button", { name: `Restore ${application.company}`, exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: `Edit or archive ${application.role} at ${application.company}`, exact: true })).toBeVisible();
});

test("the recovery control disappears at the server-provided expiry", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
  await page.route(`**/api/applications/${application.id}*`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: randomUUID(), expiresAt: new Date(Date.now() + 1500).toISOString() }),
    });
  });

  await deleteThroughDashboard(page, application);
  const restore = page.getByRole("button", { name: `Restore ${application.company}`, exact: true });
  await expect(restore).toBeVisible();
  await expect(restore).toBeHidden({ timeout: 2000 });
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeHidden();
});
