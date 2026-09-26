import { expect, test, type Page } from "@playwright/test";

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
  await page.addInitScript(() => {
    localStorage.removeItem("nook-sidebar-collapsed");
    localStorage.removeItem("nook-sidebar-width");
    localStorage.removeItem("nook-board-configuration");
  });
  await page.goto("/jobs");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: ".app-workspace { transition: none !important; }" });
});

test("keeps the first three filter pills on one row at the measured minimum", async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem("nook-sidebar-width", "304");
    window.dispatchEvent(new Event("nook-sidebar-change"));
  });
  await expect.poll(() => page.locator(".sidebar-panel").evaluate((panel) => panel.getBoundingClientRect().width)).toBe(304);

  const narrow = await page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLButtonElement>(".sidebar-panel button")]
      .find((button) => button.textContent?.trim() === "All")!;
    const pills = [...all.parentElement!.querySelectorAll<HTMLButtonElement>(":scope > button")];
    return pills.map((pill) => ({
      top: pill.getBoundingClientRect().top,
      height: pill.getBoundingClientRect().height,
      overflow: pill.scrollWidth > pill.clientWidth,
    }));
  });
  expect(narrow.slice(0, 3).map((pill) => pill.top)).toEqual([narrow[0].top, narrow[0].top, narrow[0].top]);
  expect(narrow.slice(0, 3).every((pill) => !pill.overflow)).toBe(true);
  expect(narrow[3].top).toBeGreaterThan(narrow[0].top);

  await page.evaluate(() => {
    localStorage.setItem("nook-sidebar-width", "420");
    window.dispatchEvent(new Event("nook-sidebar-change"));
  });
  await expect.poll(() => page.locator(".sidebar-panel").evaluate((panel) => panel.getBoundingClientRect().width)).toBe(420);
  const wideTops = await page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLButtonElement>(".sidebar-panel button")]
      .find((button) => button.textContent?.trim() === "All")!;
    return [...all.parentElement!.querySelectorAll<HTMLButtonElement>(":scope > button")]
      .map((pill) => pill.getBoundingClientRect().top);
  });
  expect(wideTops.slice(0, 4)).toEqual([wideTops[0], wideTops[0], wideTops[0], wideTops[0]]);
  expect(wideTops[4]).toBeGreaterThan(wideTops[0]);
});

test("clamps near the minimum, collapses only below 180px, and restores saved width", async ({ page }) => {
  const panel = page.locator(".sidebar-panel");
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  await expect(panel).toHaveCSS("width", "320px");

  await startDrag(page);
  await page.mouse.move(190, 300);
  await expect(panel).toHaveCSS("width", "304px");
  await page.mouse.up();
  await expect(page.locator(".app-workspace")).toHaveClass(/sidebar-expanded/);
  expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-width"))).toBe("304");

  await startDrag(page);
  await page.mouse.move(170, 300);
  await expect(panel).toHaveCSS("width", "304px");
  await page.mouse.up();
  await expect(panel).toHaveCSS("width", "50px");
  await expect(handle).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("nook-sidebar-width"))).toBe("304");

  await startRailDrag(page);
  await page.mouse.move(90, 300);
  await page.mouse.up();
  await expect(panel).toHaveCSS("width", "304px");
  await expect(handle).toBeVisible();

  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel).toHaveCSS("width", "314px");
  await page.keyboard.press("ArrowLeft");
  await expect(panel).toHaveCSS("width", "304px");
  await page.keyboard.press("ArrowLeft");
  await expect(panel).toHaveCSS("width", "304px");
  await expect(page.locator(".app-workspace")).toHaveClass(/sidebar-expanded/);

  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(handle).toHaveCount(0);
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(handle).toBeVisible();
});
