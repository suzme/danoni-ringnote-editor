import { formatNumber, clamp } from "./model.js";
import {
  expandLn,
  formatSeconds,
  frameForRing,
  lnDistortionFromMidpoint,
  lnEndForDuration,
  lnPointAt,
  secondsForFrame,
} from "./timing.js";

export class RingCanvas {
  constructor(app) {
    this.app = app;
    this.canvas = document.getElementById("edit-canvas");
    this.scroller = document.getElementById("canvas-scroll");
    this.ctx = this.canvas.getContext("2d");
    this.point = null;
    this.hoverRingId = null;
    this.hoverLnId = null;
    this.drag = null;
    this.moved = false;
    this.bindEvents();
    this.render();
  }

  bindEvents() {
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointerleave", () => {
      this.point = null;
      this.hoverRingId = null;
      this.hoverLnId = null;
      this.canvas.style.cursor = "crosshair";
      this.render();
    });
    this.canvas.addEventListener("contextmenu", (event) => this.onContextMenu(event));
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    // キャンバス周辺（スクロール領域内）のクリックでも選択を解除する。
    this.scroller?.addEventListener("pointerdown", (event) => {
      if (event.target !== this.canvas) this.app.clearSelection();
    });
  }

  worldPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.app.project.screen.width,
      y: ((event.clientY - rect.top) / rect.height) * this.app.project.screen.height,
    };
  }

  snap(value) {
    const step = this.app.settings.snap || 1;
    return Math.round(value / step) * step;
  }

  hitTest(x, y, event = null) {
    const hit = this.hitTestObject(x, y, event);
    return hit?.kind === "ring" ? hit.ring : null;
  }

  hitTestObject(x, y, event = null) {
    const rings = this.app.getDisplayRings();
    const lns = this.app.getDisplayLns();
    const cursorBeat = this.app.currentBeatPosition;
    const hits = [];
    for (const ring of rings) {
      const dx = x - ring.x;
      const dy = y - ring.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= ring.radius + 7) {
        hits.push({
          kind: "ring",
          id: ring.id,
          ring,
          distance,
          frameDistance: Math.abs(frameForRing(this.app.project, ring) - this.app.currentFrame),
        });
      }
    }
    for (const ln of lns) {
      const expanded = expandLn(this.app.project, ln);
      let bestDist = Infinity;
      let bestFrameDist = Infinity;
      for (const ring of expanded) {
        if (!this.app.isWithinDisplayRange(ring.page, ring.position, cursorBeat)) continue;
        const d = Math.hypot(x - ring.x, y - ring.y);
        if (d <= ring.radius + 7 && d < bestDist) {
          bestDist = d;
          bestFrameDist = Math.abs(frameForRing(this.app.project, ring) - this.app.currentFrame);
        }
      }
      // 曲線自体との距離も確認する（終点を含めない場合は特に終端付近）。
      if (!Number.isFinite(bestDist)) {
        const samples = 24;
        for (let i = 0; i <= samples; i++) {
          const pt = lnPointAt(ln, i / samples, this.app.project.screen);
          const d = Math.hypot(x - pt.x, y - pt.y);
          if (d <= 12 && d < bestDist) {
            bestDist = d;
            bestFrameDist = Math.abs(frameForRing(this.app.project, ln) - this.app.currentFrame);
          }
        }
      }
      if (Number.isFinite(bestDist)) {
        hits.push({
          kind: "ln",
          id: ln.id,
          ln,
          distance: bestDist,
          frameDistance: bestFrameDist,
        });
      }
    }
    hits.sort((a, b) => a.distance - b.distance || a.frameDistance - b.frameDistance);
    if (hits.length === 0) return null;
    if (!event?.shiftKey) {
      const selectedHit = hits.find((hit) =>
        hit.kind === "ln" ? hit.id === this.app.ui.selectedLnId : hit.id === this.app.ui.selectedRingId
      );
      if (selectedHit) return selectedHit;
    }
    if (event?.shiftKey && hits.length > 1) {
      const currentId = this.app.ui.selectedLnId ?? this.app.ui.selectedRingId;
      const index = hits.findIndex((hit) => hit.id === currentId);
      return hits[(index + 1) % hits.length];
    }
    return hits[0];
  }

  resizeHandleDistance(x, y) {
    const ring = this.app.selectedRing;
    if (!ring) return Infinity;
    return Math.hypot(x - (ring.x + ring.radius), y - ring.y);
  }

  lnHandleAt(x, y, ln = this.app.selectedLn) {
    if (!ln) return null;
    const mid = lnPointAt(ln, 0.5, this.app.project.screen);
    if (Math.hypot(x - mid.x, y - mid.y) <= 11) return "ln-curve";
    if (Math.hypot(x - ln.startX, y - ln.startY) <= 11) return "ln-start";
    if (Math.hypot(x - ln.endX, y - ln.endY) <= 11) return "ln-end";
    if (Math.hypot(x - (ln.startX + ln.radius), y - ln.startY) <= 10) return "ln-resize";
    return null;
  }

  onPointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.canvas.focus();
    const point = this.worldPoint(event);
    const { width, height } = this.app.project.screen;

    // ロングノートの配置は2回目のクリックで必ず完了する。
    if (this.app.ui.lnDraftStart) {
      const start = this.app.ui.lnDraftStart;
      const endX = clamp(this.snap(point.x), 0, width);
      const endY = clamp(this.snap(point.y), 0, height);
      const ln = this.app.addLn(
        {
          startX: start.x,
          startY: start.y,
          endX,
          endY,
        },
        { select: false }
      );
      if (ln) {
        this.render();
      }
      return;
    }

    const selectedLn = this.app.selectedLn;
    const lnHandle = this.lnHandleAt(point.x, point.y, selectedLn);
    if (selectedLn && lnHandle) {
      this.drag = {
        mode: lnHandle,
        id: selectedLn.id,
        startX: point.x,
        startY: point.y,
      };
      this.moved = false;
      this.app.beginTransaction();
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.style.cursor = lnHandle === "ln-resize" ? "ew-resize" : "grabbing";
      return;
    }

    const selected = this.app.selectedRing;
    if (selected && this.resizeHandleDistance(point.x, point.y) <= 10) {
      this.drag = {
        mode: "resize",
        id: selected.id,
        startX: point.x,
        startY: point.y,
        radius: selected.radius,
      };
      this.moved = false;
      this.app.beginTransaction();
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.style.cursor = "ew-resize";
      return;
    }

    const hit = this.hitTestObject(point.x, point.y, event);
    if (hit) {
      if (hit.kind === "ln") {
        this.app.selectLn(hit.ln.id, { jump: true, scroll: true });
        if (event.shiftKey) {
          this.render();
          return;
        }
        this.drag = {
          mode: "ln-move",
          id: hit.ln.id,
          startX: point.x,
          startY: point.y,
          origStartX: hit.ln.startX,
          origStartY: hit.ln.startY,
          origEndX: hit.ln.endX,
          origEndY: hit.ln.endY,
        };
      } else {
        this.app.selectRing(hit.ring.id, { jump: true, scroll: true });
        if (event.shiftKey) {
          this.render();
          return;
        }
        this.drag = {
          mode: "move",
          id: hit.ring.id,
          offsetX: point.x - hit.ring.x,
          offsetY: point.y - hit.ring.y,
        };
      }
      this.moved = false;
      this.app.beginTransaction();
      this.canvas.setPointerCapture(event.pointerId);
      this.canvas.style.cursor = "grabbing";
      this.render();
      return;
    }

    // 空白部分をクリックした場合は現在の選択を解除する。
    if (this.app.ui.selectedRingId || this.app.ui.selectedLnId) {
      this.app.clearSelection();
      this.render();
      return;
    }

    const x = clamp(this.snap(point.x), 0, width);
    const y = clamp(this.snap(point.y), 0, height);

    if (this.app.ui.placeMode === "ln") {
      this.app.ui.lnDraftStart = { x, y };
      this.app.requestRender({ structure: true });
      this.render();
      return;
    }

    // 空白部分をクリックした位置に単独リングを追加する。
    this.app.ui.selectedRingId = null;
    const ring = this.app.addRing({ x, y }, { select: false });
    if (ring) {
      this.render();
    }
  }

  onPointerMove(event) {
    const point = this.worldPoint(event);
    this.point = point;
    const { width, height } = this.app.project.screen;

    if (this.drag) {
      this.moved = true;
      if (this.drag.mode === "move") {
        const x = clamp(this.snap(point.x - this.drag.offsetX), 0, width);
        const y = clamp(this.snap(point.y - this.drag.offsetY), 0, height);
        this.app.updateRingDirect(this.drag.id, { x, y });
      } else if (this.drag.mode === "resize") {
        const ring = this.app.getRing(this.drag.id);
        if (ring) {
          const radius = Math.max(5, Math.round(Math.hypot(point.x - ring.x, point.y - ring.y)));
          this.app.updateRingDirect(this.drag.id, { radius });
        }
      } else if (this.drag.mode === "ln-start") {
        const startX = clamp(this.snap(point.x), 0, width);
        const startY = clamp(this.snap(point.y), 0, height);
        this.app.updateLnDirect(this.drag.id, { startX, startY });
      } else if (this.drag.mode === "ln-end") {
        const endX = clamp(this.snap(point.x), 0, width);
        const endY = clamp(this.snap(point.y), 0, height);
        this.app.updateLnDirect(this.drag.id, { endX, endY });
      } else if (this.drag.mode === "ln-curve") {
        const ln = this.app.getLn(this.drag.id);
        if (ln) {
          const distortion = lnDistortionFromMidpoint(ln, point.x, point.y);
          this.app.updateLnDirect(this.drag.id, { distortion });
        }
      } else if (this.drag.mode === "ln-resize") {
        const ln = this.app.getLn(this.drag.id);
        if (ln) {
          const radius = Math.max(5, Math.round(Math.hypot(point.x - ln.startX, point.y - ln.startY)));
          this.app.updateLnDirect(this.drag.id, { radius });
        }
      } else if (this.drag.mode === "ln-move") {
        const dx = this.snap(point.x - this.drag.startX);
        const dy = this.snap(point.y - this.drag.startY);
        const startX = clamp(this.drag.origStartX + dx, 0, width);
        const startY = clamp(this.drag.origStartY + dy, 0, height);
        const endX = clamp(this.drag.origEndX + dx, 0, width);
        const endY = clamp(this.drag.origEndY + dy, 0, height);
        this.app.updateLnDirect(this.drag.id, { startX, startY, endX, endY });
      }
      this.render();
      return;
    }

    const selectedLn = this.app.selectedLn;
    const lnHandle = this.lnHandleAt(point.x, point.y, selectedLn);
    if (selectedLn && lnHandle) {
      this.canvas.style.cursor = lnHandle === "ln-resize" ? "ew-resize" : "grab";
      this.render();
      return;
    }

    const hit = this.hitTestObject(point.x, point.y, event);
    const nextHoverRing = hit?.kind === "ring" ? hit.ring.id : null;
    const nextHoverLn = hit?.kind === "ln" ? hit.ln.id : null;
    if (hit) {
      const selected = this.app.selectedRing;
      this.canvas.style.cursor =
        selected && this.resizeHandleDistance(point.x, point.y) <= 10 ? "ew-resize" : "grab";
    } else {
      this.canvas.style.cursor = "crosshair";
    }
    if (nextHoverRing !== this.hoverRingId || nextHoverLn !== this.hoverLnId) {
      this.hoverRingId = nextHoverRing;
      this.hoverLnId = nextHoverLn;
      this.app.ui.hoverRingId = nextHoverRing;
      this.app.ui.hoverLnId = nextHoverLn;
    }
    this.render();
  }

  onPointerUp(event) {
    if (!this.drag) return;
    this.app.endTransaction();
    this.drag = null;
    this.moved = false;
    this.canvas.style.cursor = "crosshair";
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch {
      /* エラーを無視する */
    }
    this.render();
  }

  onContextMenu(event) {
    event.preventDefault();
    if (this.app.ui.lnDraftStart) {
      this.app.ui.lnDraftStart = null;
      this.app.requestRender({ structure: true });
      this.render();
      return;
    }
    const point = this.worldPoint(event);
    const hit = this.hitTestObject(point.x, point.y, event);
    if (hit?.kind === "ln") {
      this.app.deleteLn(hit.ln.id);
    } else if (hit?.kind === "ring") {
      this.app.deleteRing(hit.ring.id);
    }
  }

  onWheel(event) {
    const selectedLn = this.app.selectedLn;
    if (selectedLn && event.altKey) {
      event.preventDefault();
      const delta = event.deltaY < 0 ? 1 : -1;
      this.app.beginTransaction();
      this.app.updateLnDirect(selectedLn.id, { radius: Math.max(5, selectedLn.radius + delta) });
      this.app.endTransaction();
      return;
    }
    const selected = this.app.selectedRing;
    if (selected && event.altKey) {
      const point = this.worldPoint(event);
      if (Math.hypot(point.x - selected.x, point.y - selected.y) > selected.radius + 10) return;
      event.preventDefault();
      const delta = event.deltaY < 0 ? 1 : -1;
      this.app.beginTransaction();
      this.app.updateRingDirect(selected.id, { radius: Math.max(5, selected.radius + delta) });
      this.app.endTransaction();
      return;
    }
    if (event.deltaY === 0) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? 1 : -1;
    const step = this.app.settings.timelineReverse ? -direction : direction;
    this.app.moveCursor(step * this.app.ui.divisor);
  }

  resizeCanvas() {
    const { width, height } = this.app.project.screen;
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
      this.canvas.width = targetW;
      this.canvas.height = targetH;
    }
    this.canvas.style.aspectRatio = `${width} / ${height}`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  drawBackground() {
    const ctx = this.ctx;
    const app = this.app;
    const { width, height } = app.project.screen;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#0c0f15";
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.strokeStyle = "rgba(180, 200, 235, 0.09)";
    ctx.lineWidth = 1;
    const grid = 50;
    for (let x = grid; x < width; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = grid; y < height; y += grid) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(180, 200, 235, 0.18)";
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(200, 215, 240, 0.32)";
    ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`${width} × ${height}`, 8, 8);
    if (app.project.rings.length === 0 && (app.project.lns || []).length === 0) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillStyle = "rgba(200, 215, 240, 0.38)";
      ctx.fillText(
        app.ui.placeMode === "ln"
          ? "始点クリック → 終点クリックで曲線に沿ってリング列 (LN) を配置"
          : "クリックで現在のカーソル位置にリングを追加",
        width / 2,
        height / 2 + 24
      );
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText("選択中は空きクリックで解除 / 右クリックで削除", width / 2, height / 2 + 44);
    }
    ctx.restore();
  }

  drawLnCurve(ln, { selected = false, hover = false, alpha = 0.65, preview = false } = {}) {
    const ctx = this.ctx;
    const app = this.app;
    const color = app.ringColor(ln);
    const screen = app.project.screen;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = selected ? "#ffe16a" : preview ? "#6fe7ff" : color;
    ctx.lineWidth = selected || hover ? 2.2 : 1.5;
    ctx.setLineDash(selected ? [6, 4] : [4, 5]);
    ctx.beginPath();
    const steps = 32;
    for (let i = 0; i <= steps; i++) {
      const pt = lnPointAt(ln, i / steps, screen);
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 終点マーカー（includeEndがfalseで最後のリングがt=1より前に止まる場合にも有用）。
    if (!ln.includeEnd || selected || preview) {
      ctx.strokeStyle = selected ? "#ffe16a" : preview ? "#6fe7ff" : color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ln.endX, ln.endY, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLnHandles(ln) {
    const ctx = this.ctx;
    const screen = this.app.project.screen;
    const mid = lnPointAt(ln, 0.5, screen);
    ctx.save();

    // 始点リングの半径ハンドル
    ctx.strokeStyle = "rgba(245, 196, 0, 0.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ln.startX, ln.startY);
    ctx.lineTo(ln.startX + ln.radius, ln.startY);
    ctx.stroke();
    ctx.fillStyle = "#fff8d8";
    ctx.strokeStyle = "#b58f00";
    ctx.fillRect(ln.startX + ln.radius - 5, ln.startY - 5, 10, 10);
    ctx.strokeRect(ln.startX + ln.radius - 5, ln.startY - 5, 10, 10);

    // 中点の曲がり具合を調整するハンドル（ひし形）
    ctx.save();
    ctx.translate(mid.x, mid.y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#6fe7ff";
    ctx.strokeStyle = "#082230";
    ctx.lineWidth = 1.5;
    ctx.fillRect(-5.5, -5.5, 11, 11);
    ctx.strokeRect(-5.5, -5.5, 11, 11);
    ctx.restore();

    // 始点ハンドル（S）と終点ハンドル（E）
    const drawEndpoint = (x, y, label, bg) => {
      ctx.fillStyle = bg;
      ctx.strokeStyle = "#0b0f16";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#0b0f16";
      ctx.font = "bold 9px ui-monospace, SFMono-Regular, Consolas, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, x, y + 0.5);
    };
    drawEndpoint(ln.startX, ln.startY, "S", "#ffe16a");
    drawEndpoint(ln.endX, ln.endY, "E", "#ff9f43");

    ctx.restore();
  }

  drawRing(ring, { selected = false, hover = false, alpha = 1, atCursor = false } = {}) {
    const ctx = this.ctx;
    const app = this.app;
    const color = app.ringColor(ring);
    const lineWidth = selected ? 3 : atCursor ? 2.8 : 2;
    const cursorColor = "#6fe7ff";
    ctx.save();
    ctx.globalAlpha = alpha;

    if (atCursor && !selected) {
      ctx.strokeStyle = cursorColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.hexToRgba(color, selected ? 0.1 : atCursor ? 0.09 : 0.055);
    ctx.fill();
    if (atCursor) {
      ctx.shadowColor = cursorColor;
      ctx.shadowBlur = 16;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (hover && !selected) ctx.lineWidth = 3;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";

    if (selected) {
      ctx.strokeStyle = "rgba(245, 196, 0, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, ring.radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // 中心点と半径ハンドル
      ctx.fillStyle = "rgba(245, 196, 0, 0.95)";
      ctx.beginPath();
      ctx.arc(ring.x, ring.y, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(245, 196, 0, 0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ring.x, ring.y);
      ctx.lineTo(ring.x + ring.radius, ring.y);
      ctx.stroke();
      ctx.fillStyle = "#fff8d8";
      ctx.strokeStyle = "#b58f00";
      ctx.lineWidth = 1;
      ctx.fillRect(ring.x + ring.radius - 5, ring.y - 5, 10, 10);
      ctx.strokeRect(ring.x + ring.radius - 5, ring.y - 5, 10, 10);
    }

    if (app.settings.showTimes || selected || atCursor) {
      const frame = frameForRing(app.project, ring);
      const label = atCursor && !selected ? `NOW  ${formatNumber(frame, 1)}f` : `${formatNumber(frame, 1)}f  ${formatSeconds(secondsForFrame(frame))}`;
      ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const metrics = ctx.measureText(label);
      const tx = Math.min(Math.max(ring.x + ring.radius + 6, 4), app.project.screen.width - metrics.width - 8);
      const ty = Math.max(ring.y - ring.radius - 4, 14);
      ctx.fillStyle = "rgba(8,12,20,0.72)";
      ctx.fillRect(tx - 3, ty - 12, metrics.width + 6, 14);
      ctx.fillStyle = selected ? "#ffe16a" : atCursor ? cursorColor : color;
      ctx.fillText(label, tx, ty);
    }
    ctx.restore();
  }

  hexToRgba(hex, alpha) {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#ffffff";
    const r = parseInt(normalized.slice(1, 3), 16);
    const g = parseInt(normalized.slice(3, 5), 16);
    const b = parseInt(normalized.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  render() {
    this.resizeCanvas();
    this.drawBackground();
    const app = this.app;
    const currentFrame = app.currentFrame;
    const currentBeat = app.currentBeatPosition;
    const fadeSpan = Math.max(0.5, app.settings.displayRangeBeats);
    const views = [...app.getDisplayRings()].map((ring) => {
      const frame = frameForRing(app.project, ring);
      const distance = Math.abs(frame - currentFrame);
      const beatDistance = Math.abs(app.beatPosition(ring.page, ring.position) - currentBeat);
      const atCursor = distance <= 0.5;
      const baseAlpha = Math.max(0.1, Math.min(1, 1 - beatDistance / fadeSpan));
      const selected = ring.id === app.ui.selectedRingId;
      return {
        ring,
        isLnRing: false,
        distance,
        atCursor,
        selected,
        hover: ring.id === this.hoverRingId,
        alpha: selected ? 1 : baseAlpha,
      };
    });

    const displayLns = app.getDisplayLns();
    for (const ln of displayLns) {
      const lnSelected = ln.id === app.ui.selectedLnId;
      const lnHover = ln.id === this.hoverLnId;
      const expanded = expandLn(app.project, ln);
      let minDistance = Infinity;
      for (const ring of expanded) {
        if (!app.isWithinDisplayRange(ring.page, ring.position, currentBeat)) continue;
        const frame = frameForRing(app.project, ring);
        const distance = Math.abs(frame - currentFrame);
        const beatDistance = Math.abs(app.beatPosition(ring.page, ring.position) - currentBeat);
        if (distance < minDistance) minDistance = distance;
        const atCursor = distance <= 0.5;
        const baseAlpha = Math.max(0.12, Math.min(1, 1 - beatDistance / fadeSpan));
        views.push({
          ring,
          isLnRing: true,
          lnId: ln.id,
          distance,
          atCursor,
          selected: lnSelected,
          hover: lnHover,
          alpha: lnSelected ? 0.95 : baseAlpha,
        });
      }
      const minBeatDistance = expanded.reduce((min, ring) => {
        if (!app.isWithinDisplayRange(ring.page, ring.position, currentBeat)) return min;
        return Math.min(min, Math.abs(app.beatPosition(ring.page, ring.position) - currentBeat));
      }, Infinity);
      const curveAlpha = lnSelected ? 0.95 : Math.max(0.18, Math.min(0.75, 1 - minBeatDistance / fadeSpan));
      this.drawLnCurve(ln, {
        selected: lnSelected,
        hover: lnHover,
        alpha: curveAlpha,
      });
    }

    // 遠い時刻のリングから描画し、カーソル時刻のリングを後に、選択中のリングを最前面に描く。
    views.sort((a, b) => {
      if (a.selected !== b.selected) return a.selected ? 1 : -1;
      if (a.distance !== b.distance) return b.distance - a.distance;
      return String(a.ring.id).localeCompare(String(b.ring.id));
    });

    for (const view of views) {
      this.drawRing(view.ring, {
        selected: view.selected && !view.isLnRing,
        hover: view.hover,
        alpha: view.alpha,
        atCursor: view.atCursor,
      });
    }

    const selectedLn = app.selectedLn;
    if (selectedLn) {
      this.drawLnHandles(selectedLn);
    }

    if (app.ui.lnDraftStart) {
      const start = app.ui.lnDraftStart;
      const { width, height } = app.project.screen;
      const endX = this.point ? clamp(this.snap(this.point.x), 0, width) : start.x;
      const endY = this.point ? clamp(this.snap(this.point.y), 0, height) : start.y;
      const endLoc = lnEndForDuration(app.project, app.ui.page, app.ui.position, app.settings.ln.duration);
      const previewLn = {
        id: "draft",
        page: app.ui.page,
        position: app.ui.position,
        endPage: endLoc.page,
        endPosition: endLoc.position,
        startX: start.x,
        startY: start.y,
        endX,
        endY,
        count: app.settings.ln.count,
        distortion: app.settings.ln.distortion,
        includeEnd: app.settings.ln.includeEnd,
        sound: app.settings.tool.sound,
        endSound: app.settings.ln.endSound,
        radius: app.settings.tool.radius,
        color: app.settings.tool.color,
        frames: app.settings.tool.frames,
      };
      this.drawLnCurve(previewLn, { preview: true, alpha: 0.85 });
      const previewRings = expandLn(app.project, previewLn);
      for (const ring of previewRings) {
        this.drawRing(ring, { alpha: 0.65, atCursor: ring.lnIndex === 0 });
      }
      this.drawLnHandles(previewLn);
      return;
    }

    if (this.point && !this.drag) {
      const hit = this.hitTestObject(this.point.x, this.point.y);
      if (!hit) {
        const tool = app.settings.tool;
        const color = tool.color || "#ffffff";
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.arc(this.point.x, this.point.y, tool.radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(this.point.x, this.point.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }
}
