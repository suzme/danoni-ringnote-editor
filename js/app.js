import { DIVISORS, HISTORY_LIMIT, MAX_PAGE, DEFAULT_RADIUS, MIN_RADIUS } from "./constants.js";
import {
  clamp,
  deepClone,
  defaultProject,
  downloadText,
  formatNumber,
  loadProject,
  loadSettings,
  nextObjectId,
  normalizeColor,
  normalizeLn,
  normalizeRing,
  normalizeSpeed,
  normalizeProject,
  normalizeSettings,
  projectSnapshot,
  ringDisplayColor,
  saveProject,
  saveSettings,
} from "./model.js";
import {
  allProjectRings,
  beatPositionForPagePosition,
  expandLn,
  frameForPagePosition,
  frameForRing,
  framePerPosition,
  labelStartFrame,
  lnDurationRatio,
  lnEndForDuration,
  newLabelStartNum,
  normalizePagePosition,
  pageRange,
  pageSpan,
  positionsBetween,
  snapPosition,
  timingAndPositionAtFrame,
  timingAtPage,
  timingForPage,
} from "./timing.js";
import { buildSnippet, mergeChart, parseChart, parseProjectJson, projectToJson } from "./dos.js";
import { AudioEngine } from "./audio.js";
import { Playback } from "./playback.js";

export class App {
  constructor() {
    this.settings = loadSettings();
    const stored = loadProject();
    this.project = normalizeProject(stored ?? defaultProject());
    this.ui = {
      page: 1,
      position: 0,
      placeMode: "ring",
      selectedRingId: null,
      selectedLnId: null,
      hoverRingId: null,
      hoverLnId: null,
      lnDraftStart: null,
      lastRing: null,
      lastLn: null,
      divisor: this.settings.divisor,
    };
    this.history = { past: [], future: [] };
    this._transactionBefore = null;
    this._renderRaf = 0;
    this._structureDirty = false;
    this._scrollDirty = false;
    this._persistTimer = 0;
    this.audio = new AudioEngine();
    this.mainPlayback = null;
    this.playFrame = null;
    this.playingScope = null;
    this.clipboard = null;
    this.uiController = null;
    this.canvasView = null;
    this.timelineView = null;
    this._boundKeydown = this.handleKeydown.bind(this);
    window.addEventListener("keydown", this._boundKeydown);
    window.addEventListener("beforeunload", () => this.persistNow());
  }

  attach({ uiController, canvasView, timelineView }) {
    this.uiController = uiController;
    this.canvasView = canvasView;
    this.timelineView = timelineView;
    this.ensureSelectionValid();
    this.requestRender({ structure: true, scroll: true });
  }

  /* ------------------------------------------------------------------ */
  /* 保存・履歴・描画 */
  /* ------------------------------------------------------------------ */

  schedulePersist() {
    window.clearTimeout(this._persistTimer);
    this._persistTimer = window.setTimeout(() => this.persistNow(), 250);
  }

  persistNow() {
    saveProject(this.project);
    saveSettings(this.settings);
  }

  saveSettings() {
    saveSettings(this.settings);
  }

  snapshot() {
    return projectSnapshot(this.project);
  }

  pushHistory(before) {
    if (!before) return;
    this.history.past.push(before);
    if (this.history.past.length > HISTORY_LIMIT) this.history.past.shift();
    this.history.future.length = 0;
  }

  commit(mutator, { history = true, render = true, structure = true, reason = "edit" } = {}) {
    const before = history ? this.snapshot() : null;
    mutator(this.project);
    if (history && this.snapshot() !== before) this.pushHistory(before);
    this.afterChange({ render, structure, reason });
  }

  afterChange({ render = true, structure = true, reason = "edit" } = {}) {
    this.project = normalizeProject(this.project);
    this.ensureSelectionValid();
    this.schedulePersist();
    if (render) this.requestRender({ structure, scroll: ["timing", "page", "blank"].includes(reason) });
    if (["timing", "page", "blank", "screen", "score", "rate", "offset"].includes(reason)) {
      this.restartMainLoopIfPlaying();
    }
  }

  beginTransaction() {
    if (this._transactionBefore === null) this._transactionBefore = this.snapshot();
  }

  updateDirect(mutator, { structure = true } = {}) {
    mutator(this.project);
    this.ensureSelectionValid();
    this.schedulePersist();
    this.requestRender({ structure, scroll: false });
  }

  endTransaction() {
    if (this._transactionBefore === null) return;
    const before = this._transactionBefore;
    this._transactionBefore = null;
    if (this.snapshot() !== before) {
      this.pushHistory(before);
      this.project = normalizeProject(this.project);
      this.ensureSelectionValid();
      this.schedulePersist();
      this.requestRender({ structure: true, scroll: false });
    }
  }

  requestRender({ structure = true, scroll = false } = {}) {
    this._structureDirty = this._structureDirty || structure;
    this._scrollDirty = this._scrollDirty || scroll;
    if (this._renderRaf) return;
    this._renderRaf = requestAnimationFrame(() => {
      this._renderRaf = 0;
      const doStructure = this._structureDirty;
      const doScroll = this._scrollDirty;
      this._structureDirty = false;
      this._scrollDirty = false;
      this.uiController?.render({ structure: doStructure });
      this.canvasView?.render();
      if (doStructure) this.timelineView?.render({ scroll: doScroll });
      else this.timelineView?.updateCursors({ follow: doScroll });
    });
  }

  undo() {
    if (this.history.past.length === 0) {
      this.uiController?.toast("これ以上元に戻せません。", "warn");
      return;
    }
    this.stopMainPlayback();
    const current = this.snapshot();
    this.project = normalizeProject(JSON.parse(this.history.past.pop()));
    this.history.future.push(current);
    this.ensureSelectionValid();
    this.syncSelectionSettings();
    this.schedulePersist();
    this.requestRender({ structure: true, scroll: true });
    this.uiController?.toast("元に戻しました。");
  }

  redo() {
    if (this.history.future.length === 0) {
      this.uiController?.toast("やり直せる操作がありません。", "warn");
      return;
    }
    this.stopMainPlayback();
    const current = this.snapshot();
    this.project = normalizeProject(JSON.parse(this.history.future.pop()));
    this.history.past.push(current);
    this.ensureSelectionValid();
    this.syncSelectionSettings();
    this.schedulePersist();
    this.requestRender({ structure: true, scroll: true });
    this.uiController?.toast("やり直しました。");
  }

  ensureSelectionValid() {
    if (this.ui.selectedRingId && !this.project.rings.some((r) => r.id === this.ui.selectedRingId)) {
      this.ui.selectedRingId = null;
    }
    if (this.ui.selectedLnId && !(this.project.lns || []).some((l) => l.id === this.ui.selectedLnId)) {
      this.ui.selectedLnId = null;
    }
    if (this.ui.hoverRingId && !this.project.rings.some((r) => r.id === this.ui.hoverRingId)) {
      this.ui.hoverRingId = null;
    }
    if (this.ui.hoverLnId && !(this.project.lns || []).some((l) => l.id === this.ui.hoverLnId)) {
      this.ui.hoverLnId = null;
    }
    const range = pageRange(this.project, this.ui.page);
    if (this.ui.position < 0 || this.ui.position >= range.span) {
      const normalized = normalizePagePosition(this.project, this.ui.page, this.ui.position);
      this.ui.page = normalized.page;
      this.ui.position = normalized.position;
    }
  }

  /* ------------------------------------------------------------------ */
  /* タイミング */
  /* ------------------------------------------------------------------ */

  get currentTiming() {
    return timingForPage(this.project.timings, this.ui.page);
  }

  get currentRange() {
    return pageRange(this.project, this.ui.page);
  }

  get currentFrame() {
    return frameForPagePosition(this.project, this.ui.page, this.ui.position);
  }

  isCurrentPageLabel() {
    return Boolean(timingAtPage(this.project.timings, this.ui.page));
  }

