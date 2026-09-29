import { type APIRequestContext, type Page, type Request } from "@playwright/test";

import { expect, gotoReady, resetSettings, test, sameOriginMutationHeaders } from "./api-helpers";

type Application = { id: string; company: string; role: string; revision: number };

let recordNumber = 0;

async function createApplication(request: APIRequestContext, status: "APPLIED" | "OFFER" = "APPLIED") {
  recordNumber += 1;
  const response = await request.post("/api/applications", {
    data: { company: `Mutation ${recordNumber}`, role: `Mutation role ${recordNumber}`, status, appliedDate: "2026-09-22" },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).application as Application;
}

async function archiveThroughApi(request: APIRequestContext, application: Application) {
  const response = await request.patch(`/api/applications/${application.id}`, {
    data: { revision: application.revision, archived: true },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(200);
  return (await response.json()).application as Application;
}

async function readApplication(request: APIRequestContext, id: string) {
  const response = await request.get("/api/applications");
  expect(response.ok()).toBe(true);
  const { applications } = await response.json() as { applications: (Application & { archived: boolean })[] };
  return applications.find((application) => application.id === id);
}

async function openJobBoard(page: Page) {
  await gotoReady(page, "/jobs");
}

function boardCard(page: Page, application: Application) {
  return page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}`, exact: true });
}

function isPatchFor(request: Request, application: Application) {
  return request.method() === "PATCH" && new URL(request.url()).pathname === `/api/applications/${application.id}`;
}

// Holds every PATCH for one application until release() so a second action lands while it is in flight.
async function holdPatches(page: Page, application: Application) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const held: Request[] = [];
  await page.route(`**/api/applications/${application.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    held.push(route.request());
    await gate;
    await route.continue();
  });
  return { release, held };
}

function patchesFor(page: Page, application: Application) {
  const sent: Request[] = [];
  page.on("request", (request) => { if (isPatchFor(request, application)) sent.push(request); });
  return sent;
}

// Records every request to one dashboard endpoint, and which of them were aborted or failed.
function recordRequests(page: Page, pathname: string) {
  const started: Request[] = [];
  const failed: Request[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === pathname) started.push(request); });
  page.on("requestfailed", (request) => { if (new URL(request.url()).pathname === pathname) failed.push(request); });
  return { started, failed };
}

// A dismissed toast keeps its last text in the hidden wrapper, so match only the shown one.
const toast = (page: Page) => page.locator(".nook-toast-wrap.nook-toast-show");
const undoButton = (page: Page) => toast(page).getByRole("button", { name: "Undo", exact: true });

test("REACT-005: one Archive in the full Needs Attention list refetches the stale list exactly once", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.clock.setFixedTime(new Date(Date.now() + 20 * 24 * 60 * 60 * 1000));
  const initialLoad = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dashboard/stale");
  await page.goto("/dashboard?attention=all");
  await initialLoad;
  const row = page.getByRole("listitem").filter({ hasText: application.company });
  await expect(row).toBeVisible();

  const stale = recordRequests(page, "/api/dashboard/stale");
  const archived = page.waitForResponse((response) => isPatchFor(response.request(), application));
  const refetched = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dashboard/stale");
  await row.hover();
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  expect((await (await archived).json()).application.archived).toBe(true);
  await refetched;
  await expect(row).toHaveCount(0);
  await page.waitForTimeout(1_000);

  expect(stale.started).toHaveLength(1);
  expect(stale.failed).toHaveLength(0);
});

test("REACT-005: a failed Archive in the full Needs Attention list rolls back without refetching", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.clock.setFixedTime(new Date(Date.now() + 20 * 24 * 60 * 60 * 1000));
  const initialLoad = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/dashboard/stale");
  await page.goto("/dashboard?attention=all");
  await initialLoad;
  const row = page.getByRole("listitem").filter({ hasText: application.company });
  await expect(row).toBeVisible();

  await page.route(`**/api/applications/${application.id}`, (route) => route.request().method() === "PATCH"
    ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Archive failed on the server" }) })
    : route.fallback());
  const stale = recordRequests(page, "/api/dashboard/stale");
  await row.hover();
  await row.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Archive failed on the server" })).toBeVisible();
  await expect(row).toBeVisible();
  await page.waitForTimeout(1_000);

  expect(stale.started).toHaveLength(0);
});

