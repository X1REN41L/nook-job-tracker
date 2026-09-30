import { type APIRequestContext, type Page } from "@playwright/test";

import { expect, gotoReady, sameOriginMutationHeaders, test } from "./api-helpers";

let recordNumber = 0;

async function createApplication(request: APIRequestContext, status = "APPLIED") {
  recordNumber += 1;
  const response = await request.post("/api/applications", {
    data: { company: `Details co ${recordNumber}`, role: `Details role ${recordNumber}`, status, appliedDate: "2026-09-01" },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).application as { id: string; company: string; role: string; revision: number };
}

async function readApplication(request: APIRequestContext, id: string) {
  return (await (await request.get(`/api/applications/${id}`)).json()).application;
}

function localDate(page: Page, offset = 0) {
  return page.evaluate((days) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }, offset);
}

test("the details panel manages interview rounds, contacts, dated notes, and a follow-up", async ({ page, request }) => {
  const application = await createApplication(request, "INTERVIEW");
  await gotoReady(page, "/jobs");
  const card = page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}`, exact: true });
  await card.click();
  const panel = page.getByRole("dialog", { name: application.role, exact: true });
  await expect(panel.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await expect(panel.getByText("Added as Interview", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Add round", exact: true }).click();
  await panel.getByLabel("Date", { exact: true }).fill("2030-01-15");
  await panel.getByLabel("Time (optional)").fill("14:30");
  await panel.getByLabel("Type").selectOption("TECHNICAL");
  await panel.getByLabel("Who you met (optional)").fill("Ana Lead");
  await panel.getByRole("button", { name: "Add round", exact: true }).click();
  await expect(panel.getByText("With Ana Lead", { exact: true })).toBeVisible();

  await panel.getByRole("button", { name: "Add contact", exact: true }).click();
  await panel.getByLabel("Name", { exact: true }).fill("Ben Recruiter");
  await panel.getByLabel("Email (optional)").fill("ben@example.test");
  await panel.getByRole("button", { name: "Add contact", exact: true }).click();
  await expect(panel.getByRole("link", { name: "ben@example.test" })).toHaveAttribute("href", "mailto:ben@example.test");

  await panel.getByLabel("New note").fill("Called Ben about next steps");
  await panel.getByRole("button", { name: "Add note", exact: true }).click();
  const note = panel.getByRole("listitem").filter({ hasText: "Called Ben about next steps" });
  await expect(note).toBeVisible();
  await expect(panel.getByLabel("New note")).toHaveValue("");
  await note.getByRole("button", { name: "Edit", exact: true }).click();
  await panel.getByLabel("Edit note").fill("Called Ben twice");
  await panel.getByRole("button", { name: "Save note", exact: true }).click();
  // Wait for the save: the next change must carry the revision this one returns.
  await expect(panel.getByLabel("Edit note")).toHaveCount(0);
  const editedNote = panel.getByRole("listitem").filter({ hasText: "Called Ben twice" });
  await expect(editedNote).toBeVisible();

  const yesterday = await localDate(page, -1);
  await panel.getByRole("button", { name: "Set reminder", exact: true }).click();
  await panel.getByLabel("Follow up on").fill(yesterday);
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await expect(panel.getByText(/^Due /)).toBeVisible();

  const saved = await readApplication(request, application.id);
  expect(saved.interviews).toMatchObject([{ date: "2030-01-15T00:00:00.000Z", time: "14:30", type: "TECHNICAL", interviewers: "Ana Lead" }]);
  expect(saved.contacts).toMatchObject([{ name: "Ben Recruiter", email: "ben@example.test" }]);
  expect(saved.followUpDate).toBe(`${yesterday}T00:00:00.000Z`);

  await editedNote.getByRole("button", { name: "Delete this note", exact: true }).click();
  await editedNote.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(panel.getByText("Called Ben twice")).toHaveCount(0);

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(card).toBeFocused();
  const cardArticle = page.locator(`article[data-application-id="${application.id}"]`);
  await expect(cardArticle).toContainText("Interview Jan 15, 2030");
  await expect(cardArticle).toContainText("Follow up due");

  await gotoReady(page, "/dashboard");
  const done = page.getByRole("button", { name: `Mark the follow-up for ${application.role} at ${application.company} done`, exact: true });
  await expect(done).toBeVisible();
  // Done appears when the follow-up row is hovered.
  await done.locator("xpath=..").hover();
  await done.click();
  await expect(done).toHaveCount(0);
  expect((await readApplication(request, application.id)).followUpDate).toBeNull();
});

test("the table filters from the address, changes status in bulk, and undoes the whole batch", async ({ page, request }) => {
  const first = await createApplication(request);
  const second = await createApplication(request);
  const other = await createApplication(request, "REJECTED");
  await gotoReady(page, "/table?status=APPLIED");
  await expect(page.getByRole("combobox", { name: "Filter by status" })).toHaveValue("APPLIED");
  await expect(page.getByRole("button", { name: other.role, exact: true })).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Select all shown applications" }).check();
  await page.getByRole("combobox", { name: "Change status of selected applications" }).selectOption("OFFER");
  const toast = page.locator(".nook-toast-wrap.nook-toast-show");
  await expect(toast).toContainText("Moved 2 applications to Offer");
  for (const application of [first, second]) expect((await readApplication(request, application.id)).status).toBe("OFFER");

  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect.poll(async () => Promise.all([first, second].map(async ({ id }) => (await readApplication(request, id)).status))).toEqual(["APPLIED", "APPLIED"]);
  await expect(page.getByRole("button", { name: first.role, exact: true })).toBeVisible();

  await page.getByRole("button", { name: first.role, exact: true }).click();
  await expect(page.getByRole("dialog", { name: first.role, exact: true })).toBeVisible();
});

test("the table deletes selected applications after confirming, and one Undo restores them all", async ({ page, request }) => {
  const first = await createApplication(request);
  const second = await createApplication(request);
  const kept = await createApplication(request, "REJECTED");
  await gotoReady(page, "/table?status=APPLIED");

  await page.getByRole("checkbox", { name: "Select all shown applications" }).check();
  const bulk = page.getByRole("group", { name: "Bulk actions" });
  await bulk.getByRole("button", { name: "Delete", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete 2 applications?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(bulk.getByRole("button", { name: "Delete", exact: true })).toBeFocused();
  for (const { id } of [first, second]) expect((await request.get(`/api/applications/${id}`)).status()).toBe(200);

  await bulk.getByRole("button", { name: "Delete", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  const toast = page.locator(".nook-toast-wrap.nook-toast-show");
  await expect(toast).toContainText("Deleted 2 applications");
  for (const { id } of [first, second]) expect((await request.get(`/api/applications/${id}`)).status()).toBe(404);
  expect((await readApplication(request, kept.id)).status).toBe("REJECTED");
  await expect(page.getByRole("button", { name: first.role, exact: true })).toHaveCount(0);

  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator(".nook-toast-wrap.nook-toast-show")).toContainText("Restored 2 applications");
  for (const { id } of [first, second]) expect((await readApplication(request, id)).status).toBe("APPLIED");
});

test("the command palette opens applications and pages", async ({ page, request }) => {
  const application = await createApplication(request);
  await gotoReady(page, "/dashboard");
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "Meta" : "Control");

  await page.keyboard.press(`${modifier}+k`);
  const palette = page.getByRole("dialog", { name: "Command palette" });
  const search = palette.getByRole("combobox", { name: "Search pages, actions, and applications" });
  await expect(search).toBeFocused();
  await search.fill(application.role);
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  const panel = page.getByRole("dialog", { name: application.role, exact: true });
  await expect(panel).toBeVisible();
  await page.keyboard.press("e");
  await expect(panel.getByRole("form", { name: "Edit details" })).toBeVisible();
  await expect(panel.getByLabel("Company", { exact: true })).toBeFocused();
  await expect(panel.getByLabel("Company", { exact: true })).toHaveValue(application.company);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  await page.keyboard.press(`${modifier}+k`);
  await search.fill("job board");
  await expect(palette.getByRole("option", { name: /Job Board/ })).toContainText("G then J");
  await search.fill("table");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/table$/);
});

test("the old Stale Applications address opens the full Needs attention list", async ({ page }) => {
  await page.goto("/dashboard/stale");
  await expect(page).toHaveURL(/\/dashboard\?attention=all$/);
  await expect(page.getByRole("button", { name: "Show fewer", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Dashboard sections" }).getByRole("link")).toHaveText(["Overview", "Analytics"]);
});
