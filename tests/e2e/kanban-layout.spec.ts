import { randomUUID } from "node:crypto";

import { expect, gotoReady, readSettings, test, sameOriginMutationHeaders } from "./api-helpers";

test("keeps board columns readable across zoom-equivalent viewport sizes", async ({ page }) => {
  const monitorWidths = [1440, 1920, 3440, 5120];
  const zoomLevels = [0.5, 0.67, 0.8, 1, 1.5];
  const measurements: string[] = [];

  await page.goto("/jobs");
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
          const scroll = document.querySelector<HTMLElement>(".board-lane")!;
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
          // The visible edges are the page title on the left and the board filters on the right.
          const contentLeft = document.querySelector("h1")!.getBoundingClientRect().left;
          const contentRight = document.querySelector('[aria-label="Board filters"]')!.getBoundingClientRect().right;

          return {
            widths,
            minimum,
            maximum,
            requiredAtMinimum,
            boardClientWidth: board.clientWidth,
            boardScrollWidth: board.scrollWidth,
            scrollClientWidth: scroll.clientWidth,
            scrollWidth: scroll.scrollWidth,
            leftSpace: first.left - contentLeft,
            rightSpace: contentRight - last.right,
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
        } else if (!needsHorizontalScroll) {
          // A board that fits lines up with the title on the left and the filters on the right.
          expect(Math.abs(layout.leftSpace)).toBeLessThanOrEqual(1);
          expect(Math.abs(layout.rightSpace)).toBeLessThanOrEqual(1);
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

test("profiles desktop board loading and filtering with representative application counts", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const profile = { rectangles: 0, rectangleMs: 0, longTasks: [] as number[] };
    Object.assign(window, { auditBoardProfile: profile });
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      if (!this.matches("article[data-application-id], .kanban-column, .sidebar-edge-rail")) return original.call(this);
      const start = performance.now();
      const rectangle = original.call(this);
      profile.rectangles++;
      profile.rectangleMs += performance.now() - start;
      return rectangle;
    };
    new PerformanceObserver((list) => {
      profile.longTasks.push(...list.getEntries().map((entry) => entry.duration));
    }).observe({ type: "longtask", buffered: true });
  });

  const date = "2026-09-24T00:00:00.000Z";
  const settings = await readSettings(request);
  const measurements = [];
  for (const count of [50, 1_000]) {
    const purged = await request.delete("/api/applications/purge", { data: {}, headers: sameOriginMutationHeaders });
    expect(purged.status()).toBe(200);
    const applications = Array.from({ length: count }, (_, index) => ({
      id: randomUUID(), company: `Profile company ${index}`, role: `Profile role ${index}`,
      status: "APPLIED", archived: false, source: "Audit", appliedDate: date,
      interviewDatePromptDismissed: false, followUpDate: null, followUpNote: null,
      notes: "n".repeat(256), jobUrl: null, createdAt: date, lastUpdated: date,
      interviews: Array.from({ length: 2 }, () => ({ id: randomUUID(), date, time: null, type: "OTHER", interviewers: null, notes: "n".repeat(256), createdAt: date })),
      contacts: Array.from({ length: 2 }, () => ({ id: randomUUID(), name: "Profile contact", role: null, email: null, linkedinUrl: null, notes: "n".repeat(256), createdAt: date })),
      events: [{ id: randomUUID(), type: "STATUS_CHANGE", fromStatus: null, toStatus: "APPLIED", detail: "null → APPLIED", createdAt: date }],
    }));
    const staged = await request.post("/api/applications/import/upload", {
      data: { version: 1, applications, settings }, headers: sameOriginMutationHeaders,
    });
    expect(staged.status(), await staged.text()).toBe(201);
    const imported = await request.post("/api/applications/import", {
      data: { token: (await staged.json()).token }, headers: sameOriginMutationHeaders,
    });
    expect(imported.status(), await imported.text()).toBe(201);
    for (let sample = 0; sample < 3; sample++) {
      await gotoReady(page, "/jobs");
      await expect(page.locator("article[data-application-id]")).toHaveCount(count);
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const load = await page.evaluate(() => {
        const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
        const profile = (window as unknown as { auditBoardProfile: { rectangles: number; rectangleMs: number; longTasks: number[] } }).auditBoardProfile;
        return { readyMs: performance.now(), responseMs: navigation.responseEnd - navigation.requestStart, documentBytes: navigation.encodedBodySize, ...profile, longTasks: [...profile.longTasks] };
      });
      const filterStart = await page.evaluate(() => performance.now());
      await page.getByRole("searchbox").fill(`company ${count - 1} role ${count - 1}`);
      await expect(page.locator("article[data-application-id]")).toHaveCount(1);
      const filter = await page.evaluate((start) => {
        const profile = (window as unknown as { auditBoardProfile: { rectangles: number; rectangleMs: number; longTasks: number[] } }).auditBoardProfile;
        return { filterMs: performance.now() - start, rectangles: profile.rectangles, rectangleMs: profile.rectangleMs };
      }, filterStart);
      measurements.push({ count, sample, load, filter });
    }
  }
  console.log(`AUDIT_BOARD_PROFILE ${JSON.stringify(measurements)}`);
});
