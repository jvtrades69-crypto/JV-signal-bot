// index.js — JV Signal Bot (stable, Sep 2025)
// - Plain text messages (uses renders from embeds.js)
// - TP plans + auto-exec
// - Simplified controls (4 update buttons)
// - HARD PURGE summary (with try/catch), always refresh on every change
// - One-time TP buttons (TP1–TP5)
// - Final-R optional override for Fully Close / Stopped BE / Stopped Out
// - No smart re-tagging on edits
// - Manual delete watcher (remove from DB + delete control thread)
// - Global error guards so the worker does not exit

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
import fs from 'fs-extra';
import config from './config.js';
import {
  saveSignal, getSignal, getSignals, updateSignal, deleteSignal,
  getThreadId, setThreadId
} from './store.js';
import { renderSignalText, renderSummaryText } from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

// ---- global error catcher so bot doesn’t crash ----
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
  // track one-time TP hits
  s.tpHits = s.tpHits && typeof s.tpHits === 'object' ? s.tpHits : { TP1:false, TP2:false, TP3:false, TP4:false, TP5:false };
  // optional final-R override for closures
  if (s.finalR !== undefined && s.finalR !== null && !isNum(s.finalR)) delete s.finalR;
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
  const found = extraRoleRaw.match(/\d{6,}/g);
  if (found) ids.push(...found);
  return Array.from(new Set(ids));
}
function buildMentions(defaultRoleId, extraRoleRaw, forEdit = false) {
  const ids = extractRoleIds(defaultRoleId, extraRoleRaw);
  const content = ids.length ? ids.map(id => `<@&${id}>`).join(' ') : '';
  // On initial send we allowRoles to ping; on edits we suppress pings entirely
  if (forEdit) return { content, allowedMentions: { parse: [] } };
  if (!ids.length) return { content: '', allowedMentions: { parse: [] } };
  return { content, allowedMentions: { parse: [], roles: ids } };
}

// ------------------------------
// Posting / Editing messages
// ------------------------------
async function postSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const rrChips = computeRRChips(signal);
  const text = renderSignalText(normalizeSignal(signal), rrChips, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole, false);

  const sent = await channel.send({
    content: `${text}${mentionLine ? `\n\n${mentionLine}` : ''}`,
    ...(mentionLine ? { allowedMentions } : {})
  });
  return sent.id;
}

async function editSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (!msg) return false;
  const rrChips = computeRRChips(signal);
  const text = renderSignalText(normalizeSignal(signal), rrChips, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole, true);

  await msg.edit({
    content: `${text}${mentionLine ? `\n\n${mentionLine}` : ''}`,
    ...(mentionLine ? { allowedMentions } : { allowedMentions: { parse: [] } })
  }).catch(() => {});
  return true;
}

async function deleteSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
}

// ------------------------------
// Summary (HARD PURGE + post fresh)
// ------------------------------
async function hardPurgeChannel(channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    while (true) {
      const batch = await channel.messages.fetch({ limit: 100 }).catch((e) => {
        console.error('purge: fetch failed', e);
        return null;
      });
      if (!batch || batch.size === 0) break;

      const young = batch.filter(m => (Date.now() - m.createdTimestamp) < 13 * 24 * 60 * 60 * 1000);
      if (young.size > 1) {
        try { await channel.bulkDelete(young, true); }
        catch (e) { console.error('purge: bulkDelete failed', e); }
      }
      const oldies = batch.filter(m => !young.has(m.id));
      for (const m of oldies.values()) {
        try { await m.delete(); } catch (e) { console.error('purge: single delete failed', e); }
      }
      if (batch.size < 100) break;
    }
  } catch (e) {
    console.error('hardPurgeChannel outer error:', e);
  }
}

async function updateSummary() {
  try {
    await hardPurgeChannel(config.currentTradesChannelId);
    const channel = await client.channels.fetch(config.currentTradesChannelId);
    const signals = (await getSignals()).map(normalizeSignal);
    const active = signals.filter(s => s.status === STATUS.RUN_VALID && s.validReentry === true);
    const text = renderSummaryText(active);
    await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(e => console.error('summary send failed:', e));
  } catch (e) {
    console.error('updateSummary error:', e);
  }
}

