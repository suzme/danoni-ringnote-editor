import { FPS, MAX_PAGE } from "./constants.js";
import { clamp, escapeHtml, formatNumber, ringDisplayColor } from "./model.js";
import {
  expandLn,
  frameForPagePosition,
  frameForRing,
  lnPointAt,
  maxPageOfProject,
  normalizePagePosition,
  pageRange,
  pageSpan,
  positionsBetween,
  timingAndPositionAtFrame,
  timingForPage,
} from "./timing.js";

function blurActiveField() {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable) {
    el.blur();
  }
}

/**
 * 現在のページ（小節）とその前後の余白が見えるスクロール位置を、移動量を抑えて求める。
 * ページが表示領域より高い場合はカーソルに近いページ端を基準にし、
 * 端の外側に約1拍分（blockHeight）の余白を設け、残りを現在のページに使う。
 * 単体テストで検証できるように純粋関数にしています。
 */
export function followScrollTarget({ pageTop, pageHeight, cursorY, viewHeight, scrollTop, blockHeight = 0 }) {
  if (!(viewHeight > 0)) return scrollTop;
  const pageBottom = pageTop + pageHeight;
  let top;
  let bottom;
  if (pageHeight <= viewHeight) {
    // ページ全体が収まる場合は、前後に余白を設けて表示する。
    const context = (viewHeight - pageHeight) * 0.3;
    top = pageTop - context;
    bottom = pageBottom + context;
  } else {
    // ページが表示領域より高い場合は、カーソルに近いページ端を基準に
    // その外側に約1拍分の余白を設ける。
    const margin = Math.max(0, Math.min(blockHeight, viewHeight * 0.25));
    if (cursorY - pageTop <= pageBottom - cursorY) {
      // カーソルが上端に近い場合は、上に余白を設け、下側をページで埋める。
      top = pageTop - margin;
      bottom = Math.max(top + viewHeight, cursorY);
      if (bottom - top > viewHeight) {
        // 表示領域が極端に小さく基準位置からカーソルまで届かない場合は、
        // 余白よりカーソルの表示を優先する。
        top = Math.max(pageTop - margin, cursorY - viewHeight);
        bottom = top + viewHeight;
      }
    } else {
      // カーソルが下端に近い場合は、上側をページで埋め、下に余白を設ける。
      bottom = pageBottom + margin;
      top = Math.min(bottom - viewHeight, cursorY);
      if (bottom - top > viewHeight) {
        bottom = Math.min(pageBottom + margin, cursorY + viewHeight);
        top = bottom - viewHeight;
      }
    }
  }
  // 範囲全体が見えている間はスクロールせず、必要最小限だけ移動する。
  const target = Math.min(Math.max(scrollTop, bottom - viewHeight), top);
  return Math.max(0, target);
}

export class Timeline {
  constructor(app, scrollEl, contentEl) {
    this.app = app;
    this.scrollEl = scrollEl;
    this.contentEl = contentEl;
    this.pages = [];
    this.totalHeight = 0;
    this.editCursorEl = null;
    this.playheadEl = null;
    this.dragging = false;
    this.ringDrag = null;
    this.lnDrag = null;
    this.speedDrag = null;
    this.lastReverse = null;
    this._anchorPage = null;
    this.waveCanvas = null;
    this._waveFrame = 0;
    this.bindEvents();
    this.scrollEl.addEventListener("scroll", () => this.scheduleWaveformDraw(), { passive: true });
    window.addEventListener("resize", () => this.syncWaveformLayout());
  }

