import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../js/constants.js";
import { autoRingColor, normalizeSettings, ringDisplayColor } from "../js/model.js";

test("default settings no longer include zoom or background", () => {
  assert.equal("zoom" in DEFAULT_SETTINGS, false);
  assert.equal("background" in DEFAULT_SETTINGS, false);
});

test("normalizeSettings drops legacy zoom and background values", () => {
  const settings = normalizeSettings({ zoom: 140, background: "light", snap: 10 });
  assert.equal("zoom" in settings, false);
  assert.equal("background" in settings, false);
  assert.equal(settings.snap, 10);
});

test("ring display range is stored in beats and migrates legacy values", () => {
  assert.equal(DEFAULT_SETTINGS.displayRangeBeats, 4);
  assert.equal(normalizeSettings({ displayRange: "near" }).displayRangeBeats, 8);
  assert.equal(normalizeSettings({ displayRange: "all" }).displayRangeBeats, 16);
  assert.equal(normalizeSettings({ displayRangeBeats: 20 }).displayRangeBeats, 16);
  assert.equal("displayRange" in normalizeSettings({ displayRange: "page" }), false);
});

test("auto ring color is fixed to white on the dark canvas", () => {
  assert.equal(autoRingColor(), "#ffffff");
  assert.equal(autoRingColor("light"), "#000000");
  assert.equal(ringDisplayColor({ color: "" }), "#ffffff");
  assert.equal(ringDisplayColor({ color: "#ffcc00" }), "#ffcc00");
});

test("music offset is stored in frames with a one-time ms conversion", () => {
  const legacy = normalizeSettings({ musicOffset: 100 });
  assert.equal(legacy.musicOffset, 6); // 60fpsでは100msが6フレーム。
  assert.equal(legacy.musicOffsetUnit, "frame");

  const current = normalizeSettings({ musicOffset: 100, musicOffsetUnit: "frame" });
  assert.equal(current.musicOffset, 100);

  const clamped = normalizeSettings({ musicOffset: 500, musicOffsetUnit: "frame" });
  assert.equal(clamped.musicOffset, 100);
});
