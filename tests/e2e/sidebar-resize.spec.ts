import { type Page } from "@playwright/test";
import { expect, test } from "./api-helpers";

async function startDrag(page: Page) {
  const handle = await page.getByRole("separator", { name: "Resize sidebar" }).boundingBox();
  expect(handle).not.toBeNull();
  await page.mouse.move(handle!.x + handle!.width / 2, 300);
  await page.mouse.down();
}

async function startRailDrag(page: Page) {
  const rail = await page.locator(".sidebar-edge-rail").boundingBox();
  expect(rail).not.toBeNull();
  await page.mouse.move(rail!.x + rail!.width / 2, 300);
  await page.mouse.down();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.removeItem("nook-sidebar-width"));
  await page.goto("/jobs");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: ".app-workspace { transition: none !important; }" });
});

test("shows the whole motto at the minimum width", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("nook-sidebar-width", "294");
    window.dispatchEvent(new Event("nook-sidebar-width-change"));
  });
  await expect.poll(() => page.locator(".sidebar-panel").evaluate((panel) => panel.getBoundingClientRect().width)).toBe(294);
  const motto = page.locator(".sidebar-panel").getByText("your job search, kept tidy", { exact: true });
  await expect(motto).toBeVisible();
  expect(await motto.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
});

test("clamps near the minimum, collapses only below 180px, and restores saved width", async ({ page }) => {
  const panel = page.locator(".sidebar-panel");
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  await expect(panel).toHaveCSS("width", "320px");

  await startDrag(page);
  await page.mouse.move(190, 300);
  await expect(panel).toHaveCSS("width", "294px");
  await page.mouse.up();
  await expect(page.locator(".app-workspace")).toHaveClass(/sidebar-expanded/);
  expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-width"))).toBe("294");

  await startDrag(page);
  await page.mouse.move(170, 300);
  await expect(panel).toHaveCSS("width", "294px");
  await page.mouse.up();
  await expect(panel).toHaveCSS("width", "53px");
  await expect(handle).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-width"))).toBe("294");

  await startRailDrag(page);
  await page.mouse.move(90, 300);
  await page.mouse.up();
  await expect(panel).toHaveCSS("width", "294px");
  await expect(handle).toBeVisible();

  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel).toHaveCSS("width", "304px");
  await page.keyboard.press("ArrowLeft");
  await expect(panel).toHaveCSS("width", "294px");
  await page.keyboard.press("ArrowLeft");
  await expect(panel).toHaveCSS("width", "294px");
  await expect(page.locator(".app-workspace")).toHaveClass(/sidebar-expanded/);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(handle).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(handle).toBeVisible();
});