  bindEvents() {
    const markerAtPoint = (event) => {
      const elements = document.elementsFromPoint?.(event.clientX, event.clientY) ?? [event.target];
      const markers = elements
        .map((element) => element.closest?.("[data-ring-id], [data-ln-id]"))
        .filter((marker, index, all) => marker && this.contentEl.contains(marker) && all.indexOf(marker) === index);
      const selectedRingId = this.app.ui.selectedRingId;
      const selectedLnId = this.app.ui.selectedLnId;
      return (
        markers.find(
          (marker) =>
            (selectedRingId && marker.dataset.ringId === selectedRingId) ||
            (selectedLnId && marker.dataset.lnId === selectedLnId)
        ) ?? markers[0] ?? event.target.closest?.("[data-ring-id], [data-ln-id]") ?? null
      );
    };

    // タイムラインをクリックしたら入力欄のフォーカスを外し、ショートカットを使えるようにする。
    this.scrollEl.addEventListener("pointerdown", () => blurActiveField(), true);
    // リングマーカー以外（タイムラインの空白、ページ背景、見出し）をクリックした場合は、
    // 現在の選択を解除する。
    this.scrollEl.addEventListener("pointerdown", (event) => {
      if (!(event.target instanceof Element)) return;
      if (markerAtPoint(event)) return;
      this.app.clearSelection();
    });

    const start = (event) => {
      if (event.button !== 0) return;
      const marker = markerAtPoint(event);
      const lnMarker = marker?.matches("[data-ln-id]") ? marker : null;
      if (lnMarker) {
        const id = lnMarker.dataset.lnId;
        const handle = lnMarker.dataset.lnHandle || "body";
        const ln = this.app.getLn(id);
        if (!ln) return;
        event.preventDefault();
        this.app.selectLn(id, { jump: true, scroll: false, jumpToEnd: handle === "end" });
        const rect = this.contentEl.getBoundingClientRect();
        this.lnDrag = {
          id,
          handle,
          startY: event.clientY,
          moved: false,
          origStartPage: ln.page,
          origStartPos: ln.position,
          origEndPage: ln.endPage,
          origEndPos: ln.endPosition,
          durationPos: Math.max(
            1,
            positionsBetween(this.app.project, ln.page, ln.position, ln.endPage, ln.endPosition)
          ),
          anchorFound: this.yToPagePosition(event.clientY - rect.top) ?? {
            page: ln.page,
            position: ln.position,
          },
        };
        this.app.beginTransaction();
        this.contentEl.classList.add("ring-dragging");
        this.app.requestRender({ structure: true });
        try {
          this.contentEl.setPointerCapture(event.pointerId);
        } catch {
          /* エラーを無視する */
        }
        return;
      }
      const ringMarker = marker?.matches("[data-ring-id]") ? marker : null;
      if (ringMarker) {
        const id = ringMarker.dataset.ringId;
        const ring = this.app.getRing(id);
        if (!ring) return;
        event.preventDefault();
        this.app.ui.selectedRingId = id;
        this.app.ui.selectedLnId = null;
        this.app.ui.page = ring.page;
        this.app.ui.position = ring.position;
        this.app.rememberRing(ring);
        this.app.syncToolFromRing(ring);
        this.app.playSelectionSound(ring);
        this.ringDrag = {
          id,
          startY: event.clientY,
          moved: false,
        };
        this.app.beginTransaction();
        this.contentEl.classList.add("ring-dragging");
        this.app.requestRender({ structure: true });
        try {
          this.contentEl.setPointerCapture(event.pointerId);
        } catch {
          /* エラーを無視する */
        }
        return;
      }
      const speedMarker = event.target.closest("[data-speed-id]");
      if (speedMarker) {
        event.preventDefault();
        this.app.seekToSpeed(speedMarker.dataset.speedId, { scroll: false });
        const speed = this.app.project.speeds.find((item) => item.id === speedMarker.dataset.speedId);
        if (!speed) return;
        this.speedDrag = { id: speed.id, startY: event.clientY, moved: false };
        this.app.beginTransaction();
        this.contentEl.classList.add("speed-dragging");
        try {
          this.contentEl.setPointerCapture(event.pointerId);
        } catch {
          /* エラーを無視する */
        }
        return;
      }
      const pageEl = event.target.closest("[data-page]");
      if (!pageEl) return;
      event.preventDefault();
      this.dragging = true;
      this.contentEl.classList.add("timeline-dragging");
      this.setPositionFromEvent(event);
      try {
        this.contentEl.setPointerCapture(event.pointerId);
      } catch {
        /* エラーを無視する */
      }
    };
    const move = (event) => {
      if (this.lnDrag) {
        event.preventDefault();
        this.setLnDragPosition(event);
        return;
      }
      if (this.ringDrag) {
        event.preventDefault();
        this.setRingDragPosition(event);
        return;
      }
      if (this.speedDrag) {
        event.preventDefault();
        this.setSpeedDragPosition(event);
        return;
      }
      if (!this.dragging) return;
      event.preventDefault();
      this.setPositionFromEvent(event);
    };
    const end = (event) => {
      if (this.lnDrag) {
        this.app.endTransaction();
        this.lnDrag = null;
        this.contentEl.classList.remove("ring-dragging");
        try {
          this.contentEl.releasePointerCapture(event.pointerId);
        } catch {
          /* エラーを無視する */
        }
        this.app.requestRender({ structure: true });
        return;
      }
      if (this.ringDrag) {
        this.app.endTransaction();
        this.ringDrag = null;
        this.contentEl.classList.remove("ring-dragging");
        try {
          this.contentEl.releasePointerCapture(event.pointerId);
        } catch {
          /* エラーを無視する */
        }
        this.app.requestRender({ structure: true });
        return;
      }
      if (this.speedDrag) {
        this.app.endTransaction();
        this.speedDrag = null;
        this.contentEl.classList.remove("speed-dragging");
        try {
          this.contentEl.releasePointerCapture(event.pointerId);
        } catch {
          /* エラーを無視する */
        }
        this.app.requestRender({ structure: true });
        return;
      }
      if (!this.dragging) return;
      this.dragging = false;
      this.contentEl.classList.remove("timeline-dragging");
      try {
        this.contentEl.releasePointerCapture(event.pointerId);
      } catch {
        /* エラーを無視する */
      }
    };
    this.contentEl.addEventListener("pointerdown", start);
    this.contentEl.addEventListener("pointermove", move);
    this.contentEl.addEventListener("pointerup", end);
    this.contentEl.addEventListener("pointercancel", end);
  }

