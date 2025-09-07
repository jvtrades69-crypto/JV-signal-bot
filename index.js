// index.js — JV Signal Bot (plain-text posts, TP plans + auto-exec, two-button updates, hard-purge summary)

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
  StringSelectMenuBuilder,
} from 'discord.js';

import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, getSignals, updateSignal, deleteSignal,
  getThreadId, setThreadId
} from './store.js';

import {
  renderSignalText,
  renderSummaryText,
} from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ------------------------------
// Utilities & Computations
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

function computeRealized(signal) {
  const fills = signal.fills || [];
  if (!fills.length) return { realized: 0, textParts: [] };
  let sum = 0;
  const parts = [];
  for (const f of fills) {
    const pct = Number(f.pct || 0);
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, f.price);
    if (!isNum(pct) || r === null) continue;
    sum += (pct * r) / 100;
    const src = String(f.source || '').toUpperCase();
    if (src.startsWith('TP')) parts.push(`${pct}% closed at ${src}`);
    else if (src === 'FINAL_CLOSE') parts.push(`${pct}% closed at ${f.price}`);
    else if (src === 'STOP_BE') parts.push(`${pct}% closed at BE`);
    else if (src === 'STOP_OUT') parts.push(`${pct}% closed at SL`);
  }
  return { realized: Number(sum.toFixed(2)), textParts: parts };
}

function normalizeSignal(raw) {
  const s = { ...raw };
  s.entry = toNumOrNull(s.entry);
  s.sl = toNumOrNull(s.sl);
  s.slOriginal = s.slOriginal ?? s.sl;
  for (const k of TP_KEYS) s[k] = toNumOrNull(s[k]);
  s.fills = Array.isArray(s.fills) ? s.fills : [];
  s.latestTpHit = s.latestTpHit || null; // 'TP1'...'TP5'
  s.status = s.status || STATUS.RUN_VALID;
  if (typeof s.validReentry !== 'boolean') s.validReentry = true;
  s.extraRole = s.extraRole || '';
  // plan percentages (TP1..TP5) — nullable numbers
  s.plan = s.plan && typeof s.plan === 'object' ? s.plan : {};
  for (const K of ['TP1','TP2','TP3','TP4','TP5']) {
    const v = s.plan[K];
    s.plan[K] = isNum(v) ? Number(v) : null;
  }
  return s;
}

// “show planned/executed % next to TP price”
function getExecOrPlannedPct(signal, tpKeyUC) {
  // sum executed for that TP first
  const exec = (signal.fills || [])
    .filter(f => String(f.source || '').toUpperCase() === tpKeyUC)
    .reduce((a, f) => a + Number(f.pct || 0), 0);
  if (exec > 0) return Math.round(exec);
  // otherwise planned
  const planned = signal.plan?.[tpKeyUC];
  return isNum(planned) ? Math.round(Number(planned)) : 0;
}

// “Active and SL == Entry after a TP hit” = SL moved to BE (still active)
function isSlMovedToBE(signal) {
  const s = normalizeSignal(signal);
  return s.status === STATUS.RUN_VALID && isNum(s.entry) && isNum(s.sl) && Number(s.entry) === Number(s.sl) && !!s.latestTpHit;
}

// Title chip builder (follows your final rules)
function buildTitleChip(signal) {
  const s = normalizeSignal(signal);
  const rr = computeRealized(s).realized;

  if (s.status === STATUS.STOPPED_OUT) {
    return { show: true, text: `Loss -${Math.abs(rr).toFixed(2)}R` };
  }
  if (s.status === STATUS.STOPPED_BE) {
    // if no TP was hit → pure breakeven
    const anyFill = (s.fills || []).length > 0;
    return { show: true, text: anyFill ? `Win +${rr.toFixed(2)}R` : 'Breakeven' };
  }
  if (s.status === STATUS.CLOSED) {
    return { show: true, text: `Win +${rr.toFixed(2)}R` };
  }
  // Active: show "+x.xxR so far" only if we have any partial fills
  if ((s.fills || []).length > 0) {
    return { show: true, text: `Win +${rr.toFixed(2)}R so far` };
  }
  return { show: false, text: '' };
}

