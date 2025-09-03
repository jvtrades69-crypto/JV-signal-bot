// Simple JSON-backed store (./signals.json and ./state.json)
const fs = require("fs");
const path = require("path");

const SIGNALS_PATH = path.join(__dirname, "signals.json");
const STATE_PATH   = path.join(__dirname, "state.json");

function readJSON(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJSON(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function loadSignals() {
  const data = readJSON(SIGNALS_PATH, []);
  if (!Array.isArray(data)) return [];
  return data;
}
function saveSignals(list) {
  writeJSON(SIGNALS_PATH, list);
}

function loadState() {
  return readJSON(STATE_PATH, { summaryMessageId: null });
}
function saveState(state) {
  writeJSON(STATE_PATH, state);
}

module.exports = {
  saveSignal(signal) {
    const all = loadSignals();
    all.push(signal);
    saveSignals(all);
  },
  getSignal(id) {
    return loadSignals().find((s) => s.id === id);
  },
  updateSignal(id, patch) {
    const all = loadSignals();
    const i = all.findIndex((s) => s.id === id);
    if (i === -1) return;
    all[i] = { ...all[i], ...patch };
    saveSignals(all);
  },
  deleteSignal(id) {
    const all = loadSignals().filter((s) => s.id !== id);
    saveSignals(all);
  },
  listActive() {
    const all = loadSignals();
    // Valid for re-entry & active only
    return all.filter((s) => s.active !== false && s.validForReentry !== false);
  },
  getSummaryMessageId() {
    return loadState().summaryMessageId || null;
  },
  setSummaryMessageId(messageId) {
    const st = loadState();
    st.summaryMessageId = messageId;
    saveState(st);
  },
};
