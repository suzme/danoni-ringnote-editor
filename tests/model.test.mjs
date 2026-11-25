import test from "node:test";
import assert from "node:assert/strict";
import {
  formatNumber,
  normalizeColor,
  normalizeLn,
  normalizeProject,
  normalizeRing,
  normalizeSpeed,
  normalizeTimings,
} from "../js/model.js";
import { DEFAULT_RADIUS, MIN_RADIUS } from "../js/constants.js";

test("normalizeColor expands shorthand hex and rejects invalid values", () => {
  assert.equal(normalizeColor("#ABC"), "#aabbcc");
  assert.equal(normalizeColor(" #FFCC00 "), "#ffcc00");
  assert.equal(normalizeColor("ffcc00"), "#ffcc00");
  assert.equal(normalizeColor("#abcd"), "");
  assert.equal(normalizeColor("red"), "");
  assert.equal(normalizeColor(null), "");
});

test("formatNumber rounds, sanitizes and avoids negative zero", () => {
  assert.equal(formatNumber(1.23456, 3), "1.235");
  assert.equal(formatNumber(1 / 3, 3), "0.333");
  assert.equal(formatNumber(-0), "0");
  assert.equal(formatNumber(-0.0001, 3), "0");
  assert.equal(formatNumber("not a number"), "0");
});

test("normalizeTimings keeps the later duplicate and fills page 1", () => {
  const timings = normalizeTimings([
    { label: 3, startNum: 10, bpm: 0, pageBlockNum: 99 },
    { label: 3, startNum: 20, bpm: 150, pageBlockNum: 4 },
  ]);
  assert.deepEqual(
    timings.map((t) => [t.label, t.startNum, t.bpm, t.pageBlockNum]),
    [
      [1, 0, 150, 4],
      [3, 20, 150, 4],
    ]
  );
});

test("normalizeRing clamps fields and applies defaults", () => {
  const ring = normalizeRing(
    { page: "2.9", position: "abc", x: "10", y: "20", sound: 3.6, radius: 1, color: "#FFF", frames: -5 },
    "r1"
  );
  assert.equal(ring.id, "r1");
  assert.equal(ring.page, 2);
  assert.equal(ring.position, 0);
  assert.equal(ring.x, 10);
  assert.equal(ring.y, 20);
  assert.equal(ring.sound, 4);
  assert.equal(ring.radius, MIN_RADIUS);
  assert.equal(ring.color, "#ffffff");
  assert.equal(ring.frames, 0);

  const defaults = normalizeRing({}, "r2");
  assert.equal(defaults.x, 300);
  assert.equal(defaults.y, 250);
  assert.equal(defaults.radius, DEFAULT_RADIUS);
  assert.equal(defaults.sound, 1);
});

test("normalizeLn accepts legacy coordinate fields and clamps count", () => {
  const ln = normalizeLn({ x1: 10, y1: 20, x2: 30, y2: 40, count: 1, distortion: 25, page: 0 }, "ln1");
  assert.equal(ln.page, 1);
  assert.equal(ln.endPage, 1);
  assert.equal(ln.endPosition, 192);
  assert.deepEqual([ln.startX, ln.startY, ln.endX, ln.endY], [10, 20, 30, 40]);
  assert.equal(ln.count, 2);
  assert.equal(ln.distortion, 20);
  assert.equal(ln.endSound, ln.sound);
});

test("normalizeSpeed falls back to the speed type and clamps the frame", () => {
  const speed = normalizeSpeed({ type: "bogus", frame: -10, value: "2" }, "s1");
  assert.equal(speed.type, "speed");
  assert.equal(speed.frame, 0);
  assert.equal(speed.value, 2);
});

test("normalizeProject assigns missing ids and advances nextId", () => {
  const project = normalizeProject({
    nextId: 1,
    rings: [{ page: 1, position: 0 }, { page: 1, position: 1 }],
    lns: [{ page: 1, position: 0 }],
    speeds: [{ frame: 0, value: 1 }],
  });
  assert.deepEqual(project.rings.map((ring) => ring.id), ["r1", "r2"]);
  assert.deepEqual(project.lns.map((ln) => ln.id), ["ln3"]);
  assert.deepEqual(project.speeds.map((speed) => speed.id), ["s4"]);
  assert.equal(project.nextId, 5);
});

test("normalizeProject replaces duplicate explicit ids", () => {
  const project = normalizeProject({
    rings: [{ id: "r1" }, { id: "r1" }, { id: "custom" }],
  });
  const ids = project.rings.map((ring) => ring.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids[0], "r1");
  assert.equal(ids[2], "custom");
});

test("normalizeProject clamps metadata and timing values", () => {
  const project = normalizeProject({
    screen: { width: 50, height: 9000 },
    blankFrame: -10,
    scoreNumber: 0,
    timings: [{ label: 0, bpm: 0 }],
  });
  assert.equal(project.screen.width, 100);
  assert.equal(project.screen.height, 4000);
  assert.equal(project.blankFrame, 0);
  assert.equal(project.scoreNumber, 1);
  assert.equal(project.timings[0].label, 1);
  assert.equal(project.timings[0].bpm, 1);
});

test("normalizeProject deduplicates and sorts reference note frames", () => {
  const project = normalizeProject({ referenceNoteFrames: [3, "1", -2, 3, "x"] });
  assert.deepEqual(project.referenceNoteFrames, [1, 3]);
});

test("normalizeProject returns defaults for missing data", () => {
  const project = normalizeProject(null);
  assert.equal(project.blankFrame, 200);
  assert.equal(project.timings.length, 1);
  assert.equal(project.timings[0].label, 1);
  assert.deepEqual(project.screen, { width: 600, height: 500 });
});
