// store.js — persistent JSON store with soft-deleted archive
//
// REQUIRED ENV:
//   DB_PATH=/data/signals.json   (or another absolute path on a persistent disk)
//
// On first run, a minimal DB is created. The "deleted" array keeps snapshots
// of signals whose Discord message was manually deleted, so they can be restored.

import fs from 'fs-extra';
const { readJson, writeJson, pathExists, ensureDir } = fs;

const DB_PATH = process.env.DB_PATH;
if (!DB_PATH) {
  throw new Error(
    'DB_PATH environment variable is not set. ' +
    'Set DB_PATH=/data/signals.json (with a persistent disk mounted at /data).'
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
        summaryMessageId: null,
        threads: {},
        webhooks: {},
        deleted: [], // soft-deleted signals archive
      },
      { spaces: 2 }
    );
  } else {
    const d = await readJson(DB_PATH);
    if (typeof d !== 'object' || d === null) {
      throw new Error('DB_PATH exists but is not valid JSON.');
    }
    if (!Array.isArray(d.signals)) d.signals = [];
    if (!('summaryMessageId' in d)) d.summaryMessageId = null;
    if (!d.threads || typeof d.threads !== 'object') d.threads = {};
    if (!d.webhooks || typeof d.webhooks !== 'object') d.webhooks = {};
    if (!Array.isArray(d.deleted)) d.deleted = [];
    await writeJson(DB_PATH, d, { spaces: 2 });
  }
}
async function loadDb() { await ensureDb(); return readJson(DB_PATH); }
async function saveDb(db) { await ensureDb(); await writeJson(DB_PATH, db, { spaces: 2 }); }

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
  let found = false;
  db.signals = db.signals.map(s => {
    if (s.id === id) { found = true; return { ...s, ...patch }; }
    return s;
  });
  if (!found) throw new Error(`Signal ${id} not found`);
  await saveDb(db);
}
export async function deleteSignal(id) {
  const db = await loadDb();
  db.signals = db.signals.filter(s => s.id !== id);
  delete db.threads?.[id];
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

// ---------- Soft-deleted snapshots ----------
export async function saveDeletedSnapshot(signal) {
  const db = await loadDb();
  db.deleted = [{ ...signal, _deletedAt: Date.now() }, ...(db.deleted || [])].slice(0, 200);
  await saveDb(db);
}
export async function listDeleted() {
  const db = await loadDb();
  return db.deleted || [];
}
export async function getDeleted(id) {
  const db = await loadDb();
  return (db.deleted || []).find(s => s.id === id) || null;
}
export async function removeDeleted(id) {
  const db = await loadDb();
  db.deleted = (db.deleted || []).filter(s => s.id !== id);
  await saveDb(db);
}
