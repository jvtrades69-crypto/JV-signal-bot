// store.js
// Persistent storage for signals + helper IDs.
// Uses ./signals.json on disk. Designed to be tolerant of old shapes.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "signals.json");

// --- internal helpers -------------------------------------------------------

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const seed = { signals: [], summaryMessageId: null, ownerPanels: {} };
      fs.writeFileSync(DB_PATH, JSON.stringify(seed, null, 2));
      return seed;
    }
    const raw = fs.readFileSync(DB_PATH, "utf8").trim();
    if (!raw) return { signals: [], summaryMessageId: null, ownerPanels: {} };

    const data = JSON.parse(raw);

    // Backward/forwards compatible shape guard
    if (!Array.isArray(data.signals)) data.signals = [];
    if (typeof data.summaryMessageId === "undefined") data.summaryMessageId = null;
    if (!data.ownerPanels || typeof data.ownerPanels !== "object") data.ownerPanels = {};

    return data;
  } catch (e) {
    console.error("[store] loadDB error:", e);
    // Fail safe in memory only
    return { signals: [], summaryMessageId: null, ownerPanels: {} };
  }
}

function saveDB(db) {
  try {
    const tmp = DB_PATH + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_PATH);
  } catch (e) {
    console.error("[store] saveDB error:", e);
  }
}

// --- public API --------------------------------------------------------------

/**
 * Save a brand-new signal object. The object MUST include a unique id (string).
 * If an item with that id exists, we replace it.
 */
function saveSignal(signal) {
  const db = loadDB();
  const idx = db.signals.findIndex((s) => s.id === signal.id);
  if (idx >= 0) {
    db.signals[idx] = { ...db.signals[idx], ...signal };
  } else {
    db.signals.push(signal);
  }
  saveDB(db);
  return signal;
}

/**
 * Partial update (merge) by id. Returns the updated signal or null.
 */
function updateSignal(id, patch) {
  const db = loadDB();
  const idx = db.signals.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  db.signals[idx] = { ...db.signals[idx], ...patch };
  saveDB(db);
  return db.signals[idx];
}

/**
 * Get a single signal by id.
 */
function getSignal(id) {
  const db = loadDB();
  return db.signals.find((s) => s.id === id) || null;
}

/**
 * Delete by id. Returns true if deleted.
 */
function deleteSignal(id) {
  const db = loadDB();
  const before = db.signals.length;
  db.signals = db.signals.filter((s) => s.id !== id);
  // Also clear any owner panel id we tracked for this signal
  if (db.ownerPanels && db.ownerPanels[id]) {
    delete db.ownerPanels[id];
  }
  saveDB(db);
  return db.signals.length < before;
}

/**
 * List only signals that are currently ACTIVE and VALID FOR RE-ENTRY.
 * This matches how you wanted the “Current Active Trades” to be built.
 * (If your index uses different field names, just tweak the checks here.)
 */
function listActive() {
  const db = loadDB();
  return db.signals.filter((s) => {
    // tolerant checks – treat undefined as falsy
    const isActive = !!(s.active ?? s.isActive ?? s.status === "active");
    const validForReentry = !!(s.validForReentry ?? s.valid ?? s.reentryValid);
    return isActive && validForReentry;
  });
}

/**
 * Summary message id helpers (for the single “Current Active Trades” message).
 */
function getSummaryMessageId() {
  const db = loadDB();
  return db.summaryMessageId || null;
}
function setSummaryMessageId(messageId) {
  const db = loadDB();
  db.summaryMessageId = messageId || null;
  saveDB(db);
}

/**
 * Owner control panel message id (private thread) – one per signal.
 */
function getOwnerPanelMessageId(signalId) {
  const db = loadDB();
  return (db.ownerPanels && db.ownerPanels[signalId]) || null;
}
function setOwnerPanelMessageId(signalId, messageId) {
  const db = loadDB();
  if (!db.ownerPanels || typeof db.ownerPanels !== "object") db.ownerPanels = {};
  if (messageId) db.ownerPanels[signalId] = messageId;
  else delete db.ownerPanels[signalId];
  saveDB(db);
}

module.exports = {
  saveSignal,
  updateSignal,
  getSignal,
  deleteSignal,
  listActive,
  getSummaryMessageId,
  setSummaryMessageId,
  getOwnerPanelMessageId,
  setOwnerPanelMessageId,
};
