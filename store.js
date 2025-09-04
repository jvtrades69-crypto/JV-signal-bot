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
    await writeJSON(STORE_PATH, [], { spaces: 2 });
  }
}

// Get all signals
export async function getSignals() {
  await ensureStore();
  return await readJSON(STORE_PATH);
}

// Add a new signal
export async function addSignal(signal) {
  const signals = await getSignals();
  signals.push(signal);
  await writeJSON(STORE_PATH, signals, { spaces: 2 });
}

// Update a signal by ID
export async function updateSignal(id, updates) {
  const signals = await getSignals();
  const index = signals.findIndex((s) => s.id === id);

  if (index !== -1) {
    signals[index] = { ...signals[index], ...updates };
    await writeJSON(STORE_PATH, signals, { spaces: 2 });
    return signals[index];
  }

  return null;
}

// Delete a signal by ID
export async function deleteSignal(id) {
  let signals = await getSignals();
  signals = signals.filter((s) => s.id !== id);
  await writeJSON(STORE_PATH, signals, { spaces: 2 });
}
