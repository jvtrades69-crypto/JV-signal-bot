// index.js — JV Signal Bot (bot-identity posts, embeds, TP1–TP5, modals, RR math, summary upsert)

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
} from 'discord.js';

import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, getSignals, updateSignal, deleteSignal,
  getSummaryMessageId, setSummaryMessageId,
  getThreadId, setThreadId
} from './store.js';

import {
  renderSignalEmbed,
  renderSummaryEmbed,
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

// compute R at any price
function rAtPrice(direction, entry, sl, price) {
  if (!isNum(entry) || !isNum(sl) || !isNum(price)) return null;
  entry = Number(entry); sl = Number(sl); price = Number(price);
  if (direction === DIR.LONG) {
    const risk = entry - sl;
    if (risk <= 0) return null;
    return (price - entry) / risk;
  } else {
    const risk = sl - entry;
    if (risk <= 0) return null;
    return (entry - price) / risk;
  }
}

// compute RR chips per provided TP levels
function computeRRChips(signal) {
  const { direction, entry, sl } = signal;
  const chips = [];
  for (const key of TP_KEYS) {
    const tpVal = toNumOrNull(signal[key]);
    if (tpVal === null) continue;
    const r = rAtPrice(direction, entry, sl, tpVal);
    if (r === null) continue;
    chips.push({ key: key.toUpperCase(), r: Number(r.toFixed(2)) });
  }
  return chips; // [{key:'TP1', r:0.4}, ...]
}

// compute weighted realized R from fills
function computeRealized(signal) {
  const fills = signal.fills || []; // [{pct, price, source:'TP1'|'MANUAL'|'FINAL'}]
  if (!fills.length) return { realized: 0, textParts: [] };
  let sum = 0;
  const parts = [];
  for (const f of fills) {
    const pct = Number(f.pct || 0);
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, f.price);
    if (!isNum(pct) || r === null) continue;
    sum += (pct * r) / 100;
    if (f.source?.startsWith('TP')) {
      parts.push(`${pct}% closed at ${f.source}`);
    } else if (f.source === 'FINAL_CLOSE') {
      parts.push(`${pct}% closed at ${f.price}`);
    } else if (f.source === 'STOP_BE') {
      parts.push(`${pct}% closed at BE`);
    } else if (f.source === 'STOP_OUT') {
      parts.push(`${pct}% closed at SL`);
    }
  }
  return { realized: Number(sum.toFixed(2)), textParts: parts };
}

// normalize a signal object
function normalizeSignal(raw) {
  const s = { ...raw };
  s.entry = toNumOrNull(s.entry);
  s.sl = toNumOrNull(s.sl);
  s.slOriginal = s.slOriginal ?? s.sl; // remember the first SL for R math if you later move SL=Entry
  for (const k of TP_KEYS) s[k] = toNumOrNull(s[k]);
  s.fills = Array.isArray(s.fills) ? s.fills : [];
  s.latestTpHit = s.latestTpHit || null; // 'TP1'...'TP5'
  s.status = s.status || STATUS.RUN_VALID;
  if (typeof s.validReentry !== 'boolean') s.validReentry = true;
  s.extraRole = s.extraRole || '';
  return s;
}

// mention helpers
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

// title chip logic helper (returns {titleChipText, show})
function buildTitleChip(signal) {
  const s = normalizeSignal(signal);
  // chips only after a TP or SL has been hit (i.e., has fills or final states)
  const hasTPFill = (s.fills || []).some(f => String(f.source || '').startsWith('TP') && Number(f.pct) > 0);
  const isFinalBE = s.status === STATUS.STOPPED_BE;
  const isFinalOut = s.status === STATUS.STOPPED_OUT;
  const isFinalClosed = s.status === STATUS.CLOSED;
  const rr = computeRealized(s).realized;

  // latest TP hit for title wording (if any)
  let latestTP = s.latestTpHit;

  if (isFinalOut) {
    return { show: true, text: `Loss -${Math.abs(rr).toFixed(2)}R` };
  }
  if (isFinalBE) {
    if (hasTPFill && latestTP) {
      return { show: true, text: `Win +${rr.toFixed(2)}R Stopped BE after ${latestTP}` };
    }
    return { show: true, text: 'Breakeven' };
  }
  if (isFinalClosed && latestTP) {
    return { show: true, text: `Win +${rr.toFixed(2)}R fully closed after ${latestTP}` };
  }
  if (hasTPFill && latestTP) {
    return { show: true, text: `Win +${rr.toFixed(2)}R so far - ${latestTP} hit` };
  }
  return { show: false, text: '' };
}

