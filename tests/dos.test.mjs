import test from "node:test";
import assert from "node:assert/strict";
import { defaultProject } from "../js/model.js";
import {
  buildSections,
  buildSnippet,
  extractMetadata,
  mergeChart,
  parseChart,
  parseDos,
  parseReferenceNoteFrames,
  replaceDosSection,
} from "../js/dos.js";

const SAMPLE = `|blankFrame=200|
|ring_data=
300,150,200,1
360,350,200,2,40,#ffcc00
600,250,200,6,,,90
|
|ring_speed_data=
0,1
700,2
|
|ring_boost_data=
400,2
|
|endFrame=1000|`;

test("parse DOS sections and ring data", () => {
  const { map } = parseDos(SAMPLE);
  assert.equal(map.blankFrame, "200");
  const chart = parseChart(SAMPLE);
  assert.equal(chart.meta.blankFrame, 200);
  assert.equal(chart.rings.length, 3);
  assert.equal(chart.rings[0].x, 150);
  assert.equal(chart.rings[1].radius, 40);
  assert.equal(chart.rings[1].color, "#ffcc00");
  assert.equal(chart.rings[2].frames, 90);
  assert.equal(chart.speeds.length, 3);
  assert.equal(chart.speeds[0].type, "speed");
  assert.equal(chart.speeds[0].frame, 0);
  assert.equal(chart.speeds[1].frame, 700);
  assert.equal(chart.speeds[2].type, "boost");
  assert.equal(chart.speeds[2].frame, 400);
  assert.equal(chart.meta.timings[0].bpm, 140);
});

test("score number selects ring2_data", () => {
  const text = `|es_scoreNumber=2|\n|ring2_data=\n200,10,20\n|\n|ring_speed2_data=\n200,1.5\n|`;
  const chart = parseChart(text);
  assert.equal(chart.meta.scoreNumber, 2);
  assert.equal(chart.rings.length, 1);
  assert.equal(chart.speeds.length, 1);
});

test("score number is inferred from ring2_data and blankFrame list", () => {
  const text = `|blankFrame=200,320|\n|ring2_data=\n400,10,20\n|`;
  const chart = parseChart(text);
  assert.equal(chart.meta.scoreNumber, 2);
  assert.equal(chart.meta.blankFrame, 320);
});

test("merge keeps other scores' blankFrame values", () => {
  const project = defaultProject();
  project.scoreNumber = 2;
  project.blankFrame = 350;
  project.rings.push({ id: "r1", page: 1, position: 0, x: 300, y: 250, sound: 1, radius: 50, color: "", frames: 0 });
  const merged = mergeChart("|blankFrame=200,300|\n|ring2_data=\n1,2,3\n|", project, {});
  assert.match(merged, /\|blankFrame=200,350\|/);
  assert.match(merged, /\|ring2_data=\n350,300,250\n\|/);
  assert.match(merged, /\|es_scoreNumber=2\|/);
});

test("merge can build a complete chart without an imported source", () => {
  const project = defaultProject();
  project.timings[0].bpm = 175;
  project.rings.push({ id: "r1", page: 1, position: 0, x: 300, y: 250, sound: 1, radius: 50, color: "", frames: 0 });

  const merged = mergeChart("|", project, { removeEmpty: true });
  assert.match(merged, /^\|ring_data=\n200,300,250\n\|/);
  assert.match(merged, /\|es_bpm=175\|/);
  assert.match(merged, /\|es_label=1\|/);
  assert.match(merged, /\|es_startNumber=0\|/);
});

