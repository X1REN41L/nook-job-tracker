import { PrismaClient, Status } from "@prisma/client";
import { type Page } from "@playwright/test";
import { expect, test } from "./api-helpers";

const prisma = new PrismaClient();

test.afterEach(async () => {
  await prisma.application.deleteMany({ where: { source: "Scrollbar visual check" } });
});

test.afterAll(async () => {
  await prisma.$disconnect();
});

async function createApplications() {
  const fixtures = [
    ...Array.from({ length: 18 }, (_, index) => ({ status: Status.APPLIED, archived: false, index })),
    ...Array.from({ length: 12 }, (_, index) => ({ status: Status.INTERVIEW, archived: false, index })),
    ...Array.from({ length: 16 }, (_, index) => ({ status: Status.APPLIED, archived: true, index })),
  ];

  await prisma.application.createMany({
    data: fixtures.map((fixture) => ({
      company: `Scrollbar Co ${fixture.status} ${fixture.archived} ${fixture.index}`,
      role: `Scrollbar role ${fixture.index}`,
      status: fixture.status,
      archived: fixture.archived,
      appliedDate: new Date("2026-09-26T00:00:00.000Z"),
      source: "Scrollbar visual check",
    })),
  });
}

async function layoutSnapshot(page: Page) {
  return page.evaluate(() => {
    const rect = (element: Element | null, selector: string) => {
      if (!element) throw new Error(`Missing layout target: ${selector}`);
      const { x, y, width, height } = element.getBoundingClientRect();
      return {
        x,
        y,
        width,
        height,
        clientWidth: (element as HTMLElement).clientWidth,
        clientHeight: (element as HTMLElement).clientHeight,
      };
    };
    const size = (element: Element, selector: string) => {
      if (!element) throw new Error(`Missing layout target: ${selector}`);
      const { width, height } = element.getBoundingClientRect();
      return {
        width,
        height,
        clientWidth: (element as HTMLElement).clientWidth,
        clientHeight: (element as HTMLElement).clientHeight,
      };
    };
    const board = document.querySelector(".board-scroll");
    return {
      sidebar: rect(document.querySelector(".sidebar-panel"), ".sidebar-panel"),
      board: rect(board, ".board-scroll"),
      columns: Array.from(document.querySelectorAll(".board-columns > section"), (column) => size(column, ".board-columns > section")),
      columnScrollports: Array.from(document.querySelectorAll(".kanban-column-scroll"), (element) => size(element, ".kanban-column-scroll")),
    };
  });
}

