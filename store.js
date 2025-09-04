// Simple JSON file store for signals + message/webhook bookkeeping.
import { readFile, writeFile, access } from 'fs/promises';
import { constants as fsConst } from 'fs';

const DB_PATH = './signals.json';

async function ensureDb() {
  try {
    await access(DB_PATH, fsConst.F_OK);
  } catch {
    const empty = {
      signals: [],
      summaryMessageId: null,
      webhooks: {} // channelId -> { id, token }
    };
    await writeFile(DB_PATH, JSON.stringify(empty, null, 2), 'utf8');
  }
}

async function load() {
  await ensureDb();
  const raw = await readFile(DB_PATH, 'utf8');
  return JSON.parse(raw);
}

async function save(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

/** SIGNAL CRUD **/

export async function saveSignal(signal) {
  const db = await load();
  db.signals.push(signal);
  await save(db);
  return signal;
}

export async function getSignal(id) {
  const db = await load();
  return db.signals.find(s => s.id === id) || null;
}

export async function updateSignal(id, patch) {
  const db = await load();
  const idx = db.signals.findIndex(s => s.id === id);
  if (idx === -1) return null;
  db.signals[idx] = { ...db.signals[idx], ...patch };
  await save(db);
  return db.signals[idx];
}

export async function deleteSignal(id) {
  const db = await load();
  const idx = db.signals.findIndex(s => s.id === id);
  if (idx === -1) return false;
  db.signals.splice(idx, 1);
  await save(db);
  return true;
}

export async function listActive() {
  const db = await load();
  // Active = running (valid or BE)
  return db.signals.filter(s => s.status === 'RUN_VALID' || s.status === 'RUN_BE');
}

/** SUMMARY MESSAGE ID **/

export async function getSummaryMessageId() {
  const db = await load();
  return db.summaryMessageId || null;
}
export async function setSummaryMessageId(messageId) {
  const db = await load();
  db.summaryMessageId = messageId;
  await save(db);
  return messageId;
}

/** WEBHOOK CACHE PER CHANNEL **/

export async function getChannelWebhook(channelId) {
  const db = await load();
  return db.webhooks[channelId] || null;
}
export async function setChannelWebhook(channelId, data /* {id, token} */) {
  const db = await load();
  db.webhooks[channelId] = data;
  await save(db);
  return data;
}
