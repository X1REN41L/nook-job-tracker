import { expect, type APIRequestContext, type Locator, type Page, test } from "@playwright/test";

import { sameOriginMutationHeaders } from "./api-helpers";

type ApplicationInput = {
  company: string;
  role: string;
  status: "APPLIED" | "INTERVIEW";
  appliedDate: string;
  interviewDate?: string;
};

const runId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let ownedIds: string[] = [];
let recordNumber = 0;

function applicationInput(status: ApplicationInput["status"], interviewDate?: string): ApplicationInput {
  recordNumber += 1;
  return {
    company: `E2E interview ${runId}-${recordNumber}`,
    role: `Interview role ${recordNumber}`,
    status,
    appliedDate: "2026-09-22",
    ...(interviewDate ? { interviewDate } : {}),
  };
}

async function createApplication(request: APIRequestContext, input: ApplicationInput) {
  const response = await request.post("/api/applications", { data: input, headers: sameOriginMutationHeaders });
  expect(response.status()).toBe(201);
  const application = (await response.json()).application as { id: string; company: string; role: string; revision: number };
  ownedIds.push(application.id);
  return application;
}

async function openDashboard(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
}

function card(page: Page, application: { company: string; role: string }) {
  return page.getByLabel(`Edit or move ${application.role} at ${application.company}`, { exact: true });
}

function column(page: Page, label: string): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: label, exact: true }) });
}

async function move(page: Page, application: { id: string; company: string; role: string }, status: string) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${application.id}`),
  );
  const source = await card(page, application).boundingBox();
  const destination = await column(page, status).boundingBox();
  if (!source || !destination) throw new Error(`Could not drag ${application.id} to ${status}`);
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 12, source.y + source.height / 2, { steps: 3 });
  await page.mouse.move(destination.x + destination.width / 2, destination.y + destination.height / 2, { steps: 12 });
  await page.mouse.up();
  return responsePromise;
}

test.beforeEach(async ({ page }) => {
  ownedIds = [];
  await page.addInitScript(() => {
    localStorage.removeItem("nook-sidebar-collapsed");
    localStorage.setItem("nook-archived-expanded", "true");
  });
});

test.afterEach(async ({ request }) => {
  await Promise.all(ownedIds.map((id) => request.delete(`/api/applications/${id}`, { headers: sameOriginMutationHeaders })));
});

test("restores an interview date and prompt dismissal flag when undoing a drag", async ({ page, request }) => {
  const application = await createApplication(request, applicationInput("INTERVIEW", "2026-10-05"));
  await openDashboard(page);

  const moved = await move(page, application, "Online assessment");
  expect(moved.status()).toBe(200);
  const movedApplication = (await moved.json()).application;
  expect(movedApplication.status).toBe("ONLINE_ASSESSMENT");
  const undoResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${application.id}`),
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const response = await undoResponse;

  expect(response.status()).toBe(200);
  expect(JSON.parse(response.request().postData() ?? "{}")).toEqual({
    revision: movedApplication.revision,
    status: "INTERVIEW",
    interviewDate: "2026-10-05",
    interviewDatePromptDismissed: false,
  });
  const restored = (await response.json()).application;
  expect(restored.status).toBe("INTERVIEW");
  expect(restored.interviewDate).toContain("2026-10-05");
  await expect(page.getByText("invalid application data", { exact: false })).toHaveCount(0);
});

test("preserves interview-date prompt behavior through skip, edit, direct creation, and save", async ({ page, request }) => {
  const skipped = await createApplication(request, applicationInput("APPLIED"));
  await openDashboard(page);

  expect((await move(page, skipped, "Interview")).status()).toBe(200);
  const prompt = page.getByRole("dialog", { name: "Add interview date" });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(prompt).toBeHidden();
  expect((await move(page, skipped, "Online assessment")).status()).toBe(200);
  expect((await move(page, skipped, "Interview")).status()).toBe(200);
  await expect(prompt).toBeHidden();

  await card(page, skipped).click();
  const editDialog = page.getByRole("dialog", { name: "Edit job" });
  await expect(editDialog.getByLabel("Interview date")).toHaveValue("");
  await editDialog.getByLabel("Role").fill("Edited interview role");
  const editResponse = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().endsWith(`/api/applications/${skipped.id}`));
  await editDialog.getByRole("button", { name: "Save job", exact: true }).click();
  expect((await editResponse).status()).toBe(200);

  await page.getByRole("button", { name: "Add job", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add a job" });
  await addDialog.getByLabel("Company").fill(`Direct creation ${runId}`);
  await addDialog.getByLabel("Role").fill("Direct interview role");
  await addDialog.getByLabel("Status").selectOption("INTERVIEW");
  const createResponse = page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/api/applications"));
  await addDialog.getByRole("button", { name: "Save job", exact: true }).click();
  const created = await createResponse;
  expect(created.status()).toBe(201);
  ownedIds.push((await created.json()).application.id);
  await expect(prompt).toBeHidden();

  const dated = await createApplication(request, applicationInput("APPLIED"));
  await page.reload();
  expect((await move(page, dated, "Interview")).status()).toBe(200);
  await expect(prompt).toBeVisible();
  await prompt.getByLabel("Interview date").fill("2026-11-06");
  const dateResponse = page.waitForResponse((response) => response.request().method() === "PATCH" && response.url().endsWith(`/api/applications/${dated.id}`));
  await prompt.getByRole("button", { name: "Add date", exact: true }).click();
  const saved = await dateResponse;
  expect(saved.status()).toBe(200);
  expect((await saved.json()).application.interviewDate).toContain("2026-11-06");
});
