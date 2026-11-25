import test from "node:test";
import assert from "node:assert/strict";
import { followScrollTarget } from "../js/timeline.js";

function assertCloseTo(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be close to ${expected}`
  );
}

test("keeps the scroll position when the page with context already fits", () => {
  // ページ高448px、表示高600pxの場合、余白は(600 - 448) * 0.3 = 45.6。
  const target = followScrollTarget({
    pageTop: 1000,
    pageHeight: 448,
    cursorY: 1200,
    viewHeight: 600,
    scrollTop: 920,
  });
  assertCloseTo(target, 920);
});

test("scrolls down minimally so the page and context become visible", () => {
  // ページ開始位置が2000の場合、範囲の下端は2000 + 448 + 45.6 = 2493.6。
  const target = followScrollTarget({
    pageTop: 2000,
    pageHeight: 448,
    cursorY: 2100,
    viewHeight: 600,
    scrollTop: 800,
  });
  assertCloseTo(target, 1893.6);
});

test("scrolls up minimally so the page and context become visible", () => {
  // ページ開始位置が200の場合、範囲の上端は200 - 45.6 = 154.4。
  const target = followScrollTarget({
    pageTop: 200,
    pageHeight: 448,
    cursorY: 300,
    viewHeight: 600,
    scrollTop: 1000,
  });
  assertCloseTo(target, 154.4);
});

test("clamps to the top of the timeline for the first page", () => {
  const target = followScrollTarget({
    pageTop: 0,
    pageHeight: 448,
    cursorY: 100,
    viewHeight: 600,
    scrollTop: 800,
  });
  assert.equal(target, 0);
});

test("aligns the page exactly when the page fills the whole view", () => {
  const target = followScrollTarget({
    pageTop: 1000,
    pageHeight: 600,
    cursorY: 1300,
    viewHeight: 600,
    scrollTop: 500,
  });
  assertCloseTo(target, 1000);
});

test("anchors to the top edge with a quarter-note margin when the page is taller than the view", () => {
  // ページ[2000, 3000]、表示高600、ブロック高56なら余白は56、表示範囲は[1944, 2544]。
  const target = followScrollTarget({
    pageTop: 2000,
    pageHeight: 1000,
    cursorY: 2050,
    viewHeight: 600,
    scrollTop: 800,
    blockHeight: 56,
  });
  assertCloseTo(target, 1944);
});

test("anchors to the bottom edge when the cursor is nearer the page bottom", () => {
  // カーソルが2900なら表示範囲は[2456, 3056]となり、ページ下端から次ページ側に56px進む。
  const target = followScrollTarget({
    pageTop: 2000,
    pageHeight: 1000,
    cursorY: 2900,
    viewHeight: 600,
    scrollTop: 3400,
    blockHeight: 56,
  });
  assertCloseTo(target, 2456);
});

test("keeps the scroll position when the anchored range is already visible", () => {
  const target = followScrollTarget({
    pageTop: 2000,
    pageHeight: 1000,
    cursorY: 2050,
    viewHeight: 600,
    scrollTop: 1944,
    blockHeight: 56,
  });
  assertCloseTo(target, 1944);
});

test("prefers the top edge when the cursor is at the exact midpoint", () => {
  const target = followScrollTarget({
    pageTop: 2000,
    pageHeight: 1000,
    cursorY: 2500,
    viewHeight: 600,
    scrollTop: 2456,
    blockHeight: 56,
  });
  assertCloseTo(target, 1944);
});

test("keeps the cursor on screen when the anchored window cannot reach it", () => {
  // 表示領域が非常に小さい場合、余白は表示高の25%で制限される（75 < 96）。
  // 余白を維持するよりカーソルを表示領域内に収める。
  const nearTop = followScrollTarget({
    pageTop: 2000,
    pageHeight: 1000,
    cursorY: 2300,
    viewHeight: 300,
    scrollTop: 800,
    blockHeight: 96,
  });
  assertCloseTo(nearTop, 2000);
  const nearBottom = followScrollTarget({
    pageTop: 2000,
    pageHeight: 1000,
    cursorY: 2600,
    viewHeight: 300,
    scrollTop: 3400,
    blockHeight: 96,
  });
  assertCloseTo(nearBottom, 2600);
});

test("returns the scroll position unchanged without a usable view height", () => {
  const target = followScrollTarget({
    pageTop: 1000,
    pageHeight: 448,
    cursorY: 1200,
    viewHeight: 0,
    scrollTop: 321,
  });
  assert.equal(target, 321);
});