// compute if SL moved to BE (active)
function isSlMovedToBE(signal) {
  const s = normalizeSignal(signal);
  return s.status === STATUS.RUN_VALID && isNum(s.entry) && isNum(s.sl) && Number(s.entry) === Number(s.sl) && !!s.latestTpHit;
}

// ------------------------------
// Message Posting & Editing
// ------------------------------
async function postSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const rrChips = computeRRChips(signal);
  const titleChip = buildTitleChip(signal);
  const embed = renderSignalEmbed(normalizeSignal(signal), rrChips, titleChip, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole);

  const sent = await channel.send({
    embeds: [embed],
    ...(mentionLine ? { content: mentionLine, allowedMentions } : {})
  });
  return sent.id;
}

async function editSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (!msg) return false;
  const rrChips = computeRRChips(signal);
  const titleChip = buildTitleChip(signal);
  const embed = renderSignalEmbed(normalizeSignal(signal), rrChips, titleChip, isSlMovedToBE(signal));
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole);

  // We keep mentions separate (bottom line). On edit, Discord won't re-ping anyway; still pass strict allowedMentions.
  await msg.edit({
    embeds: [embed],
    ...(mentionLine ? { content: mentionLine, allowedMentions } : { content: null })
  }).catch(() => {});
  return true;
}

async function deleteSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (msg) await msg.delete().catch(() => {});
}

// ------------------------------
// Summary (single-message upsert)
// ------------------------------
async function updateSummary() {
  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const signals = (await getSignals()).map(normalizeSignal);
  const active = signals.filter(s => s.status === STATUS.RUN_VALID && s.validReentry === true);
  const embed = renderSummaryEmbed(active);
  const existingId = await getSummaryMessageId();

  if (existingId) {
    const existing = await channel.messages.fetch(existingId).catch(() => null);
    if (existing) {
      await existing.edit({ embeds: [embed] }).catch(async () => {
        try { await existing.delete(); } catch {}
        const newMsg = await channel.send({ embeds: [embed] });
        await setSummaryMessageId(newMsg.id);
      });
      return;
    }
  }
  const sent = await channel.send({ embeds: [embed] });
  await setSummaryMessageId(sent.id);
}

