import {
  APP_VERSION,
  DEFAULT_RADIUS,
  DEFAULT_SETTINGS,
  DIVISORS,
  FPS,
  MIN_RADIUS,
  STORAGE_PROJECT,
  STORAGE_SETTINGS,
} from "./constants.js";

export function defaultProject() {
  return {
    version: APP_VERSION,
    title: "",
    artist: "",
    author: "",
    screen: { width: 600, height: 500 },
    blankFrame: 200,
    timings: [{ label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 }],
    rings: [],
    lns: [],
    speeds: [],
    scoreNumber: 1,
    scorePrefix: "",
    importedChart: "",
    importedChartName: "",
    referenceNoteFrames: [],
    nextId: 1,
  };
}

export function deepClone(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      /* 次の処理へ続行 */
    }
  }
  return JSON.parse(JSON.stringify(value));
}

export function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function formatNumber(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 10 ** digits) / 10 ** digits;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function normalizeColor(value) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (!text) return "";
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return (
      "#" +
      text
        .slice(1)
        .split("")
        .map((c) => c + c)
        .join("")
    ).toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(text)) return "#" + text.toLowerCase();
  return "";
}

export function autoRingColor(background = "dark") {
  return background === "light" ? "#000000" : "#ffffff";
}

export function ringDisplayColor(ring, background = "dark") {
  return normalizeColor(ring.color) || autoRingColor(background);
}

export function isLabelTiming(timings, page) {
  return timings.some((t) => t.label === page);
}

export function normalizeTimings(rawTimings) {
  const source = Array.isArray(rawTimings) ? rawTimings : [];
  const byLabel = new Map();
  for (const raw of source) {
    if (!raw || typeof raw !== "object") continue;
    const label = Math.max(1, Math.floor(finiteNumber(raw.label, 1)));
    const entry = {
      label,
      startNum: finiteNumber(raw.startNum, 0),
      bpm: Math.max(1, finiteNumber(raw.bpm, 140)),
      pageBlockNum: clamp(Math.round(finiteNumber(raw.pageBlockNum, 8) * 1000) / 1000, 1, 8),
    };
    // 同じラベルが重複した場合は後の項目を採用する。
    byLabel.set(label, entry);
  }
  if (!byLabel.has(1)) {
    const first = [...byLabel.values()].sort((a, b) => a.label - b.label)[0];
    byLabel.set(1, {
      label: 1,
      startNum: 0,
      bpm: first?.bpm ?? 140,
      pageBlockNum: first?.pageBlockNum ?? 8,
    });
  }
  return [...byLabel.values()].sort((a, b) => a.label - b.label);
}

