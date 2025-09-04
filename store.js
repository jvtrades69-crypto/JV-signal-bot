import { readJson, writeJson, pathExists } from 'fs-extra';

const DB_PATH = './signals.json';

async function loadDb() {
  if (!(await pathExists(DB_PATH))) {
    await writeJson(
      DB_PATH,
      {
        signals: [],
        summaryMessageId: null,
        ownerPanels: {},     // { [signalId]: messageId }
        webhooks: {}         // { [channelId]: { id, token } }
      },
      { spaces: 2 }
    );
  }
  return readJson(DB_PATH);
}

async function saveDb(db) {
  await writeJson(DB_PATH, db, { spaces: 2 });
}

// ---------- Signals CRUD ----------
export async function saveSignal(signal) {
  const db = await loadDb();
  // put newest first
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
  // also clear owner panel mapping
  delete db.ownerPanels?.[id];
  await saveDb(db);
}

// Only those considered valid/active for the summary
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

// ---------- Owner panel message tracking ----------
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

// ---------- Webhook tokens per-channel (for editing webhook messages) ----------
export async function getStoredWebhook(channelId) {
  const db = await loadDb();
  return db.webhooks?.[channelId] || null;
}

export async function setStoredWebhook(channelId, data /* { id, token } */) {
  const db = await loadDb();
  db.webhooks = db.webhooks || {};
  db.webhooks[channelId] = { id: data.id, token: data.token };
  await saveDb(db);
}