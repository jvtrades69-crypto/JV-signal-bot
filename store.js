// store.js (hardened)
// JSON persistence for signals + one summary message per channel,
// with automatic schema repair so .findIndex() etc. never blow up.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'signals.json');

// Ensure in-memory object has the right shape.
// If previous versions wrote a non-array, we coerce/migrate it.
function normalize(db) {
  const out = {};

  // signals → always an array of objects
  if (Array.isArray(db?.signals)) {
    out.signals = db.signals;
  } else if (db && typeof db.signals === 'object' && db.signals !== null) {
    // Some old builds saved an object keyed by id
    out.signals = Object.values(db.signals);
  } else {
    out.signals = [];
  }

  // summaryByChannel → always an object
  if (db && typeof db.summaryByChannel === 'object' && db.summaryByChannel !== null && !Array.isArray(db.summaryByChannel)) {
    out.summaryByChannel = db.summaryByChannel;
  } else {
    out.summaryByChannel = {};
  }

  return out;
}

function load() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      const fresh = { signals: [], summaryByChannel: {} };
      fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
      return fresh;
    }
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalize(parsed);
    // If normalization changed anything, persist the fixed file
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(normalized, null, 2));
    }
    return normalized;
  } catch (e) {
    // If the file is corrupted, back it up and reset
    try {
      fs.copyFileSync(DB_PATH, DB_PATH + '.bak');
    } catch {}
    const fresh = { signals: [], summaryByChannel: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

function save(db) {
  const normalized = normalize(db || {});
  fs.writeFileSync(DB_PATH, JSON.stringify(normalized, null, 2));
}

/* ----------------- Signal CRUD ----------------- */
function listAll() {
  const db = load();
  return db.signals;
}

function getSignal(id) {
  const db = load();
  return db.signals.find(s => s.id === id) || null;
}

function saveSignal(signal) {
  const db = load();
  const idx = db.signals.findIndex(s => s.id === signal.id);
  if (idx >= 0) db.signals[idx] = signal;
  else db.signals.push(signal);
  save(db);
  return signal;
}

function deleteSignal(id) {
  const db = load();
  db.signals = db.signals.filter(s => s.id !== id);
  save(db);
}

/* --------- Summary message per channel ---------- */
function getSummaryMessageId(channelId) {
  const db = load();
  return db.summaryByChannel[channelId] || null;
}

function setSummaryMessageId(channelId, messageId) {
  const db = load();
  db.summaryByChannel[channelId] = messageId;
  save(db);
}

module.exports = {
  listAll,
  getSignal,
  saveSignal,
  deleteSignal,
  getSummaryMessageId,
  setSummaryMessageId,
};
