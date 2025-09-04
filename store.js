import { readJSON, writeJSON, pathExists } from "fs-extra";

const DB_PATH = "./signals.json";

async function load() {
  if (!(await pathExists(DB_PATH))) {
    await writeJSON(DB_PATH, { signals: [], summaryMessageId: null }, { spaces: 2 });
  }
  return readJSON(DB_PATH);
}

async function save(db) {
  await writeJSON(DB_PATH, db, { spaces: 2 });
}

export async function saveSignal(signal) {
  const db = await load();
  db.signals = db.signals.filter((s) => s.id !== signal.id);
  db.signals.push(signal);
  await save(db);
}

export async function listActive() {
  const db = await load();
  return db.signals.filter((s) => /active/i.test(s.status || ""));
}

export async function setSummaryMessageId(id) {
  const db = await load();
  db.summaryMessageId = id;
  await save(db);
}

export async function getSummaryMessageId() {
  const db = await load();
  return db.summaryMessageId || null;
}