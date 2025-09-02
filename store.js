const fs = require('fs-extra');
const path = require('path');

const FILE = path.join(__dirname, 'signals.json');

if (!fs.existsSync(FILE)) {
  fs.writeJsonSync(FILE, { byId: {}, byMessageId: {}, summaries: {} }, { spaces: 2 });
}

function readAll() { return fs.readJsonSync(FILE); }
function writeAll(data) { fs.writeJsonSync(FILE, data, { spaces: 2 }); }

function upsert(signal) {
  const data = readAll();
  data.byId[signal.id] = signal;
  if (signal.messageId) data.byMessageId[signal.messageId] = signal.id;
  writeAll(data);
}
function getById(id) { return readAll().byId[id] || null; }
function getByMessageId(mid) {
  const data = readAll();
  const id = data.byMessageId[mid];
  if (!id) return null;
  return data.byId[id] || null;
}
function removeById(id) {
  const data = readAll();
  const sig = data.byId[id];
  if (sig?.messageId) delete data.byMessageId[sig.messageId];
  delete data.byId[id];
  writeAll(data);
}
function listAll() { return Object.values(readAll().byId); }
function getSummaryMessageId(channelId) {
  return readAll().summaries?.[channelId] || null;
}
function setSummaryMessageId(channelId, messageId) {
  const data = readAll();
  if (!data.summaries) data.summaries = {};
  data.summaries[channelId] = messageId;
  writeAll(data);
}

module.exports = { upsert, getById, getByMessageId, removeById, listAll, getSummaryMessageId, setSummaryMessageId };
