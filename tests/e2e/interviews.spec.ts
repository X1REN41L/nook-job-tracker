import { expect, type APIRequestContext, type Page, test } from "@playwright/test";

import { sameOriginMutationHeaders } from "./api-helpers";

let applicationIds: string[] = [];
let fixtureIndex = 0;

async function localDate(page: Page, offset = 0) {
  return page.evaluate((days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, offset);
}

async function createInterview(request: APIRequestContext, input: {
  company: string;
  role: string;
  date: string;
  note?: string;
}) {
  fixtureIndex += 1;
  const response = await request.post("/api/applications", {
    data: {
      company: input.company,
      role: input.role,
      status: "INTERVIEW",
      appliedDate: "2026-09-01",
      interviewDate: input.date,
      notes: input.note,
      source: `Interviews page test ${fixtureIndex}`,
    },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  const body = await response.json();
  applicationIds.push(body.application.id as string);
}

test.beforeEach(async ({ page }) => {
  applicationIds = [];
  fixtureIndex = 0;
  await page.addInitScript(() => {
    localStorage.removeItem("nook-sidebar-collapsed");
  });
});

test.afterEach(async ({ request }) => {
  await Promise.all(applicationIds.map((id) =>
    request.delete(`/api/applications/${id}`, { headers: sameOriginMutationHeaders })
  ));
});

test("shows dated interview details in date order and groups them by day", async ({ page, request }) => {
  const today = await localDate(page);
  const tomorrow = await localDate(page, 1);
  const later = await localDate(page, 4);
  const yesterday = await localDate(page, -1);
  await createInterview(request, {
    company: "Acme Corp",
    role: "Senior Product Designer",
    date: today,
    note: "Bring the checkout redesign case study — they asked to see it again.",
  });
  await createInterview(request, {
    company: "Fieldstone Labs",
    role: "Frontend Engineer",
    date: tomorrow,
    note: "Live coding round — expect array and string prompts.",
  });
  await createInterview(request, {
    company: "Northstar",
    role: "Product Manager",
    date: later,
  });
  await createInterview(request, {
    company: "Old Acme",
    role: "UX Researcher",
    date: yesterday,
    note: "Bring the research case study.",
  });

  await page.goto("/interviews");

  await expect(page.getByRole("heading", { name: "3 Upcoming Interview", exact: true })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: "Interviews", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("upcoming-interview-count")).toHaveText("3");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tomorrow", exact: true })).toBeVisible();

  const rows = page.getByRole("tabpanel").locator("article");
  await expect(rows).toHaveCount(3);
  const rowText = await rows.allTextContents();
  expect(rowText[0]).toContain("Senior Product Designer");
  expect(rowText[0]).toContain("Acme Corp");
  expect(rowText[0]).toContain("Bring the checkout redesign case study — they asked to see it again.");
  expect(rowText[1]).toContain("Frontend Engineer");
  expect(rowText[1]).toContain("Fieldstone Labs");
  expect(rowText[2]).toContain("Product Manager");
  expect(rowText[0]).not.toMatch(/\b(?:https?:|join|interviewer|minutes)\b/i);
  await expect(rows.nth(0).locator("time")).toHaveAttribute("datetime", today);
  await expect(rows.nth(1).locator("time")).toHaveAttribute("datetime", tomorrow);
  await expect(rows.nth(2).locator("time")).toHaveAttribute("datetime", later);

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileColumnCount = await rows.nth(0).evaluate((row) =>
    getComputedStyle(row).gridTemplateColumns.split(" ").length
  );
  expect(mobileColumnCount).toBe(1);
});

test("searches by role and company within the selected tab and supports keyboard tabs", async ({ page, request }) => {
  const today = await localDate(page);
  const tomorrow = await localDate(page, 1);
  const yesterday = await localDate(page, -1);
  await createInterview(request, { company: "Fieldstone Labs", role: "Frontend Engineer", date: tomorrow });
  await createInterview(request, { company: "Acme Corp", role: "Product Designer", date: today });
  await createInterview(request, { company: "Acme Legacy", role: "Research Lead", date: yesterday });

  await page.goto("/interviews");
  const search = page.getByRole("searchbox", { name: "Search by company or role" });
  await search.fill("  front  ");
  await expect(page.getByRole("heading", { name: /Frontend Engineer.*Fieldstone Labs/ })).toBeVisible();
  await search.fill("ACME");
  await expect(page.getByRole("heading", { name: /Product Designer.*Acme Corp/ })).toBeVisible();
  await expect(page.getByRole("tabpanel").locator("article")).toHaveCount(1);

  const upcomingTab = page.getByRole("tab", { name: "Upcoming" });
  await upcomingTab.focus();
  await page.keyboard.press("ArrowRight");
  const pastTab = page.getByRole("tab", { name: "Past" });
  await expect(pastTab).toBeFocused();
  await expect(pastTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /Research Lead.*Acme Legacy/ })).toBeVisible();

  await search.fill("missing role");
  await expect(page.getByText("No interviews match your search.", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(page.getByText("No past interviews.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tabpanel").locator("article")).toHaveCount(1);
});

test("shows the specified empty states without an interview creation action", async ({ page }) => {
  await page.goto("/interviews");

  await expect(page.getByRole("heading", { name: "0 Upcoming Interview", exact: true })).toBeVisible();
  await expect(page.getByText("All caught up — no interviews on the horizon.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add interview$/i })).toHaveCount(0);

  await page.getByRole("tab", { name: "Past" }).click();
  await expect(page.getByText("No past interviews.", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "Upcoming" }).click();
  await page.getByRole("searchbox", { name: "Search by company or role" }).fill("acme");
  await expect(page.getByText("No interviews match your search.", { exact: true })).toBeVisible();
});