  setRingDragPosition(event) {
    if (!this.ringDrag) return;
    if (!this.ringDrag.moved && Math.abs(event.clientY - this.ringDrag.startY) < 3) return;
    this.ringDrag.moved = true;
    const rect = this.contentEl.getBoundingClientRect();
    const found = this.yToPagePosition(event.clientY - rect.top);
    if (!found) return;
    const app = this.app;
    // ページと位置（時刻）だけを変更し、リングのX/Y座標は維持する。
    app.ui.page = found.page;
    app.ui.position = found.position;
    app.ui.selectedRingId = this.ringDrag.id;
    app.updateRingDirect(this.ringDrag.id, { page: found.page, position: found.position });
    app.requestRender({ structure: true, scroll: false });
  }

  setSpeedDragPosition(event) {
    if (!this.speedDrag) return;
    if (!this.speedDrag.moved && Math.abs(event.clientY - this.speedDrag.startY) < 3) return;
    this.speedDrag.moved = true;
    const rect = this.contentEl.getBoundingClientRect();
    const found = this.yToPagePosition(event.clientY - rect.top);
    if (!found) return;
    const frame = Math.max(0, frameForPagePosition(this.app.project, found.page, found.position));
    this.app.ui.page = found.page;
    this.app.ui.position = found.position;
    this.app.updateSpeedDirect(this.speedDrag.id, { frame });
  }

