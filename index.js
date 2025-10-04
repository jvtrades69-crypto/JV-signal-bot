// index.js — JV Signal Bot (risk badge + risk toggles + full close profit + recap FinalR override)
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
  StringSelectMenuBuilder,
  AttachmentBuilder
} from 'discord.js';
import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, getSignals, updateSignal, deleteSignal,
  getThreadId, setThreadId
} from './store.js';
import {
  renderSignalText, renderSummaryText, renderRecapText, renderMonthlyRecap, renderRecapEmbed
} from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

// errors
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException',  (err) => console.error('uncaughtException:', err));

// utils
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
  if (direction === DIR.LONG) { const risk = E - S; if (risk <= 0) return null; return (P - E) / risk; }
  const risk = S - E; if (risk <= 0) return null; return (E - P) / risk;
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

// Flags
s.beSet = Boolean(s.beSet);
s.beMovedAfter = s.beMovedAfter || null;
// NEW: planned/explicit BE price
s.beAt = s.beAt || null;

s.slProfitSet = Boolean(s.slProfitSet);
s.slProfitAfter = s.slProfitAfter || null;
s.slProfitAfterTP = s.slProfitAfterTP || null;


  // display flags for stopped in profit
  s.stoppedInProfit = Boolean(s.stoppedInProfit);
  s.stoppedInProfitAfterTP = s.stoppedInProfitAfterTP || null;

  // risk badge label (display-only)
  s.riskLabel = (typeof s.riskLabel === 'string' ? s.riskLabel : '').trim(); // '', 'half', '1/4', '3/4'

  s.createdAt = isNum(s.createdAt) ? Number(s.createdAt) : s.createdAt || null;
  return s;
}

function isSlMovedToBE(signal) {
  const s = normalizeSignal(signal);
  return s.status === STATUS.RUN_VALID && isNum(s.entry) && isNum(s.sl) && Number(s.entry) === Number(s.sl);
}

// mentions
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

// acks
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

// computeThreadName — ASSET dir ±x.xxR, tpN hit
function computeThreadName(signal) {
  const asset = String(signal.asset || '').toUpperCase();
  const dir   = signal.direction === DIR.SHORT ? 'short' : 'long';

  const isFinal  = [STATUS.CLOSED, STATUS.STOPPED_BE, STATUS.STOPPED_OUT].includes(signal.status);
  const hasFinal = isNum(signal.finalR);
  const rValue   = (isFinal && hasFinal) ? Number(signal.finalR) : computeRealizedR(signal);
  const rTxt     = `${rValue >= 0 ? '+' : ''}${rValue.toFixed(2)}R`;

  const latestHit = signal.latestTpHit ||
    ['TP5','TP4','TP3','TP2','TP1'].find(k => signal.tpHits?.[k]) || null;

  let name = `${asset} ${dir} ${rTxt}`;
  if (latestHit) name += `, ${latestHit.toLowerCase()} hit`;

  return name.length > 95 ? name.slice(0, 95) : name;
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

// posting live signal
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

// summary
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

      const candidates = signals.filter(
        s => s.status === STATUS.RUN_VALID && s.validReentry === true && !s.beSet && !s.slProfitSet
      );

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

// autocomplete (/recap id) + (/thread-restore trade) + (/signal-restore id)
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isAutocomplete()) return;
  try {
    // recap id autocomplete
    if (interaction.commandName === 'recap') {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== 'id') return;

      const all = (await getSignals()).map(normalizeSignal);
      all.sort((a, b) => {
        if (a.messageId && b.messageId) {
          const A = BigInt(a.messageId), B = BigInt(b.messageId);
          if (A === B) return 0;
          return (B > A) ? 1 : -1;
        }
        return Number(b.createdAt || 0) - Number(a.createdAt || 0);
      });

      const q = String(focused.value || '').toLowerCase();
      const opts = [];
      for (const s of all.slice(0, 50)) {
        const name = `${computeThreadName(s)} • id:${s.id}`;
        if (!q || name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) {
          opts.push({ name: name.slice(0, 100), value: s.id });
        }
        if (opts.length >= 25) break;
      }
      return await interaction.respond(opts);
    }

    // thread-restore trade autocomplete — only trades with live signal msg and missing thread
    if (interaction.commandName === 'thread-restore') {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== 'trade') return;
      const q = String(focused.value || '').toLowerCase();

      const all = (await getSignals()).map(normalizeSignal)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

      const choices = [];
      for (const s of all) {
        if (!s.channelId || !s.messageId) continue;
        let messageAlive = false;
        try {
          const ch = await interaction.client.channels.fetch(s.channelId);
          await ch.messages.fetch(s.messageId);
          messageAlive = true;
        } catch {}
        if (!messageAlive) continue;

        const linkId = await getThreadId(s.id).catch(() => null);
        if (linkId) {
          try {
            const thr = await interaction.client.channels.fetch(linkId);
            if (thr?.isThread?.()) continue;
          } catch {}
        }

        const name = `${computeThreadName(s)} • id:${s.id}`.slice(0, 100);
        if (!q || name.toLowerCase().includes(q)) {
          choices.push({ name, value: s.id });
        }
        if (choices.length >= 25) break;
      }

      return await interaction.respond(choices);
    }

    // signal-restore id autocomplete (deleted signals)
    if (interaction.commandName === 'signal-restore') {
      const focused = interaction.options.getFocused(true);
      if (focused.name !== 'id') return;
      const q = String(focused.value || '').toLowerCase();

      let choices = [];
      try {
        const store = await import('./store.js');
        const list = (await store.getDeletedSignals?.()) || [];
        const items = list.map(normalizeSignal).slice(0, 50);
        choices = items.map(s => ({
          name: `${computeThreadName(s)} • id:${s.id}`.slice(0, 100),
          value: s.id,
        }));
      } catch {
        choices = [];
      }
      return await interaction.respond(q ? choices.filter(c => c.name.toLowerCase().includes(q)) : choices);
    }
  } catch (e) {
    console.error('autocomplete error:', e);
    try { await interaction.respond([]); } catch {}
  }
});

