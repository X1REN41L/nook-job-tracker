import { type APIRequestContext, type Page } from "@playwright/test";

import { expect, gotoReady, readSettings, resetSettings, test, sameOriginMutationHeaders } from "./api-helpers";
import { DEFAULT_BOARDS, type BoardConfiguration } from "../../src/lib/board-preferences";

type ApplicationInput = {
  company: string;
  role: string;
  status: "APPLIED" | "ONLINE_ASSESSMENT" | "INTERVIEW" | "OFFER" | "REJECTED";
  appliedDate?: string;
  interviewDate?: string;
  jobUrl?: string;
};

let recordNumber = 0;

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function createApplication(request: APIRequestContext, input: Omit<ApplicationInput, "company" | "role"> & Partial<ApplicationInput>) {
  recordNumber += 1;
  const response = await request.post("/api/applications", {
    data: {
      company: `Board a11y ${recordNumber}`,
      role: `Board role ${recordNumber}`,
      appliedDate: "2026-09-22",
      ...input,
    },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).application as { id: string; company: string; role: string; revision: number };
}

async function openJobBoard(page: Page) {
  await gotoReady(page, "/jobs");
}

function boardCard(page: Page, application: { company: string; role: string }) {
  return page.getByRole("button", { name: `Edit or move ${application.role} at ${application.company}`, exact: true });
}

// After a keyboard pick-up, dnd-kit attaches its keydown listener in a setTimeout(0) and measures
// droppable rects in a following commit; arrows pressed before both are ignored. Wait for two
// frames (the measuring commit) and then a timer queued after the sensor's own.
async function waitForKeyboardSensor(page: Page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }));
}

// Kanban keyboard drags have two readiness points; keys sent early are ignored or drop in place.
// Before an arrow: dnd-kit must have measured the droppable rects (the app's coordinate getter ignores
// arrows until the target column's rect exists) and attached the sensor's keydown listener in a
// setTimeout(0). The origin column turns "over" (bg-forest-tint) only after the rects are measured, and
// a timer queued after that runs after the sensor's own (equal-delay timers run in order).
// Before the dropping Space: the arrow's move renders asynchronously (the sensor listens natively), and
// the drop uses the last rendered `over`, so wait until the target column is the one that is over.
function kanbanColumn(page: Page, status: ApplicationInput["status"]) {
  return page.locator(`[data-board-status="${status}"]`);
}

async function waitForKanbanKeyboardDrag(page: Page, originStatus: ApplicationInput["status"]) {
  await expect(kanbanColumn(page, originStatus)).toHaveClass(/(^|\s)bg-forest-tint(\s|$)/);
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

function customBoards(): BoardConfiguration[] {
  const byStatus = new Map(DEFAULT_BOARDS.map((board) => [board.status, board]));
  return [
    byStatus.get("OFFER")!,
    byStatus.get("APPLIED")!,
    byStatus.get("INTERVIEW")!,
    { ...byStatus.get("ONLINE_ASSESSMENT")!, label: "Screening", color: "rose" },
    byStatus.get("REJECTED")!,
  ];
}

test("A11Y-001: a board card exposes one real button, keeps its heading and link outside it, and describes its dates", async ({ page, request }) => {
  const application = await createApplication(request, {
    status: "INTERVIEW",
    interviewDate: "2026-10-02",
    jobUrl: "https://example.com/jobs/1",
  });
  await openJobBoard(page);

  const card = boardCard(page, application);
  await expect(card).toBeVisible();
  expect(await card.evaluate((element) => element.tagName)).toBe("BUTTON");
  await expect(page.locator('button a, [role="button"] a, button h1, button h2, button h3, button h4, [role="button"] h4')).toHaveCount(0);
  await expect(page.locator('[role="button"]:not(button)')).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 4, name: application.role, exact: true })).toBeVisible();

  const link = page.getByRole("link", { name: "Open job posting in a new tab" });
  await expect(link).toBeVisible();
  expect(await link.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest("a") === element;
  })).toBe(true);

  const description = await card.evaluate((element) => (element.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
    .join(" | "));
  expect(description).toMatch(/Applied \S+/);
  expect(description).toMatch(/Interview \S+/);
  expect(description).toContain("Press Space to pick up");

  const title = page.getByRole("heading", { level: 4, name: application.role, exact: true });
  const titleBox = await title.boundingBox();
  if (!titleBox) throw new Error("Missing card title geometry");
  const titleCenter = { x: titleBox.x + titleBox.width / 2, y: titleBox.y + titleBox.height / 2 };
  expect(await card.evaluate((element, point) => document.elementFromPoint(point.x, point.y) === element, titleCenter)).toBe(true);
  await page.mouse.click(titleCenter.x, titleCenter.y);
  const editDialog = page.getByRole("dialog", { name: "Edit job" });
  await expect(editDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(editDialog).toHaveCount(0);
  await expect(card).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(editDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeFocused();
});

test("A11Y-001: keyboard drag, Alt+A archive, and arrow focus still work from the card button", async ({ page, request }) => {
  const applied = await createApplication(request, { status: "APPLIED" });
  const offer = await createApplication(request, { status: "OFFER" });
  await openJobBoard(page);

  const card = boardCard(page, applied);
  await card.focus();
  const moved = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${applied.id}`),
  );
  await page.keyboard.press("Space");
  await expect(card).toHaveAttribute("aria-pressed", "true");
  await waitForKanbanKeyboardDrag(page, "APPLIED");
  await page.keyboard.press("ArrowRight");
  await expect(kanbanColumn(page, "ONLINE_ASSESSMENT")).toHaveClass(/(^|\s)bg-forest-tint(\s|$)/);
  await page.keyboard.press("Space");
  const response = await moved;
  expect(response.status()).toBe(200);
  expect((await response.json()).application.status).toBe("ONLINE_ASSESSMENT");

  const assessmentColumn = page.locator('[data-board-status="ONLINE_ASSESSMENT"]');
  await expect(assessmentColumn.getByRole("button", { name: `Edit or move ${applied.role} at ${applied.company}`, exact: true })).toBeFocused();
  await page.waitForTimeout(300);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  await expect(boardCard(page, offer)).toBeFocused();

  const archived = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${offer.id}`),
  );
  await page.keyboard.press("Alt+a");
  expect((await (await archived).json()).application.archived).toBe(true);
  await expect(boardCard(page, offer)).toHaveCount(0);
});

