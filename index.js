import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  WebhookClient
} from 'discord.js';
import { v4 as uuid } from 'uuid';
import {
  APPLICATION_ID,
  BRAND_AVATAR_URL,
  BRAND_NAME,
  CURRENT_TRADES_CHANNEL_ID,
  DISCORD_TOKEN,
  GUILD_ID,
  MENTION_ROLE_ID,
  OWNER_ID,
  SIGNALS_CHANNEL_ID,
  SUMMARY_TITLE,
  USE_WEBHOOK
} from './config.js';

import {
  deleteSignal,
  getChannelWebhook,
  getSignal,
  getSummaryMessageId,
  listActive,
  saveSignal,
  setChannelWebhook,
  setSummaryMessageId,
  updateSignal
} from './store.js';

import { renderSignalEmbed, renderSummaryEmbed } from './embeds.js';

/** ---------- Client ---------- **/

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
  partials: [Partials.Channel, Partials.Message]
});

/** ---------- Commands ---------- **/

const signalCmd = new SlashCommandBuilder()
  .setName('signal')
  .setDescription('Post a trade signal')
  .addStringOption(o =>
    o.setName('asset')
      .setDescription('Asset')
      .setRequired(true)
      .addChoices(
        { name: 'BTC', value: 'BTC' },
        { name: 'ETH', value: 'ETH' },
        { name: 'SOL', value: 'SOL' },
        { name: 'Other (custom)', value: 'OTHER' }
      )
  )
  .addStringOption(o =>
    o.setName('asset_other')
      .setDescription('If asset=Other, type the asset name')
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName('direction')
      .setDescription('Direction')
      .setRequired(true)
      .addChoices(
        { name: 'Long', value: 'LONG' },
        { name: 'Short', value: 'SHORT' }
      )
  )
  .addStringOption(o =>
    o.setName('entry')
      .setDescription('Entry price')
      .setRequired(true)
  )
  .addStringOption(o =>
    o.setName('stop')
      .setDescription('Stop loss')
      .setRequired(true)
  )
  .addStringOption(o => o.setName('tp1').setDescription('Take Profit 1').setRequired(false))
  .addStringOption(o => o.setName('tp2').setDescription('Take Profit 2').setRequired(false))
  .addStringOption(o => o.setName('tp3').setDescription('Take Profit 3').setRequired(false))
  .addStringOption(o =>
    o.setName('reason')
      .setDescription('Reasoning (optional, multiline allowed)')
      .setRequired(false)
  )
  .addBooleanOption(o =>
    o.setName('valid_reentry')
      .setDescription('Valid for re-entry? (default Yes)')
      .setRequired(false)
  )
  .addRoleOption(o =>
    o.setName('mention_role')
      .setDescription('Role to mention (optional)')
      .setRequired(false)
  );

/** ---------- Helpers ---------- **/

async function ensureWebhook(channel) {
  if (!USE_WEBHOOK) return null;

  const cached = await getChannelWebhook(channel.id);
  if (cached?.id && cached?.token) {
    try {
      // Validate quickly
      const wh = new WebhookClient({ id: cached.id, token: cached.token });
      await wh.fetch(); // will throw if invalid
      return { id: cached.id, token: cached.token };
    } catch {}
  }

  // create new one
  const hook = await channel.createWebhook({
    name: BRAND_NAME,
    avatar: BRAND_AVATAR_URL || undefined
  });

  await setChannelWebhook(channel.id, { id: hook.id, token: hook.token });
  return { id: hook.id, token: hook.token };
}

async function sendViaIdentity(channel, payload) {
  if (USE_WEBHOOK) {
    const { id, token } = await ensureWebhook(channel);
    const wh = new WebhookClient({ id, token });
    return wh.send({
      username: BRAND_NAME,
      avatarURL: BRAND_AVATAR_URL || undefined,
      ...payload
    });
  }
  // Fallback: bot identity
  return channel.send(payload);
}

async function editViaIdentity(channel, messageId, payload) {
  if (USE_WEBHOOK) {
    const { id, token } = await ensureWebhook(channel);
    const wh = new WebhookClient({ id, token });
    return wh.editMessage(messageId, payload);
  }
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (msg) return msg.edit(payload);
}

async function deleteViaIdentity(channel, messageId) {
  if (USE_WEBHOOK) {
    const { id, token } = await ensureWebhook(channel);
    const wh = new WebhookClient({ id, token });
    return wh.deleteMessage(messageId).catch(() => null);
  }
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (msg) return msg.delete().catch(() => null);
}

async function updateSummary(guild) {
  const trades = await listActive();

  // Add jump URLs for summary
  for (const t of trades) {
    try {
      const ch = await guild.channels.fetch(t.channelId);
      t.jumpUrl = `https://discord.com/channels/${guild.id}/${ch.id}/${t.messageId}`;
    } catch { t.jumpUrl = null; }
  }

  const summaryChannel = await guild.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
  const embed = renderSummaryEmbed(trades, SUMMARY_TITLE);

  let summaryMsgId = await getSummaryMessageId();
  if (!summaryMsgId) {
    const msg = await sendViaIdentity(summaryChannel, { embeds: [embed] });
    summaryMsgId = msg.id;
    await setSummaryMessageId(summaryMsgId);
  } else {
    await editViaIdentity(summaryChannel, summaryMsgId, { embeds: [embed] }).catch(async () => {
      // If message was deleted manually, recreate it
      const msg = await sendViaIdentity(summaryChannel, { embeds: [embed] });
      await setSummaryMessageId(msg.id);
    });
  }
}

