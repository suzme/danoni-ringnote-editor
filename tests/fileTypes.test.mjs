import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFile,
  extensionOf,
  isAudioFile,
  isChartFile,
  isJsonFile,
  looksLikeChartText,
} from "../js/fileTypes.js";

test("classifies audio files by MIME and extension", () => {
  assert.equal(classifyFile({ name: "song.mp3", type: "audio/mpeg" }), "audio");
  assert.equal(classifyFile({ name: "song.wav", type: "" }), "audio");
  assert.equal(classifyFile({ name: "song.ogg", type: "application/octet-stream" }), "audio");
  assert.equal(isAudioFile({ name: "voice.m4a", type: "" }), true);
});

test("classifies project JSON files", () => {
  assert.equal(classifyFile({ name: "chart.json", type: "application/json" }), "project");
  assert.equal(classifyFile({ name: "chart.json", type: "text/plain" }), "project");
  assert.equal(isJsonFile({ name: "project.json", type: "" }), true);
});

test("classifies chart text files", () => {
  assert.equal(classifyFile({ name: "score.txt", type: "text/plain" }), "chart");
  assert.equal(classifyFile({ name: "score.dos", type: "" }), "chart");
  assert.equal(classifyFile({ name: "score", type: "text/plain" }), "chart");
  assert.equal(classifyFile({ name: "image.png", type: "image/png" }), "unknown");
});

test("detects chart text for unknown extensions", () => {
  assert.equal(looksLikeChartText("|musicTitle=Test|\n|ring_data=\n200,300,250\n|"), true);
  assert.equal(looksLikeChartText("|es_label=1|es_bpm=140|"), true);
  assert.equal(looksLikeChartText("hello | world = test"), false);
  assert.equal(looksLikeChartText(""), false);
});

test("extensionOf handles names and paths", () => {
  assert.equal(extensionOf("folder/song.MP3"), ".mp3");
  assert.equal(extensionOf("no-extension"), "");
});
