import test from "node:test";
import assert from "node:assert/strict";
import {
  beatPositionForPagePosition,
  expandLn,
  formatSeconds,
  frameAt,
  framePerPosition,
  frameForPagePosition,
  lnDistortionFromMidpoint,
  lnDurationRatio,
  lnEndForDuration,
  lnPointAt,
  maxPageOfProject,
  normalizePagePosition,
  pageRange,
  pageSpan,
  positionsBetween,
  timingAndPositionAtFrame,
  timingForPage,
} from "../js/timing.js";
import { defaultProject } from "../js/model.js";

test("default project frame conversion", () => {
  const project = defaultProject();
  const timing = timingForPage(project.timings, 1);
  assert.equal(framePerPosition(timing), 75 / 140);
  assert.equal(frameAt(project, timing, 1, 0), 200);
  assert.ok(Math.abs(frameAt(project, timing, 1, 48) - (200 + 48 * (75 / 140))) < 1e-9);
  assert.ok(Math.abs(frameForPagePosition(project, 2, 0) - (200 + 384 * (75 / 140))) < 1e-9);
});

test("musical beat position continues across pages and timing labels", () => {
  const project = {
    ...defaultProject(),
    timings: [
      { label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 },
      { label: 3, startNum: 240, bpm: 120, pageBlockNum: 4 },
    ],
  };

  assert.equal(beatPositionForPagePosition(project, 1, 48), 1);
  assert.equal(beatPositionForPagePosition(project, 2, 0), 8);
  assert.equal(beatPositionForPagePosition(project, 3, 0), 16);
  assert.equal(beatPositionForPagePosition(project, 4, 24), 20.5);
});

test("label and page block conversion matches the existing editor model", () => {
  const project = {
    ...defaultProject(),
    timings: [
      { label: 1, startNum: 0, bpm: 180, pageBlockNum: 8 },
      { label: 3, startNum: 240, bpm: 120, pageBlockNum: 8 },
    ],
  };
  assert.equal(frameForPagePosition(project, 1, 0), 200);
  assert.equal(frameForPagePosition(project, 3, 0), 440);
  assert.ok(Math.abs(frameForPagePosition(project, 4, 0) - 680) < 1e-9);

  const back = timingAndPositionAtFrame(project, 680);
  assert.equal(back.page, 4);
  assert.ok(Math.abs(back.position) < 1e-6);

  const range = pageRange(project, 3);
  assert.equal(range.startFrame, 440);
  assert.equal(range.endFrame, 680);
});

test("page block count changes the page span", () => {
  const project = {
    ...defaultProject(),
    timings: [{ label: 1, startNum: 0, bpm: 140, pageBlockNum: 7 }],
  };
  const timing = timingForPage(project.timings, 1);
  assert.equal(pageSpan(timing), 7 * 48);
  const expected = 200 + 7 * 48 * (75 / 140);
  assert.ok(Math.abs(frameForPagePosition(project, 2, 0) - expected) < 1e-9);
});

test("normalizePagePosition wraps across pages", () => {
  const project = defaultProject();
  const span = pageSpan(timingForPage(project.timings, 1));
  const next = normalizePagePosition(project, 1, span);
  assert.equal(next.page, 2);
  assert.equal(next.position, 0);
  const prev = normalizePagePosition(project, 2, -1);
  assert.equal(prev.page, 1);
  assert.equal(prev.position, span - 1);
});

test("max page ignores frame based speed entries", () => {
  const project = defaultProject();
  project.speeds.push({ id: "s1", type: "speed", frame: 900, value: 2 });
  assert.equal(maxPageOfProject(project, 1), 2);
});

