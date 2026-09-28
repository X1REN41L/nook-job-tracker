import assert from "node:assert/strict";
import { test } from "node:test";
import { MOTION_MODES, motionIsOff } from "../src/lib/motion-mode.ts";
import { getMotionMode, motionIsCurrentlyOff } from "../src/lib/general-preferences.ts";
import { defaultSettings } from "../src/lib/settings-defaults.ts";
import { setSettingsState } from "../src/lib/settings-store.ts";

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
      setSettingsState({ settings: { ...defaultSettings, motion: value }, revision: 0 });
      assert.equal(getMotionMode(), expected, `stored ${value}`);
    }
    setSettingsState({ settings: { ...defaultSettings, motion: "on" }, revision: 0 });
    osReduced = true;
    assert.equal(motionIsCurrentlyOff(), false);
    setSettingsState({ settings: { ...defaultSettings, motion: "system" }, revision: 0 });
    assert.equal(motionIsCurrentlyOff(), true);
    osReduced = false;
    setSettingsState({ settings: { ...defaultSettings, motion: "off" }, revision: 0 });
    assert.equal(motionIsCurrentlyOff(), true);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
