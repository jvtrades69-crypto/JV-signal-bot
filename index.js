// index.js — JV Signal Bot (Sep 2025)
// - Posts /signal in the channel it's run in (per-signal channelId)
// - Control panel (TP1–TP5 + Update modals + Close/BE/Out + Delete + 🔔 Notify Roles)
// - Summary: always 1 message in currentTradesChannelId
// - Ghost prune on startup; ignore signals whose source message was deleted
// - Dedupe guard for interactions; safe acks to avoid unknown/deferred errors
// - /recap command: weekly/monthly/custom KPIs, optional full listing (plain text)
// - Timestamps on signals: createdAt, updatedAt, closedAt

import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from 'discord.js';
import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, getSignals, updateSignal, deleteSignal,
  getThreadId, setThreadId
} from './store.js';
import { renderSignalText, renderSummaryText } from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// ---- global error catcher so bot doesn’t crash ----
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException',  (err) => console.error('uncaughtException:', err));

// ------------------------------
// Utility & core helpers
// ------------------------------
const isNum = (v) => v !== undefined && v !== null && v !== '' && !isNaN(Number(v));
const toNumOrNull = (v) => (isNum(v) ? Number(v) : null);

const DIR = { LONG: 'LONG', SHORT: 'SHORT' };
const STATUS = {
  RUN_VALID: 'RUN_VALID',
  CLOSED: 'CLOSED',
  STOPPED_BE: 'STOPPED_BE',
  STOPPED_OUT: 'STOPPED_OUT',
};
const TP_KEYS = ['tp1', 'tp2', 'tp3', 'tp4', 'tp5'];

// Asia/Singapore date helpers (no external deps)
const SG_TZ = 'Asia/Singapore';
const fmtDate = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: SG_TZ, dateStyle: 'medium' }).format(new Date(ms)); // e.g., Sep 7, 2025
const fmtISODate = (ms) => {
  const d = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: SG_TZ, year:'numeric', month:'2-digit', day:'2-digit' })
    .format(new Date(ms)).replace(/(\d{4})-(\d{2})-(\d{2})/, '$1/$2/$3'));
  // Return YYYY-MM-DD
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  const day = String(d.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};
const startOfDaySG = (y, m, d) => Date.parse(new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T00:00:00+08:00`));
const endOfDaySG = (y, m, d) => Date.parse(new Date(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}T23:59:59.999+08:00`));

// Period ranges (previous full week Mon–Sun, previous calendar month)
function getWeekRangeSG(now = Date.now()) {
  const nowDate = new Date(new Date(now).toLocaleString('en-US', { timeZone: SG_TZ }));
  // Find last Monday before today (exclude current week); then Sunday after it
  const day = nowDate.getDay(); // 0 Sun, 1 Mon, ...
  const daysSinceMonday = (day + 6) % 7; // Mon=0
  // Current week's Monday:
  const curMon = new Date(nowDate); curMon.setDate(nowDate.getDate() - daysSinceMonday);
  // Previous week's Monday:
  const prevMon = new Date(curMon); prevMon.setDate(curMon.getDate() - 7);
  const prevSun = new Date(prevMon); prevSun.setDate(prevMon.getDate() + 6);
  const y1 = prevMon.getFullYear(), m1 = prevMon.getMonth()+1, d1 = prevMon.getDate();
  const y2 = prevSun.getFullYear(), m2 = prevSun.getMonth()+1, d2 = prevSun.getDate();
  return { from: startOfDaySG(y1,m1,d1), to: endOfDaySG(y2,m2,d2) };
}
function getMonthRangeSG(now = Date.now()) {
  const nowDate = new Date(new Date(now).toLocaleString('en-US', { timeZone: SG_TZ }));
  const y = nowDate.getFullYear(), m = nowDate.getMonth()+1;
  // Previous month:
  const pm = m === 1 ? 12 : m-1;
  const py = m === 1 ? y-1 : y;
  const from = startOfDaySG(py, pm, 1);
  const lastDay = new Date(py, pm, 0).getDate();
  const to = endOfDaySG(py, pm, lastDay);
  return { from, to };
}
function parseCustomRange(fromStr, toStr) {
  // YYYY-MM-DD inclusive
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromStr||'');
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toStr||'');
  if (!m1 || !m2) return null;
  const from = startOfDaySG(+m1[1], +m1[2], +m1[3]);
  const to = endOfDaySG(+m2[1], +m2[2], +m2[3]);
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) return null;
  return { from, to };
}

function rAtPrice(direction, entry, slOriginal, price) {
  if (!isNum(entry) || !isNum(slOriginal) || !isNum(price)) return null;
  const E = Number(entry), S = Number(slOriginal), P = Number(price);
  if (direction === DIR.LONG) {
    const risk = E - S; if (risk <= 0) return null;
    return (P - E) / risk;
  } else {
    const risk = S - E; if (risk <= 0) return null;
    return (E - P) / risk;
  }
}

function computeRRChips(signal) {
  const chips = [];
  for (const key of TP_KEYS) {
    const tpVal = toNumOrNull(signal[key]);
    if (tpVal === null) continue;
    const r = rAtPrice(signal.direction, signal.entry, signal.sl, tpVal);
    if (r === null) continue;
    chips.push({ key: key.toUpperCase(), r: Number(r.toFixed(2)) });
  }
  return chips;
}

