import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/keyboard-shortcuts.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { matchDashboardShortcut, shortcutDefinitions, shortcutDestination, shortcutLabels, shortcutSections, startsShortcutSequence } = await import(`data:text/javascript,${encodeURIComponent(compiled)}`);

globalThis.HTMLElement = class HTMLElement {
  constructor(editable = false) { this.editable = editable; }
  closest() { return this.editable ? this : null; }
};

function key(key, options = {}) {
  return { key, code: options.code ?? `Key${key.toUpperCase()}`, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: new HTMLElement(), ...options };
}

test("definitions drive the exact group order and platform labels", () => {
  assert.deepEqual(shortcutSections, ["General", "Page Navigation", "Dashboard", "Job Board", "Interviews"]);
  assert.equal(shortcutDefinitions.length, 21);
  for (const isMac of [true, false]) {
    const labels = shortcutLabels(isMac);
    assert.deepEqual([...new Set(labels.map(({ section }) => section))], shortcutSections);
    assert.equal(labels.find(({ id }) => id === "toggle-sidebar").keys, isMac ? "⌘ ⇧ S" : "Ctrl + Shift + S");
    assert.equal(labels.find(({ id }) => id === "new-job").keys, isMac ? "⌥ N" : "Alt + N");
    assert.equal(labels.find(({ id }) => id === "archive-focused").keys, isMac ? "⌥ A" : "Alt + A");
    assert.equal(labels.find(({ id }) => id === "switch-interview-tabs").keys, "← / →");
  }
  assert.equal(shortcutDestination("go-stale"), "/dashboard/stale");
  assert.equal(shortcutDestination("go-job-board"), "/jobs");
});

test("page and subsection sequences only match in their scopes", () => {
  const routes = { dashboard: "go-dashboard", jobs: "go-job-board", interviews: "go-interviews" };
  for (const page of ["dashboard", "job-board", "interviews"]) {
    assert.equal(startsShortcutSequence(key("g"), page), true);
    for (const [letter, id] of [["d", routes.dashboard], ["j", routes.jobs], ["i", routes.interviews]]) {
      assert.equal(matchDashboardShortcut(key(letter), true, page, "g"), id);
    }
    for (const [letter, id] of [["o", "go-overview"], ["a", "go-analytics"], ["s", "go-stale"]]) {
      assert.equal(matchDashboardShortcut(key(letter), true, page, "g"), page === "dashboard" ? id : null);
    }
    assert.equal(matchDashboardShortcut(key("x"), true, page, "g"), null);
    assert.equal(matchDashboardShortcut(key("a"), true, page), null);
  }
});

test("same keys resolve only in the active section", () => {
  for (const page of ["dashboard", "job-board", "interviews"]) {
    assert.equal(matchDashboardShortcut(key("/"), false, page), page === "job-board" ? "search-job-board" : page === "interviews" ? "search-interviews" : null);
    assert.equal(matchDashboardShortcut(key("ArrowRight"), false, page), page === "job-board" ? "focus-column-right" : page === "interviews" ? "switch-interview-tabs" : null);
    assert.equal(matchDashboardShortcut(key("Delete"), false, page), page === "job-board" ? "delete-focused" : null);
    assert.equal(matchDashboardShortcut(key("n", { code: "KeyN", altKey: true }), false, page), page === "job-board" ? "new-job" : null);
  }
});

test("obsolete bindings and typing never match app actions", () => {
  for (const page of ["dashboard", "job-board", "interviews"]) {
    assert.equal(matchDashboardShortcut(key("b"), true, page), null);
    assert.equal(matchDashboardShortcut(key("n"), true, page), null);
    assert.equal(matchDashboardShortcut(key("a", { code: "KeyA", altKey: true, shiftKey: true }), false, page), null);
    for (const value of ["g", "u", "/", "Delete", "ArrowLeft"]) {
      const event = key(value, { target: new HTMLElement(true) });
      assert.equal(startsShortcutSequence(event, page), false);
      assert.equal(matchDashboardShortcut(event, true, page, "g"), null);
    }
  }
  assert.equal(matchDashboardShortcut(key("?", { shiftKey: true }), true, "dashboard"), "show-shortcuts");
  assert.equal(matchDashboardShortcut(key("s", { code: "KeyS", metaKey: true, shiftKey: true }), true, "dashboard"), "toggle-sidebar");
  assert.equal(matchDashboardShortcut(key("s", { code: "KeyS", ctrlKey: true, shiftKey: true }), false, "dashboard"), "toggle-sidebar");
});
