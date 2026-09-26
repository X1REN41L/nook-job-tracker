import { expect, test } from "@playwright/test";

import { sameOriginMutationHeaders } from "./api-helpers";

test("search is inert off the Job Board and application actions ignore Interviews", async ({ page, request }) => {
  const response = await request.post("/api/applications", {
    headers: sameOriginMutationHeaders,
    data: {
      company: "Shortcut scope fixture",
      role: "Tester",
      status: "APPLIED",
      appliedDate: "2026-09-22",
      source: "Playwright",
      notes: "",
      jobUrl: "",
    },
  });
  expect(response.status()).toBe(201);
  const { application } = await response.json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  for (const route of ["/interviews", "/dashboard"]) {
    await page.goto(route);
    await page.evaluate(() => localStorage.setItem("nook-sidebar-collapsed", "true"));
    await page.reload();
    await page.keyboard.press("/");
    expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-collapsed"))).toBe("true");
    if (route === "/interviews") {
      await expect(page.getByRole("searchbox", { name: "Search by company or role" })).toBeFocused();
    } else {
      expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");
    }
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.keyboard.press("Alt+a");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  }

  const record = await request.get(`/api/applications/${application.id}`);
  expect(record.ok()).toBe(true);
  expect((await record.json()).application.archived).toBe(false);
  expect(errors).toEqual([]);
});

test("Escape closes the interview date prompt without marking it skipped", async ({ page, request }) => {
  const response = await request.post("/api/applications", {
    headers: sameOriginMutationHeaders,
    data: {
      company: "Shortcut date fixture",
      role: "Tester",
      status: "APPLIED",
      appliedDate: "2026-09-22",
      source: "Playwright",
      notes: "",
      jobUrl: "",
    },
  });
  expect(response.status()).toBe(201);
  const { application } = await response.json();
  await page.goto("/jobs");
  await page.locator(`[data-kanban-card-id="${application.id}"]`).press("Enter");
  const modal = page.getByRole("dialog", { name: "Edit job" });
  await modal.getByLabel("Status").selectOption("INTERVIEW");
  await modal.getByRole("button", { name: /save/i }).click();
  const datePrompt = page.getByRole("dialog", { name: "Add interview date" });
  await expect(datePrompt).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(datePrompt).toHaveCount(0);
  const record = await request.get(`/api/applications/${application.id}`);
  expect((await record.json()).application.interviewDatePromptDismissed).toBe(false);
});

test("all nine original shortcuts have the expected behavior on each route and Settings suppresses them", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const modifier = process.platform === "darwin" ? "Meta" : "Control";

  for (const route of ["/jobs", "/interviews", "/dashboard"]) {
    await page.goto(route);
    await page.keyboard.press("n");
    await expect(page.getByRole("dialog", { name: "Add a job" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Add a job" })).toHaveCount(0);

    await page.keyboard.press("/");
    if (route === "/jobs") await expect(page.getByRole("textbox", { name: "Search company or role" })).toBeFocused();
    if (route === "/interviews") await expect(page.getByRole("searchbox", { name: "Search by company or role" })).toBeFocused();
    if (route === "/dashboard") expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe("INPUT");
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());

    await page.keyboard.press("?");
    const shortcuts = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
    await expect(shortcuts).toBeVisible();
    await expect(shortcuts.getByText("Undo latest status change, archive, or delete")).toBeVisible();
    await expect(shortcuts.getByText(modifier === "Meta" ? "⌘ ⇧ ," : "Ctrl + Shift + ,", { exact: true })).toBeVisible();
    for (const section of ["Job Board", "Dashboard"]) {
      await expect(shortcuts.getByRole("region", { name: section }).getByText(modifier === "Meta" ? "⌥ A" : "Alt + Shift + A", { exact: true })).toBeVisible();
    }
    await expect(shortcuts.getByText("G J", { exact: true })).toBeVisible();
    await expect(shortcuts.getByText("← / →", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shortcuts).toHaveCount(0);

    await page.keyboard.press("Alt+a");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Backspace");
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await page.keyboard.press("u");
    await expect(page.locator(".nook-toast")).toHaveCount(0);

    const before = await page.evaluate(() => localStorage.getItem("nook-sidebar-collapsed"));
    await page.keyboard.press("b");
    expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-collapsed"))).not.toBe(before);

    await page.keyboard.press(`${modifier}+Shift+,`);
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    const collapsed = await page.evaluate(() => localStorage.getItem("nook-sidebar-collapsed"));
    for (const key of ["n", "/", "?", "Alt+a", "Delete", "Backspace", "b", "u", "g", "j", "ArrowDown"]) {
      await page.keyboard.press(key);
    }
    await expect(settings).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Add a job" })).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-collapsed"))).toBe(collapsed);
    expect(new URL(page.url()).pathname).toBe(route);
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("keyboard-only navigation, card focus, archive, delete, and undo", async ({ page, request }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  async function create(company: string, status: string) {
    const response = await request.post("/api/applications", {
      headers: sameOriginMutationHeaders,
      data: { company, role: "Keyboard flow", status, appliedDate: "2026-09-26", source: "Playwright", notes: "", jobUrl: "" },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).application as { id: string };
  }
  const applied = await create("Keyboard applied", "APPLIED");
  const assessment = await create("Keyboard assessment", "ONLINE_ASSESSMENT");

  await page.goto("/dashboard");
  await page.keyboard.press("g");
  await page.waitForTimeout(1100);
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.keyboard.press("g");
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/\/jobs$/);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`[data-kanban-card-id="${applied.id}"]`)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(`[data-kanban-card-id="${assessment.id}"]`)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(`[data-kanban-card-id="${applied.id}"]`)).toBeFocused();

  await page.keyboard.press("Alt+a");
  await expect(page.locator(`[data-kanban-card-id="${applied.id}"]`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.keyboard.press("u");
  await expect(page.locator(`[data-kanban-card-id="${applied.id}"]`)).toBeVisible();
  await expect(page.locator(`[data-kanban-card-id="${applied.id}"]`)).toBeFocused();
  await page.keyboard.press("Delete");
  const deleteDialog = page.getByRole("alertdialog", { name: "Delete application?" });
  await expect(deleteDialog).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await expect(deleteDialog).toHaveCount(0);
  await expect(page.locator(`[data-kanban-card-id="${applied.id}"]`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.keyboard.press("u");
  await expect(page.locator(`[data-kanban-card-id="${applied.id}"]`)).toBeVisible();

  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`#recent-applications-heading + div [data-application-id="${assessment.id}"]`)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`#recent-applications-heading + div [data-application-id="${applied.id}"]`)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(`#recent-applications-heading + div [data-application-id="${assessment.id}"]`)).toBeFocused();
  await page.keyboard.press("Alt+a");
  await expect(page.locator(`#recent-applications-heading + div [data-application-id="${assessment.id}"]`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
  await page.keyboard.press("u");
  await expect(page.locator(`#recent-applications-heading + div [data-application-id="${assessment.id}"]`)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator(`#recent-applications-heading + div [data-application-id="${assessment.id}"]`)).toBeFocused();
  await page.keyboard.press("Backspace");
  await expect(page.getByRole("alertdialog", { name: "Delete application?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog", { name: "Delete application?" })).toHaveCount(0);

  await page.keyboard.press("g");
  await page.keyboard.press("i");
  await expect(page).toHaveURL(/\/interviews$/);
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "Search by company or role" });
  await expect(search).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  await search.evaluate((element) => (element as HTMLElement).blur());
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Upcoming" })).toHaveAttribute("aria-selected", "true");
  expect(errors).toEqual([]);
});
