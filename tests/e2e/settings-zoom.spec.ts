import { expect, test } from "@playwright/test";

const zoomLevels = [0.75, 0.9, 1, 1.1, 1.25];

test("compact Settings text stays on one line through browser zoom scaling", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.evaluate(() => document.fonts.ready);

  const dialog = page.getByRole("dialog", { name: "Settings" });
  const categories = ["General", "Board", "Shortcuts", "Backup & Restore"];
  const wrapped: string[] = [];

  for (const zoom of zoomLevels) {
    await page.evaluate((value) => { document.documentElement.style.zoom = String(value); }, zoom);

    for (const category of categories) {
      const categoryButton = dialog.getByRole("button", { name: category, exact: true });
      await categoryButton.evaluate((button: HTMLButtonElement) => button.click());
      await expect(categoryButton).toHaveAttribute("aria-current", "page");
      const labels = await dialog.evaluate((element) => {
        const nav = element.querySelector('nav[aria-label="Settings categories"]');
        const content = nav?.nextElementSibling;
        const candidates = [
          ...Array.from(nav?.querySelectorAll("button span") ?? []),
          ...Array.from(content?.querySelectorAll("h3, label, kbd, button, .truncate") ?? []),
        ];

        return candidates.flatMap((candidate) => {
          const text = candidate.textContent?.trim();
          if (!text || candidate.querySelector("button, kbd, .truncate")) return [];
          const walker = document.createTreeWalker(candidate, NodeFilter.SHOW_TEXT);
          const lineTops = new Set<number>();
          while (walker.nextNode()) {
            if (!walker.currentNode.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            for (const rect of Array.from(range.getClientRects())) lineTops.add(Math.round(rect.top * 100) / 100);
          }
          return [{ text, lines: lineTops.size }];
        });
      });

      for (const { text, lines } of labels) {
        if (lines > 1) wrapped.push(`${Math.round(zoom * 100)}% ${category}: ${text} (${lines} lines)`);
      }
    }
  }

  expect(wrapped).toEqual([]);
});