function normalizeSignal(raw) {
  const s = { ...raw };
  s.entry = toNumOrNull(s.entry);
  s.sl = toNumOrNull(s.sl);
  s.slOriginal = s.slOriginal ?? s.sl;
  for (const k of TP_KEYS) s[k] = toNumOrNull(s[k]);
  s.fills = Array.isArray(s.fills) ? s.fills : [];
  s.latestTpHit = s.latestTpHit || null;
  s.status = s.status || STATUS.RUN_VALID;
  if (typeof s.validReentry !== 'boolean') s.validReentry = true;
  s.extraRole = s.extraRole || '';
  s.plan = s.plan && typeof s.plan === 'object' ? s.plan : {};
  for (const K of ['TP1','TP2','TP3','TP4','TP5']) {
    const v = s.plan[K];
    s.plan[K] = isNum(v) ? Number(v) : null;
  }
  // track one-time TP hits
  s.tpHits = s.tpHits && typeof s.tpHits === 'object' ? s.tpHits : { TP1:false, TP2:false, TP3:false, TP4:false, TP5:false };
  // optional final-R override for closures
  if (s.finalR !== undefined && s.finalR !== null && !isNum(s.finalR)) delete s.finalR;

  // timestamps
  if (!s.createdAt) s.createdAt = Date.now();
  if (!s.updatedAt) s.updatedAt = s.createdAt;
  // closedAt stays undefined until closed/stopped
  return s;
}

function isSlMovedToBE(signal) {
  const s = normalizeSignal(signal);
  return s.status === STATUS.RUN_VALID && isNum(s.entry) && isNum(s.sl) && Number(s.entry) === Number(s.sl) && !!s.latestTpHit;
}

function extractRoleIds(defaultRoleId, extraRoleRaw) {
  const ids = [];
  if (defaultRoleId) ids.push(defaultRoleId);
  if (!extraRoleRaw) return ids;
  const found = `${extraRoleRaw}`.match(/\d{6,}/g);
  if (found) ids.push(...found);
  return Array.from(new Set(ids));
}
// UPDATED: supports forcePing on edits (for Notify button)
function buildMentions(defaultRoleId, extraRoleRaw, opts = {}) {
  const { forEdit = false, forcePing = false } = opts;
  const ids = extractRoleIds(defaultRoleId, extraRoleRaw);
  const content = ids.length ? ids.map(id => `<@&${id}>`).join(' ') : '';
  if (!ids.length) return { content: '', allowedMentions: { parse: [] } };

  if (!forEdit) {
    return { content, allowedMentions: { parse: [], roles: ids } };
  }
  if (forcePing) {
    return { content, allowedMentions: { parse: [], roles: ids } };
  }
  return { content, allowedMentions: { parse: [] } };
}

// Ack helpers (prevent “not sent or deferred”)
async function ensureDeferred(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
  } catch {}
}
async function safeEditReply(interaction, payload) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    }
  } catch {}
  try {
    return await interaction.editReply(payload);
  } catch (e) {
    try {
      if (!interaction.replied) return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch {}
    throw e;
  }
}

