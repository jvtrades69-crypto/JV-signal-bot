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
        ownerPanels: {},
        threads: {},
        webhooks: {}
      },
      { spaces: 2 }
    );
  }
}
async function loadDb() { await ensureDb(); return readJson(DB_PATH); }
async function saveDb(db) { await writeJson(DB_PATH, db, { spaces: 2 }); }

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