  setLnDragPosition(event) {
    if (!this.lnDrag) return;
    if (!this.lnDrag.moved && Math.abs(event.clientY - this.lnDrag.startY) < 3) return;
    this.lnDrag.moved = true;
    const rect = this.contentEl.getBoundingClientRect();
    const found = this.yToPagePosition(event.clientY - rect.top);
    if (!found) return;
    const app = this.app;
    const minStep = Math.max(1, app.ui.divisor);
    app.ui.selectedLnId = this.lnDrag.id;

    if (this.lnDrag.handle === "start") {
      const delta = positionsBetween(
        app.project,
        found.page,
        found.position,
        this.lnDrag.origEndPage,
        this.lnDrag.origEndPos
      );
      const targetStart =
        delta < minStep
          ? normalizePagePosition(app.project, this.lnDrag.origEndPage, this.lnDrag.origEndPos - minStep)
          : found;
      app.ui.page = targetStart.page;
      app.ui.position = targetStart.position;
      app.updateLnDirect(this.lnDrag.id, {
        page: targetStart.page,
        position: targetStart.position,
        endPage: this.lnDrag.origEndPage,
        endPosition: this.lnDrag.origEndPos,
      });
    } else if (this.lnDrag.handle === "end") {
      const delta = positionsBetween(
        app.project,
        this.lnDrag.origStartPage,
        this.lnDrag.origStartPos,
        found.page,
        found.position
      );
      const targetEnd =
        delta < minStep
          ? normalizePagePosition(app.project, this.lnDrag.origStartPage, this.lnDrag.origStartPos + minStep)
          : found;
      app.ui.page = targetEnd.page;
      app.ui.position = targetEnd.position;
      app.updateLnDirect(this.lnDrag.id, {
        endPage: targetEnd.page,
        endPosition: targetEnd.position,
      });
    } else {
      const shift = positionsBetween(
        app.project,
        this.lnDrag.anchorFound.page,
        this.lnDrag.anchorFound.position,
        found.page,
        found.position
      );
      const newStart = normalizePagePosition(
        app.project,
        this.lnDrag.origStartPage,
        this.lnDrag.origStartPos + shift
      );
      const newEnd = normalizePagePosition(
        app.project,
        newStart.page,
        newStart.position + this.lnDrag.durationPos
      );
      app.ui.page = newStart.page;
      app.ui.position = newStart.position;
      app.updateLnDirect(this.lnDrag.id, {
        page: newStart.page,
        position: newStart.position,
        endPage: newEnd.page,
        endPosition: newEnd.position,
      });
    }
    app.requestRender({ structure: true, scroll: false });
  }

  setPositionFromEvent(event) {
    const rect = this.contentEl.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const found = this.yToPagePosition(y);
    if (!found) return;
    this.app.setPosition(found.page, found.position, { snap: true, scroll: false });
  }

  computePages() {
    const app = this.app;
    const blockHeight = app.settings.blockHeight;
    let maxPage = maxPageOfProject(app.project, 1);
    maxPage = Math.min(MAX_PAGE, Math.max(maxPage, app.ui.page + 1));
    const pages = [];
    let cumulative = 0;
    for (let page = 1; page <= maxPage; page++) {
      const timing = timingForPage(app.project.timings, page);
      const span = pageSpan(timing);
      const range = pageRange(app.project, page);
      const height = (timing.pageBlockNum || 8) * blockHeight;
      pages.push({
        page,
        timing,
        span,
        height,
        top: 0,
        startFrame: range.startFrame,
        endFrame: range.endFrame,
        cumulative,
      });
      cumulative += height;
    }
    const totalHeight = cumulative;
    for (const page of pages) {
      page.top = app.settings.timelineReverse
        ? totalHeight - page.cumulative - page.height
        : page.cumulative;
    }
    this.pages = pages;
    this.totalHeight = totalHeight;
  }

  pageLayout(page) {
    return this.pages.find((entry) => entry.page === page) ?? this.pages[this.pages.length - 1];
  }

  positionToY(page, position) {
    const layout = this.pageLayout(page);
    if (!layout) return 0;
    const ratio = clamp(position / Math.max(1, layout.span), 0, 1);
    return layout.top + (this.app.settings.timelineReverse ? (1 - ratio) * layout.height : ratio * layout.height);
  }

  frameToY(frame) {
    const location = timingAndPositionAtFrame(this.app.project, frame);
    const layout = this.pageLayout(Math.max(1, location.page));
    if (!layout) return 0;
    return this.positionToY(layout.page, location.position);
  }

