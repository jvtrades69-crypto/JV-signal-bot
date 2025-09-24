// index.js — JV Signal Bot (stable)
// + createdAt (for monthly), monthly recap
// + SL→BE persistence: beSet (bool) + beMovedAfter ('TP1' | null)
//   - On press: beSet=true. If TP1 already hit, beMovedAfter='TP1'; else null.
//   - Later TP hits: only TP1 can set beMovedAfter='TP1' (never TP2–TP5).
//   - We never upgrade beyond TP1 label.

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
import { renderSignalText, renderSummaryText, renderRecapText, renderMonthlyRecap } from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// ---- global error catcher ----
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException',  (err) => console.error('uncaughtException:', err));

// ------------------------------
// Utility & core signal helpers
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
  s.tpHits = s.tpHits && typeof s.tpHits === 'object' ? s.tpHits : { TP1:false, TP2:false, TP3:false, TP4:false, TP5:false };
  if (s.finalR !== undefined && s.finalR !== null && !isNum(s.finalR)) delete s.finalR;
  if (!isNum(s.maxR)) s.maxR = null;
  s.chartUrl = s.chartUrl || null;
  s.chartAttached = !!s.chartAttached;

  // NEW persisted fields (backward compatible)
  s.beSet = Boolean(s.beSet);              // pressed SL→BE at least once
  s.beMovedAfter = s.beMovedAfter || null; // only 'TP1' or null by our rule
  s.createdAt = isNum(s.createdAt) ? Number(s.createdAt) : s.createdAt || null;

  return s;
}

function isSlMovedToBE(signal) {
  const s = normalizeSignal(signal);
  return s.status === STATUS.RUN_VALID && isNum(s.entry) && isNum(s.sl) && Number(s.entry) === Number(s.sl);
}

// ------------------------------
// Mentions
// ------------------------------
function extractRoleIds(defaultRoleId, extraRoleRaw) {
  const ids = [];
  if (defaultRoleId) ids.push(defaultRoleId);
  if (extraRoleRaw) {
    const found = `${extraRoleRaw}`.match(/\d{6,}/g);
    if (found) ids.push(...found);
  }
  return Array.from(new Set(ids));
}
function buildMentions(defaultRoleId, extraRoleRaw, forEdit = false) {
  const ids = extractRoleIds(defaultRoleId, extraRoleRaw);
  const content = ids.length ? ids.map(id => `<@&${id}>`).join(' ') : '';
  if (forEdit && ids.length) return { content, allowedMentions: { roles: ids } };
  if (!ids.length) return { content: '', allowedMentions: { parse: [] } };
  return { content, allowedMentions: { roles: ids } };
}

// ------------------------------
// Ack helpers
// ------------------------------
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
// Thread title helpers
// ------------------------------
function computeRealizedR(signal) {
  const fills = Array.isArray(signal.fills) ? signal.fills : [];
  if (!fills.length) return 0;
  let sum = 0;
  for (const f of fills) {
    const pct = Number(f.pct || 0);
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, f.price);
    if (isNaN(pct) || r === null) continue;
    sum += (pct * r) / 100;
  }
  return Number(sum.toFixed(2));
}

function rToTitlePiece(r) {
  const x = Number(r || 0);
  if (!isFinite(x) || x === 0) return '';
  return ` ${x > 0 ? '+' : ''}${x.toFixed(2)}`;
}

function computeThreadName(signal) {
  const base = `${String(signal.asset).toUpperCase()} ${signal.direction === DIR.SHORT ? 'short' : 'long'}`;
  if (signal.status === STATUS.STOPPED_OUT) return `${base} stopped out`;
  if (signal.status === STATUS.STOPPED_BE)  return `${base} breakeven`;
  if (signal.status === STATUS.CLOSED) {
    const r = isNum(signal.finalR) ? Number(signal.finalR) : computeRealizedR(signal);
    return `${base}${rToTitlePiece(r)}`;
  }
  const r = computeRealizedR(signal);
  if (r !== 0) return `${base}${rToTitlePiece(r)}`;
  if (isNum(signal.maxR) && Number(signal.maxR) !== 0) return `${base}${rToTitlePiece(Number(signal.maxR))}`;
  return base;
}

