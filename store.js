import fs from "fs-extra";
import path from "path";

const { readJSON, writeJSON, pathExists } = fs;
const STORE_PATH = path.join(process.cwd(), "signals.json");

// Ensure signals.json exists
async function ensureStore() {
  if (!(await pathExists(STORE_PATH))) {
    await writeJSON(STORE_PATH, { signals: [], summaryMessageId: null }, { spaces: 2 });
  }
}

async function getStore() {
  await ensureStore();
  return await readJSON(STORE_PATH);
}

async function saveStore(store) {
  await writeJSON(STORE_PATH, store, { spaces: 2 });
}

// === PUBLIC API ===
export async function saveSignal(signal) {
  const store = await getStore();
  store.signals.push(signal);
  await saveStore(store);
  return signal;
}

export async function getSignal(id) {
  const store = await getStore();
  return store.signals.find((s) => s.id === id) || null;
}

export async function updateSignal(id, patch) {
  const store = await getStore();
  const idx = store.signals.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  store.signals[idx] = { ...store.signals[idx], ...patch };
  await saveStore(store);
  return store.signals[idx];
}

export async function deleteSignal(id) {
  const store = await getStore();
  store.signals = store.signals.filter((s) => s.id !== id);
  await saveStore(store);
}

export async function listActive() {
  const store = await getStore();
  return store.signals.filter((s) => {
    const status = (s.status || "").toLowerCase();
    return status === "active" || status === "running";
  });
}

export async function getSummaryMessageId() {
  const store = await getStore();
  return store.summaryMessageId || null;
}

export async function setSummaryMessageId(id) {
  const store = await getStore();
  store.summaryMessageId = id;
  await saveStore(store);
}