// mentions
function extractRoleIds(defaultRoleId, extraRoleRaw) {
  const ids = [];
  if (defaultRoleId) ids.push(defaultRoleId);
  if (!extraRoleRaw) return ids;
  const found = extraRoleRaw.match(/\d{6,}/g);
  if (found) ids.push(...found);
  return Array.from(new Set(ids));
}
function buildMentions(defaultRoleId, extraRoleRaw) {
  const ids = extractRoleIds(defaultRoleId, extraRoleRaw);
  if (!ids.length) return { content: '', allowedMentions: { parse: [] } };
  return {
    content: ids.map(id => `<@&${id}>`).join(' '),
    allowedMentions: { parse: [], roles: ids }
  };
}

// ------------------------------
// Message Posting & Editing (plain text)
// ------------------------------
async function postSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const rrChips = computeRRChips(signal);
  const titleChip = buildTitleChip(signal);
  const text = renderSignalText(normalizeSignal(signal), rrChips, titleChip, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole);

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
  const titleChip = buildTitleChip(signal);
  const text = renderSignalText(normalizeSignal(signal), rrChips, titleChip, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole);

  await msg.edit({
    content: `${text}${mentionLine ? `\n\n${mentionLine}` : ''}`,
    ...(mentionLine ? { allowedMentions } : {})
  }).catch(() => {});
  return true;
}

async function deleteSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
}

// ------------------------------
// Summary (HARD PURGE then post fresh)
// ------------------------------
async function hardPurgeChannel(channelId) {
  const channel = await client.channels.fetch(channelId);
  // Repeatedly fetch and delete messages (handles >14 days by single delete)
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!batch || batch.size === 0) break;
    // Try bulk delete for young messages, then fall back to singles for leftovers
    const young = batch.filter(m => (Date.now() - m.createdTimestamp) < 13 * 24 * 60 * 60 * 1000);
    if (young.size > 1) {
      try { await channel.bulkDelete(young, true); } catch {}
    }
    const leftovers = batch.filter(m => !young.has(m.id));
    for (const m of leftovers.values()) {
      try { await m.delete(); } catch {}
    }
    if (batch.size < 100) break; // no more
  }
}

async function updateSummary() {
  await hardPurgeChannel(config.currentTradesChannelId);

  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const signals = (await getSignals()).map(normalizeSignal);
  const active = signals.filter(s => s.status === STATUS.RUN_VALID && s.validReentry === true);

  const text = renderSummaryText(active);
  await channel.send({ content: text });
}

// ------------------------------
// Control Thread UI (two-button update flow)
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
    new ButtonBuilder().setCustomId(`upd_levels_${signalId}`).setLabel('✏️ Update Levels').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`upd_more_${signalId}`).setLabel('⚙️ More Updates').setStyle(ButtonStyle.Secondary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fullclose_${signalId}`).setLabel('✅ Fully Close').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`stopbe_${signalId}`).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`stopped_${signalId}`).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`del_${signalId}`).setLabel('❌ Delete').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2, row3];
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

  // Attach “More Updates” select menu (shown when pressing the button)
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
// Modals / Menus
// ------------------------------
function makeUpdateLevelsModal(id) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_updlevels_${id}`)
    .setTitle('Update Levels (Entry/SL/TP1–TP3)');
  const fields = [
    ['upd_entry', 'Entry', TextInputStyle.Short],
    ['upd_sl', 'SL', TextInputStyle.Short],
    ['upd_tp1', 'TP1', TextInputStyle.Short],
    ['upd_tp2', 'TP2', TextInputStyle.Short],
    ['upd_tp3', 'TP3', TextInputStyle.Short],
  ];
  for (const [cid, label, style] of fields) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(style).setRequired(false)
    ));
  }
  return modal;
}

function makeMoreUpdatesMenu(id) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`menu_more_${id}`)
      .setPlaceholder('Choose what to update…')
      .addOptions(
        { label: 'TP4 & TP5', value: 'more_tp45' },
        { label: 'TP % Plans (TP1–TP5)', value: 'more_plans' },
        { label: 'Meta (Asset / Direction / Reason / Extra role)', value: 'more_meta' },
      )
  );
}

function makeTp45Modal(id) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_tp45_${id}`)
    .setTitle('Update TP4 & TP5');
  for (const [cid, label] of [['upd_tp4','TP4'],['upd_tp5','TP5']]) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false)
    ));
  }
  return modal;
}

function makePlansModal(id) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_plans_${id}`)
    .setTitle('Update TP % Plans (0–100)');
  for (const t of ['tp1','tp2','tp3','tp4','tp5']) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(`plan_${t}`).setLabel(`${t.toUpperCase()} planned %`).setStyle(TextInputStyle.Short).setRequired(false)
    ));
  }
  return modal;
}

