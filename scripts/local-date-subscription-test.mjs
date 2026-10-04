import assert from "node:assert/strict";
import test from "node:test";
import { subscribeToLocalDate, subscribeToLocalMinute } from "../src/lib/local-date-subscription.ts";

test("two local midnights notify and visibility re-arms the date timer", (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 8, 28, 23, 59, 59) });
  const listeners = new Map();
  const window = {
    setTimeout,
    clearTimeout,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  };
  const document = { visibilityState: "visible", addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  const notifications = [];
  const unsubscribe = subscribeToLocalDate(() => notifications.push(new Date().toISOString()), { window, document });
  context.mock.timers.tick(1000);
  context.mock.timers.tick(24 * 60 * 60 * 1000);
  assert.equal(notifications.length, 2);
  listeners.get("visibilitychange")();
  assert.equal(notifications.length, 3);
  unsubscribe();
  assert.equal(listeners.size, 0);
});

test("each local minute notifies, starting at the next whole minute", (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 8, 30, 14, 29, 40) });
  const listeners = new Map();
  const window = {
    setTimeout,
    clearTimeout,
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name) => listeners.delete(name),
  };
  const document = { visibilityState: "visible", addEventListener: window.addEventListener, removeEventListener: window.removeEventListener };
  const notifications = [];
  const unsubscribe = subscribeToLocalMinute(() => notifications.push(new Date().getMinutes()), { window, document });
  context.mock.timers.tick(19_999);
  assert.deepEqual(notifications, []);
  context.mock.timers.tick(1);
  context.mock.timers.tick(60_000);
  assert.deepEqual(notifications, [30, 31]);
  unsubscribe();
  assert.equal(listeners.size, 0);
});