// ------------------------------
// Control Thread (private) & Buttons
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
    new ButtonBuilder().setCustomId(`update_${signalId}`).setLabel('✏️ Update Signal').setStyle(ButtonStyle.Secondary)
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
// Interaction IDs & Modals
// ------------------------------
function makeUpdateModal(id) {
  const modal = new ModalBuilder()
    .setCustomId(`modal_update_${id}`)
    .setTitle('Update Signal');

  const fields = [
    ['upd_asset', 'Asset (e.g., BTC, ETH)', TextInputStyle.Short],
    ['upd_dir', 'Direction (LONG/SHORT)', TextInputStyle.Short],
    ['upd_entry', 'Entry', TextInputStyle.Short],
    ['upd_sl', 'SL', TextInputStyle.Short],
    ['upd_tp1', 'TP1', TextInputStyle.Short],
    ['upd_tp2', 'TP2', TextInputStyle.Short],
    ['upd_tp3', 'TP3', TextInputStyle.Short],
    ['upd_tp4', 'TP4', TextInputStyle.Short],
    ['upd_tp5', 'TP5', TextInputStyle.Short],
    ['upd_reason', 'Reason (optional)', TextInputStyle.Paragraph],
    ['upd_role', 'Extra role mention (optional)', TextInputStyle.Short],
  ];
  for (const [idKey, label, style] of fields) {
    const input = new TextInputBuilder().setCustomId(idKey).setLabel(label).setStyle(style).setRequired(false);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

function makeTPModal(id, tpKey) {
  const modal = new ModalBuilder().setCustomId(`modal_tp_${tpKey}_${id}`).setTitle(`${tpKey.toUpperCase()} Hit`);
  const pct = new TextInputBuilder().setCustomId('tp_pct').setLabel('Close % (0 - 100)').setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(pct));
  return modal;
}

function makeFullCloseModal(id) {
  const modal = new ModalBuilder().setCustomId(`modal_full_${id}`).setTitle('Fully Close Position');
  const price = new TextInputBuilder().setCustomId('close_price').setLabel('Close Price').setStyle(TextInputStyle.Short).setRequired(true);
  const pct = new TextInputBuilder().setCustomId('close_pct').setLabel('Close % (default = remaining)').setStyle(TextInputStyle.Short).setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(price));
  modal.addComponents(new ActionRowBuilder().addComponents(pct));
  return modal;
}

function makeFinalRModal(id, kind) {
  const modal = new ModalBuilder().setCustomId(`modal_finalr_${kind}_${id}`).setTitle(kind === 'BE' ? 'Stopped Breakeven' : 'Stopped Out');
  const r = new TextInputBuilder().setCustomId('final_r').setLabel('Final R (e.g., 0, -0.5, -1)').setStyle(TextInputStyle.Short).setRequired(true);
  modal.addComponents(new ActionRowBuilder().addComponents(r));
  return modal;
}