function makeMetaModal(id) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_meta_${id}`)
    .setTitle('Update Meta');
  const fields = [
    ['upd_asset', 'Asset (e.g., BTC, ETH)', TextInputStyle.Short],
    ['upd_dir', 'Direction (LONG/SHORT)', TextInputStyle.Short],
    ['upd_reason', 'Reason (optional)', TextInputStyle.Paragraph],
    ['upd_role', 'Extra role mention (optional)', TextInputStyle.Short],
  ];
  for (const [cid, label, style] of fields) {
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(style).setRequired(false)
    ));
  }
  return modal;
}

function makeTPModal(id, tpKey) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_tp_${tpKey}_${id}`)
    .setTitle(`${tpKey.toUpperCase()} Hit`);
  const pct = new TextInputBuilder()
    .setCustomId('tp_pct')
    .setLabel('Close % (0 - 100; leave blank to skip)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(pct));
  return modal;
}

function makeFullCloseModal(id) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_full_${id}`)
    .setTitle('Fully Close Position');
  const price = new TextInputBuilder().setCustomId('close_price').setLabel('Close Price').setStyle(TextInputStyle.Short).setRequired(true);
  const pct = new TextInputBuilder().setCustomId('close_pct').setLabel('Close % (default = remaining)').setStyle(TextInputStyle.Short).setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(price));
  modal.addComponents(new ActionRowBuilder().addComponents(pct));
  return modal;
}

function makeFinalRModal(id, kind) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_finalr_${kind}_${id}`)
    .setTitle(kind === 'BE' ? 'Stopped Breakeven' : 'Stopped Out');
  const r = new TextInputBuilder()
    .setCustomId('final_r')
    .setLabel('Final R (e.g., 0, -0.5, -1)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(r));
  return modal;
}

// ------------------------------
// /signal -> create flow
// ------------------------------
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

const pendingSignals = new Map();

