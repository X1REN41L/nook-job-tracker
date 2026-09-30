import { expect, sameOriginMutationHeaders, test } from "./api-helpers";

test.use({ timezoneId: "UTC" });

test("updates the Analytics heading from the selected calculation range", async ({ page, request }) => {
  const created = await request.post("/api/applications", {
    headers: sameOriginMutationHeaders,
    data: { company: "March cohort", role: "Analytics months", status: "APPLIED", appliedDate: "2026-03-05", source: "", notes: "", jobUrl: "" },
  });
  expect(created.status()).toBe(201);
  await page.clock.install({ time: new Date("2026-09-26T12:00:00Z") });
  await page.goto("/dashboard/analytics");

  const heading = page.getByRole("heading", { level: 1 });
  const period = page.getByRole("combobox", { name: "Analytics period" });
  await expect(heading).toHaveText("Analytics — September 1–26");

  const threeMonths = page.waitForResponse((response) => response.url().includes("/api/dashboard/analytics?") && response.url().includes("period=LAST_3_MONTHS"));
  await period.selectOption("LAST_3_MONTHS");
  await expect(heading).toHaveText("Analytics — July + August + September 1–26");
  expect((await threeMonths).ok()).toBe(true);
  expect((await (await threeMonths).json()).range).toEqual({ startDate: "2026-07-01", endDate: "2026-09-26" });

  let releaseYearRequest!: () => void;
  const yearRequestGate = new Promise<void>((resolve) => { releaseYearRequest = resolve; });
  await page.route("**/api/dashboard/analytics?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("period") === "CURRENT_YEAR") await yearRequestGate;
    await route.continue();
  });
  await period.selectOption("YEAR");
  try {
    await expect(heading).toHaveText("Analytics — 2026");
  } finally {
    releaseYearRequest();
  }

  await period.selectOption("MONTH");
  const month = page.getByRole("combobox", { name: "Month" });
  await expect(month).toHaveValue("2026-09");
  await expect(month.locator("option").first()).toHaveText("This month");
  await month.selectOption("2026-03");
  await expect(heading).toHaveText("Analytics — March");

  await period.selectOption("YEAR");
  await expect(page.getByRole("combobox", { name: "Year" })).toHaveValue("2026");
  await expect(heading).toHaveText("Analytics — 2026");
});

test("uses the year for a complete current year", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-12-31T12:00:00Z") });
  await page.goto("/dashboard/analytics");
  const heading = page.getByRole("heading", { level: 1 });
  const period = page.getByRole("combobox", { name: "Analytics period" });

  await expect(heading).toHaveText("Analytics — December");
  await period.selectOption("YEAR");
  await expect(heading).toHaveText("Analytics — 2026");
  await period.selectOption("LAST_3_MONTHS");
  await expect(heading).toHaveText("Analytics — October + November + December");
});

test("adds the year only for Custom Month outside the current year", async ({ page, request }) => {
  const created = await request.post("/api/applications", {
    headers: sameOriginMutationHeaders,
    data: { company: "Earliest year", role: "Analytics years", status: "APPLIED", appliedDate: "2024-05-02", source: "", notes: "", jobUrl: "" },
  });
  expect(created.status()).toBe(201);
  await page.clock.install({ time: new Date("2026-09-26T12:00:00Z") });
  await page.goto("/dashboard/analytics");
  const heading = page.getByRole("heading", { level: 1 });
  const period = page.getByRole("combobox", { name: "Analytics period" });
  const month = page.getByRole("combobox", { name: "Month" });

  // Every month from the earliest application to this one, newest first; nothing later.
  await expect(month.locator("option").first()).toHaveText("This month");
  await expect(month.locator("option").nth(1)).toHaveText("August 2026");
  await expect(month.locator("option").last()).toHaveText("May 2024");
  await month.selectOption("2026-06");
  await expect(heading).toHaveText("Analytics — June");
  await month.selectOption("2025-06");
  await expect(heading).toHaveText("Analytics — June 2025");

  await period.selectOption("YEAR");
  await expect(page.getByRole("combobox", { name: "Year" }).locator("option")).toHaveText(["This year", "2025", "2024"]);
});

test("shows a broken final month after complete past months", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-03-26T12:00:00Z") });
  await page.goto("/dashboard/analytics");
  const heading = page.getByRole("heading", { level: 1 });
  await page.getByRole("combobox", { name: "Analytics period" }).selectOption("LAST_3_MONTHS");
  await expect(heading).toHaveText("Analytics — January + February + March 1–26");
});

test("includes the year at the start of a cross-year cohort", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-02-26T12:00:00Z") });
  await page.goto("/dashboard/analytics");
  const heading = page.getByRole("heading", { level: 1 });
  await page.getByRole("combobox", { name: "Analytics period" }).selectOption("LAST_3_MONTHS");
  await expect(heading).toHaveText("Analytics — December 2025 + January + February 1–26");
});
