import { expect, type Locator, type Page, type APIRequestContext, test } from "@playwright/test";

import { sameOriginMutationHeaders } from "./api-helpers";

type ApplicationInput = {
  company: string;
  role: string;
  status: "APPLIED";
  appliedDate: string;
  source: string;
  notes: string;
  jobUrl: string;
};

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let ownedIds: string[] = [];
let recordNumber = 0;

function applicationInput(status: ApplicationInput["status"], label = "keyboard") {
  recordNumber += 1;
  return {
    company: `E2E ${label} ${runId}-${recordNumber}`,
    role: "Active keyboard role",
    status,
    appliedDate: "2026-09-22",
    source: "Playwright",
    notes: "Temporary keyboard test record",
    jobUrl: "https://example.com/keyboard-test",
  } satisfies ApplicationInput;
}

async function createApplication(request: APIRequestContext, input: ApplicationInput) {
  const response = await request.post("/api/applications", { data: input, headers: sameOriginMutationHeaders });
  expect(response.status()).toBe(201);
  const body = await response.json();
  ownedIds.push(body.application.id);
  return body.application as { id: string; company: string; role: string; revision: number };
}

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
}

async function openEditModal(page: Page, application: { company: string; role: string }) {
  await page.getByRole("button", { name: `Edit or archive ${application.role} at ${application.company}`, exact: true }).click();
  return page.getByRole("dialog", { name: "Edit job" });
}

async function assertFocusCycle(
  page: Page,
  dialog: Locator,
  controls: Locator[],
  initialIndex: number,
) {
  async function assertFocused(index: number) {
    await expect(controls[index]).toBeFocused();
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  }

  await assertFocused(initialIndex);
  for (let step = 1; step <= controls.length; step += 1) {
    await page.keyboard.press("Tab");
    await assertFocused((initialIndex + step) % controls.length);
  }
  for (let step = 1; step <= controls.length; step += 1) {
    await page.keyboard.press("Shift+Tab");
    await assertFocused((initialIndex - step + controls.length * 2) % controls.length);
  }
}

function jobControls(dialog: Locator, editing: boolean) {
  const controls = [
    dialog.getByRole("button", { name: "Close", exact: true }),
    dialog.getByLabel("Company"),
    dialog.getByLabel("Role"),
    dialog.getByLabel("Status"),
    dialog.getByLabel("Date applied"),
    dialog.getByLabel("Interview date"),
    dialog.getByLabel("Source"),
  ];
  controls.push(dialog.getByLabel("Job link (optional)"), dialog.getByLabel("Notes (optional)"));
  if (editing) controls.push(dialog.getByRole("button", { name: "Delete", exact: true }));
  controls.push(
    dialog.getByRole("button", { name: "Cancel", exact: true }),
    dialog.getByRole("button", { name: "Save job", exact: true }),
  );
  return controls;
}

async function deleteWithKeyboard(
  page: Page,
  application: { id: string; company: string; role: string },
  key: "Enter" | "Space",
) {
  const editDialog = await openEditModal(page, application);
  await editDialog.getByRole("button", { name: "Delete", exact: true }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete application?" });
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "DELETE" && new URL(response.url()).pathname.endsWith(`/api/applications/${application.id}`),
  );
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).focus();
  await page.keyboard.press(key);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect((await response.json()).token).toEqual(expect.any(String));
  await expect(deleteDialog).toBeHidden();
}

test.beforeEach(async ({ page }) => {
  ownedIds = [];
  await page.addInitScript(() => {
    localStorage.removeItem("nook-sidebar-collapsed");
    localStorage.setItem("nook-archived-expanded", "true");
  });
});

test.afterEach(async ({ request }) => {
  await Promise.all(ownedIds.map((id) => request.delete(`/api/applications/${id}`, { headers: sameOriginMutationHeaders })));
});

