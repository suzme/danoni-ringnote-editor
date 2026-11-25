import test from "node:test";
import assert from "node:assert/strict";
import { Playback } from "../js/playback.js";
import { FPS } from "../js/constants.js";

globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};

function createAudio() {
  const calls = { ring: [], playMusicAt: [], pauseMusic: 0, seekMusic: [], setMusicRate: [] };
  return {
    calls,
    playRingSound(no, volume) {
      calls.ring.push([no, volume]);
    },
    playMusicAt(seconds, rate, volume) {
      calls.playMusicAt.push([seconds, rate, volume]);
    },
    pauseMusic() {
      calls.pauseMusic += 1;
    },
    seekMusic(seconds) {
      calls.seekMusic.push(seconds);
    },
    setMusicRate(rate) {
      calls.setMusicRate.push(rate);
    },
    setMusicVolume() {},
  };
}

function tickTo(playback, frame) {
  const startFrame = playback.anchorFrame;
  const elapsed = ((frame - startFrame) / FPS / playback.rate) * 1000;
  playback._tick(playback.anchorWall + elapsed);
}

test("song 0:00 starts at the blank frame", () => {
  const playback = new Playback({});
  playback.originFrame = 200;
  playback.offsetFrames = 0;
  assert.equal(playback.chartSeconds(200), 0);
  assert.equal(playback.chartSeconds(200 + FPS), 1);
});

test("offset shifts the music in frames", () => {
  const playback = new Playback({});
  playback.originFrame = 200;
  playback.offsetFrames = 10;
  assert.equal(playback.chartSeconds(200), 10 / FPS);
  assert.equal(playback.chartSeconds(200 + FPS), (FPS + 10) / FPS);
});

test("rings fire once when the playhead passes their arrival", () => {
  const audio = createAudio();
  const playback = new Playback(audio, {
    ringsProvider: () => [
      { arrival: 200, sound: 1 },
      { arrival: 210, sound: 2 },
      { arrival: 220, sound: 0 },
      { arrival: 250, sound: 3 },
    ],
  });
  playback.start({ startFrame: 200, loopStart: 200, loopEnd: 400, loop: true });

  playback._tick(playback.anchorWall);
  assert.deepEqual(audio.calls.ring, [[1, 0.5]]);
  playback._tick(playback.anchorWall);
  assert.deepEqual(audio.calls.ring, [[1, 0.5]]);

  tickTo(playback, 260);
  assert.deepEqual(audio.calls.ring, [
    [1, 0.5],
    [2, 0.5],
    [3, 0.5],
  ]);
  playback._tick(playback.anchorWall);
  assert.equal(audio.calls.ring.length, 3);
  playback.stop({ silent: true });
});

test("looping wraps to the start and fires the tail before wrapping", () => {
  const audio = createAudio();
  const loops = [];
  const playback = new Playback(audio, {
    onLoop: (frame) => loops.push(frame),
    ringsProvider: () => [
      { arrival: 490, sound: 5 },
      { arrival: 405, sound: 6 },
    ],
  });
  playback.start({ startFrame: 480, loopStart: 400, loopEnd: 500, loop: true });

  tickTo(playback, 510);

  assert.deepEqual(loops, [400]);
  assert.deepEqual(audio.calls.ring, [
    [5, 0.5],
    [6, 0.5],
  ]);
  assert.ok(Math.abs(playback.currentFrame - 410) < 1e-9);
  playback.stop({ silent: true });
});

test("looping restarts the music at the wrapped frame", () => {
  const audio = createAudio();
  const playback = new Playback(audio, { ringsProvider: () => [] });
  playback.start({
    startFrame: 480,
    loopStart: 400,
    loopEnd: 500,
    loop: true,
    withAudio: true,
    originFrame: 200,
  });
  assert.equal(audio.calls.playMusicAt.length, 1);

  tickTo(playback, 510);
  assert.equal(audio.calls.playMusicAt.length, 2);
  const [seconds, rate] = audio.calls.playMusicAt[1];
  assert.ok(Math.abs(seconds - (410 - 200) / FPS) < 1e-9);
  assert.equal(rate, 1);
  playback.stop({ silent: true });
});

test("non-looping playback stops at the loop end", () => {
  const audio = createAudio();
  const states = [];
  const frames = [];
  const playback = new Playback(audio, {
    onStateChange: (state, options) => states.push([state, options]),
    onFrame: (frame) => frames.push(frame),
    ringsProvider: () => [{ arrival: 495, sound: 4 }],
  });
  playback.start({ startFrame: 480, loopStart: 400, loopEnd: 500, loop: false });

  tickTo(playback, 510);

  assert.equal(playback.running, false);
  assert.equal(playback.currentFrame, 500);
  assert.deepEqual(audio.calls.ring, [[4, 0.5]]);
  assert.equal(states[0][0], "playing");
  assert.equal(states[1][0], "stopped");
  assert.equal(states[1][1].keepFrame, true);
  assert.equal(audio.calls.pauseMusic, 1);
  assert.equal(frames.at(-1), 500);
});

test("seek clamps to the loop range and updates the music", () => {
  const audio = createAudio();
  const playback = new Playback(audio, { ringsProvider: () => [] });
  playback.start({
    startFrame: 200,
    loopStart: 100,
    loopEnd: 300,
    loop: true,
    withAudio: true,
    originFrame: 0,
  });

  playback.seek(350);
  assert.ok(Math.abs(playback.currentFrame - (300 - 1e-6)) < 1e-9);
  assert.ok(Math.abs(audio.calls.seekMusic.at(-1) - (300 - 1e-6) / FPS) < 1e-9);

  playback.seek(-50);
  assert.equal(playback.currentFrame, 100);
  playback.stop({ silent: true });
});

test("setRate clamps the rate to the supported range", () => {
  const audio = createAudio();
  const playback = new Playback(audio, { ringsProvider: () => [] });
  playback.start({ startFrame: 200, loopStart: 100, loopEnd: 300, loop: true });

  playback.setRate(0.1);
  assert.equal(playback.rate, 0.25);
  assert.equal(audio.calls.setMusicRate.at(-1), 0.25);
  playback.stop({ silent: true });
});