test("REACT-004: Alt+A on one card is not dropped while another card's move is in flight", async ({ page, request }) => {
  const first = await createApplication(request);
  const second = await createApplication(request, "OFFER");
  await openJobBoard(page);
  const hold = await holdPatches(page, first);
  const secondPatches = patchesFor(page, second);

  await boardCard(page, first).focus();
  await page.keyboard.press("Alt+a");
  await expect.poll(() => hold.held.length).toBe(1);
  await expect(boardCard(page, first)).toHaveCount(0);

  await boardCard(page, second).focus();
  await page.keyboard.press("Alt+a");
  await expect.poll(() => secondPatches.length).toBe(1);
  await expect(boardCard(page, second)).toHaveCount(0);

  hold.release();
  await expect(toast(page)).toContainText(/Archived Mutation \d+/);
  await expect.poll(async () => (await readApplication(request, first.id))?.archived).toBe(true);
  await expect.poll(async () => (await readApplication(request, second.id))?.archived).toBe(true);
  expect(hold.held).toHaveLength(1);
});

test("REACT-004: Undo runs while a different application's move is in flight", async ({ page, request }) => {
  const undone = await createApplication(request);
  const busy = await createApplication(request, "OFFER");
  await openJobBoard(page);

  const archived = page.waitForResponse((response) => isPatchFor(response.request(), undone));
  await boardCard(page, undone).focus();
  await page.keyboard.press("Alt+a");
  await archived;
  await expect(toast(page)).toContainText(`Archived ${undone.company}`);

  const hold = await holdPatches(page, busy);
  await boardCard(page, busy).focus();
  await page.keyboard.press("Alt+a");
  await expect.poll(() => hold.held.length).toBe(1);

  const restored = page.waitForResponse((response) => isPatchFor(response.request(), undone));
  await undoButton(page).click();
  expect((await (await restored).json()).application.archived).toBe(false);
  await expect(boardCard(page, undone)).toBeVisible();

  hold.release();
  await expect.poll(async () => (await readApplication(request, busy.id))?.archived).toBe(true);
  expect((await readApplication(request, undone.id))?.archived).toBe(false);
});

test("REACT-004: Undo for an application whose own move is in flight is re-offered, not consumed", async ({ page, request }) => {
  await resetSettings(request, { archivedExpanded: true });
  const application = await createApplication(request);
  await openJobBoard(page);

  const archived = page.waitForResponse((response) => isPatchFor(response.request(), application));
  await boardCard(page, application).focus();
  await page.keyboard.press("Alt+a");
  await archived;
  await expect(toast(page)).toContainText(`Archived ${application.company}`);

  const hold = await holdPatches(page, application);
  await page.locator(`[data-application-id="${application.id}"]`).getByRole("button", { name: "Restore", exact: true }).click();
  await expect.poll(() => hold.held.length).toBe(1);

  await undoButton(page).click();
  await expect(toast(page)).toContainText(`${application.company} is still being updated`);
  await expect(undoButton(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(hold.held).toHaveLength(1);

  hold.release();
  await expect(toast(page)).toContainText(`Restored ${application.company}`);
  await expect(boardCard(page, application)).toBeVisible();
  expect((await readApplication(request, application.id))?.archived).toBe(false);
});

test("REACT-004: a conflict inside Undo re-offers the toast, and the next Undo applies", async ({ page, request }) => {
  const application = await createApplication(request);
  await openJobBoard(page);

  const archived = page.waitForResponse((response) => isPatchFor(response.request(), application));
  await boardCard(page, application).focus();
  await page.keyboard.press("Alt+a");
  const archivedApplication = (await (await archived).json()).application as Application;
  await expect(toast(page)).toContainText(`Archived ${application.company}`);

  // A write from elsewhere bumps the revision, so the Undo PATCH conflicts.
  await archiveThroughApi(request, archivedApplication);

  const conflicted = page.waitForResponse((response) => isPatchFor(response.request(), application));
  await undoButton(page).click();
  expect((await conflicted).status()).toBe(409);
  await expect(toast(page)).toContainText("changed elsewhere");
  await expect(undoButton(page)).toBeVisible();
  await expect(boardCard(page, application)).toHaveCount(0);

  const restored = page.waitForResponse((response) => isPatchFor(response.request(), application));
  await undoButton(page).click();
  expect((await restored).status()).toBe(200);
  await expect(boardCard(page, application)).toBeVisible();
  expect((await readApplication(request, application.id))?.archived).toBe(false);
});
