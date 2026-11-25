// リング効果音の既定音 (音番号1～7) は、Dancing☆Onigiri (CW Edition) (danoniplus)
// の波形生成ロジックを流用しています。
// - RING_DEFAULT_SOUNDS: js/lib/danoni_constants.jsのg_ringDefaultSounds（v53.2.0）
// - synthRingBands / makeDefaultRingSound: js/lib/dataLoader.js（v53.2.0）
//
// danoniplus Copyright (c) 2018 tickle
// https://github.com/cwtickle/danoniplus
// MIT License: https://opensource.org/licenses/MIT

// danoniplus js/lib/danoni_constants.js (g_ringDefaultSounds) より流用。
// // リングノートの既定音（音番号1～7。0は無音。外部ファイルを使わずコードで生成する）。
// タイムライン背景の波形に使う、1秒あたりのピーク数。
const WAVEFORM_BUCKETS_PER_SECOND = 240;
// 波形抽出時のデコードサンプルレート。ピーク算出用のため低く設定し、メモリ使用量を抑える。
const WAVEFORM_SAMPLE_RATE = 8000;

function decodeAudioDataCompat(ctx, arrayBuffer) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (buffer) => {
      if (settled) return;
      settled = true;
      resolve(buffer);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error ?? new Error("decodeAudioData failed"));
    };
    try {
      const result = ctx.decodeAudioData(arrayBuffer, done, fail);
      if (result && typeof result.then === "function") result.then(done, fail);
    } catch (error) {
      fail(error);
    }
  });
}

const RING_DEFAULT_SOUNDS = [
  // 1: 従来のサリングのデフォルト音に近い音色
  {
    dur: 0.32, attack: 0.012, level: 0.5, lowpass: 10200, lpPasses: 4, bands: [
      { f: 6935, q: 18, gain: 0.99, tau: 0.024, tau2: 0.09, mix2: 0.18 },
      { f: 9150, q: 58, gain: 0.62, tau: 0.057, tau2: 0.089, mix2: 0.18 },
      { f: 6000, q: 5.5, gain: 0.03, tau: 0.053, tau2: 0.145, mix2: 0.24 },
      { f: 8400, q: 9.8, gain: 0.3, tau: 0.034, tau2: 0.072, mix2: 0.26 },
      { f: 3500, q: 2, gain: 0.02, tau: 0.03, tau2: 0.04, mix2: 0.5 },
    ],
  },
  // 2: パーン
  { wave: "sine", freq: 1800, freqEnd: 250, sweep: 0.025, noise: 0.6, dur: 0.28, decay: 9 },
  // 3: パン(短め・乾いた音)
  { wave: "sine", freq: 2400, freqEnd: 400, sweep: 0.015, noise: 0.85, dur: 0.12, decay: 14 },
  { wave: "sine", freq: 880, dur: 0.12 }, // 4
  { wave: "sine", freq: 1320, dur: 0.12 }, // 5
  { wave: "triangle", freq: 660, dur: 0.12 }, // 6
  { wave: "square", freq: 440, dur: 0.15 }, // 7
];

export class AudioEngine {
  constructor() {
    this.context = null;
    this.master = null;
    this.ringSoundBuffers = new Map();
    this.music = new Audio();
    this.music.preload = "auto";
    this.music.volume = 0.8;
    this.objectUrl = null;
    this.musicName = "";
    this.musicDuration = 0;
    this.waveform = null;
  }

