import { type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { expect, readSettings, test, sameOriginMutationHeaders } from "./api-helpers";

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

function sidebarRow(page: Page, application: { company: string; role: string }) {
  return page.getByRole("button", { name: `Edit or archive ${application.role} at ${application.company}`, exact: true });
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

test("REACT-003: the interview-date prompt opened from a board card's Edit dialog receives focus", async ({ page, request }) => {
  const application = await createApplication(request, "prompt-card");
  await openJobBoard(page);
  await page.locator(`[data-kanban-card-id="${application.id}"]`).press("Enter");
  const editDialog = page.getByRole("dialog", { name: "Edit job" });
  await expect(editDialog.getByLabel("Company")).toBeFocused();
  await editDialog.getByLabel("Status").selectOption("INTERVIEW");
  await editDialog.getByRole("button", { name: "Save job" }).click();

  const prompt = page.getByRole("dialog", { name: "Add interview date" });
  await expect(prompt).toBeVisible();
  await expect(editDialog).toHaveCount(0);
  await expect(prompt.getByLabel("Interview date")).toBeFocused();
});

test("REACT-003: the prompt opened from Edit traps focus and returns it to the Edit trigger on Escape", async ({ page, request }) => {
  const application = await createApplication(request, "prompt");
  await openJobBoard(page);
  const row = sidebarRow(page, application);
  await row.click();
  const editDialog = page.getByRole("dialog", { name: "Edit job" });
  await editDialog.getByLabel("Status").selectOption("INTERVIEW");
  await editDialog.getByRole("button", { name: "Save job" }).click();

  const prompt = page.getByRole("dialog", { name: "Add interview date" });
  await expect(prompt).toBeVisible();
  const dateInput = prompt.getByLabel("Interview date");
  await expect(dateInput).toBeFocused();
  await expect(editDialog).toHaveCount(0);
  await expect(dateInput).toBeFocused();
  await assertFocusCycle(page, prompt, [
    dateInput,
    prompt.getByRole("button", { name: "Skip" }),
    prompt.getByRole("button", { name: "Add date" }),
  ], 0);
  await page.getByRole("button", { name: "Add job" }).evaluate((button: HTMLButtonElement) => button.focus());
  await expect(dateInput).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(prompt).toHaveCount(0);
  await expect(row).toBeFocused();
});

test("UI-001: Edit opened while the cancelled Add dialog is still exiting focuses Company", async ({ page, request }) => {
  const application = await createApplication(request, "reopen");
  await openJobBoard(page);
  const addJob = page.getByRole("button", { name: "Add job" });
  await addJob.click();
  const addDialog = page.getByRole("dialog", { name: "Add a job" });
  await expect(addDialog.getByLabel("Company")).toBeFocused();
  const cancel = await addDialog.getByRole("button", { name: "Cancel" }).elementHandle();
  const row = await sidebarRow(page, application).elementHandle();

  // Cancel, then focus and open Edit two frames later: inside the Add dialog's exit animation.
  await page.evaluate(async ([cancelButton, rowButton]) => {
    (cancelButton as HTMLButtonElement).click();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!document.querySelector('[data-motion-presence="closing"]')) throw new Error("The Add dialog finished exiting too early");
    (rowButton as HTMLButtonElement).focus();
    (rowButton as HTMLButtonElement).click();
  }, [cancel, row]);

  const editDialog = page.getByRole("dialog", { name: "Edit job" });
  await expect(editDialog.getByLabel("Company")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(editDialog).toHaveCount(0);
  await expect(sidebarRow(page, application)).toBeFocused();
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
  const search = page.getByRole("textbox", { name: "Search company or role" });
  await search.focus();
  await expect(search).toBeFocused();
  await page.keyboard.type("closing");
  await page.keyboard.press(`${modifier}+Shift+,`);
  await expect(settingsDialog).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("closing");
});

test("A11Y-003: Escape during a keyboard board reorder cancels the reorder and keeps Settings open", async ({ page, request }) => {
  await openJobBoard(page);
  const settingsButton = page.getByRole("button", { name: "Settings" });
  await settingsButton.click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsDialog.getByRole("button", { name: "Board", exact: true }).click();
  const reorder = settingsDialog.getByRole("button", { name: "Reorder Applied board" });
  await reorder.focus();
  await page.keyboard.press("Space");
  await expect(reorder).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");

  await expect(reorder).not.toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(400);
  await expect(settingsDialog).toBeVisible();
  expect((await readSettings(request)).boards).toEqual([]);
  expect(await settingsDialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

  await page.keyboard.press("Escape");
  await expect(settingsDialog).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
});

test("nested Delete All confirmation owns the trap and Escape, then returns focus to Settings", async ({ page }) => {
  await openJobBoard(page);
  const settingsButton = page.getByRole("button", { name: "Settings" });
  await settingsButton.click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsDialog.getByRole("button", { name: "Backup & Restore", exact: true }).click();
  const deleteAll = settingsDialog.getByRole("button", { name: "Delete All Data", exact: true });
  await deleteAll.click();

  const confirmation = page.getByRole("alertdialog", { name: "Delete all data?" });
  const confirmationControls = [
    confirmation.getByRole("button", { name: "Cancel", exact: true }),
    confirmation.getByRole("button", { name: "Delete All Data", exact: true }),
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

test("REACT-006: a failed delete from Edit reopens the modal with the unsaved form and its error", async ({ page, request }) => {
  const application = await createApplication(request, "failed-delete");
  await openJobBoard(page);
  await sidebarRow(page, application).click();
  const editDialog = page.getByRole("dialog", { name: "Edit job" });
  await editDialog.getByLabel("Role").fill("Unsaved role edit");
  await editDialog.getByLabel("Notes (optional)").fill("Unsaved notes edit");

  await page.route(`**/api/applications/${application.id}?undoable=1`, (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Delete failed for the test" }) });
  });
  await editDialog.getByRole("button", { name: "Delete", exact: true }).click();
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete application?" });
  await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(deleteDialog).toHaveCount(0);
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Role")).toHaveValue("Unsaved role edit");
  await expect(editDialog.getByLabel("Notes (optional)")).toHaveValue("Unsaved notes edit");
  await expect(editDialog.getByRole("alert")).toHaveText("Delete failed for the test");
  await expect(editDialog.getByLabel("Company")).toBeFocused();
  await expect(page.getByRole("alert").filter({ hasText: "Delete failed for the test" })).toHaveCount(1);

  await editDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(editDialog).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "Delete failed for the test" })).toHaveCount(0);
  const record = await request.get(`/api/applications/${application.id}`);
  expect(record.ok()).toBe(true);
});