// buttons/modals UI
function btn(id, key) { return `btn:${key}:${id}`; }
function modal(id, key) { return `modal:${key}:${id}`; }

function controlRows(signalId) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'tp1')).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'tp2')).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'tp3')).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'tp4')).setLabel('🎯 TP4 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'tp5')).setLabel('🎯 TP5 Hit').setStyle(ButtonStyle.Success),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'upd:tpprices')).setLabel('✏️ Update TP Prices').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:plan')).setLabel('✏️ Update TP % Plan').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:maxr')).setLabel('📈 Set Max R').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:trade')).setLabel('✏️ Update Trade Info').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'upd:roles')).setLabel('✏️ Update Role Mention').setStyle(ButtonStyle.Secondary),
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'upd:chart')).setLabel('🖼️ Set/Replace Chart Link').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'stopped')).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(btn(signalId,'stopprofit')).setLabel('🟧 Stopped In Profit').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(btn(signalId,'stopbe')).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(btn(signalId,'setbe')).setLabel('🟨 Set SL → BE').setStyle(ButtonStyle.Secondary),
  );

  const row4 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'setprofit')).setLabel('🟩 Set SL → In Profit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'fullprofit')).setLabel('🏁 Full Close (Profit)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(btn(signalId,'undo_menu')).setLabel('↩ Undo…').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'risk:set')).setLabel('⚖️ Set Risk…').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(btn(signalId,'risk:clear')).setLabel('⚖️ Clear Risk').setStyle(ButtonStyle.Secondary),
  );

  const row5 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(btn(signalId,'finish')).setLabel('🏁 Finish').setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3, row4, row5];
}
// === Control thread helpers ===
async function createControlThread(signal) {
  const channel = await client.channels.fetch(signal.channelId);
  const initialName = computeThreadName(signal);
  const thread = await channel.threads.create({
    name: initialName,
    type: ChannelType.PrivateThread,
    invitable: false,
  });
  await thread.members.add(config.ownerId).catch(() => {});
  await setThreadId(signal.id, thread.id);
  await thread.send({ content: 'Owner Control Panel', components: controlRows(signal.id) }).catch(() => {});
  return thread.id;
}

