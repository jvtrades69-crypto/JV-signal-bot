// store.js
import fs from "fs-extra";
import path from "path";

const { readJSON, writeJSON, pathExists } = fs;

// Path to store signals in a JSON file
const STORE_PATH = path.join(process.cwd(), "signals.json");

// Ensure the store file exists
export async function ensureStore() {
  const exists = await pathExists(STORE_PATH);
  if (!exists) {
    await writeJSON(STORE_PATH, { signals: [], summaryMessageId: null }, { spaces: 2 });
  }
}

// Get full store (signals + summaryMessageId)
async function getStore() {
  await ensureStore();
  return await readJSON(STORE_PATH);
}

// Save full store
async function saveStore(store) {
  await writeJSON(STORE_PATH, store, { spaces: 2 });
}

// Get all signals
export async function getSignals() {
  const store = await getStore();
  return store.signals || [];
}

// Add a new signal
export async function addSignal(signal) {
  const store = await getStore();
  store.signals.push(signal);
  await saveStore(store);
}

// Update a signal by ID
export async function updateSignal(id, updates) {
  const store = await getStore();
  const index = store.signals.findIndex((s) => s.id === id);

  if (index !== -1) {
    store.signals[index] = { ...store.signals[index], ...updates };
    await saveStore(store);
    return store.signals[index];
  }

  return null;
}

// Delete a signal by ID
export async function deleteSignal(id) {
  const store = await getStore();
  store.signals = store.signals.filter((s) => s.id !== id);
  await saveStore(store);
}

// --- Summary Message ID helpers ---
// Get summary message ID
export async function getSummaryMessageId() {
  const store = await getStore();
  return store.summaryMessageId || null;
}

// Set summary message ID
export async function setSummaryMessageId(id) {
  const store = await getStore();
  store.summaryMessageId = id;
  await saveStore(store);
}
