import { expect, test, type Locator } from "@playwright/test";

async function readSections(container: Locator) {
  return container.locator("section[aria-label]").evaluateAll((sections) => sections.map((section) => ({
    heading: section.querySelector("h3")?.textContent?.trim(),
    rows: Array.from(section.querySelectorAll("li")).map((row) => ({
      action: row.querySelector(":scope > span:first-child")?.textContent?.trim(),
      keys: row.querySelector("kbd")?.textContent?.trim(),
    })),
  })));
}

test("both shortcut panels show the same complete five sections on every route", async ({ page }) => {
  const isMac = process.platform === "darwin";
  const expected = [
    { heading: "General", rows: [
      { action: "Open Settings", keys: isMac ? "⌘ ⇧ ," : "Ctrl + Shift + ," },
      { action: "Keyboard Shortcuts", keys: "?" },
      { action: "Toggle Sidebar", keys: isMac ? "⌘ ⇧ S" : "Ctrl + Shift + S" },
      { action: "Close / Cancel", keys: "Esc" },
      { action: "Undo latest action", keys: "U" },
    ] },
    { heading: "Page Navigation", rows: [
      { action: "Dashboard", keys: "G D" },
      { action: "Job Board", keys: "G J" },
      { action: "Interviews", keys: "G I" },
    ] },
    { heading: "Dashboard", rows: [
      { action: "Overview", keys: "G O" },
      { action: "Analytics", keys: "G A" },
      { action: "Stale Applications", keys: "G S" },
    ] },
    { heading: "Job Board", rows: [
      { action: "New Job", keys: isMac ? "⌥ N" : "Alt + N" },
      { action: "Search", keys: "/" },
      { action: "Archive focused card", keys: isMac ? "⌥ A" : "Alt + A" },
      { action: "Delete focused card", keys: "Delete / Backspace" },
      { action: "Previous application", keys: "↑" },
      { action: "Next application", keys: "↓" },
      { action: "Previous column", keys: "←" },
      { action: "Next column", keys: "→" },
    ] },
    { heading: "Interviews", rows: [
      { action: "Search", keys: "/" },
      { action: "Switch tabs", keys: "← / →" },
    ] },
  ];

  await page.setViewportSize({ width: 1366, height: 768 });
  for (const route of ["/dashboard", "/jobs", "/interviews"]) {
    await page.goto(route);
    await page.keyboard.press("?");
    const overlay = page.getByRole("dialog", { name: "Keyboard Shortcuts" });
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
    const key = row.querySelector("kbd")!.getBoundingClientRect();
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
  expect(rows).toHaveLength(21);
  for (const row of rows) {
    expect(row.childCount).toBe(2);
    expect(row.labelRight).toBeLessThan(row.keyLeft);
    expect(row.keyRight).toBeLessThanOrEqual(row.rowRight + 1);
    expect(row.verticalCentersApart).toBeLessThan(2);
  }
}
