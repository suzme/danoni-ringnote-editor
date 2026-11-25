export const APP_VERSION = 1;
export const FPS = 60;
export const QUARTER = 48; // 4分音符あたりの位置数
export const HISTORY_LIMIT = 120;
export const MAX_PAGE = 1000;
export const MIN_RADIUS = 5;
export const DEFAULT_RADIUS = 50;
export const RING_START_RATE = 0.1;
export const DEFAULT_RING_FRAMES = 60;
export const LN_DISTORTION_UNIT = 50;

// 既存のdanoni-editorと同じ順序・意味。
// valueは入力ステップあたりの位置数。
export const DIVISORS = [
  { value: 48, label: "4分" },
  { value: 24, label: "8分" },
  { value: 12, label: "16分" },
  { value: 16, label: "12分" },
  { value: 8, label: "24分" },
  { value: 4, label: "48分" },
  { value: 6, label: "32分" },
];

export const SOUNDS = [
  { value: 0, name: "0 無音" },
  { value: 1, name: "1 サリング風" },
  { value: 2, name: "2 パーン" },
  { value: 3, name: "3 パン" },
  { value: 4, name: "4 トーン (880Hz)" },
  { value: 5, name: "5 トーン (1320Hz)" },
  { value: 6, name: "6 トーン (660Hz)" },
  { value: 7, name: "7 トーン (440Hz)" },
];

export const DEFAULT_SETTINGS = {
  timelineReverse: false,
  blockHeight: 56,
  displayRangeBeats: 4,
  showTimes: false,
  showReferenceNotes: true,
  showWaveform: true,
  snap: 5,
  advanceAfterPlace: true,
  divisor: 24,
  musicVolume: 0.8,
  musicRate: 1,
  musicOffset: 0,
  musicOffsetUnit: "frame",
  tool: {
    sound: 1,
    radius: DEFAULT_RADIUS,
    color: "",
    frames: 0,
  },
  ln: {
    count: 8,
    duration: 0.5,
    distortion: 0,
    endSound: 1,
    includeEnd: false,
  },
};

export const STORAGE_PROJECT = "danoni-ring-editor.project.v1";
export const STORAGE_SETTINGS = "danoni-ring-editor.settings.v1";
