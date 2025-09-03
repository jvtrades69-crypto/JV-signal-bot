// store.js
// Simple JSON persistence for signals + a per-channel summary message ID.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'signals.json');

function load() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify({ signals: [], summaryByChannel: {} }, null, 2));
    }
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { signals: [], summaryByChannel: {} };
  }
}

function save(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

/* ----------------- Signal CRUD ----------------- */
function listAll() {
  const db = load();
  return db.signals || [];
}

function getSignal(id) {
  const db = load();
  return (db.signals || []).find(s => s.id === id) || null;
}

function saveSignal(signal) {
  const db = load();
  const idx = (db.signals || []).findIndex(s => s.id === signal.id);
  if (idx >= 0) db.signals[idx] = signal;
  else db.signals.push(signal);
  save(db);
  return signal;
}

function deleteSignal(id) {
  const db = load();
  db.signals = (db.signals || []).filter(s => s.id !== id);
  save(db);
}

/* --------- Summary message per channel ---------- */
function getSummaryMessageId(channelId) {
  const db = load();
  return db.summaryByChannel?.[channelId] || null;
}

function setSummaryMessageId(channelId, messageId) {
  const db = load();
  db.summaryByChannel = db.summaryByChannel || {};
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
