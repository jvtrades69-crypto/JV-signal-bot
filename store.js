// store.js — Robust JSON store with automatic writable-path fallback
//
// Priority order for the DB file:
// 1) process.env.DB_PATH        (if provided)
// 2) /data/signals.json         (Render Persistent Disk, if mounted)
// 3) ./signals.json             (app working directory)
// 4) /tmp/jv-signals.json       (ephemeral but always writable)
//
// You can still set DB_PATH=/data/jv-signals.json later when you add a disk.

import fs from 'fs-extra';
const { readJson, writeJson, pathExists, ensureDir } = fs;

const CANDIDATES = [
  process.env.DB_PATH || null,         // explicit override
  '/data/signals.json',                // preferred (persistent disk)
  './signals.json',                    // local file
  '/tmp/jv-signals.json'               // always writable fallback
].filter(Boolean);

let DB_PATH = null;
let DB_DIR  = null;
let resolved = false;

async function isWritable(filePath) {
  try {
    const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.';
    await ensureDir(dir);
    // try a tiny write or create if missing
    if (!(await pathExists(filePath))) {
      await writeJson(filePath, { __probe: true }, { spaces: 0 });
    } else {
      const data = await readJson(filePath).catch(() => ({}));
      await writeJson(filePath, { ...data, __probe: true }, { spaces: 0 });
    }
    return true;
  } catch {
    return false;
  }
}

async function resolvePath() {
  if (resolved) return;
  for (const p of CANDIDATES) {
    if (await isWritable(p)) {
      DB_PATH = p;
      DB_DIR  = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.';
      resolved = true;
      break;
    }
  }
  if (!resolved) {
    // last-ditch: fallback to /tmp
    DB_PATH = '/tmp/jv-signals.json';
    DB_DIR  = '/tmp';
    await ensureDir(DB_DIR);
  }
}

async function ensureDb() {
  await resolvePath();
  if (!(await pathExists(DB_PATH))) {
    await writeJson(
      DB_PATH,
      {
        signals: [],
        summaryMessageId: null,
        ownerPanels: {},
        threads: {},
        webhooks: {}
      },
      { spaces: 2 }
    );
  } else {
    // strip probe key if present
    try {
      const d = await readJson(DB_PATH);
      if (d && d.__probe !== undefined) {
        delete d.__probe;
        await writeJson(DB_PATH, d, { spaces: 2 });
      }
    } catch { /* ignore */ }
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
  db.signals = db.signals.map(s => (s.id === id ? { ...s, ...patch } : s));
  await saveDb(db);
}
export async function deleteSignal(id) {
  const db = await loadDb();
  db.signals = db.signals.filter(s => s.id !== id);
  delete db.ownerPanels?.[id];
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

// ---------- Webhook storage ----------
export async function getStoredWebhook(channelId) {
  const db = await loadDb();
  return db.webhooks?.[channelId] || null;
}
export async function setStoredWebhook(channelId, data) {
  const db = await loadDb();
  db.webhooks = db.webhooks || {};
  db.webhooks[channelId] = { id: data.id, token: data.token };
  await saveDb(db);
}
