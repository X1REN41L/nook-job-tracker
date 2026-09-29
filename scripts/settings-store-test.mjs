import assert from "node:assert/strict";
import test from "node:test";
import { getSettingsState, initializeSettings, refreshSettings, setSettingsState, subscribeSettings, updateSettings } from "../src/lib/settings-store.ts";
import { defaultSettings } from "../src/lib/settings-defaults.ts";
const defaults = defaultSettings;
initializeSettings({ settings: defaults, revision: 0 });

test("queued settings changes use the latest committed settings", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  let releaseFirst;
  const firstReply = new Promise((resolve) => { releaseFirst = resolve; });
  const startRevision = getSettingsState().revision + 1;
  setSettingsState({ settings: defaults, revision: startRevision });
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    if (requests.length === 1) await firstReply;
    return {
      ok: true,
      status: 200,
      json: async () => ({ settings: { ...getSettingsState().settings, ...request.changes }, revision: request.revision + 1 }),
    };
  };

  try {
    const firstChange = updateSettings((settings) => ({ staleApplicationThreshold: settings.staleApplicationThreshold === 15 ? 30 : 7 }));
    const secondChange = updateSettings((settings) => ({ staleApplicationThreshold: settings.staleApplicationThreshold === 30 ? 7 : 15 }));
    releaseFirst();
    await Promise.all([firstChange, secondChange]);
    assert.equal(requests[1].revision, startRevision + 1);
    assert.equal(requests[1].changes.staleApplicationThreshold, 7);
    assert.equal(getSettingsState().settings.staleApplicationThreshold, 7);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("two rapid functional toggles return to the original value and retain both revisions", async () => {
  const previousFetch = globalThis.fetch;
  const start = getSettingsState();
  let releaseFirst;
  const firstReply = new Promise((resolve) => { releaseFirst = resolve; });
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    if (requests.length === 1) await firstReply;
    return { ok: true, status: 200, json: async () => ({ settings: { ...start.settings, sidebarCollapsed: request.changes.sidebarCollapsed }, revision: request.revision + 1 }) };
  };
  try {
    const first = updateSettings((settings) => ({ sidebarCollapsed: !settings.sidebarCollapsed }));
    const second = updateSettings((settings) => ({ sidebarCollapsed: !settings.sidebarCollapsed }));
    assert.equal(getSettingsState().settings.sidebarCollapsed, start.settings.sidebarCollapsed);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(requests.map((request) => request.changes.sidebarCollapsed), [!start.settings.sidebarCollapsed, start.settings.sidebarCollapsed]);
    assert.equal(requests[1].revision, requests[0].revision + 1);
    assert.equal(getSettingsState().settings.sidebarCollapsed, start.settings.sidebarCollapsed);
  } finally { globalThis.fetch = previousFetch; }
});

test("equal-revision refresh does not notify and failed write rolls back", async () => {
  const previousFetch = globalThis.fetch;
  const before = getSettingsState();
  let notices = 0;
  const unsubscribe = subscribeSettings(() => { notices++; });
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ settings: { ...before.settings, motion: "off" }, revision: before.revision }) });
    await refreshSettings();
    assert.equal(notices, 0);
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: "Database busy" }) });
    await assert.rejects(updateSettings({ motion: "off" }), /Database busy/);
    assert.equal(getSettingsState().settings.motion, before.settings.motion);
    assert.equal(getSettingsState().revision, before.revision);
    assert.equal(notices, 2);
  } finally { unsubscribe(); globalThis.fetch = previousFetch; }
});

test("conflict adopts the server revision and rebases the next functional edit", async () => {
  const previousFetch = globalThis.fetch;
  const before = getSettingsState();
  const server = { settings: { ...before.settings, motion: "off" }, revision: before.revision + 1 };
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    if (requests.length === 1) return { ok: false, status: 409, json: async () => server };
    return { ok: true, status: 200, json: async () => ({ settings: { ...server.settings, ...request.changes }, revision: request.revision + 1 }) };
  };
  try {
    const first = updateSettings({ sidebarCollapsed: true });
    const second = updateSettings((settings) => ({ archivedExpanded: !settings.archivedExpanded }));
    await assert.rejects(first, /changed in another tab/);
    await second;
    assert.equal(requests[1].revision, server.revision);
    assert.equal(getSettingsState().settings.motion, "off");
    assert.equal(getSettingsState().settings.sidebarCollapsed, server.settings.sidebarCollapsed);
    assert.equal(getSettingsState().settings.archivedExpanded, !server.settings.archivedExpanded);
  } finally { globalThis.fetch = previousFetch; }
});
