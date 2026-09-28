import assert from "node:assert/strict";
import test from "node:test";
import { getSettingsState, setSettingsState, updateSettings } from "../src/lib/settings-store.ts";
const defaults = { boards: [{ status: "APPLIED", label: "Applied", color: "gold", emptyText: "Empty" }] };

test("queued board changes use the latest committed settings", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  let releaseFirst;
  const firstReply = new Promise((resolve) => { releaseFirst = resolve; });
  setSettingsState({ settings: defaults, revision: 0 });
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
    const nameChange = updateSettings((settings) => ({ boards: settings.boards.map((board) => ({ ...board, label: "New name" })) }));
    const colorChange = updateSettings((settings) => ({ boards: settings.boards.map((board) => ({ ...board, color: "sage" })) }));
    releaseFirst();
    await Promise.all([nameChange, colorChange]);
    assert.equal(requests[1].revision, 1);
    assert.deepEqual(requests[1].changes.boards[0], { status: "APPLIED", label: "New name", color: "sage", emptyText: "Empty" });
    assert.deepEqual(getSettingsState().settings.boards[0], requests[1].changes.boards[0]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
