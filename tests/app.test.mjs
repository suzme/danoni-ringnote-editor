import test from "node:test";
import assert from "node:assert/strict";
import { App } from "../js/app.js";
import { normalizeLn, normalizeRing, normalizeSpeed } from "../js/model.js";
import { frameForPagePosition, framePerPosition, pageSpan, timingForPage } from "../js/timing.js";

class FakeAudio {
  constructor() {
    this.preload = "";
    this.volume = 1;
    this.src = "";
    this.duration = 0;
  }

  load() {}
  pause() {}
  play() {
    return Promise.resolve();
  }
  addEventListener() {}
  removeEventListener() {}
}

globalThis.window = {
  addEventListener() {},
  setTimeout() {
    return 0;
  },
  clearTimeout() {},
};
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.Audio = FakeAudio;

function newApp() {
  return new App();
}

function addRing(app, overrides = {}) {
  const id = overrides.id ?? "r1";
  const ring = normalizeRing(
    { id, page: 1, position: 0, x: 100, y: 100, sound: 1, radius: 50, color: "", frames: 0, ...overrides },
    id
  );
  app.project.rings.push(ring);
  return ring;
}

function addLn(app, overrides = {}) {
  const id = overrides.id ?? "ln1";
  const ln = normalizeLn(
    { id, page: 1, position: 100, endPage: 1, endPosition: 200, count: 4, ...overrides },
    id
  );
  app.project.lns.push(ln);
  return ln;
}

test("undo and redo restore committed changes", () => {
  const app = newApp();
  app.commit((project) => {
    project.blankFrame = 300;
  });
  assert.equal(app.project.blankFrame, 300);
  assert.equal(app.history.past.length, 1);

  app.undo();
  assert.equal(app.project.blankFrame, 200);
  assert.equal(app.history.future.length, 1);

  app.redo();
  assert.equal(app.project.blankFrame, 300);
  assert.equal(app.history.future.length, 0);
});

test("a commit without changes adds no history", () => {
  const app = newApp();
  app.commit(() => {});
  assert.equal(app.history.past.length, 0);
});

test("transactions collapse multiple direct updates into one undo step", () => {
  const app = newApp();
  app.beginTransaction();
  app.updateDirect((project) => {
    project.title = "A";
  });
  app.updateDirect((project) => {
    project.blankFrame = 400;
  });
  app.endTransaction();

  assert.equal(app.history.past.length, 1);
  app.undo();
  assert.equal(app.project.title, "");
  assert.equal(app.project.blankFrame, 200);
});

test("updateLn keeps the end after the start", () => {
  const endApp = newApp();
  addLn(endApp);
  endApp.updateLn("ln1", { endPosition: 50 });
  assert.equal(endApp.getLn("ln1").endPage, 1);
  assert.equal(endApp.getLn("ln1").endPosition, 101);

  const startApp = newApp();
  addLn(startApp);
  startApp.updateLn("ln1", { position: 300 });
  assert.equal(startApp.getLn("ln1").position, 199);
});

test("updateLn computes the end from duration", () => {
  const app = newApp();
  addLn(app);
  app.updateLn("ln1", { duration: 0.5 });
  const ln = app.getLn("ln1");
  assert.equal(ln.endPage, 1);
  assert.equal(ln.endPosition, 292);
});

test("decomposeSelectedLn replaces the LN with single rings", () => {
  const app = newApp();
  addLn(app);
  app.ui.selectedLnId = "ln1";
  app.decomposeSelectedLn();
  assert.equal(app.project.lns.length, 0);
  assert.equal(app.project.rings.length, 4);
  assert.ok(app.ui.selectedRingId);
});

test("copyPage and pastePage copy rings, LNs and speeds", () => {
  const app = newApp();
  const per = framePerPosition(timingForPage(app.project.timings, 1));
  addRing(app, { id: "r1", position: 48 });
  addLn(app, { id: "ln1", position: 0, endPosition: 192 });
  app.project.speeds.push(
    normalizeSpeed({ id: "s1", type: "speed", frame: 200 + 96 * per, value: 2 }, "s1")
  );

  app.copyPage(1);
  assert.equal(app.clipboard.kind, "page");
  app.pastePage(2);

  const data = app.getPageData(2);
  assert.equal(data.rings.length, 1);
  assert.equal(data.rings[0].position, 48);
  assert.equal(data.lns.length, 1);
  assert.ok(Math.abs(data.lns[0].duration - 0.5) < 1e-9);
  assert.equal(data.speeds.length, 1);

  const pastedSpeed = app.project.speeds.find((speed) => speed.id !== "s1");
  const expectedFrame = frameForPagePosition(app.project, 2, 96);
  assert.equal(pastedSpeed.value, 2);
  assert.ok(Math.abs(pastedSpeed.frame - expectedFrame) < 1e-6);
});