// ------------------------------
// Control UI (TPs + updates + closes)
// ------------------------------
function controlRows(signalId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tp1_${signalId}`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp2_${signalId}`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp3_${signalId}`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Success)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tp4_${signalId}`).setLabel('🎯 TP4 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp5_${signalId}`).setLabel('🎯 TP5 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`upd_tpprices_${signalId}`).setLabel('✏️ Update TP Prices').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`upd_plan_${signalId}`).setLabel('✏️ Update TP % Plan').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`upd_trade_${signalId}`).setLabel('✏️ Update Trade Info').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`upd_roles_${signalId}`).setLabel('✏️ Update Role Mention').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`fullclose_${signalId}`).setLabel('✅ Fully Close').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`stopbe_${signalId}`).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`stopped_${signalId}`).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
  );
  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`del_${signalId}`).setLabel('❌ Delete').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2, row3, row4];
}

async function createControlThread(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
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
  const modal = new ModalBuilder().setCustomId(`modal_tp_${tpKey}_${id}`).setTitle(`${tpKey.toUpperCase()} Hit`);
  const pct = new TextInputBuilder()
    .setCustomId('tp_pct')
    .setLabel('Close % (0 - 100; leave blank to skip)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(pct));
  return modal;
}

function makeUpdateTPPricesModal(id) {
  const modal = new ModalBuilder().setCustomId(`modal_tpprices_${id}`).setTitle('Update TP Prices (TP1–TP5)');
  for (const [cid, label] of [['upd_tp1','TP1'],['upd_tp2','TP2'],['upd_tp3','TP3'],['upd_tp4','TP4'],['upd_tp5','TP5']]) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false)
    ));
  }
  return modal;
}

function makeUpdatePlanModal(id) {
  const modal = new ModalBuilder().setCustomId(`modal_plan_${id}`).setTitle('Update TP % Plan (0–100)');
  for (const t of ['tp1','tp2','tp3','tp4','tp5']) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`plan_${t}`).setLabel(`${t.toUpperCase()} planned %`).setStyle(TextInputStyle.Short).setRequired(false)
    ));
  }
  return modal;
}

function makeUpdateTradeInfoModal(id) {
  const modal = new ModalBuilder().setCustomId(`modal_trade_${id}`).setTitle('Update Trade Info');
  const fields = [
    ['upd_entry', 'Entry', TextInputStyle.Short],
    ['upd_sl', 'SL', TextInputStyle.Short],
    ['upd_asset', 'Asset (e.g., BTC, ETH, SOL)', TextInputStyle.Short],
    ['upd_dir', 'Direction (LONG/SHORT)', TextInputStyle.Short],
    ['upd_reason', 'Reason (optional)', TextInputStyle.Paragraph],
  ];
  for (const [cid, label, style] of fields) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(style).setRequired(false)
    ));
  }
  return modal;
}

function makeUpdateRolesModal(id) {
  const modal = new ModalBuilder().setCustomId(`modal_roles_${id}`).setTitle('Update Role Mention(s)');
  const input = new TextInputBuilder()
    .setCustomId('roles_input')
    .setLabel('Enter one or more roles (IDs or @mentions)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(input));
  return modal;
}

function makeFullCloseModal(id) {
  const modal = new ModalBuilder().setCustomId(`modal_full_${id}`).setTitle('Fully Close Position');
  const price = new TextInputBuilder().setCustomId('close_price').setLabel('Close Price').setStyle(TextInputStyle.Short).setRequired(true);
  const pct = new TextInputBuilder().setCustomId('close_pct').setLabel('Close % (default = remaining)').setStyle(TextInputStyle.Short).setRequired(false);
  const finalR = new TextInputBuilder()
  .setCustomId('final_r')
  .setLabel('Final R (optional)')
  .setPlaceholder('e.g., 0, -0.5, -1 — overrides calc')
  .setStyle(TextInputStyle.Short)
  .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(price));
  modal.addComponents(new ActionRowBuilder().addComponents(pct));
  modal.addComponents(new ActionRowBuilder().addComponents(finalR));
  return modal;
}

