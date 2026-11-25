import { FPS, LN_DISTORTION_UNIT, MAX_PAGE, QUARTER } from "./constants.js";
import { clamp } from "./model.js";

export function sortedTimings(timings) {
  return [...(timings || [])].sort((a, b) => a.label - b.label);
}

export function timingForPage(timings, page) {
  const sorted = sortedTimings(timings);
  if (sorted.length === 0) return { label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 };
  let found = sorted[0];
  for (const timing of sorted) {
    if (timing.label <= page) found = timing;
    else break;
  }
  return found;
}

export function timingAtPage(timings, page) {
  return sortedTimings(timings).find((t) => t.label === page) ?? null;
}

export function framePerPosition(timing) {
  return (60 * FPS) / QUARTER / Math.max(1, timing.bpm);
}

export function pageSpan(timing) {
  return Math.max(1, Number(timing.pageBlockNum) || 8) * QUARTER;
}

export function labelStartFrame(project, timing) {
  return project.blankFrame + timing.startNum;
}

export function frameAt(project, timing, page, position) {
  const per = framePerPosition(timing);
  return (
    project.blankFrame +
    timing.startNum +
    (page - timing.label) * pageSpan(timing) * per +
    position * per
  );
}

export function frameForPagePosition(project, page, position) {
  return frameAt(project, timingForPage(project.timings, page), page, position);
}

export function frameForRing(project, ring) {
  return frameForPagePosition(project, ring.page, ring.position);
}

/** 1拍をQUARTER位置として表す拍位置。 */
export function beatPositionForPagePosition(project, page, position = 0) {
  const targetPage = Math.max(1, Math.floor(Number(page) || 1));
  const timings = sortedTimings(project.timings);
  let currentPage = 1;
  let timing = timingForPage(timings, 1);
  let beats = 0;

  for (const entry of timings) {
    const labelPage = Math.max(1, Math.floor(Number(entry.label) || 1));
    if (labelPage <= currentPage) {
      timing = entry;
      continue;
    }
    if (labelPage >= targetPage) break;
    beats += ((labelPage - currentPage) * pageSpan(timing)) / QUARTER;
    currentPage = labelPage;
    timing = entry;
  }

  beats += ((targetPage - currentPage) * pageSpan(timing)) / QUARTER;
  return beats + (Number(position) || 0) / QUARTER;
}

export function frameForSpeed(project, speed) {
  return Number(speed.frame) || 0;
}

/**
 * 絶対フレームをページと位置に変換する。
 * グリッド外のリング位置（小数）も保持する。
 */
export function timingAndPositionAtFrame(project, frame) {
  const timings = sortedTimings(project.timings);
  let timing = timings[0] ?? { label: 1, startNum: 0, bpm: 140, pageBlockNum: 8 };
  let chosen = 0;
  for (let i = 0; i < timings.length; i++) {
    if (labelStartFrame(project, timings[i]) <= frame) {
      timing = timings[i];
      chosen = i;
    } else {
      break;
    }
  }

  const per = framePerPosition(timing);
  const span = pageSpan(timing);
  const rel = (frame - project.blankFrame - timing.startNum) / per;
  let page;
  let position;

  if (rel < 0) {
    // ラベルの開始位置より前は、負の位置を使って絶対フレームを保つ。
    page = timing.label;
    position = rel;
  } else {
    page = timing.label + Math.floor(rel / span);
    position = rel - (page - timing.label) * span;
  }

  if (!Number.isFinite(page)) page = timing.label;
  if (!Number.isFinite(position)) position = 0;
  return {
    timing,
    page,
    position: Math.abs(position) < 1e-7 ? 0 : Math.round(position * 1e6) / 1e6,
    labelIndex: chosen,
  };
}

