import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

import { sameOriginMutationHeaders } from "./api-helpers";

type ApplicationFixture = {
  company: string;
  role: string;
  status?: "APPLIED" | "INTERVIEW" | "OFFER";
  appliedDate: string;
  interviewDate?: string;
  archived?: boolean;
};

const applicationIds: string[] = [];

test.beforeEach(async ({ page }) => {
  applicationIds.length = 0;
  await page.addInitScript(() => {
    localStorage.removeItem("nook-sidebar-collapsed");
    localStorage.removeItem("nook-archived-expanded");
  });
});

test.afterEach(async ({ request }) => {
  await Promise.all(applicationIds.map((id) => request.delete(`/api/applications/${id}`, { headers: sameOriginMutationHeaders })));
});

async function createApplication(request: APIRequestContext, fixture: ApplicationFixture) {
  const response = await request.post("/api/applications", {
    data: {
      company: fixture.company,
      role: fixture.role,
      status: fixture.status ?? "APPLIED",
      appliedDate: fixture.appliedDate,
      interviewDate: fixture.interviewDate ?? "",
      source: "Playwright sidebar context",
    },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  const { application } = await response.json();
  applicationIds.push(application.id as string);

  if (fixture.archived) {
    const archiveResponse = await request.patch(`/api/applications/${application.id}`, {
      data: { revision: application.revision, archived: true },
      headers: sameOriginMutationHeaders,
    });
    expect(archiveResponse.status()).toBe(200);
  }

  return application as { id: string };
}

async function localDate(page: Page) {
  return page.evaluate(() => {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${date.getFullYear()}-${month}-${day}`;
  });
}

function shiftDate(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test("keeps Job Board browsing on its route and shows recent unarchived applications on expanded Dashboard", async ({ page, request }) => {
  await page.goto("/dashboard");
  const today = await localDate(page);
  const newest = await createApplication(request, {
    company: "Recent North",
    role: "Newest role",
    appliedDate: shiftDate(today, -1),
  });
  const oldest = await createApplication(request, {
    company: "Recent South",
    role: "Older role",
    status: "OFFER",
    appliedDate: shiftDate(today, -3),
  });
  const archived = await createApplication(request, {
    company: "Archived West",
    role: "Archived role",
    appliedDate: today,
    archived: true,
  });
  await page.reload();

  await expect(page.getByRole("heading", { name: "Recent applications", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search company or role" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Archived\s+\d+$/ })).toHaveCount(0);
  const recentRows = page.locator('.sidebar-content button[data-application-id]');
  await expect(recentRows).toHaveCount(2);
  expect(await recentRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-application-id")))).toEqual([newest.id, oldest.id]);
  await expect(page.locator(`[data-application-id="${archived.id}"]`)).toHaveCount(0);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("heading", { name: "Recent applications", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("heading", { name: "Recent applications", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Job Board", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All applications", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Search company or role" })).toBeVisible();
  await expect(page.getByText("3 applications total", { exact: true })).toBeVisible();

  const offerFilter = page.getByRole("button", { name: "Offer", exact: true });
  await offerFilter.click();
  await expect(page.getByRole("button", { name: "Edit or archive Older role at Recent South" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit or archive Newest role at Recent North" })).toHaveCount(0);

  const search = page.getByRole("textbox", { name: "Search company or role" });
  await search.fill("No matching company");
  await expect(page.getByText("No applications match your search.", { exact: true })).toBeVisible();
  await search.fill("");
  await page.getByRole("button", { name: "All", exact: true }).click();

  const archiveToggle = page.getByRole("button", { name: "Archived 1", exact: true });
  await archiveToggle.click();
  await expect(page.getByRole("button", { name: "Edit or move archived Archived role at Archived West" })).toBeVisible();
  await archiveToggle.click();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();

  const collapsedArchive = page.getByRole("button", { name: "Open Archive, 1 archived" });
  await expect(collapsedArchive).toBeVisible();
  await collapsedArchive.click();
  await expect(page.getByRole("button", { name: "Archived 1", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Edit or move archived Archived role at Archived West" })).toBeVisible();
});

test("counts only unarchived, dated Interview applications due today or later and hides other route context", async ({ page, request }) => {
  await page.goto("/interviews");
  const today = await localDate(page);
  await createApplication(request, {
    company: "Today Interview Co",
    role: "Today interview",
    status: "INTERVIEW",
    appliedDate: shiftDate(today, -5),
    interviewDate: today,
  });
  await createApplication(request, {
    company: "Future Interview Co",
    role: "Future interview",
    status: "INTERVIEW",
    appliedDate: shiftDate(today, -4),
    interviewDate: shiftDate(today, 4),
  });
  await createApplication(request, {
    company: "Past Interview Co",
    role: "Past interview",
    status: "INTERVIEW",
    appliedDate: shiftDate(today, -6),
    interviewDate: shiftDate(today, -1),
  });
  await createApplication(request, {
    company: "Applied Co",
    role: "Future but not interview",
    appliedDate: shiftDate(today, -2),
    interviewDate: shiftDate(today, 2),
  });
  await createApplication(request, {
    company: "Archived Interview Co",
    role: "Archived future interview",
    status: "INTERVIEW",
    appliedDate: shiftDate(today, -3),
    interviewDate: shiftDate(today, 1),
    archived: true,
  });
  await createApplication(request, {
    company: "Undated Interview Co",
    role: "Undated interview",
    status: "INTERVIEW",
    appliedDate: shiftDate(today, -2),
  });
  await page.reload();

  await expect(page.getByTestId("upcoming-interview-count")).toHaveText("2");
  await expect(page.getByRole("heading", { name: "All applications", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent applications", exact: true })).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search by company or role" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Archived\s+\d+$/ })).toHaveCount(0);
});

test("shows empty application and archive states and a zero interview count", async ({ page }) => {
  await page.goto("/interviews");
  await expect(page.getByTestId("upcoming-interview-count")).toHaveText("0");
  await expect(page.getByRole("heading", { name: "All applications", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent applications", exact: true })).toHaveCount(0);

  await page.goto("/dashboard");
  await expect(page.getByText("No recent applications yet.", { exact: true })).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("No applications yet. Add your first job to see it here.", { exact: true })).toBeVisible();
  await expect(page.getByText("0 applications total", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Archived 0", exact: true }).click();
  await expect(page.getByText("No archived applications.", { exact: true })).toBeVisible();
});
