import { expect, gotoReady, sameOriginMutationHeaders, test } from "./api-helpers";

test("Overview names its active interview count and explains independent milestone rates", async ({ page }) => {
  await gotoReady(page, "/dashboard");
  const metrics = page.locator('[aria-label="Overview metrics"]');
  await expect(metrics.getByText("Active upcoming interviews", { exact: true })).toBeVisible();
  await expect(metrics.getByText("Interview Rate", { exact: true })).toHaveAttribute("title", /reached this exact status.*independently/);
  await gotoReady(page, "/dashboard/analytics");
  await expect(page.getByText("Offer Rate", { exact: true })).toHaveAttribute("title", /reached this exact status.*independently/);
});

test("Interviews heading follows a trimmed search across company and role", async ({ page, request }) => {
  const today = await page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  const created = await request.post("/api/applications", {
    headers: sameOriginMutationHeaders,
    data: { company: "Acme Corp", role: "Engineer", status: "INTERVIEW", appliedDate: today, interviewDate: today },
  });
  expect(created.status()).toBe(201);
  await gotoReady(page, "/interviews");
  const search = page.getByRole("searchbox", { name: "Search by company or role" });
  await expect(page.getByRole("heading", { name: "Upcoming Interviews (1)" })).toBeVisible();
  await search.fill(" Corp Engineer ");
  await expect(page.getByRole("heading", { name: "Upcoming Interviews (1)" })).toBeVisible();
  await search.fill("missing");
  await expect(page.getByRole("heading", { name: "Upcoming Interviews (0)" })).toBeVisible();
});
