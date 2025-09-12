// store.js — handles saving and loading signals
import fs from 'fs-extra';

const FILE = './signals.json';

export async function getSignals() {
  try {
    const data = await fs.readJson(FILE);
    return data || [];
  } catch {
    return [];
  }
}

export async function saveSignal(signal) {
  const signals = await getSignals();

  // assign a trade number if not already set
  if (!signal.tradeNumber) {
    signal.tradeNumber = signals.length + 1;
  }

  signals.push(signal);
  await fs.writeJson(FILE, signals, { spaces: 2 });
  return signal;
}

export async function getSignal(id) {
  const signals = await getSignals();
  return signals.find(s => s.id === id);
}

export async function updateSignal(id, updates) {
  const signals = await getSignals();
  const idx = signals.findIndex(s => s.id === id);
  if (idx === -1) return null;

  signals[idx] = { ...signals[idx], ...updates };

  // If trade is closed, stamp closedAt
  if (updates.closed && !signals[idx].closedAt) {
    signals[idx].closedAt = new Date().toISOString();
  }

  await fs.writeJson(FILE, signals, { spaces: 2 });
  return signals[idx];
}

export async function deleteSignal(id) {
  const signals = await getSignals();
  const idx = signals.findIndex(s => s.id === id);
  if (idx === -1) return false;

  signals.splice(idx, 1);
  await fs.writeJson(FILE, signals, { spaces: 2 });
  return true;
}

export async function getThreadId(id) {
  const sig = await getSignal(id);
  return sig ? sig.threadId : null;
}

export async function setThreadId(id, threadId) {
  const sig = await getSignal(id);
  if (!sig) return null;
  return updateSignal(id, { threadId });
}