async function deleteControlThread(signalId) {
  const tid = await getThreadId(signalId).catch(() => null);
  if (!tid) return;
  const thread = await client.channels.fetch(tid).catch(() => null);
  if (thread?.isThread?.()) {
    await thread.delete().catch(() => {});
  }
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
  const m = new ModalBuilder().setCustomId(modal(id, `finalr:${kind}`)).setTitle(
    kind === 'BE' ? 'Stopped Breakeven' : kind === 'OUT' ? 'Stopped Out' : 'Stopped In Profit'
  );
  const r = new TextInputBuilder()
    .setCustomId('final_r')
    .setLabel('Final R (optional)')
    .setPlaceholder('e.g., 0.3, 1.0 — overrides calc')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);
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
// Set SL → In Profit (custom price)
function makeSetProfitModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'profit')).setTitle('Set SL → In Profit (Custom)');
  const price = new TextInputBuilder()
    .setCustomId('profit_price')
    .setLabel('New SL Price (must be in profit vs entry)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 116250');
  m.addComponents(new ActionRowBuilder().addComponents(price));
  return m;
}
// Finish confirmation
function makeFinishModal(id){
  const m = new ModalBuilder().setCustomId(modal(id,'finish')).setTitle('Finish & close control thread');
  const inpt = new TextInputBuilder()
    .setCustomId('finish_confirm')
    .setLabel('Type FINISH to confirm')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);
  m.addComponents(new ActionRowBuilder().addComponents(inpt));
  return m;
}
// Undo TP modal
function makeUndoTPModal(id){
  const m = new ModalBuilder().setCustomId(modal(id,'undo:tp')).setTitle('Undo TP Hit');
  const input = new TextInputBuilder()
    .setCustomId('undo_tp_key')
    .setLabel('Enter TP to undo (TP1–TP5)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('TP1');
  m.addComponents(new ActionRowBuilder().addComponents(input));
  return m;
}
// Recap modal with Final R override
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
  m.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('recap_finalr').setLabel('Final R override (optional)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g., 1.25 or -0.50')
  ));
  m.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('recap_chart').setLabel('Chart URL (optional; or attach image)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('https://...png')
  ));
  return m;
}
// Set Risk modal
function makeSetRiskModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'risk')).setTitle('Set Risk Badge');
  const choice = new TextInputBuilder()
    .setCustomId('risk_choice')
    .setLabel('Enter: half | 1/4 | 3/4')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('half');
  m.addComponents(new ActionRowBuilder().addComponents(choice));
  return m;
}
// Full Close (Profit) modal
function makeFullProfitModal(id) {
  const m = new ModalBuilder().setCustomId(modal(id,'fullprofit')).setTitle('Fully Close — Profit');
  const price = new TextInputBuilder()
    .setCustomId('close_price')
    .setLabel('Close Price')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setPlaceholder('e.g., 117430');
  const finalR = new TextInputBuilder()
    .setCustomId('final_r')
    .setLabel('Final R (optional override, non-negative)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setPlaceholder('e.g., 1.25');
  m.addComponents(new ActionRowBuilder().addComponents(price));
  m.addComponents(new ActionRowBuilder().addComponents(finalR));
  return m;
}

// lifecycle
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await pruneGhostSignals().catch(() => {});
});

// deletes
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

// dedupe
const claimed = new Set();
function tryClaimInteraction(interaction) {
  const id = interaction.id;
  if (claimed.has(id)) return false;
  claimed.add(id);
  setTimeout(() => claimed.delete(id), 60_000);
  return true;
}

// recent signal picker
async function pickMostRecentSignal(channelId) {
  const all = (await getSignals()).map(normalizeSignal).filter(s => s.messageId);
  const inChan = all.filter(s => s.channelId === channelId);
  const list = inChan.length ? inChan : all;
  if (!list.length) return null;
  list.sort((a, b) => {
    const aId = a.messageId, bId = b.messageId;
    if (aId && bId) {
      const A = BigInt(aId), B = BigInt(bId);
      if (A === B) return 0;
      return (B > A) ? 1 : -1;
    }
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });

  for (const s of list) {
    try {
      const ch = await client.channels.fetch(s.channelId);
      await ch.messages.fetch(s.messageId);
      return s;
    } catch {}
  }
  return null;
}

