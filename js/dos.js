import { MIN_RADIUS } from "./constants.js";
import { formatNumber, normalizeColor, normalizeTimings } from "./model.js";
import { allProjectRings, timingAndPositionAtFrame, frameForRing } from "./timing.js";

function parseFirst(map, keys) {
  for (const key of keys) {
    const value = map[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function parseNumber(value, fallback) {
  const n = Number.parseFloat(String(value ?? "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function numberList(value) {
  if (value === undefined || value === null || String(value).trim() === "") return [];
  return String(value)
    .split(",")
    .map((v) => Number.parseFloat(v.trim()))
    .filter((v) => Number.isFinite(v));
}

function csv(value) {
  if (value === undefined || value === null) return [];
  return String(value)
    .split(",")
    .map((v) => v.trim());
}

function sectionKey(part) {
  const eq = part.indexOf("=");
  return eq >= 0 ? part.slice(0, eq).trim() : null;
}

export function parseDos(text) {
  if (typeof text !== "string" || !text.trim()) return { entries: [], map: Object.create(null) };
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").replace(/&/g, "|");
  const parts = normalized.split("|");
  const entries = [];
  for (const raw of parts) {
    if (!raw.trim()) continue;
    const eq = raw.indexOf("=");
    if (eq < 0) continue;
    const key = raw.slice(0, eq).trim();
    if (!key) continue;
    const value = raw
      .slice(eq + 1)
      .replace(/^\n/, "")
      .replace(/\n+$/, "");
    entries.push({ key, value });
  }
  const map = Object.create(null);
  for (const entry of entries) map[entry.key] = entry.value;
  return { entries, map };
}

export function extractMetadata(text) {
  const { map } = parseDos(text);
  const labelsRaw = parseFirst(map, ["es_label", "label"]);
  const startRaw = parseFirst(map, ["es_startNumber", "startNumber"]);
  const bpmRaw = parseFirst(map, ["es_bpm", "bpm"]);
  const blockRaw = parseFirst(map, ["es_pageBlockNumber", "pageBlockNumber"]);

  let labels = numberList(labelsRaw).map((n) => Math.max(1, Math.floor(n)));
  if (labels.length === 0) labels = [1];
  const startNumbers = numberList(startRaw);
  const bpms = numberList(bpmRaw);
  const blocks = numberList(blockRaw);

  const timings = normalizeTimings(
    labels.map((label, index) => ({
      label,
      startNum: startNumbers[index] ?? 0,
      bpm: bpms[index] ?? bpms[0] ?? 140,
      pageBlockNum: blocks[index] ?? blocks[0] ?? 8,
    }))
  );

  // blankFrameはゲームのヘッダー項目、es_blankFrameはエディター独自のメタデータ。
  const scoreRaw = parseFirst(map, ["es_scoreNumber"]);
  let scoreNumber = Math.max(1, Math.round(parseNumber(scoreRaw, 1)));
  if (scoreRaw === undefined) {
    for (let n = 2; n <= 9; n++) {
      if (map[`ring${n}_data`] !== undefined) {
        scoreNumber = n;
        break;
      }
    }
  }
  const blankValues = numberList(parseFirst(map, ["blankFrame", "es_blankFrame"]));
  const blankFrame = Math.max(0, blankValues[scoreNumber - 1] ?? blankValues[0] ?? 200);
  const scorePrefix = parseFirst(map, ["es_scorePrefix"]) ?? "";

  const widthCandidate =
    parseNumber(parseFirst(map, ["ringWidth"]), NaN) ||
    Math.min(parseNumber(parseFirst(map, ["playingWidth"]), NaN), 600) ||
    NaN;
  const heightCandidate = parseNumber(parseFirst(map, ["playingHeight"]), NaN);
  const screen =
    Number.isFinite(widthCandidate) && widthCandidate > 0
      ? {
          width: Math.round(widthCandidate),
          height:
            Number.isFinite(heightCandidate) && heightCandidate > 0 ? Math.round(heightCandidate) : 500,
        }
      : null;

  const titleValue = map["musicTitle"];
  const title = titleValue !== undefined ? String(titleValue).split(",")[0].trim() : "";
  const artist = String(map["musicArtist"] ?? map["musicBy"] ?? "").trim();

  return {
    map,
    blankFrame,
    timings,
    scoreNumber,
    scorePrefix,
    screen,
    title,
    artist,
  };
}

function ringKey(scoreNumber) {
  return scoreNumber === 1 ? "ring_data" : `ring${scoreNumber}_data`;
}

function speedKey(type, scoreNumber) {
  const base = type === "boost" ? "ring_boost" : "ring_speed";
  return scoreNumber === 1 ? `${base}_data` : `${base}${scoreNumber}_data`;
}

export function parseRings(map, meta) {
  const key = ringKey(meta.scoreNumber);
  let raw = map[key];
  if (raw === undefined && meta.scoreNumber !== 1) raw = map["ring_data"];
  const rings = [];
  const warnings = [];
  if (raw === undefined || !String(raw).trim()) return { rings, warnings };

  const project = { blankFrame: meta.blankFrame, timings: meta.timings };
  for (const line of String(raw).split("\n")) {
    const text = line.trim();
    if (!text) continue;
    const fields = text.split(",").map((v) => v.trim());
    const frame = parseNumber(fields[0], NaN);
    const x = parseNumber(fields[1], NaN);
    const y = parseNumber(fields[2], NaN);
    if (![frame, x, y].every(Number.isFinite)) {
      warnings.push(`ring_data の行を読み飛ばしました: ${text}`);
      continue;
    }
    const sound = Math.max(0, Math.round(parseNumber(fields[3], 1)));
    const radius = Math.max(MIN_RADIUS, parseNumber(fields[4], 50));
    const color = normalizeColor(fields[5] ?? "");
    const frames = Math.max(0, parseNumber(fields[6], 0));
    const location = timingAndPositionAtFrame(project, frame);
    rings.push({
      page: Math.max(1, location.page),
      position: location.position,
      x,
      y,
      sound,
      radius,
      color,
      frames,
    });
  }
  return { rings, warnings };
}

export function parseSpeeds(map, meta) {
  const speeds = [];
  const warnings = [];
  const project = { blankFrame: meta.blankFrame, timings: meta.timings };
  for (const type of ["speed", "boost"]) {
    const key = speedKey(type, meta.scoreNumber);
    let raw = map[key];
    if (raw === undefined && meta.scoreNumber !== 1) raw = map[speedKey(type, 1)];
    if (raw === undefined || !String(raw).trim()) continue;
    for (const line of String(raw).split("\n")) {
      const text = line.trim();
      if (!text) continue;
      const values = text.split(",").map((v) => v.trim());
      for (let i = 0; i + 1 < values.length; i += 2) {
        if (values[i] === "") continue;
        if (values[i + 1] === "-") break;
        const frame = parseNumber(values[i], NaN);
        const value = parseNumber(values[i + 1], NaN);
        if (!Number.isFinite(frame) || !Number.isFinite(value)) {
          warnings.push(`${key} の行を読み飛ばしました: ${text}`);
          break;
        }
        const location = timingAndPositionAtFrame(project, frame);
        speeds.push({
          type,
          frame,
          value,
        });
      }
    }
  }
  return { speeds, warnings };
}

const NON_NOTE_DATA =
  /(ring|speed|boost|color|ncolor|acolor|motion|animation|word|back|mask|lyric|style|gauge|scroll|keych|shadow|title|label|bpm|blank|score|dif|music|image|skin|custom|setting|result|finish|fade|end|volume|adjust|playback|life|graph|layer|filter|stretch|window|display|comment|credit|package|swing|step|scale|opacity|blend|movie|duration|timing|frame)/i;

export function parseReferenceNoteFrames(map) {
  const set = new Set();
  for (const [key, value] of Object.entries(map)) {
    if (!/_data$/i.test(key)) continue;
    if (NON_NOTE_DATA.test(key)) continue;
    const fields = String(value)
      .split(/[\s,]+/)
      .map((v) => v.trim())
      .filter(Boolean);
    const nums = fields.map((v) => Number(v));
    if (nums.length === 0 || nums.some((n) => !Number.isFinite(n))) continue;
    for (const frame of nums) {
      if (frame >= 0 && frame < 10_000_000) set.add(frame);
    }
  }
  return [...set].sort((a, b) => a - b).slice(0, 200000);
}

export function parseChart(text) {
  const meta = extractMetadata(text);
  const ringsResult = parseRings(meta.map, meta);
  const speedsResult = parseSpeeds(meta.map, meta);
  const referenceNoteFrames = parseReferenceNoteFrames(meta.map);
  return {
    meta,
    rings: ringsResult.rings,
    speeds: speedsResult.speeds,
    referenceNoteFrames,
    warnings: [...ringsResult.warnings, ...speedsResult.warnings],
  };
}

function ringLine(ring, frame) {
  const fields = [
    ring.sound !== 1 ? formatNumber(ring.sound, 0) : "",
    Math.abs(ring.radius - 50) > 1e-9 ? formatNumber(ring.radius, 2) : "",
    normalizeColor(ring.color),
    ring.frames > 0 ? formatNumber(ring.frames, 2) : "",
  ];
  while (fields.length > 0 && fields[fields.length - 1] === "") fields.pop();
  return [formatNumber(frame), formatNumber(ring.x, 3), formatNumber(ring.y, 3), ...fields].join(",");
}

function speedLine(speed, frame) {
  return `${formatNumber(frame)},${formatNumber(speed.value, 4)}`;
}

export function buildSections(project, options = {}) {
  const includeEmpty = Boolean(options.includeEmpty);
  const scoreNumber = Math.max(1, Math.round(Number(project.scoreNumber) || 1));
  const suffix = scoreNumber === 1 ? "" : String(scoreNumber);

  const ringLines = allProjectRings(project)
    .map((ring) => ({ ring, frame: frameForRing(project, ring) }))
    .sort((a, b) => a.frame - b.frame || a.ring.x - b.ring.x || a.ring.y - b.ring.y)
    .map(({ ring, frame }) => ringLine(ring, frame));

  const speedEntries = (project.speeds || [])
    .filter((speed) => speed.type === "speed")
    .map((speed) => ({ speed, frame: speed.frame }))
    .sort((a, b) => a.frame - b.frame)
    .map(({ speed, frame }) => speedLine(speed, frame));

  const boostEntries = (project.speeds || [])
    .filter((speed) => speed.type === "boost")
    .map((speed) => ({ speed, frame: speed.frame }))
    .sort((a, b) => a.frame - b.frame)
    .map(({ speed, frame }) => speedLine(speed, frame));

  const makeValue = (lines) => {
    if (lines.length === 0 && !includeEmpty) return null;
    return lines.length ? `\n${lines.join("\n")}\n` : "\n";
  };

  const sections = [
    {
      key: `ring${suffix}_data`,
      value: makeValue(ringLines),
      count: ringLines.length,
      kind: "ring",
    },
    {
      key: `ring_speed${suffix}_data`,
      value: makeValue(speedEntries),
      count: speedEntries.length,
      kind: "speed",
    },
    {
      key: `ring_boost${suffix}_data`,
      value: makeValue(boostEntries),
      count: boostEntries.length,
      kind: "boost",
    },
  ];
  return { sections, scoreNumber };
}

export function buildScreenHeaders(project) {
  return `|ringWidth=${formatNumber(project.screen.width, 0)}|`;
}

export function buildSnippet(project, options = {}) {
  const { sections } = buildSections(project, options);
  const present = sections.filter((section) => section.value !== null);
  const body = present.map((section) => `|${section.key}=${section.value}|`).join("\n") + (present.length ? "\n" : "");
  if (!options.includeScreen) return body;
  const header = buildScreenHeaders(project);
  return body ? `${header}\n${body}` : `${header}\n`;
}

export function replaceDosSection(text, key, value) {
  const parts = String(text ?? "").split("|");
  let found = false;
  for (let i = 0; i < parts.length; i++) {
    if (sectionKey(parts[i]) === key) {
      if (value === null) {
        parts.splice(i, 1);
        i--;
      } else {
        parts[i] = `${key}=${value}`;
      }
      found = true;
    }
  }
  if (!found && value !== null) {
    const last = parts[parts.length - 1];
    if (parts.length > 0 && last !== undefined && last.trim() === "") {
      parts.splice(parts.length - 1, 0, `${key}=${value}`);
    } else {
      parts.push(`${key}=${value}`);
      parts.push("");
    }
  }
  return parts.join("|");
}

export function mergeChart(originalText, project, options = {}) {
  let text = String(originalText ?? "");
  const { sections } = buildSections(project, options);
  const originalMap = parseDos(text).map;
  const originalBlankValues = numberList(parseFirst(originalMap, ["blankFrame"]));

  for (const section of sections) {
    if (section.value === null && options.removeEmpty !== false) {
      text = replaceDosSection(text, section.key, null);
    } else {
      text = replaceDosSection(text, section.key, section.value);
    }
  }

  let blankFrameValue = formatNumber(project.blankFrame, 3);
  if (originalBlankValues.length > 1) {
    const values = [...originalBlankValues];
    while (values.length < project.scoreNumber) values.push(values[values.length - 1] ?? project.blankFrame);
    values[project.scoreNumber - 1] = project.blankFrame;
    blankFrameValue = values.map((value) => formatNumber(value, 3)).join(",");
  }

  const timingValues = {
    es_blankFrame: formatNumber(project.blankFrame, 3),
    blankFrame: blankFrameValue,
    es_label: project.timings.map((t) => formatNumber(t.label, 0)).join(","),
    es_startNumber: project.timings.map((t) => formatNumber(t.startNum, 4)).join(","),
    es_bpm: project.timings.map((t) => formatNumber(t.bpm, 4)).join(","),
    es_pageBlockNumber: project.timings.map((t) => formatNumber(t.pageBlockNum, 3)).join(","),
    es_scoreNumber: formatNumber(project.scoreNumber, 0),
  };
  if (typeof project.scorePrefix === "string" && project.scorePrefix !== "") {
    timingValues.es_scorePrefix = project.scorePrefix;
  }
  for (const [key, value] of Object.entries(timingValues)) {
    text = replaceDosSection(text, key, value);
  }

  if (options.includeScreen) {
    text = replaceDosSection(text, "ringWidth", formatNumber(project.screen.width, 0));
  }

  return text;
}

export function projectToJson(project, settings) {
  return JSON.stringify(
    {
      format: "danoni-ring-note-editor",
      version: 1,
      project,
      settings,
    },
    null,
    2
  );
}

export function parseProjectJson(text) {
  const raw = JSON.parse(text);
  if (raw && typeof raw === "object" && raw.project) {
    return { project: raw.project, settings: raw.settings ?? null };
  }
  return { project: raw, settings: null };
}
