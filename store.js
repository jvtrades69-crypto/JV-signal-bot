const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'signals.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const init = { signals: {}, summaryMessageId: "", ownerPanelMessageIds: {}, channelWebhooks: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('Failed to read DB, recreating...', e);
    const init = { signals: {}, summaryMessageId: "", ownerPanelMessageIds: {}, channelWebhooks: {} };
    fs.writeFileSync(DB_PATH, JSON.stringify(init, null, 2));
    return init;
  }
}

let state = load();
let pending = false;
function persist() {
  if (pending) return;
  pending = true;
  setTimeout(() => {
    fs.writeFile(DB_PATH, JSON.stringify(state, null, 2), (err) => {
      if (err) console.error('DB write error:', err);
      pending = false;
    });
  }, 50);
}

// ---- Public API required by spec ----
function saveSignal(signal) {
  state.signals[signal.id] = signal;
  persist();
  return signal;
}

function getSignal(id) {
  return state.signals[id] || null;
}

function updateSignal(id, patch) {
  if (!state.signals[id]) return null;
  state.signals[id] = { ...state.signals[id], ...patch, updatedAt: Date.now() };
  persist();
  return state.signals[id];
}

function deleteSignal(id) {
  if (!state.signals[id]) return;
  delete state.signals[id];
  persist();
}

function listActive() {
  // Active = statuses where trade is still running / valid to display in summary
  return Object.values(state.signals).filter(s => s.active);
}

function getSummaryMessageId() {
  return state.summaryMessageId || "";
}
function setSummaryMessageId(messageId) {
  state.summaryMessageId = messageId;
  persist();
}

function getOwnerPanelMessageId(id) {
  return state.ownerPanelMessageIds[id] || "";
}
function setOwnerPanelMessageId(id, messageId) {
  state.ownerPanelMessageIds[id] = messageId;
  persist();
}

// ---- Extra helpers (internal) ----
function getChannelWebhook(channelId) {
  return state.channelWebhooks[channelId] || null;
}
function setChannelWebhook(channelId, webhookInfo) {
  state.channelWebhooks[channelId] = webhookInfo; // { id, token }
  persist();
}

module.exports = {
  saveSignal,
  getSignal,
  updateSignal,
  deleteSignal,
  listActive,
  getSummaryMessageId,
  setSummaryMessageId,
  getOwnerPanelMessageId,
  setOwnerPanelMessageId,
  // extras
  getChannelWebhook,
  setChannelWebhook,
};
