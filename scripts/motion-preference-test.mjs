import assert from "node:assert/strict";
import { test } from "node:test";
import { MOTION_MODES, cssTimeToMs, motionIsOff } from "../src/lib/motion-mode.ts";
import { getMotionMode, motionIsCurrentlyOff } from "../src/lib/general-preferences.ts";
import { defaultSettings } from "../src/lib/settings-defaults.ts";
import { getSettingsState, setSettingsState } from "../src/lib/settings-store.ts";

function setMotion(value) {
  setSettingsState({ settings: { ...defaultSettings, motion: value }, revision: getSettingsState().revision + 1 });
}

test("Motion resolves System, On, and Off against the OS preference", () => {
  assert.deepEqual(MOTION_MODES, ["system", "on", "off"]);
  assert.equal(motionIsOff("system", false), false);
  assert.equal(motionIsOff("system", true), true);
  assert.equal(motionIsOff("on", false), false);
  assert.equal(motionIsOff("on", true), false);
  assert.equal(motionIsOff("off", false), true);
  assert.equal(motionIsOff("off", true), true);
});

test("stored Motion choice drives effective motion with the OS preference", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let osReduced = false;
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: osReduced }) } });
  try {
    for (const [value, expected] of [["system", "system"], ["on", "on"], ["off", "off"]]) {
      setMotion(value);
      assert.equal(getMotionMode(), expected, `stored ${value}`);
    }
    setMotion("on");
    osReduced = true;
    assert.equal(motionIsCurrentlyOff(), false);
    setMotion("system");
    assert.equal(motionIsCurrentlyOff(), true);
    osReduced = false;
    setMotion("off");
    assert.equal(motionIsCurrentlyOff(), true);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});

test("CSS motion times convert to milliseconds in either unit", () => {
  assert.equal(cssTimeToMs("560ms", 1), 560);
  assert.equal(cssTimeToMs(" .56s", 1), 560, "Built stylesheets may shorten 560ms to .56s");
  assert.equal(cssTimeToMs("0.16s", 1), 160);
  assert.equal(cssTimeToMs("", 190), 190);
  assert.equal(cssTimeToMs("fast", 190), 190);
});
