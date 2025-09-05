import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  WebhookClient,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, updateSignal, deleteSignal, getSignals,
  getSummaryMessageId, setSummaryMessageId,
  getStoredWebhook, setStoredWebhook, getThreadId, setThreadId
} from './store.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// temp store for cross-modal data
const pendingSignals = new Map(); // modalId -> { fields... }

const fmt = v => (v ?? '—');
const dirWord = d => (d === 'LONG' ? 'Long' : 'Short');

<<<<<<< HEAD
// ---------- R & TP helpers ----------
const toNum = (x) => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(String(x).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

function riskPerUnit(entry, sl, dir) {
  const e = toNum(entry), s = toNum(sl);
  if (e == null || s == null) return null;
  const r = Math.abs(e - s);
  return r > 0 ? r : null;
=======
function highestTpHit(s) {
  return s.tpHit === 'TP3' ? 'TP3' : s.tpHit === 'TP2' ? 'TP2' : s.tpHit === 'TP1' ? 'TP1' : null;
>>>>>>> 0ce2bdde75ba7bc626d6d9dc1aaa1590efbf84e9
}

function rForExit(entry, sl, dir, price) {
  const e = toNum(entry), s = toNum(sl), p = toNum(price);
  const R = riskPerUnit(e, s, dir);
  if (e == null || s == null || p == null || !R) return null;
  if (dir === 'LONG') return (p - e) / (e - s);
  return (e - p) / (s - e); // SHORT
}

function highestTpHit(sig) {
  // based on closes ledger and/or explicit tpHit tag
  const order = ['TP5','TP4','TP3','TP2','TP1'];
  const levelsHit = new Set();
  if (sig.tpHit) levelsHit.add(sig.tpHit);
  (sig.closes || []).forEach(c => levelsHit.add(c.level));
  for (const lv of order) if (levelsHit.has(lv)) return lv;
  return null;
}

function realizedR(sig) {
  // sum over closes: R_i * (pct_i/100)
  const e = sig.entry, s = sig.stop, d = sig.direction;
  const ledger = sig.closes || [];
  let total = 0;
  for (const c of ledger) {
    const r = rForExit(e, s, d, c.price);
    if (r == null) continue;
    total += r * (Math.max(0, Math.min(100, Number(c.pct))) / 100);
  }
  return total; // may be 0
}

function remainingPct(sig) {
  const ledger = sig.closes || [];
  let used = 0;
  for (const c of ledger) used += Math.max(0, Math.min(100, Number(c.pct)));
  return Math.max(0, 100 - used);
}

function levelPrice(sig, level) {
  return ({
    TP1: sig.tp1,
    TP2: sig.tp2,
    TP3: sig.tp3,
    TP4: sig.tp4,
    TP5: sig.tp5
  })[level] || null;
}

function levelPctPlan(sig, level) {
  return ({
    TP1: sig.plan?.tp1Pct,
    TP2: sig.plan?.tp2Pct,
    TP3: sig.plan?.tp3Pct,
    TP4: sig.plan?.tp4Pct,
    TP5: sig.plan?.tp5Pct
  })[level] ?? 0;
}

function addClose(sig, { level, price, pct }) {
  const p = Math.max(0, Math.min(100, Number(pct)));
  const rem = remainingPct(sig);
  const effective = Math.min(p, rem);
  if (effective <= 0) return sig;
  const closes = Array.isArray(sig.closes) ? [...sig.closes] : [];
  closes.push({ level, price, pct: effective });
  return { ...sig, closes };
}

// ---------- Status formatting ----------
function statusLines(sig) {
  // Active RUN_VALID (including SL set to BE as active)
  if (sig.status === 'RUN_VALID') {
    // left line
    const tp = highestTpHit(sig);
    const left = tp ? `Active 🟩 | ${tp} hit` : 'Active 🟩';

    // right line (Valid for re-entry)
    const rightFlags = [];
    if (sig.slAtBE) rightFlags.push('SL set to breakeven'); // show SL set to BE here
    const right = `Valid for re-entry: ${sig.validReentry ? 'Yes' : 'No'}${rightFlags.length ? ' | ' + rightFlags.join(' | ') : ''}`;

    // result so far (only if > 0)
    const rSoFar = realizedR(sig);
    const extra = rSoFar > 0 ? `Result so far: ${rToStr(rSoFar, 2)}` : null;

    return extra ? [left, right, extra] : [left, right];
  }

  // Inactive
  let reason = '—';
  if (sig.status === 'STOPPED_OUT') reason = 'Stopped out';
  if (sig.status === 'STOPPED_BE') {
    const tp = highestTpHit(sig);
    reason = `SL set to breakeven${tp ? ` after ${tp}` : ''}`;
  }
  if (sig.status === 'CLOSED') {
    const tp = highestTpHit(sig);
    reason = `Fully closed${tp ? ` after ${tp}` : ''}`;
  }
  const left = `Inactive 🟥 | ${reason}`;
  const right = `Valid for re-entry: No`;

  const rFinal = finalR(sig);
  const extra = rFinal != null ? `Result: ${rToStr(rFinal, 2)}` : null;

  return extra ? [left, right, extra] : [left, right];
}

function rToStr(r, dp = 2) {
  const v = Number(r);
  if (!Number.isFinite(v)) return '—';
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(dp)}R`;
}

function finalR(sig) {
  // if inactive, realizedR + remainderClose (already recorded at the time of closing)
  // If we allowed manual override, prefer it.
  if (sig.resultOverride != null && sig.status !== 'RUN_VALID') return Number(sig.resultOverride);
  if (sig.status === 'RUN_VALID') return null;
  return realizedR(sig);
}

// ---------- Rendering ----------
function renderSignalText(sig, mentionLine = '') {
  const lines = [];
  lines.push(`**${sig.asset} | ${dirWord(sig.direction)} ${sig.direction === 'LONG' ? '🟢' : '🔴'}**`, ``);
  lines.push(`📊 **Trade Details**`);
  lines.push(`Entry: ${fmt(sig.entry)}`);
  lines.push(`SL: ${fmt(sig.stop)}`);
  if (sig.tp1) lines.push(`TP1: ${sig.tp1}`);
  if (sig.tp2) lines.push(`TP2: ${sig.tp2}`);
  if (sig.tp3) lines.push(`TP3: ${sig.tp3}`);
  if (sig.tp4) lines.push(`TP4: ${sig.tp4}`);
  if (sig.tp5) lines.push(`TP5: ${sig.tp5}`);
  if (sig.reason) lines.push(``, `📝 **Reasoning**`, sig.reason);

  lines.push(``, `🚦 **Status**`);
  const sts = statusLines(sig);
  for (const l of sts) lines.push(l);

  if (mentionLine) lines.push('', mentionLine); // blank line before mentions
  return lines.join('\n');
}

function renderSummaryText(trades) {
  const title = `**JV Current Active Trades** 📊`;
  if (!trades.length) {
    return `${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades.`;
  }
  const items = trades.map((t, i) => {
    const jump = t.jumpUrl ? ` — ${t.jumpUrl}` : '';
    return `${i + 1}. ${t.asset} ${dirWord(t.direction)} ${t.direction === 'LONG' ? '🟢' : '🔴'}${jump}\n` +
           `   Entry: ${fmt(t.entry)}\n` +
           `   SL: ${fmt(t.stop)}`;
  });
  return `${title}\n\n${items.join('\n\n')}`;
}

// ---------- Mentions ----------
function extractRoleIds(extraRoleRaw) {
  const ids = [];
  if (config.mentionRoleId) ids.push(config.mentionRoleId);
  if (!extraRoleRaw) return Array.from(new Set(ids));
  const m = extraRoleRaw.match(/\d{6,}/g);
  if (m) ids.push(...m);
  return Array.from(new Set(ids));
}
const allowedMentionsForRoles = (roleIds) => ({ parse: [], roles: roleIds });
const buildMentionLine = (roleIds) => (roleIds?.length ? roleIds.map(id => `<@&${id}>`).join(' ') : '');

// ---------- Webhooks ----------
async function getOrCreateWebhook(channel) {
  const stored = await getStoredWebhook(channel.id);
  if (stored) return new WebhookClient({ id: stored.id, token: stored.token });

  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find(h => h.name === config.brandName);
  if (!hook) {
    hook = await channel.createWebhook({
      name: config.brandName,
      avatar: config.brandAvatarUrl || null
    });
  } else {
    const needsRename = hook.name !== config.brandName;
    const needsAvatar = !!config.brandAvatarUrl && !hook.avatar;
    if ((needsRename || needsAvatar) && hook.edit) {
      try { await hook.edit({ name: config.brandName, avatar: config.brandAvatarUrl || undefined }); } catch {}
    }
  }
  await setStoredWebhook(channel.id, { id: hook.id, token: hook.token });
  return new WebhookClient({ id: hook.id, token: hook.token });
}

// ---------- Ready ----------
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---------- Interaction handling ----------
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
      const stop = interaction.options.getString('sl');
      const tp1 = interaction.options.getString('tp1');
      const tp2 = interaction.options.getString('tp2');
      const tp3 = interaction.options.getString('tp3');
      const tp4 = interaction.options.getString?.('tp4') ?? null; // ok if not present in schema
      const tp5 = interaction.options.getString?.('tp5') ?? null;
      const reason = interaction.options.getString('reason');
      const extraRole = interaction.options.getString('extra_role');

      if (assetSel === 'OTHER') {
        const pid = nano();
        pendingSignals.set(pid, { direction, entry, stop, tp1, tp2, tp3, tp4, tp5, reason, extraRole });
        const modal = new ModalBuilder()
          .setCustomId(`modal_asset_${pid}`)
          .setTitle('Enter custom asset');

        const input = new TextInputBuilder()
          .setCustomId('asset_value')
          .setLabel('Asset name (e.g., PEPE, XRP)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }

      await interaction.deferReply({ ephemeral: true });
      await createAndPostSignal({
        asset: assetSel, direction, entry, stop, tp1, tp2, tp3, tp4, tp5, reason, extraRole
      });
      return interaction.editReply({ content: '✅ Trade signal posted.' });
    }

    // Modals
    if (interaction.isModalSubmit()) {
      // asset modal
      if (interaction.customId.startsWith('modal_asset_')) {
        await interaction.deferReply({ ephemeral: true });
        const pid = interaction.customId.replace('modal_asset_', '');
        const data = pendingSignals.get(pid);
        pendingSignals.delete(pid);
        if (!data) return interaction.editReply({ content: '❌ Session expired. Please use /signal again.' });
        const assetValue = interaction.fields.getTextInputValue('asset_value').trim().toUpperCase();
        await createAndPostSignal({ asset: assetValue, ...data });
        return interaction.editReply({ content: '✅ Trade signal posted.' });
      }

      // update levels
      if (interaction.customId.startsWith('modal_update_')) {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.customId.replace('modal_update_', '');
        const sig = await getSignal(id);
        if (!sig) return interaction.editReply({ content: 'Signal not found.' });

        const entry = interaction.fields.getTextInputValue('upd_entry')?.trim();
        const sl = interaction.fields.getTextInputValue('upd_sl')?.trim();
        const tp1 = interaction.fields.getTextInputValue('upd_tp1')?.trim();
        const tp2 = interaction.fields.getTextInputValue('upd_tp2')?.trim();
        const tp3 = interaction.fields.getTextInputValue('upd_tp3')?.trim();
        const tp4 = interaction.fields.getTextInputValue('upd_tp4')?.trim();
        const tp5 = interaction.fields.getTextInputValue('upd_tp5')?.trim();

        const patch = {};
        if (entry) patch.entry = entry;
        if (sl) patch.stop = sl;
        if (tp1 !== undefined && tp1 !== null && tp1 !== '') patch.tp1 = tp1;
        if (tp2 !== undefined && tp2 !== null && tp2 !== '') patch.tp2 = tp2;
        if (tp3 !== undefined && tp3 !== null && tp3 !== '') patch.tp3 = tp3;
        if (tp4 !== undefined && tp4 !== null && tp4 !== '') patch.tp4 = tp4;
        if (tp5 !== undefined && tp5 !== null && tp5 !== '') patch.tp5 = tp5;

        const impactful = Boolean(entry || sl || tp1 || tp2 || tp3 || tp4 || tp5);

        try {
          await updateSignal(id, patch);
          let updated = await getSignal(id);
          // re-render only; on /update we do not auto-ping by extra post
          await editSignalWebhookMessage(updated);
          await updateSummaryText();
          return interaction.editReply({ content: '✅ Levels updated.' });
        } catch (err) {
          console.error('update levels modal error', err);
          return interaction.editReply({ content: '❌ Update failed. Check logs.' });
        }
      }

      // update details (asset/direction/reason/role)
      if (interaction.customId.startsWith('modal_meta_')) {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.customId.replace('modal_meta_', '');
        const sig = await getSignal(id);
        if (!sig) return interaction.editReply({ content: 'Signal not found.' });

        const asset = interaction.fields.getTextInputValue('upd_asset')?.trim();
        const direction = interaction.fields.getTextInputValue('upd_dir')?.trim();
        const reason = interaction.fields.getTextInputValue('upd_reason')?.trim();
        const extra = interaction.fields.getTextInputValue('upd_extra')?.trim();

        const patch = {};
        if (asset) patch.asset = asset.toUpperCase();
        if (direction) {
          const d = direction.toLowerCase();
          if (d === 'long' || d === 'l') patch.direction = 'LONG';
          else if (d === 'short' || d === 's') patch.direction = 'SHORT';
        }
        if (reason !== undefined) patch.reason = reason; // allow empty to clear if you later want that behavior
        if (extra) patch.extraRole = extra;

        const impactful = Boolean(patch.asset || patch.direction || patch.entry || patch.stop || patch.tp1 || patch.tp2 || patch.tp3 || patch.tp4 || patch.tp5);

        try {
          await updateSignal(id, patch);
          const updated = await getSignal(id);
          await editSignalWebhookMessage(updated);
          await updateSummaryText();
          return interaction.editReply({ content: '✅ Details updated.' });
        } catch (err) {
          console.error('update details modal error', err);
          return interaction.editReply({ content: '❌ Update failed. Check logs.' });
        }
      }

      // set TP plan modal
      if (interaction.customId.startsWith('modal_plan_')) {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.customId.replace('modal_plan_', '');
        const sig = await getSignal(id);
        if (!sig) return interaction.editReply({ content: 'Signal not found.' });

        const p1 = interaction.fields.getTextInputValue('plan_tp1')?.trim();
        const p2 = interaction.fields.getTextInputValue('plan_tp2')?.trim();
        const p3 = interaction.fields.getTextInputValue('plan_tp3')?.trim();
        const p4 = interaction.fields.getTextInputValue('plan_tp4')?.trim();
        const p5 = interaction.fields.getTextInputValue('plan_tp5')?.trim();

        const plan = {
          tp1Pct: p1 ? Number(p1) : undefined,
          tp2Pct: p2 ? Number(p2) : undefined,
          tp3Pct: p3 ? Number(p3) : undefined,
          tp4Pct: p4 ? Number(p4) : undefined,
          tp5Pct: p5 ? Number(p5) : undefined
        };
        // gentle note if sum > 100
        const sum = [plan.tp1Pct, plan.tp2Pct, plan.tp3Pct, plan.tp4Pct, plan.tp5Pct]
          .filter(v => Number.isFinite(v))
          .reduce((a,b)=>a+b,0);

        await updateSignal(id, { plan: { ...sig.plan, ...plan } });
        const threadId = await getThreadId(id);
        if (threadId && sum > 100) {
          try {
            const t = await client.channels.fetch(threadId);
            await t.send(`Note: TP plan total ${sum}% > 100%. Bot will cap closes to remaining % dynamically.`);
          } catch {}
        }

        const updated = await getSignal(id);
        await editSignalWebhookMessage(updated);
        return interaction.editReply({ content: '✅ TP plan saved.' });
      }

      // fully closed: enter remainder price
      if (interaction.customId.startsWith('modal_close_')) {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.customId.replace('modal_close_', '');
        let sig = await getSignal(id);
        if (!sig) return interaction.editReply({ content: 'Signal not found.' });

        const px = interaction.fields.getTextInputValue('close_price')?.trim();
        const rem = remainingPct(sig);
        if (rem > 0 && px) {
          sig = addClose(sig, { level: 'FINAL', price: px, pct: rem });
          await updateSignal(id, sig);
        }
        // mark inactive CLOSED
        await updateSignal(id, { status: 'CLOSED', validReentry: false });
        sig = await getSignal(id);

        await editSignalWebhookMessage(sig);
        await updateSummaryText();

        // offer override button
        await interaction.editReply({ content: '✅ Trade fully closed. You can optionally override the final R below.' });
        try {
          const threadId = await getThreadId(id);
          if (threadId) {
            const t = await client.channels.fetch(threadId);
            await t.send(`Final result recorded: ${rToStr(finalR(sig), 2)}`);
          }
        } catch {}
        return;
      }

      // override final R
      if (interaction.customId.startsWith('modal_override_')) {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.customId.replace('modal_override_', '');
        let sig = await getSignal(id);
        if (!sig) return interaction.editReply({ content: 'Signal not found.' });

        const val = interaction.fields.getTextInputValue('override_r')?.trim();
        const num = Number(val);
        if (!Number.isFinite(num)) {
          return interaction.editReply({ content: '❌ Invalid number.' });
        }
        await updateSignal(id, { resultOverride: num });
        sig = await getSignal(id);
        await editSignalWebhookMessage(sig);
        await interaction.editReply({ content: `✅ Final R overridden to ${rToStr(num, 2)}.` });
        try {
          const tid = await getThreadId(id);
          if (tid) {
            const t = await client.channels.fetch(tid);
            await t.send(`Manual override: ${rToStr(num, 2)}`);
          }
        } catch {}
        return;
      }
    }

    // Buttons
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }

<<<<<<< HEAD
      // parse action/id
=======
      // robust parsing: action is before first "_", id is everything after
>>>>>>> 0ce2bdde75ba7bc626d6d9dc1aaa1590efbf84e9
      const cid = interaction.customId;
      const sep = cid.indexOf('_');
      const action = sep === -1 ? cid : cid.slice(0, sep);
      const id = sep === -1 ? null : cid.slice(sep + 1);

<<<<<<< HEAD
      // show-modals (no defer)
      if (action === 'update') {
        if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_update_${id}`).setTitle('Update Levels');
        const inputs = [
          ['upd_entry','Entry'],
          ['upd_sl','SL'],
          ['upd_tp1','TP1'],
          ['upd_tp2','TP2'],
          ['upd_tp3','TP3'],
          ['upd_tp4','TP4'],
          ['upd_tp5','TP5'],
        ].map(([cid, label]) => new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false));
        // 5 per modal; split into two if needed
        const row1 = new ActionRowBuilder().addComponents(inputs[0]);
        const row2 = new ActionRowBuilder().addComponents(inputs[1]);
        const row3 = new ActionRowBuilder().addComponents(inputs[2]);
        const row4 = new ActionRowBuilder().addComponents(inputs[3]);
        const row5 = new ActionRowBuilder().addComponents(inputs[4]);
        // we’ll put TP4/TP5 into this first modal; Discord allows 5 rows max. To keep it simple, include TP4/TP5 by replacing TP2/TP3 rows if you prefer.
        modal.addComponents(row1, row2, row3, row4, row5);
        return interaction.showModal(modal);
      }

      if (action === 'meta') {
        if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_meta_${id}`).setTitle('Update Details');
        const m1 = new TextInputBuilder().setCustomId('upd_asset').setLabel('Asset (e.g., BTC)').setStyle(TextInputStyle.Short).setRequired(false);
        const m2 = new TextInputBuilder().setCustomId('upd_dir').setLabel('Direction (Long/Short)').setStyle(TextInputStyle.Short).setRequired(false);
        const m3 = new TextInputBuilder().setCustomId('upd_reason').setLabel('Reason').setStyle(TextInputStyle.Paragraph).setRequired(false);
        const m4 = new TextInputBuilder().setCustomId('upd_extra').setLabel('Extra role (ID or @mention)').setStyle(TextInputStyle.Short).setRequired(false);
=======
      // SHOW MODAL path must not defer
      if (action === 'update') {
        if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });
        const modal = new ModalBuilder()
          .setCustomId(`modal_update_${id}`)
          .setTitle('Update Levels');
        const i1 = new TextInputBuilder().setCustomId('upd_entry').setLabel('Entry').setStyle(TextInputStyle.Short).setRequired(false);
        const i2 = new TextInputBuilder().setCustomId('upd_sl').setLabel('SL').setStyle(TextInputStyle.Short).setRequired(false);
        const i3 = new TextInputBuilder().setCustomId('upd_tp1').setLabel('TP1').setStyle(TextInputStyle.Short).setRequired(false);
        const i4 = new TextInputBuilder().setCustomId('upd_tp2').setLabel('TP2').setStyle(TextInputStyle.Short).setRequired(false);
        const i5 = new TextInputBuilder().setCustomId('upd_tp3').setLabel('TP3').setStyle(TextInputStyle.Short).setRequired(false);
>>>>>>> 0ce2bdde75ba7bc626d6d9dc1aaa1590efbf84e9
        modal.addComponents(
          new ActionRowBuilder().addComponents(m1),
          new ActionRowBuilder().addComponents(m2),
          new ActionRowBuilder().addComponents(m3),
          new ActionRowBuilder().addComponents(m4)
        );
        return interaction.showModal(modal);
      }

<<<<<<< HEAD
      if (action === 'plan') {
        if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_plan_${id}`).setTitle('Set TP Plan (%)');
        const make = (cid, label) => new TextInputBuilder().setCustomId(cid).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('e.g., 50');
        modal.addComponents(
          new ActionRowBuilder().addComponents(make('plan_tp1','TP1 %')),
          new ActionRowBuilder().addComponents(make('plan_tp2','TP2 %')),
          new ActionRowBuilder().addComponents(make('plan_tp3','TP3 %')),
          new ActionRowBuilder().addComponents(make('plan_tp4','TP4 %')),
          new ActionRowBuilder().addComponents(make('plan_tp5','TP5 %'))
        );
        return interaction.showModal(modal);
      }
