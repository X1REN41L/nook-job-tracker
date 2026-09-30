import { type Locator } from "@playwright/test";
import { expect, test } from "./api-helpers";

async function readSections(container: Locator) {
  return container.locator("section[aria-label]").evaluateAll((sections) => sections.map((section) => ({
    heading: section.querySelector("h3")?.textContent?.trim(),
    rows: Array.from(section.querySelectorAll("li")).map((row) => ({
      action: row.querySelector(":scope > span:first-child")?.textContent?.trim(),
      keys: row.querySelector("kbd > .sr-only")?.textContent?.trim(),
    })),
  })));
}

test("both shortcut panels show the same complete four sections on every route", async ({ page }) => {
  const isMac = process.platform === "darwin";
  const expected = [
    { heading: "General", rows: [
      { action: "Command palette", keys: isMac ? "⌘K" : "Ctrl+K" },
      { action: "Search this page", keys: "/" },
      { action: "New job", keys: "N" },
      { action: "Edit open application", keys: "E" },
      { action: "Undo", keys: isMac ? "⌘Z" : "Ctrl+Z" },
      { action: "Close", keys: "Esc" },
      { action: "Toggle sidebar", keys: isMac ? "⌘⇧S" : "Ctrl+Shift+S" },
      { action: "Settings", keys: isMac ? "⌘⇧," : "Ctrl+Shift+," },
      { action: "Keyboard shortcuts", keys: "?" },
    ] },
    { heading: "Go to", rows: [
      { action: "Dashboard", keys: "G then D" },
      { action: "Analytics", keys: "G then A" },
      { action: "Job Board", keys: "G then J" },
      { action: "Table", keys: "G then T" },
      { action: "Interviews", keys: "G then I" },
    ] },
    { heading: "Job Board", rows: [
      { action: "Move between cards", keys: "↑ ↓ ← →" },
      { action: "Open card", keys: isMac ? "↩" : "Enter" },
      { action: "Pick up or drop card", keys: "Space" },
      { action: "Archive card", keys: "E" },
      { action: "Delete card", keys: isMac ? "Del or ⌫" : "Del or Backspace" },
    ] },
    { heading: "Interviews", rows: [
      { action: "Upcoming / Past", keys: "← →" },
    ] },
  ];

  await page.setViewportSize({ width: 1366, height: 768 });
  for (const route of ["/dashboard", "/jobs", "/table", "/interviews"]) {
    await page.goto(route);
    await page.keyboard.press("?");
    const overlay = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(overlay).toBeVisible();
    expect(await readSections(overlay)).toEqual(expected);
    await expectRowsAligned(overlay);
    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);

    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await settings.getByRole("button", { name: "Shortcuts" }).click();
    expect(await readSections(settings)).toEqual(expected);
    await expectRowsAligned(settings);
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
  }
});

async function expectRowsAligned(container: Locator) {
  const rows = await container.locator("section[aria-label] li").evaluateAll((elements) => elements.map((row) => {
    const label = row.querySelector(":scope > span:first-child")!.getBoundingClientRect();
    const key = row.querySelector(":scope > kbd")!.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    return {
      childCount: row.children.length,
      labelRight: label.right,
      keyLeft: key.left,
      keyRight: key.right,
      rowRight: bounds.right,
      verticalCentersApart: Math.abs((label.top + label.bottom) / 2 - (key.top + key.bottom) / 2),
    };
  }));
  expect(rows).toHaveLength(20);
  for (const row of rows) {
    expect(row.childCount).toBe(2);
    expect(row.labelRight).toBeLessThan(row.keyLeft);
    expect(row.keyRight).toBeLessThanOrEqual(row.rowRight + 1);
    expect(row.verticalCentersApart).toBeLessThan(2);
  }
}
