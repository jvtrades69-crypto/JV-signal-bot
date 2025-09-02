const fs = require('fs-extra');
const path = require('path');

const FILE = path.join(__dirname, 'signals.json');
const DEFAULT_DATA = { byId: {}, byMessageId: {}, summaries: {} };

function normalize(raw) {
  const out = { byId: {}, byMessageId: {}, summaries: {} };
  if (!raw || typeof raw !== 'object') return { ...out };

  if (Array.isArray(raw)) {
    for (const s of raw) {
      if (!s || !s.id) continue;
      out.byId[s.id] = s;
      if (s.messageId) out.byMessageId[s.messageId] = s.id;
    }
    return out;
  }

  if (raw.byId && typeof raw.byId === 'object') out.byId = raw.byId;
  if (raw.byMessageId && typeof raw.byMessageId === 'object') out.byMessageId = raw.byMessageId;
  if (raw.summaries && typeof raw.summaries === 'object') out.summaries = raw.summaries;
  return out;
}

function ensureFile() {
  if (!fs.existsSync(FILE)) {
    fs.writeJsonSync(FILE, DEFAULT_DATA, { spaces: 2 });
  } else {
    try {
      const raw = fs.readJsonSync(FILE);
      fs.writeJsonSync(FILE, normalize(raw), { spaces: 2 });
    } catch {
      fs.writeJsonSync(FILE, DEFAULT_DATA, { spaces: 2 });
    }
  }
}

function readAll() {
  ensureFile();
  try {
    return normalize(fs.readJsonSync(FILE));
  } catch {
    fs.writeJsonSync(FILE, DEFAULT_DATA, { spaces: 2 });
    return { ...DEFAULT_DATA };
  }
}

function writeAll(data) {
  fs.writeJsonSync(FILE, normalize(data), { spaces: 2 });
}

function upsert(signal) {
  const data = readAll();
  data.byId[signal.id] = signal;
  if (signal.messageId) data.byMessageId[signal.messageId] = signal.id;
  writeAll(data);
}

function getById(id) {
  return readAll().byId[id] || null;
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
  return Object.values(readAll().byId);
}

function getSummaryMessageId(channelId) {
  return readAll().summaries[channelId] || null;
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
