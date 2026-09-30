import assert from "node:assert/strict";
import { test } from "node:test";
import { matchDashboardShortcut, shortcutDefinitions, shortcutDestination, shortcutKeys, shortcutLabels, shortcutSections, startsShortcutSequence } from "../src/lib/keyboard-shortcuts.ts";

globalThis.HTMLElement = class HTMLElement {
  constructor(editable = false) { this.editable = editable; }
  closest() { return this.editable ? this : null; }
};

function key(key, options = {}) {
  return { key, code: options.code ?? `Key${key.toUpperCase()}`, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, target: new HTMLElement(), ...options };
}

test("definitions drive the exact group order and platform labels", () => {
  assert.deepEqual(shortcutSections, ["General", "Go to", "Job Board", "Interviews"]);
  assert.ok(shortcutDefinitions.length > 0);
  assert.equal(new Set(shortcutDefinitions.map(({ id }) => id)).size, shortcutDefinitions.length);
  for (const isMac of [true, false]) {
    const labels = shortcutLabels(isMac);
    const label = (id) => labels.find((shortcut) => shortcut.id === id);
    assert.deepEqual([...new Set(labels.map(({ section }) => section))], shortcutSections);
    assert.deepEqual(label("toggle-sidebar").keys.bindings, [isMac ? ["⌘", "⇧", "S"] : ["Ctrl", "Shift", "S"]]);
    assert.deepEqual(label("undo").keys.bindings, [isMac ? ["⌘", "Z"] : ["Ctrl", "Z"]]);
    assert.deepEqual(label("open-settings").keys.bindings, [isMac ? ["⌘", "⇧", ","] : ["Ctrl", "Shift", ","]]);
    assert.deepEqual(label("new-job").keys.bindings, [["N"]]);
    assert.deepEqual(label("archive-focused").keys.bindings, [["E"]]);
    assert.deepEqual(label("go-analytics").keys, { bindings: [["G", "A"]], within: "then", between: "or" });
    assert.deepEqual(label("move-focus").keys, { bindings: [["↑"], ["↓"], ["←"], ["→"]], within: "together", between: "pair" });
    assert.deepEqual(label("delete-focused").keys.bindings, [["Del"], [isMac ? "⌫" : "Backspace"]]);
    assert.equal(label("command-palette").text, isMac ? "⌘K" : "Ctrl+K");
    assert.equal(label("go-table").text, "G then T");
    assert.equal(label("delete-focused").text, isMac ? "Del or ⌫" : "Del or Backspace");
    assert.equal(labels.filter(({ action }) => action === "Search this page").length, 1, "Search is listed once");
    assert.equal(label("pick-up-card").text, "Space");
    assert.equal(label("open-card").text, isMac ? "↩" : "Enter");
    assert.equal(label("switch-interview-tab").text, "← →");
    assert.equal(shortcutKeys("go-job-board", isMac).text, "G then J");
  }
  assert.equal(shortcutDefinitions.some(({ id }) => id === "go-stale"), false, "Stale Applications is part of Overview");
  assert.equal(shortcutDestination("go-table"), "/table");
  assert.equal(shortcutDestination("go-job-board"), "/jobs");
  assert.equal(shortcutDestination("go-analytics"), "/dashboard/analytics");
});

test("go-to sequences work on every page", () => {
  const routes = [["d", "go-dashboard"], ["a", "go-analytics"], ["j", "go-job-board"], ["t", "go-table"], ["i", "go-interviews"]];
  for (const page of ["dashboard", "job-board", "table", "interviews"]) {
    assert.equal(startsShortcutSequence(key("g"), page), true);
    for (const [letter, id] of routes) assert.equal(matchDashboardShortcut(key(letter), true, page, "g"), id);
    assert.equal(matchDashboardShortcut(key("o"), true, page, "g"), null, "G D already opens Overview");
    assert.equal(matchDashboardShortcut(key("s"), true, page, "g"), null);
    assert.equal(matchDashboardShortcut(key("e"), true, page, "g"), null, "a pending G never archives");
    assert.equal(matchDashboardShortcut(key("n"), true, page, "g"), null, "a pending G never opens New job");
    assert.equal(matchDashboardShortcut(key("a"), true, page), null);
  }
});

