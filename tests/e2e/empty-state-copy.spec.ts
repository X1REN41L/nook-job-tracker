import { expect, test } from "@playwright/test";

test("shows the requested copy with zero applications", async ({ page, request }) => {
  const response = await request.get("/api/applications");
  expect(response.ok()).toBe(true);
  expect((await response.json()).applications).toEqual([]);

  await page.goto("/dashboard/analytics");
  const trend = page.getByRole("region", { name: "Applications Trend" });
  await expect(trend.getByText("No trend to show. Give it something to trend.", { exact: true })).toBeVisible();
  console.log(`ANALYTICS_DOM=${JSON.stringify(await trend.innerText())}`);
  await page.screenshot({ path: "/private/tmp/nook-empty-analytics.png", fullPage: true });

  await page.goto("/interviews");
  await page.getByRole("tab", { name: "Past" }).click();
  await expect(page.getByRole("tabpanel").getByText("None yet — patience, and a callback, will fix that.", { exact: true })).toBeVisible();
  console.log(`INTERVIEWS_DOM=${JSON.stringify(await page.getByRole("tabpanel").innerText())}`);
  await page.screenshot({ path: "/private/tmp/nook-empty-interviews-past.png", fullPage: true });

  await page.goto("/dashboard/stale");
  await expect(page.getByText("Nothing's gone quiet yet — good sign.", { exact: true })).toBeVisible();
  console.log(`STALE_DOM=${JSON.stringify(await page.locator("main").innerText())}`);
  await page.screenshot({ path: "/private/tmp/nook-empty-stale.png", fullPage: true });
});
