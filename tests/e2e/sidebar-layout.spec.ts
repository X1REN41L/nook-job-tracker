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

test("keeps navigation and brand icons the same size and height when the sidebar collapses", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await page.addStyleTag({ content: ".app-workspace, .sidebar-panel, .sidebar-content, .sidebar-edge-tab { transition-duration: 0s !important; transition-delay: 0s !important; }" });

  const geometry = () => page.evaluate(() => {
    const navigation = [...document.querySelectorAll<HTMLElement>('.sidebar-panel nav[aria-label="Main navigation"]')]
      .find((element) => getComputedStyle(element).visibility === "visible");
    if (!navigation) throw new Error("Main navigation is missing");
    const items = [...navigation.querySelectorAll<HTMLElement>("a, button")];
    const rect = (element: Element) => element.getBoundingClientRect();
    const dimensions = (element: Element) => ({ width: rect(element).width, height: rect(element).height });
    const center = (element: Element) => ({ x: rect(element).x + rect(element).width / 2, y: rect(element).y + rect(element).height / 2 });
    return {
      items: items.map((item) => {
        const icon = item.querySelector("svg")!;
        const container = icon.parentElement!;
        return { button: dimensions(item), icon: dimensions(icon), container: dimensions(container), iconCenter: center(icon), containerCenter: center(container), buttonCenter: center(item) };
      }),
      logo: dimensions(document.querySelector(".sidebar-collapsed .sidebar-logo-mark, .sidebar-brand-row > span")!),
      toggleIcon: dimensions(document.querySelector(".sidebar-collapsed .sidebar-expand-mark svg, .sidebar-brand-row button svg")!),
    };
  });

  const expanded = await geometry();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  const collapsed = await geometry();

  expect(expanded.items).toHaveLength(4);
  expect(collapsed.items).toHaveLength(4);
  for (let index = 0; index < 4; index++) {
    const before = expanded.items[index];
    const after = collapsed.items[index];
    expect(before.icon).toEqual({ width: 16, height: 16 });
    expect(after.icon).toEqual(before.icon);
    expect(before.container).toEqual({ width: 20, height: 20 });
    expect(after.container).toEqual(before.container);
    expect(before.iconCenter).toEqual(before.containerCenter);
    expect(after.iconCenter).toEqual(after.containerCenter);
    expect(after.containerCenter).toEqual(after.buttonCenter);
    expect(after.button).toEqual({ width: 36, height: 36 });
    expect(after.iconCenter.y).toBe(before.iconCenter.y);
  }
  expect(new Set(expanded.items.map((item) => item.iconCenter.x)).size).toBe(1);
  expect(new Set(collapsed.items.map((item) => item.iconCenter.x)).size).toBe(1);
  expect(expanded.logo).toEqual(collapsed.logo);
  expect(expanded.toggleIcon).toEqual(collapsed.toggleIcon);
});