test("global keys work everywhere and board keys only on the Job Board", () => {
  for (const page of ["dashboard", "job-board", "table", "interviews"]) {
    const board = page === "job-board";
    assert.equal(matchDashboardShortcut(key("/"), false, page), "search");
    assert.equal(matchDashboardShortcut(key("/", { shiftKey: true }), false, page), "search", "layouts that type / with Shift");
    assert.equal(matchDashboardShortcut(key("n"), false, page), "new-job");
    assert.equal(matchDashboardShortcut(key("k", { code: "KeyK", metaKey: true }), true, page), "command-palette");
    assert.equal(matchDashboardShortcut(key("k", { code: "KeyK", ctrlKey: true }), false, page), "command-palette");
    assert.equal(matchDashboardShortcut(key("z", { code: "KeyZ", metaKey: true }), true, page), "undo");
    assert.equal(matchDashboardShortcut(key("z", { code: "KeyZ", ctrlKey: true }), false, page), "undo");
    assert.equal(matchDashboardShortcut(key("ArrowRight"), false, page), board ? "move-focus" : page === "interviews" ? "switch-interview-tab" : null);
    assert.equal(matchDashboardShortcut(key("ArrowUp"), false, page), board ? "move-focus" : null);
    assert.equal(matchDashboardShortcut(key("Delete"), false, page), board ? "delete-focused" : null);
    assert.equal(matchDashboardShortcut(key("e"), false, page), board ? "archive-focused" : null, "E only edits inside the details panel");
    assert.equal(matchDashboardShortcut(key("Enter"), false, page), null, "focused cards handle Enter themselves");
    assert.equal(matchDashboardShortcut(key(" ", { code: "Space" }), false, page), null, "dnd-kit handles Space");
    assert.equal(matchDashboardShortcut(key("ArrowLeft"), false, page), board ? "move-focus" : page === "interviews" ? "switch-interview-tab" : null);
  }
});

test("obsolete bindings and typing never match app actions", () => {
  for (const page of ["dashboard", "job-board", "interviews"]) {
    assert.equal(matchDashboardShortcut(key("b"), true, page), null);
    assert.equal(matchDashboardShortcut(key("u"), true, page), null, "U no longer undoes");
    assert.equal(matchDashboardShortcut(key("n", { code: "KeyN", altKey: true }), false, page), null);
    assert.equal(matchDashboardShortcut(key("a", { code: "KeyA", altKey: true }), false, page), null);
    assert.equal(matchDashboardShortcut(key("N", { shiftKey: true }), false, page), null, "Shift+N is not New job");
    assert.equal(matchDashboardShortcut(key("z", { code: "KeyZ", metaKey: true, shiftKey: true }), true, page), null, "Redo is not Undo");
    for (const value of ["g", "n", "e", "/", "Delete", "ArrowLeft"]) {
      const event = key(value, { target: new HTMLElement(true) });
      assert.equal(startsShortcutSequence(event, page), false);
      assert.equal(matchDashboardShortcut(event, true, page, "g"), null);
      assert.equal(matchDashboardShortcut(event, true, page), null);
    }
    assert.equal(matchDashboardShortcut(key("z", { code: "KeyZ", metaKey: true, target: new HTMLElement(true) }), true, page), null, "text fields keep their own undo");
  }
  assert.equal(matchDashboardShortcut(key("?", { shiftKey: true }), true, "dashboard"), "show-shortcuts");
  assert.equal(matchDashboardShortcut(key("s", { code: "KeyS", metaKey: true, shiftKey: true }), true, "dashboard"), "toggle-sidebar");
  assert.equal(matchDashboardShortcut(key("s", { code: "KeyS", ctrlKey: true, shiftKey: true }), false, "dashboard"), "toggle-sidebar");
  assert.equal(matchDashboardShortcut(key("s", { code: "KeyS", metaKey: true }), true, "dashboard"), null, "Save is not Toggle sidebar");
  assert.equal(matchDashboardShortcut(key(",", { code: "Comma", metaKey: true, shiftKey: true }), true, "dashboard"), "open-settings");
});