client.on('interactionCreate', async (interaction) => {
  try {
    // /ping
    if (interaction.isChatInputCommand() && interaction.commandName === 'ping') {
      return interaction.reply({ content: '🏓 pong', ephemeral: true });
    }

    // /signal
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
      }
      const assetSel = interaction.options.getString('asset');
      const direction = interaction.options.getString('direction');
      const entry = interaction.options.getString('entry');
      const sl = interaction.options.getString('sl');
      const tp1 = interaction.options.getString('tp1');
      const tp2 = interaction.options.getString('tp2');
      const tp3 = interaction.options.getString('tp3');
      const tp4 = interaction.options.getString('tp4');
      const tp5 = interaction.options.getString('tp5');
      const reason = interaction.options.getString('reason');
      const extraRole = interaction.options.getString('extra_role');

      // planned %
      const tp1_pct = interaction.options.getString('tp1_pct');
      const tp2_pct = interaction.options.getString('tp2_pct');
      const tp3_pct = interaction.options.getString('tp3_pct');
      const tp4_pct = interaction.options.getString('tp4_pct');
      const tp5_pct = interaction.options.getString('tp5_pct');

      let asset = assetSel;
      if (assetSel === 'OTHER') {
        const pid = nano();
        const modal = new ModalBuilder().setCustomId(`modal_asset_${pid}`).setTitle('Enter custom asset');
        const input = new TextInputBuilder().setCustomId('asset_value').setLabel('Asset (e.g., PEPE, XRP)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        pendingSignals.set(pid, { direction, entry, sl, tp1, tp2, tp3, tp4, tp5, reason, extraRole, plan: {
          TP1: isNum(tp1_pct) ? Number(tp1_pct) : null,
          TP2: isNum(tp2_pct) ? Number(tp2_pct) : null,
          TP3: isNum(tp3_pct) ? Number(tp3_pct) : null,
          TP4: isNum(tp4_pct) ? Number(tp4_pct) : null,
          TP5: isNum(tp5_pct) ? Number(tp5_pct) : null,
        }});
        return interaction.showModal(modal);
      }

      await interaction.deferReply({ ephemeral: true });
      const signal = await createSignal({
        asset,
        direction,
        entry,
        sl,
        tp1, tp2, tp3, tp4, tp5,
        reason,
        extraRole,
        plan: {
          TP1: isNum(tp1_pct) ? Number(tp1_pct) : null,
          TP2: isNum(tp2_pct) ? Number(tp2_pct) : null,
          TP3: isNum(tp3_pct) ? Number(tp3_pct) : null,
          TP4: isNum(tp4_pct) ? Number(tp4_pct) : null,
          TP5: isNum(tp5_pct) ? Number(tp5_pct) : null,
        }
      });
      await interaction.editReply({ content: `✅ Trade signal posted for ${signal.asset}.` });
      return;
    }

    // asset modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_asset_')) {
      await interaction.deferReply({ ephemeral: true });
      const pid = interaction.customId.replace('modal_asset_', '');
      const stash = pendingSignals.get(pid);
      pendingSignals.delete(pid);
      if (!stash) return interaction.editReply({ content: '❌ Session expired. Try /signal again.' });
      const asset = interaction.fields.getTextInputValue('asset_value').trim().toUpperCase();
      const signal = await createSignal({ asset, ...stash });
      await interaction.editReply({ content: `✅ Trade signal posted for ${signal.asset}.` });
      return;
    }

    // ===== Update flows =====

    // Update Levels modal (Entry/SL/TP1–TP3)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_updlevels_')) {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.customId.replace('modal_updlevels_', '');
      const signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      const before = normalizeSignal(signal);
      const patch = {};

      const entry = interaction.fields.getTextInputValue('upd_entry')?.trim();
      const sl = interaction.fields.getTextInputValue('upd_sl')?.trim();
      const tp1 = interaction.fields.getTextInputValue('upd_tp1')?.trim();
      const tp2 = interaction.fields.getTextInputValue('upd_tp2')?.trim();
      const tp3 = interaction.fields.getTextInputValue('upd_tp3')?.trim();

      if (entry) patch.entry = entry;
      if (sl) patch.sl = sl;
      if (tp1 !== undefined && tp1 !== '') patch.tp1 = tp1;
      if (tp2 !== undefined && tp2 !== '') patch.tp2 = tp2;
      if (tp3 !== undefined && tp3 !== '') patch.tp3 = tp3;

      await updateSignal(id, patch);
      const updated = normalizeSignal(await getSignal(id));

      const changedKeys = ['entry', 'sl', 'tp1', 'tp2', 'tp3'];
      const retag = changedKeys.some(k => String(before[k] ?? '') !== String(updated[k] ?? ''));

      if (isSlMovedToBE(updated)) {
        updated.validReentry = false;
        await updateSignal(id, { validReentry: false });
      }

      await editSignalMessage(updated);
      if (retag) await sendMinimalPing(updated);
      await updateSummary();

      return interaction.editReply({ content: '✅ Levels updated.' });
    }

    // TP4 & TP5 modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_tp45_')) {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.customId.replace('modal_tp45_', '');
      const signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      const before = normalizeSignal(signal);
      const patch = {};
      const tp4 = interaction.fields.getTextInputValue('upd_tp4')?.trim();
      const tp5 = interaction.fields.getTextInputValue('upd_tp5')?.trim();
      if (tp4 !== undefined && tp4 !== '') patch.tp4 = tp4;
      if (tp5 !== undefined && tp5 !== '') patch.tp5 = tp5;

      await updateSignal(id, patch);
      const updated = normalizeSignal(await getSignal(id));

      const retag = ['tp4','tp5'].some(k => String(before[k] ?? '') !== String(updated[k] ?? ''));
      await editSignalMessage(updated);
      if (retag) await sendMinimalPing(updated);
      await updateSummary();

      return interaction.editReply({ content: '✅ TP4/TP5 updated.' });
    }

    // TP % plans modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_plans_')) {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.customId.replace('modal_plans_', '');
      const sig = normalizeSignal(await getSignal(id));
      if (!sig) return interaction.editReply({ content: 'Signal not found.' });

      const patchPlan = { ...sig.plan };
      for (const t of ['tp1','tp2','tp3','tp4','tp5']) {
        const raw = interaction.fields.getTextInputValue(`plan_${t}`)?.trim();
        if (raw === '' || raw === undefined) continue;
        if (isNum(raw)) patchPlan[t.toUpperCase()] = Number(raw);
      }
      await updateSignal(id, { plan: patchPlan });

      await editSignalMessage(normalizeSignal(await getSignal(id)));
      await updateSummary();
      return interaction.editReply({ content: '✅ TP % plans updated.' });
    }

    // Meta modal (asset/direction/reason/extra role)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_meta_')) {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.customId.replace('modal_meta_', '');
      const signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      const before = normalizeSignal(signal);
      const patch = {};

      const asset = interaction.fields.getTextInputValue('upd_asset')?.trim();
      const dir = interaction.fields.getTextInputValue('upd_dir')?.trim()?.toUpperCase();
      const reason = interaction.fields.getTextInputValue('upd_reason')?.trim();
      const extraRole = interaction.fields.getTextInputValue('upd_role')?.trim();

      if (asset) patch.asset = asset.toUpperCase();
      if (dir === 'LONG' || dir === 'SHORT') patch.direction = dir;
      if (reason !== undefined) patch.reason = reason;
      if (extraRole !== undefined) patch.extraRole = extraRole;

      await updateSignal(id, patch);
      const updated = normalizeSignal(await getSignal(id));

      const retag = ['asset','direction'].some(k => String(before[k] ?? '') !== String(updated[k] ?? ''));
      await editSignalMessage(updated);
      if (retag) await sendMinimalPing(updated);
      await updateSummary();

      return interaction.editReply({ content: '✅ Meta updated.' });
    }

    // TP Hit modal submit (optional %)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_tp_')) {
      await interaction.deferReply({ ephemeral: true });
      const [_prefix, _tp, tpKey, id] = interaction.customId.split('_'); // modal_tp_tp1_<id>
      let signal = normalizeSignal(await getSignal(id));
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      const pctRaw = interaction.fields.getTextInputValue('tp_pct')?.trim();
      const hasPct = pctRaw !== undefined && pctRaw !== null && pctRaw !== '';
      const pct = hasPct ? Number(pctRaw) : null;
      if (hasPct && (isNaN(pct) || pct < 0 || pct > 100)) {
        return interaction.editReply({ content: '❌ Close % must be between 0 and 100 (or leave blank to skip).' });
      }
      const tpPrice = signal[tpKey];
      if (hasPct && pct > 0 && isNum(tpPrice)) {
        signal.fills.push({ pct: Number(pct), price: Number(tpPrice), source: tpKey.toUpperCase() });
      }
      signal.latestTpHit = tpKey.toUpperCase();

      await updateSignal(id, { fills: signal.fills, latestTpHit: signal.latestTpHit });
      await editSignalMessage(signal);
      await updateSummary();
      return interaction.editReply({ content: `✅ ${tpKey.toUpperCase()} recorded${hasPct && pct > 0 ? ` (${pct}%).` : '.'}` });
    }

    // Fully Close modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_full_')) {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.customId.replace('modal_full_', '');
      let signal = normalizeSignal(await getSignal(id));
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      const price = Number(interaction.fields.getTextInputValue('close_price')?.trim());
      if (!isNum(price)) return interaction.editReply({ content: '❌ Close Price must be a number.' });

      const currentPct = (signal.fills || []).reduce((acc, f) => acc + Number(f.pct || 0), 0);
      let pctStr = interaction.fields.getTextInputValue('close_pct')?.trim();
      let pct = isNum(pctStr) ? Number(pctStr) : Math.max(0, 100 - currentPct);
      if (pct < 0 || pct > 100) pct = Math.max(0, Math.min(100, pct));

      if (pct > 0) {
        signal.fills.push({ pct, price, source: 'FINAL_CLOSE' });
      }
      // final close
      const latest = signal.latestTpHit || TP_KEYS.find(k => signal[k] !== null)?.toUpperCase() || null;
      signal.status = STATUS.CLOSED;
      signal.validReentry = false;
      await updateSignal(id, { fills: signal.fills, status: signal.status, validReentry: false, latestTpHit: latest });

      await editSignalMessage(signal);
      await updateSummary();

      return interaction.editReply({ content: '✅ Fully closed.' });
    }

    // Final R modal (Stopped BE / Stopped Out)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_finalr_')) {
      await interaction.deferReply({ ephemeral: true });
      const parts = interaction.customId.split('_'); // modal_finalr_BE_<id>
      const kind = parts[2];
      const id = parts.slice(3).join('_');
      let signal = normalizeSignal(await getSignal(id));
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      const finalR = Number(interaction.fields.getTextInputValue('final_r')?.trim());
      if (!isNum(finalR)) return interaction.editReply({ content: '❌ Final R must be a number (e.g., 0, -1, -0.5).' });

      let price = null;
      if (signal.direction === DIR.LONG) {
        price = Number(signal.entry) + finalR * (Number(signal.entry) - Number(signal.slOriginal ?? signal.sl));
      } else {
        price = Number(signal.entry) - finalR * (Number(signal.slOriginal ?? signal.sl) - Number(signal.entry));
      }
      const remaining = 100 - (signal.fills || []).reduce((a, f) => a + Number(f.pct || 0), 0);
      if (remaining > 0) {
        signal.fills.push({ pct: remaining, price, source: kind === 'BE' ? 'STOP_BE' : 'STOP_OUT' });
      }

      if (kind === 'BE') signal.status = STATUS.STOPPED_BE;
      else signal.status = STATUS.STOPPED_OUT;
      signal.validReentry = false;

      await updateSignal(id, { fills: signal.fills, status: signal.status, validReentry: false });
      await editSignalMessage(signal);
      await updateSummary();
      await deleteControlThread(id);

      return interaction.editReply({ content: kind === 'BE' ? '✅ Stopped at breakeven.' : '✅ Stopped out.' });
    }

    // ===== Buttons / Menus =====
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }
      const [action, id] = interaction.customId.split('_');
      if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });

      // Update Levels
      if (action === 'updlevels') {
        return interaction.showModal(makeUpdateLevelsModal(id));
      }
      // More Updates (send ephemeral menu)
      if (action === 'updmore') {
        return interaction.reply({ content: 'Choose what to update:', components: [makeMoreUpdatesMenu(id)], ephemeral: true });
      }

      if (action === 'fullclose') return interaction.showModal(makeFullCloseModal(id));
      if (action === 'stopbe')   return interaction.showModal(makeFinalRModal(id, 'BE'));
      if (action === 'stopped')  return interaction.showModal(makeFinalRModal(id, 'OUT'));

      if (action === 'del') {
        await interaction.deferReply({ ephemeral: true });
        const sig = await getSignal(id);
        if (sig) {
          await deleteSignalMessage(sig).catch(() => {});
          await deleteControlThread(id).catch(() => {});
          await deleteSignal(id).catch(() => {});
          await updateSummary().catch(() => {});
        }
        return interaction.editReply({ content: '🗑️ Signal deleted.' });
      }

      // TP buttons — auto-exec if a plan exists; else optional modal
      if (['tp1','tp2','tp3','tp4','tp5'].includes(action)) {
        const sig = normalizeSignal(await getSignal(id));
        if (!sig) return interaction.reply({ content: 'Signal not found.', ephemeral: true });
        const planPct = sig.plan?.[action.toUpperCase()];
        const tpPrice = sig[action];
        if (isNum(planPct) && Number(planPct) > 0 && isNum(tpPrice)) {
          // auto execute
          sig.fills.push({ pct: Number(planPct), price: Number(tpPrice), source: action.toUpperCase() });
          sig.latestTpHit = action.toUpperCase();
          await updateSignal(id, { fills: sig.fills, latestTpHit: sig.latestTpHit });
          await editSignalMessage(sig);
          await updateSummary();
          return interaction.reply({ content: `✅ ${action.toUpperCase()} executed (${planPct}%).`, ephemeral: true });
        }
        // else show optional modal (prefill with plan or blank)
        const modal = makeTPModal(id, action);
        if (isNum(planPct)) {
          modal.components[0].components[0].setValue(String(planPct));
        }
        return interaction.showModal(modal);
      }

      return interaction.reply({ content: 'Unknown action.', ephemeral: true });
    }

    // Handle More Updates menu selections
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('menu_more_')) {
      const id = interaction.customId.replace('menu_more_', '');
      const value = interaction.values[0];
      if (value === 'more_tp45') {
        await interaction.update({ content: 'Opening TP4/TP5 modal…', components: [] });
        return interaction.followUp({ ephemeral: true, content: ' ', components: [] }).then(() => interaction.showModal(makeTp45Modal(id)));
      }
      if (value === 'more_plans') {
        await interaction.update({ content: 'Opening TP % plans modal…', components: [] });
        return interaction.followUp({ ephemeral: true, content: ' ', components: [] }).then(() => interaction.showModal(makePlansModal(id)));
      }
      if (value === 'more_meta') {
        await interaction.update({ content: 'Opening Meta modal…', components: [] });
        return interaction.followUp({ ephemeral: true, content: ' ', components: [] }).then(() => interaction.showModal(makeMetaModal(id)));
      }
      return interaction.update({ content: 'No action.', components: [] });
    }
  } catch (err) {
    console.error('interaction error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Internal error.' });
      } else {
        await interaction.reply({ content: '❌ Internal error.', ephemeral: true });
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

// Minimal ping when retag-worthy things change
async function sendMinimalPing(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole);
  if (!mentionLine) return;
  const link = signal.jumpUrl ? ` ${signal.jumpUrl}` : '';
  await channel.send({ content: `${mentionLine}${link}`, allowedMentions }).catch(() => {});
}

client.login(config.token);
