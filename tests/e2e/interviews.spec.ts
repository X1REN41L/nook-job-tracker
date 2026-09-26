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
  status?: "APPLIED" | "ONLINE_ASSESSMENT" | "INTERVIEW" | "OFFER" | "REJECTED";
  archived?: boolean;
}) {
  fixtureIndex += 1;
  const response = await request.post("/api/applications", {
    data: {
      company: input.company,
      role: input.role,
      status: input.status ?? "INTERVIEW",
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
  if (input.archived) {
    const archived = await request.patch(`/api/applications/${body.application.id}`, {
      data: { revision: body.application.revision, archived: true },
      headers: sameOriginMutationHeaders,
    });
    expect(archived.status()).toBe(200);
  }
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

  await expect(page.getByRole("heading", { name: "Upcoming Interviews (3)" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tabpanel")).not.toHaveAttribute("tabindex", "0");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link", { name: "Interviews", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("upcoming-interview-count")).toHaveText("3");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tomorrow", exact: true })).toBeVisible();

  const rows = page.getByRole("region", { name: "Upcoming Interviews (3)" }).locator("article");
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
  await expect(page.getByRole("heading", { name: /UX Researcher.*Old Acme/ })).toHaveCount(0);

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
  await expect(page.getByRole("heading", { name: /Research Lead.*Acme Legacy/ })).toHaveCount(0);

  const upcomingTab = page.getByRole("tab", { name: "Upcoming" });
  await upcomingTab.focus();
  await page.keyboard.press("Tab");
  const pastTab = page.getByRole("tab", { name: "Past" });
  await expect(pastTab).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(pastTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: /Research Lead.*Acme Legacy/ })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(upcomingTab).toBeFocused();
  await expect(upcomingTab).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowRight");
  await expect(pastTab).toBeFocused();
  await expect(pastTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).not.toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();

  await search.fill("missing role");
  await expect(page.getByText("No interviews match your search.", { exact: true })).toBeVisible();
  await search.fill("");
  await expect(page.getByText("No past interviews.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tabpanel").locator("article")).toHaveCount(1);
});

test("shows the specified empty states without an interview creation action", async ({ page }) => {
  await page.goto("/interviews");

  await expect(page.getByRole("heading", { name: "Upcoming Interviews (0)" })).toBeVisible();
  await expect(page.getByText("All caught up — no interviews on the horizon.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add interview$/i })).toHaveCount(0);

  await page.getByRole("tab", { name: "Past" }).click();
  await expect(page.getByText("No past interviews.", { exact: true })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search by company or role" }).fill("acme");
  await expect(page.getByText("No interviews match your search.", { exact: true })).toBeVisible();
});

test("includes dated applications from every stage and archive, groups upcoming dates, and sorts past both ways", async ({ page, request }) => {
  const today = await localDate(page);
  const tomorrow = await localDate(page, 1);
  const weekEnd = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + (6 - date.getDay()));
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  const thisWeek = weekEnd > tomorrow ? await localDate(page, 2) : null;
  const later = await localDate(page, 8);
  const yesterday = await localDate(page, -1);
  const older = await localDate(page, -8);
  await createInterview(request, { company: "Today Applied", role: "Today role", date: today, status: "APPLIED" });
  await createInterview(request, { company: "Tomorrow Assessment", role: "Tomorrow role", date: tomorrow, status: "ONLINE_ASSESSMENT" });
  if (thisWeek) await createInterview(request, { company: "Week Offer", role: "Week role", date: thisWeek, status: "OFFER" });
  await createInterview(request, { company: "Later Archived", role: "Later role", date: later, archived: true, status: "REJECTED" });
  await createInterview(request, { company: "Recent Archived", role: "Recent role", date: yesterday, archived: true, status: "APPLIED" });
  await createInterview(request, { company: "Older Assessment", role: "Older role", date: older, status: "ONLINE_ASSESSMENT" });

  await page.goto("/interviews");
  const upcoming = page.getByRole("region", { name: new RegExp(`Upcoming Interviews \\(${thisWeek ? 4 : 3}\\)`) });
  const past = page.getByRole("region", { name: "Past Interviews" });
  await expect(page.getByTestId("upcoming-interview-count")).toHaveText(String(thisWeek ? 4 : 3));
  await expect(upcoming.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
  await expect(upcoming.getByRole("heading", { name: "Tomorrow", exact: true })).toBeVisible();
  if (thisWeek) await expect(upcoming.getByRole("heading", { name: "This Week", exact: true })).toBeVisible();
  await expect(upcoming.getByRole("heading", { name: "Later", exact: true })).toBeVisible();
  await expect(upcoming.locator("article")).toHaveCount(thisWeek ? 4 : 3);
  await expect(upcoming.getByText("Later Archived", { exact: false })).toBeVisible();
  await expect(past).toHaveCount(0);
  await page.getByRole("tab", { name: "Past" }).click();
  await expect(upcoming).toHaveCount(0);
  await expect(past.locator("article")).toHaveCount(2);
  await expect(past.locator("article").first()).toContainText("Recent Archived");
  const sort = past.getByRole("button", { name: "Sort past interviews: most recent first" });
  await sort.click();
  await expect(past.locator("article").first()).toContainText("Older Assessment");
  await past.getByRole("button", { name: "Sort past interviews: oldest first" }).click();
  await expect(past.locator("article").first()).toContainText("Recent Archived");
});