  yToPagePosition(y) {
    if (this.pages.length === 0) return null;
    let target = null;
    for (const page of this.pages) {
      const top = page.top;
      const bottom = page.top + page.height;
      if (y >= top && y <= bottom) {
        target = page;
        break;
      }
    }
    if (!target) {
      target = y < this.pages[0].top ? this.pages[0] : this.pages[this.pages.length - 1];
    }
    let ratio = (y - target.top) / Math.max(1, target.height);
    ratio = clamp(ratio, 0, 0.999999);
    if (this.app.settings.timelineReverse) ratio = 1 - ratio;
    let position = ratio * target.span;
    const step = this.app.ui.divisor;
    position = Math.round(position / step) * step;
    let page = target.page;
    if (position >= target.span) {
      position = 0;
      page += 1;
    }
    return { page, position };
  }

  /**
   * Continuous frame at a content-space Y coordinate (no snapping).
   * Used for the background waveform so it lines up with ring positions.
   */
  frameAtY(y) {
    if (this.pages.length === 0) return null;
    let target = null;
    for (const page of this.pages) {
      if (y >= page.top && y <= page.top + page.height) {
        target = page;
        break;
      }
    }
    if (!target) {
      target = y < this.pages[0].top ? this.pages[0] : this.pages[this.pages.length - 1];
    }
    let ratio = (y - target.top) / Math.max(1, target.height);
    ratio = clamp(ratio, 0, 1);
    if (this.app.settings.timelineReverse) ratio = 1 - ratio;
    return frameForPagePosition(this.app.project, target.page, ratio * target.span);
  }

  buildHeader(page) {
    return `<span class="page-name">Page ${page.page}</span>
      <span class="page-summary">${formatNumber(page.startFrame, 1)} - ${formatNumber(page.endFrame, 1)} f</span>`;
  }

  buildRingMarkers(page) {
    const app = this.app;
    const width = app.project.screen.width || 600;
    return app
      .getSingleRingsInPage(page.page)
      .map((ring) => {
        const ratio = clamp(ring.position / Math.max(1, page.span), 0, 1);
        const top = (app.settings.timelineReverse ? 1 - ratio : ratio) * page.height;
        const left = 4 + (clamp(ring.x / width, 0, 1) * 92);
        const color = ringDisplayColor(ring, "dark");
        const frame = frameForRing(app.project, ring);
        const selected = ring.id === app.ui.selectedRingId;
        const dragging = this.ringDrag?.id === ring.id;
        const title = `#${ring.id} P${ring.page} / pos ${formatNumber(ring.position, 2)} / frame ${formatNumber(frame, 2)}\nx ${formatNumber(ring.x, 1)}, y ${formatNumber(ring.y, 1)} / r ${formatNumber(ring.radius, 1)} / sound ${ring.sound}\n上下ドラッグで時間移動（左右には動きません）`;
        return `<button class="tl-ring${selected ? " selected" : ""}${dragging ? " dragging" : ""}" data-ring-id="${escapeHtml(ring.id)}" title="${escapeHtml(title)}" style="left:${left}%;top:${top}px;--ring-color:${escapeHtml(color)}"></button>`;
      })
      .join("");
  }