test("cutPage only cuts the target page contents", () => {
  const app = newApp();
  addRing(app, { id: "r1", page: 1 });
  addRing(app, { id: "r2", page: 2 });

  app.cutPage(2);
  assert.equal(app.clipboard.kind, "page");
  assert.deepEqual(app.project.rings.map((ring) => ring.id), ["r1"]);
});

test("deletePage removes the target page and shifts following pages forward", () => {
  const app = newApp();
  app.project.timings = [{ label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 }];
  addRing(app, { id: "r1", page: 1 });
  addRing(app, { id: "r2", page: 2 });
  addRing(app, { id: "r3", page: 3 });
  addLn(app, { id: "ln-cross", page: 1, position: 0, endPage: 3, endPosition: 96 });
  addLn(app, { id: "ln-target", page: 2, position: 0, endPage: 2, endPosition: 96 });
  addLn(app, { id: "ln-later", page: 3, position: 0, endPage: 3, endPosition: 96 });
  const page2Start = frameForPagePosition(app.project, 2, 0);
  const delta = frameForPagePosition(app.project, 3, 0) - page2Start;
  app.project.speeds.push(
    normalizeSpeed({ id: "s1", type: "speed", frame: page2Start + 100, value: 2 }, "s1"),
    normalizeSpeed({ id: "s2", type: "speed", frame: page2Start + delta + 100, value: 3 }, "s2")
  );

  app.deletePage(2);

  assert.deepEqual(
    app.project.rings.map((ring) => [ring.id, ring.page]),
    [["r1", 1], ["r3", 2]]
  );
  assert.deepEqual(
    app.project.lns.map((ln) => [ln.id, ln.page, ln.endPage]),
    [["ln-cross", 1, 2], ["ln-later", 2, 2]]
  );
  assert.deepEqual(app.project.speeds.map((speed) => speed.id), ["s2"]);
  assert.ok(Math.abs(app.project.speeds[0].frame - (page2Start + 100)) < 1e-6);
});

test("deletePage ends a crossing LN at the previous page boundary", () => {
  const app = newApp();
  app.project.timings = [{ label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 }];
  addLn(app, { id: "ln1", page: 1, position: 300, endPage: 2, endPosition: 100 });
  const page1Span = pageSpan(timingForPage(app.project.timings, 1));

  app.deletePage(2);

  assert.deepEqual(
    app.project.lns.map((ln) => [ln.id, ln.page, ln.position, ln.endPage, ln.endPosition]),
    [["ln1", 1, 300, 1, page1Span]]
  );
  assert.ok(!app.validate().some((warning) => warning.message.includes("終点時間が始点より前")));
});

test("deletePage shifts labels and keeps a page 1 label", () => {
  const app = newApp();
  const label3Start = frameForPagePosition(app.project, 3, 0);
  app.project.timings = [
    { label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 },
    { label: 3, startNum: label3Start - app.project.blankFrame, bpm: 120, pageBlockNum: 4 },
  ];
  addRing(app, { id: "r3", page: 3 });
  const page2Start = frameForPagePosition(app.project, 2, 0);

  app.deletePage(2);

  assert.deepEqual(app.project.timings.map((timing) => timing.label), [1, 2]);
  const shifted = app.project.timings.find((timing) => timing.label === 2);
  assert.ok(Math.abs(shifted.startNum - (label3Start - page2Start)) < 1e-6);
  assert.deepEqual(app.project.rings.map((ring) => [ring.id, ring.page]), [["r3", 2]]);

  app.deletePage(1);
  assert.deepEqual(app.project.timings.map((timing) => timing.label), [1]);
  assert.deepEqual(app.project.rings.map((ring) => [ring.id, ring.page]), [["r3", 1]]);
});

test("deletePage can remove an empty page and keeps timing on page 1", () => {
  const app = newApp();
  app.project.timings = [{ label: 1, startNum: 0, bpm: 100, pageBlockNum: 4 }];
  addRing(app, { id: "r3", page: 3 });

  app.deletePage(2);
  assert.deepEqual(app.project.rings.map((ring) => [ring.id, ring.page]), [["r3", 2]]);

  app.deletePage(1);
  assert.deepEqual(app.project.timings.map((timing) => timing.label), [1]);
  assert.equal(app.project.timings[0].bpm, 100);
  assert.equal(app.project.timings[0].pageBlockNum, 4);
  assert.deepEqual(app.project.rings.map((ring) => [ring.id, ring.page]), [["r3", 1]]);
});

