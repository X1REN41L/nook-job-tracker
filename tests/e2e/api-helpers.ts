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

type ReadinessWindow = Window & { nookShortcutsReady?: boolean };
const pagesWithReadinessProbe = new WeakSet<Page>();

// Navigates and waits until the app shell has hydrated and run its effects. useDashboardShortcuts
// attaches its document `keydown` listener (`handleShortcut`) in a passive effect, so its arrival
// means clicks, shortcuts and settings writes are live. The init script runs again on every
// navigation or reload, so a reloaded page has to attach the listener again.
export async function gotoReady(page: Page, path: string) {
  if (!pagesWithReadinessProbe.has(page)) {
    pagesWithReadinessProbe.add(page);
    await page.addInitScript(() => {
      const addEventListener = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function (type, listener, options) {
        if (this === document && type === "keydown" && typeof listener === "function" && listener.name === "handleShortcut") {
          (window as ReadinessWindow).nookShortcutsReady = true;
        }
        return addEventListener.call(this, type, listener, options);
      };
    });
  }
  await page.goto(path);
  await page.waitForFunction(() => (window as ReadinessWindow).nookShortcutsReady === true);
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