  buildLnMarkers() {
    const app = this.app;
    const lns = app.project.lns || [];
    if (lns.length === 0 || !(this.totalHeight > 0)) return "";
    const width = app.project.screen.width || 600;
    const polylines = [];
    const controls = [];

    for (const ln of lns) {
      const selected = ln.id === app.ui.selectedLnId;
      const dragging = this.lnDrag?.id === ln.id;
      const color = ringDisplayColor(ln, "dark");
      const stroke = selected ? "#ffe16a" : color;
      const startY = this.positionToY(ln.page, ln.position);
      const endY = this.positionToY(ln.endPage, ln.endPosition);
      const startLeft = 4 + clamp(ln.startX / width, 0, 1) * 92;
      const endLeft = 4 + clamp(ln.endX / width, 0, 1) * 92;
      const deltaPos = Math.max(0, positionsBetween(app.project, ln.page, ln.position, ln.endPage, ln.endPosition));

      // 時刻に沿って曲線上の点をサンプリングし、タイムラインの折れ線を描く。
      const samples = 20;
      const pts = [];
      for (let s = 0; s <= samples; s++) {
        const t = s / samples;
        const loc = normalizePagePosition(app.project, ln.page, ln.position + deltaPos * t);
        const pt = lnPointAt(ln, t, app.project.screen);
        const px = 4 + clamp(pt.x / width, 0, 1) * 92;
        const py = this.positionToY(loc.page, loc.position);
        pts.push(`${formatNumber(px, 2)},${formatNumber(py, 2)}`);
      }
      polylines.push(
        `<polyline class="tl-ln-line${selected ? " selected" : ""}" points="${pts.join(" ")}" stroke="${escapeHtml(stroke)}" fill="none" vector-effect="non-scaling-stroke" />`
      );

      // 展開した中間リングの点（ロングノート本体としてドラッグ可能）。
      const expanded = expandLn(app.project, ln);
      for (let i = 1; i < expanded.length; i++) {
        if (ln.includeEnd && i === expanded.length - 1) continue;
        const ring = expanded[i];
        const ry = this.positionToY(ring.page, ring.position);
        const rx = 4 + clamp(ring.x / width, 0, 1) * 92;
        const frame = frameForRing(app.project, ring);
        const nodeTitle = `LN #${ln.id} (${i + 1}/${ln.count}) P${ring.page} / pos ${formatNumber(ring.position, 2)} / frame ${formatNumber(frame, 1)}\n上下ドラッグでLN全体を時間移動`;
        controls.push(
          `<button class="tl-ln-node${selected ? " selected" : ""}${dragging && this.lnDrag?.handle === "body" ? " dragging" : ""}" data-ln-id="${escapeHtml(ln.id)}" data-ln-handle="body" title="${escapeHtml(nodeTitle)}" style="left:${rx}%;top:${ry}px;--ring-color:${escapeHtml(color)}"></button>`
        );
      }

      const startFrame = frameForPagePosition(app.project, ln.page, ln.position);
      const endFrame = frameForPagePosition(app.project, ln.endPage, ln.endPosition);
      const startTitle = `LN #${ln.id} 始点 (P${ln.page} / pos ${formatNumber(ln.position, 2)} / frame ${formatNumber(startFrame, 1)})\n上下ドラッグで始点の時間を移動`;
      const endTitle = `LN #${ln.id} 終点 (P${ln.endPage} / pos ${formatNumber(ln.endPosition, 2)} / frame ${formatNumber(endFrame, 1)})\n上下ドラッグで終点の時間を移動`;

      controls.push(
        `<button class="tl-ln-handle tl-ln-start${selected ? " selected" : ""}${dragging && this.lnDrag?.handle === "start" ? " dragging" : ""}" data-ln-id="${escapeHtml(ln.id)}" data-ln-handle="start" title="${escapeHtml(startTitle)}" style="left:${startLeft}%;top:${startY}px;--ring-color:${escapeHtml(color)}">S</button>`
      );
      controls.push(
        `<button class="tl-ln-handle tl-ln-end${selected ? " selected" : ""}${dragging && this.lnDrag?.handle === "end" ? " dragging" : ""}" data-ln-id="${escapeHtml(ln.id)}" data-ln-handle="end" title="${escapeHtml(endTitle)}" style="left:${endLeft}%;top:${endY}px;--ring-color:${escapeHtml(color)}">E</button>`
      );
    }

    return `<svg class="tl-ln-svg" viewBox="0 0 100 ${this.totalHeight}" preserveAspectRatio="none" aria-hidden="true">${polylines.join("")}</svg>${controls.join("")}`;
  }

