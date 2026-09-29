import { expect, readSettings, test } from "./api-helpers";

test("shows ordered sidebar destinations, marks the active route, and opens Settings in place", async ({ page }) => {
  await page.goto("/dashboard");

  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const links = navigation.getByRole("link");
  await expect(links).toHaveCount(4);
  await expect(links.nth(0)).toHaveAccessibleName("Dashboard");
  await expect(links.nth(1)).toHaveAccessibleName("Job Board");
  await expect(links.nth(2)).toHaveAccessibleName("Applications Table");
  await expect(links.nth(3)).toHaveAccessibleName("Interviews, 0 upcoming");
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

  await navigation.getByRole("link", { name: "Interviews, 0 upcoming", exact: true }).click();
  await expect(page).toHaveURL(/\/interviews$/);
  await expect(navigation.getByRole("link", { name: "Interviews, 0 upcoming", exact: true })).toHaveAttribute("aria-current", "page");

  await navigation.getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(navigation.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");
});

test("toggles the sidebar by keyboard and mouse, changes the N control on hover or focus, and restores its preference", async ({ page, request }) => {
  await page.goto("/jobs");

  const addJob = page.getByRole("button", { name: "Add job", exact: true });
  const collapse = page.getByRole("button", { name: "Collapse sidebar", exact: true });
  await page.keyboard.press("Tab");
  await expect(addJob).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("separator", { name: "Resize sidebar" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(collapse).toBeFocused();
  await page.keyboard.press("Enter");

  const expand = page.getByRole("button", { name: "Expand sidebar", exact: true });
  const logo = page.locator(".sidebar-brand-initial");
  await expect(expand).toBeFocused();
  await expect(logo).toHaveCSS("opacity", "0");
  await expect(expand).toHaveCSS("opacity", "1");
  await expect.poll(async () => (await readSettings(request)).sidebarCollapsed).toBe(true);

  await page.keyboard.press("Enter");
  await expect(collapse).toBeFocused();
  await expect.poll(async () => (await readSettings(request)).sidebarCollapsed).toBe(false);

  await collapse.click();
  await expect(expand).toBeFocused();
  await page.mouse.move(500, 500);
  await expand.evaluate((button: HTMLButtonElement) => button.blur());
  await expect(logo).toHaveCSS("opacity", "1");
  await expand.hover();
  await expect(logo).toHaveCSS("opacity", "0");
  await expect(expand).toHaveCSS("opacity", "1");
  await expand.click();
  await expect(collapse).toBeFocused();

  // Toggles save one PATCH at a time, so this one can wait behind the Expand save above. Reloading before
  // it completes would abort it, and polling GET can read the value from before the in-flight write.
  const collapsedSaved = page.waitForResponse((response) => response.request().method() === "PATCH"
    && new URL(response.url()).pathname === "/api/settings"
    && response.request().postDataJSON()?.changes?.sidebarCollapsed === true);
  await collapse.click();
  expect((await collapsedSaved).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("button", { name: "Expand sidebar", exact: true })).toBeVisible();
  await expect.poll(async () => (await readSettings(request)).sidebarCollapsed).toBe(true);
  await page.mouse.move(500, 500);
  await expect(page.locator(".sidebar-brand-initial")).toHaveCSS("opacity", "1");
});