test("export trims optional ring fields", () => {
  const project = defaultProject();
  project.rings.push({ id: "r1", page: 1, position: 0, x: 300, y: 250, sound: 1, radius: 50, color: "", frames: 0 });
  project.rings.push({ id: "r2", page: 1, position: 0, x: 320, y: 260, sound: 2, radius: 50, color: "#ffcc00", frames: 0 });
  project.rings.push({ id: "r3", page: 1, position: 0, x: 340, y: 270, sound: 1, radius: 50, color: "", frames: 90 });
  const { sections } = buildSections(project);
  const ring = sections.find((section) => section.kind === "ring");
  assert.equal(ring.key, "ring_data");
  assert.match(ring.value, /200,300,250\n/);
  assert.match(ring.value, /200,320,260,2,,#ffcc00\n/);
  assert.match(ring.value, /200,340,270,,,,90\n/);
});

test("score number changes output keys", () => {
  const project = defaultProject();
  project.scoreNumber = 2;
  const { sections } = buildSections(project, { includeEmpty: true });
  assert.equal(sections[0].key, "ring2_data");
  assert.equal(sections[1].key, "ring_speed2_data");
  assert.equal(sections[2].key, "ring_boost2_data");
});

test("frame based speed changes round-trip", () => {
  const project = defaultProject();
  project.speeds.push({ id: "s1", type: "speed", frame: 0, value: 1 });
  project.speeds.push({ id: "s2", type: "speed", frame: 700.5, value: 2 });
  project.speeds.push({ id: "s3", type: "boost", frame: 400, value: 1.5 });
  const snippet = buildSnippet(project);
  assert.match(snippet, /\|ring_speed_data=\n0,1\n700\.5,2\n\|/);
  assert.match(snippet, /\|ring_boost_data=\n400,1\.5\n\|/);

  const reparsed = parseChart(`|es_blankFrame=200|${snippet}`);
  assert.equal(reparsed.speeds.length, 3);
  assert.equal(reparsed.speeds[1].frame, 700.5);
});

test("snippet can include screen size headers", () => {
  const project = defaultProject();
  project.screen = { width: 760, height: 520 };
  project.rings.push({ id: "r1", page: 1, position: 0, x: 300, y: 250, sound: 1, radius: 50, color: "", frames: 0 });
  const snippet = buildSnippet(project, { includeScreen: true });
  assert.match(snippet, /^\|ringWidth=760\|\n/);
  assert.doesNotMatch(snippet, /playingWidth|playingHeight/);
  assert.match(snippet, /\|ring_data=\n200,300,250\n\|/);
});

test("snippet and merged chart keep unrelated sections", () => {
  const project = defaultProject();
  project.rings.push({ id: "r1", page: 1, position: 0, x: 300, y: 250, sound: 1, radius: 50, color: "", frames: 0 });
  const snippet = buildSnippet(project);
  assert.match(snippet, /^\|ring_data=\n200,300,250\n\|/);

  const original = `|musicTitle=Test|\n|blankFrame=200|\n|ring_data=\n1,2,3\n|\n|endFrame=1000|\n`;
  const merged = mergeChart(original, project, { removeEmpty: true, includeScreen: true });
  assert.match(merged, /\|musicTitle=Test\|/);
  assert.match(merged, /\|endFrame=1000\|/);
  assert.match(merged, /\|ring_data=\n200,300,250\n\|/);
  assert.doesNotMatch(merged, /\|playingWidth=/);
  assert.doesNotMatch(merged, /\|playingHeight=/);
  assert.match(merged, /\|ringWidth=600\|/);
  assert.match(merged, /\|blankFrame=200\|/);
  assert.match(merged, /\|es_label=1\|/);
});

test("merged chart only updates ringWidth and keeps existing playing size headers", () => {
  const project = defaultProject();
  const original = `|playingWidth=640|\n|playingHeight=480|\n|ringWidth=320|\n|ring_data=\n1,2,3\n|\n`;
  const merged = mergeChart(original, project, { removeEmpty: true, includeScreen: true });
  assert.match(merged, /\|playingWidth=640\|/);
  assert.match(merged, /\|playingHeight=480\|/);
  assert.match(merged, /\|ringWidth=600\|/);
});

test("replaceDosSection appends before the trailing separator", () => {
  const text = "|a=1|\n";
  const out = replaceDosSection(text, "b", "\n2\n");
  assert.match(out, /\|a=1\|b=\n2\n\|/);
});

test("buildSnippet expands LNs into ring_data", () => {
  const project = defaultProject();
  project.lns.push({
    id: "ln1",
    page: 1,
    position: 0,
    endPage: 1,
    endPosition: 192,
    startX: 100,
    startY: 200,
    endX: 300,
    endY: 200,
    count: 2,
    distortion: 0,
    includeEnd: false,
    sound: 1,
    endSound: 2,
    radius: 50,
    color: "",
    frames: 0,
  });
  const snippet = buildSnippet(project);
  assert.match(snippet, /200,100,200\n/);
  assert.match(snippet, /251\.429,200,200,2\n/);
});

test("parseDos normalizes BOM, CRLF and ampersand separators", () => {
  const { map } = parseDos("\uFEFF&a=1&\r\nb=2&");
  assert.equal(map.a, "1");
  assert.equal(map.b, "2");
});

test("parseReferenceNoteFrames keeps note data and ignores other sections", () => {
  const frames = parseReferenceNoteFrames({
    left_data: "10,20 30",
    right_data: "40",
    ring_data: "1,2,3",
    ring_speed_data: "0,1",
    color_data: "100,200",
    score_data: "5",
    broken_data: "not a number",
  });
  assert.deepEqual(frames, [10, 20, 30, 40]);
});

test("parseChart reports malformed ring and speed lines", () => {
  const chart = parseChart("|ring_data=\n200,10,20\nbad,line\n|ring_speed_data=\nxx,2\n|");
  assert.equal(chart.rings.length, 1);
  assert.equal(chart.warnings.length, 2);
  assert.match(chart.warnings[0], /ring_data/);
  assert.match(chart.warnings[1], /ring_speed_data/);
});

test("parseSpeeds reads multiple pairs per line and stops at a dash", () => {
  const chart = parseChart("|ring_speed_data=\n100,1.5,200,2\n300,-\n|");
  assert.deepEqual(
    chart.speeds.map((speed) => [speed.frame, speed.value]),
    [
      [100, 1.5],
      [200, 2],
    ]
  );
  assert.deepEqual(chart.warnings, []);
});

test("extractMetadata prefers ringWidth and clamps playingWidth", () => {
  assert.equal(extractMetadata("|playingWidth=800|").screen.width, 600);
  assert.equal(extractMetadata("|playingWidth=800|\n|ringWidth=700|").screen.width, 700);
  assert.equal(extractMetadata("|musicTitle=Song|").screen, null);
});

test("extractMetadata reads title and artist", () => {
  const meta = extractMetadata("|musicTitle=Song,Composer|\n|musicArtist=Someone|");
  assert.equal(meta.title, "Song");
  assert.equal(meta.artist, "Someone");
});
