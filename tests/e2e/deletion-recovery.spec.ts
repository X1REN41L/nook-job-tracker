import { randomUUID } from "node:crypto";
import { type APIRequestContext, type Page } from "@playwright/test";


import { deleteApplication, gotoReady, expect, resetSettings, test, sameOriginMutationHeaders } from "./api-helpers";

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
  await page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}`, exact: true }).click();
  await page.getByRole("dialog", { name: application.role }).getByRole("button", { name: "Delete", exact: true }).click();
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

test.beforeEach(async ({ request }) => {
  ownedIds.length = 0;
  sequence = 0;
  await resetSettings(request, { archivedExpanded: true });
});

test.afterEach(async ({ request }) => {
  await Promise.all(ownedIds.map((id) => deleteApplication(request, id)));
});

test("deletion offers Undo without a separate recovery banner", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.goto("/jobs");
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();

  const announcement = page.locator(".nook-toast-wrap");
  await expect(announcement).toHaveAttribute("role", "status");
  await expect(announcement).toHaveAttribute("aria-live", "polite");
  await expect(announcement).toHaveAttribute("aria-hidden", "true");
  const persistentWrapper = await announcement.elementHandle();
  if (!persistentWrapper) throw new Error("Missing persistent toast wrapper");

  await deleteThroughDashboard(page, application);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Deletion recovery" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Restore ${application.company}`, exact: true })).toHaveCount(0);

  await expect(announcement).toHaveAttribute("aria-hidden", "false");
  expect(await announcement.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await undo.focus();
  await expect(undo).toBeFocused();
  await page.getByRole("button", { name: "Add job" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add a job" });
  await expect(addDialog).toBeVisible();
  await expect(announcement).toHaveAttribute("aria-hidden", "true");
  expect(await announcement.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  expect(await addDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(addDialog).toHaveCount(0);
  await expect(announcement).toHaveAttribute("aria-hidden", "false");
  await expect(undo).toBeVisible();
  expect(await persistentWrapper.evaluate((element) => element === document.querySelector(".nook-toast-wrap"))).toBe(true);

  const restored = page.waitForResponse((response) =>
    response.request().method() === "POST" && response.url().endsWith(`/api/applications/${application.id}/restore`),
  );
  await undo.click();
  expect((await restored).status()).toBe(201);
  await expect(page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}`, exact: true })).toBeVisible();
  await expect(undo).toBeHidden();
  await expect(announcement).toHaveAttribute("aria-hidden", "false");
  await expect(announcement).toContainText(`Restored ${application.company}`);
  expect(await persistentWrapper.evaluate((element) => element.isConnected)).toBe(true);
});

test("the toast timer pauses while hidden and recovery still works after returning", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.goto("/jobs");
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
  await expect(page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}`, exact: true })).toBeVisible();
});

test("Undo disappears at the server-provided expiry", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.goto("/jobs");
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
  await page.route(`**/api/applications/${application.id}*`, async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token: randomUUID(), expiresAt: new Date(Date.now() + 3000).toISOString() }),
    });
  });

  await deleteThroughDashboard(page, application);
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Deletion recovery" })).toHaveCount(0);
  await expect(undo).toBeHidden({ timeout: 4000 });
});

for (const bulk of [false, true]) test(`${bulk ? "bulk" : "individual"} deletion requires a new confirmation after a remote edit`, async ({ page, request }) => {
  const first = await createApplication(request);
  const second = bulk ? await createApplication(request) : null;
  const targets = second ? [first, second] : [first];
  await gotoReady(page, bulk ? "/table" : "/jobs");
  const dialog = page.getByRole("alertdialog", { name: bulk ? "Delete 2 applications?" : "Delete application?" });
  const openConfirmation = async () => {
    if (bulk) {
      for (const application of targets) await page.getByRole("checkbox", { name: `Select ${application.role} at ${application.company}`, exact: true }).check();
      await page.getByRole("group", { name: "Bulk actions" }).getByRole("button", { name: "Delete", exact: true }).click();
    } else {
      await page.getByRole("button", { name: `Open or move ${first.role} at ${first.company}`, exact: true }).click();
      await page.getByRole("dialog", { name: first.role, exact: true }).getByRole("button", { name: "Delete", exact: true }).click();
    }
    await expect(dialog).toBeVisible();
  };
  await openConfirmation();
  const current = (await (await request.get(`/api/applications/${first.id}`)).json()).application;
  const changed = await request.post(`/api/applications/${first.id}/notes`, {
    headers: sameOriginMutationHeaders, data: { revision: current.revision, text: "Saved after confirmation opened" },
  });
  expect(changed.status()).toBe(201);
  const path = bulk ? "/api/applications/bulk-delete" : `/api/applications/${first.id}`;
  let deletionRequests = 0;
  page.on("request", (outgoing) => {
    if (new URL(outgoing.url()).pathname === path && outgoing.method() === (bulk ? "POST" : "DELETE")) deletionRequests += 1;
  });
  const conflictResponse = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === (bulk ? "POST" : "DELETE"));
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  const conflict = await conflictResponse;
  expect(conflict.status()).toBe(409);
  const payload = conflict.request().postDataJSON();
  expect(bulk ? payload.applications.find((target: { id: string }) => target.id === first.id).revision : payload.revision).toBe(current.revision);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "confirm deletion again" })).toBeVisible();
  for (const application of targets) expect((await request.get(`/api/applications/${application.id}`)).status()).toBe(200);
  expect(deletionRequests).toBe(1);
  if (!bulk) await page.keyboard.press("Escape");
  await openConfirmation();
  const successfulResponse = page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === (bulk ? "POST" : "DELETE"));
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  const successful = await successfulResponse;
  expect(successful.status()).toBe(200);
  const renewed = successful.request().postDataJSON();
  expect(bulk ? renewed.applications.find((target: { id: string }) => target.id === first.id).revision : renewed.revision).toBe(current.revision + 1);
  expect(deletionRequests).toBe(2);
});
