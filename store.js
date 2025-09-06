import fs from "fs-extra";

const FILE = "./signals.json";

async function load() {
  try {
    return await fs.readJSON(FILE);
  } catch {
    return [];
  }
}

async function save(signals) {
  await fs.writeJSON(FILE, signals, { spaces: 2 });
}

export async function getSignals() {
  return load();
}

export async function getSignal(id) {
  const signals = await load();
  return signals.find((s) => s.id === id) || null;
}

export async function addSignal(signal) {
  const signals = await load();
  signals.push(signal);
  await save(signals);
}

export async function updateSignal(id, patch) {
  const signals = await load();
  const updated = signals.map((s) =>
    s.id === id ? { ...s, ...patch } : s
  );
  await save(updated);
}

export async function deleteSignal(id) {
  const signals = await load();
  const filtered = signals.filter((s) => s.id !== id);
  await save(filtered);
}