async function renameControlThread(signal) {
  try {
    const tid = await getThreadId(signal.id);
    if (!tid) return;
    const thread = await client.channels.fetch(tid).catch(() => null);
    if (!thread || !thread.isThread?.()) return;
    const desired = computeThreadName(signal);
    if (thread.name !== desired) {
      await thread.setName(desired).catch(() => {});
    }
  } catch {}
}

// ------------------------------
// Posting / Editing messages
// ------------------------------
async function postSignalMessage(signal) {
  const channel = await client.channels.fetch(signal.channelId);
  const rrChips = computeRRChips(signal);
  const text = renderSignalText(normalizeSignal(signal), rrChips, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole, false);

  const payload = {
    content: `${text}${mentionLine ? `\n\n${mentionLine}` : ''}`,
    ...(mentionLine ? { allowedMentions } : {}),
  };

  if (signal.chartUrl && signal.chartAttached) {
    payload.files = [signal.chartUrl];
  }

  const sent = await channel.send(payload);
  return sent.id;
}

async function editSignalMessage(signal) {
  const channel = await client.channels.fetch(signal.channelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (!msg) return false;

  const rrChips = computeRRChips(signal);
  const text = renderSignalText(normalizeSignal(signal), rrChips, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole, true);

  const editPayload = {
    content: `${text}${mentionLine ? `\n\n${mentionLine}` : ''}`,
    ...(mentionLine ? { allowedMentions } : { allowedMentions: { parse: [] } })
  };

  if (!signal.chartAttached) {
    editPayload.attachments = [];
    editPayload.files = [];
  }

  await msg.edit(editPayload).catch(() => {});
  renameControlThread(signal).catch(() => {});
  return true;
}

async function deleteSignalMessage(signal) {
  const channel = await client.channels.fetch(signal.channelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
}

// ------------------------------
// Summary (debounced)
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

      const recent = await summaryChannel.messages.fetch({ limit: 10 }).catch(() => null);
      let existing = null;
      if (recent && recent.size) {
        existing = Array.from(recent.values()).find(m => m.author?.id === client.user.id && !m.system);
      }

      if (existing) {
        await existing.edit({ content, allowedMentions: { parse: [] } }).catch(() => {});
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
// Control UI (TPs + updates + closes)
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
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'setbe')).setLabel('🟨 Set SL → BE').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:maxr')).setLabel('📈 Set Max R').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:chart')).setLabel('🖼️ Set/Replace Chart Link').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3, row4];
}

async function createControlThread(signal) {
  const channel = await client.channels.fetch(signal.channelId);
  const initialName = computeThreadName(signal);
  const thread = await channel.threads.create({
    name: initialName,
    type: ChannelType.PrivateThread,
    invitable: false
  });
  await thread.members.add(config.ownerId).catch(() => {});
  await setThreadId(signal.id, thread.id);
  await thread.send({ content: 'Owner Control Panel', components: controlRows(signal.id) }).catch(() => {});
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
function makeMaxRModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'maxr')).setTitle('Set Max R Reached');
  const r = new TextInputBuilder().setCustomId('max_r').setLabel('Max R reached (number, no + sign)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('e.g., 1.5');
  m.addComponents(new ActionRowBuilder().addComponents(r));
  return m;
}
function makeChartModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'chart')).setTitle('Set / Replace Chart Link');
  const url = new TextInputBuilder().setCustomId('chart_url').setLabel('Image URL (https://...)').setStyle(TextInputStyle.Short).setRequired(true);
  m.addComponents(new ActionRowBuilder().addComponents(url));
  return m;
}

// === Recap modal ===
function makeRecapModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'recap')).setTitle('Post Trade Recap');
  m.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('recap_reason').setLabel('Trade Reason (bullets)').setStyle(TextInputStyle.Paragraph).setRequired(false)
  ));
  m.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('recap_confs').setLabel('Entry Confluences (bullets)').setStyle(TextInputStyle.Paragraph).setRequired(false)
  ));
  m.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('recap_notes').setLabel('Notes (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false)
  ));
  return m;
}