// ------------------------------
// /signal -> create flow
// ------------------------------
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

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

      let asset = assetSel;
      if (assetSel === 'OTHER') {
        // inline modal for asset name
        const pid = nano();
        const modal = new ModalBuilder()
          .setCustomId(`modal_asset_${pid}`)
          .setTitle('Enter custom asset');
        const input = new TextInputBuilder().setCustomId('asset_value').setLabel('Asset (e.g., PEPE, XRP)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        // stash temporary
        pendingSignals.set(pid, { direction, entry, sl, tp1, tp2, tp3, tp4, tp5, reason, extraRole });
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
        extraRole
      });
      await interaction.editReply({ content: `✅ Trade signal posted for ${signal.asset}.` });
      return;
    }

    // asset modal
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

    // Update Signal modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_update_')) {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.customId.replace('modal_update_', '');
      const signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      const patch = {};
      const before = normalizeSignal(signal);

      const asset = interaction.fields.getTextInputValue('upd_asset')?.trim();
      const dir = interaction.fields.getTextInputValue('upd_dir')?.trim()?.toUpperCase();
      const entry = interaction.fields.getTextInputValue('upd_entry')?.trim();
      const sl = interaction.fields.getTextInputValue('upd_sl')?.trim();
      const tp1 = interaction.fields.getTextInputValue('upd_tp1')?.trim();
      const tp2 = interaction.fields.getTextInputValue('upd_tp2')?.trim();
      const tp3 = interaction.fields.getTextInputValue('upd_tp3')?.trim();
      const tp4 = interaction.fields.getTextInputValue('upd_tp4')?.trim();
      const tp5 = interaction.fields.getTextInputValue('upd_tp5')?.trim();
      const reason = interaction.fields.getTextInputValue('upd_reason')?.trim();
      const extraRole = interaction.fields.getTextInputValue('upd_role')?.trim();

      if (asset) patch.asset = asset.toUpperCase();
      if (dir === 'LONG' || dir === 'SHORT') patch.direction = dir;
      if (entry) patch.entry = entry;
      if (sl) patch.sl = sl;
      if (tp1 !== undefined && tp1 !== '') patch.tp1 = tp1;
      if (tp2 !== undefined && tp2 !== '') patch.tp2 = tp2;
      if (tp3 !== undefined && tp3 !== '') patch.tp3 = tp3;
      if (tp4 !== undefined && tp4 !== '') patch.tp4 = tp4;
      if (tp5 !== undefined && tp5 !== '') patch.tp5 = tp5;
      if (reason !== undefined) patch.reason = reason;
      if (extraRole !== undefined) patch.extraRole = extraRole;

      // apply patch
      await updateSignal(id, patch);
      const updated = normalizeSignal(await getSignal(id));

      // smart retag only if asset/direction/entry/sl/any TP price changed
      const changedKeys = ['asset', 'direction', 'entry', 'sl', ...TP_KEYS];
      const retag = changedKeys.some(k => String(before[k] ?? '') !== String(updated[k] ?? ''));

      // detect SL moved to BE -> validReentry false (only when active and a TP was hit)
      if (isSlMovedToBE(updated)) {
        updated.validReentry = false;
        await updateSignal(id, { validReentry: false });
      }

      // edit main message
      await editSignalMessage(updated);

      // minimal ping if retag-worthy
      if (retag) {
        await sendMinimalPing(updated);
      }

      await updateSummary();
      return interaction.editReply({ content: '✅ Signal updated.' });
    }

    // TP modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_tp_')) {
      await interaction.deferReply({ ephemeral: true });
      const [_prefix, _tp, tpKey, id] = interaction.customId.split('_'); // modal_tp_tp1_<id>
      const pctStr = interaction.fields.getTextInputValue('tp_pct')?.trim();
      const pct = Number(pctStr);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        return interaction.editReply({ content: '❌ Close % must be between 0 and 100.' });
      }

      let signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });
      signal = normalizeSignal(signal);

      // record fill only if pct > 0 (else no bracket)
      const tpNum = signal[tpKey];
      if (pct > 0 && isNum(tpNum)) {
        signal.fills.push({ pct, price: Number(tpNum), source: tpKey.toUpperCase() });
      }
      signal.latestTpHit = tpKey.toUpperCase();

      // Active state remains RUN_VALID; validReentry stays as-is unless SL moved to BE separately
      await updateSignal(id, { fills: signal.fills, latestTpHit: signal.latestTpHit });
      await editSignalMessage(signal);

      await updateSummary();
      return interaction.editReply({ content: `✅ ${tpKey.toUpperCase()} recorded.` });
    }

    // Fully Close modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_full_')) {
      await interaction.deferReply({ ephemeral: true });
      const id = interaction.customId.replace('modal_full_', '');
      let signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });
      signal = normalizeSignal(signal);

      const price = Number(interaction.fields.getTextInputValue('close_price')?.trim());
      if (!isNum(price)) return interaction.editReply({ content: '❌ Close Price must be a number.' });

      const currentPct = (signal.fills || []).reduce((acc, f) => acc + Number(f.pct || 0), 0);
      let pctStr = interaction.fields.getTextInputValue('close_pct')?.trim();
      let pct = isNum(pctStr) ? Number(pctStr) : Math.max(0, 100 - currentPct);
      if (pct < 0 || pct > 100) pct = Math.max(0, Math.min(100, pct));

      if (pct > 0) {
        signal.fills.push({ pct, price, source: 'FINAL_CLOSE' });
      }
      // mark final closed
      const latest = signal.latestTpHit || TP_KEYS.find(k => signal[k] !== null)?.toUpperCase() || null;
      signal.status = STATUS.CLOSED;
      signal.validReentry = false;
      await updateSignal(id, { fills: signal.fills, status: signal.status, validReentry: false, latestTpHit: latest });

      await editSignalMessage(signal);
      await updateSummary();

      return interaction.editReply({ content: '✅ Fully closed.' });
    }

    // Final R modal submit (Stopped BE / Stopped Out)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_finalr_')) {
      await interaction.deferReply({ ephemeral: true });
      const parts = interaction.customId.split('_'); // modal_finalr_BE_<id> or modal_finalr_OUT_<id>
      const kind = parts[2];
      const id = parts.slice(3).join('_');

      let signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });
      signal = normalizeSignal(signal);

      const finalR = Number(interaction.fields.getTextInputValue('final_r')?.trim());
      if (!isNum(finalR)) return interaction.editReply({ content: '❌ Final R must be a number (e.g., 0, -1, -0.5).' });

      // Convert R to a synthetic fill % so our realized math/format matches:
      // We will push a synthetic 100% fill at the price producing that R relative to entry/sl.
      // price = entry + R * (entry - sl) for LONG, entry - R * (sl - entry) for SHORT
      let price = null;
      if (signal.direction === DIR.LONG) {
        price = Number(signal.entry) + finalR * (Number(signal.entry) - Number(signal.slOriginal ?? signal.sl));
      } else {
        price = Number(signal.entry) - finalR * (Number(signal.slOriginal ?? signal.sl) - Number(signal.entry));
      }
      // cap: we only care about R display; price is not shown in BE/out wording anyway
      signal.fills.push({
        pct: 100 - (signal.fills?.reduce((a, f) => a + Number(f.pct || 0), 0) || 0),
        price,
        source: kind === 'BE' ? 'STOP_BE' : 'STOP_OUT'
      });

      if (kind === 'BE') {
        signal.status = STATUS.STOPPED_BE;
      } else {
        signal.status = STATUS.STOPPED_OUT;
      }
      signal.validReentry = false;

      await updateSignal(id, { fills: signal.fills, status: signal.status, validReentry: false });

      await editSignalMessage(signal);
      await updateSummary();
      await deleteControlThread(id);

      return interaction.editReply({ content: kind === 'BE' ? '✅ Stopped at breakeven.' : '✅ Stopped out.' });
    }

    // Buttons
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }
      const [action, id] = interaction.customId.split('_'); // e.g., tp1_<id>
      if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });

      if (action === 'update') {
        return interaction.showModal(makeUpdateModal(id));
      }
      if (action === 'fullclose') {
        return interaction.showModal(makeFullCloseModal(id));
      }
      if (action === 'stopbe') {
        return interaction.showModal(makeFinalRModal(id, 'BE'));
      }
      if (action === 'stopped') {
        return interaction.showModal(makeFinalRModal(id, 'OUT'));
      }
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
      // TP buttons
      if (['tp1', 'tp2', 'tp3', 'tp4', 'tp5'].includes(action)) {
        return interaction.showModal(makeTPModal(id, action));
      }
      return interaction.reply({ content: 'Unknown action.', ephemeral: true });
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
const pendingSignals = new Map();

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
    status: STATUS.RUN_VALID,
    validReentry: true,
    latestTpHit: null,
    fills: [],
    messageId: null,
    jumpUrl: null
  });

  // store
  await saveSignal(signal);

  // post message as bot
  const msgId = await postSignalMessage(signal);
  signal.messageId = msgId;

  // set jumpUrl
  const channel = await client.channels.fetch(config.signalsChannelId);
  const msg = await channel.messages.fetch(msgId);
  signal.jumpUrl = msg.url;

  await updateSignal(signal.id, { messageId: signal.messageId, jumpUrl: signal.jumpUrl });

  // control thread
  await createControlThread(signal);

  // update summary
  await updateSummary();

  return signal;
}

// Minimal ping message when retag-worthy fields changed
async function sendMinimalPing(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const { content: mentionLine, allowedMentions } = buildMentions(config.mentionRoleId, signal.extraRole);
  if (!mentionLine) return;
  const link = signal.jumpUrl ? ` ${signal.jumpUrl}` : '';
  await channel.send({ content: `${mentionLine}${link}`, allowedMentions }).catch(() => {});
}

client.login(config.token);
