import { type APIRequestContext } from "@playwright/test";


import { deleteApplication, expect, resetSettings, test, sameOriginMutationHeaders } from "./api-helpers";

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
  await resetSettings(request, { startupPage: "table" });
  await page.goto("/");
  await expect(page).toHaveURL(/\/table$/, { timeout: 30_000 });
  expect(settingsRequests).toBe(0);
});

test("the inline initializer applies light, dark, and system themes before hydration", async ({ page, request }) => {
  await page.route("**/_next/**/*.js*", (route) => route.abort());
  for (const [theme, colorScheme, expectedDark] of [
    ["light", "dark", false],
    ["dark", "light", true],
    ["system", "dark", true],
    ["system", "light", false],
  ] as const) {
    await resetSettings(request, { theme });
    await page.emulateMedia({ colorScheme });
    const response = await page.goto("/dashboard");
    expect(response?.headers()["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(await page.locator("html").evaluate((element) => element.classList.contains("dark"))).toBe(expectedDark);
    expect(await page.locator("html").getAttribute("data-shortcuts-ready")).toBeNull();
  }
});

test.beforeEach(async () => {
  applicationId = null;
});

test.afterEach(async ({ request }) => {
  if (applicationId) await deleteApplication(request, applicationId);
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
  const jobBoardCard = page.getByRole("button", {
    name: "Open or move Shared sidebar role at Route navigation fixture",
  });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });

  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Needs attention" })).toBeVisible();

  await navigation.getByRole("link", { name: "Job Board" }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(navigation.getByRole("link", { name: "Job Board" })).toHaveAttribute("aria-current", "page");
  await expect(jobBoardCard).toBeVisible();

  await navigation.getByRole("link", { name: "Interviews" }).click();
  await expect(page).toHaveURL(/\/interviews$/);
  await expect(page.getByRole("heading", { name: "Upcoming interviews (0)" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Interviews" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("searchbox", { name: "Search company or role" })).toBeVisible();

  await page.goto("/interviews");
  await expect(page.getByRole("heading", { name: "Upcoming interviews (0)" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Interviews" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("searchbox", { name: "Search company or role" })).toBeVisible();

  await page.goto("/jobs");
  await expect(navigation.getByRole("link", { name: "Job Board" })).toHaveAttribute("aria-current", "page");
  await expect(jobBoardCard).toBeVisible();
});