test("lnPointAt follows CIRRING LN curve formula (50px right offset at distortion=1)", () => {
  const ln = {
    startX: 100,
    startY: 200,
    endX: 300,
    endY: 200,
    distortion: 1,
  };
  // 右方向（+x）では右手系の法線が下方向（+y）になるため、中点（t=0.5）はy方向に+50px移動する。
  const midRight = lnPointAt(ln, 0.5);
  assert.ok(Math.abs(midRight.x - 200) < 1e-9);
  assert.ok(Math.abs(midRight.y - 250) < 1e-9);

  // 歪みが負の場合は左（-y）に曲がる。
  const midLeft = lnPointAt({ ...ln, distortion: -1 }, 0.5);
  assert.ok(Math.abs(midLeft.x - 200) < 1e-9);
  assert.ok(Math.abs(midLeft.y - 150) < 1e-9);

  // 中点から歪み量を求め、元の値に戻ることを確認する。
  assert.equal(lnDistortionFromMidpoint(ln, 200, 250), 1);
  assert.equal(lnDistortionFromMidpoint(ln, 200, 150), -1);
});

test("expandLn supports CIRRING mode (t = i/N) and includeEnd mode (t = i/(N-1))", () => {
  const project = defaultProject();
  const endLoc = lnEndForDuration(project, 1, 0, 0.5); // 0.5ページは192位置。
  assert.equal(endLoc.page, 1);
  assert.equal(endLoc.position, 192);

  const ln = {
    id: "ln1",
    page: 1,
    position: 0,
    endPage: endLoc.page,
    endPosition: endLoc.position,
    startX: 100,
    startY: 100,
    endX: 500,
    endY: 300,
    count: 4,
    distortion: 0,
    includeEnd: false,
    sound: 2,
    endSound: 3,
    radius: 45,
    color: "#00ffcc",
    frames: 50,
  };

  assert.equal(lnDurationRatio(project, ln), 0.5);
  assert.equal(positionsBetween(project, 1, 0, 1, 192), 192);

  // CIRRING形式ではt=0、0.25、0.5、0.75となり、終点の1つ手前で止まる。
  const cirringRings = expandLn(project, ln);
  assert.equal(cirringRings.length, 4);
  assert.deepEqual(
    cirringRings.map((r) => r.position),
    [0, 48, 96, 144]
  );
  assert.deepEqual(
    cirringRings.map((r) => r.x),
    [100, 200, 300, 400]
  );
  assert.deepEqual(
    cirringRings.map((r) => r.sound),
    [2, 3, 3, 3]
  );

  // includeEnd有効時はt=0、1/3、2/3、1となり、最後のリングが終点の座標と位置に重なる。
  const inclusiveRings = expandLn(project, { ...ln, includeEnd: true });
  assert.equal(inclusiveRings.length, 4);
  assert.equal(inclusiveRings[0].position, 0);
  assert.equal(inclusiveRings[3].position, 192);
  assert.equal(inclusiveRings[3].x, 500);
  assert.equal(inclusiveRings[3].y, 300);
});

test("timingAndPositionAtFrame uses the previous label before a label start", () => {
  const project = {
    ...defaultProject(),
    timings: [
      { label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 },
      { label: 3, startNum: 240, bpm: 120, pageBlockNum: 4 },
    ],
  };
  const loc = timingAndPositionAtFrame(project, 400);
  assert.equal(loc.timing.label, 1);
  assert.equal(loc.page, 1);
  assert.ok(Math.abs(loc.position - 373.333333) < 1e-6);
  assert.ok(Math.abs(frameAt(project, loc.timing, loc.page, loc.position) - 400) < 1e-5);
});

test("lnPointAt clamps to the screen bounds when requested", () => {
  const ln = { startX: 50, startY: 100, endX: 900, endY: 600, distortion: 0 };
  const raw = lnPointAt(ln, 1);
  assert.equal(raw.x, 900);
  assert.equal(raw.y, 600);

  const clamped = lnPointAt(ln, 1, { width: 400, height: 500 });
  assert.equal(clamped.x, 400);
  assert.equal(clamped.y, 500);

  const start = lnPointAt(ln, 0, { width: 400, height: 500 });
  assert.equal(start.x, 50);
  assert.equal(start.y, 100);
});

test("formatSeconds clamps negatives and carries milliseconds into minutes", () => {
  assert.equal(formatSeconds(-5), "0:00.000");
  assert.equal(formatSeconds(61.5), "1:01.500");
  assert.equal(formatSeconds(59.9996), "1:00.000");
  assert.equal(formatSeconds(119.9996), "2:00.000");
});
