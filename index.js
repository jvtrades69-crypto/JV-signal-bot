import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  WebhookClient
} from 'discord.js';
import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, updateSignal, deleteSignal, listActive,
  getSummaryMessageId, setSummaryMessageId,
  getStoredWebhook, setStoredWebhook, getThreadId, setThreadId
} from './store.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------- Formatters (plain text) ----------
const fmt = v => (v ?? '—');
const dirWord = d => (d === 'LONG' ? 'Long' : 'Short');
const dirDot = d => (d === 'LONG' ? '🟢' : '🔴');

function renderSignalText(s) {
  const lines = [];
  lines.push(`**${s.asset} | ${dirWord(s.direction)} ${dirDot(s.direction)}**`, ``);
  lines.push(`📊 **Trade Details**`);
  lines.push(`Entry: ${fmt(s.entry)}`);
  lines.push(`Stop Loss: ${fmt(s.stop)}`);
  if (s.tp1) lines.push(`TP1: ${s.tp1}`);
  if (s.tp2) lines.push(`TP2: ${s.tp2}`);
  if (s.tp3) lines.push(`TP3: ${s.tp3}`);
  if (s.reason) lines.push(``, `📝 **Reasoning**`, s.reason);
  lines.push(``, `📍 **Status**`);
  const statusLabel = s.status === 'RUN_VALID'
    ? 'Active 🟩 – trade is still running'
    : s.status === 'RUN_BE'
      ? 'Active 🟫 – running at break-even'
      : s.status === 'STOPPED_OUT'
        ? 'Stopped Out 🔴'
        : s.status === 'STOPPED_BE'
          ? 'Stopped BE 🟥'
          : s.status === 'CLOSED'
            ? 'Fully Closed ✅'
            : '—';
  lines.push(statusLabel);
  lines.push(`Valid for re-entry: ${s.validReentry ? 'Yes' : 'No'}`);
  return lines.join('\n');
}

function renderSummaryText(trades) {
  const title = `📊 JV Current Active Trades 📊`;
  if (!trades.length) {
    return `${title}\n• There are currently no ongoing trades valid for entry – stay posted for future trades.`;
  }
  const items = trades.map((t, i) => {
    const jump = t.jumpUrl ? ` — ${t.jumpUrl}` : '';
    return `${i + 1}. ${t.asset} ${dirWord(t.direction)} ${dirDot(t.direction)}${jump}\n` +
           `   Entry: ${fmt(t.entry)}\n` +
           `   Stop Loss: ${fmt(t.stop)}`;
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
  // discord.js returns token on creation; store for editing later
  await setStoredWebhook(channel.id, { id: hook.id, token: hook.token });
  return new WebhookClient({ id: hook.id, token: hook.token });
}

// ---------- Ready ----------
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---------- Interactions ----------
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

      await interaction.deferReply({ ephemeral: true });

      let asset = interaction.options.getString('asset');
      if (asset === 'OTHER') {
        const manual = interaction.options.getString('asset_manual');
        if (!manual) {
          return interaction.editReply({ content: '❌ Please fill **asset_manual** when choosing Other.' });
        }
        asset = manual.trim().toUpperCase();
      }

      const signal = {
        id: nano(),
        asset,
        direction: interaction.options.getString('direction'),
        entry: interaction.options.getString('entry'),
        stop: interaction.options.getString('sl'),
        tp1: interaction.options.getString('tp1'),
        tp2: interaction.options.getString('tp2'),
        tp3: interaction.options.getString('tp3'),
        reason: interaction.options.getString('reason'),
        extraRole: interaction.options.getString('extra_role'),
        status: 'RUN_VALID',
        validReentry: true,
        jumpUrl: null,
        messageId: null
      };
      await saveSignal(signal);

      // send via webhook (looks like user message)
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
        new ButtonBuilder().setCustomId(`del_${signal.id}`).setLabel('❌ Delete').setStyle(ButtonStyle.Secondary)
      );

      await thread.send({ content: 'Owner Control Panel', components: [row1, row2] });

      await updateSummaryText();
      await interaction.editReply({ content: '✅ Trade signal posted.' });
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      const [action, id] = interaction.customId.split('_');
      const signal = await getSignal(id);
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      if (action === 'del') {
        // delete message & DB, close thread
        if (signal.messageId) {
          const ch = await client.channels.fetch(config.signalsChannelId);
          try {
            const parts = signal.jumpUrl.split('/');
            const messageId = parts[parts.length - 1];
            const hooks = await ch.fetchWebhooks();
            const hook = hooks.find(h => h.name === config.brandName);
            if (hook) {
              const clientHook = new WebhookClient({ id: hook.id, token: hook.token });
              await clientHook.deleteMessage(messageId).catch(() => {});
            }
          } catch {}
        }
        await closeThreadIfExists(id);
        await deleteSignal(id);
        await updateSummaryText();
        return interaction.editReply({ content: '❌ Trade deleted.' });
      }

      const patches = {
        tp1hit: { tp1: '✅ Hit' },
        tp2hit: { tp2: '✅ Hit' },
        tp3hit: { tp3: '✅ Hit' },
        run: { status: 'RUN_VALID', validReentry: true },
        be: { status: 'RUN_BE', validReentry: true },
        stopped: { status: 'STOPPED_OUT', validReentry: false },
        stopbe: { status: 'STOPPED_BE', validReentry: false },
        closed: { status: 'CLOSED', validReentry: false }
      };

      if (patches[action]) {
        await updateSignal(id, patches[action]);
      }

      // re-render signal text
      const updated = await getSignal(id);
      await editSignalWebhookMessage(updated);

      // close thread if appropriate
      if (['stopped', 'stopbe', 'closed'].includes(action)) {
        await closeThreadIfExists(id);
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

// ---------- helpers to edit/summary/thread ----------
async function editSignalWebhookMessage(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  const hooks = await channel.fetchWebhooks();
  const hook = hooks.find(h => h.name === config.brandName);
  if (!hook || !signal.jumpUrl) return;
  const clientHook = new WebhookClient({ id: hook.id, token: hook.token });
  const parts = signal.jumpUrl.split('/');
  const messageId = parts[parts.length - 1];
  await clientHook.editMessage(messageId, { content: renderSignalText(signal) }).catch(() => {});
}

async function updateSummaryText() {
  const trades = await listActive();
  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const webhook = await getOrCreateWebhook(channel);
  const text = renderSummaryText(trades);

  const existingId = await getSummaryMessageId();
  if (existingId) {
    try {
      await webhook.editMessage(existingId, { content: text });
      return;
    } catch { /* fallthrough */ }
  }
  const sent = await webhook.send({ content: text });
  await setSummaryMessageId(sent.id);
}

async function closeThreadIfExists(signalId) {
  const threadId = await getThreadId(signalId);
  if (!threadId) return;
  try {
    const thread = await client.channels.fetch(threadId);
    if (thread && thread.isThread()) {
      await thread.setArchived(true);
      await thread.setLocked(true).catch(() => {});
    }
  } catch {}
}

client.login(config.token);