  setPage(page, { scroll = true, resetPosition = true } = {}) {
    const next = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(page) || 1)));
    const changed = next !== this.ui.page;
    this.ui.page = next;
    if (resetPosition) this.ui.position = 0;
    else {
      const span = pageSpan(this.currentTiming);
      this.ui.position = clamp(this.ui.position, 0, span);
    }
    if (changed && this.mainPlayback?.running) {
      this.startMainPlayback();
    }
    this.requestRender({ structure: true, scroll });
  }

  stepPage(delta) {
    this.setPage(this.ui.page + delta, { scroll: true });
  }

  setPosition(page, position, { snap = false, scroll = true } = {}) {
    let nextPage = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(page) || 1)));
    let nextPos = Number(position) || 0;
    if (snap) nextPos = snapPosition(nextPos, this.ui.divisor);
    const normalized = normalizePagePosition(this.project, nextPage, nextPos);
    const pageChanged = normalized.page !== this.ui.page;
    this.ui.page = normalized.page;
    this.ui.position = normalized.position;
    if (pageChanged && this.mainPlayback?.running) {
      this.startMainPlayback();
    }
    this.requestRender({ structure: pageChanged, scroll });
  }

  moveCursor(delta, { snap = true } = {}) {
    let pos = this.ui.position + delta;
    if (snap) pos = snapPosition(pos, this.ui.divisor);
    this.setPosition(this.ui.page, pos, { snap: false });
  }

  advanceCursor() {
    this.moveCursor(this.ui.divisor, { snap: false });
  }

  setDivisor(value) {
    const divisor = Number(value);
    if (!DIVISORS.some((d) => d.value === divisor)) return;
    this.ui.divisor = divisor;
    this.settings.divisor = divisor;
    this.saveSettings();
    const snapped = snapPosition(this.ui.position, divisor);
    this.setPosition(this.ui.page, snapped, { snap: false });
    this.requestRender({ structure: true });
  }

  setActiveTimingField(field, value) {
    const timing = this.currentTiming;
    const numeric = Number(value);
    if (field === "pageBlockNum") {
      if (!Number.isFinite(numeric)) return;
      const block = clamp(Math.round(numeric * 1000) / 1000, 1, 8);
      if (block === timing.pageBlockNum) return;
      this.commit(
        (project) => {
          const target = project.timings.find((t) => t.label === timing.label);
          if (target) target.pageBlockNum = block;
        },
        { reason: "timing" }
      );
      return;
    }
    if (!Number.isFinite(numeric)) return;
    if (field === "bpm" && numeric <= 0) {
      this.uiController?.toast("BPMは1以上にしてください。", "error");
      return;
    }
    if (field === "blankFrame") {
      this.commit(
        (project) => {
          project.blankFrame = Math.max(0, numeric);
        },
        { reason: "blank" }
      );
      return;
    }
    this.commit(
      (project) => {
        const target = project.timings.find((t) => t.label === timing.label);
        if (target) target[field] = numeric;
      },
      { reason: "timing" }
    );
  }

  toggleCurrentLabel(checked) {
    const page = this.ui.page;
    const exists = Boolean(timingAtPage(this.project.timings, page));
    if (checked && !exists) {
      const timing = this.currentTiming;
      const startNum = newLabelStartNum(this.project, page);
      const block = timing.pageBlockNum;
      this.commit(
        (project) => {
          project.timings.push({
            label: page,
            startNum,
            bpm: timing.bpm,
            pageBlockNum: block,
          });
          project.timings.sort((a, b) => a.label - b.label);
        },
        { reason: "timing" }
      );
      this.requestRender({ structure: true });
    } else if (!checked && exists) {
      if (page === 1) {
        this.uiController?.toast("Page 1のLabelは削除できません。", "warn");
        this.requestRender({ structure: true });
        return;
      }
      this.commit(
        (project) => {
          project.timings = project.timings.filter((t) => t.label !== page);
        },
        { reason: "timing" }
      );
    }
  }

  jumpLabel(direction) {
    const labels = this.project.timings.map((t) => t.label).sort((a, b) => a - b);
    if (labels.length === 0) return;
    if (direction > 0) {
      const next = labels.find((label) => label > this.ui.page);
      if (next !== undefined) this.setPage(next);
      else this.uiController?.toast("次のLabelはありません。", "warn");
    } else {
      const prev = [...labels].reverse().find((label) => label < this.ui.page);
      if (prev !== undefined) this.setPage(prev);
      else this.uiController?.toast("前のLabelはありません。", "warn");
    }
  }

  setScreenSize(width, height) {
    const w = clamp(Math.round(Number(width) || 600), 100, 4000);
    const h = clamp(Math.round(Number(height) || 500), 100, 4000);
    if (w === this.project.screen.width && h === this.project.screen.height) return;
    this.commit(
      (project) => {
        project.screen.width = w;
        project.screen.height = h;
        for (const ring of project.rings) {
          ring.x = clamp(ring.x, 0, w);
          ring.y = clamp(ring.y, 0, h);
        }
        for (const ln of project.lns || []) {
          ln.startX = clamp(ln.startX, 0, w);
          ln.startY = clamp(ln.startY, 0, h);
          ln.endX = clamp(ln.endX, 0, w);
          ln.endY = clamp(ln.endY, 0, h);
        }
      },
      { reason: "screen" }
    );
    const ring = this.selectedRing;
    if (ring) this.rememberRing(ring);
    const ln = this.selectedLn;
    if (ln) this.rememberLn(ln);
  }

  setScoreNumber(value) {
    const score = Math.max(1, Math.round(Number(value) || 1));
    if (score === this.project.scoreNumber) return;
    this.commit(
      (project) => {
        project.scoreNumber = score;
      },
      { reason: "score" }
    );
  }

  /* ------------------------------------------------------------------ */
  /* リング・ロングノート */
  /* ------------------------------------------------------------------ */

  setPlaceMode(mode) {
    const next = mode === "ln" ? "ln" : "ring";
    this.ui.placeMode = next;
    this.ui.lnDraftStart = null;
    if (next === "ln") {
      this.ui.selectedRingId = null;
    } else {
      this.ui.selectedLnId = null;
    }
    this.requestRender({ structure: true });
  }

  getRing(id) {
    return this.project.rings.find((ring) => ring.id === id) ?? null;
  }

  get selectedRing() {
    return this.getRing(this.ui.selectedRingId);
  }

  getLn(id) {
    return (this.project.lns || []).find((ln) => ln.id === id) ?? null;
  }

  get selectedLn() {
    return this.getLn(this.ui.selectedLnId);
  }

  getPlacementDraft() {
    if (this.ui.lastRing) return this.ui.lastRing;
    return {
      page: this.ui.page,
      position: this.ui.position,
      x: this.project.screen.width / 2,
      y: this.project.screen.height / 2,
      sound: this.settings.tool.sound,
      radius: this.settings.tool.radius,
      color: this.settings.tool.color,
      frames: this.settings.tool.frames,
    };
  }

  getLnPlacementDraft() {
    const endLoc = lnEndForDuration(this.project, this.ui.page, this.ui.position, this.settings.ln.duration);
    const startX = this.ui.lnDraftStart?.x ?? (this.ui.lastLn?.startX ?? Math.round(this.project.screen.width * 0.25));
    const startY = this.ui.lnDraftStart?.y ?? (this.ui.lastLn?.startY ?? Math.round(this.project.screen.height * 0.5));
    return {
      page: this.ui.page,
      position: this.ui.position,
      endPage: endLoc.page,
      endPosition: endLoc.position,
      startX,
      startY,
      endX: this.ui.lastLn?.endX ?? Math.round(this.project.screen.width * 0.75),
      endY: this.ui.lastLn?.endY ?? Math.round(this.project.screen.height * 0.5),
      count: this.settings.ln.count,
      distortion: this.settings.ln.distortion,
      includeEnd: this.settings.ln.includeEnd,
      sound: this.settings.tool.sound,
      endSound: this.settings.ln.endSound,
      radius: this.settings.tool.radius,
      color: this.settings.tool.color,
      frames: this.settings.tool.frames,
    };
  }

  rememberRing(ring) {
    if (!ring) return;
    this.ui.lastRing = {
      page: ring.page,
      position: ring.position,
      x: ring.x,
      y: ring.y,
      sound: ring.sound,
      radius: ring.radius,
      color: ring.color,
      frames: ring.frames,
    };
  }

  rememberLn(ln) {
    if (!ln) return;
    this.ui.lastLn = {
      page: ln.page,
      position: ln.position,
      endPage: ln.endPage,
      endPosition: ln.endPosition,
      startX: ln.startX,
      startY: ln.startY,
      endX: ln.endX,
      endY: ln.endY,
      count: ln.count,
      distortion: ln.distortion,
      includeEnd: ln.includeEnd,
      sound: ln.sound,
      endSound: ln.endSound,
      radius: ln.radius,
      color: ln.color,
      frames: ln.frames,
    };
  }

  syncToolFromRing(ring) {
    if (!ring) return;
    this.settings.tool = {
      sound: ring.sound,
      radius: ring.radius,
      color: ring.color,
      frames: ring.frames,
    };
    this.saveSettings();
  }

  syncToolFromLn(ln) {
    if (!ln) return;
    this.settings.tool = {
      sound: ln.sound,
      radius: ln.radius,
      color: ln.color,
      frames: ln.frames,
    };
    this.settings.ln = {
      count: ln.count,
      duration: lnDurationRatio(this.project, ln),
      distortion: ln.distortion,
      endSound: ln.endSound,
      includeEnd: Boolean(ln.includeEnd),
    };
    this.saveSettings();
  }

  syncSelectionSettings() {
    const ring = this.selectedRing;
    if (ring) {
      this.rememberRing(ring);
      this.syncToolFromRing(ring);
      return;
    }
    const ln = this.selectedLn;
    if (ln) {
      this.rememberLn(ln);
      this.syncToolFromLn(ln);
    }
  }

  updateToolAppearance(patch) {
    const tool = { ...this.settings.tool };
    if ("sound" in patch) tool.sound = Math.max(0, Math.round(Number(patch.sound) || 0));
    if ("radius" in patch) tool.radius = Math.max(MIN_RADIUS, Number(patch.radius) || DEFAULT_RADIUS);
    if ("color" in patch) tool.color = normalizeColor(patch.color) || "";
    if ("frames" in patch) tool.frames = Math.max(0, Number(patch.frames) || 0);

    this.settings.tool = tool;
    if (this.ui.lastRing) {
      if ("sound" in patch) this.ui.lastRing.sound = tool.sound;
      if ("radius" in patch) this.ui.lastRing.radius = tool.radius;
      if ("color" in patch) this.ui.lastRing.color = tool.color;
      if ("frames" in patch) this.ui.lastRing.frames = tool.frames;
    }
    if (this.ui.lastLn) {
      if ("sound" in patch) this.ui.lastLn.sound = tool.sound;
      if ("radius" in patch) this.ui.lastLn.radius = tool.radius;
      if ("color" in patch) this.ui.lastLn.color = tool.color;
      if ("frames" in patch) this.ui.lastLn.frames = tool.frames;
    }
    this.saveSettings();
    this.requestRender({ structure: true });
  }

  updateLnToolSettings(patch) {
    const ln = { ...this.settings.ln };
    if ("count" in patch) ln.count = clamp(Math.round(Number(patch.count) || 8), 2, 256);
    if ("duration" in patch) ln.duration = clamp(Number(patch.duration) || 0.5, 0.01, 64);
    if ("distortion" in patch) ln.distortion = clamp(Number(patch.distortion) || 0, -20, 20);
    if ("endSound" in patch) ln.endSound = Math.max(0, Math.round(Number(patch.endSound) || 0));
    if ("includeEnd" in patch) ln.includeEnd = Boolean(patch.includeEnd);

    this.settings.ln = ln;
    if (this.ui.lastLn) {
      if ("count" in patch) this.ui.lastLn.count = ln.count;
      if ("distortion" in patch) this.ui.lastLn.distortion = ln.distortion;
      if ("endSound" in patch) this.ui.lastLn.endSound = ln.endSound;
      if ("includeEnd" in patch) this.ui.lastLn.includeEnd = ln.includeEnd;
    }
    this.saveSettings();
    this.requestRender({ structure: true });
  }

  resetToolAppearance() {
    this.settings.tool = { sound: 1, radius: DEFAULT_RADIUS, color: "", frames: 0 };
    this.settings.ln = { count: 8, duration: 0.5, distortion: 0, endSound: 1, includeEnd: false };
    this.ui.lnDraftStart = null;
    if (this.ui.lastRing) {
      this.ui.lastRing.sound = 1;
      this.ui.lastRing.radius = DEFAULT_RADIUS;
      this.ui.lastRing.color = "";
      this.ui.lastRing.frames = 0;
    }
    if (this.ui.lastLn) {
      this.ui.lastLn.sound = 1;
      this.ui.lastLn.endSound = 1;
      this.ui.lastLn.radius = DEFAULT_RADIUS;
      this.ui.lastLn.color = "";
      this.ui.lastLn.frames = 0;
      this.ui.lastLn.count = 8;
      this.ui.lastLn.distortion = 0;
      this.ui.lastLn.includeEnd = false;
    }
    this.saveSettings();
    this.requestRender({ structure: true });
  }

  ringColor(ring) {
    return ringDisplayColor(ring);
  }

  getDisplayRings() {
    const cursorBeat = this.currentBeatPosition;
    return this.project.rings.filter((ring) => this.isWithinDisplayRange(ring.page, ring.position, cursorBeat));
  }

  getDisplayLns() {
    const lns = this.project.lns || [];
    const cursorBeat = this.currentBeatPosition;
    const range = this.settings.displayRangeBeats;
    const minVisible = cursorBeat - range;
    const maxVisible = cursorBeat + range;
    return lns.filter((ln) => {
      const start = beatPositionForPagePosition(this.project, ln.page, ln.position);
      const end = beatPositionForPagePosition(this.project, ln.endPage ?? ln.page, ln.endPosition ?? ln.position);
      const lo = Math.min(start, end);
      const hi = Math.max(start, end);
      return hi >= minVisible && lo <= maxVisible;
    });
  }

  get currentBeatPosition() {
    return beatPositionForPagePosition(this.project, this.ui.page, this.ui.position);
  }

  beatPosition(page, position) {
    return beatPositionForPagePosition(this.project, page, position);
  }

  isWithinDisplayRange(page, position, cursorBeat = this.currentBeatPosition) {
    return Math.abs(this.beatPosition(page, position) - cursorBeat) <= this.settings.displayRangeBeats;
  }

  getSingleRingsInPage(page) {
    return this.project.rings
      .filter((ring) => ring.page === page)
      .sort((a, b) => a.position - b.position || a.x - b.x || a.y - b.y);
  }

  getRingsInPage(page) {
    return allProjectRings(this.project)
      .filter((ring) => ring.page === page)
      .sort((a, b) => a.position - b.position || a.x - b.x || a.y - b.y);
  }

  playSelectionSound(ringOrSound) {
    if (ringOrSound === null || ringOrSound === undefined) return;
    const sound = typeof ringOrSound === "object" ? Number(ringOrSound.sound) || 0 : Number(ringOrSound) || 0;
    if (sound <= 0) return;
    this.audio.ensureContext();
    this.audio.playRingSound(sound, 0.5);
  }

  selectRing(id, { jump = true, scroll = true } = {}) {
    const ring = this.getRing(id);
    if (!ring) {
      this.ui.selectedRingId = null;
      this.requestRender({ structure: true });
      return;
    }
    this.ui.selectedRingId = ring.id;
    this.ui.selectedLnId = null;
    this.ui.lnDraftStart = null;
    this.rememberRing(ring);
    this.syncToolFromRing(ring);
    this.playSelectionSound(ring);
    if (jump) {
      const pageChanged = ring.page !== this.ui.page;
      this.ui.page = ring.page;
      this.ui.position = ring.position;
      this.requestRender({ structure: true, scroll });
      if (pageChanged && this.mainPlayback?.running) {
        this.startMainPlayback();
      }
    } else {
      this.requestRender({ structure: true });
    }
  }

  selectLn(id, { jump = true, scroll = true, jumpToEnd = false } = {}) {
    const ln = this.getLn(id);
    if (!ln) {
      this.ui.selectedLnId = null;
      this.requestRender({ structure: true });
      return;
    }
    this.ui.selectedLnId = ln.id;
    this.ui.selectedRingId = null;
    this.ui.lnDraftStart = null;
    this.rememberLn(ln);
    this.syncToolFromLn(ln);
    this.playSelectionSound(jumpToEnd ? ln.endSound : ln.sound);
    if (jump) {
      const targetPage = jumpToEnd ? ln.endPage : ln.page;
      const targetPos = jumpToEnd ? ln.endPosition : ln.position;
      const pageChanged = targetPage !== this.ui.page;
      this.ui.page = targetPage;
      this.ui.position = targetPos;
      this.requestRender({ structure: true, scroll });
      if (pageChanged && this.mainPlayback?.running) {
        this.startMainPlayback();
      }
    } else {
      this.requestRender({ structure: true });
    }
  }

  clearSelection() {
    if (!this.ui.selectedRingId && !this.ui.selectedLnId && !this.ui.lnDraftStart) return;
    this.ui.selectedRingId = null;
    this.ui.selectedLnId = null;
    this.ui.lnDraftStart = null;
    this.requestRender({ structure: true });
  }

  addRing(partial = {}, { advance = null, select = true } = {}) {
    const tool = this.settings.tool;
    const ring = normalizeProject({
      ...defaultProject(),
      rings: [
        {
          page: partial.page ?? this.ui.page,
          position: partial.position ?? this.ui.position,
          x: partial.x ?? this.project.screen.width / 2,
          y: partial.y ?? this.project.screen.height / 2,
          sound: partial.sound ?? tool.sound,
          radius: partial.radius ?? tool.radius,
          color: partial.color ?? tool.color,
          frames: partial.frames ?? tool.frames,
        },
      ],
    }).rings[0];
    ring.id = nextObjectId(this.project, "r");
    this.commit((project) => project.rings.push(ring), { structure: true });
    if (select) {
      this.ui.selectedRingId = ring.id;
      this.ui.selectedLnId = null;
      this.rememberRing(ring);
      this.syncToolFromRing(ring);
    }
    const shouldAdvance = advance === null ? this.settings.advanceAfterPlace : advance;
    if (shouldAdvance) this.advanceCursor();
    else this.requestRender({ structure: true });
    return ring;
  }

  addLn(partial = {}, { advance = null, select = true } = {}) {
    const tool = this.settings.tool;
    const lnTool = this.settings.ln;
    const startPage = partial.page ?? this.ui.page;
    const startPos = partial.position ?? this.ui.position;
    const endLoc =
      partial.endPage !== undefined && partial.endPosition !== undefined
        ? normalizePagePosition(this.project, partial.endPage, partial.endPosition)
        : lnEndForDuration(this.project, startPage, startPos, partial.duration ?? lnTool.duration);
    const ln = normalizeLn(
      {
        page: startPage,
        position: startPos,
        endPage: endLoc.page,
        endPosition: endLoc.position,
        startX: clamp(partial.startX ?? this.project.screen.width * 0.25, 0, this.project.screen.width),
        startY: clamp(partial.startY ?? this.project.screen.height * 0.5, 0, this.project.screen.height),
        endX: clamp(partial.endX ?? this.project.screen.width * 0.75, 0, this.project.screen.width),
        endY: clamp(partial.endY ?? this.project.screen.height * 0.5, 0, this.project.screen.height),
        count: partial.count ?? lnTool.count,
        distortion: partial.distortion ?? lnTool.distortion,
        includeEnd: partial.includeEnd ?? lnTool.includeEnd,
        sound: partial.sound ?? tool.sound,
        endSound: partial.endSound ?? lnTool.endSound,
        radius: partial.radius ?? tool.radius,
        color: partial.color ?? tool.color,
        frames: partial.frames ?? tool.frames,
      },
      nextObjectId(this.project, "ln")
    );
    this.ui.lnDraftStart = null;
    this.commit((project) => project.lns.push(ln), { structure: true });
    if (select) {
      this.ui.selectedLnId = ln.id;
      this.ui.selectedRingId = null;
      this.rememberLn(ln);
      this.syncToolFromLn(ln);
    } else {
      this.rememberLn(ln);
    }
    const shouldAdvance = advance === null ? this.settings.advanceAfterPlace : advance;
    if (shouldAdvance) {
      this.setPosition(ln.endPage, ln.endPosition, { snap: false });
    } else {
      this.requestRender({ structure: true });
    }
    return ln;
  }

  _normalizeLnPatch(ln, patch) {
    const out = {};
    if ("radius" in patch) out.radius = Math.max(MIN_RADIUS, Number(patch.radius) || DEFAULT_RADIUS);
    if ("startX" in patch) out.startX = clamp(Number(patch.startX) || 0, 0, this.project.screen.width);
    if ("startY" in patch) out.startY = clamp(Number(patch.startY) || 0, 0, this.project.screen.height);
    if ("endX" in patch) out.endX = clamp(Number(patch.endX) || 0, 0, this.project.screen.width);
    if ("endY" in patch) out.endY = clamp(Number(patch.endY) || 0, 0, this.project.screen.height);
    if ("count" in patch) out.count = clamp(Math.round(Number(patch.count) || 2), 2, 256);
    if ("distortion" in patch) out.distortion = clamp(Number(patch.distortion) || 0, -20, 20);
    if ("includeEnd" in patch) out.includeEnd = Boolean(patch.includeEnd);
    if ("sound" in patch) out.sound = Math.max(0, Math.round(Number(patch.sound) || 0));
    if ("endSound" in patch) out.endSound = Math.max(0, Math.round(Number(patch.endSound) || 0));
    if ("frames" in patch) out.frames = Math.max(0, Number(patch.frames) || 0);
    if ("color" in patch) out.color = normalizeColor(patch.color) || "";

    let startPage = ln.page;
    let startPos = ln.position;
    let endPage = ln.endPage;
    let endPos = ln.endPosition;
    const minStep = 1;

    if ("page" in patch || "position" in patch) {
      const loc = normalizePagePosition(this.project, patch.page ?? ln.page, patch.position ?? ln.position);
      startPage = loc.page;
      startPos = loc.position;
      out.page = startPage;
      out.position = startPos;
    }

    if ("duration" in patch) {
      const dur = clamp(Number(patch.duration) || 0.5, 0.01, 64);
      const endLoc = lnEndForDuration(this.project, startPage, startPos, dur);
      endPage = endLoc.page;
      endPos = endLoc.position;
      out.endPage = endPage;
      out.endPosition = endPos;
    } else if ("endPage" in patch || "endPosition" in patch) {
      const endLoc = normalizePagePosition(
        this.project,
        patch.endPage ?? ln.endPage,
        patch.endPosition ?? ln.endPosition
      );
      endPage = endLoc.page;
      endPos = endLoc.position;
      out.endPage = endPage;
      out.endPosition = endPos;
    }

    // 始点と終点の間隔が最小値以上になるよう調整する。
    const delta = positionsBetween(this.project, startPage, startPos, endPage, endPos);
    if (delta < minStep) {
      if (("page" in patch || "position" in patch) && !("endPage" in patch || "endPosition" in patch)) {
        const clampedStart = normalizePagePosition(this.project, endPage, endPos - minStep);
        out.page = clampedStart.page;
        out.position = clampedStart.position;
      } else {
        const clampedEnd = normalizePagePosition(this.project, startPage, startPos + minStep);
        out.endPage = clampedEnd.page;
        out.endPosition = clampedEnd.position;
      }
    }

    return out;
  }

  updateLn(id, patch, { history = true, structure = true } = {}) {
    const ln = this.getLn(id);
    if (!ln) return;
    const normalizedPatch = this._normalizeLnPatch(ln, patch);
    this.commit(
      (project) => {
        const target = (project.lns || []).find((l) => l.id === id);
        if (target) Object.assign(target, normalizedPatch);
      },
      { history, structure }
    );
    const target = this.getLn(id);
    if (target && this.ui.selectedLnId === id) {
      this.rememberLn(target);
      this.syncToolFromLn(target);
    }
  }

  updateLnDirect(id, patch) {
    const ln = this.getLn(id);
    if (!ln) return;
    const normalizedPatch = this._normalizeLnPatch(ln, patch);
    this.updateDirect(
      (project) => {
        const target = (project.lns || []).find((l) => l.id === id);
        if (target) Object.assign(target, normalizedPatch);
      },
      { structure: true }
    );
    const target = this.getLn(id);
    if (target && this.ui.selectedLnId === id) {
      this.rememberLn(target);
      this.syncToolFromLn(target);
    }
  }

  deleteLn(id) {
    if (!this.getLn(id)) return;
    this.commit(
      (project) => {
        project.lns = (project.lns || []).filter((ln) => ln.id !== id);
      },
      { structure: true }
    );
    if (this.ui.selectedLnId === id) this.ui.selectedLnId = null;
    this.requestRender({ structure: true });
  }

  decomposeSelectedLn() {
    const ln = this.selectedLn;
    if (!ln) return;
    const expanded = expandLn(this.project, ln);
    let firstId = null;
    this.commit(
      (project) => {
        project.lns = (project.lns || []).filter((item) => item.id !== ln.id);
        for (const ring of expanded) {
          const id = nextObjectId(project, "r");
          if (!firstId) firstId = id;
          project.rings.push({
            id,
            page: ring.page,
            position: ring.position,
            x: ring.x,
            y: ring.y,
            sound: ring.sound,
            radius: ring.radius,
            color: ring.color,
            frames: ring.frames,
          });
        }
      },
      { structure: true }
    );
    this.ui.selectedLnId = null;
    this.ui.selectedRingId = firstId;
    this.requestRender({ structure: true });
    this.uiController?.toast(`LNを ${expanded.length} 個の単体リングに分解しました。`, "success");
  }

  updateRing(id, patch, { history = true, structure = true } = {}) {
    const ring = this.getRing(id);
    if (!ring) return;
    const normalizedPatch = { ...patch };
    if ("radius" in normalizedPatch) normalizedPatch.radius = Math.max(MIN_RADIUS, Number(normalizedPatch.radius) || DEFAULT_RADIUS);
    if ("x" in normalizedPatch) normalizedPatch.x = clamp(Number(normalizedPatch.x) || 0, 0, this.project.screen.width);
    if ("y" in normalizedPatch) normalizedPatch.y = clamp(Number(normalizedPatch.y) || 0, 0, this.project.screen.height);
    if ("sound" in normalizedPatch) normalizedPatch.sound = Math.max(0, Math.round(Number(normalizedPatch.sound) || 0));
    if ("frames" in normalizedPatch) normalizedPatch.frames = Math.max(0, Number(normalizedPatch.frames) || 0);
    if ("color" in normalizedPatch) normalizedPatch.color = normalizeColor(normalizedPatch.color) || "";
    if ("page" in normalizedPatch || "position" in normalizedPatch) {
      const loc = normalizePagePosition(
        this.project,
        normalizedPatch.page ?? ring.page,
        normalizedPatch.position ?? ring.position
      );
      normalizedPatch.page = loc.page;
      normalizedPatch.position = loc.position;
    }
    this.commit(
      (project) => {
        const target = project.rings.find((r) => r.id === id);
        if (target) Object.assign(target, normalizedPatch);
      },
      { history, structure }
    );
    const target = this.getRing(id);
    if (target && this.ui.selectedRingId === id) {
      this.rememberRing(target);
      if (["sound", "radius", "color", "frames"].some((key) => key in normalizedPatch)) {
        this.syncToolFromRing(target);
      }
    }
  }

  updateRingDirect(id, patch) {
    const ring = this.getRing(id);
    if (!ring) return;
    this.updateDirect(
      (project) => {
        const target = project.rings.find((r) => r.id === id);
        if (target) Object.assign(target, patch);
      },
      { structure: true }
    );
    const target = this.getRing(id);
    if (target && this.ui.selectedRingId === id) {
      this.rememberRing(target);
      if (["sound", "radius", "color", "frames"].some((key) => key in patch)) {
        this.syncToolFromRing(target);
      }
    }
  }

  updateSpeedDirect(id, patch) {
    if (!this.project.speeds.some((speed) => speed.id === id)) return;
    this.updateDirect((project) => {
      const target = project.speeds.find((speed) => speed.id === id);
      if (target) Object.assign(target, patch);
    });
  }

  setRingFrame(id, frame) {
    const ring = this.getRing(id);
    if (!ring) return;
    const value = Number(frame);
    if (!Number.isFinite(value)) return;
    const loc = timingAndPositionAtFrame(this.project, value);
    const page = Math.max(1, loc.page);
    this.updateRing(id, { page, position: loc.position }, { structure: true });
    if (page !== this.ui.page) {
      this.ui.page = page;
      this.ui.position = loc.position;
      this.requestRender({ structure: true, scroll: true });
    }
  }

  deleteRing(id) {
    if (!this.getRing(id)) return;
    this.commit((project) => {
      project.rings = project.rings.filter((ring) => ring.id !== id);
    }, { structure: true });
    if (this.ui.selectedRingId === id) this.ui.selectedRingId = null;
    this.requestRender({ structure: true });
  }

  getNotesAtCursor() {
    const rings = this.getSingleRingsInPage(this.ui.page).filter(
      (ring) => Math.abs(ring.position - this.ui.position) < 1e-4
    );
    const lns = (this.project.lns || []).filter(
      (ln) => ln.page === this.ui.page && Math.abs(ln.position - this.ui.position) < 1e-4
    );
    return { rings, lns };
  }

  deleteRingAtCursor() {
    const { rings } = this.getNotesAtCursor();
    if (rings.length === 0) {
      this.uiController?.toast("編集カーソル位置にリングがありません。", "warn");
      return;
    }
    const target =
      rings.find((ring) => ring.id === this.ui.selectedRingId) ??
      [...rings].sort((a, b) => b.radius - a.radius)[0];
    this.deleteRing(target.id);
  }

  moveNoteAtCursor(delta) {
    const { rings, lns } = this.getNotesAtCursor();
    const ring =
      rings.find((item) => item.id === this.ui.selectedRingId) ??
      [...rings].sort((a, b) => b.radius - a.radius)[0] ??
      null;
    const ln = lns.find((item) => item.id === this.ui.selectedLnId) ?? lns[0] ?? null;
    const target = ring ? { kind: "ring", item: ring } : ln ? { kind: "ln", item: ln } : null;

    const nextPos = snapPosition(this.ui.position + delta, this.ui.divisor);
    const nextLoc = normalizePagePosition(this.project, this.ui.page, nextPos);

    if (target) {
      const applied = positionsBetween(
        this.project,
        this.ui.page,
        this.ui.position,
        nextLoc.page,
        nextLoc.position
      );
      if (applied !== 0) {
        if (target.kind === "ring") {
          const loc = normalizePagePosition(this.project, target.item.page, target.item.position + applied);
          this.updateRing(
            target.item.id,
            { page: loc.page, position: loc.position },
            { structure: true }
          );
        } else {
          const start = normalizePagePosition(
            this.project,
            target.item.page,
            target.item.position + applied
          );
          const end = normalizePagePosition(
            this.project,
            target.item.endPage ?? target.item.page,
            (target.item.endPosition ?? target.item.position) + applied
          );
          this.updateLn(
            target.item.id,
            {
              page: start.page,
              position: start.position,
              endPage: end.page,
              endPosition: end.position,
            },
            { structure: true }
          );
        }
      }
    }

    this.setPosition(nextLoc.page, nextLoc.position, { snap: false });
  }

  duplicateSelected() {
    const ln = this.selectedLn;
    if (ln) {
      const duration = lnDurationRatio(this.project, ln);
      this.addLn(
        {
          page: this.ui.page,
          position: this.ui.position,
          duration,
          startX: ln.startX,
          startY: ln.startY,
          endX: ln.endX,
          endY: ln.endY,
          count: ln.count,
          distortion: ln.distortion,
          includeEnd: ln.includeEnd,
          sound: ln.sound,
          endSound: ln.endSound,
          radius: ln.radius,
          color: ln.color,
          frames: ln.frames,
        },
        { advance: true }
      );
      return;
    }
    const ring = this.selectedRing;
    if (!ring) {
      this.uiController?.toast("複製するリングまたはLNを選択してください。", "warn");
      return;
    }
    this.addRing(
      {
        page: this.ui.page,
        position: this.ui.position,
        x: ring.x,
        y: ring.y,
        sound: ring.sound,
        radius: ring.radius,
        color: ring.color,
        frames: ring.frames,
      },
      { advance: true }
    );
  }

  copySelected() {
    const ln = this.selectedLn;
    if (ln) {
      this.clipboard = {
        kind: "ln",
        data: deepClone(ln),
        duration: lnDurationRatio(this.project, ln),
      };
      this.uiController?.toast("選択LNをコピーしました。");
      return;
    }
    const ring = this.selectedRing;
    if (!ring) {
      this.uiController?.toast("コピーするリングまたはLNを選択してください。", "warn");
      return;
    }
    this.clipboard = { kind: "ring", data: deepClone(ring) };
    this.uiController?.toast("選択リングをコピーしました。");
  }

  pasteRing() {
    if (!this.clipboard) {
      this.uiController?.toast("コピーされたデータがありません。", "warn");
      return;
    }
    if (this.clipboard.kind === "ln") {
      const ln = this.clipboard.data;
      this.addLn(
        {
          page: this.ui.page,
          position: this.ui.position,
          duration: this.clipboard.duration,
          startX: ln.startX,
          startY: ln.startY,
          endX: ln.endX,
          endY: ln.endY,
          count: ln.count,
          distortion: ln.distortion,
          includeEnd: ln.includeEnd,
          sound: ln.sound,
          endSound: ln.endSound,
          radius: ln.radius,
          color: ln.color,
          frames: ln.frames,
        },
        { advance: true }
      );
      return;
    }
    const item = this.clipboard.data ?? this.clipboard;
    this.addRing(
      {
        page: this.ui.page,
        position: this.ui.position,
        x: item.x,
        y: item.y,
        sound: item.sound,
        radius: item.radius,
        color: item.color,
        frames: item.frames,
      },
      { advance: true }
    );
  }

  /* ------------------------------------------------------------------ */
  /* ページのクリップボード操作 */
  /* ------------------------------------------------------------------ */

  getPageData(page = this.ui.page) {
    const range = pageRange(this.project, page);
    return {
      page,
      rings: this.project.rings
        .filter((ring) => ring.page === page)
        .map(({ id, ...ring }) => deepClone(ring)),
      lns: (this.project.lns || [])
        .filter((ln) => ln.page === page)
        .map((ln) => {
          const { id, ...rest } = ln;
          return { ...deepClone(rest), duration: lnDurationRatio(this.project, ln) };
        }),
      speeds: this.project.speeds
        .filter((speed) => speed.frame >= range.startFrame && speed.frame < range.endFrame)
        .map((speed) => ({
          type: speed.type,
          value: speed.value,
          position: (speed.frame - range.startFrame) / framePerPosition(range.timing),
        })),
    };
  }

  _pageDataSummary(data) {
    return `リング ${data.rings.length} / LN ${data.lns.length} / 速度変化 ${data.speeds.length}`;
  }

  _pageDataCount(data) {
    return data.rings.length + data.lns.length + data.speeds.length;
  }

  copyPage(page = this.ui.page) {
    const data = this.getPageData(page);
    this.clipboard = { kind: "page", data };
    this.uiController?.toast(`Page ${page} をコピーしました（${this._pageDataSummary(data)}）。`);
    return data;
  }

  cutPage(page = this.ui.page) {
    const data = this.getPageData(page);
    this.clipboard = { kind: "page", data };
    if (this._pageDataCount(data) === 0) {
      this.uiController?.toast(`Page ${page} は空のため、切り取るものがありません。`, "warn");
      return;
    }
    this.commit((project) => this._removePageData(project, page), {
      structure: true,
      reason: "page",
    });
    this.uiController?.toast(`Page ${page} を切り取りました（${this._pageDataSummary(data)}）。`);
  }

  deletePage(page = this.ui.page) {
    const data = this.getPageData(page);
    this.commit((project) => this._removePageAndShift(project, page), {
      structure: true,
      reason: "page",
    });
    const summary = this._pageDataCount(data) > 0 ? `（${this._pageDataSummary(data)}）` : "";
    this.uiController?.toast(
      `Page ${page} を削除しました${summary}。以降のページを1ページ分詰めました。`
    );
  }

  pastePage(page = this.ui.page) {
    if (!this.clipboard || this.clipboard.kind !== "page") {
      this.uiController?.toast("コピーされたページがありません。", "warn");
      return;
    }
    const data = deepClone(this.clipboard.data);
    this.commit(
      (project) => {
        this._removePageData(project, page);
        this._appendPageData(project, page, data);
      },
      { structure: true, reason: "page" }
    );
    this.uiController?.toast(`Page ${page} に貼り付けました（${this._pageDataSummary(data)}）。`);
  }

  insertPage(page = this.ui.page) {
    if (!this._canInsertPage(this.project, page)) {
      this.uiController?.toast(`Page ${MAX_PAGE} 以降には挿入できません。`, "warn");
      return;
    }
    // 挿入したページは空なので、編集カーソルを先頭に置く。
    this.ui.position = 0;
    this.commit(
      (project) => {
        const delta = this._insertedPageFrameDelta(project, page);
        const startFrame = pageRange(project, page).startFrame;
        const labelAtPage = timingAtPage(project.timings, page);

        for (const timing of project.timings) {
          if (timing.label >= page) {
            timing.label += 1;
            timing.startNum += delta;
          }
        }
        // 1ページ目には必ずラベルが必要。挿入ページと一緒に移動した場合は、
        // 挿入ページのタイミングを保つため、新たに1ページ目のラベルを追加する。
        if (page === 1 && labelAtPage) {
          project.timings.push({
            label: 1,
            startNum: 0,
            bpm: labelAtPage.bpm,
            pageBlockNum: labelAtPage.pageBlockNum,
          });
          project.timings.sort((a, b) => a.label - b.label);
        }
        for (const ring of project.rings) {
          if (ring.page >= page) ring.page += 1;
        }
        for (const ln of project.lns || []) {
          if (ln.page >= page) {
            ln.page += 1;
            ln.endPage += 1;
          }
        }
        for (const speed of project.speeds) {
          if (speed.frame >= startFrame) speed.frame += delta;
        }
      },
      { structure: true, reason: "page" }
    );
    this.uiController?.toast(`Page ${page} に空ページを挿入しました。`);
  }

  _removePageData(project, page) {
    const range = pageRange(project, page);
    project.rings = project.rings.filter((ring) => ring.page !== page);
    project.lns = (project.lns || []).filter((ln) => ln.page !== page);
    project.speeds = project.speeds.filter(
      (speed) => !(speed.frame >= range.startFrame && speed.frame < range.endFrame)
    );
  }

  _removePageAndShift(project, page) {
    const range = pageRange(project, page);
    const delta = range.endFrame - range.startFrame;
    const hasLaterLabel = project.timings.some((timing) => timing.label > page);

    this._removePageData(project, page);

    for (const ring of project.rings) {
      if (ring.page > page) ring.page -= 1;
    }
    for (const ln of project.lns || []) {
      if (ln.page > page) {
        ln.page -= 1;
        ln.endPage -= 1;
        continue;
      }
      const endPage = ln.endPage ?? ln.page;
      if (endPage > page) {
        ln.endPage -= 1;
      } else if (endPage === page) {
        // 削除ページ内で終わるLNは、削除境界の前ページ末尾で終える。
        ln.endPage = page - 1;
        ln.endPosition = pageSpan(timingForPage(project.timings, page - 1));
      }
    }
    project.timings = project.timings.filter((timing) => {
      if (timing.label < page) return true;
      if (timing.label > page) {
        timing.label -= 1;
        timing.startNum -= delta;
        return true;
      }
      // 削除ページ自身のLabelは取り除く。Page 1だけは後続Labelがない場合に
      // 元の設定を引き継いで、必ずLabel 1が残るようにする。
      return page === 1 && !hasLaterLabel;
    });
    for (const speed of project.speeds) {
      if (speed.frame >= range.endFrame) speed.frame -= delta;
    }
  }

  _appendPageData(project, page, data) {
    if (!data) return;
    const range = pageRange(project, page);
    const maxPosition = Math.max(0, range.span - 1e-6);
    const clampPosition = (value) => clamp(Number(value) || 0, 0, maxPosition);

    for (const ring of data.rings || []) {
      project.rings.push(
        normalizeRing(
          { ...ring, page, position: clampPosition(ring.position) },
          nextObjectId(project, "r")
        )
      );
    }
    for (const ln of data.lns || []) {
      const position = clampPosition(ln.position);
      const endLoc = lnEndForDuration(project, page, position, ln.duration ?? 0.5);
      project.lns.push(
        normalizeLn(
          {
            ...ln,
            page,
            position,
            endPage: endLoc.page,
            endPosition: endLoc.position,
          },
          nextObjectId(project, "ln")
        )
      );
    }
    for (const speed of data.speeds || []) {
      const frame = frameForPagePosition(project, page, clampPosition(speed.position));
      project.speeds.push(
        normalizeSpeed({ ...speed, frame }, nextObjectId(project, "s"))
      );
    }
  }

  _insertedPageFrameDelta(project, page) {
    const labelAtPage = timingAtPage(project.timings, page);
    const timing =
      labelAtPage && page > 1
        ? timingForPage(project.timings, page - 1)
        : timingForPage(project.timings, page);
    return pageSpan(timing) * framePerPosition(timing);
  }

  _canInsertPage(project, page) {
    if (page >= MAX_PAGE) return false;
    if (project.rings.some((ring) => ring.page >= MAX_PAGE)) return false;
    if (
      (project.lns || []).some(
        (ln) => ln.page >= page && (ln.endPage ?? ln.page) >= MAX_PAGE
      )
    ) {
      return false;
    }
    if (project.timings.some((timing) => timing.label >= page && timing.label >= MAX_PAGE)) {
      return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* 速度 */
  /* ------------------------------------------------------------------ */

  get speedCount() {
    return this.project.speeds.length;
  }

  getSpeedsInPage() {
    return [...this.project.speeds].sort((a, b) => a.frame - b.frame);
  }

  addSpeed(type, value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      this.uiController?.toast("速度倍率を数値で入力してください。", "error");
      return;
    }
    const speed = {
      id: nextObjectId(this.project, "s"),
      type: type === "boost" ? "boost" : "speed",
      frame: Math.max(0, this.currentFrame),
      value: numeric,
    };
    this.commit((project) => project.speeds.push(speed), { structure: true, reason: "speed" });
  }

  deleteSpeed(id) {
    this.commit((project) => {
      project.speeds = project.speeds.filter((speed) => speed.id !== id);
    }, { structure: true, reason: "speed" });
  }

  seekToSpeed(id, { scroll = true } = {}) {
    const speed = this.project.speeds.find((s) => s.id === id);
    if (!speed) return;
    const location = timingAndPositionAtFrame(this.project, speed.frame);
    this.setPosition(Math.max(1, location.page), location.position, { snap: false, scroll });
  }

  /* ------------------------------------------------------------------ */
  /* 再生 */
  /* ------------------------------------------------------------------ */

  getPageRingSoundEvents(page) {
    return this.getRingsInPage(page)
      .map((ring) => ({ arrival: frameForRing(this.project, ring), sound: ring.sound }))
      .sort((a, b) => a.arrival - b.arrival);
  }

  startMainPlayback() {
    if (!this.uiController) return;
    this.audio.ensureContext();
    this.stopMainPlayback({ silent: true });
    const info = pageRange(this.project, this.ui.page);
    const startFrame = info.startFrame;
    this.playFrame = startFrame;
    this.playingScope = "main";
    this.mainPlayback = new Playback(this.audio, {
      ringsProvider: () => this.getPageRingSoundEvents(this.ui.page),
      onFrame: (frame) => {
        this.playFrame = frame;
        this.timelineView?.setPlayhead(frame);
        this.uiController?.updatePlayStatus(frame, info);
      },
      onStateChange: (state, options) => {
        if (state === "stopped") {
          this.playingScope = null;
          this.uiController?.setPlaying(false);
          this.timelineView?.setPlayhead(this.playFrame, true);
          this.uiController?.updatePlayStatus(null, info);
          if (options?.keepFrame) this.playFrame = this.playFrame;
        }
      },
    });
    this.mainPlayback.start({
      startFrame,
      loopStart: info.startFrame,
      loopEnd: info.endFrame,
      loop: true,
      rate: this.settings.musicRate,
      withAudio: this.audio.hasMusic(),
      originFrame: this.project.blankFrame,
      offsetFrames: this.settings.musicOffset,
      volume: this.settings.musicVolume,
    });
    this.uiController.setPlaying(true);
  }

  stopMainPlayback({ silent = false } = {}) {
    if (this.mainPlayback) {
      this.mainPlayback.stop({ silent });
      this.mainPlayback = null;
    }
    this.playingScope = null;
    this.uiController?.setPlaying(false);
    this.uiController?.updatePlayStatus(null, pageRange(this.project, this.ui.page));
    if (!silent) this.timelineView?.setPlayhead(this.playFrame, true);
  }

  toggleMainPlayback() {
    if (this.mainPlayback?.running) this.stopMainPlayback();
    else this.startMainPlayback();
  }

  restartMainLoopIfPlaying() {
    if (this.mainPlayback?.running) {
      setTimeout(() => {
        if (this.mainPlayback?.running) this.startMainPlayback();
      }, 0);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 読み込み・書き出し */
  /* ------------------------------------------------------------------ */

  importChart(text, options = {}) {
    const parsed = parseChart(text);
    const withRings = options.rings !== false;
    const project = normalizeProject({
      ...this.project,
      blankFrame: parsed.meta.blankFrame,
      timings: parsed.meta.timings,
      scoreNumber: parsed.meta.scoreNumber,
      scorePrefix: parsed.meta.scorePrefix,
      importedChart: text,
      importedChartName: options.fileName || this.project.importedChartName || "",
      title: parsed.meta.title || this.project.title,
      artist: parsed.meta.artist || this.project.artist,
    });
    if (options.screen !== false && parsed.meta.screen) {
      project.screen.width = clamp(parsed.meta.screen.width, 100, 4000);
      project.screen.height = clamp(parsed.meta.screen.height, 100, 4000);
    }
    if (withRings) {
      project.rings = parsed.rings.map((ring) => ({
        ...ring,
        id: nextObjectId(project, "r"),
        x: clamp(ring.x, 0, project.screen.width),
        y: clamp(ring.y, 0, project.screen.height),
      }));
      project.lns = [];
      project.speeds = parsed.speeds.map((speed) => ({
        ...speed,
        id: nextObjectId(project, "s"),
      }));
    } else {
      project.rings = this.project.rings;
      project.lns = this.project.lns;
      project.speeds = this.project.speeds;
    }
    project.referenceNoteFrames =
      options.references === false ? [] : parsed.referenceNoteFrames;

    const before = this.snapshot();
    this.project = normalizeProject(project);
    this.ui.page = 1;
    this.ui.position = 0;
    this.ui.selectedRingId = null;
    this.ui.selectedLnId = null;
    this.ui.lnDraftStart = null;
    this.ui.lastRing = null;
    this.ui.lastLn = null;
    this.playFrame = null;
    this.stopMainPlayback({ silent: true });
    this.pushHistory(before);
    this.schedulePersist();
    this.requestRender({ structure: true, scroll: true });
    return {
      rings: parsed.rings.length,
      speeds: parsed.speeds.length,
      references: parsed.referenceNoteFrames.length,
      labels: parsed.meta.timings.map((t) => t.label),
      bpm: parsed.meta.timings.map((t) => t.bpm),
      blankFrame: parsed.meta.blankFrame,
      warnings: parsed.warnings,
    };
  }

  importProject(text) {
    const { project, settings } = parseProjectJson(text);
    const before = this.snapshot();
    this.project = normalizeProject(project);
    if (settings) {
      this.settings = normalizeSettings(settings);
      this.ui.divisor = this.settings.divisor;
    }
    this.ui.page = 1;
    this.ui.position = 0;
    this.ui.selectedRingId = null;
    this.ui.selectedLnId = null;
    this.ui.hoverRingId = null;
    this.ui.hoverLnId = null;
    this.ui.lnDraftStart = null;
    this.ui.lastRing = null;
    this.ui.lastLn = null;
    this.playFrame = null;
    this.stopMainPlayback({ silent: true });
    this.pushHistory(before);
    this.schedulePersist();
    this.saveSettings();
    this.requestRender({ structure: true, scroll: true });
  }

  newProject() {
    const before = this.snapshot();
    this.project = normalizeProject(defaultProject());
    this.ui.page = 1;
    this.ui.position = 0;
    this.ui.selectedRingId = null;
    this.ui.selectedLnId = null;
    this.ui.hoverRingId = null;
    this.ui.hoverLnId = null;
    this.ui.lnDraftStart = null;
    this.ui.lastRing = null;
    this.ui.lastLn = null;
    this.playFrame = null;
    this.stopMainPlayback({ silent: true });
    this.pushHistory(before);
    this.schedulePersist();
    this.requestRender({ structure: true, scroll: true });
  }

  buildExport(mode, options = {}) {
    if (mode === "project") {
      return {
        text: projectToJson(this.project, this.settings),
        note: "セーブデータには設定も含まれます。",
      };
    }
    if (mode === "snippet") {
      const text = buildSnippet(this.project, {
        includeEmpty: options.includeEmpty,
        includeScreen: options.includeScreen,
      });
      let note = text ? "既存譜面のring_data欄に貼り付けてください。" : "出力するリングがありません。";
      if (options.includeScreen) {
        note += ` 画面サイズヘッダ（playingWidth=${formatNumber(this.project.screen.width, 0)} / playingHeight=${formatNumber(this.project.screen.height, 0)} / ringWidth=${formatNumber(this.project.screen.width, 0)}）を先頭に付けました。既存の同名ヘッダがある場合は置き換えてください。`;
      }
      return { text, note };
    }
    const hasImportedChart = Boolean(this.project.importedChart);
    const text = mergeChart(this.project.importedChart || "|", this.project, {
      includeEmpty: options.includeEmpty,
      removeEmpty: true,
      includeScreen: options.includeScreen,
    });
    let note = hasImportedChart
      ? "元の譜面の ring_data / ring_speed_data / ring_boost_data を置き換えたテキストです。"
      : "リングデータに es_bpm などの譜面設定を追加したテキストです。";
    if (options.includeScreen) note += " 画面サイズヘッダも追記しました。";
    return { text, note };
  }

  downloadProject() {
    const name = (this.project.importedChartName || "ring-chart").replace(/\.[^.]+$/, "");
    downloadText(`${name || "ring-chart"}-ring.json`, projectToJson(this.project, this.settings), "application/json");
    this.uiController?.toast("セーブデータを保存しました。", "success");
  }

  /* ------------------------------------------------------------------ */
  /* 検証 */
  /* ------------------------------------------------------------------ */

  validate() {
    const warnings = [];
    const push = (level, message, extra = {}) => warnings.push({ level, message, ...extra });
    const timings = [...this.project.timings].sort((a, b) => a.label - b.label);

    if (timings.length === 0) push("error", "Labelが1つもありません。");
    if (!timings.some((t) => t.label === 1)) push("error", "Page 1のLabelがありません。");
    const seenLabels = new Set();
    for (const timing of timings) {
      if (seenLabels.has(timing.label)) push("error", `Label Page ${timing.label} が重複しています。`);
      seenLabels.add(timing.label);
      if (!(timing.bpm > 0)) push("error", `Label Page ${timing.label} のBPMが不正です。`);
      if (!(timing.pageBlockNum >= 1 && timing.pageBlockNum <= 8)) {
        push("error", `Label Page ${timing.label} のPage Blockは1〜8にしてください。`);
      }
    }
    for (let i = 1; i < timings.length; i++) {
      const prev = timings[i - 1];
      const current = timings[i];
      if (labelStartFrame(this.project, current) < labelStartFrame(this.project, prev)) {
        push("warn", `Label Page ${current.label} の開始フレームが前のLabelより小さくなっています。`);
      }
    }

    const duplicateKeys = new Map();
    for (const ring of this.project.rings) {
      const span = pageSpan(timingForPage(this.project.timings, ring.page));
      if (ring.x < 0 || ring.x > this.project.screen.width || ring.y < 0 || ring.y > this.project.screen.height) {
        push("warn", `リング ${this.ringLabel(ring)} が画面外にあります。`, { ringId: ring.id });
      }
      if (ring.radius < MIN_RADIUS) push("warn", `リング ${this.ringLabel(ring)} の半径が5px未満です。`, { ringId: ring.id });
      if (ring.position < 0 || ring.position >= span) {
        push("warn", `リング ${this.ringLabel(ring)} の位置がページ範囲外です。`, { ringId: ring.id });
      }
      const frame = frameForRing(this.project, ring);
      if (frame < this.project.blankFrame) {
        push("warn", `リング ${this.ringLabel(ring)} がBlank Frameより前です。`, { ringId: ring.id });
      }
      if (!Number.isFinite(frame)) push("error", "フレーム計算できないリングがあります。", { ringId: ring.id });
      const key = `${formatNumber(frame, 3)}|${formatNumber(ring.x, 3)}|${formatNumber(ring.y, 3)}`;
      if (duplicateKeys.has(key)) {
        push("warn", `同じ時間・座標のリングがあります: ${this.ringLabel(ring)}`, { ringId: ring.id });
      } else duplicateKeys.set(key, ring.id);
    }

    for (const ln of this.project.lns || []) {
      const startFrame = frameForPagePosition(this.project, ln.page, ln.position);
      const endFrame = frameForPagePosition(this.project, ln.endPage, ln.endPosition);
      if (endFrame < startFrame) {
        push("warn", `LN ${this.lnLabel(ln)} の終点時間が始点より前になっています。`, { lnId: ln.id });
      }
      if (startFrame < this.project.blankFrame) {
        push("warn", `LN ${this.lnLabel(ln)} がBlank Frameより前です。`, { lnId: ln.id });
      }
    }

    for (const speed of this.project.speeds) {
      if (!Number.isFinite(Number(speed.frame))) {
        push("error", "フレームが不正なリング速度変化があります。");
      } else if (speed.value === 0) {
        push("warn", `frame ${formatNumber(speed.frame, 1)} のリング速度が0（停止）です。`);
      }
    }

    if (warnings.length === 0) warnings.push({ level: "ok", message: "問題は見つかりませんでした。" });
    return warnings;
  }

  ringLabel(ring) {
    return `#${ring.id} (P${ring.page} / ${formatNumber(ring.position, 2)})`;
  }

  lnLabel(ln) {
    return `#${ln.id} (P${ln.page} / ${formatNumber(ln.position, 2)} → P${ln.endPage} / ${formatNumber(ln.endPosition, 2)})`;
  }

  /* ------------------------------------------------------------------ */
  /* キーボード操作 */
  /* ------------------------------------------------------------------ */

  handleKeydown(event) {
    if (document.querySelector("dialog[open]")) return;

    if (event.code === "Escape") {
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      if (this.ui.lnDraftStart) {
        this.ui.lnDraftStart = null;
      } else {
        this.ui.selectedRingId = null;
        this.ui.selectedLnId = null;
      }
      this.requestRender({ structure: true });
      return;
    }

    const ctrl = event.ctrlKey || event.metaKey;

    // 数値入力欄にフォーカスがあるときも、元に戻す・やり直す操作を使えるようにする。
    if (ctrl && event.code === "KeyZ") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if (ctrl && event.code === "KeyY") {
      event.preventDefault();
      this.redo();
      return;
    }
    if (ctrl && event.code === "KeyS") {
      event.preventDefault();
      this.downloadProject();
      return;
    }

    if (event.target instanceof HTMLElement) {
      const tag = event.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || event.target.isContentEditable) return;
    }
    const gridByDigit = { Digit1: 48, Digit2: 24, Digit3: 12, Digit4: 16, Digit5: 8, Digit6: 4, Digit7: 6 };

    if (ctrl) {
      switch (event.code) {
        case "KeyC":
          event.preventDefault();
          this.copyPage();
          return;
        case "KeyX":
          event.preventDefault();
          if (event.shiftKey) this.deletePage();
          else this.cutPage();
          return;
        case "KeyV":
          event.preventDefault();
          if (event.shiftKey) this.insertPage();
          else this.pastePage();
          return;
        case "KeyD":
          event.preventDefault();
          this.duplicateSelected();
          return;
        case "KeyS":
          event.preventDefault();
          this.downloadProject();
          return;
        case "ArrowUp":
          event.preventDefault();
          this.moveNoteAtCursor(this.settings.timelineReverse ? this.ui.divisor : -this.ui.divisor);
          return;
        case "ArrowDown":
          event.preventDefault();
          this.moveNoteAtCursor(this.settings.timelineReverse ? -this.ui.divisor : this.ui.divisor);
          return;
        case "Digit1":
        case "Digit2":
        case "Digit3":
        case "Digit4":
        case "Digit5":
        case "Digit6":
        case "Digit7": {
          event.preventDefault();
          this.setDivisor(gridByDigit[event.code]);
          return;
        }
        default:
          return;
      }
    }

    switch (event.code) {
      case "ArrowLeft":
        event.preventDefault();
        this.stepPage(event.shiftKey ? -5 : -1);
        break;
      case "ArrowRight":
        event.preventDefault();
        this.stepPage(event.shiftKey ? 5 : 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        this.moveCursor(this.settings.timelineReverse ? this.ui.divisor : -this.ui.divisor);
        break;
      case "ArrowDown":
        event.preventDefault();
        this.moveCursor(this.settings.timelineReverse ? -this.ui.divisor : this.ui.divisor);
        break;
      case "Space":
        event.preventDefault();
        this.moveCursor(this.ui.divisor);
        break;
      case "KeyB":
        event.preventDefault();
        this.moveCursor(-this.ui.divisor);
        break;
      case "Enter":
        event.preventDefault();
        this.toggleMainPlayback();
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        if (this.ui.selectedLnId) this.deleteLn(this.ui.selectedLnId);
        else if (this.ui.selectedRingId) this.deleteRing(this.ui.selectedRingId);
        else this.deleteRingAtCursor();
        break;
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
      case "Digit5":
      case "Digit6":
      case "Digit7":
        event.preventDefault();
        this.setDivisor(gridByDigit[event.code]);
        break;
      case "Escape":
        break;
      case "PageUp":
        event.preventDefault();
        this.stepPage(-1);
        break;
      case "PageDown":
        event.preventDefault();
        this.stepPage(1);
        break;
      default:
        break;
    }
  }
}