  buildSpeedMarkers() {
    const app = this.app;
    return [...app.project.speeds]
      .sort((a, b) => a.frame - b.frame)
      .map((speed) => {
        const top = this.frameToY(speed.frame);
        const typeLabel = speed.type === "boost" ? "個別加速" : "全体速度";
        const title = `${typeLabel} ${formatNumber(speed.value, 3)}x\nframe ${formatNumber(speed.frame, 2)}\n上下ドラッグで時間を移動`;
        const left = speed.type === "boost" ? "calc(96% - 14px)" : "8px";
        return `<button class="tl-${speed.type}" data-speed-id="${escapeHtml(speed.id)}" title="${escapeHtml(title)}" style="left:${left};top:${top}px"></button>`;
      })
      .join("");
  }

  buildReferenceMarkers(page) {
    const app = this.app;
    if (!app.settings.showReferenceNotes) return "";
    const total = page.endFrame - page.startFrame;
    if (!(total > 0)) return "";
    return app.project.referenceNoteFrames
      .filter((frame) => frame >= page.startFrame && frame < page.endFrame)
      .slice(0, 800)
      .map((frame) => {
        const ratio = (frame - page.startFrame) / total;
        const top = (app.settings.timelineReverse ? 1 - ratio : ratio) * page.height;
        return `<div class="tl-ref" style="top:${top}px"></div>`;
      })
      .join("");
  }

  buildWaveformLayer() {
    const app = this.app;
    if (!app.settings.showWaveform) return "";
    const waveform = app.audio.waveform;
    if (!waveform || !(waveform.duration > 0) || !(waveform.peaks?.length > 0)) return "";
    return '<canvas class="tl-waveform" aria-hidden="true"></canvas>';
  }

  syncWaveformLayout() {
    const canvas = this.waveCanvas;
    if (!canvas) return;
    const width = Math.max(1, this.contentEl.clientWidth);
    const height = Math.max(1, this.scrollEl.clientHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.style.height = `${height}px`;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    this.drawWaveform();
  }

  scheduleWaveformDraw() {
    if (!this.waveCanvas || this._waveFrame) return;
    this._waveFrame = requestAnimationFrame(() => {
      this._waveFrame = 0;
      this.drawWaveform();
    });
  }

  drawWaveform() {
    const canvas = this.waveCanvas;
    if (!canvas) return;
    const app = this.app;
    const waveform = app.audio.waveform;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!(width > 0) || !(height > 0)) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = canvas.clientWidth > 0 ? canvas.width / canvas.clientWidth : 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!waveform || !(waveform.duration > 0) || !(waveform.peaks?.length > 0)) return;

    const peaks = waveform.peaks;
    const peakCount = peaks.length;
    const bucketsPerSecond = waveform.bucketsPerSecond || 240;
    const blankFrame = Number(app.project.blankFrame) || 0;
    const offsetFrames = Number(app.settings.musicOffset) || 0;
    const scrollTop = this.scrollEl.scrollTop;
    const mid = width / 2;
    const maxHalf = width * 0.44;

    // 中央から左右対称に波形を描く。再生時と同じ式で時刻を音源上の秒数に変換する。
    ctx.fillStyle = "rgba(121, 170, 255, 0.3)";
    const step = 1;
    for (let row = 0; row < height; row += step) {
      const frame = this.frameAtY(scrollTop + row + 0.5);
      if (frame === null) continue;
      const seconds = (frame - blankFrame + offsetFrames) / FPS;
      if (!(seconds >= 0) || seconds >= waveform.duration) continue;
      const index = Math.min(peakCount - 1, Math.floor(seconds * bucketsPerSecond));
      const amplitude = peaks[index];
      if (!(amplitude > 0.002)) continue;
      const half = Math.max(0.6, amplitude * maxHalf);
      ctx.fillRect(mid - half, row, half * 2, step);
    }

