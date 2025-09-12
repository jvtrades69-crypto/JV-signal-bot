// store.js — STRICT DB_PATH version (production-safe)
//
// REQUIREMENTS:
//   - Set DB_PATH=/data/signals.json (or another absolute path on your persistent disk)
//   - Ensure the directory exists or is creatable by the process
//
// Behavior:
//   - If DB_PATH is missing or unwritable -> throws at startup (so you don't run without persistence)

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
        recaps: [], // 👈 new: recap storage
        summaryMessageId: null,
        threads: {},
        webhooks: {},
      },
      { spaces: 2 }
    );
  } else {
    try {
      const d = await readJson(DB_PATH);
      if (typeof d !== 'object' || d === null) throw new Error('Invalid DB JSON');
      if (!Array.isArray(d.signals)) d.signals = [];
      if (!Array.isArray(d.recaps)) d.recaps = []; // 👈 ensure recaps exists
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
export async function deleteSignal(id) {
  const db = await loadDb();
  db.signals = db.signals.filter(s => s.id !== id);
  delete db.threads?.[id];
  await saveDb(db);
}

// ---------- Recaps CRUD ----------
export async function saveRecap(recap) {
  const db = await loadDb();
  db.recaps = [{ ...recap }, ...db.recaps.filter(r => r.id !== recap.id)];
  await saveDb(db);
}
export async function getRecaps() {
  const db = await loadDb();
  return db.recaps;
}
export async function getRecap(id) {
  const db = await loadDb();
  return db.recaps.find(r => r.id === id) || null;
}
export async function updateRecap(id, patch) {
  const db = await loadDb();
  let found = false;
  db.recaps = db.recaps.map(r => {
    if (r.id === id) {
      found = true;
      return { ...r, ...patch };
    }
    return r;
  });
  if (!found) throw new Error(`Recap ${id} not found`);
  await saveDb(db);
}
export async function deleteRecap(id) {
  const db = await loadDb();
  db.recaps = db.recaps.filter(r => r.id !== id);
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