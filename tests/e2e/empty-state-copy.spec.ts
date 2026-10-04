import { expect, test } from "./api-helpers";

test("shows the requested copy with zero applications", async ({ page, request }) => {
  const response = await request.get("/api/applications");
  expect(response.ok()).toBe(true);
  expect((await response.json()).applications).toEqual([]);

  await page.goto("/dashboard/analytics");
  const trend = page.getByRole("region", { name: "Applications trend" });
  await expect(trend.getByText("No trend to show. Give it something to trend.", { exact: true })).toBeVisible();

  await page.goto("/interviews");
  await page.getByRole("tab", { name: "Past" }).click();
  await expect(page.getByRole("tabpanel").getByText("None yet — patience, and a callback, will fix that.", { exact: true })).toBeVisible();

  await page.goto("/dashboard");
  await expect(page.getByText("No applications need attention right now.", { exact: true })).toBeVisible();
});
