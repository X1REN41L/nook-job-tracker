import { randomUUID } from "node:crypto";
import { type APIRequestContext } from "@playwright/test";


import { deleteApplication, expect, gotoReady, readSettings, resetSettings, test, sameOriginMutationHeaders } from "./api-helpers";

const ownedIds: string[] = [];

test.beforeEach(async ({ request }) => {
  ownedIds.length = 0;
  await resetSettings(request, { archivedExpanded: true });
});

test.afterEach(async ({ request }) => {
  await Promise.all(ownedIds.map((id) => deleteApplication(request, id)));
});

async function createApplication(request: APIRequestContext, status = "APPLIED") {
  const id = randomUUID();
  const response = await request.post("/api/applications", {
    data: {
      company: `Sidebar interaction ${id}`,
      role: "Left edge drag role",
      status,
      appliedDate: "2026-09-22",
    },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  const application = (await response.json()).application as { id: string; company: string; role: string };
  ownedIds.push(application.id);
  return application;
}

test("archives board cards dropped anywhere on the collapsed sidebar from every column", async ({ page, request }) => {
  const statuses = ["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"];
  const applications: Awaited<ReturnType<typeof createApplication>>[] = [];
  for (const status of statuses) applications.push(await createApplication(request, status));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/jobs");
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  expect((await readSettings(request)).sidebarCollapsed).toBe(true);

  const railBox = await page.locator(".sidebar-edge-rail").boundingBox();
  if (!railBox) throw new Error("Could not locate the collapsed sidebar rail");

  for (const [index, application] of applications.entries()) {
    const card = page.getByLabel(`Open or move ${application.role} at ${application.company}`, { exact: true });
    await card.scrollIntoViewIfNeeded();
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error(`Could not locate the ${statuses[index]} application card`);
    const columnIndex = await card.evaluate((element) => Array.from(document.querySelectorAll(".kanban-column")).indexOf(element.closest(".kanban-column")!));
    const count = page.locator(".kanban-column").nth(columnIndex).locator(":scope > div").first().locator("span.rounded-full").first();
    const countBefore = Number(await count.innerText());
    const targetY = railBox.y + railBox.height * ([0.2, 0.38, 0.56, 0.72, 0.9][index]);

    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(cardBox.x + cardBox.width / 2 + 12, cardBox.y + cardBox.height / 2, { steps: 3 });
    await expect(page.locator("body")).toHaveClass(/nook-dragging/);
    await page.mouse.move(railBox.x + railBox.width / 2, targetY, { steps: 10 });
    // The existing Archive button moves to the middle of the rail to take the drop; nothing new appears.
    const archiveButton = page.getByTestId("collapsed-archive-button");
    await expect(archiveButton).toHaveAttribute("data-drop-target", "true");
    await expect.poll(async () => {
      const box = await archiveButton.boundingBox();
      return box ? Math.round(box.y + box.height / 2 - (railBox.y + railBox.height / 2)) : null;
    }).toBe(0);

    const archivedResponse = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${application.id}`),
    );
    await page.mouse.up();
    const archived = await archivedResponse;
    expect(archived.status()).toBe(200);
    expect((await archived.json()).application.archived).toBe(true);
    await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
    await expect(page.locator(`[data-kanban-card-id="${application.id}"]`)).toHaveCount(0);
    await expect(count).toHaveText(String(countBefore - 1));
    await expect(page.getByRole("button", { name: `Open Archive, ${index + 1} archived`, exact: true })).toBeVisible();
    await expect(page.locator(".nook-toast-wrap")).toContainText(`Archived ${application.company}`);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  expect((await readSettings(request)).sidebarCollapsed).toBe(true);
});

test("archives a focused application and restores it from Archive", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.goto("/jobs");
  const card = page.getByLabel(`Open or move ${application.role} at ${application.company}`, { exact: true });
  await card.focus();
  const archivedResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${application.id}`),
  );
  await page.keyboard.press("e");
  const archived = await archivedResponse;
  expect(archived.status()).toBe(200);
  expect((await archived.json()).application.archived).toBe(true);

  const archiveToggle = page.getByRole("button", { name: "Archived 1", exact: true });
  await expect(archiveToggle).toHaveAttribute("aria-expanded", "true");
  const archivedRow = page.getByRole("button", { name: `Open archived ${application.role} at ${application.company}`, exact: true });
  await expect(archivedRow).toBeVisible();
  const restoredResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${application.id}`),
  );
  await page.locator(`[data-application-id="${application.id}"]`).getByRole("button", { name: "Restore", exact: true }).click();
  const restored = await restoredResponse;
  expect(restored.status()).toBe(200);
  expect((await restored.json()).application.archived).toBe(false);
  await expect(page.getByLabel(`Open or move ${application.role} at ${application.company}`, { exact: true })).toBeVisible();
});

test("the slash shortcut focuses board search and leaves a collapsed sidebar collapsed", async ({ page, request }) => {
  await resetSettings(request, { sidebarCollapsed: true });
  await gotoReady(page, "/jobs");
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();

  await page.keyboard.press("/");

  await expect(page.getByRole("searchbox", { name: "Search company or role", exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  expect((await readSettings(request)).sidebarCollapsed).toBe(true);
});

test("server settings appear in the first sidebar and board DOM", async ({ page, request }) => {
  await resetSettings(request, { sidebarCollapsed: true, motion: "off", theme: "dark" });
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const workspace = document.querySelector(".app-workspace");
      if (!workspace || (window as typeof window & { firstNookDOM?: unknown }).firstNookDOM) return;
      (window as typeof window & { firstNookDOM?: unknown }).firstNookDOM = {
        collapsed: workspace.classList.contains("sidebar-collapsed"),
        motion: document.documentElement.dataset.motion,
        dark: document.documentElement.classList.contains("dark"),
      };
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto("/jobs");
  await expect(page.locator(".app-workspace")).toHaveClass(/sidebar-collapsed/);
  expect(await page.evaluate(() => (window as typeof window & { firstNookDOM?: unknown }).firstNookDOM)).toEqual({ collapsed: true, motion: "off", dark: true });
});

test("rapid sidebar toggles preserve the final setting and collapse restores focus", async ({ page, request }) => {
  const application = await createApplication(request);
  await page.goto("/jobs");
  await expect(page.getByRole("button", { name: `Open or move ${application.role} at ${application.company}` })).toBeVisible();
  // Focus inside the open sidebar moves to Expand sidebar when the sidebar collapses under it.
  await page.getByRole("separator", { name: "Resize sidebar" }).focus();
  await page.keyboard.press("Control+Slash");
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeFocused();
  await page.keyboard.press("Control+Slash");
  await page.keyboard.press("Control+Slash");
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect.poll(async () => (await readSettings(request)).sidebarCollapsed).toBe(true);
});