=======
      // all other buttons can defer
      await interaction.deferReply({ ephemeral: true });
      if (!id) return interaction.editReply({ content: 'Bad button ID.' });
>>>>>>> 0ce2bdde75ba7bc626d6d9dc1aaa1590efbf84e9

      if (action === 'close') {
        if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_close_${id}`).setTitle('Fully Close — Remainder Price');
        const f = new TextInputBuilder().setCustomId('close_price').setLabel('Close remainder at price').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(f));
        return interaction.showModal(modal);
      }

      if (action === 'override') {
        if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });
        const modal = new ModalBuilder().setCustomId(`modal_override_${id}`).setTitle('Override Final R');
        const f = new TextInputBuilder().setCustomId('override_r').setLabel('Final R (e.g., 0.75 or -1)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(f));
        return interaction.showModal(modal);
      }

      // for all others we can defer
      await interaction.deferReply({ ephemeral: true });
      if (!id) return interaction.editReply({ content: 'Bad button ID.' });

      let sig = await getSignal(id);
      if (!sig) return interaction.editReply({ content: 'Signal not found.' });

      // ------ actions that change state / TP hits ------
      const tpActions = { tp1hit: 'TP1', tp2hit: 'TP2', tp3hit: 'TP3', tp4hit: 'TP4', tp5hit: 'TP5' };
      if (tpActions[action]) {
        const level = tpActions[action];
        // Mark TP hit badge to highest
        const rank = { TP1:1, TP2:2, TP3:3, TP4:4, TP5:5 };
        let newTpHit = sig.tpHit;
        if (!newTpHit || rank[level] > rank[newTpHit]) newTpHit = level;

        // Apply plan auto-close
        const pctPlan = Number(levelPctPlan(sig, level)) || 0;
        const rem = remainingPct(sig);
        if (pctPlan > 0 && rem > 0) {
          const price = levelPrice(sig, level);
          if (price) {
            sig = addClose(sig, { level, price, pct: Math.min(pctPlan, rem) });
            await updateSignal(id, sig);
          }
        }
        await updateSignal(id, { tpHit: newTpHit });
        sig = await getSignal(id);
        await editSignalWebhookMessage(sig);
        await updateSummaryText();
        return interaction.editReply({ content: `✅ ${level} recorded.` });
      }

      if (action === 'setbe') {
        // mark SL set to breakeven (ACTIVE)
        await updateSignal(id, { slAtBE: true, validReentry: false, status: 'RUN_VALID' });
        sig = await getSignal(id);
        await editSignalWebhookMessage(sig);
        await updateSummaryText();
        return interaction.editReply({ content: '✅ SL set to breakeven (active).' });
      }

      if (action === 'stopbe') {
        // inactive, remainder closes at 0R
        const rem = remainingPct(sig);
        if (rem > 0) {
          // add 0R close by using entry price for remainder (breakeven)
          const price = sig.entry;
          sig = addClose(sig, { level: 'BE', price, pct: rem });
          await updateSignal(id, sig);
        }
        await updateSignal(id, { status: 'STOPPED_BE', validReentry: false });
        sig = await getSignal(id);
        await editSignalWebhookMessage(sig);
        await deleteOwnerThread(id); // your earlier rule: delete for Stopped BE
        await updateSummaryText();

        // offer override button
        try {
          await interaction.followUp({ content: 'Optionally override the final R:', ephemeral: true, components: [
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`override_${id}`).setLabel('Override Final R').setStyle(ButtonStyle.Secondary))
          ]});
        } catch {}
        return interaction.editReply({ content: '✅ Stopped at breakeven.' });
      }

      if (action === 'stopped') {
        // inactive, remainder closes at -1R → use SL price
        const rem = remainingPct(sig);
        if (rem > 0) {
          const price = sig.stop; // SL hit
          sig = addClose(sig, { level: 'SL', price, pct: rem });
          await updateSignal(id, sig);
        }
        await updateSignal(id, { status: 'STOPPED_OUT', validReentry: false });
        sig = await getSignal(id);
        await editSignalWebhookMessage(sig);
        await deleteOwnerThread(id); // delete on stopped out
        await updateSummaryText();

        try {
          await interaction.followUp({ content: 'Optionally override the final R:', ephemeral: true, components: [
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`override_${id}`).setLabel('Override Final R').setStyle(ButtonStyle.Secondary))
          ]});
        } catch {}
        return interaction.editReply({ content: '✅ Stopped out.' });
      }

      if (action === 'closed') {
        // handled via modal_close_ (we keep thread). Here, if user clicked this non-modal path by mistake:
        return interaction.editReply({ content: 'Use the Fully Closed button (modal) to enter close price.' });
      }

<<<<<<< HEAD
      if (action === 'del') {
        // delete the posted signal message + thread + db
        await deleteSignalMessage(sig).catch(() => {});
        await deleteOwnerThread(id);
        await deleteSignal(id);
        await updateSummaryText();
        return interaction.editReply({ content: '❌ Trade deleted.' });
      }

      return interaction.editReply({ content: 'No-op.' });
=======
      const patches = {
        tp1hit: { tpHit: 'TP1' },
        tp2hit: { tpHit: 'TP2' },
        tp3hit: { tpHit: 'TP3' },
        stopped:{ status: 'STOPPED_OUT', validReentry: false },
        stopbe: { status: 'STOPPED_BE', validReentry: false },
        closed: { status: 'CLOSED',     validReentry: false }
      };

      if (patches[action]) {
        await updateSignal(id, patches[action]);
      }

      const updated = await getSignal(id);
      await editSignalWebhookMessage(updated);

      // thread actions per rules
      if (action === 'stopped' || action === 'stopbe') {
        await deleteOwnerThread(id); // delete thread for stopped out / stopped BE
      }
      if (action === 'closed') {
        // keep thread
      }

      await updateSummaryText();
      return interaction.editReply({ content: '✅ Updated.' });
>>>>>>> 0ce2bdde75ba7bc626d6d9dc1aaa1590efbf84e9
    }
  } catch (e) {
    console.error('interaction error:', e);
    if (interaction.deferred || interaction.replied) {
      try { await interaction.editReply({ content: '❌ Internal error.' }); } catch {}
    }
  }
});

// ---------- Core helpers ----------
async function createAndPostSignal(payload) {
  const signal = {
    id: nano(),
    asset: payload.asset,
    direction: payload.direction,
    entry: payload.entry,
    stop: payload.stop,
    tp1: payload.tp1,
    tp2: payload.tp2,
    tp3: payload.tp3,
    tp4: payload.tp4 || null,
    tp5: payload.tp5 || null,
    reason: payload.reason,
    extraRole: payload.extraRole,
    status: 'RUN_VALID',
    validReentry: true,
    slAtBE: false,          // active: SL moved to BE (no close)
    tpHit: null,            // 'TP1'...'TP5'
    plan: {},               // {tp1Pct, tp2Pct, ...}
    closes: [],             // [{level, price, pct}]
    resultOverride: null,
    jumpUrl: null,
    messageId: null
  };
  await saveSignal(signal);

  const signalsChannel = await client.channels.fetch(config.signalsChannelId);
  const webhook = await getOrCreateWebhook(signalsChannel);

  const roleIds = extractRoleIds(signal.extraRole);
  const mentionLine = buildMentionLine(roleIds);

  const text = renderSignalText(signal, mentionLine);
  const sent = await webhook.send({ content: text, allowedMentions: allowedMentionsForRoles(roleIds) });

  await updateSignal(signal.id, { jumpUrl: sent.url, messageId: sent.id });

  // owner private thread
  const thread = await signalsChannel.threads.create({
    name: `controls-${signal.asset}-${signal.id.slice(0, 4)}`,
    type: ChannelType.PrivateThread,
    invitable: false
  });
  await thread.members.add(config.ownerId);
  await setThreadId(signal.id, thread.id);

  // controls
  const rowTP = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tp1hit_${signal.id}`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp2hit_${signal.id}`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp3hit_${signal.id}`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp4hit_${signal.id}`).setLabel('🎯 TP4 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp5hit_${signal.id}`).setLabel('🎯 TP5 Hit').setStyle(ButtonStyle.Success)
  );
  const rowState = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`setbe_${signal.id}`).setLabel('🟨 SL → BE (Active)').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`stopbe_${signal.id}`).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`stopped_${signal.id}`).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`close_${signal.id}`).setLabel('✅ Fully Closed').setStyle(ButtonStyle.Primary)
  );
  const rowAdmin = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`update_${signal.id}`).setLabel('✏️ Update Levels').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`meta_${signal.id}`).setLabel('🧾 Update Details').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`plan_${signal.id}`).setLabel('📐 Set TP Plan').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`override_${signal.id}`).setLabel('🧮 Override Final R').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`del_${signal.id}`).setLabel('❌ Delete').setStyle(ButtonStyle.Secondary)
  );

  await thread.send({ content: 'Owner Control Panel', components: [rowTP, rowState, rowAdmin] });

  await updateSummaryText();
}

