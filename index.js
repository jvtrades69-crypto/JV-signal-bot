// index.js
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
} = require('discord.js');

const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const store  = require('./store');
const { renderSignalEmbed, renderSummaryEmbed } = require('./embeds');

// ───────────────────────────────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────────────────────────────
if (!config.token) {
  console.error('[ERROR] Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // On startup, rebuild the single summary message so we never end up with duplicates.
  await rebuildSummaryMessage(client);

  // Also refresh owner control panels for active trades (so buttons are never stale after restart)
  const active = await store.listActive();
  for (const s of active) {
    await ensureOwnerPanel(client, s);
  }
});

client.login(config.token);

// ───────────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────────

function controlsRows(signalId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sig:tp1:${signalId}`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`sig:tp2:${signalId}`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`sig:tp3:${signalId}`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sig:run:${signalId}`).setLabel('Running (Valid)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`sig:be:${signalId}`).setLabel('Running (BE)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`sig:stopped:${signalId}`).setLabel('Stopped Out').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`sig:stoppedbe:${signalId}`).setLabel('Stopped BE').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sig:edit:${signalId}`).setLabel('Edit').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`sig:delete:${signalId}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function rebuildSummaryMessage(client) {
  const ch = await client.channels.fetch(config.currentTradesChannelId).catch(() => null);
  if (!ch) return;

  // Delete existing summary message if we have one
  const prevId = await store.getSummaryMessageId().catch(() => null);
  if (prevId) {
    const prevMsg = await ch.messages.fetch(prevId).catch(() => null);
    if (prevMsg) await prevMsg.delete().catch(() => {});
  }

  // Build fresh content
  const active = await store.listActive();
  const title = 'JV Current Active Trades 📊'; // keep bolding inside embed only
  const embed = renderSummaryEmbed(active, title);

  const msg = await ch.send({ embeds: [embed] });
  await store.setSummaryMessageId(msg.id);
}

async function refreshSignalAndSummary(client, signal) {
  // Update the public signal card
  const channel = await client.channels.fetch(signal.channelId).catch(() => null);
  if (channel) {
    const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
    if (msg) {
      await msg.edit({
        embeds: [renderSignalEmbed(signal)],
        content: (config.mentionRoleId && signal.shouldMention)
          ? `<@&${config.mentionRoleId}>`
          : (signal.extraRoleId ? `<@&${signal.extraRoleId}>` : null),
      }).catch(() => {});
    }
  }

  // Rebuild single summary message
  await rebuildSummaryMessage(client);

  // Refresh owner panel so buttons are always fresh
  await ensureOwnerPanel(client, signal);
}

async function ensureOwnerPanel(client, signal) {
  // Create (or reuse) a private thread next to the signal message, visible only to the owner
  const channel = await client.channels.fetch(signal.channelId).catch(() => null);
  if (!channel) return;

  const parentMsg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (!parentMsg) return;

  let thread = parentMsg.hasThread ? parentMsg.thread : null;
  if (!thread) {
    thread = await parentMsg.startThread({
      name: `Controls · ${signal.asset} ${signal.side}`,
      autoArchiveDuration: 1440,
      reason: 'Owner-only control thread',
    }).catch(() => null);

    if (thread) {
      // Restrict view to owner only (and bot)
      try {
        await thread.permissionOverwrites.edit(signal.ownerId, { ViewChannel: true });
        await thread.permissionOverwrites.edit(thread.guild.roles.everyone, { ViewChannel: false });
      } catch (_) {}
    }
  }

  if (!thread) return;

  // Delete previous owner panel message (if exists)
  const prevPanelId = await store.getOwnerPanelMessageId(signal.id).catch(() => null);
  if (prevPanelId) {
    const prev = await thread.messages.fetch(prevPanelId).catch(() => null);
    if (prev) await prev.delete().catch(() => {});
  }

  const panel = await thread.send({
    content: '**Your controls:**',
    components: controlsRows(signal.id),
  });

  await store.setOwnerPanelMessageId(signal.id, panel.id);
}

function parseId(customId) {
  // format sig:<action>:<signalId>
  const parts = customId.split(':');
  return { action: parts[1], id: parts[2] };
}

