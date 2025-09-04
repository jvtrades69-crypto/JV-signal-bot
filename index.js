// JV Trades – Discord Trade Signal Bot
// Implements: /signal, webhook identity, private owner control panel, and Current Active Trades summary syncing.

const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  WebhookClient,
  EmbedBuilder,
} = require('discord.js');
const { v4: uuidv4 } = require('uuid');

const {
  token,
  guildId,
  currentTradesChannelId,
  mentionRoleId,
  ownerUserId,
} = require('./config.js');

const Store = require('./store.js');
const { renderSignalEmbed, renderSummaryEmbed, titleFor } = require('./embeds.js');

// ---- Client Setup ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});

// ---- Utils ----
function isOwner(userId) {
  return userId === ownerUserId;
}

function parseRoleId(input) {
  if (!input) return "";
  const mentionMatch = /<@&(\d+)>/.exec(input);
  if (mentionMatch) return mentionMatch[1];
  const idMatch = /^(\d{10,})$/.exec(input.trim());
  if (idMatch) return idMatch[1];
  return "";
}

async function ensureChannelWebhook(channel) {
  const saved = Store.getChannelWebhook(channel.id);
  if (saved) return saved;

  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find(h => h.owner && h.owner.id === client.user.id);
  if (!hook) {
    hook = await channel.createWebhook({ name: 'JV Signal Relay' });
  }
  const info = { id: hook.id, token: hook.token };
  Store.setChannelWebhook(channel.id, info);
  return info;
}

function messageUrl(guildId, channelId, messageId) {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

async function updateSummary(guild) {
  const trades = Store.listActive().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const summaryChannel = await guild.channels.fetch(currentTradesChannelId).catch(() => null);
  if (!summaryChannel) return;

  const hookInfo = await ensureChannelWebhook(summaryChannel);
  const webhook = new WebhookClient({ id: hookInfo.id, token: hookInfo.token });

  // Use owner's profile for identity
  const member = await guild.members.fetch(ownerUserId).catch(() => null);
  const username = member ? (member.displayName || member.user.username) : 'JV Trades';
  const avatarURL = member ? member.displayAvatarURL({ size: 256 }) : null;

  const embed = renderSummaryEmbed(trades, '📊 JV Current Active Trades 📊');
  const summaryMessageId = Store.getSummaryMessageId();

  if (summaryMessageId) {
    try {
      await webhook.editMessage(summaryMessageId, {
        username,
        avatarURL,
        content: '',
        embeds: [embed],
        allowedMentions: { parse: [] },
      });
      return;
    } catch (e) {
      // If editing fails (deleted), we'll send a fresh one below.
      console.warn('Summary edit failed, sending new. Reason:', e.message);
    }
  }

  const sent = await webhook.send({
    username,
    avatarURL,
    content: '',
    embeds: [embed],
    allowedMentions: { parse: [] },
    wait: true,
  });
  Store.setSummaryMessageId(sent.id);
}

function statusPatchFor(action) {
  switch (action) {
    case 'TP1': return { tp1Hit: true };
    case 'TP2': return { tp2Hit: true };
    case 'TP3': return { tp3Hit: true };
    case 'RUN_VALID': return { status: 'ACTIVE', active: true, validForReentry: true };
    case 'RUN_BE': return { status: 'RUNNING_BE', active: true, validForReentry: false };
    case 'STOPPED_OUT': return { status: 'STOPPED_OUT', active: false, validForReentry: false };
    case 'STOPPED_BE': return { status: 'STOPPED_BE', active: false, validForReentry: false };
    default: return {};
  }
}

function controlButtons(signalId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`SIG:${signalId}:TP1`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`SIG:${signalId}:TP2`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`SIG:${signalId}:TP3`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`SIG:${signalId}:RUN_VALID`).setLabel('🟩 Running (Valid)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`SIG:${signalId}:RUN_BE`).setLabel('🟫 Running (BE)').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`SIG:${signalId}:STOPPED_OUT`).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`SIG:${signalId}:STOPPED_BE`).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`SIG:${signalId}:DELETE`).setLabel('❌ Delete').setStyle(ButtonStyle.Danger),
    ),
  ];
}

