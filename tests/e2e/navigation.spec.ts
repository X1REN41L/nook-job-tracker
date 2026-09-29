import { type APIRequestContext } from "@playwright/test";


import { expect, resetSettings, test, sameOriginMutationHeaders } from "./api-helpers";

let applicationId: string | null = null;

test("root redirects to the configured startup page", async ({ page, request }) => {
  test.setTimeout(90_000);
  let settingsRequests = 0;
  page.on("request", (request) => { if (request.url().endsWith("/api/settings")) settingsRequests++; });
  await resetSettings(request, { startupPage: "job-board" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/jobs$/, { timeout: 30_000 });
  await resetSettings(request, { startupPage: "interviews" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/interviews$/, { timeout: 30_000 });
  expect(settingsRequests).toBe(0);
});

test.beforeEach(async () => {
  applicationId = null;
});

test.afterEach(async ({ request }) => {
  if (applicationId) await request.delete(`/api/applications/${applicationId}`, { headers: sameOriginMutationHeaders });
});

async function createApplication(request: APIRequestContext) {
  const response = await request.post("/api/applications", {
    data: {
      company: "Route navigation fixture",
      role: "Shared sidebar role",
      status: "APPLIED",
      appliedDate: "2026-09-22",
      source: "Playwright",
      notes: "Temporary navigation test record",
      jobUrl: "https://example.com/navigation-test",
    },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  applicationId = body.application.id as string;
}

test("loads and navigates among the shared Job Board, Dashboard, and Interviews shell", async ({ page, request }) => {
  await createApplication(request);
  const jobBoardSidebarApplication = page.getByRole("button", {
    name: "Open Shared sidebar role at Route navigation fixture",
  });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Needs Attention" })).toBeVisible();

  await navigation.getByRole("link", { name: "Job Board" }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(navigation.getByRole("link", { name: "Job Board" })).toHaveAttribute("aria-current", "page");
  await expect(jobBoardSidebarApplication).toBeVisible();
  await expect(page.getByRole("button", {
    name: "Open or move Shared sidebar role at Route navigation fixture",
  })).toBeVisible();

  await navigation.getByRole("link", { name: "Interviews" }).click();
  await expect(page).toHaveURL(/\/interviews$/);
  await expect(page.getByRole("heading", { name: "Upcoming Interviews (0)" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Interviews" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("searchbox", { name: "Search by company or role" })).toBeVisible();

  await page.goto("/interviews");
  await expect(page.getByRole("heading", { name: "Upcoming Interviews (0)" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Interviews" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("searchbox", { name: "Search by company or role" })).toBeVisible();

  await page.goto("/jobs");
  await expect(navigation.getByRole("link", { name: "Job Board" })).toHaveAttribute("aria-current", "page");
  await expect(jobBoardSidebarApplication).toBeVisible();
});