export function pageRange(project, page) {
  const timing = timingForPage(project.timings, page);
  const span = pageSpan(timing);
  const startFrame = frameAt(project, timing, page, 0);
  const nextTiming = timingAtPage(project.timings, page + 1);
  let endFrame = nextTiming
    ? labelStartFrame(project, nextTiming)
    : frameAt(project, timing, page + 1, 0);
  if (!(endFrame > startFrame)) {
    endFrame = startFrame + span * framePerPosition(timing);
  }
  return { page, timing, span, startFrame, endFrame };
}

export function previousPageRange(project, page) {
  if (page <= 1) return pageRange(project, 1);
  return pageRange(project, page - 1);
}

export function maxPageOfProject(project, extra = 1) {
  let maxPage = 1;
  for (const timing of project.timings || []) maxPage = Math.max(maxPage, timing.label);
  for (const ring of project.rings || []) maxPage = Math.max(maxPage, ring.page);
  for (const ln of project.lns || []) {
    maxPage = Math.max(maxPage, ln.page || 1, ln.endPage || ln.page || 1);
  }
  const referenceFrames = project.referenceNoteFrames || [];
  if (referenceFrames.length > 0) {
    const maxFrame = referenceFrames[referenceFrames.length - 1];
    const { page } = timingAndPositionAtFrame(project, maxFrame);
    maxPage = Math.max(maxPage, Math.ceil(page));
  }
  return Math.min(MAX_PAGE, Math.max(1, maxPage + extra));
}

export function snapPosition(position, step) {
  if (!(step > 0)) return position;
  return Math.round(position / step) * step;
}

export function normalizePagePosition(project, page, position) {
  let p = Math.min(MAX_PAGE, Math.max(1, Math.floor(page)));
  let timing = timingForPage(project.timings, p);
  let span = pageSpan(timing);
  let pos = Number(position);
  if (!Number.isFinite(pos)) pos = 0;
  pos = clamp(pos, -MAX_PAGE * QUARTER, MAX_PAGE * QUARTER);

  while (pos >= span) {
    pos -= span;
    p += 1;
    timing = timingForPage(project.timings, p);
    span = pageSpan(timing);
  }
  while (pos < 0) {
    if (p <= 1) {
      pos = 0;
      break;
    }
    p -= 1;
    timing = timingForPage(project.timings, p);
    span = pageSpan(timing);
    pos += span;
  }
  if (p > MAX_PAGE) {
    p = MAX_PAGE;
    pos = 0;
  }
  return { page: p, position: Math.abs(pos) < 1e-7 ? 0 : pos };
}

export function secondsForFrame(frame) {
  return frame / FPS;
}

