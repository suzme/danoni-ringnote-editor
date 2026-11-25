const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".m4a",
  ".aac",
  ".flac",
  ".webm",
  ".weba",
]);

const CHART_EXTENSIONS = new Set([".txt", ".dos"]);

export function extensionOf(name) {
  const text = String(name ?? "").toLowerCase();
  const index = text.lastIndexOf(".");
  return index >= 0 ? text.slice(index) : "";
}

export function isAudioFile(file) {
  if (!file) return false;
  const type = String(file.type ?? "").toLowerCase();
  if (type.startsWith("audio/")) return true;
  return AUDIO_EXTENSIONS.has(extensionOf(file.name));
}

export function isJsonFile(file) {
  if (!file) return false;
  const type = String(file.type ?? "").toLowerCase();
  if (type === "application/json" || type.endsWith("+json")) return true;
  return extensionOf(file.name) === ".json";
}

export function isChartFile(file) {
  if (!file) return false;
  const type = String(file.type ?? "").toLowerCase();
  if (CHART_EXTENSIONS.has(extensionOf(file.name))) return true;
  return type === "text/plain";
}

export function classifyFile(file) {
  if (isAudioFile(file)) return "audio";
  if (isJsonFile(file)) return "project";
  if (isChartFile(file)) return "chart";
  return "unknown";
}

export function looksLikeChartText(text) {
  const value = String(text ?? "");
  if (!value.includes("|") || !value.includes("=")) return false;
  return /(ring_data|ring_speed_data|ring_boost_data|es_label|es_bpm|musicTitle|difData)/.test(value);
}
