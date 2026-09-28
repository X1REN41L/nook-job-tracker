import { expect, test as base, type APIRequestContext } from "@playwright/test";

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

async function purgeApplications(request: APIRequestContext) {
  const response = await request.delete("/api/applications/purge", {
    data: {},
    headers: sameOriginMutationHeaders,
  });
  expect(response.status()).toBe(200);
}

export const test = base.extend<{ cleanState: void }>({
  cleanState: [async ({ request }, use) => {
    await purgeApplications(request);
    await resetSettings(request);
    await use();
    await purgeApplications(request);
    await resetSettings(request);
  }, { auto: true }],
});

export { expect };
