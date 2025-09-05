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

// in-memory temporary store for /signal when asset = OTHER (modal handoff)
const pendingSignals = new Map(); // key: modalId -> { fields... }

// ---------- Formatting ----------
const fmt = v => (v ?? '—');
const dirWord = d => (d === 'LONG' ? 'Long' : 'Short');
const dirDot = d => (d === 'LONG' ? '🟢' : '🔴');

function statusLines(s) {
  let line1 = '';
  if (s.status === 'RUN_VALID') {
    line1 = 'Active 🟩 | Trade is still running';
  } else if (s.status === 'RUN_BE') {
    line1 = 'Active 🟫 | SL set to breakeven';
  } else if (s.status === 'STOPPED_OUT') {
    line1 = 'Inactive 🟥 | Stopped out';
  } else if (s.status === 'STOPPED_BE') {
    line1 = `Inactive 🟥 | Stopped breakeven${s.tp1 ? ' after TP1' : ''}`;
  } else if (s.status === 'CLOSED') {
    line1 = `Inactive 🟥 | Fully closed${s.tp1 ? ' after TP1' : ''}`;
  } else {
    line1 = '—';
  }

  // append TP hit badge if any and still active
  if ((s.status === 'RUN_VALID' || s.status === 'RUN_BE') && s.tpHit) {
    line1 = `${line1} | ${s.tpHit}`;
  }

  const line2 = `Valid for re-entry: ${s.validReentry ? '✅ Yes' : '❌ No'}`;
  return [line1, line2];
}

function renderSignalText(s) {
  const lines = [];
  lines.push(`**${s.asset} | ${dirWord(s.direction)} ${dirDot(s.direction)}**`, ``);
  lines.push(`📊 **Trade Details**`);
  lines.push(`Entry: ${fmt(s.entry)}`);
  lines.push(`SL: ${fmt(s.stop)}`);
  if (s.tp1) lines.push(`TP1: ${s.tp1}`);
  if (s.tp2) lines.push(`TP2: ${s.tp2}`);
  if (s.tp3) lines.push(`TP3: ${s.tp3}`);
  if (s.reason) lines.push(``, `📝 **Reasoning**`, s.reason);
  lines.push(``, `📍 **Status**`);
  const [l1, l2] = statusLines(s);
  lines.push(l1, l2);
  return lines.join('\n');
}

function renderSummaryText(trades) {
  const title = `📊 **JV Current Active Trades**`;
  if (!trades.length) {
    return `${title}\n• There are currently no ongoing trades valid for entry – stay posted for future trades.`;
  }
  const items = trades.map((t, i) => {
    const jump = t.jumpUrl ? ` — ${t.jumpUrl}` : '';
    return `${i + 1}. ${t.asset} ${dirWord(t.direction)} ${dirDot(t.direction)}${jump}\n` +
           `   Entry: ${fmt(t.entry)}\n` +
           `   SL: ${fmt(t.stop)}`;
  });
  return `${title}\n${items.join('\n\n')}`;
}

