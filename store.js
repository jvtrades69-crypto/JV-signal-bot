const fs = require('fs-extra');
const path = require('path');

const FILE = path.join(__dirname, 'signals.json');

const DEFAULT_DATA = { byId: {}, byMessageId: {}, summaries: {} };

function normalize(raw) {
  // Always return { byId, byMessageId, summaries }
  const out = { byId: {}, byMessageId: {}, summaries: {} };

  if (!raw || typeof raw !== 'object') return { ...out };

  // Legacy: array of signals
  if (Array.isArray(raw)) {
    for (const s of raw) {
      if (!s || !s.id) continue;
      out.byId[s.id] = s;
      if (s.messageId) out.byMessageId[s.messageId] = s.id;
    }
    return out;
  }

  // Normal shape, but defend against missing keys
  if (raw.byId && typeof raw.byId === 'object') out.byId = raw.byId;
  if (raw.byMessageId && typeof raw.byMessageId === 'object') out.byMessageId = raw.byMessageId;
  if (raw.summaries && typeof raw.summaries === 'object') out.summaries = raw.summaries;

  return out;
}

function ensureFile() {
  if (!fs.existsSync(FILE)) {
    fs.writeJsonSync(FILE, DEFAULT_DATA, { spaces: 2 });
  } else {
    // If file exists but malformed, rewrite normalized copy
    try {
      const raw = fs.readJsonSync(FILE);
      const norm = normalize(raw);
      fs.writeJsonSync(FILE, norm, { spaces: 2 });
    } catch {
      fs.writeJsonSync(FILE, DEFAULT_DATA, { spaces: 2 });
    }
  }
}

function readAll() {
  ensureFile();
  try {
    const raw = fs.readJsonSync(FILE);
    return normalize(raw);
  } catch {
    fs.writeJsonSync(FILE, DEFAULT_DATA, { spaces: 2 });
    return { ...DEFAULT_DATA };
  }
}

function writeAll(data) {
  const norm = normalize(data);
  fs.writeJsonSync(FILE, norm, { spaces: 2 });
}

// --- Public API ---
function upsert(signal) {
  const data = readAll();
  data.byId[signal.id] = signal;
  if (signal.messageId) data.byMessageId[signal.messageId] = signal.id;
  writeAll(data);
}

function getById(id) {
  const data = readAll();
  return data.byId[id] || null;
}

function getByMessageId(mid) {
  const data = readAll();
  const id = data.byMessageId[mid];
  return id ? (data.byId[id] || null) : null;
}

function removeById(id) {
  const data = readAll();
  const sig = data.byId[id];
  if (sig?.messageId) delete data.byMessageId[sig.messageId];
  delete data.byId[id];
  writeAll(data);
}

function listAll() {
  const data = readAll();
  return Object.values(data.byId);
}

function getSummaryMessageId(channelId) {
  const data = readAll();
  return data.summaries[channelId] || null;
}

function setSummaryMessageId(channelId, messageId) {
  const data = readAll();
  data.summaries[channelId] = messageId;
  writeAll(data);
}

module.exports = {
  upsert,
  getById,
  getByMessageId,
  removeById,
  listAll,
  getSummaryMessageId,
  setSummaryMessageId,
};
