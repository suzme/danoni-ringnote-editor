import { FPS } from "./constants.js";

export class Playback {
  constructor(audio, options = {}) {
    this.audio = audio;
    this.onFrame = options.onFrame ?? (() => {});
    this.onStateChange = options.onStateChange ?? (() => {});
    this.onLoop = options.onLoop ?? (() => {});
    this.ringsProvider = options.ringsProvider ?? (() => []);
    this.running = false;
    this.raf = 0;
    this.loop = true;
    this.loopStart = 0;
    this.loopEnd = 0;
    this.anchorWall = 0;
    this.anchorFrame = 0;
    this.lastFrame = 0;
    this.rate = 1;
    this.withAudio = false;
    this.originFrame = 0;
    this.offsetFrames = 0;
    this.volume = 0.8;
    this.currentFrame = 0;
    this._tick = this._tick.bind(this);
  }

  start({
    startFrame,
    loopStart,
    loopEnd,
    loop = true,
    rate = 1,
    withAudio = false,
    originFrame = 0,
    offsetFrames = 0,
    volume = 0.8,
  }) {
    this.stop({ silent: true });
    this.loopStart = loopStart;
    this.loopEnd = Math.max(loopEnd, loopStart + 1 / FPS);
    this.loop = Boolean(loop);
    this.rate = Math.max(0.25, Number(rate) || 1);
    this.withAudio = Boolean(withAudio);
    this.originFrame = Number(originFrame) || 0;
    this.offsetFrames = Number(offsetFrames) || 0;
    this.volume = Number(volume) || 0.8;

    const safeStart = Math.min(Math.max(startFrame, this.loopStart), this.loopEnd - 1e-6);
    this.anchorFrame = safeStart;
    this.anchorWall = performance.now();
    this.lastFrame = safeStart - 1e-4;
    this.currentFrame = safeStart;
    this.running = true;

    if (this.withAudio) {
      const seconds = this.chartSeconds(safeStart);
      this.audio.playMusicAt(seconds, this.rate, this.volume);
    }
    this.onStateChange("playing");
    this.onFrame(safeStart);
    this.raf = requestAnimationFrame(this._tick);
  }

  chartSeconds(frame) {
    // Blank Frameを曲の0:00とする。オフセットが正なら譜面を曲より遅らせる
    // （そのフレーム数だけ曲が先行する）。
    return (frame - this.originFrame + this.offsetFrames) / FPS;
  }

  _tick(now) {
    if (!this.running) return;
    let frame = this.anchorFrame + ((now - this.anchorWall) / 1000) * FPS * this.rate;

    if (frame >= this.loopEnd) {
      if (this.loop) {
        // 折り返し直前までに通過したリング音も取りこぼさず発火する。
        this._schedule(this.loopEnd);
        const loopLength = this.loopEnd - this.loopStart;
        const overshoot = ((frame - this.loopEnd) % Math.max(1e-6, loopLength));
        this.anchorWall = now;
        this.anchorFrame = this.loopStart + overshoot;
        this.lastFrame = this.loopStart - 1e-4;
        if (this.withAudio) {
          this.audio.playMusicAt(this.chartSeconds(this.anchorFrame), this.rate, this.volume);
        }
        this.onLoop(this.loopStart);
        frame = this.anchorFrame;
      } else {
        frame = this.loopEnd;
        this.currentFrame = frame;
        this._schedule(frame);
        this.onFrame(frame);
        this.stop({ keepFrame: true });
        return;
      }
    }

    this.currentFrame = frame;
    this._schedule(frame);
    this.onFrame(frame);
    this.lastFrame = frame;
    this.raf = requestAnimationFrame(this._tick);
  }

  _schedule(frame) {
    const rings = this.ringsProvider() || [];
    for (const ring of rings) {
      const arrival = Number(ring.arrival);
      if (!Number.isFinite(arrival)) continue;
      if (arrival > this.lastFrame && arrival <= frame) {
        if (Number(ring.sound) > 0) this.audio.playRingSound(ring.sound, 0.5);
      }
    }
  }

  seek(frame) {
    if (!this.running) return;
    const target = Math.min(Math.max(Number(frame) || 0, this.loopStart), this.loopEnd - 1e-6);
    this.anchorFrame = target;
    this.anchorWall = performance.now();
    this.currentFrame = target;
    this.lastFrame = target - 1e-4;
    if (this.withAudio) {
      this.audio.seekMusic(this.chartSeconds(target));
      this.audio.setMusicRate(this.rate);
    }
    this.onFrame(target);
  }

  setRate(rate) {
    if (!this.running) {
      this.rate = rate;
      return;
    }
    const frame = this.getFrame();
    this.rate = Math.max(0.25, Number(rate) || 1);
    this.anchorFrame = frame;
    this.anchorWall = performance.now();
    this.audio.setMusicRate(this.rate);
  }

  setVolume(volume) {
    this.volume = volume;
    this.audio.setMusicVolume(volume);
  }

  getFrame() {
    if (!this.running) return this.currentFrame;
    return this.anchorFrame + ((performance.now() - this.anchorWall) / 1000) * FPS * this.rate;
  }

  stop(options = {}) {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    const wasRunning = this.running;
    this.running = false;
    if (!options.silent) {
      this.audio.pauseMusic();
      if (wasRunning) this.onStateChange("stopped", options);
    }
  }
}
