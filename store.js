// store.js  — local JSON “DB” for trades + a couple message IDs
import { readFile, writeFile } from 'fs/promises';

const DB_URL = new URL('./signals.json', import.meta.url);

async function load() {
  try {
    const raw = await readFile(DB_URL, 'utf8');
    const data = JSON.parse(raw);
    // backfill structure if older file exists
    return {
      signals: Array.isArray(data.signals) ? data.signals : [],
      summaryMessageId: data.summaryMessageId ?? null,
    };
  } catch {
    return { signals: [], summaryMessageId: null };
  }
}

async function save(db) {
  await writeFile(DB_URL, JSON.stringify(db, null, 2), 'utf8');
}

// ---------- CRUD: signals ----------
export async function saveSignal(signal) {
  const db = await load();
  // Required minimal shape (index.js can add more fields before calling)
  const now = new Date().toISOString();
  const s = {
    id: signal.id, // you generate outside (e.g., uuid)
    asset: signal.asset, // 'BTC', 'ETH', ...
    direction: signal.direction, // 'Long' | 'Short'
    entry: signal.entry ?? null,
    stop: signal.stop ?? null,
    tp1: signal.tp1 ?? null,
    tp2: signal.tp2 ?? null,
    tp3: signal.tp3 ?? null,
    reason: signal.reason ?? '',
    status: signal.status ?? 'running', // 'running' | 'be' | 'stopped' | 'tp1' | 'tp2' | 'tp3'
    validReentry: signal.validReentry ?? true,
    active: signal.active ?? true, // true until fully stopped/closed
    messageId: signal.messageId ?? null,
    channelId: signal.channelId ?? null,
    ownerPanelMessageId: signal.ownerPanelMessageId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  db.signals.push(s);
  await save(db);
  return s;
}

export async function getSignal(id) {
  const db = await load();
  return db.signals.find(s => s.id === id) ?? null;
}

export async function updateSignal(id, patch) {
  const db = await load();
  const idx = db.signals.findIndex(s => s.id === id);
  if (idx === -1) return null;
  db.signals[idx] = {
    ...db.signals[idx],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await save(db);
  return db.signals[idx];
}

export async function deleteSignal(id) {
  const db = await load();
  const before = db.signals.length;
  db.signals = db.signals.filter(s => s.id !== id);
  await save(db);
  return db.signals.length !== before;
}

/**
 * Return only *valid & active* trades for the “Current Active Trades” list.
 * We treat 'stopped' as inactive. Everything else that has active=true remains.
 */
export async function listActive() {
  const db = await load();
  return db.signals.filter(s => s.active && s.status !== 'stopped');
}

// ---------- Summary message ID (Current Active Trades single message) ----------
export async function getSummaryMessageId() {
  const db = await load();
  return db.summaryMessageId ?? null;
}

export async function setSummaryMessageId(messageId) {
  const db = await load();
  db.summaryMessageId = messageId;
  await save(db);
  return messageId;
}

// ---------- Owner panel message ID per signal ----------
export async function getOwnerPanelMessageId(signalId) {
  const s = await getSignal(signalId);
  return s?.ownerPanelMessageId ?? null;
}

export async function setOwnerPanelMessageId(signalId, messageId) {
  const updated = await updateSignal(signalId, { ownerPanelMessageId: messageId });
  return updated?.ownerPanelMessageId ?? null;
}