// ---- Command Registration (on ready) ----
async function registerCommands() {
  const cmd = [{
    name: 'signal',
    description: 'Create a trade signal card',
    dm_permission: false,
    default_member_permissions: null, // we enforce owner check in code
    options: [
      {
        type: 3, // STRING
        name: 'asset',
        description: 'Asset to trade (BTC, ETH, SOL, Other)',
        required: true,
        choices: [
          { name: 'BTC', value: 'BTC' },
          { name: 'ETH', value: 'ETH' },
          { name: 'SOL', value: 'SOL' },
          { name: 'Other', value: 'Other' },
        ],
      },
      {
        type: 3, // STRING
        name: 'asset_custom',
        description: 'If asset=Other, enter custom asset name',
        required: false,
      },
      {
        type: 3, // STRING
        name: 'direction',
        description: 'Long or Short',
        required: true,
        choices: [
          { name: 'Long', value: 'Long' },
          { name: 'Short', value: 'Short' },
        ],
      },
      { type: 3, name: 'entry', description: 'Entry price (free text OK)', required: true },
      { type: 3, name: 'sl', description: 'Stop Loss (free text OK)', required: true },
      { type: 3, name: 'tp1', description: 'Take Profit 1 (optional)', required: false },
      { type: 3, name: 'tp1_note', description: 'TP1 note e.g. "close 50%"', required: false },
      { type: 3, name: 'tp2', description: 'Take Profit 2 (optional)', required: false },
      { type: 3, name: 'tp2_note', description: 'TP2 note', required: false },
      { type: 3, name: 'tp3', description: 'Take Profit 3 (optional)', required: false },
      { type: 3, name: 'tp3_note', description: 'TP3 note', required: false },
      { type: 3, name: 'reason', description: 'Reason (optional, multiline allowed)', required: false },
      { type: 3, name: 'extra_role', description: 'Extra role to tag (paste @Role or ID)', required: false },
    ],
  }];

  await client.application.commands.set(cmd, guildId);
  console.log('Slash command registered for guild', guildId);
}

// ---- Ready ----
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
  } catch (e) {
    console.error('Command registration failed:', e);
  }
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (guild) {
    await updateSummary(guild); // ensure summary exists
  }
});