// ------------------------------
// Bot lifecycle
// ------------------------------
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await pruneGhostSignals().catch(() => {});
});

client.on('messageDelete', async (message) => {
  try {
    if (!message) return;
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

// Pick most recent signal (prefers current channel)
async function pickMostRecentSignal(channelId) {
  const all = (await getSignals()).map(normalizeSignal).filter(s => s.messageId);
  const inChan = all.filter(s => s.channelId === channelId);
  const list = inChan.length ? inChan : all;
  if (!list.length) return null;
  list.sort((a,b) => (BigInt(b.messageId) - BigInt(a.messageId)));
  for (const s of list) {
    try {
      const ch = await client.channels.fetch(s.channelId);
      await ch.messages.fetch(s.messageId);
      return s;
    } catch {}
  }
  return null;
}

// ------------------------------
// Interaction router
// ------------------------------
client.on('interactionCreate', async (interaction) => {
  try {
    if (!tryClaimInteraction(interaction)) return;

    // /signal
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', flags: MessageFlags.Ephemeral });
      }

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

      const chartAtt  = interaction.options.getAttachment?.('chart');

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
          chartUrl: chartAtt?.url || null,
          chartAttached: !!chartAtt?.url,
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
        },
        chartUrl: chartAtt?.url || null,
        chartAttached: !!chartAtt?.url,
      }, interaction.channelId);
      return safeEditReply(interaction, { content: '✅ Trade signal posted.' });
    }

    // === /recap (single trade OR monthly) ===
    if (interaction.isChatInputCommand() && interaction.commandName === 'recap') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', flags: MessageFlags.Ephemeral });
      }

      const period = interaction.options.getString?.('period') || null;
      if (period === 'monthly') {
        const signals = (await getSignals()).map(normalizeSignal);
        const now = new Date();
        const y = now.getUTCFullYear();
        const m = now.getUTCMonth();
        const monthly = signals.filter(s => {
          if (!isNum(s.createdAt)) return false;
          const d = new Date(Number(s.createdAt));
          return d.getUTCFullYear() === y && d.getUTCMonth() === m;
        });
        const text = renderMonthlyRecap(monthly, y, m);
        return interaction.reply({ content: text, allowedMentions: { parse: [] } });
      }

      // Single-trade recap flow
      const explicitId = interaction.options.getString?.('id') || null;
      let signal = null;
      if (explicitId) signal = normalizeSignal(await getSignal(explicitId).catch(() => null));
      if (!signal) signal = await pickMostRecentSignal(interaction.channelId);

      if (!signal) {
        return interaction.reply({ content: '❌ No recent trade found to recap in this channel.', flags: MessageFlags.Ephemeral });
      }
      return interaction.showModal(makeRecapModal(signal.id));
    }

    // ===== MODALS =====
    if (interaction.isModalSubmit()) {
      const idPart = interaction.customId.split(':').pop();

      if (interaction.customId.startsWith('modal:asset:')) {
        await ensureDeferred(interaction);
        const stash = pendingSignals.get(idPart);
        pendingSignals.delete(idPart);
        if (!stash) return safeEditReply(interaction, { content: '❌ Session expired. Try /signal again.' });
        const asset = interaction.fields.getTextInputValue('asset_value').trim().toUpperCase();
        await createSignal({ asset, ...stash }, stash.channelId || interaction.channelId);
        return safeEditReply(interaction, { content: `✅ Trade signal posted for ${asset}.` });
      }

      if (interaction.customId.startsWith('modal:recap:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: '❌ Trade not found for recap.' });

        const reason = (interaction.fields.getTextInputValue('recap_reason') || '').trim();
        const confs  = (interaction.fields.getTextInputValue('recap_confs')  || '').trim();
        const notes  = (interaction.fields.getTextInputValue('recap_notes')  || '').trim();

        const rrChips = computeRRChips(signal);
        const recapText = renderRecapText(signal, {
          reasonLines: reason ? reason.split('\n').map(s => s.trim()).filter(Boolean) : [],
          confLines:   confs  ? confs.split('\n').map(s => s.trim()).filter(Boolean)  : [],
          notesLines:  notes  ? notes.split('\n').map(s => s.trim()).filter(Boolean)  : [],
        }, rrChips);

        const channel = await client.channels.fetch(interaction.channelId);
        const payload = { content: recapText, allowedMentions: { parse: [] } };
        if (signal.chartUrl) payload.files = [signal.chartUrl];
        await channel.send(payload);

        return safeEditReply(interaction, { content: '✅ Trade recap posted.' });
      }

      // Remaining modal handlers (TP prices / plan / trade / roles / maxR / chart / TP hit / full close / final R)
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
        await updateSignal(id, { ...patch });
        const updated = normalizeSignal(await getSignal(id));
        if (isSlMovedToBE(updated)) { updated.validReentry = false; await updateSignal(id, { validReentry: false }); }
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ TP prices updated.' });
      }

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
        await updateSignal(id, { plan: patchPlan });
        await editSignalMessage(normalizeSignal(await getSignal(id)));
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ TP % plan updated.' });
      }

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

        await updateSignal(id, patch);
        const updated = normalizeSignal(await getSignal(id));
        if (isSlMovedToBE(updated)) { updated.validReentry = false; await updateSignal(id, { validReentry: false }); }
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Trade info updated.' });
      }

      if (interaction.customId.startsWith('modal:roles:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const rolesRaw = interaction.fields.getTextInputValue('roles_input') ?? '';
        await updateSignal(id, { extraRole: rolesRaw });
        await editSignalMessage(normalizeSignal(await getSignal(id)));
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Role mentions updated.' });
      }

      if (interaction.customId.startsWith('modal:maxr:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });
        const raw = interaction.fields.getTextInputValue('max_r')?.trim();
        if (!isNum(raw)) return safeEditReply(interaction, { content: '❌ Max R must be a number.' });
        await updateSignal(id, { maxR: Number(raw) });
        await editSignalMessage(normalizeSignal(await getSignal(id)));
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Max R updated.' });
      }

      if (interaction.customId.startsWith('modal:chart:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });
        const url = interaction.fields.getTextInputValue('chart_url')?.trim();
        if (!url || !/^https?:\/\//i.test(url)) {
          return safeEditReply(interaction, { content: '❌ Please provide a valid http(s) URL.' });
        }
        await updateSignal(id, { chartUrl: url, chartAttached: false });
        await editSignalMessage(normalizeSignal(await getSignal(id)));
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Chart link updated.' });
      }

      if (interaction.customId.startsWith('modal:tp:')) {
        await ensureDeferred(interaction);
        const parts = interaction.customId.split(':');
        const tpKey = parts[2];           // tp1..tp5
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

        // mark TP hit
        signal.latestTpHit = tpUpper;
        signal.tpHits[tpUpper] = true;

        // BE label rule: ONLY TP1 can set the "after" marker
        const extra = {};
        if (signal.beSet && !signal.beMovedAfter && tpUpper === 'TP1') {
          signal.beMovedAfter = 'TP1';
          extra.beMovedAfter = 'TP1';
        }

        await updateSignal(id, {
          fills: signal.fills,
          latestTpHit: signal.latestTpHit,
          tpHits: signal.tpHits,
          ...extra
        });

        await editSignalMessage(signal);
        await updateSummary();
        return safeEditReply(interaction, { content: `✅ ${tpUpper} recorded${hasPct && pct > 0 ? ` (${pct}%).` : '.'}` });
      }

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

        await updateSignal(id, { fills: signal.fills, status: signal.status, validReentry: false, latestTpHit: latest, ...(hasFinalR ? { finalR: signal.finalR } : {}) });
        await editSignalMessage(signal);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Fully closed.' });
      }

      if (interaction.customId.startsWith('modal:finalr:')) {
        await ensureDeferred(interaction);
        const parts = interaction.customId.split(':');
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
          let price = null;
          price = Number(kind === 'BE' ? signal.entry : (signal.slOriginal ?? signal.sl));
          const remaining = 100 - (signal.fills || []).reduce((a, f) => a + Number(f.pct || 0), 0);
          if (remaining > 0 && isNum(price)) {
            signal.fills.push({ pct: remaining, price, source: kind === 'BE' ? 'STOP_BE' : 'STOP_OUT' });
          }
        }

        signal.status = (kind === 'BE') ? STATUS.STOPPED_BE : STATUS.STOPPED_OUT;
        signal.validReentry = false;

        await updateSignal(id, { fills: signal.fills, status: signal.status, validReentry: false, ...(hasFinalR ? { finalR: signal.finalR } : {}) });
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
      const parts = interaction.customId.split(':');
      const id = parts.pop();
      const key = parts.slice(1).join(':');

      if (key === 'upd:tpprices') return interaction.showModal(makeUpdateTPPricesModal(id));
      if (key === 'upd:plan')     return interaction.showModal(makeUpdatePlanModal(id));
      if (key === 'upd:trade')    return interaction.showModal(makeUpdateTradeInfoModal(id));
      if (key === 'upd:roles')    return interaction.showModal(makeUpdateRolesModal(id));
      if (key === 'fullclose')    return interaction.showModal(makeFullCloseModal(id));
      if (key === 'stopbe')       return interaction.showModal(makeFinalRModal(id, 'BE'));
      if (key === 'stopped')      return interaction.showModal(makeFinalRModal(id, 'OUT'));
      if (key === 'upd:maxr')     return interaction.showModal(makeMaxRModal(id));
      if (key === 'upd:chart')    return interaction.showModal(makeChartModal(id));

      if (key === 'setbe') {
        await ensureDeferred(interaction);
        const sig0 = normalizeSignal(await getSignal(id));
        if (!sig0) return safeEditReply(interaction, { content: 'Signal not found.' });
        if (!isNum(sig0.entry)) return safeEditReply(interaction, { content: '❌ Entry must be set to move SL to BE.' });

        // Only TP1 is considered for "after"
        const hasTP1 = Boolean(sig0.tpHits?.TP1);
        const patch = { sl: Number(sig0.entry), validReentry: false, beSet: true };
        if (!sig0.beMovedAfter && hasTP1) patch.beMovedAfter = 'TP1';

        await updateSignal(id, patch);
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ SL moved to breakeven.' });
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
        }

        // mark TP hit
        sig.latestTpHit = tpUpper;
        sig.tpHits[tpUpper] = true;

        // Only TP1 can set the "after" marker (and only if BE was pressed and not labeled yet)
        const extra = {};
        if (sig.beSet && !sig.beMovedAfter && tpUpper === 'TP1') {
          sig.beMovedAfter = 'TP1';
          extra.beMovedAfter = 'TP1';
        }

        await updateSignal(id, { fills: sig.fills, latestTpHit: sig.latestTpHit, tpHits: sig.tpHits, ...extra });
        await editSignalMessage(sig);
        await updateSummary();
        await ensureDeferred(interaction);
        return safeEditReply(interaction, { content: `✅ ${tpUpper} recorded${isNum(planPct) && Number(planPct) > 0 ? ` (${planPct}%).` : '.'}` });
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
const pendingSignals = new Map();

async function createSignal(payload, channelId) {
  const signal = normalizeSignal({
    id: nano(),
    createdAt: Date.now(), // NEW
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
    maxR: null,
    chartUrl: payload.chartUrl || null,
    chartAttached: !!payload.chartAttached,
    messageId: null,
    jumpUrl: null,
    channelId,
    beSet: false,
    beMovedAfter: null,
  });

  await saveSignal(signal);

  const msgId = await postSignalMessage(signal);
  signal.messageId = msgId;

  const channel = await client.channels.fetch(signal.channelId);
  const msg = await channel.messages.fetch(msgId);
  signal.jumpUrl = msg.url;

  await updateSignal(signal.id, { messageId: signal.messageId, jumpUrl: signal.jumpUrl });
  await createControlThread(signal);
  renameControlThread(signal).catch(() => {});
  await updateSummary();

  return signal;
}

// ------------------------------
// One-time ghost prune
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
