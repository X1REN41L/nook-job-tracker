import { expect, request as playwrightRequest, test as base, type APIRequestContext, type Page } from "@playwright/test";

import { defaultSettings } from "../../src/lib/settings-defaults";

const baseUrl = process.env.PLAYWRIGHT_BASE_URL;
if (!baseUrl) throw new Error("PLAYWRIGHT_BASE_URL is required for API mutation tests");

export const sameOriginMutationHeaders = {
  Origin: new URL(baseUrl).origin,
  "Content-Type": "application/json",
};

type Settings = typeof defaultSettings;

export async function readSettings(request: APIRequestContext): Promise<Settings> {
  const response = await request.get("/api/settings");
  expect(response.ok()).toBe(true);
  return (await response.json()).settings as Settings;
}

export async function resetSettings(request: APIRequestContext, overrides: Partial<Settings> = {}) {
  const currentResponse = await request.get("/api/settings");
  expect(currentResponse.ok()).toBe(true);
  const { revision } = await currentResponse.json();
  const response = await request.patch("/api/settings", {
    data: { revision, changes: { ...defaultSettings, ...overrides } },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ settings: Settings; revision: number }>;
}

// Navigates and waits until the app shell has hydrated and run its effects. useDashboardShortcuts
// marks <html data-shortcuts-ready> right after attaching its document `keydown` listener, so the
// marker means clicks, shortcuts and settings writes are live. Every navigation loads a new
// document, so the marker always comes from the page just loaded.
export async function gotoReady(page: Page, path: string) {
  await page.goto(path);
  await page.waitForFunction(() => document.documentElement.dataset.shortcutsReady === "true");
}

async function purgeApplications(request: APIRequestContext) {
  const response = await request.delete("/api/applications/purge", {
    data: {},
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(200);
}

function isConnectionReset(error: unknown) {
  return error instanceof Error && /\bECONNRESET\b/.test(error.message);
}

// Runs one cleanup step on its own API context, so it never reuses a keep-alive socket that the dev
// server (Node's default 5 s keepAliveTimeout) may be closing after a long test. A transport-level
// ECONNRESET is retried once on another fresh context; the steps are idempotent. HTTP errors fail the
// step's own assertions and are never retried.
async function withFreshRequest(step: (request: APIRequestContext) => Promise<unknown>) {
  for (let attempt = 1; ; attempt += 1) {
    const request = await playwrightRequest.newContext({ baseURL: baseUrl });
    try {
      await step(request);
      return;
    } catch (error) {
      if (attempt > 1 || !isConnectionReset(error)) throw error;
    } finally {
      await request.dispose();
    }
  }
}

async function resetState() {
  await withFreshRequest(purgeApplications);
  await withFreshRequest((request) => resetSettings(request));
}

export const test = base.extend<{ cleanState: void }>({
  cleanState: [async ({}, use) => {
    await resetState();
    await use();
    await resetState();
  }, { auto: true }],
});

export { expect };

/** Clicking an application opens its details panel; this opens the panel's inline details editor. */
export async function openDetailsEditor(page: Page) {
  await page.getByRole("dialog").getByRole("button", { name: "Edit details", exact: true }).click();
  const form = page.getByRole("form", { name: "Edit details" });
  await expect(form).toBeVisible();
  return form;
}

/** Adds an interview round and returns the application as the API now reports it. */
export async function addInterviewRound(request: APIRequestContext, application: { id: string; revision: number }, date: string, type = "OTHER") {
  const response = await request.post(`/api/applications/${encodeURIComponent(application.id)}/interviews`, {
    data: { revision: application.revision, date, type },
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(201);
  return (await response.json()).application;
}

export async function exportBackup(request: APIRequestContext) {
  const prepared = await request.post("/api/applications/export", { headers: sameOriginMutationHeaders });
  expect(prepared.status()).toBe(200);
  const { token } = await prepared.json();
  const downloaded = await request.get(`/api/applications/export?token=${token}`);
  expect(downloaded.status()).toBe(200);
  return downloaded.json();
}

/** Cleanup uses the current revision and never retries a deletion conflict. */
export async function deleteApplication(request: APIRequestContext, id: string) {
  const path = `/api/applications/${encodeURIComponent(id)}`;
  const current = await request.get(path);
  if (current.status() === 404) return;
  expect(current.status()).toBe(200);
  const { application } = await current.json();
  const deleted = await request.delete(path, {
    data: { revision: application.revision },
    headers: sameOriginMutationHeaders,
  });
  expect([204, 404]).toContain(deleted.status());
}