test("A11Y-001: sidebar and archived rows do not promise keyboard archive or move, and pointer drag still works", async ({ page, request }) => {
  await resetSettings(request, { archivedExpanded: true });
  const active = await createApplication(request, { status: "APPLIED" });
  const archived = await createApplication(request, { status: "APPLIED" });
  const archiveResponse = await request.patch(`/api/applications/${archived.id}`, {
    data: { revision: archived.revision, archived: true },
    headers: sameOriginMutationHeaders,
  });
  expect(archiveResponse.status()).toBe(200);
  await openJobBoard(page);

  await expect(page.getByRole("button", { name: /^Edit or archive / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit or move archived / })).toHaveCount(0);
  const row = page.getByRole("button", { name: `Edit ${active.role} at ${active.company}`, exact: true });
  const archivedRow = page.getByRole("button", { name: `Edit archived ${archived.role} at ${archived.company}`, exact: true });
  await expect(row).toBeVisible();
  await expect(archivedRow).toBeVisible();

  for (const control of [row, archivedRow]) {
    for (const key of ["Enter", "Space"]) {
      await control.focus();
      await page.keyboard.press(key);
      const editDialog = page.getByRole("dialog", { name: "Edit job" });
      await expect(editDialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(editDialog).toHaveCount(0);
      await expect(control).toBeFocused();
    }
  }

  async function drag(from: { x: number; y: number }, to: { x: number; y: number }) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 12, from.y, { steps: 3 });
    await expect(page.locator("body")).toHaveClass(/nook-dragging/);
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
  }
  function center(box: { x: number; y: number; width: number; height: number } | null) {
    if (!box) throw new Error("Missing drag geometry");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  const archivedByDrag = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${active.id}`),
  );
  await drag(center(await row.boundingBox()), center(await page.getByRole("button", { name: /^Archived\s+\d+$/ }).boundingBox()));
  expect((await (await archivedByDrag).json()).application.archived).toBe(true);

  const restoredByDrag = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${archived.id}`),
  );
  await drag(center(await archivedRow.boundingBox()), center(await page.locator('[data-board-status="APPLIED"]').boundingBox()));
  const restored = await (await restoredByDrag).json();
  expect(restored.application.archived).toBe(false);
  expect(restored.application.status).toBe("APPLIED");
  await expect(boardCard(page, archived)).toBeVisible();
});

test("A11Y-007: board reorder announcements use board names, not internal IDs", async ({ page, request }) => {
  await resetSettings(request, { boards: DEFAULT_BOARDS.map((board) => board.status === "APPLIED" ? { ...board, label: "Sent" } : board) });
  await openJobBoard(page);
  await page.getByRole("button", { name: "Settings" }).click();
  const settingsDialog = page.getByRole("dialog", { name: "Settings" });
  await settingsDialog.getByRole("button", { name: "Board", exact: true }).click();
  const reorder = settingsDialog.getByRole("button", { name: "Reorder Sent board" });
  const liveRegions = page.locator('[id^="DndLiveRegion-"]');

  await reorder.focus();
  await page.keyboard.press("Space");
  await expect(reorder).toHaveAttribute("aria-pressed", "true");
  await waitForKeyboardSensor(page);
  await expect(liveRegions.filter({ hasText: "Picked up" })).toHaveText("Picked up Sent board. It is in position 1 of 5.");
  await page.keyboard.press("ArrowDown");
  await expect(liveRegions.filter({ hasText: "Sent board is over" })).toHaveText("Sent board is over Online assessment, position 2 of 5.");
  await page.keyboard.press("Space");
  await expect(liveRegions.filter({ hasText: "Sent board was moved" })).toHaveText("Sent board was moved to position 2 of 5.");
  await expect.poll(async () => (await readSettings(request)).boards.map((board) => board.status).slice(0, 2)).toEqual(["ONLINE_ASSESSMENT", "APPLIED"]);

  await reorder.focus();
  await page.keyboard.press("Space");
  await expect(reorder).toHaveAttribute("aria-pressed", "true");
  await waitForKeyboardSensor(page);
  await page.keyboard.press("Escape");
  await expect(liveRegions.filter({ hasText: "Reordering canceled" })).toHaveText("Reordering canceled. Sent board stays in position 2 of 5.");
  await expect(settingsDialog).toBeVisible();
  for (const region of await liveRegions.all()) await expect(region).not.toContainText(/reorder:|APPLIED|ONLINE_ASSESSMENT/);
});

