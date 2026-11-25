import { App } from "./app.js";
import { UI } from "./ui.js";
import { RingCanvas } from "./canvas.js";
import { Timeline } from "./timeline.js";

function boot() {
  const app = new App();
  const ui = new UI(app);
  const canvas = new RingCanvas(app);
  const timeline = new Timeline(
    app,
    document.getElementById("timeline-scroll"),
    document.getElementById("timeline-content")
  );
  app.attach({ uiController: ui, canvasView: canvas, timelineView: timeline });
  window.ringEditor = app;
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
