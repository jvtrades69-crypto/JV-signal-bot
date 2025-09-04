// CJS/ESM-safe import style for fs-extra
import fs from 'fs-extra';
const { readJson, writeJson, pathExists } = fs;

const DB_PATH = './signals.json';

async function ensureDb() {
  if (!(await pathExists(DB_PATH))) {
    await writeJson(
      DB_PATH,
      {
        signals: [],
        summaryMessageId: null,
        ownerPanels: {}     // { [signalId]: messageId } (kept for future use)
      },
      { spaces: 2 }
    );
  }
}

async function loadDb() {
  await ensureDb();
  return readJson(DB_PATH);
}

async function saveDb(db) {
  await writeJson(DB_PATH, db, { spaces: 2 });
}

// ---------- Signals CRUD ----------
export async function saveSignal(signal) {
  const db = await loadDb();
  db.signals = [{ ...signal }, ...db.signals.filter(s => s.id !== signal.id)];
  await saveDb(db);
}

export async function getSignals() {
  const db = await loadDb();
  return db.signals;
}

export async function getSignal(id) {
  const db = await loadDb();
  return db.signals.find(s => s.id === id) || null;
}

export async function updateSignal(id, patch) {
  const db = await loadDb();
  db.signals = db.signals.map(s => (s.id === id ? { ...s, ...patch } : s));
  await saveDb(db);
}

export async function deleteSignal(id) {
  const db = await loadDb();
  db.signals = db.signals.filter(s => s.id !== id);
  delete db.ownerPanels?.[id];
  await saveDb(db);
}

export async function listActive() {
  const db = await loadDb();
  return db.signals.filter(s => s.status === 'RUN_VALID' || s.status === 'RUN_BE');
}

// ---------- Summary message tracking ----------
export async function getSummaryMessageId() {
  const db = await loadDb();
  return db.summaryMessageId || null;
}

export async function setSummaryMessageId(id) {
  const db = await loadDb();
  db.summaryMessageId = id;
  await saveDb(db);
}

// ---------- Owner panel message tracking (placeholder, not strictly required now) ----------
export async function getOwnerPanelMessageId(signalId) {
  const db = await loadDb();
  return (db.ownerPanels && db.ownerPanels[signalId]) || null;
}

export async function setOwnerPanelMessageId(signalId, messageId) {
  const db = await loadDb();
  db.ownerPanels = db.ownerPanels || {};
  db.ownerPanels[signalId] = messageId;
  await saveDb(db);
}