// ------------------------------
// Posting / Editing messages (per-signal channelId)
// ------------------------------
async function postSignalMessage(signal) {
  const channel = await client.channels.fetch(signal.channelId);
  const rrChips = computeRRChips(signal);
  const text = renderSignalText(normalizeSignal(signal), rrChips, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(
    config.mentionRoleId,
    signal.extraRole,
    { forEdit: false, forcePing: false }
  );

  const sent = await channel.send({
    content: `${text}${mentionLine ? `\n\n${mentionLine}` : ''}`,
    ...(mentionLine ? { allowedMentions } : {})
  });
  return sent.id;
}

async function editSignalMessage(signal, { forcePing = false } = {}) {
  const channel = await client.channels.fetch(signal.channelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (!msg) return false;
  const rrChips = computeRRChips(signal);
  const text = renderSignalText(normalizeSignal(signal), rrChips, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(
    config.mentionRoleId,
    signal.extraRole,
    { forEdit: true, forcePing }
  );

  await msg.edit({
    content: `${text}${mentionLine ? `\n\n${mentionLine}` : ''}`,
    ...(mentionLine ? { allowedMentions } : { allowedMentions: { parse: [] } })
  }).catch(() => {});
  return true;
}

async function deleteSignalMessage(signal) {
  const channel = await client.channels.fetch(signal.channelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
}

// ------------------------------
// Summary (edit-in-place; debounced; one message only)
// ------------------------------
let _summaryTimer = null;
let _summaryBusy = false;

async function hardPurgeChannel(channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    while (true) {
      const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!batch || batch.size === 0) break;

      const young = batch.filter(m => (Date.now() - m.createdTimestamp) < 14 * 24 * 60 * 60 * 1000);
      if (young.size) {
        try { await channel.bulkDelete(young, true); } catch (e) { console.error('purge bulkDelete:', e); }
      }
      const oldies = batch.filter(m => !young.has(m.id));
      for (const m of oldies.values()) {
        try { await m.delete(); } catch (e) { console.error('purge single delete:', e); }
      }
      if (batch.size < 100) break;
    }
  } catch (e) {
    console.error('hardPurgeChannel outer error:', e);
  }
}

async function updateSummary() {
  if (_summaryTimer) clearTimeout(_summaryTimer);
  _summaryTimer = setTimeout(async () => {
    if (_summaryBusy) return;
    _summaryBusy = true;
    try {
      const summaryChannel = await client.channels.fetch(config.currentTradesChannelId);

      // Build active list (must exist AND original message still exists in its own channel)
      const signals = (await getSignals()).map(normalizeSignal);
      const candidates = signals.filter(s => s.status === STATUS.RUN_VALID && s.validReentry === true);

      const active = [];
      for (const s of candidates) {
        let ok = false;
        if (s.messageId && s.channelId) {
          try {
            const ch = await client.channels.fetch(s.channelId);
            await ch.messages.fetch(s.messageId);
            ok = true;
          } catch {}
        }
        if (ok) active.push(s);
      }

      const content = active.length === 0
        ? `**JV Current Active Trades** 📊\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades!`
        : renderSummaryText(active);

      // Try to edit an existing bot message first
      const recent = await summaryChannel.messages.fetch({ limit: 10 }).catch(() => null);
      let existing = null;
      if (recent && recent.size) {
        existing = Array.from(recent.values()).find(m => m.author?.id === client.user.id && !m.system);
      }

      if (existing) {
        await existing.edit({ content, allowedMentions: { parse: [] } }).catch(() => {});
        // delete other bot-authored messages as safety
        for (const m of recent.values()) {
          if (m.id !== existing.id && m.author?.id === client.user.id) {
            try { await m.delete(); } catch {}
          }
        }
      } else {
        await hardPurgeChannel(config.currentTradesChannelId);
        await summaryChannel.send({ content, allowedMentions: { parse: [] } }).catch(e => console.error('summary send failed:', e));
      }
    } catch (e) {
      console.error('updateSummary error:', e);
    } finally {
      _summaryBusy = false;
    }
  }, 600);
}

// ------------------------------
// Control UI (TPs + updates + closes + notify)
// ------------------------------
function btn(id, key) { return `btn:${key}:${id}`; }
function modal(id, key) { return `modal:${key}:${id}`; }

function controlRows(signalId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'tp1')).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'tp2')).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'tp3')).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Success),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'tp4')).setLabel('🎯 TP4 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'tp5')).setLabel('🎯 TP5 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:tpprices')).setLabel('✏️ Update TP Prices').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:plan')).setLabel('✏️ Update TP % Plan').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'upd:trade')).setLabel('✏️ Update Trade Info').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:roles')).setLabel('✏️ Update Role Mention').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'fullclose')).setLabel('✅ Fully Close').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(btn(signalId,'stopbe')).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(btn(signalId,'stopped')).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(btn(signalId,'notify')).setLabel('🔔 Notify Roles').setStyle(ButtonStyle.Primary) // NEW
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'del')).setLabel('❌ Delete').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2, row3, row4];
}

async function createControlThread(signal) {
  const channel = await client.channels.fetch(signal.channelId);
  const thread = await channel.threads.create({
    name: `controls-${signal.asset}-${signal.id.slice(0, 4)}`,
    type: ChannelType.PrivateThread,
    invitable: false
  });
  await thread.members.add(config.ownerId);
  await setThreadId(signal.id, thread.id);
  await thread.send({ content: 'Owner Control Panel', components: controlRows(signal.id) });
  return thread.id;
}

async function deleteControlThread(signalId) {
  const tid = await getThreadId(signalId);
  if (!tid) return;
  const thread = await client.channels.fetch(tid).catch(() => null);
  if (thread && thread.isThread()) {
    await thread.delete().catch(() => {});
  }
}

// ------------------------------
// Modals
// ------------------------------
function makeTPModal(id, tpKey) {
  const m = new ModalBuilder().setCustomId(modal(id, `tp:${tpKey}`)).setTitle(`${tpKey.toUpperCase()} Hit`);
  const pct = new TextInputBuilder()
    .setCustomId('tp_pct')
    .setLabel('Close % (0 - 100; leave blank to skip)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  m.addComponents(new ActionRowBuilder().addComponents(pct));
  return m;
}
function makeUpdateTPPricesModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'tpprices')).setTitle('Update TP Prices (TP1–TP5)');
  for (const [cid, label] of [['upd_tp1','TP1'],['upd_tp2','TP2'],['upd_tp3','TP3'],['upd_tp4','TP4'],['upd_tp5','TP5']]) {
    m.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false)
    ));
  }
  return m;
}
function makeUpdatePlanModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'plan')).setTitle('Update TP % Plan (0–100)');
  for (const t of ['tp1','tp2','tp3','tp4','tp5']) {
    m.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`plan_${t}`).setLabel(`${t.toUpperCase()} planned %`).setStyle(TextInputStyle.Short).setRequired(false)
    ));
  }
  return m;
}
function makeUpdateTradeInfoModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'trade')).setTitle('Update Trade Info');
  const fields = [
    ['upd_entry', 'Entry', TextInputStyle.Short],
    ['upd_sl', 'SL', TextInputStyle.Short],
    ['upd_asset', 'Asset (e.g., BTC, ETH, SOL)', TextInputStyle.Short],
    ['upd_dir', 'Direction (LONG/SHORT)', TextInputStyle.Short],
    ['upd_reason', 'Reason (optional)', TextInputStyle.Paragraph],
  ];
  for (const [cid, label, style] of fields) {
    m.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(style).setRequired(false)
    ));
  }
  return m;
}
function makeUpdateRolesModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'roles')).setTitle('Update Role Mention(s)');
  const input = new TextInputBuilder()
    .setCustomId('roles_input')
    .setLabel('Enter one or more roles (IDs or @mentions)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);
  m.addComponents(new ActionRowBuilder().addComponents(input));
  return m;
}
function makeFullCloseModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'full')).setTitle('Fully Close Position');
  const price = new TextInputBuilder().setCustomId('close_price').setLabel('Close Price').setStyle(TextInputStyle.Short).setRequired(true);
  const pct = new TextInputBuilder().setCustomId('close_pct').setLabel('Close % (default = remaining)').setStyle(TextInputStyle.Short).setRequired(false);
  const finalR = new TextInputBuilder().setCustomId('final_r').setLabel('Final R (optional)').setPlaceholder('e.g., 0, -0.5, -1 — overrides calc').setStyle(TextInputStyle.Short).setRequired(false);
  m.addComponents(new ActionRowBuilder().addComponents(price));
  m.addComponents(new ActionRowBuilder().addComponents(pct));
  m.addComponents(new ActionRowBuilder().addComponents(finalR));
  return m;
}
function makeFinalRModal(id, kind) {
  const m = new ModalBuilder().setCustomId(modal(id, `finalr:${kind}`)).setTitle(kind === 'BE' ? 'Stopped Breakeven' : 'Stopped Out');
  const r = new TextInputBuilder().setCustomId('final_r').setLabel('Final R (optional)').setPlaceholder('e.g., 0, -0.5, -1 — overrides calc').setStyle(TextInputStyle.Short).setRequired(false);
  m.addComponents(new ActionRowBuilder().addComponents(r));
  return m;
}

