import { readJson, writeJson, pathExists } from 'fs-extra';

const DB_PATH = './signals.json';

async function loadDb() {
  if (!(await pathExists(DB_PATH))) {
    await writeJson(DB_PATH, { signals: [], summaryMessageId: null }, { spaces: 2 });
  }
  return readJson(DB_PATH);
}

async function saveDb(db) {
  await writeJson(DB_PATH, db, { spaces: 2 });
}

// Create
export async function saveSignal(signal) {
  const db = await loadDb();
  db.signals.unshift(signal);
  await saveDb(db);
}

// Read
export async function getSignals() {
  const db = await loadDb();
  return db.signals;
}

// Update
export async function updateSignal(id, patch) {
  const db = await loadDb();
  db.signals = db.signals.map(s => (s.id === id ? { ...s, ...patch } : s));
  await saveDb(db);
}

// Delete
export async function deleteSignal(id) {
  const db = await loadDb();
  db.signals = db.signals.filter(s => s.id !== id);
  await saveDb(db);
}

// Summary message id helpers
export async function getSummaryMessageId() {
  const db = await loadDb();
  return db.summaryMessageId || null;
}

export async function setSummaryMessageId(id) {
  const db = await loadDb();
  db.summaryMessageId = id;
  await saveDb(db);
}