async function markTpHit(signal, tpIndex) {
  const patch = {};
  patch[`tp${tpIndex}Hit`] = true;
  await store.updateSignal(signal.id, patch);
}

async function setStatus(signal, statusPatch) {
  await store.updateSignal(signal.id, { status: { ...signal.status, ...statusPatch } });
}

// ───────────────────────────────────────────────────────────────────────────────
// Command entry (slash /signal) – show compact first step, then modal
// You already have this in your bot; keep your existing registration file.
// Below is only the interaction logic.
// ───────────────────────────────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  try {
    // SELECT MENUS (asset + side first step)
    if (interaction.isStringSelectMenu()) {
      // ack
      await interaction.deferUpdate();

      // You likely already store the partial selection in memory; omitted here for brevity.
      // Keep your existing two-step flow.
      return;
    }

    // BUTTONS (owner controls)
    if (interaction.isButton()) {
      // Always ACK within 3s so Discord doesn't reject the click
      await interaction.deferUpdate().catch(() => {});
      const { action, id } = parseId(interaction.customId);
      const signal = await store.getSignal(id);
      if (!signal) return;

      // Only the trade owner and the bot owner can touch controls
      if (interaction.user.id !== signal.ownerId && interaction.user.id !== config.ownerUserId) {
        return; // silently ignore
      }

      if (action === 'tp1') {
        await markTpHit(signal, 1);
      } else if (action === 'tp2') {
        await markTpHit(signal, 2);
      } else if (action === 'tp3') {
        await markTpHit(signal, 3);
      } else if (action === 'run') {
        await setStatus(signal, { active: true, be: false, stopped: false });
      } else if (action === 'be') {
        await setStatus(signal, { active: true, be: true, stopped: false });
      } else if (action === 'stopped') {
        await setStatus(signal, { active: false, be: false, stopped: true });
      } else if (action === 'stoppedbe') {
        await setStatus(signal, { active: false, be: true, stopped: true });
      } else if (action === 'edit') {
        // Re-open your edit modal / edit flow
        await openEditModal(interaction, signal);
        return; // modal shows; nothing else to do
      } else if (action === 'delete') {
        await hardDeleteSignal(client, signal);
        await rebuildSummaryMessage(client);
        return;
      }

      // Reload the updated signal from store and refresh all UI
      const updated = await store.getSignal(id);
      await refreshSignalAndSummary(client, updated);
      return;
    }

    // MODALS (create / edit submit)
    if (interaction.isModalSubmit()) {
      // Modal can be create or edit; check customId
      const custom = interaction.customId || '';
      await interaction.deferReply({ ephemeral: true }).catch(() => {});

      if (custom.startsWith('sig:create:')) {
        // You already have your “create” modal field names — re-use them.
        // Here we just read generic fields.
        const data = readSignalFromModal(interaction);
        const signal = await createPublicSignal(client, interaction, data);
        await interaction.editReply({ content: 'Signal posted.' }).catch(() => {});
        await ensureOwnerPanel(client, signal);
        await rebuildSummaryMessage(client);
        return;
      }

      if (custom.startsWith('sig:edit:')) {
        const id = custom.split(':')[2];
        const existing = await store.getSignal(id);
        if (!existing) {
          await interaction.editReply({ content: 'This signal no longer exists.' }).catch(() => {});
          return;
        }
        const patch = readSignalFromModal(interaction);
        await store.updateSignal(id, patch);
        const updated = await store.getSignal(id);
        await refreshSignalAndSummary(client, updated);
        await interaction.editReply({ content: 'Signal updated.' }).catch(() => {});
        return;
      }

      return;
    }
  } catch (err) {
    console.error('interactionCreate error:', err);
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// Minimal sketch helpers for create / edit. Adjust field names to match your modals.
// ───────────────────────────────────────────────────────────────────────────────

function readSignalFromModal(interaction) {
  // Map your modal input IDs to fields
  const entry = interaction.fields.getTextInputValue('entry') || '';
  const sl    = interaction.fields.getTextInputValue('sl') || '';
  const tp1   = interaction.fields.getTextInputValue('tp1') || '';
  const tp2   = interaction.fields.getTextInputValue('tp2') || '';
  const tp3   = interaction.fields.getTextInputValue('tp3') || '';
  const reason = interaction.fields.getTextInputValue('reason') || '';
  const extra  = interaction.fields.getTextInputValue('extraRoleId') || '';

  // Parse / sanitize as you prefer
  return { entry, sl, tp1, tp2, tp3, reason, extraRoleId: extra };
}

async function createPublicSignal(client, interaction, data) {
  // You already collected asset & side in the first step; read from your cache/session.
  const asset = interaction.customId.split(':')[2] || 'BTC'; // example only
  const side  = interaction.customId.split(':')[3] || 'Long'; // example only

  const channel = await client.channels.fetch(config.currentTradesChannelId).catch(() => null);
  if (!channel) throw new Error('Current trades channel not found');

  const id = uuidv4();
  const now = Date.now();

  const signal = {
    id,
    ownerId: interaction.user.id,
    channelId: channel.id,
    messageId: null, // set after send
    asset,
    side,
    entry: data.entry || '',
    sl: data.sl || '',
    tp1: data.tp1 || '',
    tp2: data.tp2 || '',
    tp3: data.tp3 || '',
    reason: data.reason || '',
    extraRoleId: data.extraRoleId || null,
    shouldMention: true, // your default; change if you want
    status: { active: true, be: false, stopped: false },
    createdAt: now,
  };

  const embed = renderSignalEmbed(signal);

  const msg = await channel.send({
    content: (config.mentionRoleId ? `<@&${config.mentionRoleId}>` : null),
    embeds: [embed],
  });

  signal.messageId = msg.id;
  await store.saveSignal(signal);
  return signal;
}

async function openEditModal(interaction, signal) {
  // Build a modal with your existing IDs so readSignalFromModal() works
  const modal = new ModalBuilder()
    .setCustomId(`sig:edit:${signal.id}`)
    .setTitle(`Edit ${signal.asset} ${signal.side}`);

  const entry = new TextInputBuilder()
    .setCustomId('entry').setLabel('Entry').setStyle(TextInputStyle.Short)
    .setRequired(false).setValue(signal.entry ?? '');

  const sl = new TextInputBuilder()
    .setCustomId('sl').setLabel('SL').setStyle(TextInputStyle.Short)
    .setRequired(false).setValue(signal.sl ?? '');

  const tp1 = new TextInputBuilder()
    .setCustomId('tp1').setLabel('TP1 (optional)').setStyle(TextInputStyle.Short)
    .setRequired(false).setValue(signal.tp1 ?? '');

  const tp2 = new TextInputBuilder()
    .setCustomId('tp2').setLabel('TP2 (optional)').setStyle(TextInputStyle.Short)
    .setRequired(false).setValue(signal.tp2 ?? '');

  const tp3 = new TextInputBuilder()
    .setCustomId('tp3').setLabel('TP3 (optional)').setStyle(TextInputStyle.Short)
    .setRequired(false).setValue(signal.tp3 ?? '');

  const reason = new TextInputBuilder()
    .setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Paragraph)
    .setRequired(false).setValue(signal.reason ?? '');

  modal.addComponents(
    new ActionRowBuilder().addComponents(entry),
    new ActionRowBuilder().addComponents(sl),
    new ActionRowBuilder().addComponents(tp1),
    new ActionRowBuilder().addComponents(tp2),
    new ActionRowBuilder().addComponents(tp3),
    // You can swap TP3 for 'extraRoleId' if you prefer — keep input IDs aligned with reader.
  );

  await interaction.followUp({ content: 'Opening edit…', ephemeral: true }).catch(() => {});
  await interaction.showModal(modal).catch(() => {});
}

async function hardDeleteSignal(client, signal) {
  // Delete public message
  const ch = await client.channels.fetch(signal.channelId).catch(() => null);
  if (ch) {
    const m = await ch.messages.fetch(signal.messageId).catch(() => null);
    if (m) await m.delete().catch(() => {});
  }
  // Delete owner panel
  const panelId = await store.getOwnerPanelMessageId(signal.id).catch(() => null);
  if (panelId && ch) {
    // panel is inside thread; best effort removal handled in ensureOwnerPanel when recreated
  }
  // Remove from DB
  await store.deleteSignal(signal.id);
}