// ------------------------------
// Bot lifecycle
// ------------------------------
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await pruneGhostSignals().catch(() => {});
});

// Manual delete watcher (any channel)
client.on('messageDelete', async (message) => {
  try {
    if (!message) return; // we’ll match by messageId below
    const sigs = await getSignals();
    const found = sigs.find(s => s.messageId === message.id);
    if (!found) return;
    await deleteControlThread(found.id).catch(() => {});
    await deleteSignal(found.id).catch(() => {});
    await updateSummary().catch(() => {});
    console.log(`ℹ️ Signal ${found.id} removed due to manual delete.`);
  } catch (e) {
    console.error('messageDelete handler error:', e);
  }
});

client.on('messageDeleteBulk', async (collection) => {
  try {
    const ids = new Set(Array.from(collection.keys()));
    const sigs = await getSignals();
    const toRemove = sigs.filter(s => ids.has(s.messageId));
    for (const s of toRemove) {
      await deleteControlThread(s.id).catch(() => {});
      await deleteSignal(s.id).catch(() => {});
    }
    if (toRemove.length) await updateSummary().catch(() => {});
  } catch (e) {
    console.error('messageDeleteBulk handler error:', e);
  }
});

// ------------------------------
// Interactions (dedupe guard)
// ------------------------------
const claimed = new Set();
const CLAIM_TTL_MS = 60_000;
function tryClaimInteraction(interaction) {
  const id = interaction.id;
  if (claimed.has(id)) return false;
  claimed.add(id);
  setTimeout(() => claimed.delete(id), CLAIM_TTL_MS);
  return true;
}

// ------------------------------
// Interaction router
// ------------------------------
const pendingSignals = new Map();

