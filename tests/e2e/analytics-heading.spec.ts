import { expect, test } from "@playwright/test";

test.use({ timezoneId: "UTC" });

test("updates the Analytics heading from the selected calculation range", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-26T12:00:00Z") });
  await page.goto("/dashboard/analytics");

  const heading = page.getByRole("heading", { level: 1 });
  const period = page.getByRole("combobox", { name: "Analytics period" });
  await expect(heading).toHaveText("Analytics - September 1-26");

  const threeMonths = page.waitForResponse((response) => response.url().includes("/api/dashboard/analytics?") && response.url().includes("period=LAST_3_MONTHS"));
  await period.selectOption("LAST_3_MONTHS");
  await expect(heading).toHaveText("Analytics - July + August + September 1-26");
  expect((await threeMonths).ok()).toBe(true);
  expect((await (await threeMonths).json()).range).toEqual({ startDate: "2026-07-01", endDate: "2026-09-26" });

  let releaseYearRequest!: () => void;
  const yearRequestGate = new Promise<void>((resolve) => { releaseYearRequest = resolve; });
  await page.route("**/api/dashboard/analytics?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("period") === "CURRENT_YEAR") await yearRequestGate;
    await route.continue();
  });
  await period.selectOption("CURRENT_YEAR");
  try {
    await expect(heading).toHaveText("Analytics - 2026");
  } finally {
    releaseYearRequest();
  }

  await period.selectOption("CUSTOM_MONTH");
  await page.getByRole("combobox", { name: "Month" }).selectOption("03");
  await expect(heading).toHaveText("Analytics - March");

  await period.selectOption("CUSTOM_YEAR");
  await expect(heading).toHaveText("Analytics - 2026");
});

test("uses the year for a complete current year", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-12-31T12:00:00Z") });
  await page.goto("/dashboard/analytics");
  const heading = page.getByRole("heading", { level: 1 });
  const period = page.getByRole("combobox", { name: "Analytics period" });

  await expect(heading).toHaveText("Analytics - December");
  await period.selectOption("CURRENT_YEAR");
  await expect(heading).toHaveText("Analytics - 2026");
  await period.selectOption("LAST_3_MONTHS");
  await expect(heading).toHaveText("Analytics - October + November + December");
});

test("adds the year only for Custom Month outside the current year", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-26T12:00:00Z") });
  await page.goto("/dashboard/analytics");
  const heading = page.getByRole("heading", { level: 1 });
  await page.getByRole("combobox", { name: "Analytics period" }).selectOption("CUSTOM_MONTH");
  await page.getByRole("combobox", { name: "Month" }).selectOption("06");
  const year = page.getByRole("textbox", { name: "Year" });

  await expect(heading).toHaveText("Analytics - June");
  await year.fill("2025");
  await expect(heading).toHaveText("Analytics - June - 2025");
  await year.fill("2027");
  await expect(heading).toHaveText("Analytics - June - 2027");
  await year.fill("2026");
  await expect(heading).toHaveText("Analytics - June");
});

test("shows a broken final month after complete past months", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-03-26T12:00:00Z") });
  await page.goto("/dashboard/analytics");
  const heading = page.getByRole("heading", { level: 1 });
  await page.getByRole("combobox", { name: "Analytics period" }).selectOption("LAST_3_MONTHS");
  await expect(heading).toHaveText("Analytics - January + February + March 1-26");
});

test("includes the year at the start of a cross-year cohort", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-02-26T12:00:00Z") });
  await page.goto("/dashboard/analytics");
  const heading = page.getByRole("heading", { level: 1 });
  await page.getByRole("combobox", { name: "Analytics period" }).selectOption("LAST_3_MONTHS");
  await expect(heading).toHaveText("Analytics - December 2025 + January + February 1-26");
});
