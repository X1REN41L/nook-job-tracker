import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

const motionSource = await readFile(new URL("../src/lib/motion-mode.ts", import.meta.url), "utf8");
const compiledMotion = ts.transpileModule(motionSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const motionModule = { exports: {} };
new Function("module", "exports", compiledMotion)(motionModule, motionModule.exports);
const { MOTION_MODES, motionIsOff } = motionModule.exports;

const preferencesSource = await readFile(new URL("../src/lib/general-preferences.ts", import.meta.url), "utf8");
const compiledPreferences = ts.transpileModule(preferencesSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const preferencesModule = { exports: {} };
const statuses = Object.fromEntries(["APPLIED", "ONLINE_ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED"].map((status) => [status, status]));
new Function("require", "module", "exports", compiledPreferences)(
  (specifier) => specifier === "@prisma/client" ? { Status: statuses }
    : specifier === "@/lib/motion-mode" ? motionModule.exports
      : specifier === "@/lib/settings-store" ? { getSettingsState: () => ({ settings: { motion: stored } }), subscribeSettings: () => {}, updateSettings: () => Promise.resolve() }
        : { settingsSchema: { partial: () => ({ parse: (value) => value }) } },
  preferencesModule,
  preferencesModule.exports,
);
const { getMotionMode, motionIsCurrentlyOff } = preferencesModule.exports;
let stored = "system";

test("Motion resolves System, On, and Off against the OS preference", () => {
  assert.deepEqual(MOTION_MODES, ["system", "on", "off"]);
  assert.equal(motionIsOff("system", false), false);
  assert.equal(motionIsOff("system", true), true);
  assert.equal(motionIsOff("on", false), false);
  assert.equal(motionIsOff("on", true), false);
  assert.equal(motionIsOff("off", false), true);
  assert.equal(motionIsOff("off", true), true);
});

test("database Motion choice drives effective motion when browser storage is unavailable", () => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  let osReduced = false;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("Browser storage unavailable"); } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: osReduced }) } });
  try {
    for (const [value, expected] of [["system", "system"], ["on", "on"], ["off", "off"]]) {
      stored = value;
      assert.equal(getMotionMode(), expected, `stored ${value}`);
    }
    stored = "on";
    osReduced = true;
    assert.equal(motionIsCurrentlyOff(), false);
    stored = "system";
    assert.equal(motionIsCurrentlyOff(), true);
    osReduced = false;
    stored = "off";
    assert.equal(motionIsCurrentlyOff(), true);
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else delete globalThis.localStorage;
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
  }
});