async function switchTheme(page: Page, theme: "light" | "dark") {
  await page.getByRole("button", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("button", { name: `Use ${theme} theme` }).click();
  if (theme === "dark") await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  else await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await dialog.getByRole("button", { name: "Close settings" }).click();
}

test("keeps board scrollbars compact and stable across themes", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await createApplications();
  await page.goto("/jobs");

  const archiveToggle = page.getByRole("button", { name: "Archived 16", exact: true });
  await archiveToggle.click();
  // The Archived list is the sidebar's only scrolling list.
  const archiveList = page.locator(".sidebar-content .scrollbar-styled.overflow-y-auto").first();
  const boardColumnList = page.locator(".board-columns > section > .scrollbar-styled").first();
  const boardScroll = page.locator(".board-lane");

  await expect(archiveList).toBeVisible();
  await expect(boardColumnList).toBeVisible();

  const scrollMetrics = async (locator: typeof archiveList) => locator.evaluate((element) => {
    const styles = getComputedStyle(element);
    const scrollbar = getComputedStyle(element, "::-webkit-scrollbar");
    return {
      width: scrollbar.width,
      height: scrollbar.height,
      scrollbarWidth: styles.scrollbarWidth,
      gutter: styles.scrollbarGutter,
      color: styles.scrollbarColor,
      thumb: getComputedStyle(element, "::-webkit-scrollbar-thumb").backgroundColor,
      track: getComputedStyle(element, "::-webkit-scrollbar-track").backgroundColor,
    };
  });

  await switchTheme(page, "light");
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await expect(boardColumnList).not.toHaveClass(/is-scrolling/);
  await expect(boardScroll).not.toHaveClass(/is-scrolling/);
  const lightLayout = await layoutSnapshot(page);
  const lightColumnStyle = await scrollMetrics(boardColumnList);
  const lightBoardStyle = await scrollMetrics(boardScroll);
  for (const style of [lightColumnStyle, lightBoardStyle]) {
    expect(style.scrollbarWidth).toBe("thin");
    expect(style.width).toBe("6px");
    expect(style.height).toBe("6px");
    expect(style.gutter).toBe("auto");
    // The hidden thumb is fully transparent but keeps the hover hue, so fading in never passes through black.
    expect(style.thumb).toMatch(/(?:,\s*0\)|\/\s*0\))$/);
    expect(style.thumb).not.toBe("rgba(0, 0, 0, 0)");
    expect(style.color.startsWith("rgba(0, 0, 0, 0)")).toBe(false);
    expect(style.track).toBe("rgba(0, 0, 0, 0)");
  }

  for (const locator of [boardColumnList, archiveList]) {
    const before = await locator.evaluate((element) => ({ height: element.clientHeight, scrollHeight: element.scrollHeight }));
    expect(before.scrollHeight).toBeGreaterThan(before.height);
    await locator.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await locator.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }

  await page.mouse.move(0, 0);
  await boardColumnList.evaluate((element) => { element.scrollTop = 0; });
  await expect(boardColumnList).toHaveClass(/is-scrolling/);
  await expect(boardColumnList).not.toHaveClass(/is-scrolling/);

  const boardDimensions = await boardScroll.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(boardDimensions.scrollWidth).toBeGreaterThan(boardDimensions.width);

  const initialLayout = await layoutSnapshot(page);
  await boardColumnList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(boardColumnList).toHaveClass(/is-scrolling/);
  const columnScrollingStyle = await scrollMetrics(boardColumnList);
  expect(columnScrollingStyle.color).not.toBe(lightColumnStyle.color);
  expect(await layoutSnapshot(page)).toEqual(initialLayout);

  await boardScroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(boardScroll).toHaveClass(/is-scrolling/);
  const boardScrollingStyle = await scrollMetrics(boardScroll);
  expect(boardScrollingStyle.color).not.toBe(lightBoardStyle.color);
  expect(await layoutSnapshot(page)).toEqual(initialLayout);
  expect(await boardScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  await boardScroll.hover();
  const boardHoverStyle = await scrollMetrics(boardScroll);
  expect(boardHoverStyle.color).not.toBe(lightBoardStyle.color);
  expect(await layoutSnapshot(page)).toEqual(initialLayout);

  await boardColumnList.hover();
  const columnHoverStyle = await scrollMetrics(boardColumnList);
  expect(columnHoverStyle.color).not.toBe(lightColumnStyle.color);
  expect(await layoutSnapshot(page)).toEqual(initialLayout);

  await page.mouse.move(0, 0);
  await expect(boardColumnList).not.toHaveClass(/is-scrolling/);
  await expect(boardScroll).not.toHaveClass(/is-scrolling/);

  await switchTheme(page, "dark");
  await page.mouse.move(0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await expect(boardColumnList).not.toHaveClass(/is-scrolling/);
  await expect(boardScroll).not.toHaveClass(/is-scrolling/);
  const darkLayout = await layoutSnapshot(page);
  const darkColumnStyle = await scrollMetrics(boardColumnList);
  const darkBoardStyle = await scrollMetrics(boardScroll);
  expect(darkLayout).toEqual(lightLayout);
  await boardScroll.hover();
  const darkBoardHoverStyle = await scrollMetrics(boardScroll);
  expect(darkBoardHoverStyle.color).not.toBe(darkBoardStyle.color);
  expect(darkBoardHoverStyle.color).not.toBe(boardHoverStyle.color);
  expect(await layoutSnapshot(page)).toEqual(darkLayout);
  await boardColumnList.hover();
  const darkColumnHoverStyle = await scrollMetrics(boardColumnList);
  expect(darkColumnHoverStyle.color).not.toBe(darkColumnStyle.color);
  expect(darkColumnHoverStyle.color).not.toBe(columnHoverStyle.color);
  expect(await layoutSnapshot(page)).toEqual(darkLayout);

  for (const locator of [boardColumnList, archiveList]) {
    expect(await locator.evaluate((element) => element.scrollHeight)).toBeGreaterThan(await locator.evaluate((element) => element.clientHeight));
    await locator.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect(await locator.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  }
  await boardScroll.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  expect(await boardScroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
});
