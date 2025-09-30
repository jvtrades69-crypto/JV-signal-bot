// store.js — STRICT DB_PATH version (production-safe) + soft-delete trash
//
// REQUIREMENTS:
//   - Set DB_PATH=/data/signals.json (or another absolute path on your persistent disk)
//   - Ensure the directory exists or is creatable by the process
//
// Behavior:
//   - If DB_PATH is missing or unwritable -> throws at startup
//   - deleteSignal(id) moves the signal to db.deleted (with deletedAt)
//   - getDeletedSignals() lists soft-deleted signals
//   - restoreDeletedSignal(id) moves it back to db.signals
//   - thread links are cleared on delete; restored threads must be recreated

import fs from 'fs-extra';
const { readJson, writeJson, pathExists, ensureDir } = fs;

const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) {
  throw new Error(
    'DB_PATH environment variable is not set. ' +
    'Set DB_PATH=/data/signals.json (with a Persistent Disk mounted at /data).'
  );
}
const DB_DIR = DB_PATH.includes('/') ? DB_PATH.slice(0, DB_PATH.lastIndexOf('/')) : '.';

async function ensureDb() {
  await ensureDir(DB_DIR);

  if (!(await pathExists(DB_PATH))) {
    await writeJson(
      DB_PATH,
      {
        signals: [],
        deleted: [],            // <- soft-deleted signals live here
        summaryMessageId: null,
        threads: {},
        webhooks: {},
      },
      { spaces: 2 }
    );
  } else {
    // Validate + soft-migrate
    try {
      const d = await readJson(DB_PATH);
      if (typeof d !== 'object' || d === null) throw new Error('Invalid DB JSON');
      if (!Array.isArray(d.signals)) d.signals = [];
      if (!('deleted' in d) || !Array.isArray(d.deleted)) d.deleted = [];
      if (!('summaryMessageId' in d)) d.summaryMessageId = null;
      if (!d.threads || typeof d.threads !== 'object') d.threads = {};
      if (!d.webhooks || typeof d.webhooks !== 'object') d.webhooks = {};
      await writeJson(DB_PATH, d, { spaces: 2 });
    } catch (e) {
      throw new Error(`DB_PATH exists but is invalid/unreadable: ${e.message}`);
    }
  }
}

async function loadDb() {
  await ensureDb();
  return readJson(DB_PATH);
}
async function saveDb(db) {
  await ensureDb();
  await writeJson(DB_PATH, db, { spaces: 2 });
}

// ---------- Signals CRUD ----------
export async function saveSignal(signal) {
  const db = await loadDb();
  // Remove from trash if present
  db.deleted = (db.deleted || []).filter(x => x?.signal?.id !== signal.id);
  // Upsert into signals
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
  let found = false;
  db.signals = db.signals.map(s => {
    if (s.id === id) {
      found = true;
      return { ...s, ...patch };
    }
    return s;
  });
  if (!found) throw new Error(`Signal ${id} not found`);
  await saveDb(db);
}

/**
 * Soft-delete: move the signal to db.deleted with a timestamp.
 * Also clear any stored thread link for that signal.
 */
export async function deleteSignal(id) {
  const db = await loadDb();

  const idx = db.signals.findIndex(s => s.id === id);
  if (idx !== -1) {
    const [removed] = db.signals.splice(idx, 1);
    db.deleted = db.deleted || [];
    db.deleted.unshift({
      deletedAt: new Date().toISOString(),
      signal: removed,
    });
  } else {
    // Ensure not duplicated in trash if called twice
    db.deleted = (db.deleted || []).filter(x => x?.signal?.id !== id);
  }

  if (db.threads && db.threads[id]) delete db.threads[id];
  await saveDb(db);
}

// ---------- Summary tracking ----------
export async function getSummaryMessageId() {
  const db = await loadDb();
  return db.summaryMessageId || null;
}
export async function setSummaryMessageId(id) {
  const db = await loadDb();
  db.summaryMessageId = id;
  await saveDb(db);
}

// ---------- Thread tracking ----------
export async function getThreadId(signalId) {
  const db = await loadDb();
  return db.threads?.[signalId] || null;
}
export async function setThreadId(signalId, threadId) {
  const db = await loadDb();
  db.threads = db.threads || {};
  db.threads[signalId] = threadId;
  await saveDb(db);
}

// ---------- Trash / Restore ----------
/**
 * Return the soft-deleted signals (most recent first).
 * Shape: Array<Signal>
 */
export async function getDeletedSignals() {
  const db = await loadDb();
  const arr = Array.isArray(db.deleted) ? db.deleted : [];
  // keep most recent first; map to plain signals
  return arr.map(x => x.signal).filter(Boolean);
}

/**
 * Restore a soft-deleted signal by id.
 * Moves it back to db.signals. Does NOT restore threadId.
 * Returns the restored signal, or null if not found.
 */
export async function restoreDeletedSignal(id) {
  const db = await loadDb();
  const arr = Array.isArray(db.deleted) ? db.deleted : [];
  const idx = arr.findIndex(x => x?.signal?.id === id);
  if (idx === -1) return null;

  const restored = { ...arr[idx].signal };
  // Remove from trash
  arr.splice(idx, 1);
  db.deleted = arr;

  // Upsert into active signals (front)
  db.signals = [{ ...restored }, ...db.signals.filter(s => s.id !== restored.id)];

  // Ensure old thread link is cleared; thread must be recreated
  if (db.threads && db.threads[restored.id]) delete db.threads[restored.id];

  await saveDb(db);
  return restored;
}