  ensureContext() {
    if (!this.context) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      this.context = new Ctx();
      this.master = this.context.createGain();
      this.master.gain.value = 0.85;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") {
      this.context.resume().catch(() => {});
    }
    return this.context;
  }

  // danoniplus js/lib/dataLoader.js (synthRingBands) より流用
  /**
   * 帯域ノイズ型の効果音を合成する（def.bandsを持つ既定音用）。
   * 白色ノイズを帯域ごとの共鳴フィルター（バイクアッド）に通し、2段の減衰エンベロープを掛けて合成する。
   * @param {object} def
   * @param {number} rate サンプルレート
   * @returns {Float32Array}
   */
  synthRingBands(def, rate) {
    const len = Math.max(Math.floor(rate * def.dur), 1);
    const out = new Float32Array(len);
    const attack = Math.max(Math.floor(rate * (def.attack ?? 0.008)), 1);

    // 乱数の種を固定し、毎回同じ音を生成する。
    let seed = 12345;
    const rnd = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
    };
    const noise = new Float32Array(len).map(() => rnd());

    def.bands.forEach((b) => {
      const w0 = (2 * Math.PI * b.f) / rate;
      const alpha = Math.sin(w0) / (2 * b.q);
      const a0 = 1 + alpha;
      const b0 = alpha / a0, b2 = -alpha / a0;
      const a1 = (-2 * Math.cos(w0)) / a0, a2 = (1 - alpha) / a0;
      const norm = 1 / Math.max((alpha / a0) * Math.sqrt(b.q) * 4, 1e-6);
      const mix2 = b.mix2 ?? 0, tau2 = b.tau2 ?? b.tau;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let i = 0; i < len; i++) {
        const x = noise[i];
        const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        const t = i / rate;
        const env = (1 - mix2) * Math.exp(-t / b.tau) + mix2 * Math.exp(-t / tau2);
        out[i] += y * norm * b.gain * env * Math.min(1, (i + 1) / attack);
      }
    });

    // 2次ローパスフィルターをlpPasses段適用し、高域をカットする。
    if (def.lowpass) {
      const w0 = (2 * Math.PI * def.lowpass) / rate;
      const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
      const a0 = 1 + alpha, cs = Math.cos(w0);
      const b0 = (1 - cs) / 2 / a0, b1 = (1 - cs) / a0, a1 = (-2 * cs) / a0, a2 = (1 - alpha) / a0;
      for (let pass = 0; pass < (def.lpPasses ?? 2); pass++) {
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let i = 0; i < len; i++) {
          const x = out[i];
          const y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y; out[i] = y;
        }
      }
    }

    // クリックノイズを防ぐため末尾2ミリ秒をフェードアウトし、ピークを正規化する。
    const fade = Math.floor(rate * 0.002);
    for (let i = 0; i < fade; i++) {
      out[len - 1 - i] *= i / fade;
    }
    const peak = out.reduce((max, v) => Math.max(max, Math.abs(v)), 0) || 1;
    return out.map((v) => (v * (def.level ?? 0.5)) / peak);
  }

  // danoniplus js/lib/dataLoader.js (makeDefaultRingSound) より流用
  /**
   * 既定音の生成 (外部ファイル不要)
   * @param {AudioContext} ctx
   * @param {object} def
   * @returns {AudioBuffer}
   */
  makeDefaultRingSound(ctx, def) {
    const rate = ctx.sampleRate;
    const len = Math.max(Math.floor(rate * def.dur), 1);
    const buffer = ctx.createBuffer(1, len, rate);
    const data = buffer.getChannelData(0);

    // bandsを持つ定義は帯域ノイズ方式で合成する。
    if (def.bands) {
      data.set(this.synthRingBands(def, rate));
      return buffer;
    }
    const waves = {
      sine: (p) => Math.sin(2 * Math.PI * p),
      triangle: (p) => 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1,
      square: (p) => (p % 1 < 0.5 ? 1 : -1) * 0.6,
    };
    const wave = waves[def.wave] ?? waves.sine;
    const noiseMix = def.noise ?? 0;
    const decay = def.decay ?? 6;
    const freqEnd = def.freqEnd ?? def.freq;
    const sweepRate = rate * (def.sweep ?? 0.03);
    let phase = 0;
    let prevNoise = 0;
    for (let i = 0; i < len; i++) {
      // ピッチはfreqからfreqEndへ指数的に近づく（freqEndが未指定なら一定）。
      const freq = freqEnd + (def.freq - freqEnd) * Math.exp(-i / sweepRate);
      phase += freq / rate;

      // ノイズの1次差分で高域成分を強め、破裂音の「パ」に近づける。
      const n = Math.random() * 2 - 1;
      const highNoise = (n - prevNoise) * 0.5;
      prevNoise = n;

      // クリックノイズを防ぐため2ミリ秒で立ち上げ、その後指数的に減衰させる。
      const env = Math.min(1, i / (rate * 0.002)) * Math.exp((-decay * i) / len);
      data[i] = 0.5 * env * ((1 - noiseMix) * wave(phase) + noiseMix * highNoise);
    }
    return buffer;
  }

  /**
   * 音番号に対応する既定音の AudioBuffer を取得 (生成済みならキャッシュを返す)
   * @param {AudioContext} ctx
   * @param {number} sound 音番号 (1～RING_DEFAULT_SOUNDS.length)
   * @returns {AudioBuffer|null}
   */
  getRingSoundBuffer(ctx, sound) {
    if (this.ringSoundBuffers.has(sound)) return this.ringSoundBuffers.get(sound);
    const def = RING_DEFAULT_SOUNDS[sound - 1];
    if (!def) return null;
    const buffer = this.makeDefaultRingSound(ctx, def);
    this.ringSoundBuffers.set(sound, buffer);
    return buffer;
  }

  async loadMusic(file) {
    this.stopMusic();
    this.waveform = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.objectUrl = URL.createObjectURL(file);
    this.musicName = file.name || "音源";
    this.music.src = this.objectUrl;
    this.music.load();
    // 波形抽出はメタデータの読み込みと並行して進め、失敗しても音源の読み込みは続ける。
    const waveformPromise = this.extractWaveform(file).catch(() => null);
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      this.music.addEventListener("loadedmetadata", finish, { once: true });
      this.music.addEventListener("error", finish, { once: true });
      setTimeout(finish, 4000);
    });
    this.musicDuration = Number.isFinite(this.music.duration) ? this.music.duration : 0;
    this.waveform = await waveformPromise;
    return { name: this.musicName, duration: this.musicDuration };
  }

  /**
   * 音源ファイルからタイムライン背景用の波形ピーク列を作る。
   * @param {File|Blob} file
   * @returns {Promise<{duration:number, bucketsPerSecond:number, peaks:Float32Array}|null>}
   */
  async extractWaveform(file) {
    if (!file || typeof file.arrayBuffer !== "function") return null;
    if (typeof window === "undefined") return null;
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    let audioBuffer = null;
    if (Ctx) {
      // 低サンプルレートでのデコードに対応していない環境では、通常のサンプルレートで再試行する。
      for (const rate of [WAVEFORM_SAMPLE_RATE, 44100]) {
        try {
          const bytes = await file.arrayBuffer();
          const offline = new Ctx(1, 1, rate);
          audioBuffer = await decodeAudioDataCompat(offline, bytes);
          break;
        } catch {
          audioBuffer = null;
        }
      }
    } else {
      try {
        const ctx = this.ensureContext();
        if (!ctx) return null;
        audioBuffer = await decodeAudioDataCompat(ctx, await file.arrayBuffer());
      } catch {
        return null;
      }
    }
    if (!audioBuffer || !(audioBuffer.duration > 0)) return null;

    const duration = audioBuffer.duration;
    const bucketCount = Math.max(1, Math.ceil(duration * WAVEFORM_BUCKETS_PER_SECOND));
    const peaks = new Float32Array(bucketCount);
    const sampleCount = audioBuffer.length;
    const samplesPerBucket = sampleCount / bucketCount;
    const channels = [];
    for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }

    let maxPeak = 0;
    for (let i = 0; i < bucketCount; i++) {
      const start = Math.floor(i * samplesPerBucket);
      const end = Math.min(sampleCount, Math.max(start + 1, Math.floor((i + 1) * samplesPerBucket)));
      let peak = 0;
      for (const channel of channels) {
        for (let s = start; s < end; s++) {
          const value = Math.abs(channel[s]);
          if (value > peak) peak = value;
        }
      }
      peaks[i] = peak;
      if (peak > maxPeak) maxPeak = peak;
    }
    if (!(maxPeak > 0)) return null;

    // 正規化後に平方根を適用し、小さい音も見えやすくする。
    for (let i = 0; i < bucketCount; i++) {
      peaks[i] = Math.sqrt(peaks[i] / maxPeak);
    }
    return { duration, bucketsPerSecond: WAVEFORM_BUCKETS_PER_SECOND, peaks };
  }

  hasMusic() {
    return Boolean(this.music.src);
  }

  async playMusicAt(seconds, rate = 1, volume = 0.8) {
    if (!this.music.src) return false;
    try {
      const duration = this.music.duration;
      if (Number.isFinite(duration) && duration > 0 && seconds >= duration) return false;
      const target = Math.max(0, Number(seconds) || 0);
      if (Number.isFinite(duration) && duration > 0) {
        this.music.currentTime = Math.min(target, Math.max(0, duration - 0.02));
      } else {
        this.music.currentTime = target;
      }
      this.music.playbackRate = Math.min(4, Math.max(0.25, rate));
      this.music.volume = Math.min(1, Math.max(0, volume));
      await this.music.play();
      return true;
    } catch {
      return false;
    }
  }

  pauseMusic() {
    try {
      this.music.pause();
    } catch {
      /* エラーを無視する */
    }
  }

  stopMusic() {
    try {
      this.music.pause();
      this.music.currentTime = 0;
    } catch {
      /* エラーを無視する */
    }
  }

  seekMusic(seconds) {
    try {
      const duration = this.music.duration;
      if (Number.isFinite(duration) && duration > 0) {
        this.music.currentTime = Math.min(Math.max(0, seconds), Math.max(0, duration - 0.02));
      } else {
        this.music.currentTime = Math.max(0, seconds);
      }
    } catch {
      /* エラーを無視する */
    }
  }

  setMusicVolume(volume) {
    this.music.volume = Math.min(1, Math.max(0, volume));
  }

  setMusicRate(rate) {
    try {
      this.music.playbackRate = Math.min(4, Math.max(0.25, rate));
    } catch {
      /* エラーを無視する */
    }
  }

  playRingSound(no, volume = 0.5) {
    const ctx = this.ensureContext();
    if (!ctx || !this.master) return;
    const sound = Number(no) || 0;
    if (sound <= 0) return;
    const now = ctx.currentTime;

    // 音番号1～7はdanoniplusのjs/lib/mainWindow.jsにあるplayRingSoundと同じ既定音を再生する。
    // 音量指定はdanoniplusの0～100を基準とするため、このエディターの既定値0.5を2倍して合わせる。
    if (sound <= RING_DEFAULT_SOUNDS.length) {
      const buffer = this.getRingSoundBuffer(ctx, sound);
      if (!buffer) return;
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = Math.min(1, Math.max(0, volume * 2));
      source.connect(gain).connect(this.master);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start(now);
      return;
    }

    // 音番号8以降は独自の代替音を使う（danoniplusの既定音は1～7のみ）。
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(this.master);
    osc.type = "sine";
    osc.frequency.value = 440 * 2 ** ((sound - 4) / 12);
    const duration = 0.14;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.35), now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }
}
