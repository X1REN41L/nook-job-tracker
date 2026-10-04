import { PrismaClient } from "@prisma/client";
import { type APIRequestContext, type Page } from "@playwright/test";

import { expect, gotoReady, openDetailsEditor, sameOriginMutationHeaders, test } from "./api-helpers";

type Application = { id: string; company: string; role: string; revision: number };

const prisma = new PrismaClient();
test.afterAll(async () => { await prisma.$disconnect(); });

let recordNumber = 0;

async function createApplication(request: APIRequestContext, extra: Record<string, string> = {}) {
  recordNumber += 1;
  const response = await request.post("/api/applications", {
    data: { company: `Load ${recordNumber}`, role: `Load role ${recordNumber}`, status: "APPLIED", appliedDate: "2026-09-22", ...extra },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).application as Application;
}

const serverError = { status: 500, contentType: "application/json", body: JSON.stringify({ error: "Something went wrong" }) };
const isPath = (url: string, pathname: string) => new URL(url).pathname === pathname;

/** Renames a table in the isolated database so server renders that read it fail until the returned restore runs. */
async function hideTable(table: string) {
  await prisma.$executeRawUnsafe(`ALTER TABLE "${table}" RENAME TO "${table}_hidden"`);
  let restored = false;
  return async () => {
    if (restored) return;
    restored = true;
    await prisma.$executeRawUnsafe(`ALTER TABLE "${table}_hidden" RENAME TO "${table}"`);
  };
}

async function openPanel(page: Page, application: Application) {
  await page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}`, exact: true }).click();
  const panel = page.getByRole("dialog", { name: application.role, exact: true });
  await expect(panel).toBeVisible();
  return panel;
}

test("Overview offers Retry after a failed first load; Retry is disabled while it runs and clears the error", async ({ page }) => {
  let fail = true;
  let releaseRetry!: () => void;
  const retryGate = new Promise<void>((resolve) => { releaseRetry = resolve; });
  await page.route("**/api/dashboard/overview?**", async (route) => {
    if (fail) return route.fulfill(serverError);
    await retryGate;
    await route.continue();
  });
  await gotoReady(page, "/dashboard");
  const notice = page.getByRole("alert").filter({ hasText: "Overview could not be loaded." });
  await expect(notice).toBeVisible();
  await expect(page.getByText("Preview unavailable.").first()).toBeVisible();

  fail = false;
  const retried = page.waitForResponse((response) => isPath(response.url(), "/api/dashboard/overview"));
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(notice.getByRole("button", { name: "Retrying…", exact: true })).toBeDisabled();
  releaseRetry();
  expect((await retried).ok()).toBe(true);
  await expect(notice).toHaveCount(0);
  await expect(page.getByText("Preview unavailable.")).toHaveCount(0);
});

test("a failed Overview refresh keeps the last data, marked as not refreshed, until Retry succeeds", async ({ page, request }) => {
  const kept = await createApplication(request);
  const archived = await createApplication(request);
  await page.clock.setFixedTime(new Date(Date.now() + 20 * 24 * 60 * 60 * 1000));
  const initialLoad = page.waitForResponse((response) => isPath(response.url(), "/api/dashboard/overview"));
  await gotoReady(page, "/dashboard");
  expect((await initialLoad).ok()).toBe(true);
  const keptRow = page.getByRole("listitem").filter({ hasText: kept.company });
  const archivedRow = page.getByRole("listitem").filter({ hasText: archived.company });
  await expect(keptRow).toBeVisible();
  await expect(archivedRow).toBeVisible();

  let fail = true;
  await page.route("**/api/dashboard/overview?**", (route) => fail ? route.fulfill(serverError) : route.continue());
  const failedRefresh = page.waitForResponse((response) => isPath(response.url(), "/api/dashboard/overview"));
  await archivedRow.hover();
  await archivedRow.getByRole("button", { name: "Archive", exact: true }).click();
  expect((await failedRefresh).status()).toBe(500);
  const notice = page.getByRole("alert").filter({ hasText: "Overview could not be refreshed. It shows the last figures loaded." });
  await expect(notice).toBeVisible();
  await expect(keptRow).toBeVisible();
  await expect(page.getByText("Preview unavailable.")).toHaveCount(0);

  fail = false;
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(archivedRow).toHaveCount(0);
  await expect(keptRow).toBeVisible();
});

test("Analytics never shows another period's figures as current, and Retry loads the selected period", async ({ page }) => {
  let failMonth = true;
  await page.route("**/api/dashboard/analytics?**", (route) =>
    failMonth && new URL(route.request().url()).searchParams.get("period") === "CURRENT_MONTH" ? route.fulfill(serverError) : route.continue());
  await gotoReady(page, "/dashboard/analytics");
  const notice = page.getByRole("alert").filter({ hasText: "Analytics could not be loaded for this period." });
  await expect(notice).toBeVisible();

  const period = page.getByRole("combobox", { name: "Analytics period" });
  const threeMonths = page.waitForResponse((response) => response.url().includes("period=LAST_3_MONTHS"));
  await period.selectOption("LAST_3_MONTHS");
  expect((await threeMonths).ok()).toBe(true);
  await expect(page.getByRole("alert").filter({ hasText: "Analytics could not" })).toHaveCount(0);

  // The three-month figures loaded, but the month view must report its own failure rather than show them.
  await period.selectOption("MONTH");
  await expect(notice).toBeVisible();
  await expect(page.getByRole("heading", { name: "Applications trend" })).toBeVisible();

  failMonth = false;
  const retried = page.waitForResponse((response) => response.url().includes("period=CURRENT_MONTH"));
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  expect((await retried).ok()).toBe(true);
  await expect(page.getByRole("alert").filter({ hasText: "Analytics could not" })).toHaveCount(0);
});

test("the details panel reports a failed load of contacts and timeline, and Try again loads them", async ({ page, request }) => {
  const application = await createApplication(request);
  const contact = await request.post(`/api/applications/${application.id}/contacts`, {
    data: { revision: application.revision, name: "Dana Contact" },
    headers: sameOriginMutationHeaders,
  });
  expect(contact.status()).toBe(201);

  let fail = true;
  await page.route(`**/api/applications/${application.id}`, (route) =>
    fail && route.request().method() === "GET" ? route.fulfill(serverError) : route.fallback());
  await gotoReady(page, "/jobs");
  const panel = await openPanel(page, application);
  await expect(panel.getByText("The contacts could not be loaded.")).toBeVisible();
  await expect(panel.getByText("The timeline could not be loaded.")).toBeVisible();
  await expect(panel.getByText("Dana Contact")).toHaveCount(0);

  fail = false;
  await panel.getByRole("button", { name: "Try again", exact: true }).first().click();
  await expect(panel.getByText("Dana Contact")).toBeVisible();
  await expect(panel.getByText(/could not be loaded/)).toHaveCount(0);
});

test("pages leave out application notes and contacts, and saving details keeps the notes", async ({ page, request }) => {
  const notes = `Summary-only note ${Date.now()}`;
  const application = await createApplication(request, { notes });
  const contact = await request.post(`/api/applications/${application.id}/contacts`, {
    data: { revision: application.revision, name: "Hidden Contact Person" },
    headers: sameOriginMutationHeaders,
  });
  expect(contact.status()).toBe(201);

  const document = page.waitForResponse((response) => isPath(response.url(), "/jobs") && response.request().resourceType() === "document");
  await gotoReady(page, "/jobs");
  const html = await (await document).text();
  expect(html).toContain(application.company);
  expect(html).not.toContain(notes);
  expect(html).not.toContain("Hidden Contact Person");

  const panel = await openPanel(page, application);
  await expect(panel.getByText("Hidden Contact Person")).toBeVisible();
  const form = await openDetailsEditor(page);
  await form.getByLabel("Role", { exact: true }).fill(`${application.role} edited`);
  const saved = page.waitForResponse((response) => response.request().method() === "PUT" && isPath(response.url(), `/api/applications/${application.id}`));
  await form.getByRole("button", { name: "Save details", exact: true }).click();
  const body = await (await saved).json();
  expect(body.application.notes).toBe(notes);
  expect(body.application.role).toBe(`${application.role} edited`);
  // The panel is named by its role, so it is found again under the new one.
  await expect(panel).toHaveCount(0);
  const renamed = page.getByRole("dialog", { name: `${application.role} edited`, exact: true });
  await expect(renamed.getByText("Hidden Contact Person")).toBeVisible();
});

test("a page that cannot read the database shows the page error, and Try again recovers", async ({ page, request }) => {
  // With no applications Prisma never reads interviews, so one application makes the page need the hidden table.
  const application = await createApplication(request);
  await gotoReady(page, "/dashboard");
  const restore = await hideTable("Interview");
  try {
    // The root layout has already streamed with a 200 status by the time the page fails.
    await page.goto("/jobs");
    const error = page.getByRole("alert").filter({ hasText: "This page could not be loaded" });
    await expect(error).toBeVisible();
    await expect(error).not.toContainText(/prisma|sqlite|Interview/i);
    await restore();
    await error.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Job Board", level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}`, exact: true })).toBeVisible();
  } finally {
    await restore();
  }
});

test("a root layout that cannot read settings shows the global error, and Try again recovers", async ({ page }) => {
  await gotoReady(page, "/dashboard");
  const restore = await hideTable("Settings");
  try {
    const response = await page.goto("/dashboard");
    expect(response?.status()).toBe(500);
    const error = page.getByRole("alert").filter({ hasText: "Nook could not be loaded" });
    await expect(error).toBeVisible();
    await expect(error).not.toContainText(/prisma|sqlite|Settings/i);
    await restore();
    await error.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Overview", level: 1 })).toBeVisible();
  } finally {
    await restore();
  }
});
