import fs from "fs-extra";

const DB_FILE = "./signals.json";

export function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeJsonSync(DB_FILE, { signals: [], summaryMessageId: null });
  }
  return fs.readJsonSync(DB_FILE);
}

export function saveDB(db) {
  fs.writeJsonSync(DB_FILE, db, { spaces: 2 });
}

export function saveSignal(signal) {
  const db = loadDB();
  db.signals.push(signal);
  saveDB(db);
}

export function getSignals() {
  return loadDB().signals;
}

export function updateSignal(id, updates) {
  const db = loadDB();
  const index = db.signals.findIndex(s => s.id === id);
  if (index >= 0) {
    db.signals[index] = { ...db.signals[index], ...updates };
    saveDB(db);
  }
}

export function deleteSignal(id) {
  const db = loadDB();
  db.signals = db.signals.filter(s => s.id !== id);
  saveDB(db);
}

export function setSummaryMessageId(id) {
  const db = loadDB();
  db.summaryMessageId = id;
  saveDB(db);
}

export function getSummaryMessageId() {
  return loadDB().summaryMessageId;
}
