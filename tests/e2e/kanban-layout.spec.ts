import { expect, test } from "@playwright/test";

test("keeps board columns readable across zoom-equivalent viewport sizes", async ({ page }) => {
  const monitorWidths = [1440, 1920, 3440, 5120];
  const zoomLevels = [0.5, 0.67, 0.8, 1, 1.5];
  const measurements: string[] = [];

  await page.addInitScript(() => localStorage.removeItem("nook-sidebar-collapsed"));
  await page.goto("/");
  await page.addStyleTag({
    content: ".app-workspace, .sidebar-panel, .sidebar-content, .sidebar-edge-tab { transition-duration: 0s !important; transition-delay: 0s !important; }",
  });
  await expect(page.locator(".kanban-column")).toHaveCount(5);

  for (const monitorWidth of monitorWidths) {
    for (const zoom of zoomLevels) {
      // Browser zoom changes the available CSS viewport approximately by 1 / zoom.
      const viewportWidth = Math.round(monitorWidth / zoom);
      await page.setViewportSize({ width: viewportWidth, height: 900 });

      for (const sidebar of ["expanded", "collapsed"] as const) {
        if (sidebar === "collapsed") {
          await page.getByRole("button", { name: "Collapse sidebar" }).click();
          await expect(page.locator(".app-workspace")).toHaveClass(/sidebar-collapsed/);
        }

        const layout = await page.evaluate(() => {
          const board = document.querySelector<HTMLElement>(".board-columns")!;
          const scroll = document.querySelector<HTMLElement>(".board-scroll")!;
          const columns = [...document.querySelectorAll<HTMLElement>(".kanban-column")];
          const boardStyle = getComputedStyle(board);
          const columnStyle = getComputedStyle(columns[0]);
          const afterStyle = getComputedStyle(board, "::after");
          const gap = Number.parseFloat(boardStyle.columnGap);
          const widths = columns.map((column) => column.getBoundingClientRect().width);
          const minimum = Number.parseFloat(columnStyle.minWidth);
          const maximum = Number.parseFloat(columnStyle.maxWidth);
          const requiredAtMinimum = columns.length * minimum
            + columns.length * gap
            + Number.parseFloat(afterStyle.flexBasis)
            + Number.parseFloat(afterStyle.marginLeft);
          const first = columns[0].getBoundingClientRect();
          const last = columns.at(-1)!.getBoundingClientRect();
          const boardRect = board.getBoundingClientRect();

          return {
            widths,
            minimum,
            maximum,
            requiredAtMinimum,
            boardClientWidth: board.clientWidth,
            boardScrollWidth: board.scrollWidth,
            scrollClientWidth: scroll.clientWidth,
            scrollWidth: scroll.scrollWidth,
            leftSpace: first.left - boardRect.left,
            rightSpace: boardRect.right - last.right,
          };
        });

        expect(layout.widths).toHaveLength(5);
        for (const width of layout.widths) {
          expect(width).toBeGreaterThanOrEqual(layout.minimum - 1);
          expect(width).toBeLessThanOrEqual(layout.maximum + 1);
        }

        const needsHorizontalScroll = layout.requiredAtMinimum > layout.boardClientWidth + 1;
        if (needsHorizontalScroll) {
          expect(layout.boardScrollWidth).toBeGreaterThan(layout.boardClientWidth);
          expect(layout.scrollWidth).toBeGreaterThan(layout.scrollClientWidth);
        } else {
          expect(layout.boardScrollWidth).toBeLessThanOrEqual(layout.boardClientWidth + 1);
        }

        const columnsAreCapped = layout.widths.every((width) => width >= layout.maximum - 1);
        if (columnsAreCapped && layout.boardClientWidth > layout.requiredAtMinimum + 80) {
          expect(Math.abs(layout.leftSpace - layout.rightSpace)).toBeLessThanOrEqual(24);
        }

        measurements.push(`${monitorWidth}px @ ${Math.round(zoom * 100)}%, ${sidebar}: ${viewportWidth}px CSS, columns ${layout.widths.map((width) => Math.round(width)).join("/")}, scroll ${needsHorizontalScroll}`);

        if (sidebar === "collapsed") {
          await page.getByRole("button", { name: "Expand sidebar" }).click();
          await expect(page.locator(".app-workspace")).toHaveClass(/sidebar-expanded/);
        }
      }
    }
  }

  console.log(measurements.join("\n"));
});
