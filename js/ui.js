import { DIVISORS } from "./constants.js";
import { escapeHtml, formatNumber, autoRingColor, normalizeColor, readFileAsText, downloadText } from "./model.js";
import { allProjectRings, formatSeconds, frameForRing, lnDurationRatio, secondsForFrame } from "./timing.js";
import { parseChart, parseProjectJson } from "./dos.js";
import { classifyFile, looksLikeChartText } from "./fileTypes.js";

function formatFrameOffset(value) {
  const frames = Math.round(Number(value) || 0);
  return `${frames > 0 ? "+" : ""}${frames} f`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.pendingImportText = "";
    this.exportMode = "merged";
    this.bindRefs();
    this.populateSelects();
    this.bindEvents();
    this.bindDropZone();
    this.bindShortcutState();
    this.syncFromSettings();
    this.observeCanvas();
    this.fitCanvas();
  }

  bindRefs() {
    const ids = [
      "btn-new",
      "btn-import-chart",
      "btn-import-project",
      "btn-export",
      "btn-help",
      "page-input",
      "label-checkbox",
      "label-position",
      "btn-label-prev",
      "btn-label-next",
      "start-number",
      "bpm",
      "page-block",
      "blank-frame",
      "screen-w",
      "screen-h",
      "score-number",
      "snap",
      "divisor",
      "advance-after-place",
      "display-range",
      "display-range-value",
      "show-times",
      "show-reference",
      "show-waveform",
      "music-file",
      "music-badge",
      "music-volume",
      "music-volume-value",
      "music-rate",
      "music-rate-value",
      "music-offset",
      "music-offset-value",
      "edit-status",
      "note-count",
      "canvas-scroll",
      "btn-main-play",
      "play-status",
      "btn-ring-reset",
      "ring-inspector",
      "ring-sound-label",
      "ring-frame",
      "ring-page",
      "ring-position",
      "ring-x",
      "ring-y",
      "ring-radius",
      "ring-sound",
      "ring-color-auto",
      "ring-color",
      "btn-ring-sound-preview",
      "ring-frames-auto",
      "ring-frames",
      "ln-params-group",
      "ln-count",
      "ln-duration",
      "ln-distortion",
      "ln-end-sound",
      "btn-ln-end-sound-preview",
      "ln-include-end",
      "ln-place-hint",
      "single-ring-info-group",
      "ln-info-group",
      "ln-start-page",
      "ln-start-position",
      "ln-start-x",
      "ln-start-y",
      "ln-end-page",
      "ln-end-position",
      "ln-end-x",
      "ln-end-y",
      "btn-ring-duplicate",
      "btn-ring-delete",
      "btn-ring-jump",
      "btn-ln-decompose",
      "speed-count",
      "speed-type",
      "speed-value",
      "btn-add-speed",
      "speed-list",
      "warning-count",
      "warning-list",
      "btn-timeline-reverse",
      "block-height",
      "timeline-scroll",
      "timeline-content",
      "dialog-import-chart",
      "chart-file",
      "chart-text",
      "import-rings",
      "import-references",
      "import-screen",
      "import-summary",
      "btn-import-analyze",
      "btn-import-apply",
      "dialog-export",
      "export-screen",
      "export-empty",
      "export-text",
      "export-note",
      "btn-export-copy",
      "btn-export-download",
      "dialog-help",
      "drop-overlay",
      "toast-stack",
    ];
    this.refs = {};
    for (const id of ids) this.refs[id] = document.getElementById(id);
    this.refs.canvas = document.getElementById("edit-canvas");
    this.refs.placeModeButtons = [...document.querySelectorAll("[data-place-mode]")];
    this.refs.exportSegs = [...document.querySelectorAll("[data-export-mode]")];
    this.refs.pageStepButtons = [...document.querySelectorAll("[data-page-step]")];
  }

  populateSelects() {
    this.refs.divisor.innerHTML = DIVISORS.map(
      (divisor) => `<option value="${divisor.value}">${divisor.label}</option>`
    ).join("");
  }

  bindEvents() {
    const r = this.refs;
    const app = this.app;

    r.pageStepButtons.forEach((button) => {
      button.addEventListener("click", () => app.stepPage(Number(button.dataset.pageStep)));
    });
    r["page-input"].addEventListener("change", () => app.setPage(r["page-input"].value));
    r["label-checkbox"].addEventListener("change", () => app.toggleCurrentLabel(r["label-checkbox"].checked));
    r["btn-label-prev"].addEventListener("click", () => app.jumpLabel(-1));
    r["btn-label-next"].addEventListener("click", () => app.jumpLabel(1));

    r["start-number"].addEventListener("change", () => app.setActiveTimingField("startNum", r["start-number"].value));
    r.bpm.addEventListener("change", () => app.setActiveTimingField("bpm", r.bpm.value));
    r["page-block"].addEventListener("change", () => app.setActiveTimingField("pageBlockNum", r["page-block"].value));
    r["blank-frame"].addEventListener("change", () => app.setActiveTimingField("blankFrame", r["blank-frame"].value));

    r["screen-w"].addEventListener("change", () => app.setScreenSize(r["screen-w"].value, app.project.screen.height));
    r["screen-h"].addEventListener("change", () => app.setScreenSize(app.project.screen.width, r["screen-h"].value));
    r["score-number"].addEventListener("change", () => app.setScoreNumber(r["score-number"].value));

    r.snap.addEventListener("change", () => {
      app.settings.snap = Number(r.snap.value) || 5;
      app.saveSettings();
    });
    r.divisor.addEventListener("change", () => app.setDivisor(r.divisor.value));
    r["advance-after-place"].addEventListener("change", () => {
      app.settings.advanceAfterPlace = r["advance-after-place"].checked;
      app.saveSettings();
    });

    r["display-range"].addEventListener("input", () => {
      app.settings.displayRangeBeats = Number(r["display-range"].value);
      r["display-range-value"].textContent = `${app.settings.displayRangeBeats}拍`;
      app.saveSettings();
      app.requestRender({ structure: false });
    });
    r["show-times"].addEventListener("change", () => {
      app.settings.showTimes = r["show-times"].checked;
      app.saveSettings();
      app.requestRender({ structure: false });
    });
    r["show-reference"].addEventListener("change", () => {
      app.settings.showReferenceNotes = r["show-reference"].checked;
      app.saveSettings();
      app.requestRender({ structure: true });
    });
    r["show-waveform"].addEventListener("change", () => {
      app.settings.showWaveform = r["show-waveform"].checked;
      app.saveSettings();
      app.requestRender({ structure: true });
    });

    r["music-file"].addEventListener("change", async () => {
      const file = r["music-file"].files?.[0];
      if (!file) return;
      await this.loadMusicFile(file);
    });
    const updateVolume = () => {
      app.settings.musicVolume = Number(r["music-volume"].value) / 100;
      app.saveSettings();
      r["music-volume-value"].textContent = `${r["music-volume"].value}%`;
      app.audio.setMusicVolume(app.settings.musicVolume);
    };
    r["music-volume"].addEventListener("input", updateVolume);
    const updateRate = () => {
      app.settings.musicRate = Number(r["music-rate"].value) / 100;
      app.saveSettings();
      r["music-rate-value"].textContent = `${app.settings.musicRate.toFixed(2)}x`;
      if (app.mainPlayback?.running) app.restartMainLoopIfPlaying();
    };
    r["music-rate"].addEventListener("change", updateRate);
    r["music-rate"].addEventListener("input", () => {
      r["music-rate-value"].textContent = `${(Number(r["music-rate"].value) / 100).toFixed(2)}x`;
    });
    const updateOffset = () => {
      app.settings.musicOffset = Number(r["music-offset"].value);
      app.saveSettings();
      r["music-offset-value"].textContent = formatFrameOffset(r["music-offset"].value);
      if (app.mainPlayback?.running) app.restartMainLoopIfPlaying();
    };
    r["music-offset"].addEventListener("change", updateOffset);
    r["music-offset"].addEventListener("input", () => {
      r["music-offset-value"].textContent = formatFrameOffset(r["music-offset"].value);
    });

    r["btn-main-play"].addEventListener("click", () => {
      app.audio.ensureContext();
      app.toggleMainPlayback();
    });

    r["btn-ring-reset"].addEventListener("click", () => app.resetToolAppearance());
    r.placeModeButtons.forEach((button) => {
      button.addEventListener("click", () => app.setPlaceMode(button.dataset.placeMode));
    });

    r["ring-frame"].addEventListener("change", () => {
      if (app.selectedRing) app.setRingFrame(app.selectedRing.id, r["ring-frame"].value);
    });
    const updateRingInfoField = (field, input) => {
      input.addEventListener("change", () => {
        const ring = app.selectedRing;
        if (!ring) return;
        app.updateRing(ring.id, { [field]: Number(input.value) });
      });
    };
    updateRingInfoField("page", r["ring-page"]);
    updateRingInfoField("position", r["ring-position"]);
    updateRingInfoField("x", r["ring-x"]);
    updateRingInfoField("y", r["ring-y"]);

    const updateLnInfoField = (field, input) => {
      input?.addEventListener("change", () => {
        const ln = app.selectedLn;
        if (!ln) return;
        app.updateLn(ln.id, { [field]: Number(input.value) });
      });
    };
    updateLnInfoField("page", r["ln-start-page"]);
    updateLnInfoField("position", r["ln-start-position"]);
    updateLnInfoField("startX", r["ln-start-x"]);
    updateLnInfoField("startY", r["ln-start-y"]);
    updateLnInfoField("endPage", r["ln-end-page"]);
    updateLnInfoField("endPosition", r["ln-end-position"]);
    updateLnInfoField("endX", r["ln-end-x"]);
    updateLnInfoField("endY", r["ln-end-y"]);

    const updateAppearance = (patch) => {
      const ring = app.selectedRing;
      const ln = app.selectedLn;
      if (ring) app.updateRing(ring.id, patch);
      else if (ln) app.updateLn(ln.id, patch);
      else app.updateToolAppearance(patch);
    };

    const updateLnParam = (patch) => {
      const ln = app.selectedLn;
      if (ln) app.updateLn(ln.id, patch);
      else app.updateLnToolSettings(patch);
    };

    r["ring-radius"].addEventListener("change", () => {
      updateAppearance({ radius: Number(r["ring-radius"].value) });
    });
    r["ring-sound"].addEventListener("change", () => {
      updateAppearance({ sound: Number(r["ring-sound"].value) });
    });
    r["ring-color-auto"].addEventListener("change", () => {
      updateAppearance({
        color: r["ring-color-auto"].checked
          ? ""
          : normalizeColor(r["ring-color"].value) || autoRingColor(),
      });
    });
    r["ring-color"].addEventListener("change", () => {
      r["ring-color-auto"].checked = false;
      updateAppearance({ color: normalizeColor(r["ring-color"].value) || "#ffffff" });
    });
    r["btn-ring-sound-preview"].addEventListener("click", () => {
      const sound = app.selectedRing?.sound ?? app.selectedLn?.sound ?? app.settings.tool.sound;
      app.audio.ensureContext();
      app.audio.playRingSound(sound, 0.5);
    });
    r["ring-frames-auto"].addEventListener("change", () => {
      updateAppearance({
        frames: r["ring-frames-auto"].checked ? 0 : Math.max(1, Number(r["ring-frames"].value) || 60),
      });
    });
    r["ring-frames"].addEventListener("change", () => {
      r["ring-frames-auto"].checked = false;
      updateAppearance({ frames: Math.max(0, Number(r["ring-frames"].value) || 0) });
    });

    r["ln-count"]?.addEventListener("change", () => {
      updateLnParam({ count: Number(r["ln-count"].value) });
    });
    r["ln-duration"]?.addEventListener("change", () => {
      updateLnParam({ duration: Number(r["ln-duration"].value) });
    });
    r["ln-distortion"]?.addEventListener("change", () => {
      updateLnParam({ distortion: Number(r["ln-distortion"].value) });
    });
    r["ln-end-sound"]?.addEventListener("change", () => {
      updateLnParam({ endSound: Number(r["ln-end-sound"].value) });
    });
    r["btn-ln-end-sound-preview"]?.addEventListener("click", () => {
      const sound = app.selectedLn?.endSound ?? app.settings.ln.endSound;
      app.audio.ensureContext();
      app.audio.playRingSound(sound, 0.5);
    });
    r["ln-include-end"]?.addEventListener("change", () => {
      updateLnParam({ includeEnd: r["ln-include-end"].checked });
    });

    r["btn-ring-duplicate"].addEventListener("click", () => {
      if (app.selectedRing || app.selectedLn) app.duplicateSelected();
    });
    r["btn-ring-delete"].addEventListener("click", () => {
      if (app.selectedLn) app.deleteLn(app.selectedLn.id);
      else if (app.selectedRing) app.deleteRing(app.selectedRing.id);
    });
    r["btn-ring-jump"].addEventListener("click", () => {
      if (app.selectedLn) app.selectLn(app.selectedLn.id, { jump: true });
      else if (app.selectedRing) app.selectRing(app.selectedRing.id, { jump: true });
    });
    r["btn-ln-decompose"]?.addEventListener("click", () => {
      if (app.selectedLn) app.decomposeSelectedLn();
    });

    r["btn-add-speed"].addEventListener("click", () => {
      app.addSpeed(r["speed-type"].value, r["speed-value"].value);
    });
    r["speed-list"].addEventListener("click", (event) => {
      const deleteButton = event.target.closest("[data-delete-speed]");
      if (deleteButton) {
        event.stopPropagation();
        app.deleteSpeed(deleteButton.dataset.deleteSpeed);
        return;
      }
      const item = event.target.closest("[data-speed-id]");
      if (item) app.seekToSpeed(item.dataset.speedId);
    });

    r["warning-list"].addEventListener("click", (event) => {
      const lnItem = event.target.closest("[data-warning-ln]");
      if (lnItem) {
        app.selectLn(lnItem.dataset.warningLn, { jump: true });
        return;
      }
      const item = event.target.closest("[data-warning-ring]");
      if (item) app.selectRing(item.dataset.warningRing, { jump: true });
    });

    r["btn-new"].addEventListener("click", () => {
      if (!confirm("現在のセーブデータを破棄して新規作成しますか？")) return;
      app.newProject();
      this.toast("新規セーブデータを作成しました。", "success");
    });
    r["btn-import-chart"].addEventListener("click", () => this.openImportChart());
    r["btn-import-project"].addEventListener("click", () => this.openImportProject());
    r["btn-export"].addEventListener("click", () => this.openExport());
    r["btn-help"].addEventListener("click", () => r["dialog-help"].showModal());
    this.bindDialogBackdropClose();

    r["btn-timeline-reverse"].addEventListener("click", () => {
      app.settings.timelineReverse = !app.settings.timelineReverse;
      app.saveSettings();
      app.requestRender({ structure: true });
    });
    r["block-height"].addEventListener("change", () => {
      app.settings.blockHeight = Number(r["block-height"].value) || 56;
      app.saveSettings();
      app.requestRender({ structure: true, scroll: true });
    });

    this.bindImportDialog();
    this.bindExportDialog();
  }

  bindShortcutState() {
    const schedule = () => this.scheduleShortcutState();
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    document.addEventListener("pointerdown", schedule, true);
    window.addEventListener("blur", schedule);
    window.addEventListener("focus", schedule);

    const watched = [
      this.refs["dialog-import-chart"],
      this.refs["dialog-export"],
      this.refs["dialog-help"],
    ].filter(Boolean);
    if (typeof MutationObserver !== "undefined" && watched.length > 0) {
      this.shortcutObserver = new MutationObserver(schedule);
      for (const el of watched) {
        this.shortcutObserver.observe(el, { attributes: true, attributeFilter: ["open", "hidden"] });
      }
    }
    this.applyShortcutState();
  }

  scheduleShortcutState() {
    if (this._shortcutFrame) return;
    this._shortcutFrame = requestAnimationFrame(() => {
      this._shortcutFrame = 0;
      this.applyShortcutState();
    });
  }

  applyShortcutState() {
    const canvas = this.refs.canvas;
    if (!canvas) return;
    const active = document.activeElement;
    const editingField =
      active instanceof HTMLElement &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT" ||
        active.isContentEditable);
    const blocked = Boolean(document.querySelector("dialog[open]"));
    canvas.classList.toggle("shortcuts-active", document.hasFocus() && !editingField && !blocked);
  }

  bindDialogBackdropClose() {
    let pointerInside = false;
    document.addEventListener(
      "pointerdown",
      (event) => {
        pointerInside = Boolean(event.target?.closest?.(".dialog-inner"));
      },
      true
    );
    document.addEventListener(
      "click",
      (event) => {
        const dialog = document.querySelector("dialog[open]");
        if (!dialog || pointerInside) return;
        if (event.target === dialog || !dialog.contains(event.target)) dialog.close();
      },
      true
    );
  }

  bindImportDialog() {
    const r = this.refs;
    r["chart-file"].addEventListener("change", async () => {
      const file = r["chart-file"].files?.[0];
      if (!file) return;
      r["chart-text"].value = await readFileAsText(file);
      this.analyzeImport(file.name);
    });
    r["btn-import-analyze"].addEventListener("click", () => this.analyzeImport());
    r["btn-import-apply"].addEventListener("click", () => {
      const text = r["chart-text"].value;
      if (!text.trim()) return;
      if (
        r["import-rings"].checked &&
        (this.app.project.rings.length > 0 ||
          (this.app.project.lns || []).length > 0 ||
          this.app.project.speeds.length > 0) &&
        !confirm(
          `現在のリング ${this.app.project.rings.length} 個 / LN ${(this.app.project.lns || []).length} 個 / 速度変化 ${this.app.project.speeds.length} 個を、読み込んだ内容で置き換えますか？`
        )
      ) {
        return;
      }
      try {
        const summary = this.app.importChart(text, {
          rings: r["import-rings"].checked,
          references: r["import-references"].checked,
          screen: r["import-screen"].checked,
        });
        r["dialog-import-chart"].close();
        this.toast(
          `譜面を読み込みました（リング ${summary.rings} / 速度 ${summary.speeds} / 参照ノーツ ${summary.references}）`,
          "success"
        );
        if (summary.warnings.length > 0) this.toast(summary.warnings[0], "warn");
      } catch (error) {
        this.toast(`譜面の読み込みに失敗しました: ${error.message}`, "error");
      }
    });
  }

  analyzeImport(fileName = "") {
    const r = this.refs;
    const text = r["chart-text"].value;
    if (!text.trim()) {
      r["import-summary"].textContent = "譜面テキストが空です。";
      r["btn-import-apply"].disabled = true;
      return;
    }
    try {
      const parsed = parseChart(text);
      const labels = parsed.meta.timings.map((t) => `Page ${t.label}: BPM ${t.bpm} / ${t.pageBlockNum} blocks`);
      const lines = [
        `ラベル: ${parsed.meta.timings.length} 個`,
        ...labels.map((line) => `  ${line}`),
        `Blank Frame: ${parsed.meta.blankFrame}`,
        `スコア番号: ${parsed.meta.scoreNumber}`,
        `リング: ${parsed.rings.length} 個 / 速度変化: ${parsed.speeds.length} 個`,
        `通常ノーツ参照: ${parsed.referenceNoteFrames.length} 個`,
      ];
      if (parsed.warnings.length > 0) {
        lines.push(`警告: ${parsed.warnings.length} 件`);
        lines.push(...parsed.warnings.slice(0, 3).map((w) => `  ${w}`));
      }
      r["import-summary"].innerHTML = lines.map((line) => escapeHtml(line)).join("\n");
      r["btn-import-apply"].disabled = false;
      this.pendingImportText = text;
    } catch (error) {
      r["import-summary"].textContent = `解析に失敗しました: ${error.message}`;
      r["btn-import-apply"].disabled = true;
    }
  }

  openImportChart(initialText = "", fileName = "") {
    const r = this.refs;
    r["chart-text"].value = initialText;
    r["chart-file"].value = "";
    r["import-summary"].textContent = "まだ解析していません。";
    r["btn-import-apply"].disabled = true;
    if (initialText.trim()) this.analyzeImport(fileName);
    r["dialog-import-chart"].showModal();
  }

  async importProjectFile(file) {
    const text = await readFileAsText(file);
    parseProjectJson(text);
    if (
      this.app.project.rings.length > 0 ||
      (this.app.project.lns || []).length > 0 ||
      this.app.project.speeds.length > 0
    ) {
      if (!confirm("現在のセーブデータを置き換えますか？")) return false;
    }
    this.app.importProject(text);
    this.toast("セーブデータを読み込みました。", "success");
    return true;
  }

  async loadMusicFile(file) {
    this.toast("音源を読み込み中...");
    try {
      const info = await this.app.audio.loadMusic(file);
      this.refs["music-file"].value = "";
      this.refs["music-badge"].textContent = info.duration
        ? `${info.name} (${formatSeconds(info.duration)})`
        : info.name;
      this.refs["music-badge"].title = info.name;
      this.toast(`音源を読み込みました: ${info.name}`, "success");
      this.app.requestRender({ structure: true });
      if (this.app.mainPlayback?.running) this.app.restartMainLoopIfPlaying();
      return true;
    } catch (error) {
      this.toast(`音源の読み込みに失敗しました: ${error.message}`, "error");
      return false;
    }
  }

  openImportProject() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        await this.importProjectFile(file);
      } catch (error) {
        this.toast(`読み込みに失敗しました: ${error.message}`, "error");
      }
    });
    input.click();
  }

  bindDropZone() {
    let dragDepth = 0;
    const hasFiles = (event) => {
      const files = event.dataTransfer?.files;
      if (files && files.length > 0) return true;
      const types = event.dataTransfer?.types;
      return Boolean(types && Array.from(types).includes("Files"));
    };
    const hide = () => {
      dragDepth = 0;
      this.showDropOverlay(false);
    };

    window.addEventListener("dragenter", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (this.isDropBlocked()) {
        this.showDropOverlay(false);
        return;
      }
      dragDepth += 1;
      this.showDropOverlay(true);
    });

    window.addEventListener("dragover", (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      if (this.isDropBlocked()) this.showDropOverlay(false);
      else this.showDropOverlay(true);
    });

    window.addEventListener("dragleave", (event) => {
      if (dragDepth === 0) return;
      if (event.relatedTarget === null) {
        hide();
        return;
      }
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) this.showDropOverlay(false);
    });

    window.addEventListener("drop", async (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      hide();
      if (this.isDropBlocked()) {
        this.toast("ダイアログを閉じてからドロップしてください。", "warn");
        return;
      }
      try {
        await this.handleDroppedFiles(event.dataTransfer.files);
      } catch (error) {
        this.toast(`ファイルの読み込みに失敗しました: ${error.message}`, "error");
      }
    });

    window.addEventListener("dragend", hide);
  }

  isDropBlocked() {
    return Boolean(document.querySelector("dialog[open]"));
  }

  showDropOverlay(visible) {
    const overlay = this.refs["drop-overlay"];
    if (overlay) overlay.hidden = !visible;
    document.body.classList.toggle("file-drag", Boolean(visible));
  }

  async handleDroppedFiles(fileList) {
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    const audioFiles = [];
    const projectFiles = [];
    const chartFiles = [];
    const unknownFiles = [];

    for (const file of files) {
      const kind = classifyFile(file);
      if (kind === "audio") audioFiles.push(file);
      else if (kind === "project") projectFiles.push(file);
      else if (kind === "chart") chartFiles.push(file);
      else unknownFiles.push(file);
    }

    // 未知の拡張子でも、DOS譜面らしいテキストなら読み込む。
    for (const file of [...unknownFiles]) {
      if (file.size > 5 * 1024 * 1024) continue;
      const type = String(file.type ?? "").toLowerCase();
      if (type !== "" && type !== "application/octet-stream" && !type.startsWith("text/")) continue;
      try {
        const text = await readFileAsText(file);
        if (looksLikeChartText(text)) {
          chartFiles.push(file);
          unknownFiles.splice(unknownFiles.indexOf(file), 1);
        }
      } catch {
        /* エラーを無視する */
      }
    }

    if (audioFiles.length > 0) {
      await this.loadMusicFile(audioFiles[0]);
      if (audioFiles.length > 1) {
        this.toast(`音源は最初の1つを使用します（${audioFiles.length}個中）`, "warn");
      }
    }

    if (projectFiles.length > 0) {
      if (chartFiles.length > 0) {
        this.toast("セーブデータを優先しました。譜面ファイルは読み込んでいません。", "warn");
      }
      try {
        await this.importProjectFile(projectFiles[0]);
      } catch (error) {
        this.toast(`セーブデータの読み込みに失敗しました: ${error.message}`, "error");
      }
      if (projectFiles.length > 1) {
        this.toast(`セーブデータは最初の1つを使用します（${projectFiles.length}個中）`, "warn");
      }
    } else if (chartFiles.length > 0) {
      try {
        const text = await readFileAsText(chartFiles[0]);
        this.openImportChart(text, chartFiles[0].name);
      } catch (error) {
        this.toast(`譜面の読み込みに失敗しました: ${error.message}`, "error");
      }
      if (chartFiles.length > 1) {
        this.toast(`譜面は最初の1つを読み込みます（${chartFiles.length}個中）`, "warn");
      }
    } else if (audioFiles.length === 0) {
      if (unknownFiles.length > 0) {
        const names = unknownFiles.map((file) => file.name).join(", ");
        this.toast(`対応していないファイルです: ${names}`, "error");
        unknownFiles.length = 0;
      } else {
        this.toast("対応していないファイルです。譜面（.txt / .dos）、セーブデータ（.json）、音源をドロップしてください。", "error");
      }
    }

    if (unknownFiles.length > 0) {
      const names = unknownFiles.map((file) => file.name).join(", ");
      this.toast(`未対応のファイルを無視しました: ${names}`, "warn");
    }
  }

  openExport() {
    const r = this.refs;
    this.exportMode = this.app.project.importedChart ? "merged" : "snippet";
    for (const button of r.exportSegs) {
      button.classList.toggle("active", button.dataset.exportMode === this.exportMode);
    }
    this.refreshExport();
    r["dialog-export"].showModal();
  }

  bindExportDialog() {
    const r = this.refs;
    r.exportSegs.forEach((button) => {
      button.addEventListener("click", () => {
        this.exportMode = button.dataset.exportMode;
        r.exportSegs.forEach((b) => b.classList.toggle("active", b === button));
        this.refreshExport();
      });
    });
    for (const id of ["export-screen", "export-empty"]) {
      r[id].addEventListener("change", () => this.refreshExport());
    }
    r["btn-export-copy"].addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(r["export-text"].value);
        this.toast("クリップボードにコピーしました。", "success");
      } catch {
        r["export-text"].select();
        document.execCommand("copy");
        this.toast("コピーしました。", "success");
      }
    });
    r["btn-export-download"].addEventListener("click", () => {
      const text = r["export-text"].value;
      if (!text) return;
      const base = (this.app.project.importedChartName || "ring-chart").replace(/\.[^.]+$/, "") || "ring-chart";
      if (this.exportMode === "project") downloadText(`${base}-ring.json`, text, "application/json");
      else if (this.exportMode === "merged") downloadText(`${base}-with-ring.txt`, text);
      else downloadText(`${base}-ring-snippet.txt`, text);
      this.toast("ダウンロードしました。", "success");
    });
  }

  refreshExport() {
    const r = this.refs;
    let result;
    try {
      result = this.app.buildExport(this.exportMode, {
        includeScreen: r["export-screen"].checked,
        includeEmpty: r["export-empty"].checked,
      });
    } catch (error) {
      result = { text: "", note: `出力に失敗しました: ${error.message}` };
    }
    r["export-text"].value = result.text;
    r["export-note"].textContent = result.note;
    r["export-screen"].disabled = this.exportMode === "project";
    r["export-empty"].disabled = this.exportMode === "project";
    r["btn-export-copy"].disabled = !result.text;
    r["btn-export-download"].disabled = !result.text;
  }

  getLabelInfo() {
    const labels = [...this.app.project.timings].sort((a, b) => a.label - b.label);
    const active = this.app.currentTiming;
    const index = labels.findIndex((t) => t.label === active.label);
    return { labels, active, index };
  }

  render({ structure = true } = {}) {
    this.forceInputSync = Boolean(structure);
    this.renderTiming();
    this.renderDisplaySettings();
    this.renderRingSettings();
    this.renderStatus();
    if (structure) {
      this.renderSpeedList();
      this.renderWarnings();
    }
    this.renderTimelineToolbar();
    this.renderPlayControls();
  }

  renderTiming() {
    const r = this.refs;
    const app = this.app;
    const timing = app.currentTiming;
    const { labels, index } = this.getLabelInfo();
    this.setValue(r["page-input"], app.ui.page);
    r["label-checkbox"].checked = app.isCurrentPageLabel();
    r["label-checkbox"].disabled = app.ui.page === 1 && app.isCurrentPageLabel();
    r["label-position"].textContent = `${index >= 0 ? index + 1 : 0} / ${labels.length}`;
    this.setValue(r["start-number"], formatNumber(timing.startNum, 4));
    this.setValue(r.bpm, formatNumber(timing.bpm, 4));
    this.setValue(r["page-block"], timing.pageBlockNum);
    this.setValue(r["blank-frame"], formatNumber(app.project.blankFrame, 4));
    this.setValue(r["screen-w"], app.project.screen.width);
    this.setValue(r["screen-h"], app.project.screen.height);
    this.setValue(r["score-number"], app.project.scoreNumber);
  }

  renderDisplaySettings() {
    const r = this.refs;
    const app = this.app;
    this.setValue(r.snap, app.settings.snap);
    this.setValue(r.divisor, app.ui.divisor);
    r["advance-after-place"].checked = app.settings.advanceAfterPlace;
    this.setValue(r["display-range"], app.settings.displayRangeBeats);
    r["display-range-value"].textContent = `${app.settings.displayRangeBeats}拍`;
    r["show-times"].checked = app.settings.showTimes;
    r["show-reference"].checked = app.settings.showReferenceNotes;
    r["show-waveform"].checked = app.settings.showWaveform;
    this.setValue(r["music-volume"], Math.round(app.settings.musicVolume * 100));
    r["music-volume-value"].textContent = `${Math.round(app.settings.musicVolume * 100)}%`;
    this.setValue(r["music-rate"], Math.round(app.settings.musicRate * 100));
    r["music-rate-value"].textContent = `${app.settings.musicRate.toFixed(2)}x`;
    this.setValue(r["music-offset"], app.settings.musicOffset);
    r["music-offset-value"].textContent = formatFrameOffset(app.settings.musicOffset);
  }

  renderRingSettings() {
    const r = this.refs;
    const app = this.app;
    const ring = app.selectedRing;
    const ln = app.selectedLn;
    const isLnView = Boolean(ln) || (!ring && app.ui.placeMode === "ln");
    const placement = !ring && !ln;
    const appearance = ring ?? ln ?? app.settings.tool;

    for (const button of r.placeModeButtons) {
      const activeMode = ln ? "ln" : ring ? "ring" : app.ui.placeMode;
      button.classList.toggle("active", button.dataset.placeMode === activeMode);
    }

    r["btn-ring-reset"].disabled = Boolean(ring || ln);
    if (r["ring-sound-label"]) {
      r["ring-sound-label"].textContent = isLnView ? "1個目の音" : "音番号";
    }

    this.setValue(r["ring-sound"], appearance.sound);
    this.setValue(r["ring-radius"], formatNumber(appearance.radius, 2));
    r["ring-color-auto"].checked = !appearance.color;
    this.setValue(r["ring-color"], appearance.color || autoRingColor());
    r["ring-frames-auto"].checked = !(appearance.frames > 0);
    this.setValue(r["ring-frames"], appearance.frames > 0 ? appearance.frames : 60);
    r["ring-frames"].disabled = !(appearance.frames > 0);

    if (r["ln-params-group"]) r["ln-params-group"].hidden = !isLnView;
    if (r["single-ring-info-group"]) r["single-ring-info-group"].hidden = isLnView;
    if (r["ln-info-group"]) r["ln-info-group"].hidden = !isLnView;

    if (isLnView) {
      const lnDraft = ln ?? app.getLnPlacementDraft();
      const duration = ln ? lnDurationRatio(app.project, ln) : app.settings.ln.duration;
      this.setValue(r["ln-count"], lnDraft.count);
      this.setValue(r["ln-duration"], formatNumber(duration, 4));
      this.setValue(r["ln-distortion"], formatNumber(lnDraft.distortion, 2));
      this.setValue(r["ln-end-sound"], lnDraft.endSound ?? lnDraft.sound);
      if (r["ln-include-end"]) r["ln-include-end"].checked = Boolean(lnDraft.includeEnd);
      if (r["ln-place-hint"]) {
        if (ln) {
          r["ln-place-hint"].textContent = `選択中: #${ln.id}（キャンバスでS/E/◆ドラッグ、タイムラインで始点/終点の時間を移動）`;
        } else if (app.ui.lnDraftStart) {
          r["ln-place-hint"].textContent = `始点 (${formatNumber(app.ui.lnDraftStart.x, 1)}, ${formatNumber(app.ui.lnDraftStart.y, 1)}) を設定中。終点をクリックして確定（Esc/右クリックで解除）`;
        } else {
          r["ln-place-hint"].textContent = "キャンバスで始点 → 終点の順にクリックして配置します。";
        }
      }

      this.setValue(r["ln-start-page"], lnDraft.page);
      this.setValue(r["ln-start-position"], formatNumber(lnDraft.position, 4));
      this.setValue(r["ln-start-x"], formatNumber(lnDraft.startX, 2));
      this.setValue(r["ln-start-y"], formatNumber(lnDraft.startY, 2));
      this.setValue(r["ln-end-page"], lnDraft.endPage);
      this.setValue(r["ln-end-position"], formatNumber(lnDraft.endPosition, 4));
      this.setValue(r["ln-end-x"], formatNumber(lnDraft.endX, 2));
      this.setValue(r["ln-end-y"], formatNumber(lnDraft.endY, 2));

      for (const id of [
        "ln-start-page",
        "ln-start-position",
        "ln-start-x",
        "ln-start-y",
        "ln-end-page",
        "ln-end-position",
        "ln-end-x",
        "ln-end-y",
      ]) {
        if (r[id]) r[id].disabled = !ln;
      }
    } else {
      const draft = ring ?? app.getPlacementDraft();
      const frame = frameForRing(app.project, draft);
      this.setValue(r["ring-frame"], formatNumber(frame, 3));
      this.setValue(r["ring-page"], draft.page);
      this.setValue(r["ring-position"], formatNumber(draft.position, 4));
      this.setValue(r["ring-x"], formatNumber(draft.x, 2));
      this.setValue(r["ring-y"], formatNumber(draft.y, 2));

      for (const id of ["ring-frame", "ring-page", "ring-position", "ring-x", "ring-y"]) {
        r[id].disabled = placement;
      }
    }

    for (const id of ["btn-ring-duplicate", "btn-ring-delete", "btn-ring-jump"]) {
      r[id].disabled = placement;
    }
    if (r["btn-ln-decompose"]) {
      r["btn-ln-decompose"].hidden = !isLnView;
      r["btn-ln-decompose"].disabled = !ln;
    }
  }

  renderSpeedList() {
    const r = this.refs;
    const app = this.app;
    r["speed-count"].textContent = String(app.project.speeds.length);
    if (app.project.speeds.length === 0) {
      r["speed-list"].innerHTML = '<div class="empty-state">速度変化はありません。</div>';
      return;
    }
    const speeds = [...app.project.speeds].sort((a, b) => a.frame - b.frame || a.type.localeCompare(b.type));
    r["speed-list"].innerHTML = speeds
      .map((speed) => {
        const label = speed.type === "boost" ? "個別加速" : "全体速度";
        return `<div class="list-item" data-speed-id="${escapeHtml(speed.id)}">
          <span class="swatch" style="background:${speed.type === "boost" ? "#169b62" : "#ef8a23"}"></span>
          <div>
            <div class="main">frame ${formatNumber(speed.frame, 1)} · ${formatNumber(speed.value, 2)}x</div>
            <div class="sub">${label} · ${formatSeconds(secondsForFrame(speed.frame))}</div>
          </div>
          <div class="item-actions">
            <button class="mini-btn" data-delete-speed="${escapeHtml(speed.id)}" title="削除">×</button>
          </div>
        </div>`;
      })
      .join("");
  }

  renderWarnings() {
    const r = this.refs;
    const warnings = this.app.validate();
    const problems = warnings.filter((w) => w.level !== "ok");
    r["warning-count"].textContent = String(problems.length);
    r["warning-count"].classList.toggle("accent", problems.length === 0);
    r["warning-list"].innerHTML = warnings
      .map((warning) => {
        const ringAttr = warning.ringId ? ` data-warning-ring="${escapeHtml(warning.ringId)}"` : "";
        const lnAttr = warning.lnId ? ` data-warning-ln="${escapeHtml(warning.lnId)}"` : "";
        const cursor = warning.ringId || warning.lnId ? ' style="cursor:pointer"' : "";
        return `<div class="warning-item ${warning.level}"${ringAttr}${lnAttr}${cursor}>${escapeHtml(warning.message)}</div>`;
      })
      .join("");
  }

  renderStatus() {
    const r = this.refs;
    const app = this.app;
    const frame = app.currentFrame;
    const block = Math.floor(app.ui.position / 48) + 1;
    const sub = app.ui.position - (block - 1) * 48;
    r["edit-status"].textContent =
      `Page ${app.ui.page} / Block ${block} + ${formatNumber(sub, 2)} / frame ${formatNumber(frame, 2)} / ${formatSeconds(secondsForFrame(frame))}`;
    const normalNotes = app.project.referenceNoteFrames?.length ?? 0;
    const ringNotes = allProjectRings(app.project).length;
    r["note-count"].textContent = `通常 ${normalNotes} / リング ${ringNotes} / 合計 ${normalNotes + ringNotes}`;
    this.fitCanvas();
  }

  renderTimelineToolbar() {
    const r = this.refs;
    const app = this.app;
    r["btn-timeline-reverse"].textContent = app.settings.timelineReverse ? "↑ 下から上" : "↓ 上から下";
    r["btn-timeline-reverse"].classList.toggle("btn-primary", app.settings.timelineReverse);
    this.setValue(r["block-height"], app.settings.blockHeight);
  }

  renderPlayControls() {
    const r = this.refs;
    const app = this.app;
    const playing = Boolean(app.mainPlayback?.running);
    r["btn-main-play"].textContent = playing ? "■ 停止" : "▶ ループ再生";
    r["btn-main-play"].classList.toggle("btn-primary", !playing);
    r["btn-main-play"].classList.toggle("btn-stop", playing);
    if (!playing) {
      r["play-status"].textContent = "停止中";
      r["play-status"].classList.remove("playing");
    }
  }

  updatePlayStatus(frame, info, playing = true) {
    const r = this.refs;
    if (frame === null || frame === undefined) {
      r["play-status"].textContent = "停止中";
      r["play-status"].classList.remove("playing");
      return;
    }
    r["play-status"].textContent = playing ? `再生中 ${formatSeconds(secondsForFrame(frame))}` : `停止中 ${formatSeconds(secondsForFrame(frame))}`;
    r["play-status"].classList.toggle("playing", playing);
  }

  setPlaying(playing) {
    const r = this.refs;
    r["btn-main-play"].textContent = playing ? "■ 停止" : "▶ ループ再生";
    r["btn-main-play"].classList.toggle("btn-primary", !playing);
    r["btn-main-play"].classList.toggle("btn-stop", playing);
  }

  applyCanvasFit() {
    const app = this.app;
    const scroller = this.refs["canvas-scroll"];
    const canvas = this.refs.canvas;
    if (!scroller || !canvas) return;
    const style = window.getComputedStyle(scroller);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const available = Math.max(80, scroller.clientWidth - padX);
    const screen = app.project.screen;
    const scale = Math.min(1, available / Math.max(1, screen.width));
    const width = Math.max(80, Math.round(screen.width * scale));
    const height = Math.max(1, Math.round((width / Math.max(1, screen.width)) * screen.height));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.aspectRatio = `${screen.width} / ${screen.height}`;
  }

  fitCanvas() {
    if (this._fitFrame) return;
    this._fitFrame = requestAnimationFrame(() => {
      this._fitFrame = 0;
      this.applyCanvasFit();
    });
  }

  observeCanvas() {
    const scroller = this.refs["canvas-scroll"];
    if (!scroller) return;
    if (typeof ResizeObserver !== "undefined") {
      this.canvasResizeObserver = new ResizeObserver(() => this.fitCanvas());
      this.canvasResizeObserver.observe(scroller);
    }
    window.addEventListener("resize", () => this.fitCanvas());
  }

  syncFromSettings() {
    const app = this.app;
    const r = this.refs;
    r["music-badge"].textContent = app.audio.hasMusic() ? app.audio.musicName : "未読込";
    r["music-volume-value"].textContent = `${Math.round(app.settings.musicVolume * 100)}%`;
    r["music-rate-value"].textContent = `${app.settings.musicRate.toFixed(2)}x`;
    r["music-offset-value"].textContent = formatFrameOffset(app.settings.musicOffset);
  }

  setValue(element, value) {
    if (!element) return;
    if (!this.forceInputSync && document.activeElement === element) return;
    if (String(element.value) !== String(value)) element.value = value;
  }

  toast(message, type = "info") {
    const stack = this.refs["toast-stack"];
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    stack.appendChild(el);
    while (stack.children.length > 4) stack.firstElementChild.remove();
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transform = "translateY(4px)";
      el.style.transition = "0.18s";
      setTimeout(() => el.remove(), 200);
    }, 3200);
  }
}