// ---------- Webhook helpers ----------
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
    // --- /ping ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'ping') {
      return interaction.reply({ content: '🏓 pong', ephemeral: true });
    }

    // --- /signal ---
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
      }

      let asset = interaction.options.getString('asset');
      const direction = interaction.options.getString('direction');
      const entry = interaction.options.getString('entry');
      const stop = interaction.options.getString('sl');
      const tp1 = interaction.options.getString('tp1');
      const tp2 = interaction.options.getString('tp2');
      const tp3 = interaction.options.getString('tp3');
      const reason = interaction.options.getString('reason');
      const extraRole = interaction.options.getString('extra_role');

      if (asset === 'OTHER') {
        // open modal to collect asset text
        const pid = nano();
        pendingSignals.set(pid, { direction, entry, stop, tp1, tp2, tp3, reason, extraRole });
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
        asset,
        direction,
        entry,
        stop,
        tp1,
        tp2,
        tp3,
        reason,
        extraRole
      });

      await interaction.editReply({ content: '✅ Trade signal posted.' });
      return;
    }

    // --- Modals ---
    if (interaction.isModalSubmit()) {
      // custom asset from /signal
      if (interaction.customId.startsWith('modal_asset_')) {
        await interaction.deferReply({ ephemeral: true });
        const pid = interaction.customId.replace('modal_asset_', '');
        const data = pendingSignals.get(pid);
        pendingSignals.delete(pid);
        if (!data) {
          return interaction.editReply({ content: '❌ Session expired. Please use /signal again.' });
        }
        const assetValue = interaction.fields.getTextInputValue('asset_value').trim().toUpperCase();
        await createAndPostSignal({ asset: assetValue, ...data });
        return interaction.editReply({ content: '✅ Trade signal posted.' });
      }

      // update levels modal
      if (interaction.customId.startsWith('modal_update_')) {
        await interaction.deferReply({ ephemeral: true });
        const id = interaction.customId.replace('modal_update_', '');
        const signal = await getSignal(id);
        if (!signal) return interaction.editReply({ content: 'Signal not found.' });

        const entry = interaction.fields.getTextInputValue('upd_entry')?.trim();
        const sl = interaction.fields.getTextInputValue('upd_sl')?.trim();
        const tp1 = interaction.fields.getTextInputValue('upd_tp1')?.trim();
        const tp2 = interaction.fields.getTextInputValue('upd_tp2')?.trim();
        const tp3 = interaction.fields.getTextInputValue('upd_tp3')?.trim();

        const patch = {};
        const changes = [];
        if (entry) { patch.entry = entry; changes.push(`Entry → ${entry}`); }
        if (sl) { patch.stop = sl; changes.push(`SL → ${sl}`); }
        if (tp1) { patch.tp1 = tp1; changes.push(`TP1 → ${tp1}`); }
        if (tp2) { patch.tp2 = tp2; changes.push(`TP2 → ${tp2}`); }
        if (tp3) { patch.tp3 = tp3; changes.push(`TP3 → ${tp3}`); }

        await updateSignal(id, patch);
        const updated = await getSignal(id);
        await editSignalWebhookMessage(updated);

        // audit note in private thread
        const tid = await getThreadId(id);
        if (tid && changes.length) {
          try {
            const thread = await client.channels.fetch(tid);
            await thread.send(`Updated: ${changes.join(', ')}`);
          } catch {}
        }

        await updateSummaryText();
        return interaction.editReply({ content: '✅ Levels updated.' });
      }
    }

    // --- Buttons ---
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });
      const [action, id] = interaction.customId.split('_');
      const signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      if (action === 'del') {
        await deleteSignalMessage(signal).catch(() => {});
        await deleteOwnerThread(id);
        await deleteSignal(id);
        await updateSummaryText();
        return interaction.editReply({ content: '❌ Trade deleted.' });
      }

      if (action === 'update') {
        const modal = new ModalBuilder()
          .setCustomId(`modal_update_${id}`)
          .setTitle('Update Levels');
        const i1 = new TextInputBuilder().setCustomId('upd_entry').setLabel('Entry').setStyle(TextInputStyle.Short).setRequired(false);
        const i2 = new TextInputBuilder().setCustomId('upd_sl').setLabel('SL').setStyle(TextInputStyle.Short).setRequired(false);
        const i3 = new TextInputBuilder().setCustomId('upd_tp1').setLabel('TP1').setStyle(TextInputStyle.Short).setRequired(false);
        const i4 = new TextInputBuilder().setCustomId('upd_tp2').setLabel('TP2').setStyle(TextInputStyle.Short).setRequired(false);
        const i5 = new TextInputBuilder().setCustomId('upd_tp3').setLabel('TP3').setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(i1),
          new ActionRowBuilder().addComponents(i2),
          new ActionRowBuilder().addComponents(i3),
          new ActionRowBuilder().addComponents(i4),
          new ActionRowBuilder().addComponents(i5)
        );
        return interaction.showModal(modal);
      }

      // status + TP hits
      const patches = {
        tp1hit: { tpHit: 'TP1 hit' },
        tp2hit: { tpHit: 'TP2 hit' },
        tp3hit: { tpHit: 'TP3 hit' },
        run:    { status: 'RUN_VALID', validReentry: true },
        be:     { status: 'RUN_BE', validReentry: false },
        stopped:{ status: 'STOPPED_OUT', validReentry: false },
        stopbe: { status: 'STOPPED_BE', validReentry: false },
        closed: { status: 'CLOSED', validReentry: false }
      };

      if (patches[action]) {
        await updateSignal(id, patches[action]);
      }

      const updated = await getSignal(id);
      await editSignalWebhookMessage(updated);

      // thread actions per rules
      if (action === 'stopped' || action === 'stopbe') {
        await deleteOwnerThread(id);
      }
      if (action === 'closed') {
        // keep thread (do nothing)
      }
      if (action === 'be') {
        // keep thread (do nothing)
      }

      await updateSummaryText();
      return interaction.editReply({ content: '✅ Updated.' });
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
    reason: payload.reason,
    extraRole: payload.extraRole,
    status: 'RUN_VALID',
    validReentry: true,
    tpHit: null,            // 'TP1 hit' | 'TP2 hit' | 'TP3 hit' | null
    jumpUrl: null,
    messageId: null
  };
  await saveSignal(signal);

  const signalsChannel = await client.channels.fetch(config.signalsChannelId);
  const webhook = await getOrCreateWebhook(signalsChannel);
  const text = renderSignalText(signal);

  const mentions = [];
  if (config.mentionRoleId) mentions.push(`<@&${config.mentionRoleId}>`);
  if (signal.extraRole) mentions.push(signal.extraRole);
  const content = mentions.length ? `${mentions.join(' ')}\n\n${text}` : text;

  const sent = await webhook.send({ content });
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
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tp1hit_${signal.id}`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp2hit_${signal.id}`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp3hit_${signal.id}`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`run_${signal.id}`).setLabel('🟩 Running (Valid)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`be_${signal.id}`).setLabel('🟫 Running (BE)').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`stopped_${signal.id}`).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`stopbe_${signal.id}`).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`closed_${signal.id}`).setLabel('✅ Fully Closed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`update_${signal.id}`).setLabel('✏️ Update Levels').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`del_${signal.id}`).setLabel('❌ Delete').setStyle(ButtonStyle.Secondary)
  );

  await thread.send({ content: 'Owner Control Panel', components: [row1, row2] });

  await updateSummaryText();
}

async function editSignalWebhookMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const hooks = await channel.fetchWebhooks();
  const hook = hooks.find(h => h.name === config.brandName);
  if (!hook || !signal.messageId) return;
  const clientHook = new WebhookClient({ id: hook.id, token: hook.token });
  await clientHook.editMessage(signal.messageId, { content: renderSignalText(signal) }).catch(() => {});
}

async function updateSummaryText() {
  const all = await getSignals();
  const trades = all.filter(s => s.status === 'RUN_VALID' || s.status === 'RUN_BE');
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

async function deleteSignalMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const hooks = await channel.fetchWebhooks();
  const hook = hooks.find(h => h.name === config.brandName);
  if (!hook || !signal.messageId) return;
  const clientHook = new WebhookClient({ id: hook.id, token: hook.token });
  await clientHook.deleteMessage(signal.messageId).catch(() => {});
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