function makeFinalRModal(id, kind) {
  const modal = new ModalBuilder().setCustomId(`modal_finalr_${kind}_${id}`).setTitle(kind === 'BE' ? 'Stopped Breakeven' : 'Stopped Out');
  const r = new TextInputBuilder()
  .setCustomId('final_r')
  .setLabel('Final R (optional)')
  .setPlaceholder('e.g., 0, -0.5, -1 — overrides calc')
  .setStyle(TextInputStyle.Short)
  .setRequired(false);

  modal.addComponents(new ActionRowBuilder().addComponents(r));
  return modal;
}

// ------------------------------
// Helpers to avoid 10062 + persist custom-asset flow
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


// ---- Filesystem-based idempotency (works across multiple processes) ----
const IX_DIR = './.ix';
await fs.ensureDir(IX_DIR);
async function tryClaimInteraction(id) {
  const p = `${IX_DIR}/${id}`;
  try {
    await fs.writeFile(p, String(Date.now()), { flag: 'wx' }); // exclusive create
    return true;
  } catch (e) {
    if (e && (e.code === 'EEXIST' || e.code === 'EISDIR')) return false;
    return false;
  }
}
// cleanup old marks on boot (older than 24h)
(async () => {
  try {
    const files = await fs.readdir(IX_DIR);
    const now = Date.now();
    for (const f of files) {
      try {
        const stat = await fs.stat(`${IX_DIR}/${f}`);
        if (now - stat.mtimeMs > 24*60*60*1000) await fs.remove(`${IX_DIR}/${f}`);
      } catch {}
    }
  } catch {}
})();
  } catch {}
  try {
    return await interaction.editReply(payload);
  } catch (e) {
    try {
      if (!interaction.replied) {
        return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
      }
    } catch {}
    throw e;
  }
}


const PENDING_PATH = './.pending.json';
async function pendLoad() { try { return await fs.readJson(PENDING_PATH); } catch { return {}; } }
async function pendSave(obj) { try { await fs.writeJson(PENDING_PATH, obj, { spaces: 0 }); } catch {} }
let pendingSignals = await pendLoad();

// ------------------------------
// Bot lifecycle
// ------------------------------
client.once('ready', () => console.log(`✅ Logged in as ${client.user.tag}`));