function normalizeId(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeRing(raw, fallbackId) {
  const ring = raw && typeof raw === "object" ? raw : {};
  return {
    id: normalizeId(ring.id, fallbackId),
    page: Math.max(1, Math.floor(finiteNumber(ring.page, 1))),
    position: finiteNumber(ring.position, 0),
    x: finiteNumber(ring.x, 300),
    y: finiteNumber(ring.y, 250),
    sound: Math.max(0, Math.round(finiteNumber(ring.sound, 1))),
    radius: Math.max(MIN_RADIUS, finiteNumber(ring.radius, DEFAULT_RADIUS)),
    color: normalizeColor(ring.color),
    frames: Math.max(0, finiteNumber(ring.frames, 0)),
  };
}

export function normalizeLn(raw, fallbackId) {
  const ln = raw && typeof raw === "object" ? raw : {};
  const page = Math.max(1, Math.floor(finiteNumber(ln.page, 1)));
  const position = finiteNumber(ln.position, 0);
  const sound = Math.max(0, Math.round(finiteNumber(ln.sound, 1)));
  return {
    id: normalizeId(ln.id, fallbackId),
    page,
    position,
    endPage: Math.max(1, Math.floor(finiteNumber(ln.endPage, page))),
    endPosition: finiteNumber(ln.endPosition, position + 192),
    startX: finiteNumber(ln.startX ?? ln.x1, 150),
    startY: finiteNumber(ln.startY ?? ln.y1, 250),
    endX: finiteNumber(ln.endX ?? ln.x2, 450),
    endY: finiteNumber(ln.endY ?? ln.y2, 250),
    count: clamp(Math.round(finiteNumber(ln.count, 8)), 2, 256),
    distortion: clamp(finiteNumber(ln.distortion, 0), -20, 20),
    includeEnd: Boolean(ln.includeEnd),
    sound,
    endSound: Math.max(0, Math.round(finiteNumber(ln.endSound, sound))),
    radius: Math.max(MIN_RADIUS, finiteNumber(ln.radius, DEFAULT_RADIUS)),
    color: normalizeColor(ln.color),
    frames: Math.max(0, finiteNumber(ln.frames, 0)),
  };
}

export function normalizeSpeed(raw, fallbackId) {
  const speed = raw && typeof raw === "object" ? raw : {};
  return {
    id: normalizeId(speed.id, fallbackId),
    type: speed.type === "boost" ? "boost" : "speed",
    frame: Math.max(0, finiteNumber(speed.frame, 0)),
    value: finiteNumber(speed.value, 1),
  };
}

export function normalizeProject(raw) {
  const base = defaultProject();
  if (!raw || typeof raw !== "object") return base;
  const project = {
    ...base,
    ...raw,
    screen: {
      width: clamp(Math.round(finiteNumber(raw.screen?.width, 600)), 100, 4000),
      height: clamp(Math.round(finiteNumber(raw.screen?.height, 500)), 100, 4000),
    },
    blankFrame: Math.max(0, finiteNumber(raw.blankFrame, 200)),
    timings: normalizeTimings(raw.timings),
    rings: [],
    lns: [],
    speeds: [],
    scoreNumber: Math.max(1, Math.round(finiteNumber(raw.scoreNumber, 1))),
    referenceNoteFrames: [],
    nextId: Math.max(1, Math.round(finiteNumber(raw.nextId, 1))),
  };

  let nextId = project.nextId;
  const used = new Set();
  const uniqueId = (rawId, prefix) => {
    let id = normalizeId(rawId, "");
    if (!id) id = `${prefix}${nextId++}`;
    while (used.has(id)) id = `${prefix}${nextId++}`;
    return id;
  };
  for (const rawRing of Array.isArray(raw.rings) ? raw.rings : []) {
    const id = uniqueId(rawRing?.id, "r");
    used.add(id);
    project.rings.push({ ...normalizeRing(rawRing, id), id });
  }
  for (const rawLn of Array.isArray(raw.lns) ? raw.lns : []) {
    const id = uniqueId(rawLn?.id, "ln");
    used.add(id);
    project.lns.push({ ...normalizeLn(rawLn, id), id });
  }
  for (const rawSpeed of Array.isArray(raw.speeds) ? raw.speeds : []) {
    const id = uniqueId(rawSpeed?.id, "s");
    used.add(id);
    project.speeds.push({ ...normalizeSpeed(rawSpeed, id), id });
  }
  project.nextId = Math.max(nextId, project.nextId);

  const refs = Array.isArray(raw.referenceNoteFrames) ? raw.referenceNoteFrames : [];
  project.referenceNoteFrames = [...new Set(refs.map((v) => finiteNumber(v, NaN)).filter((v) => Number.isFinite(v) && v >= 0))]
    .sort((a, b) => a - b)
    .slice(0, 200000);

  project.importedChart = typeof raw.importedChart === "string" ? raw.importedChart : "";
  project.importedChartName = typeof raw.importedChartName === "string" ? raw.importedChartName : "";
  project.title = typeof raw.title === "string" ? raw.title : "";
  project.artist = typeof raw.artist === "string" ? raw.artist : "";
  project.author = typeof raw.author === "string" ? raw.author : "";
  project.scorePrefix = typeof raw.scorePrefix === "string" ? raw.scorePrefix : "";

  return project;
}

export function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const settings = {
    ...deepClone(DEFAULT_SETTINGS),
    ...source,
    tool: { ...DEFAULT_SETTINGS.tool, ...(source.tool || {}) },
    ln: { ...DEFAULT_SETTINGS.ln, ...(source.ln || {}) },
  };

  const divisorValues = new Set(DIVISORS.map((d) => d.value));
  settings.divisor = divisorValues.has(Number(settings.divisor)) ? Number(settings.divisor) : DEFAULT_SETTINGS.divisor;
  const blockHeights = [40, 56, 72, 96];
  settings.blockHeight = blockHeights.includes(Number(settings.blockHeight)) ? Number(settings.blockHeight) : 56;
  settings.snap = [1, 5, 10].includes(Number(settings.snap)) ? Number(settings.snap) : 5;
  settings.musicVolume = clamp(finiteNumber(settings.musicVolume, 0.8), 0, 1);
  settings.musicRate = clamp(finiteNumber(settings.musicRate, 1), 0.5, 2);
  settings.musicOffset = clamp(finiteNumber(settings.musicOffset, 0), -100, 100);
  // 旧形式の保存データではオフセットがミリ秒単位のため、フレームに変換する。
  if (source.musicOffsetUnit !== "frame") {
    settings.musicOffset = clamp(Math.round((finiteNumber(source.musicOffset, 0) * FPS) / 1000), -100, 100);
  }
  settings.musicOffsetUnit = "frame";
  settings.tool.sound = Math.max(0, Math.round(finiteNumber(settings.tool.sound, 1)));
  settings.tool.radius = Math.max(MIN_RADIUS, finiteNumber(settings.tool.radius, DEFAULT_RADIUS));
  settings.tool.color = normalizeColor(settings.tool.color);
  settings.tool.frames = Math.max(0, finiteNumber(settings.tool.frames, 0));

  settings.ln.count = clamp(Math.round(finiteNumber(settings.ln.count, DEFAULT_SETTINGS.ln.count)), 2, 256);
  settings.ln.duration = clamp(finiteNumber(settings.ln.duration, DEFAULT_SETTINGS.ln.duration), 0.01, 64);
  settings.ln.distortion = clamp(finiteNumber(settings.ln.distortion, DEFAULT_SETTINGS.ln.distortion), -20, 20);
  settings.ln.endSound = Math.max(0, Math.round(finiteNumber(settings.ln.endSound, DEFAULT_SETTINGS.ln.endSound)));
  settings.ln.includeEnd = Boolean(settings.ln.includeEnd);

  const legacyDisplayRange = { page: 4, near: 8, all: 16 };
  const displayRangeBeats = Number.isFinite(Number(source.displayRangeBeats))
    ? Number(source.displayRangeBeats)
    : (legacyDisplayRange[source.displayRange] ?? DEFAULT_SETTINGS.displayRangeBeats);
  settings.displayRangeBeats = clamp(displayRangeBeats, 0.5, 16);
  delete settings.displayRange;

  settings.timelineReverse = Boolean(settings.timelineReverse);
  settings.showTimes = Boolean(settings.showTimes);
  settings.showReferenceNotes = Boolean(settings.showReferenceNotes);
  settings.showWaveform = settings.showWaveform !== false;
  settings.advanceAfterPlace = Boolean(settings.advanceAfterPlace);
  delete settings.loop;
  delete settings.playFromCursor;
  delete settings.metronome;
  delete settings.zoom;
  delete settings.background;
  delete settings.showGuides;
  delete settings.previewRate;
  delete settings.previewGuide;
  delete settings.previewStartMode;
  delete settings.ringSpeedOption;
  return settings;
}

export function nextObjectId(project, prefix = "r") {
  const used = new Set([
    ...project.rings.map((r) => r.id),
    ...(project.lns || []).map((l) => l.id),
    ...project.speeds.map((s) => s.id),
  ]);
  let id;
  do {
    id = `${prefix}${project.nextId++}`;
  } while (used.has(id));
  return id;
}

export function loadProject() {
  try {
    const text = localStorage.getItem(STORAGE_PROJECT);
    if (!text) return null;
    const parsed = JSON.parse(text);
    return normalizeProject(parsed?.project ?? parsed);
  } catch {
    return null;
  }
}

export function saveProject(project) {
  try {
    localStorage.setItem(STORAGE_PROJECT, JSON.stringify(project));
  } catch {
    /* ストレージが一杯、または無効な場合がある */
  }
}

export function loadSettings() {
  try {
    const text = localStorage.getItem(STORAGE_SETTINGS);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return normalizeSettings(null);
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(settings));
  } catch {
    /* エラーを無視する */
  }
}

export function projectSnapshot(project) {
  return JSON.stringify(project);
}

export function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("file read error"));
    reader.readAsText(file, "utf-8");
  });
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
