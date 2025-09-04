// store.js (ESM) — tiny JSON “DB”
import fse from 'fs-extra';
import { join } from 'node:path';

const DB_PATH = join(process.cwd(), 'signals.json');

async function load() {
  const exists = await fse.pathExists(DB_PATH);
  if (!exists) {
    return { trades: [], summaryMessageId: null };
  }
  return fse.readJson(DB_PATH);
}

async function save(db) {
  await fse.writeJson(DB_PATH, db, { spaces: 2 });
}

export async function saveSignal(signal) {
  const db = await load();
  // if this trade already exists (by messageId), update; else push
  const idx = db.trades.findIndex((t) => t.messageId === signal.messageId);
  if (idx >= 0) db.trades[idx] = signal;
  else db.trades.push(signal);
  await save(db);
  return signal;
}

export async function updateSignal(id, patch) {
  const db = await load();
  const idx = db.trades.findIndex((t) => t.messageId === id || t.id === id);
  if (idx === -1) return null;
  db.trades[idx] = { ...db.trades[idx], ...patch };
  await save(db);
  return db.trades[idx];
}

export async function deleteSignal(id) {
  const db = await load();
  db.trades = db.trades.filter((t) => t.messageId !== id && t.id !== id);
  await save(db);
}

export async function getSignal(id) {
  const db = await load();
  return db.trades.find((t) => t.messageId === id || t.id === id) || null;
}

export async function listActive() {
  const db = await load();
  // active means not deleted and status !== 'stopped'
  return db.trades.filter((t) => !t.deleted && (t.status ?? 'running') !== 'stopped');
}

export async function getSummaryMessageId() {
  const db = await load();
  return db.summaryMessageId || null;
}

export async function setSummaryMessageId(messageId) {
  const db = await load();
  db.summaryMessageId = messageId;
  await save(db);
}