// ---- Interaction Create ----
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({ content: 'Only the owner can create signals.', ephemeral: true });
      }

      const assetChoice = interaction.options.getString('asset', true);
      const assetCustom = interaction.options.getString('asset_custom') || '';
      const side = interaction.options.getString('direction', true);
      const entry = interaction.options.getString('entry', true);
      const sl = interaction.options.getString('sl', true);
      const tp1 = interaction.options.getString('tp1') || '';
      const tp1Note = interaction.options.getString('tp1_note') || '';
      const tp2 = interaction.options.getString('tp2') || '';
      const tp2Note = interaction.options.getString('tp2_note') || '';
      const tp3 = interaction.options.getString('tp3') || '';
      const tp3Note = interaction.options.getString('tp3_note') || '';
      const reason = interaction.options.getString('reason') || '';
      const extraRoleRaw = interaction.options.getString('extra_role') || '';

      const asset = assetChoice === 'Other' ? (assetCustom || 'Other') : assetChoice;

      // Prepare mentions
      const baseRoleId = mentionRoleId && mentionRoleId !== "PUT_DEFAULT_TRADE_SIGNALS_ROLE_ID_HERE" ? mentionRoleId : "";
      const extraRoleId = parseRoleId(extraRoleRaw);
      const rolesToMention = [baseRoleId, extraRoleId].filter(Boolean);

      await interaction.deferReply({ ephemeral: true });

      const channel = interaction.channel;
      const guild = interaction.guild;
      const hookInfo = await ensureChannelWebhook(channel);
      const webhook = new WebhookClient({ id: hookInfo.id, token: hookInfo.token });

      const member = await guild.members.fetch(ownerUserId).catch(() => null);
      const username = member ? (member.displayName || member.user.username) : interaction.user.username;
      const avatarURL = member ? member.displayAvatarURL({ size: 256 }) : interaction.user.displayAvatarURL({ size: 256 });

      // Construct initial signal object
      const id = uuidv4().slice(0, 8);
      const signal = {
        id,
        asset,
        side,
        entry,
        sl,
        tp1, tp1Note, tp1Hit: false,
        tp2, tp2Note, tp2Hit: false,
        tp3, tp3Note, tp3Hit: false,
        reason,
        ownerId: ownerUserId,
        channelId: channel.id,
        messageId: "",
        threadId: "",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        status: 'ACTIVE',
        active: true,
        validForReentry: true,
        jumpUrl: "",
      };

      // Send via webhook using owner's identity
      const embed = renderSignalEmbed(signal);
      const contentLine = rolesToMention.length
        ? rolesToMention.map(r => `<@&${r}>`).join(' ') 
        : '';

      const sent = await webhook.send({
        username,
        avatarURL,
        content: contentLine,
        embeds: [embed],
        allowedMentions: { roles: rolesToMention, parse: [] },
        wait: true,
      });

      signal.messageId = sent.id;
      signal.jumpUrl = `https://discord.com/channels/${guild.id}/${channel.id}/${sent.id}`;

      // Save signal now that we have message id/url
      Store.saveSignal(signal);

      // Create a private owner-only thread attached to the signal message
      let thread;
      try {
        thread = await channel.threads.create({
          name: `🛠️ Control – ${asset} ${side} @ ${entry}`.slice(0, 95),
          autoArchiveDuration: 1440,
          type: ChannelType.PrivateThread,
          startMessage: sent.id,
          invitable: false,
        });
        await thread.members.add(ownerUserId).catch(() => {});
      } catch (e) {
        console.warn('Thread creation failed (missing perms or channel type?):', e.message);
      }

      if (thread) {
        const control = await thread.send({
          content: `<@${ownerUserId}>`,
          embeds: [
            new EmbedBuilder()
              .setTitle('Owner Control Panel')
              .setDescription(`Use the buttons below to update **${titleFor(signal)}**`)
              .setColor(0x94a3b8)
          ],
          components: controlButtons(signal.id),
        });
        Store.setOwnerPanelMessageId(signal.id, control.id);
        Store.updateSignal(signal.id, { threadId: thread.id });
      }

      // Update summary channel
      await updateSummary(guild);

      await interaction.editReply({ content: `✅ Signal posted: ${titleFor(signal)}\nJump: ${signal.jumpUrl}` });
    }

    if (interaction.isButton()) {
      const parts = interaction.customId.split(':');
      if (parts.length !== 3 || parts[0] !== 'SIG') return;
      const signalId = parts[1];
      const action = parts[2];

      const s = Store.getSignal(signalId);
      if (!s) {
        return interaction.reply({ content: 'Signal not found (maybe deleted).', ephemeral: true });
      }
      if (!isOwner(interaction.user.id)) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }

      const guild = await client.guilds.fetch(guildId);
      const channel = await guild.channels.fetch(s.channelId).catch(() => null);
      if (!channel) {
        return interaction.reply({ content: 'Original channel missing.', ephemeral: true });
      }

      // Apply patch
      if (action === 'DELETE') {
        // Delete original message and clean up
        try {
          const msg = await channel.messages.fetch(s.messageId);
          await msg.delete();
        } catch (e) {
          // ignore
        }
        if (s.threadId) {
          try {
            const thr = await guild.channels.fetch(s.threadId);
            await thr.delete('Signal deleted');
          } catch (e) {}
        }
        Store.deleteSignal(s.id);
        await updateSummary(guild);
        return interaction.reply({ content: '🗑️ Signal deleted and summary updated.', ephemeral: true });
      }

      const patch = statusPatchFor(action);
      const updated = Store.updateSignal(s.id, patch);
      if (!updated) {
        return interaction.reply({ content: 'Failed to update signal.', ephemeral: true });
      }

      // Edit the original signal embed
      try {
        const msg = await channel.messages.fetch(s.messageId);
        const embed = renderSignalEmbed(updated);
        await msg.edit({ embeds: [embed] });
      } catch (e) {
        console.warn('Failed to edit original signal message:', e.message);
      }

      await updateSummary(guild);
      return interaction.reply({ content: '✅ Updated.', ephemeral: true });
    }
  } catch (err) {
    console.error('interactionCreate error:', err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: 'Unexpected error.', ephemeral: true }); } catch {}
    }
  }
});

client.login(token);