function ownerButtons(signalId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tp:${signalId}:1`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tp:${signalId}:2`).setLabel('TP2 Hit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`tp:${signalId}:3`).setLabel('TP3 Hit').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`run:${signalId}:valid`).setLabel('🟩 Running (Valid)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`run:${signalId}:be`).setLabel('🟫 Running (BE)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`stop:${signalId}:out`).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`stop:${signalId}:be`).setLabel('⬛ Stopped BE').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`del:${signalId}`).setLabel('❌ Delete').setStyle(ButtonStyle.Danger)
    )
  ];
}

/** ---------- Lifecycle ---------- **/

client.once('ready', async () => {
  console.log(`[ready] Logged in as ${client.user.tag}`);

  // Register commands (guild-scoped for instant updates)
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), {
    body: [signalCmd.toJSON()]
  });
  console.log('[ready] Slash commands registered.');
});

/** ---------- Interactions ---------- **/

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash command
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      await interaction.deferReply({ ephemeral: true });

      const assetChoice = interaction.options.getString('asset', true);
      const assetOther = interaction.options.getString('asset_other');
      const direction = interaction.options.getString('direction', true);
      const entry = interaction.options.getString('entry', true);
      const stop = interaction.options.getString('stop', true);
      const tp1 = interaction.options.getString('tp1');
      const tp2 = interaction.options.getString('tp2');
      const tp3 = interaction.options.getString('tp3');
      const reason = interaction.options.getString('reason');
      const validReentry = interaction.options.getBoolean('valid_reentry') ?? true;
      const mentionRole = interaction.options.getRole('mention_role')?.id || MENTION_ROLE_ID || null;

      let asset = assetChoice === 'OTHER' ? (assetOther || '').trim() : assetChoice;
      if (!asset) {
        return interaction.editReply('❌ If you choose **Other**, you must provide **asset_other**.');
      }
      asset = asset.toUpperCase();

      const guild = await client.guilds.fetch(GUILD_ID);
      const signalsChannel = await guild.channels.fetch(SIGNALS_CHANNEL_ID);

      const signal = {
        id: uuid(),
        channelId: signalsChannel.id,
        messageId: null, // after send
        asset,
        direction, // LONG | SHORT
        entry,
        stop,
        tp1: tp1 || null,
        tp2: tp2 || null,
        tp3: tp3 || null,
        reason: reason || null,
        status: 'RUN_VALID',
        validReentry: !!validReentry,
        mentionRoleId: mentionRole,
        createdAt: Date.now()
      };

      // Send the main signal card
      const embed = renderSignalEmbed(signal, BRAND_NAME);
      const content = mentionRole ? `<@&${mentionRole}>` : undefined;
      const msg = await sendViaIdentity(signalsChannel, { content, embeds: [embed] });

      signal.messageId = msg.id;
      await saveSignal(signal);

      // Create owner-only private thread with control buttons
      try {
        const thread = await signalsChannel.threads.create({
          name: `🔒 Controls — ${signal.asset} ${signal.direction === 'LONG' ? 'Long' : 'Short'}`,
          type: ChannelType.PrivateThread,
          invitable: false
        });
        await thread.members.add(OWNER_ID).catch(() => {});
        await thread.send({
          content: `Owner controls for <${msg.url}>`,
          components: ownerButtons(signal.id)
        });
      } catch {
        // silently ignore if the server doesn't allow private threads
      }

      // Update summary
      await updateSummary(guild);

      await interaction.editReply(`✅ Signal posted: ${msg.url}`);
      return;
    }

    // Buttons (owner only)
    if (interaction.isButton()) {
      if (interaction.user.id !== OWNER_ID) {
        return interaction.reply({ content: '⛔ Owner-only control.', ephemeral: true });
      }

      const [kind, id, arg] = interaction.customId.split(':'); // e.g., run:<id>:valid
      const signal = await getSignal(id);
      if (!signal) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      const guild = await client.guilds.fetch(GUILD_ID);
      const ch = await guild.channels.fetch(signal.channelId);

      if (kind === 'run') {
        const next = arg === 'valid' ? 'RUN_VALID' : 'RUN_BE';
        await updateSignal(id, { status: next });
      } else if (kind === 'stop') {
        const next = arg === 'out' ? 'STOPPED_OUT' : 'STOPPED_BE';
        await updateSignal(id, { status: next });
      } else if (kind === 'tp') {
        // Mark TP hit by appending a check in reason (lightweight)
        const hit = `TP${arg} hit`;
        const newReason = signal.reason ? `${signal.reason}\n• ${hit}` : hit;
        await updateSignal(id, { reason: newReason });
      } else if (kind === 'del') {
        await deleteViaIdentity(ch, signal.messageId).catch(() => {});
        await deleteSignal(id);
        await updateSummary(guild);
        return interaction.reply({ content: '🗑️ Deleted signal & updated summary.', ephemeral: true });
      }

      // Re-render signal card
      const fresh = await getSignal(id);
      const embed = renderSignalEmbed(fresh, BRAND_NAME);
      await editViaIdentity(ch, fresh.messageId, { embeds: [embed] });
      await updateSummary(guild);

      return interaction.reply({ content: '✅ Updated.', ephemeral: true });
    }
  } catch (err) {
    console.error('interaction error', err);
    if (interaction.deferred || interaction.replied) {
      interaction.editReply('⚠️ Something went wrong.');
    } else {
      interaction.reply({ content: '⚠️ Something went wrong.', ephemeral: true });
    }
  }
});

client.login(DISCORD_TOKEN);