export function formatSeconds(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(s / 60);
  const rest = s - minutes * 60;
  const whole = Math.floor(rest);
  const millis = Math.round((rest - whole) * 1000);
  if (millis === 1000) {
    const total = minutes * 60 + whole + 1;
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}.000`;
  }
  return `${minutes}:${String(whole).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function timingSummary(project, page) {
  const timing = timingForPage(project.timings, page);
  const span = pageSpan(timing);
  const frame = frameAt(project, timing, page, 0);
  return {
    timing,
    span,
    pageStartFrame: frame,
    isLabel: timing.label === page,
  };
}

export function newLabelStartNum(project, page) {
  const timing = timingForPage(project.timings, page);
  const per = framePerPosition(timing);
  return timing.startNum + (page - timing.label) * pageSpan(timing) * per;
}

export function positionsBetween(project, startPage, startPosition, endPage, endPosition) {
  let p = Math.max(1, Math.floor(Number(startPage) || 1));
  const targetP = Math.max(1, Math.floor(Number(endPage) || p));
  let delta = (Number(endPosition) || 0) - (Number(startPosition) || 0);
  while (p < targetP) {
    delta += pageSpan(timingForPage(project.timings, p));
    p += 1;
  }
  while (p > targetP) {
    p -= 1;
    delta -= pageSpan(timingForPage(project.timings, p));
  }
  return delta;
}

export function lnDurationRatio(project, ln) {
  const span = pageSpan(timingForPage(project.timings, ln.page));
  const delta = positionsBetween(project, ln.page, ln.position, ln.endPage ?? ln.page, ln.endPosition ?? ln.position);
  return Math.max(0.01, Math.round((delta / Math.max(1, span)) * 1e6) / 1e6);
}

export function lnEndForDuration(project, startPage, startPosition, durationRatio) {
  const span = pageSpan(timingForPage(project.timings, startPage));
  const delta = Math.max(0.01, Number(durationRatio) || 0.5) * span;
  return normalizePagePosition(project, startPage, (Number(startPosition) || 0) + delta);
}

export function lnNormalVector(startX, startY, endX, endY) {
  const angle = Math.atan2((Number(endY) || 0) - (Number(startY) || 0), (Number(endX) || 0) - (Number(startX) || 0));
  const normalAngle = angle + Math.PI / 2;
  return {
    angle,
    normalAngle,
    nx: Math.cos(normalAngle),
    ny: Math.sin(normalAngle),
  };
}

export function lnPointAt(ln, t, screen = null) {
  const ratio = clamp(Number(t) || 0, 0, 1);
  const sx = Number(ln.startX) || 0;
  const sy = Number(ln.startY) || 0;
  const ex = Number(ln.endX) || 0;
  const ey = Number(ln.endY) || 0;
  const distortion = Number(ln.distortion) || 0;
  let x = sx + (ex - sx) * ratio;
  let y = sy + (ey - sy) * ratio;
  if (distortion !== 0) {
    const { nx, ny } = lnNormalVector(sx, sy, ex, ey);
    const offset = LN_DISTORTION_UNIT * distortion * Math.sin(ratio * Math.PI);
    x += nx * offset;
    y += ny * offset;
  }
  if (screen && Number.isFinite(screen.width) && Number.isFinite(screen.height)) {
    x = clamp(x, 0, screen.width);
    y = clamp(y, 0, screen.height);
  }
  return { x, y };
}

export function lnDistortionFromMidpoint(ln, midX, midY) {
  const sx = Number(ln.startX) || 0;
  const sy = Number(ln.startY) || 0;
  const ex = Number(ln.endX) || 0;
  const ey = Number(ln.endY) || 0;
  const cx = (sx + ex) / 2;
  const cy = (sy + ey) / 2;
  const { nx, ny } = lnNormalVector(sx, sy, ex, ey);
  const proj = ((Number(midX) || 0) - cx) * nx + ((Number(midY) || 0) - cy) * ny;
  return clamp(Math.round((proj / LN_DISTORTION_UNIT) * 20) / 20, -20, 20);
}

export function expandLn(project, ln) {
  const count = clamp(Math.round(Number(ln.count) || 2), 2, 256);
  const includeEnd = Boolean(ln.includeEnd);
  const deltaPos = Math.max(
    0,
    positionsBetween(project, ln.page, ln.position, ln.endPage ?? ln.page, ln.endPosition ?? ln.position)
  );
  const rings = [];
  for (let i = 0; i < count; i++) {
    const t = includeEnd ? (count <= 1 ? 0 : i / (count - 1)) : i / count;
    const loc = normalizePagePosition(project, ln.page, ln.position + deltaPos * t);
    const pt = lnPointAt(ln, t, project.screen);
    rings.push({
      id: `${ln.id}:${i}`,
      lnId: ln.id,
      lnIndex: i,
      t,
      page: loc.page,
      position: loc.position,
      x: pt.x,
      y: pt.y,
      sound: i === 0 ? ln.sound : (ln.endSound ?? ln.sound),
      radius: ln.radius,
      color: ln.color,
      frames: ln.frames,
    });
  }
  return rings;
}

export function expandAllLns(project) {
  const out = [];
  for (const ln of project.lns || []) {
    out.push(...expandLn(project, ln));
  }
  return out;
}

export function allProjectRings(project) {
  return [...(project.rings || []), ...expandAllLns(project)];
}
