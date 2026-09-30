import { type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { expect, openDetailsEditor, test, sameOriginMutationHeaders } from "./api-helpers";

let recordNumber = 0;

async function createApplication(request: APIRequestContext, label: string) {
  recordNumber += 1;
  const response = await request.post("/api/applications", {
    data: {
      company: `Dialog ${label} ${recordNumber}`,
      role: `Dialog role ${recordNumber}`,
      status: "APPLIED",
      appliedDate: "2026-09-22",
      source: "Playwright",
      notes: "Dialog focus fixture",
      jobUrl: "",
    },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).application as { id: string; company: string; role: string };
}

async function openJobBoard(page: Page) {
  await page.goto("/jobs");
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
}

function boardCard(page: Page, application: { company: string; role: string }) {
  return page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}`, exact: true });
}

async function assertFocusCycle(page: Page, dialog: Locator, controls: Locator[], initialIndex: number) {
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

test("REACT-003: the interview-date prompt opened from a board card's status dropdown receives focus", async ({ page, request }) => {
  const application = await createApplication(request, "prompt-card");
  await openJobBoard(page);
  await page.locator(`[data-kanban-card-id="${application.id}"]`).press("Enter");
  const panel = page.getByRole("dialog", { name: application.role, exact: true });
  await panel.getByLabel("Status", { exact: true }).selectOption("INTERVIEW");

  const prompt = page.getByRole("dialog", { name: "Add interview date" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByLabel("Interview date")).toBeFocused();
});

test("REACT-003: the prompt opened from the status dropdown traps focus and returns it there on Escape", async ({ page, request }) => {
  const application = await createApplication(request, "prompt");
  await openJobBoard(page);
  await boardCard(page, application).click();
  const status = page.getByRole("dialog", { name: application.role, exact: true }).getByLabel("Status", { exact: true });
  // A person reaches the dropdown by clicking or tabbing to it, so it has focus when it changes.
  await status.focus();
  await status.selectOption("INTERVIEW");

  const prompt = page.getByRole("dialog", { name: "Add interview date" });
  await expect(prompt).toBeVisible();
  const dateInput = prompt.getByLabel("Interview date");
  await expect(dateInput).toBeFocused();
  await assertFocusCycle(page, prompt, [
    dateInput,
    prompt.getByLabel("Type"),
    prompt.getByRole("button", { name: "Skip" }),
    prompt.getByRole("button", { name: "Add date" }),
  ], 0);
  await page.getByRole("button", { name: "Add job" }).evaluate((button: HTMLButtonElement) => button.focus());
  await expect(dateInput).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(status).toBeFocused();
});

test("UI-001: the details panel opened while the cancelled Add dialog is still exiting receives focus", async ({ page, request }) => {
  const application = await createApplication(request, "reopen");
  await openJobBoard(page);
  const addJob = page.getByRole("button", { name: "Add job" });
  await addJob.click();
  const addDialog = page.getByRole("dialog", { name: "Add a job" });
  await expect(addDialog.getByLabel("Company")).toBeFocused();
  const cancel = await addDialog.getByRole("button", { name: "Cancel" }).elementHandle();
  const row = await boardCard(page, application).elementHandle();

  // Cancel, then focus and open Edit two frames later: inside the Add dialog's exit animation.
  await page.evaluate(async ([cancelButton, rowButton]) => {
    (cancelButton as HTMLButtonElement).click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!document.querySelector('[data-motion-presence="closing"]')) throw new Error("The Add dialog finished exiting too early");
    (rowButton as HTMLButtonElement).focus();
    (rowButton as HTMLButtonElement).click();
  }, [cancel, row]);

  const detailsDialog = page.getByRole("dialog", { name: application.role, exact: true });
  await expect(detailsDialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(detailsDialog).toHaveCount(0);
  await expect(boardCard(page, application)).toBeFocused();
});

test("keyboard:233: a closing Settings dialog does not reclaim focus from the search field", async ({ page }) => {
  await openJobBoard(page);
  const modifier = await page.evaluate(() => /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) ? "Meta" : "Control");
  const settingsButton = page.getByRole("button", { name: "Settings" });
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsButton.click();
  await expect(settingsDialog.getByRole("button", { name: "Close settings" })).toBeFocused();
  await settingsDialog.getByRole("button", { name: "Close settings" }).click();

  // No wait for the exit animation: the search field is used while Settings is still closing.
  const search = page.getByRole("searchbox", { name: "Search company or role" });
  await search.focus();
  await expect(search).toBeFocused();
  await page.keyboard.type("closing");
  await page.keyboard.press(`${modifier}+Shift+,`);
  await expect(settingsDialog).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("closing");
});

test("nested Delete All confirmation owns the trap and Escape, then returns focus to Settings", async ({ page }) => {
  await openJobBoard(page);
  const settingsButton = page.getByRole("button", { name: "Settings" });
  await settingsButton.click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsDialog.getByRole("button", { name: "Backup & restore", exact: true }).click();
  const deleteAll = settingsDialog.getByRole("button", { name: "Delete all data", exact: true });
  await deleteAll.click();

  const confirmation = page.getByRole("alertdialog", { name: "Delete all data?" });
  const confirmationControls = [
    confirmation.getByRole("button", { name: "Cancel", exact: true }),
    confirmation.getByRole("button", { name: "Delete all data", exact: true }),
  ];
  await assertFocusCycle(page, confirmation, confirmationControls, 0);
  await settingsDialog.getByRole("button", { name: "General", exact: true }).evaluate((button: HTMLButtonElement) => button.focus());
  await expect(confirmationControls[0]).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(settingsDialog).toBeVisible();
  await expect(deleteAll).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(settingsDialog.getByRole("button", { name: "Export", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Add job" }).evaluate((button: HTMLButtonElement) => button.focus());
  await expect(settingsDialog.getByRole("button", { name: "Close settings" })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(settingsDialog).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
});

test("REACT-006: a failed delete keeps the application view with its unsaved edits and shows the error there", async ({ page, request }) => {
  const application = await createApplication(request, "failed-delete");
  await openJobBoard(page);
  await boardCard(page, application).click();
  const panel = page.getByRole("dialog", { name: application.role, exact: true });
  const editor = await openDetailsEditor(page);
  await editor.getByLabel("Role").fill("Unsaved role edit");

  await page.route(`**/api/applications/${application.id}?undoable=1`, (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Delete failed for the test" }) });
  });
  const panelDelete = panel.getByRole("button", { name: "Delete", exact: true });
  await panelDelete.click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete application?" });
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(deleteDialog).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(editor.getByLabel("Role")).toHaveValue("Unsaved role edit");
  await expect(panel.getByRole("alert").filter({ hasText: "Delete failed for the test" })).toHaveCount(1);
  await expect(panelDelete).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Delete failed for the test" })).toHaveCount(0);
  const record = await request.get(`/api/applications/${application.id}`);
  expect(record.ok()).toBe(true);
});