    // 中心軸
    ctx.fillStyle = "rgba(121, 170, 255, 0.42)";
    ctx.fillRect(mid - 0.5, 0, 1, height);
  }

  render({ scroll = false } = {}) {
    const app = this.app;
    const oldScroll = this.scrollEl.scrollTop;
    const reverseChanged = this.lastReverse !== app.settings.timelineReverse;
    this.computePages();

    const html = this.pages
      .map((page) => {
        const current = page.page === app.ui.page;
        const blockHeight = app.settings.blockHeight;
        const stepHeight = (blockHeight * app.ui.divisor) / 48;
        const headerStyle = app.settings.timelineReverse ? "bottom:5px" : "top:5px";
        return `<div class="tl-page${current ? " current" : ""}" data-page="${page.page}"
          style="top:${page.top}px;height:${page.height}px;--block-h:${blockHeight}px;--step-h:${stepHeight}px">
          <div class="tl-page-head" style="${headerStyle}">${this.buildHeader(page)}</div>
          ${this.buildReferenceMarkers(page)}
          ${this.buildRingMarkers(page)}
        </div>`;
      })
      .join("");

    this.contentEl.innerHTML = `${html}
      ${this.buildWaveformLayer()}
      ${this.buildLnMarkers()}
      ${this.buildSpeedMarkers()}
      <div class="tl-cursor" id="tl-edit-cursor"></div>
      <div class="tl-playhead hidden" id="tl-playhead"></div>`;
    this.contentEl.style.height = `${this.totalHeight}px`;
    this.editCursorEl = document.getElementById("tl-edit-cursor");
    this.playheadEl = document.getElementById("tl-playhead");
    this.waveCanvas = this.contentEl.querySelector(".tl-waveform");
    this.lastReverse = app.settings.timelineReverse;

    if (scroll || reverseChanged) {
      this.ensureCursorVisible();
    } else {
      this.scrollEl.scrollTop = oldScroll;
    }
    this.updateCursors();
    this.syncWaveformLayout();
    if (app.playFrame !== null) this.setPlayhead(app.playFrame, !app.mainPlayback?.running);
  }

  updateCursors({ follow = false } = {}) {
    if (!this.editCursorEl) return;
    const y = this.frameToY(this.app.currentFrame);
    this.editCursorEl.style.top = `${y}px`;
    this.editCursorEl.classList.remove("hidden");
    if (this.playheadEl && this.app.playFrame !== null) {
      this.playheadEl.style.top = `${this.frameToY(this.app.playFrame)}px`;
      this.playheadEl.classList.remove("hidden");
      this.playheadEl.style.opacity = this.app.mainPlayback?.running ? "1" : "0.55";
    }
    if (follow) this.ensureCursorVisible();
  }

  setPlayhead(frame, paused = false) {
    if (!this.playheadEl) return;
    if (frame === null || frame === undefined) {
      this.playheadEl.classList.add("hidden");
      return;
    }
    this.playheadEl.style.top = `${this.frameToY(frame)}px`;
    this.playheadEl.classList.remove("hidden");
    this.playheadEl.style.opacity = paused ? "0.55" : "1";
  }

  /**
   * 編集カーソルに追従し、現在のページとその前後の余白が見える範囲で最小限スクロールする。
   * 範囲がすでに表示されていればスクロールしない。ページが表示領域より高い場合は、
   * カーソルに近いページ端を基準に約1拍分の余白を設け、ページをまたぐか
   * カーソルが表示範囲から外れたときだけ基準位置を調整する。
   */
  ensureCursorVisible() {
    const layout = this.pageLayout(this.app.ui.page);
    if (!layout) return;
    const viewHeight = this.scrollEl.clientHeight;
    if (!(viewHeight > 0)) return;
    const cursorY = this.frameToY(this.app.currentFrame);
    const scrollTop = this.scrollEl.scrollTop;
    if (layout.height > viewHeight && this._anchorPage === this.app.ui.page) {
      // 同じ高いページ上にカーソルがあり、表示領域内に収まっている場合は表示位置を保つ。
      if (cursorY >= scrollTop && cursorY <= scrollTop + viewHeight) return;
    }
    this._anchorPage = this.app.ui.page;
    this.scrollEl.scrollTop = followScrollTarget({
      pageTop: layout.top,
      pageHeight: layout.height,
      cursorY,
      viewHeight,
      scrollTop,
      blockHeight: this.app.settings.blockHeight,
    });
  }
}