// Manual delete watcher (Signals channel)
client.on('messageDelete', async (message) => {
  try {
    if (!message || message.channelId !== config.signalsChannelId) return;
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
// Interactions
// ------------------------------
client.on('interactionCreate', async (interaction) => {
  if (!(await tryClaimInteraction(interaction.id))) return;
  try {
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

      if (assetSel === 'OTHER') {
        const pid = nano();
        const modal = new ModalBuilder().setCustomId(`modal_asset_${pid}`).setTitle('Enter custom asset');
        const input = new TextInputBuilder().setCustomId('asset_value').setLabel('Asset (e.g., PEPE, XRP)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        pendingSignals[pid] = {
          direction, entry, sl, tp1, tp2, tp3, tp4, tp5, reason, extraRole,
          plan: {
            TP1: isNum(tp1_pct) ? Number(tp1_pct) : null,
            TP2: isNum(tp2_pct) ? Number(tp2_pct) : null,
            TP3: isNum(tp3_pct) ? Number(tp3_pct) : null,
            TP4: isNum(tp4_pct) ? Number(tp4_pct) : null,
            TP5: isNum(tp5_pct) ? Number(tp5_pct) : null,
          },
          ts: Date.now()
        };
        await pendSave(pendingSignals);
        return interaction.showModal(modal);
      }

      await ensureDeferred(interaction);
      await createSignal({
        asset: assetSel,
        direction,
        entry, sl, tp1, tp2, tp3, tp4, tp5,
        reason, extraRole,
        plan: {
          TP1: isNum(tp1_pct) ? Number(tp1_pct) : null,
          TP2: isNum(tp2_pct) ? Number(tp2_pct) : null,
          TP3: isNum(tp3_pct) ? Number(tp3_pct) : null,
          TP4: isNum(tp4_pct) ? Number(tp4_pct) : null,
          TP5: isNum(tp5_pct) ? Number(tp5_pct) : null,
        }
      });
      return safeEditReply(interaction, { content: '✅ Trade signal posted.' });
    }

    // custom asset modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_asset_')) {
      await ensureDeferred(interaction);
      const pid = interaction.customId.replace('modal_asset_', '');
      pendingSignals = await pendLoad();
      const stash = pendingSignals[pid];
      delete pendingSignals[pid];
      await pendSave(pendingSignals);
      if (!stash) return safeEditReply(interaction, { content: '❌ Session expired. Try /signal again.' });
      const asset = interaction.fields.getTextInputValue('asset_value').trim().toUpperCase();
      await createSignal({ asset, ...stash });
      return safeEditReply(interaction, { content: `✅ Trade signal posted for ${asset}.` });
    }

    // ===== UPDATE FLOWS =====

    // Update TP Prices (TP1–TP5)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_tpprices_')) {
      await ensureDeferred(interaction);
      const id = interaction.customId.replace('modal_tpprices_', '');
      const signal = await getSignal(id);
      if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

      const patch = {};
      for (const k of ['tp1','tp2','tp3','tp4','tp5']) {
        const v = interaction.fields.getTextInputValue(`upd_${k}`)?.trim();
        if (v !== undefined && v !== '') patch[k] = v;
      }

      await updateSignal(id, patch);
      const updated = normalizeSignal(await getSignal(id));
      if (isSlMovedToBE(updated)) { updated.validReentry = false; await updateSignal(id, { validReentry: false }); }

      await editSignalMessage(updated);
      await updateSummary();
      return safeEditReply(interaction, { content: '✅ TP prices updated.' });
    }

    // Update TP % Plan
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_plan_')) {
      await ensureDeferred(interaction);
      const id = interaction.customId.replace('modal_plan_', '');
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

    // Update Trade Info
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_trade_')) {
      await ensureDeferred(interaction);
      const id = interaction.customId.replace('modal_trade_', '');
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

    // Update Role Mention(s)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_roles_')) {
      await ensureDeferred(interaction);
      const id = interaction.customId.replace('modal_roles_', '');
      const signal = await getSignal(id);
      if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

      const rolesRaw = interaction.fields.getTextInputValue('roles_input') ?? '';
      await updateSignal(id, { extraRole: rolesRaw });

      await editSignalMessage(normalizeSignal(await getSignal(id)));
      await updateSummary();
      return safeEditReply(interaction, { content: '✅ Role mentions updated.' });
    }

    // TP Hit modal submit (optional %; one-time)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_tp_')) {
      await ensureDeferred(interaction);
      const [_prefix, _tp, tpKey, id] = interaction.customId.split('_'); // modal_tp_tp1_<id>
      let signal = normalizeSignal(await getSignal(id));
      if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

      const tpUpper = tpKey.toUpperCase();
      if (signal.tpHits?.[tpUpper]) {
        return safeEditReply(interaction, { content: `${tpUpper} already recorded.` });
      }

      const pctRaw = interaction.fields.getTextInputValue('tp_pct')?.trim();
      const hasPct = pctRaw !== undefined && pctRaw !== null && pctRaw !== '';
      const pct = hasPct ? Number(pctRaw) : null;
      if (hasPct && (isNaN(pct) || pct < 0 || pct > 100)) {
        return safeEditReply(interaction, { content: '❌ Close % must be between 0 and 100 (or leave blank to skip).' });
      }
      const tpPrice = signal[tpKey];
      if (hasPct && pct > 0 && isNum(tpPrice)) {
        // avoid duplicate fills
        const already = (signal.fills || []).some(f => String(f.source).toUpperCase() === tpUpper);
        if (!already) signal.fills.push({ pct: Number(pct), price: Number(tpPrice), source: tpUpper });
      }
      signal.latestTpHit = tpUpper;
      signal.tpHits[tpUpper] = true;

      await updateSignal(id, { fills: signal.fills, latestTpHit: signal.latestTpHit, tpHits: signal.tpHits });
      await editSignalMessage(signal);
      await updateSummary();
      return safeEditReply(interaction, { content: `✅ ${tpUpper} recorded${hasPct && pct > 0 ? ` (${pct}%).` : '.'}` });
    }

    // Fully close modal (optional final R override)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_full_')) {
      await ensureDeferred(interaction);
      const id = interaction.customId.replace('modal_full_', '');
      let signal = normalizeSignal(await getSignal(id));
      if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

      const finalRStr = interaction.fields.getTextInputValue('final_r')?.trim();
      const hasFinalR = finalRStr !== undefined && finalRStr !== '';
      if (hasFinalR && !isNum(finalRStr)) {
        return safeEditReply(interaction, { content: '❌ Final R must be a number if provided.' });
      }

      if (hasFinalR) {
        // override path
        signal.finalR = Number(finalRStr);
      } else {
        // normal path (price + %)
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

    // Final R modal (Stopped BE / Stopped Out) — optional override
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_finalr_')) {
      await ensureDeferred(interaction);
      const parts = interaction.customId.split('_'); // modal_finalr_BE_<id>
      const kind = parts[2];
      const id = parts.slice(3).join('_');
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
        // derive price for remaining if no override; we just add a fill for completeness
        let price = null;
        if (signal.direction === DIR.LONG) {
          price = Number(signal.entry); // BE defaults to entry; OUT approximates SL
          if (kind !== 'BE') price = Number(signal.slOriginal ?? signal.sl);
        } else {
          price = Number(signal.entry);
          if (kind !== 'BE') price = Number(signal.slOriginal ?? signal.sl);
        }
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

    // ===== Buttons =====
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', flags: MessageFlags.Ephemeral });
      }
      const [action, id] = interaction.customId.split('_');
      if (!id) return interaction.reply({ content: 'Bad button ID.', flags: MessageFlags.Ephemeral });

      if (action === 'upd_tpprices') return interaction.showModal(makeUpdateTPPricesModal(id));
      if (action === 'upd_plan')     return interaction.showModal(makeUpdatePlanModal(id));
      if (action === 'upd_trade')    return interaction.showModal(makeUpdateTradeInfoModal(id));
      if (action === 'upd_roles')    return interaction.showModal(makeUpdateRolesModal(id));
      if (action === 'fullclose')    return interaction.showModal(makeFullCloseModal(id));
      if (action === 'stopbe')       return interaction.showModal(makeFinalRModal(id, 'BE'));
      if (action === 'stopped')      return interaction.showModal(makeFinalRModal(id, 'OUT'));

      if (action === 'del') {
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

      if (['tp1','tp2','tp3','tp4','tp5'].includes(action)) {
        await ensureDeferred(interaction);
        const sig = normalizeSignal(await getSignal(id));
        if (!sig) return safeEditReply(interaction, { content: 'Signal not found.' });

        const tpUpper = action.toUpperCase();
        if (sig.tpHits?.[tpUpper]) {
          return safeEditReply(interaction, { content: `${tpUpper} already recorded.` });
        }

        const planPct = sig.plan?.[tpUpper];
        const tpPrice = sig[action];

        if (isNum(planPct) && Number(planPct) > 0 && isNum(tpPrice)) {
          // avoid duplicate fills
          const already = (sig.fills || []).some(f => String(f.source).toUpperCase() === tpUpper);
          if (!already) sig.fills.push({ pct: Number(planPct), price: Number(tpPrice), source: tpUpper });
          sig.latestTpHit = tpUpper;
          sig.tpHits[tpUpper] = true;

          await updateSignal(id, { fills: sig.fills, latestTpHit: sig.latestTpHit, tpHits: sig.tpHits });
          await editSignalMessage(sig);
          await updateSummary();
          return safeEditReply(interaction, { content: `✅ ${tpUpper} executed (${planPct}%).` });
        }

        const modal = makeTPModal(id, action);
        if (isNum(planPct)) modal.components[0].components[0].setValue(String(planPct));
        return interaction.showModal(modal);
      }

      return interaction.reply({ content: 'Unknown action.', flags: MessageFlags.Ephemeral });
    }
  } catch (err) {
    console.error('interaction error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await safeEditReply(interaction, { content: '❌ Internal error.' });
      } else {
        await interaction.reply({ content: '❌ Internal error.', flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
});

// ------------------------------
// Create & Save Signal
// ------------------------------
async function createSignal(payload) {
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
    jumpUrl: null
  });

  await saveSignal(signal);

  const msgId = await postSignalMessage(signal);
  signal.messageId = msgId;

  const channel = await client.channels.fetch(config.signalsChannelId);
  const msg = await channel.messages.fetch(msgId);
  signal.jumpUrl = msg.url;

  await updateSignal(signal.id, { messageId: signal.messageId, jumpUrl: signal.jumpUrl });
  await createControlThread(signal);
  await updateSummary();

  return signal;
}

client.login(config.token);