test("traps focus in Add, Edit, Delete, and Settings modals in forward and reverse visual order", async ({ page, request }) => {
  const active = await createApplication(request, applicationInput("APPLIED", "focus"));
  await openDashboard(page);

  await page.getByRole("button", { name: "Add job" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add a job" });
  await assertFocusCycle(page, addDialog, jobControls(addDialog, false), 1);
  await page.getByRole("button", { name: "Settings" }).evaluate((button: HTMLButtonElement) => button.focus());
  await expect(addDialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await addDialog.getByRole("button", { name: "Cancel" }).click();

  const editDialog = await openEditModal(page, active);
  await assertFocusCycle(page, editDialog, jobControls(editDialog, true), 1);
  await editDialog.getByRole("button", { name: "Delete", exact: true }).click();

  const deleteDialog = page.getByRole("alertdialog", { name: "Delete application?" });
  const deleteControls = [
    deleteDialog.getByRole("button", { name: "Cancel", exact: true }),
    deleteDialog.getByRole("button", { name: "Delete", exact: true }),
  ];
  await assertFocusCycle(page, deleteDialog, deleteControls, 0);
  await page.getByRole("button", { name: "Add job" }).evaluate((button: HTMLButtonElement) => button.focus());
  await expect(deleteControls[0]).toBeFocused();
  await deleteControls[0].click();
  await editDialog.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  const settingsControls = [
    settingsDialog.getByRole("button", { name: "Close settings" }),
    settingsDialog.getByRole("button", { name: "General", exact: true }),
    settingsDialog.getByRole("button", { name: "Board", exact: true }),
    settingsDialog.getByRole("button", { name: "Shortcuts", exact: true }),
    settingsDialog.getByRole("button", { name: "Backup & Restore", exact: true }),
    settingsDialog.getByRole("button", { name: "Use system theme" }),
    settingsDialog.getByRole("button", { name: "Use light theme" }),
    settingsDialog.getByRole("button", { name: "Use dark theme" }),
    settingsDialog.getByRole("combobox", { name: "New Applications Default Board" }),
    settingsDialog.getByRole("group", { name: "Motion" }).getByRole("button", { name: "System" }),
    settingsDialog.getByRole("group", { name: "Motion" }).getByRole("button", { name: "Reduced" }),
  ];
  await assertFocusCycle(page, settingsDialog, settingsControls, 0);

  await settingsControls[4].click();
  const backupControls = [
    settingsControls[0],
    settingsControls[1],
    settingsControls[2],
    settingsControls[3],
    settingsControls[4],
    settingsDialog.getByRole("button", { name: "Import", exact: true }),
    settingsDialog.getByRole("button", { name: "Export", exact: true }),
  ];
  await assertFocusCycle(page, settingsDialog, backupControls, 4);
  await page.getByRole("button", { name: "Add job" }).evaluate((button: HTMLButtonElement) => button.focus());
  await expect(settingsControls[0]).toBeFocused();
});

test("activates Save, Delete, and Close with Enter and Space", async ({ page, request }) => {
  const editable = await createApplication(request, applicationInput("APPLIED", "edit-save"));
  const deletableEnter = await createApplication(request, applicationInput("APPLIED", "delete-enter"));
  const deletableSpace = await createApplication(request, applicationInput("APPLIED", "delete-space"));
  await openDashboard(page);

  for (const key of ["Enter", "Space"] as const) {
    const input = applicationInput("APPLIED", `add-${key.toLowerCase()}`);
    await page.getByRole("button", { name: "Add job" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a job" });
    await dialog.getByLabel("Company").fill(input.company);
    await dialog.getByLabel("Role").fill(input.role);
    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/applications"));
    await dialog.getByRole("button", { name: "Save job" }).focus();
    await page.keyboard.press(key);
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    ownedIds.push((await response.json()).application.id);
    await expect(dialog).toBeHidden();
    await expect(page.getByText(input.company, { exact: true }).first()).toBeVisible();
  }

  for (const key of ["Enter", "Space"] as const) {
    const dialog = await openEditModal(page, editable);
    const nextRole = `Edited with ${key}`;
    await dialog.getByLabel("Role").fill(nextRole);
    const responsePromise = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/applications/${editable.id}`));
    await dialog.getByRole("button", { name: "Save job" }).focus();
    await page.keyboard.press(key);
    expect((await responsePromise).status()).toBe(200);
    await expect(dialog).toBeHidden();
    editable.role = nextRole;
  }

  await deleteWithKeyboard(page, deletableEnter, "Enter");
  await deleteWithKeyboard(page, deletableSpace, "Space");

  for (const key of ["Enter", "Space"] as const) {
    await page.getByRole("button", { name: "Settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    await dialog.getByRole("button", { name: "Close settings" }).focus();
    await page.keyboard.press(key);
    await expect(dialog).toBeHidden();

    await page.getByRole("button", { name: "Add job" }).click();
    const addDialog = page.getByRole("dialog", { name: "Add a job" });
    await addDialog.getByRole("button", { name: "Close", exact: true }).focus();
    await page.keyboard.press(key);
    await expect(addDialog).toBeHidden();
  }
});

test("opens Settings only with Cmd/Ctrl+Shift+, and suppresses it in editable fields", async ({ page }) => {
  await openDashboard(page);
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "Meta" : "Control");
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });

  await page.keyboard.press(`${modifier}+,`);
  await expect(settingsDialog).toBeHidden();
  await page.keyboard.press("Alt+s");
  await expect(settingsDialog).toBeHidden();

  await page.keyboard.press(`${modifier}+Shift+,`);
  await expect(settingsDialog).toBeVisible();
  await settingsDialog.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await expect(settingsDialog.getByText(modifier === "Meta" ? "⌘ ⇧ ," : "Ctrl + Shift + ,", { exact: true })).toBeVisible();
  await settingsDialog.getByRole("button", { name: "Close settings" }).click();

  const search = page.getByRole("textbox", { name: "Search company or role" });
  await search.fill("search stays intact");
  await search.focus();
  await page.keyboard.press(`${modifier}+Shift+,`);
  await expect(settingsDialog).toBeHidden();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("search stays intact");

  await page.getByRole("button", { name: "Add job" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add a job" });
  const company = addDialog.getByLabel("Company");
  await company.fill("company stays intact");
  await company.focus();
  await page.keyboard.press(`${modifier}+Shift+,`);
  await expect(settingsDialog).toBeHidden();
  await expect(addDialog).toBeVisible();
  await expect(company).toBeFocused();
  await expect(company).toHaveValue("company stays intact");

  const notes = addDialog.getByLabel("Notes (optional)");
  await notes.fill("notes stay intact");
  await notes.focus();
  await page.keyboard.press(`${modifier}+Shift+,`);
  await expect(settingsDialog).toBeHidden();
  await expect(addDialog).toBeVisible();
  await expect(notes).toBeFocused();
  await expect(notes).toHaveValue("notes stay intact");
});

test("tabs through every dashboard, Kanban, sidebar, and archived control in visual order", async ({ page, request }) => {
  const active = await createApplication(request, applicationInput("APPLIED", "dashboard-active"));
  const archived = await createApplication(request, applicationInput("APPLIED", "dashboard-archived"));
  await request.patch(`/api/applications/${archived.id}`, { data: { revision: archived.revision, archived: true }, headers: sameOriginMutationHeaders });
  await openDashboard(page);
  await expect(page.getByRole("button", { name: /^Archived\s+\d+$/ })).toHaveAttribute("aria-expanded", "true");

  const candidates = page.locator('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]');
  const focusables: Locator[] = [];
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible()) focusables.push(candidate);
  }

  for (const [index, control] of focusables.entries()) {
    await control.evaluate((element, focusIndex) => element.setAttribute("data-e2e-focus-index", String(focusIndex)), index);
  }
  await page.locator("body").evaluate((body: HTMLBodyElement) => {
    body.tabIndex = -1;
    body.focus();
    body.removeAttribute("tabindex");
  });
  for (const control of focusables) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
  }

  async function focusIndex(control: Locator) {
    const value = await control.getAttribute("data-e2e-focus-index");
    expect(value).not.toBeNull();
    return Number(value);
  }

  const archivedRow = page.locator(`[data-application-id="${archived.id}"]`);
  const orderedControls = [
    page.getByRole("button", { name: "Settings", exact: true }),
    page.getByRole("button", { name: "Add job", exact: true }),
    page.getByRole("button", { name: `Edit or move ${active.role} at ${active.company}`, exact: true }),
    page.getByRole("button", { name: "Collapse sidebar", exact: true }),
    page.getByRole("textbox", { name: "Search company or role", exact: true }),
    ...["All", "Applied", "Online assessment", "Interview", "Offer", "Rejected"].map((name) =>
      page.getByRole("button", { name, exact: true }),
    ),
    page.getByRole("button", { name: `Edit or archive ${active.role} at ${active.company}`, exact: true }),
    page.getByRole("button", { name: /^Archived\s+\d+$/ }),
    archivedRow.getByRole("button", { name: `Edit or move archived ${archived.role} at ${archived.company}`, exact: true }),
    archivedRow.getByRole("button", { name: "Restore", exact: true }),
    archivedRow.getByRole("button", { name: `Delete ${archived.role} at ${archived.company}`, exact: true }),
  ];
  const indexes = await Promise.all(orderedControls.map(focusIndex));
  expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
});

test("pauses and resumes the Undo toast dismissal timer on hover and focus", async ({ page, request }) => {
  const hoverTarget = await createApplication(request, applicationInput("APPLIED", "toast-hover"));
  const focusTarget = await createApplication(request, applicationInput("APPLIED", "toast-focus"));
  await openDashboard(page);
  await page.clock.install();

  await deleteWithKeyboard(page, hoverTarget, "Enter");
  let toast = page.locator(".nook-toast");
  await expect(toast.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.clock.runFor(2_000);
  await page.mouse.move(0, 0);
  await toast.hover();
  await page.clock.runFor(4_000);
  await expect(toast).toBeVisible();
  await page.mouse.move(0, 0);
  await page.clock.runFor(2_000);
  await expect(toast).toBeVisible();
  await page.clock.runFor(1_500);
  await expect(toast).toHaveCount(0);

  await deleteWithKeyboard(page, focusTarget, "Space");
  toast = page.locator(".nook-toast");
  const undo = toast.getByRole("button", { name: "Undo" });
  await page.clock.runFor(2_000);
  await undo.focus();
  await page.clock.runFor(4_000);
  await expect(toast).toBeVisible();
  await undo.blur();
  await page.clock.runFor(2_000);
  await expect(toast).toBeVisible();
  await page.clock.runFor(1_500);
  await expect(toast).toHaveCount(0);
});
