import { readJSON, writeJSON, pathExists } from "fs-extra";

const DB_PATH = "./signals.json";

async function load() {
  if (!(await pathExists(DB_PATH))) {
    const init = { signals: [], summaryMessageId: null, webhooks: {} };
    await writeJSON(DB_PATH, init, { spaces: 2 });
    return init;
  }
  return readJSON(DB_PATH);
}
async function save(data) {
  await writeJSON(DB_PATH, data, { spaces: 2 });
}

/* Signals */
export async function saveSignal(signal) {
  const db = await load();
  db.signals.push(signal);
  await save(db);
  return signal;
}
export async function getSignals() {
  const db = await load();
  return db.signals;
}
export async function getSignal(id) {
  const db = await load();
  return db.signals.find(s => s.id === id) || null;
}
export async function updateSignal(id, patch) {
  const db = await load();
  const i = db.signals.findIndex(s => s.id === id);
  if (i === -1) return null;
  db.signals[i] = { ...db.signals[i], ...patch };
  await save(db);
  return db.signals[i];
}
export async function deleteSignal(id) {
  const db = await load();
  db.signals = db.signals.filter(s => s.id !== id);
  await save(db);
}

/* Summary message */
export async function getSummaryMessageId() {
  const db = await load();
  return db.summaryMessageId || null;
}
export async function setSummaryMessageId(id) {
  const db = await load();
  db.summaryMessageId = id;
  await save(db);
}

/* Webhook cache (id+token) per channel */
export async function getWebhook(channelId) {
  const db = await load();
  return db.webhooks[channelId] || null;
}
export async function setWebhook(channelId, webhook) {
  const db = await load();
  db.webhooks[channelId] = webhook; // { id, token }
  await save(db);
}
