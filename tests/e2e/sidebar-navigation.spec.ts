import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("nook-sidebar-navigation-test-initialized")) return;
    localStorage.removeItem("nook-sidebar-collapsed");
    localStorage.removeItem("nook-archived-expanded");
    sessionStorage.setItem("nook-sidebar-navigation-test-initialized", "true");
  });
});

test("shows ordered sidebar destinations, marks the active route, and opens Settings in place", async ({ page }) => {
  await page.goto("/dashboard");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const links = navigation.getByRole("link");
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toHaveAccessibleName("Dashboard");
  await expect(links.nth(1)).toHaveAccessibleName("Job Board");
  await expect(links.nth(2)).toHaveAccessibleName("Interviews");
  await expect(links.nth(0)).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

  await navigation.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard$/);
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(settings).toBeHidden();
  await expect(navigation.getByRole("button", { name: "Settings", exact: true })).toBeFocused();

  await navigation.getByRole("link", { name: "Job Board", exact: true }).click();
  await expect(page).toHaveURL(/\/jobs$/);
  await expect(navigation.getByRole("link", { name: "Job Board", exact: true })).toHaveAttribute("aria-current", "page");

  await navigation.getByRole("link", { name: "Interviews", exact: true }).click();
  await expect(page).toHaveURL(/\/interviews$/);
  await expect(navigation.getByRole("link", { name: "Interviews", exact: true })).toHaveAttribute("aria-current", "page");

  await navigation.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(navigation.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
});

test("toggles the sidebar by keyboard and mouse, changes the N control on hover or focus, and restores its preference", async ({ page }) => {
  await page.goto("/jobs");

  const addJob = page.getByRole("button", { name: "Add job", exact: true });
  const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
  await page.keyboard.press("Tab");
  await expect(addJob).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(collapse).toBeFocused();
  await page.keyboard.press("Enter");

  const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
  const logo = page.locator(".sidebar-logo-mark");
  const expandIcon = page.locator(".sidebar-expand-mark");
  await expect(expand).toBeFocused();
  await expect(logo).toHaveCSS("opacity", "0");
  await expect(expandIcon).toHaveCSS("opacity", "1");
  expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-collapsed"))).toBe("true");

  await page.keyboard.press("Enter");
  await expect(collapse).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-collapsed"))).toBe("false");

  await collapse.click();
  await expect(expand).toBeFocused();
  await page.mouse.move(500, 500);
  await expand.evaluate((button: HTMLButtonElement) => button.blur());
  await expect(logo).toHaveCSS("opacity", "1");
  await expand.hover();
  await expect(logo).toHaveCSS("opacity", "0");
  await expect(expandIcon).toHaveCSS("opacity", "1");
  await expand.click();
  await expect(collapse).toBeFocused();

  await collapse.click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-collapsed"))).toBe("true");
  await page.mouse.move(500, 500);
  await expect(page.locator(".sidebar-logo-mark")).toHaveCSS("opacity", "1");
});