// router
client.on('interactionCreate', async (interaction) => {
  try {
    if (!tryClaimInteraction(interaction)) return;

    // recap picker
    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu() && interaction.customId === 'recap:pick') {
      const id = interaction.values?.[0];
      if (!id) {
        return interaction.reply({ content: '❌ Invalid selection.', flags: MessageFlags.Ephemeral });
      }
      return interaction.showModal(makeRecapModal(id));
    }

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
const risk      = interaction.options.getString('risk') || '';
const be_at     = interaction.options.getString('be_at') || '';



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
  riskLabel: risk,
  beAt: be_at || null,
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
  riskLabel: risk,
  beAt: be_at || null,
}, interaction.channelId);


      return safeEditReply(interaction, { content: '✅ Trade signal posted.' });
    }

    // /recap
    if (interaction.isChatInputCommand() && interaction.commandName === 'recap') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', flags: MessageFlags.Ephemeral });
      }

      const period   = interaction.options.getString?.('period') || null;
      const chosenId = interaction.options.getString?.('id')     || null;

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

      if (chosenId) {
        return interaction.showModal(makeRecapModal(chosenId));
      }

      const all = (await getSignals()).map(normalizeSignal);
      all.sort((a, b) => {
        if (a.messageId && b.messageId) {
          const A = BigInt(a.messageId), B = BigInt(b.messageId);
          if (A === B) return 0;
          return (B > A) ? 1 : -1;
        }
        return Number(b.createdAt || 0) - Number(a.createdAt || 0);
      });
      const items = all.slice(0, 5);
      if (!items.length) {
        return interaction.reply({ content: '❌ No trades found to recap.', flags: MessageFlags.Ephemeral });
      }

      const menu = new StringSelectMenuBuilder()
        .setCustomId('recap:pick')
        .setPlaceholder('Select a trade to recap')
        .addOptions(items.map(s => ({
          label: `$${s.asset} ${s.direction === 'SHORT' ? 'Short' : 'Long'} • ${s.status}`,
          description: `id:${s.id}`,
          value: s.id,
        })));

      const row = new ActionRowBuilder().addComponents(menu);
      return interaction.reply({
        content: 'Pick a trade to recap:',
        components: [row],
        flags: MessageFlags.Ephemeral,
      });
    }

    // /thread-restore — block if original signal message was deleted; no recap post
    if (interaction.isChatInputCommand() && interaction.commandName === 'thread-restore') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', flags: MessageFlags.Ephemeral });
      }

      await ensureDeferred(interaction);

      const tradeId = interaction.options.getString('trade', true);

      const raw = await getSignal(tradeId).catch(()=>null);
      if (!raw) return safeEditReply(interaction, { content: '❌ Trade not found. Restore the signal first with /signal-restore.' });

      if (!raw.messageId || !raw.channelId) {
        return safeEditReply(interaction, { content: '❌ Signal message deleted. Use /signal-restore first, then /thread-restore.' });
      }

      const linkId = await getThreadId(tradeId).catch(() => null);
      if (linkId) {
        try {
          const thread = await interaction.client.channels.fetch(linkId);
          if (thread) {
            if (thread.archived) await thread.setArchived(false);
            await thread.members.add(interaction.user.id).catch(()=>{});
            return safeEditReply(interaction, { content: `Thread already exists: <#${thread.id}>` });
          }
        } catch {}
      }

      const channel = await interaction.client.channels.fetch(raw.channelId).catch(()=>null);
      if (!channel?.isTextBased?.()) return safeEditReply(interaction, { content: '❌ Original channel not found.' });

      const sig = normalizeSignal(raw);
      const name = computeThreadName(sig);
      const thread = await channel.threads.create({
        name,
        invitable: false,
        type: ChannelType.PrivateThread,
        reason: `Restore thread for trade ${tradeId}`,
      });
      await thread.members.add(interaction.user.id).catch(()=>{});

      await setThreadId(tradeId, thread.id);
      await thread.send({ content: 'Owner Control Panel', components: controlRows(sig.id) }).catch(()=>{});

      return safeEditReply(interaction, { content: `Restored: <#${thread.id}>` });
    }

    // /signal-restore — restore a soft-deleted signal, then you can /thread-restore
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal-restore') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', flags: MessageFlags.Ephemeral });
      }

      await ensureDeferred(interaction);

      const id = interaction.options.getString('id', true);

      const store = await import('./store.js');
      if (!store.restoreDeletedSignal || !store.getDeletedSignals) {
        return safeEditReply(interaction, { content: '❌ Update store.js for restore support first.' });
      }

      const restored = await store.restoreDeletedSignal(id).catch(() => null);
      if (!restored) {
        return safeEditReply(interaction, { content: '❌ Not found in deleted signals.' });
      }

      const signal = normalizeSignal(restored);
      if (!signal.channelId) {
        return safeEditReply(interaction, { content: '❌ Cannot restore: missing original channelId.' });
      }

      const msgId = await postSignalMessage(signal);
      signal.messageId = msgId;

      const channel = await client.channels.fetch(signal.channelId);
      const msg = await channel.messages.fetch(msgId);
      signal.jumpUrl = msg.url;

      await updateSignal(signal.id, { messageId: signal.messageId, jumpUrl: signal.jumpUrl });

      await createControlThread(signal);
      renameControlThread(signal).catch(() => {});
      await updateSummary();

      return safeEditReply(interaction, { content: `✅ Signal restored. Message: ${signal.jumpUrl}` });
    }

    // MODALS
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
        let signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: '❌ Trade not found for recap.' });

        const reason = (interaction.fields.getTextInputValue('recap_reason') || '').trim();
        const confs  = (interaction.fields.getTextInputValue('recap_confs')  || '').trim();
        const notes  = (interaction.fields.getTextInputValue('recap_notes')  || '').trim();
        const chart  = (interaction.fields.getTextInputValue('recap_chart')  || '').trim();

        const reasonLines = reason ? reason.split('\n').map(s => s.trim()).filter(Boolean) : [];
        const confLines   = confs  ? confs.split('\n').map(s => s.trim()).filter(Boolean)  : [];
        const notesLines  = notes  ? notes.split('\n').map(s => s.trim()).filter(Boolean)  : [];

        // Final R override
        const finalROv = (interaction.fields.getTextInputValue('recap_finalr') || '').trim();
        if (finalROv !== '') {
          if (!isNum(finalROv)) {
            return safeEditReply(interaction, { content: '❌ Final R must be a number (e.g., 1.25 or -0.5).' });
          }
          await updateSignal(id, { finalR: Number(finalROv) });
          signal = normalizeSignal(await getSignal(id));
        }

        const rrChips = computeRRChips(signal);
        const recapText = renderRecapText(signal, { reasonLines, confLines, notesLines, showBasics:false }, rrChips);

        const channel = await client.channels.fetch(interaction.channelId);
        const recent = await channel.messages.fetch({ limit: 20 }).catch(() => null);
        let userAtt = null;
        if (recent && recent.size) {
          for (const m of recent.values()) {
            if (m.author?.id !== interaction.user.id) continue;
            const att = m.attachments?.first();
            if (att && att.contentType && att.contentType.startsWith('image/')) { userAtt = att; break; }
          }
        }

        let files = [];
        let attachmentName = null;
        let attachmentUrl = null;

        if (userAtt) {
          try {
            if (typeof fetch === 'function') {
              const res = await fetch(userAtt.url);
              const buf = Buffer.from(await res.arrayBuffer());
              attachmentName = userAtt.name || 'chart.png';
              files = [ new AttachmentBuilder(buf, { name: attachmentName }) ];
              attachmentUrl = userAtt.url;
            } else {
              files = [];
            }
          } catch {
            files = [];
          }
        }

        const embedPack = renderRecapEmbed(signal, {
          roleId: '1382603857657331792',
          notesLines,
          attachmentName,
          attachmentUrl,
          imageUrl: chart || undefined,
        });

        await channel.send({
          content: `${recapText}\n\n<@&1382603857657331792>`,
          allowedMentions: { roles: ['1382603857657331792'] },
          embeds: embedPack.embeds,
          files
        });

        return safeEditReply(interaction, { content: '✅ Trade recap posted.' });
      }

      // TP prices
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
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ TP prices updated.' });
      }

      // plan
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
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ TP % plan updated.' });
      }

      // trade info — only patch fields the user actually filled
      if (interaction.customId.startsWith('modal:trade:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const patch = {};
        const entry  = interaction.fields.getTextInputValue('upd_entry')?.trim();
        const sl     = interaction.fields.getTextInputValue('upd_sl')?.trim();
        const asset  = interaction.fields.getTextInputValue('upd_asset')?.trim();
        const dir    = interaction.fields.getTextInputValue('upd_dir')?.trim()?.toUpperCase();
        const reason = interaction.fields.getTextInputValue('upd_reason')?.trim();

        if (entry && !isNaN(Number(entry))) patch.entry = entry;
        if (sl && !isNaN(Number(sl)))       patch.sl = sl;
        if (asset)                          patch.asset = asset.toUpperCase();
        if (dir === 'LONG' || dir === 'SHORT') patch.direction = dir;
        if (reason && reason.length > 0)       patch.reason = reason;

        if (Object.keys(patch).length === 0) {
          return safeEditReply(interaction, { content: 'No changes provided.' });
        }

        await updateSignal(id, patch);
        const updated = normalizeSignal(await getSignal(id));
        if (isSlMovedToBE(updated)) { await updateSignal(id, { validReentry: false }); }
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Trade info updated.' });
      }

      // roles
      if (interaction.customId.startsWith('modal:roles:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const rolesRaw = interaction.fields.getTextInputValue('roles_input') ?? '';
        await updateSignal(id, { extraRole: rolesRaw });
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Role mentions updated.' });
      }

      // max R
      if (interaction.customId.startsWith('modal:maxr:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        const signal = await getSignal(id);
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });
        const raw = interaction.fields.getTextInputValue('max_r')?.trim();
        if (!isNum(raw)) return safeEditReply(interaction, { content: '❌ Max R must be a number.' });
        await updateSignal(id, { maxR: Number(raw) });
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Max R updated.' });
      }

      // chart url
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
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Chart link updated.' });
      }

      // TP modal submit (records TP hit)
      if (interaction.customId.startsWith('modal:tp:')) {
        await ensureDeferred(interaction);
        const parts = interaction.customId.split(':');
        const tpKey = parts[2];
        const id = parts[3];

        let sig = normalizeSignal(await getSignal(id));
        if (!sig) return safeEditReply(interaction, { content: 'Signal not found.' });

        const tpUpper = tpKey.toUpperCase();
        if (sig.tpHits?.[tpUpper]) return safeEditReply(interaction, { content: `${tpUpper} already recorded.` });

        const pctRaw = interaction.fields.getTextInputValue('tp_pct')?.trim();
        const hasPct = pctRaw !== undefined && pctRaw !== null && pctRaw !== '';
        const pct = hasPct ? Number(pctRaw) : null;
        if (hasPct && (isNaN(pct) || pct < 0 || pct > 100)) {
          return safeEditReply(interaction, { content: '❌ Close % must be between 0 and 100 (or leave blank to skip).' });
        }

        const tpPrice = sig[tpKey];
        if (hasPct && pct > 0 && isNum(tpPrice)) {
          const already = (sig.fills || []).some(f => String(f.source).toUpperCase() === tpUpper);
          if (!already) sig.fills.push({ pct: Number(pct), price: Number(tpPrice), source: tpUpper });
        }

        sig.latestTpHit = tpUpper;
        sig.tpHits[tpUpper] = true;

        const extra = {};
        if (sig.beSet && !sig.beMovedAfter && tpUpper === 'TP1') {
          sig.beMovedAfter = 'TP1';
          extra.beMovedAfter = 'TP1';
        }
        if (sig.slProfitSet && !sig.slProfitAfterTP) {
          sig.slProfitAfterTP = tpUpper;
          extra.slProfitAfterTP = tpUpper;
        }

        await updateSignal(id, {
          fills: sig.fills,
          latestTpHit: sig.latestTpHit,
          tpHits: sig.tpHits,
          ...extra
        });

        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: `✅ ${tpUpper} recorded${hasPct && pct > 0 ? ` (${pct}%).` : '.'}` });
      }

      // full close
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
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ Fully closed.' });
      }

      // full close (profit)
      if (interaction.customId.startsWith('modal:fullprofit:')) {
        await ensureDeferred(interaction);
        const id = idPart;
        let signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const priceStr  = (interaction.fields.getTextInputValue('close_price') || '').trim();
        const finalRStr = (interaction.fields.getTextInputValue('final_r') || '').trim();

        if (!isNum(priceStr)) return safeEditReply(interaction, { content: '❌ Close Price must be a number.' });
        const price = Number(priceStr);

        const currentPct = (Array.isArray(signal.fills) ? signal.fills : []).reduce((a, f) => a + Number(f.pct || 0), 0);
        const remaining  = Math.max(0, 100 - currentPct);
        if (remaining > 0) {
          signal.fills = Array.isArray(signal.fills) ? signal.fills : [];
          signal.fills.push({ pct: remaining, price, source: 'FINAL_CLOSE_PROFIT' });
        }

        if (finalRStr !== '') {
          if (!isNum(finalRStr)) return safeEditReply(interaction, { content: '❌ Final R must be a number.' });
          signal.finalR = Math.max(0, Number(finalRStr));
        } else if (Number.isFinite(signal.finalR) && signal.finalR < 0) {
          signal.finalR = 0;
        }

        signal.status = STATUS.CLOSED;
        signal.validReentry = false;

        await updateSignal(id, {
          fills: signal.fills,
          status: signal.status,
          validReentry: false,
          ...(Number.isFinite(signal.finalR) ? { finalR: signal.finalR } : {})
        });

        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: `✅ Fully closed in profits at ${price}${Number.isFinite(signal.finalR) ? ` (Final ${signal.finalR.toFixed(2)}R)` : ''}` });
      }

      // stop BE / stop out / stop profit with RR override
      if (interaction.customId.startsWith('modal:finalr:')) {
        await ensureDeferred(interaction);
        try {
          const parts = interaction.customId.split(':'); // modal:finalr:BE|OUT|PROFIT:id
          const kind  = parts[2];
          const id    = parts[3];

          if (!id || !['BE','OUT','PROFIT'].includes(kind)) {
            return safeEditReply(interaction, { content: '❌ Invalid request.' });
          }

          let signal = normalizeSignal(await getSignal(id).catch(() => null));
          if (!signal) return safeEditReply(interaction, { content: '❌ Trade not found.' });

          const finalRStr = (interaction.fields.getTextInputValue('final_r') || '').trim();
          const hasFinalR = finalRStr !== '';
          if (hasFinalR && !isNum(finalRStr)) {
            return safeEditReply(interaction, { content: '❌ Final R must be a number (e.g., 0, -1, 0.3).' });
          }

          if (hasFinalR) {
            signal.finalR = Number(finalRStr);
          } else {
            let price = null;
            if (kind === 'BE') price = Number(signal.entry);
            else if (kind === 'OUT') price = Number(signal.slOriginal ?? signal.sl);
            else if (kind === 'PROFIT') price = isNum(signal.slProfitAfter) ? Number(signal.slProfitAfter) : null;

            if (!isNum(price)) {
              return safeEditReply(interaction, { content: '❌ Set SL → In Profit first (price required).' });
            }

            const currentPct = (Array.isArray(signal.fills) ? signal.fills : []).reduce((a, f) => a + Number(f.pct || 0), 0);
            const remaining  = Math.max(0, 100 - currentPct);
            if (remaining > 0) {
              signal.fills = Array.isArray(signal.fills) ? signal.fills : [];
              const src = kind === 'BE' ? 'STOP_BE' : kind === 'OUT' ? 'STOP_OUT' : 'STOP_PROFIT';
              signal.fills.push({ pct: remaining, price, source: src });
            }
          }

          if (kind === 'PROFIT') {
            signal.status = STATUS.CLOSED;
            signal.validReentry = false;
            const highestHit = ['TP5','TP4','TP3','TP2','TP1'].find(k => signal.tpHits?.[k]) || null;
            await updateSignal(id, {
              fills: signal.fills,
              status: signal.status,
              validReentry: false,
              stoppedInProfit: true,
              stoppedInProfitAfterTP: highestHit,
              ...(hasFinalR ? { finalR: signal.finalR } : {})
            });
          } else {
            signal.status = (kind === 'BE') ? STATUS.STOPPED_BE : STATUS.STOPPED_OUT;
            signal.validReentry = false;

            await updateSignal(id, {
              fills: signal.fills,
              status: signal.status,
              validReentry: false,
              ...(hasFinalR ? { finalR: signal.finalR } : {})
            });
          }

          const updated = normalizeSignal(await getSignal(id));
          await editSignalMessage(updated);
          await updateSummary();
          const msg = kind === 'BE' ? '✅ Stopped at breakeven.' : kind === 'OUT' ? '✅ Stopped out.' : '✅ Stopped in profit.';
          return safeEditReply(interaction, { content: msg });
        } catch (err) {
          console.error('modal:finalr submit error:', err);
          return safeEditReply(interaction, { content: '❌ Could not record the stop. Check logs.' });
        }
      }

      // Set SL → In Profit (custom) — flags only
      if (interaction.customId.startsWith('modal:profit:')) {
        await ensureDeferred(interaction);
        const id = interaction.customId.split(':').pop();
        let signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const priceStr = (interaction.fields.getTextInputValue('profit_price') || '').trim();
        if (!isNum(priceStr)) return safeEditReply(interaction, { content: '❌ SL price must be a number.' });
        const newSL = Number(priceStr);

        if (!isNum(signal.entry)) return safeEditReply(interaction, { content: '❌ Entry must be set first.' });
        if (signal.direction === DIR.LONG  && newSL <= signal.entry) return safeEditReply(interaction, { content: '❌ For LONG, SL must be above entry.' });
        if (signal.direction === DIR.SHORT && newSL >= signal.entry) return safeEditReply(interaction, { content: '❌ For SHORT, SL must be below entry.' });

        const highestHit = ['TP5','TP4','TP3','TP2','TP1'].find(k => signal.tpHits?.[k]) || null;

        await updateSignal(id, {
          slProfitSet: true,
          slProfitAfter: String(newSL),
          slProfitAfterTP: highestHit,
          validReentry: false,
          beSet: false,
          beMovedAfter: null
        });

        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated);
        await updateSummary();
        return safeEditReply(interaction, { content: '✅ SL moved into profits.' });
      }

      // finish modal submit — closes the control thread
      if (interaction.customId.startsWith('modal:finish:')) {
        await ensureDeferred(interaction);
        const id = interaction.customId.split(':').pop();
        const token = (interaction.fields.getTextInputValue('finish_confirm') || '').trim();
        if (token !== 'FINISH') {
          return safeEditReply(interaction, { content: '❌ Type FINISH to confirm.' });
        }
        await deleteControlThread(id).catch(()=>{});
        return safeEditReply(interaction, { content: '🏁 Finished. Control thread closed.' });
      }

      // Undo TP (modal submit)
      if (interaction.customId.startsWith('modal:undo:tp:')) {
        await ensureDeferred(interaction);
        const id = interaction.customId.split(':').pop();
        let signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        const keyLine = (interaction.fields.getTextInputValue('undo_tp_key') || '').trim().toUpperCase();
        if (!/^TP[1-5]$/.test(keyLine)) return safeEditReply(interaction, { content: '❌ Enter TP1–TP5.' });

        signal.fills = (signal.fills || []).filter(f => String(f.source).toUpperCase() !== keyLine);
        signal.tpHits = { ...(signal.tpHits || {}) , [keyLine]: false };
        const order = ['TP5','TP4','TP3','TP2','TP1'];
        signal.latestTpHit = order.find(k => signal.tpHits[k]) || null;

        await updateSignal(id, { fills: signal.fills, tpHits: signal.tpHits, latestTpHit: signal.latestTpHit });
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated); await updateSummary();
        return safeEditReply(interaction, { content: `↩️ ${keyLine} undone.` });
      }

      // Set Risk submit
      if (interaction.customId.startsWith('modal:risk:')) {
        await ensureDeferred(interaction);
        const id = interaction.customId.split(':').pop();
        const raw = (interaction.fields.getTextInputValue('risk_choice') || '').trim().toLowerCase();

        let riskLabel = '';
        if (raw === 'half' || raw === '1/2') riskLabel = 'half';
        else if (raw === '1/4' || raw === 'quarter') riskLabel = '1/4';
        else if (raw === '3/4' || raw === 'three-quarter' || raw === 'threequarter') riskLabel = '3/4';
        else return safeEditReply(interaction, { content: '❌ Use: half | 1/4 | 3/4' });

        await updateSignal(id, { riskLabel });
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated); await updateSummary();
        return safeEditReply(interaction, { content: `⚖️ Risk badge set to ${riskLabel}.` });
      }
    }

    // buttons
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
      if (key === 'fullprofit')   return interaction.showModal(makeFullProfitModal(id));
      if (key === 'stopbe')       return interaction.showModal(makeFinalRModal(id, 'BE'));
      if (key === 'stopped')      return interaction.showModal(makeFinalRModal(id, 'OUT'));
      if (key === 'upd:maxr')     return interaction.showModal(makeMaxRModal(id));
      if (key === 'upd:chart')    return interaction.showModal(makeChartModal(id));

      // risk buttons
      if (key === 'risk:set')   return interaction.showModal(makeSetRiskModal(id));
      if (key === 'risk:clear') {
        await ensureDeferred(interaction);
        await updateSignal(id, { riskLabel: '' });
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated); await updateSummary();
        return safeEditReply(interaction, { content: '⚖️ Risk badge cleared.' });
      }

      if (key === 'setbe') {
  await ensureDeferred(interaction);
  const sig0 = normalizeSignal(await getSignal(id));
  if (!sig0) return safeEditReply(interaction, { content: 'Signal not found.' });
  if (!isNum(sig0.entry)) return safeEditReply(interaction, { content: '❌ Entry must be set to move SL to BE.' });

  const highestHit = ['TP5','TP4','TP3','TP2','TP1'].find(k => sig0.tpHits?.[k]) || null;

  const patch = {
    validReentry: false,
    beSet: true,
    beMovedAfter: sig0.beMovedAfter || highestHit || null,
    slProfitSet: false,
    slProfitAfter: null,
    slProfitAfterTP: null,
    beAt: sig0.beAt || String(sig0.entry), // default to entry if not set
  };

  await updateSignal(id, patch);
  const updated = normalizeSignal(await getSignal(id));
  await editSignalMessage(updated); await updateSummary();
  return safeEditReply(interaction, {
    content: `✅ SL → BE set at ${updated.beAt}${patch.beMovedAfter ? ` after ${patch.beMovedAfter}` : ''}.`
  });
}


      if (key === 'setprofit') {
        return interaction.showModal(makeSetProfitModal(id));
      }

      if (key === 'stopprofit') {
        return interaction.showModal(makeFinalRModal(id, 'PROFIT'));
      }

      if (key === 'finish') {
        return interaction.showModal(makeFinishModal(id));
      }

      if (key === 'undo_menu') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(btn(id,'undo:tp')).setLabel('↩ Undo TP…').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(btn(id,'undo:be')).setLabel('↩ Undo SL → BE').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(btn(id,'undo:profit')).setLabel('↩ Undo SL → Profit').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(btn(id,'undo:reopen')).setLabel('↩ Reopen').setStyle(ButtonStyle.Secondary),
        );
        return interaction.reply({ content: 'Undo actions:', components: [row], flags: MessageFlags.Ephemeral });
      }

      if (key === 'undo:tp') {
        return interaction.showModal(makeUndoTPModal(id));
      }
      if (key === 'undo:be') {
        await ensureDeferred(interaction);
        await updateSignal(id, { beSet:false, beMovedAfter:null });
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated); await updateSummary();
        return safeEditReply(interaction, { content: '↩️ Undid SL → BE.' });
      }
      if (key === 'undo:profit') {
        await ensureDeferred(interaction);
        await updateSignal(id, { slProfitSet:false, slProfitAfter:null, slProfitAfterTP:null, stoppedInProfit:false, stoppedInProfitAfterTP:null });
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated); await updateSummary();
        return safeEditReply(interaction, { content: '↩️ Undid SL → Profit.' });
      }
      if (key === 'undo:reopen') {
        await ensureDeferred(interaction);
        let signal = normalizeSignal(await getSignal(id));
        if (!signal) return safeEditReply(interaction, { content: 'Signal not found.' });

        if (![STATUS.CLOSED, STATUS.STOPPED_BE, STATUS.STOPPED_OUT].includes(signal.status)) {
          return safeEditReply(interaction, { content: 'ℹ️ Trade is already active.' });
        }
        const fills = (signal.fills || []).filter(f => !['FINAL_CLOSE','STOP_BE','STOP_OUT','STOP_PROFIT','FINAL_CLOSE_PROFIT'].includes(String(f.source).toUpperCase()));
        await updateSignal(id, { fills, status: STATUS.RUN_VALID, validReentry: true, stoppedInProfit:false, stoppedInProfitAfterTP:null });
        const updated = normalizeSignal(await getSignal(id));
        await editSignalMessage(updated); await updateSummary();
        return safeEditReply(interaction, { content: '↩️ Reopened trade.' });
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

        sig.latestTpHit = tpUpper;
        sig.tpHits[tpUpper] = true;

        const extra = {};
        if (sig.beSet && !sig.beMovedAfter && tpUpper === 'TP1') {
          sig.beMovedAfter = 'TP1';
          extra.beMovedAfter = 'TP1';
        }
        if (sig.slProfitSet && !sig.slProfitAfterTP) {
          sig.slProfitAfterTP = tpUpper;
          extra.slProfitAfterTP = tpUpper;
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

// create/save signal
const pendingSignals = new Map();

async function createSignal(payload, channelId) {
  const signal = normalizeSignal({
  id: nano(),
  createdAt: Date.now(),
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
  // NEW: carry planned BE price through creation if provided
  beAt: payload.beAt || null,
  slProfitSet: false,
  slProfitAfter: null,
  slProfitAfterTP: null,
  stoppedInProfit: false,
  stoppedInProfitAfterTP: null,
  riskLabel: (payload.riskLabel || '').trim(),
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

// ghost prune
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