test("deletePage removes the target label and shifts later labels", () => {
  const app = newApp();
  const timing1 = { label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 };
  const page1Frames = pageSpan(timing1) * framePerPosition(timing1);
  const timing2 = { label: 2, startNum: page1Frames, bpm: 120, pageBlockNum: 4 };
  const page2Frames = pageSpan(timing2) * framePerPosition(timing2);
  app.project.timings = [
    timing1,
    timing2,
    { label: 4, startNum: page1Frames + 2 * page2Frames, bpm: 100, pageBlockNum: 8 },
  ];
  addRing(app, { id: "r4", page: 4 });

  app.deletePage(2);

  assert.deepEqual(app.project.timings.map((timing) => timing.label), [1, 3]);
  const shifted = app.project.timings.find((timing) => timing.label === 3);
  assert.ok(Math.abs(shifted.startNum - (page1Frames + page2Frames)) < 1e-6);
  assert.deepEqual(app.project.rings.map((ring) => [ring.id, ring.page]), [["r4", 3]]);
});

test("deletePage is a single undoable operation", () => {
  const app = newApp();
  addRing(app, { id: "r1", page: 1 });
  addRing(app, { id: "r3", page: 3 });

  app.deletePage(2);
  assert.deepEqual(app.project.rings.map((ring) => [ring.id, ring.page]), [["r1", 1], ["r3", 2]]);

  app.undo();
  assert.deepEqual(app.project.rings.map((ring) => [ring.id, ring.page]), [["r1", 1], ["r3", 3]]);

  app.redo();
  assert.deepEqual(app.project.rings.map((ring) => [ring.id, ring.page]), [["r1", 1], ["r3", 2]]);
});

test("insertPage(1) shifts notes and adds a new page 1 label", () => {
  const app = newApp();
  app.project.timings = [
    { label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 },
    { label: 3, startNum: 240, bpm: 120, pageBlockNum: 4 },
  ];
  addRing(app, { id: "r1", page: 1 });
  addRing(app, { id: "r2", page: 3 });
  addLn(app, { id: "ln1", page: 1, position: 0, endPage: 1, endPosition: 96 });
  app.project.speeds.push(normalizeSpeed({ id: "s1", type: "speed", frame: 200, value: 2 }, "s1"));
  const delta = 384 * (75 / 140);

  app.insertPage(1);

  assert.deepEqual(app.project.timings.map((timing) => timing.label), [1, 2, 4]);
  const added = app.project.timings.find((timing) => timing.label === 1);
  assert.equal(added.startNum, 0);
  assert.equal(added.bpm, 140);
  const shifted = app.project.timings.find((timing) => timing.label === 2);
  assert.ok(Math.abs(shifted.startNum - delta) < 1e-9);
  const label4 = app.project.timings.find((timing) => timing.label === 4);
  assert.ok(Math.abs(label4.startNum - (240 + delta)) < 1e-9);

  assert.deepEqual(app.project.rings.map((ring) => ring.page).sort(), [2, 4]);
  assert.equal(app.project.lns[0].page, 2);
  assert.equal(app.project.lns[0].endPage, 2);
  assert.ok(Math.abs(app.project.speeds[0].frame - (200 + delta)) < 1e-9);
});

test("validate reports a clean project", () => {
  const app = newApp();
  assert.deepEqual(app.validate(), [{ level: "ok", message: "問題は見つかりませんでした。" }]);
});

test("validate warns about off-screen and duplicate rings", () => {
  const app = newApp();
  addRing(app, { id: "r1", page: 1, position: 0, x: -10, y: 10 });
  addRing(app, { id: "r2", page: 1, position: 0, x: 100, y: 100 });
  addRing(app, { id: "r3", page: 1, position: 0, x: 100, y: 100 });

  const messages = app.validate().map((warning) => warning.message);
  assert.ok(messages.some((message) => message.includes("画面外")));
  assert.ok(messages.some((message) => message.includes("同じ時間・座標")));
});

test("validate warns about an LN ending before its start", () => {
  const app = newApp();
  addLn(app, { id: "ln1", page: 1, position: 100, endPage: 1, endPosition: 50 });

  const messages = app.validate().map((warning) => warning.message);
  assert.ok(messages.some((message) => message.includes("終点時間が始点より前")));
});

test("validate reports reversed label frames, invalid BPM and zero speed", () => {
  const app = newApp();
  app.project.timings = [
    { label: 1, startNum: 0, bpm: 0, pageBlockNum: 8 },
    { label: 2, startNum: -50, bpm: 140, pageBlockNum: 8 },
  ];
  app.project.speeds.push(normalizeSpeed({ id: "s1", type: "speed", frame: 0, value: 0 }, "s1"));

  const messages = app.validate().map((warning) => warning.message);
  assert.ok(messages.some((message) => message.includes("のBPMが不正")));
  assert.ok(messages.some((message) => message.includes("開始フレーム")));
  assert.ok(messages.some((message) => message.includes("速度が0")));
});
