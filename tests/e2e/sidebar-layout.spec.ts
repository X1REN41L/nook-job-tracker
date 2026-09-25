import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("nook-sidebar-collapsed"));
});

test("keeps the expanded sidebar and collapsed rail on the left at desktop and mobile widths", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.addStyleTag({ content: ".app-workspace, .sidebar-panel, .sidebar-content, .sidebar-edge-tab { transition-duration: 0s !important; transition-delay: 0s !important; }" });

  const sidebar = page.locator(".sidebar-panel");
  const board = page.locator(".board-scroll");
  const branding = sidebar.getByText("Nook", { exact: true });

  await expect(board).toBeVisible();
  await expect(branding).toBeVisible();
  await expect(sidebar.getByText("your job search, kept tidy", { exact: true })).toBeVisible();
  await expect(page.locator("header").getByText("Nook", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add job" })).toBeVisible();

  const desktopExpanded = await page.evaluate(() => ({
    sidebarLeft: Math.round(document.querySelector(".sidebar-panel")!.getBoundingClientRect().left),
    sidebarRight: Math.round(document.querySelector(".sidebar-panel")!.getBoundingClientRect().right),
    boardLeft: Math.round(document.querySelector(".board-scroll")!.getBoundingClientRect().left),
  }));
  expect(desktopExpanded).toEqual({ sidebarLeft: 0, sidebarRight: 320, boardLeft: 320 });

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(branding).toBeHidden();
  const desktopCollapsed = await page.evaluate(() => ({
    sidebarWidth: Math.round(document.querySelector(".sidebar-panel")!.getBoundingClientRect().width),
    boardLeft: Math.round(document.querySelector(".board-scroll")!.getBoundingClientRect().left),
  }));
  expect(desktopCollapsed).toEqual({ sidebarWidth: 45, boardLeft: 45 });
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(branding).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });

  const mobileExpanded = await page.evaluate(() => ({
    sidebarLeft: Math.round(document.querySelector(".sidebar-panel")!.getBoundingClientRect().left),
    sidebarRight: Math.round(document.querySelector(".sidebar-panel")!.getBoundingClientRect().right),
    boardLeft: Math.round(document.querySelector(".board-scroll")!.getBoundingClientRect().left),
  }));
  expect(mobileExpanded).toEqual({ sidebarLeft: 0, sidebarRight: 320, boardLeft: 0 });
  await expect(branding).toBeVisible();

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(branding).toBeHidden();
  const mobileCollapsed = await page.evaluate(() => ({
    sidebarLeft: Math.round(document.querySelector(".sidebar-panel")!.getBoundingClientRect().left),
    sidebarRight: Math.round(document.querySelector(".sidebar-panel")!.getBoundingClientRect().right),
    boardLeft: Math.round(document.querySelector(".board-scroll")!.getBoundingClientRect().left),
  }));
  expect(mobileCollapsed).toEqual({ sidebarLeft: -275, sidebarRight: 45, boardLeft: 45 });
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add job" })).toBeVisible();
});