async function editSignalWebhookMessage(sig) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const hooks = await channel.fetchWebhooks();
  const hook = hooks.find(h => h.name === config.brandName);
  if (!hook || !sig.messageId) return;
  const clientHook = new WebhookClient({ id: hook.id, token: hook.token });

  const roleIds = extractRoleIds(sig.extraRole);
  const mentionLine = buildMentionLine(roleIds);

  await clientHook.editMessage(sig.messageId, {
    content: renderSignalText(sig, mentionLine),
    allowedMentions: allowedMentionsForRoles(roleIds)
  }).catch(() => {});
}

async function updateSummaryText() {
  const all = await getSignals();
  const trades = all.filter(s => s.status === 'RUN_VALID'); // Only active-running in summary
  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const webhook = await getOrCreateWebhook(channel);
  const text = renderSummaryText(trades);

  const existingId = await getSummaryMessageId();
  if (existingId) {
    try { await webhook.editMessage(existingId, { content: text }); return; } catch {}
  }
  const sent = await webhook.send({ content: text });
  await setSummaryMessageId(sent.id);
}

async function deleteSignalMessage(sig) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const hooks = await channel.fetchWebhooks();
  const hook = hooks.find(h => h.name === config.brandName);
  if (!hook || !sig.messageId) return;
  const clientHook = new WebhookClient({ id: hook.id, token: hook.token });
  await clientHook.deleteMessage(sig.messageId).catch(() => {});
}

async function deleteOwnerThread(signalId) {
  const tid = await getThreadId(signalId);
  if (!tid) return;
  try {
    const thread = await client.channels.fetch(tid);
    if (thread && thread.isThread()) {
      await thread.delete().catch(() => {});
    }
  } catch {}
}

client.login(config.token);