test("A11Y-006: landmarks, the Job Board h1, metric labels, and link and heading counts", async ({ page, request }) => {
  await createApplication(request, { status: "INTERVIEW", interviewDate: localDateKey() });
  await openJobBoard(page);

  const main = page.getByRole("main");
  await expect(main).toHaveCount(1);
  await expect(main.getByRole("navigation")).toHaveCount(0);
  await expect(main.getByRole("complementary")).toHaveCount(0);
  await expect(main.getByRole("heading", { level: 1, name: "Job Board", exact: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 2, name: "All applications 1", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Interviews, 1 upcoming", exact: true })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByRole("main").getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText("Total Applications", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Total Applications" })).toHaveCount(0);
  await expect(page.getByText("Active Pipeline", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active Pipeline" })).toHaveCount(0);

  await page.goto("/dashboard/analytics");
  await expect(page.getByText("Interview Rate", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Interview Rate" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: "Status Breakdown" })).toBeVisible();
});

test("A11Y-002: Interviews tabs use roving tabindex and arrows only on the tablist", async ({ page, request }) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  await createApplication(request, { status: "INTERVIEW", interviewDate: localDateKey(yesterday) });
  await page.goto("/interviews");

  const upcoming = page.getByRole("tab", { name: "Upcoming" });
  const past = page.getByRole("tab", { name: "Past" });
  const search = page.getByRole("searchbox", { name: "Search by company or role" });
  await expect(upcoming).toHaveAttribute("tabindex", "0");
  await expect(past).toHaveAttribute("tabindex", "-1");

  await upcoming.focus();
  await page.keyboard.press("Tab");
  await expect(search).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(upcoming).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expect(past).toBeFocused();
  await expect(past).toHaveAttribute("aria-selected", "true");
  await expect(past).toHaveAttribute("tabindex", "0");
  await expect(upcoming).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowRight");
  await expect(upcoming).toBeFocused();
  await expect(upcoming).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(past).toBeFocused();
  await page.keyboard.press("Home");
  await expect(upcoming).toBeFocused();
  await page.keyboard.press("End");
  await expect(past).toBeFocused();
  await expect(past).toHaveAttribute("aria-selected", "true");

  const sort = page.getByRole("button", { name: /^Sort past interviews/ });
  await sort.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await expect(past).toHaveAttribute("aria-selected", "true");
  await expect(sort).toBeFocused();

  await sort.evaluate((element) => (element as HTMLElement).blur());
  await page.keyboard.press("ArrowLeft");
  await expect(past).toHaveAttribute("aria-selected", "true");
});

test("BIZ-002: Analytics, Stale, and the job form follow custom board names, colors, and order", async ({ page, request }) => {
  const boards = customBoards();
  await resetSettings(request, { boards });
  const application = await createApplication(request, { status: "ONLINE_ASSESSMENT", appliedDate: localDateKey() });

  await page.goto("/dashboard/analytics");
  const breakdown = page.getByRole("region", { name: "Status Breakdown" });
  const screening = breakdown.getByRole("listitem").filter({ hasText: "Screening" });
  await expect(screening).toHaveCount(1);
  await expect(screening.locator(".bg-rose")).toHaveCount(1);
  await expect(breakdown).not.toContainText(/Online assessment/i);

  await page.goto("/jobs");
  await page.getByRole("button", { name: "Add job", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add a job" });
  await expect(addDialog.getByLabel("Status").locator("option")).toHaveText(boards.map((board) => board.label));
  await page.keyboard.press("Escape");
  await expect(addDialog).toHaveCount(0);

  await page.clock.setFixedTime(new Date(Date.now() + 20 * 24 * 60 * 60 * 1000));
  await page.goto("/dashboard/stale");
  const row = page.getByRole("listitem").filter({ hasText: application.company });
  await expect(row).toContainText("Screening");
  await expect(row).not.toContainText(/Online assessment/i);
});