client.on('interactionCreate', async (interaction) => {
  try {
    if (!tryClaimInteraction(interaction)) return;

    // /signal
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', flags: MessageFlags.Ephemeral });
      }
      await ensureDeferred(interaction);

      const assetSel   = interaction.options.getString('asset');
      const direction  = interaction.options.getString('direction');
      const entry      = interaction.options.getString('entry');
      const sl         = interaction.options.getString('sl');
      const tp1        = interaction.options.getString('tp1');
      const tp2        = interaction.options.getString('tp2');
      const tp3        = interaction.options.getString('tp3');
      const tp4        = interaction.options.getString('tp4');
      const tp5        = interaction.options.getString('tp5');
      const reason     = interaction.options.getString('reason');
      const extraRole  = interaction.options.getString('extra_role');

      const tp1_pct = interaction.options.getString('tp1_pct');
      const tp2_pct = interaction.options.getString('tp2_pct');
      const tp3_pct = interaction.options.getString('tp3_pct');
      const tp4_pct = interaction.options.getString('tp4_pct');
      const tp5_pct = interaction.options.getString('tp5_pct');

      if (assetSel === 'OTHER') {
        const pid = nano();
        const m = new ModalBuilder().setCustomId(modal(pid,'asset')).setTitle('Enter custom asset');
        const input = new TextInputBuilder().setCustomId('asset_value').setLabel('Asset (e.g., PEPE, XRP)').setStyle(TextInputStyle.Short).setRequired(true);
        m.addComponents(new ActionRowBuilder().addComponents(input));
        pendingSignals.set(pid, {
          direction, entry, sl, tp1, tp2, tp3, tp4, tp5, reason, extraRole,
          plan: {
            TP1: isNum(tp1_pct) ? Number(tp1_pct) : null,
            TP2: isNum(tp2_pct) ? Number(tp2_pct) : null,
            TP3: isNum(tp3_pct) ? Number(tp3_pct) : null,
            TP4: isNum(tp4_pct) ? Number(tp4_pct) : null,
            TP5: isNum(tp5_pct) ? Number(tp5_pct) : null,
          },
          channelId: interaction.channelId,
        });
        return interaction.showModal(m);
      }

      await createSignal({
        asset: assetSel,
        direction, entry, sl, tp1, tp2, tp3, tp4, tp5,
        reason, extraRole,
        plan: {
          TP1: isNum(tp1_pct) ? Number(tp1_pct) : null,
          TP2: isNum(tp2_pct) ? Number(tp2_pct) : null,
          TP3: isNum(tp3_pct) ? Number(tp3_pct) : null,
          TP4: isNum(tp4_pct) ? Number(tp4_pct) : null,
          TP5: isNum(tp5_pct) ? Number(tp5_pct) : null,
        }
      }, interaction.channelId);
      return safeEditReply(interaction, { content: '✅ Trade signal posted.' });
    }

    // /recap
    if (interaction.isChatInputCommand() && interaction.commandName === 'recap') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', flags: MessageFlags.Ephemeral });
      }
      await ensureDeferred(interaction);

      const period = (interaction.options.getString('period') || 'week').toLowerCase(); // week|month|custom
      const fromStr = interaction.options.getString('from');
      const toStr = interaction.options.getString('to');
      const assetFilter = (interaction.options.getString('asset') || '').trim().toUpperCase();
      const format = (interaction.options.getString('format') || 'summary').toLowerCase(); // summary|full

      let range = null;
      if (period === 'week') range = getWeekRangeSG();
      else if (period === 'month') range = getMonthRangeSG();
      else if (period === 'custom') range = parseCustomRange(fromStr, toStr);
      if (!range) return safeEditReply(interaction, { content: '❌ Invalid period or date range.' });

      const { from, to } = range;
      const all = (await getSignals()).map(normalizeSignal);
      const closed = all.filter(s =>
        (s.status === STATUS.CLOSED || s.status === STATUS.STOPPED_BE || s.status === STATUS.STOPPED_OUT) &&
        isNum(s.closedAt) && s.closedAt >= from && s.closedAt <= to &&
        (!assetFilter || String(s.asset).toUpperCase() === assetFilter)
      );

      const kpis = computeRecapKPIs(closed);
      const title = `**JV Recap — ${period === 'week' ? 'Week' : period === 'month' ? 'Month' : 'Custom'} (${fmtISODate(from)}–${fmtISODate(to)})**`;

      let content = `${title}\n\n${renderKPIs(kpis)}`;
      if (format === 'full' && closed.length) {
        content += `\n\n— Every trade —\n${renderTradeLines(closed)}`;
      }
      const channel = await client.channels.fetch(interaction.channelId);
      await channel.send({ content, allowedMentions: { parse: [] } });
      return safeEditReply(interaction, { content: '📊 Recap posted.' });
    }

    // ===== MODALS =====
    if (interaction.isModalSubmit()) {
      const idPart = interaction.customId.split(':').pop(); // after last :

      // Custom asset modal
      if (interaction.customId.startsWith('modal:asset:')) {
        await ensureDeferred(interaction);
        const stash = pendingSignals.get(idPart);
        pendingSignals.delete(idPart);
        if (!stash) return safeEditReply(interaction, { content: '❌ Session expired. Try /signal again.' });
        const asset = interaction.fields.getTextInputValue('asset_value').trim().toUpperCase();
        await createSignal({ asset, ...stash }, stash.channelId || interaction.channelId);
        return safeEditReply(interaction, { content: `✅ Trade signal posted for ${asset}.` });
      }

      // Update TP Prices
      if (interaction.customId.startsWith('modal:tpprices:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const patch = {};
        for (const k of ['tp1','tp2','tp3','tp4','tp5']) {
          const v = interaction.fields.getTextInputValue(`upd_${k}`)?.trim();
          if (v !== undefined && v !== '') patch[k] = v;
        }

        patch.updatedAt = Date.now();
        await updateSignal(id, { ...patch });
        const updated = normalizeSignal(await getSignal(id));
        if (isSlMovedToBE(updated)) { updated.validReentry = false; await updateSignal(id, { validReentry: false }); }
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ TP prices updated.' });
      }

      // Update Plan
      if (interaction.customId.startsWith('modal:plan:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const sig = normalizeSignal(await getSignal(id));
        if (!sig) return safeEditReply(interaction, { content: 'Signal not found.' });

        const patchPlan = { ...sig.plan };
        for (const t of ['tp1','tp2','tp3','tp4','tp5']) {
          const raw = interaction.fields.getTextInputValue(`plan_${t}`)?.trim();
          if (raw === '' || raw === undefined) continue;
          if (isNum(raw)) patchPlan[t.toUpperCase()] = Math.max(0, Math.min(100, Number(raw)));
        }
        await updateSignal(id, { plan: patchPlan, updatedAt: Date.now() });
        await editSignalMessage(normalizeSignal(await getSignal(id)));
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ TP % plan updated.' });
      }

      // Update Trade
      if (interaction.customId.startsWith('modal:trade:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const patch = {};
        const entry     = interaction.fields.getTextInputValue('upd_entry')?.trim();
        const sl        = interaction.fields.getTextInputValue('upd_sl')?.trim();
        const asset     = interaction.fields.getTextInputValue('upd_asset')?.trim();
        const dir       = interaction.fields.getTextInputValue('upd_dir')?.trim()?.toUpperCase();
        const reason    = interaction.fields.getTextInputValue('upd_reason')?.trim();

        if (entry) patch.entry = entry;
        if (sl)    patch.sl = sl;
        if (asset) patch.asset = asset.toUpperCase();
        if (dir === 'LONG' || dir === 'SHORT') patch.direction = dir;
        if (reason !== undefined) patch.reason = reason;

        patch.updatedAt = Date.now();
        await updateSignal(id, patch);
        const updated = normalizeSignal(await getSignal(id));
        if (isSlMovedToBE(updated)) { updated.validReentry = false; await updateSignal(id, { validReentry: false }); }
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Trade info updated.' });
      }

      // Update Roles
      if (interaction.customId.startsWith('modal:roles:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const rolesRaw = interaction.fields.getTextInputValue('roles_input') ?? '';
        await updateSignal(id, { extraRole: rolesRaw, updatedAt: Date.now() });
        await editSignalMessage(normalizeSignal(await getSignal(id)));
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Role mentions updated.' });
      }

      // TP modal submit
      if (interaction.customId.startsWith('modal:tp:')) {
        await ensureDeferred(interaction);
        const parts = interaction.customId.split(':'); // modal, tp, tpX, id
        const tpKey = parts[2]; // tp1..tp5
        const id = parts[3];

        let signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const tpUpper = tpKey.toUpperCase();
        if (signal.tpHits?.[tpUpper]) return safeEditReply(interaction, { content: `${tpUpper} already recorded.` });

        const pctRaw = interaction.fields.getTextInputValue('tp_pct')?.trim();
        const hasPct = pctRaw !== undefined && pctRaw !== null && pctRaw !== '';
        const pct = hasPct ? Number(pctRaw) : null;
        if (hasPct && (isNaN(pct) || pct < 0 || pct > 100)) {
          return safeEditReply(interaction, { content: '❌ Close % must be between 0 and 100 (or leave blank to skip).' });
        }
        const tpPrice = signal[tpKey];
        if (hasPct && pct > 0 && isNum(tpPrice)) {
          const already = (signal.fills || []).some(f => String(f.source).toUpperCase() === tpUpper);
          if (!already) signal.fills.push({ pct: Number(pct), price: Number(tpPrice), source: tpUpper });
        }
        signal.latestTpHit = tpUpper;
        signal.tpHits[tpUpper] = true;

        await updateSignal(id, { fills: signal.fills, latestTpHit: signal.latestTpHit, tpHits: signal.tpHits, updatedAt: Date.now() });
        await editSignalMessage(signal);
        await updateSummary();
        return safeEditReply(interaction, { content: `✅ ${tpUpper} recorded${hasPct && pct > 0 ? ` (${pct}%).` : '.'}` });
      }

      // Fully close + FinalR
      if (interaction.customId.startsWith('modal:full:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        let signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const finalRStr = interaction.fields.getTextInputValue('final_r')?.trim();
        const hasFinalR = finalRStr !== undefined && finalRStr !== '';
        if (hasFinalR && !isNum(finalRStr)) {
          return safeEditReply(interaction, { content: '❌ Final R must be a number if provided.' });
        }

        if (hasFinalR) {
          signal.finalR = Number(finalRStr);
        } else {
          const price = Number(interaction.fields.getTextInputValue('close_price')?.trim());
          if (!isNum(price)) return safeEditReply(interaction, { content: '❌ Close Price must be a number.' });

          const currentPct = (signal.fills || []).reduce((acc, f) => acc + Number(f.pct || 0), 0);
          let pctStr = interaction.fields.getTextInputValue('close_pct')?.trim();
          let pct = isNum(pctStr) ? Number(pctStr) : Math.max(0, 100 - currentPct);
          if (pct < 0 || pct > 100) pct = Math.max(0, Math.min(100, pct));
          if (pct > 0) signal.fills.push({ pct, price, source: 'FINAL_CLOSE' });
        }

        const latest = signal.latestTpHit || TP_KEYS.find(k => signal[k] !== null)?.toUpperCase() || null;
        signal.status = STATUS.CLOSED;
        signal.validReentry = false;
        signal.latestTpHit = latest;

        await updateSignal(id, {
          fills: signal.fills, status: signal.status, validReentry: false,
          latestTpHit: latest, ...(hasFinalR ? { finalR: signal.finalR } : {}),
          updatedAt: Date.now(), closedAt: Date.now()
        });
        await editSignalMessage(signal);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Fully closed.' });
      }

      // FinalR modal (Stopped BE / Stopped Out)
      if (interaction.customId.startsWith('modal:finalr:')) {
        await ensureDeferred(interaction);
        const parts = interaction.customId.split(':'); // modal, finalr, BE/OUT, id
        const kind = parts[2];
        const id = parts[3];

        let signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const finalRStr = interaction.fields.getTextInputValue('final_r')?.trim();
        const hasFinalR = finalRStr !== undefined && finalRStr !== '';
        if (hasFinalR && !isNum(finalRStr)) {
          return safeEditReply(interaction, { content: '❌ Final R must be a number (e.g., 0, -1, -0.5).' });
        }

        if (hasFinalR) {
          signal.finalR = Number(finalRStr);
        } else {
          let price = Number(kind === 'BE' ? signal.entry : (signal.slOriginal ?? signal.sl));
          const remaining = 100 - (signal.fills || []).reduce((a, f) => a + Number(f.pct || 0), 0);
          if (remaining > 0 && isNum(price)) {
            signal.fills.push({ pct: remaining, price, source: kind === 'BE' ? 'STOP_BE' : 'STOP_OUT' });
          }
        }

        signal.status = (kind === 'BE') ? STATUS.STOPPED_BE : STATUS.STOPPED_OUT;
        signal.validReentry = false;

        await updateSignal(id, {
          fills: signal.fills, status: signal.status, validReentry: false,
          ...(hasFinalR ? { finalR: signal.finalR } : {}),
          updatedAt: Date.now(), closedAt: Date.now()
        });
        await editSignalMessage(signal);
        await updateSummary();
        await deleteControlThread(id);
        return safeEditReply(interaction, { content: kind === 'BE' ? '✅ Stopped at breakeven.' : '✅ Stopped out.' });
      }
    }

    // ===== BUTTONS =====
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', flags: MessageFlags.Ephemeral });
      }
      const parts = interaction.customId.split(':'); // btn, key..., id
      const id = parts.pop();
      const key = parts.slice(1).join(':'); // remove 'btn'

      // Show modals: DO NOT defer before showModal
      if (key === 'upd:tpprices') return interaction.showModal(makeUpdateTPPricesModal(id));
      if (key === 'upd:plan')     return interaction.showModal(makeUpdatePlanModal(id));
      if (key === 'upd:trade')    return interaction.showModal(makeUpdateTradeInfoModal(id));
      if (key === 'upd:roles')    return interaction.showModal(makeUpdateRolesModal(id));
      if (key === 'fullclose')    return interaction.showModal(makeFullCloseModal(id));
      if (key === 'stopbe')       return interaction.showModal(makeFinalRModal(id, 'BE'));
      if (key === 'stopped')      return interaction.showModal(makeFinalRModal(id, 'OUT'));

      if (key === 'notify') {
        await ensureDeferred(interaction);
        const signal = await getSignal(id).catch(() => null);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        // re-render same content but force ping on edit
        await editSignalMessage(normalizeSignal(signal), { forcePing: true });
        return safeEditReply(interaction, { content: '🔔 Roles notified.' });
      }

      if (key === 'del') {
        await ensureDeferred(interaction);
        const sig = await getSignal(id).catch(() => null);
        if (sig) {
          await deleteSignalMessage(sig).catch(() => {});
          await deleteControlThread(id).catch(() => {});
          await deleteSignal(id).catch(() => {});
          await updateSummary().catch(() => {});
        }
        return safeEditReply(interaction, { content: '🗑️ Signal deleted.' });
      }

      if (['tp1','tp2','tp3','tp4','tp5'].includes(key)) {
        const sig = normalizeSignal(await getSignal(id));
        if (!sig) return interaction.reply({ content: 'Signal not found.', flags: MessageFlags.Ephemeral });

        const tpUpper = key.toUpperCase();
        if (sig.tpHits?.[tpUpper]) {
          return interaction.reply({ content: `${tpUpper} already recorded.`, flags: MessageFlags.Ephemeral });
        }

        const planPct = sig.plan?.[tpUpper];
        const tpPrice = sig[key];

        if (isNum(planPct) && Number(planPct) > 0 && isNum(tpPrice)) {
          const already = (sig.fills || []).some(f => String(f.source).toUpperCase() === tpUpper);
          if (!already) sig.fills.push({ pct: Number(planPct), price: Number(tpPrice), source: tpUpper });
          sig.latestTpHit = tpUpper;
          sig.tpHits[tpUpper] = true;

          await updateSignal(id, { fills: sig.fills, latestTpHit: sig.latestTpHit, tpHits: sig.tpHits, updatedAt: Date.now() });
          await editSignalMessage(sig);
          await updateSummary();
          await ensureDeferred(interaction);
          return safeEditReply(interaction, { content: `✅ ${tpUpper} executed (${planPct}%).` });
        }

        const m = makeTPModal(id, key);
        if (isNum(planPct)) m.components[0].components[0].setValue(String(planPct));
        return interaction.showModal(m);
      }

      return interaction.reply({ content: 'Unknown action.', flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error('interaction error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Internal error.' });
      } else {
        await interaction.reply({ content: '❌ Internal error.', flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
});

// ------------------------------
// Create & Save Signal
// ------------------------------
async function createSignal(payload, channelId) {
  const signal = normalizeSignal({
    id: nano(),
    asset: String(payload.asset || '').toUpperCase(),
    direction: (payload.direction || 'LONG').toUpperCase() === 'SHORT' ? DIR.SHORT : DIR.LONG,
    entry: payload.entry,
    sl: payload.sl,
    tp1: payload.tp1, tp2: payload.tp2, tp3: payload.tp3, tp4: payload.tp4, tp5: payload.tp5,
    reason: payload.reason || '',
    extraRole: payload.extraRole || '',
    plan: payload.plan || { TP1:null, TP2:null, TP3:null, TP4:null, TP5:null },
    status: STATUS.RUN_VALID,
    validReentry: true,
    latestTpHit: null,
    fills: [],
    tpHits: { TP1:false, TP2:false, TP3:false, TP4:false, TP5:false },
    finalR: null,
    messageId: null,
    jumpUrl: null,
    channelId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    closedAt: undefined,
  });

  await saveSignal(signal);

  const msgId = await postSignalMessage(signal);
  signal.messageId = msgId;

  const channel = await client.channels.fetch(signal.channelId);
  const msg = await channel.messages.fetch(msgId);
  signal.jumpUrl = msg.url;

  await updateSignal(signal.id, { messageId: signal.messageId, jumpUrl: signal.jumpUrl });
  await createControlThread(signal);
  await updateSummary();

  return signal;
}

// ------------------------------
// Recap math/rendering
// ------------------------------
function calcFinalR(signal) {
  const s = normalizeSignal(signal);
  if (isNum(s.finalR)) return Number(s.finalR);
  if (!isNum(s.entry) || !isNum(s.sl)) return 0;

  const baseRisk = s.direction === DIR.LONG
    ? (Number(s.entry) - Number(s.slOriginal ?? s.sl))
    : (Number(s.slOriginal ?? s.sl) - Number(s.entry));
  if (baseRisk <= 0) return 0;

  let total = 0;
  for (const f of (s.fills || [])) {
    const pct = Number(f.pct || 0) / 100;
    const price = Number(f.price);
    if (!pct || !isNum(price)) continue;
    const r = rAtPrice(s.direction, s.entry, (s.slOriginal ?? s.sl), price);
    if (r === null) continue;
    total += pct * r;
  }
  // Clamp tiny noise to 0
  if (Math.abs(total) < 1e-6) total = 0;
  return Number(total.toFixed(4));
}

function computeRecapKPIs(trades) {
  const items = trades.map(s => ({ s, r: calcFinalR(s) }));
  const n = items.length;
  const wins = items.filter(i => i.r > 0).length;
  const losses = items.filter(i => i.r < 0).length;
  const be = items.filter(i => Math.abs(i.r) < 1e-9).length;
  const totalR = items.reduce((a, i) => a + i.r, 0);
  const avgR = n ? totalR / n : 0;
  const best = n ? Math.max(...items.map(i => i.r)) : 0;
  const worst = n ? Math.min(...items.map(i => i.r)) : 0;

  // Per-asset breakdown
  const byAsset = {};
  for (const i of items) {
    const a = (i.s.asset || 'UNKNOWN').toUpperCase();
    if (!byAsset[a]) byAsset[a] = { n:0, wins:0, total:0 };
    byAsset[a].n += 1;
    if (i.r > 0) byAsset[a].wins += 1;
    byAsset[a].total += i.r;
  }

  return { n, wins, losses, be, winRate: n ? (wins / n) * 100 : 0, totalR, avgR, best, worst, items, byAsset };
}

function renderKPIs(k) {
  const lines = [];
  lines.push(`Closed trades: ${k.n}  |  Wins: ${k.wins}  Losses: ${k.losses}  BE: ${k.be}  |  Win rate: ${k.winRate.toFixed(1)}%`);
  lines.push(`Total R: ${k.totalR >= 0 ? '+' : ''}${k.totalR.toFixed(2)}R   |  Avg R/trade: ${k.avgR >= 0 ? '+' : ''}${k.avgR.toFixed(2)}R`);
  if (k.n) {
    lines.push(`Best: ${k.best >= 0 ? '+' : ''}${k.best.toFixed(2)}R  |  Worst: ${k.worst >= 0 ? '+' : ''}${k.worst.toFixed(2)}R`);
  }
  const assets = Object.entries(k.byAsset);
  if (assets.length) {
    lines.push(`\nPer-asset:`);
    for (const [asset, v] of assets) {
      const wr = v.n ? (v.wins / v.n) * 100 : 0;
      lines.push(`• ${asset} — Trades: ${v.n}  |  Win rate: ${wr.toFixed(0)}%  |  Total: ${v.total >= 0 ? '+' : ''}${v.total.toFixed(2)}R`);
    }
  }
  return lines.join('\n');
}

function renderTradeLines(trades) {
  const items = trades.map(s => ({ s, r: calcFinalR(s) }));
  const emoji = (r) => r > 0 ? '✅' : (r < 0 ? '❌' : '➖');
  const lines = [];
  for (const { s, r } of items) {
    const date = isNum(s.closedAt) ? fmtISODate(s.closedAt) : (s.updatedAt ? fmtISODate(s.updatedAt) : '');
    const dir = (s.direction || '').toUpperCase();
    const link = s.jumpUrl ? s.jumpUrl : '';
    lines.push(`${emoji(r)} ${s.asset} ${dir}  |  ${r >= 0 ? '+' : ''}${r.toFixed(2)}R  |  ${date}  |  ${link}`);
  }
  return lines.join('\n');
}

// ------------------------------
// One-time ghost prune (storage hygiene)
// ------------------------------
async function pruneGhostSignals() {
  try {
    const all = (await getSignals()).map(normalizeSignal);
    for (const s of all) {
      if (!s.messageId || !s.channelId) continue;
      let exists = true;
      try {
        const ch = await client.channels.fetch(s.channelId);
        await ch.messages.fetch(s.messageId);
      } catch {
        exists = false;
      }
      if (!exists) {
        await deleteSignal(s.id).catch(() => {});
        await deleteControlThread(s.id).catch(() => {});
        console.log(`🧹 pruned ghost signal ${s.id}`);
      }
    }
  } catch (e) {
    console.error('pruneGhostSignals error:', e);
  }
}

client.login(config.token);