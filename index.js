// index.js
// JV Signal Bot — private controls thread, single summary message, custom "Other…" asset, tidy formatting.

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  WebhookClient,
} = require('discord.js');

const config = require('./config');
const store  = require('./store');

if (!config?.token) {
  console.error('[ERROR] Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ---------------- Helpers ---------------- */

const SUMMARY_HEADER_BOLD = '**📊 JV Current Active Trades 📊**';
const STATIC_NAME        = 'JV Trades';   // webhook display name
const STATIC_AVATAR_URL  = null;          // set to a static URL if you want; otherwise owner avatar is used

function nowISO() { return new Date().toISOString(); }

function titleFor(signal) {
  const dot = signal.side === 'LONG' ? '🟢' : '🔴';
  return `**${signal.asset.toUpperCase()} | ${signal.side === 'LONG' ? 'Long' : 'Short'} ${dot}**`;
}

function blockTradeDetails(signal) {
  // exactly 1 blank line is added by the caller between sections
  const lines = [
    '📊 **Trade Details**',
    `Entry: ${signal.entry ?? '-'}`,
    `SL: ${signal.sl ?? '-'}`,
  ];
  if (signal.tp1) lines.push(`TP1: ${signal.tp1}`);
  if (signal.tp2) lines.push(`TP2: ${signal.tp2}`);
  if (signal.tp3) lines.push(`TP3: ${signal.tp3}`);
  return lines.join('\n');
}

function blockReason(signal) {
  if (!signal.reason) return '';
  return `📒 **Reasoning**\n${signal.reason}`;
}

function blockStatus(signal) {
  const activeYesNo = signal.closedAt
    ? 'Inactive 🟥 - SL set to breakeven'
    : 'Active 🟩 - trade is still running';
  const valid = signal.status === 'RUNNING_VALID' ? 'Yes' : 'No';
  return `📍 **Status**\n${activeYesNo}\nValid for re-entry: ${valid}`;
}

function controls(signal) {
  const rows = [];

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ctrl|tp1|${signal.id}`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ctrl|tp2|${signal.id}`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`ctrl|tp3|${signal.id}`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Primary),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ctrl|running_valid|${signal.id}`).setLabel('Running (Valid)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`ctrl|running_be|${signal.id}`).setLabel('Running (BE)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`ctrl|stopped_out|${signal.id}`).setLabel('Stopped Out').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`ctrl|stopped_be|${signal.id}`).setLabel('Stopped BE').setStyle(ButtonStyle.Secondary),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`ctrl|delete|${signal.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
    ),
  );

  return rows;
}

async function getOrCreateWebhook(channel, preferredName = 'JV Trades', avatarURL = null) {
  const hooks = await channel.fetchWebhooks().catch(() => null);
  if (hooks) {
    const existing = hooks.find(h => h.name === preferredName);
    if (existing) return existing;
  }
  const created = await channel.createWebhook({ name: preferredName, avatar: avatarURL || undefined }).catch(() => null);
  return created;
}

async function getOwnerAvatar(guild) {
  try {
    if (!config.ownerId) return null;
    const m = await guild.members.fetch(config.ownerId);
    return m?.displayAvatarURL({ size: 128 }) || m?.user?.displayAvatarURL({ size: 128 }) || null;
  } catch {
    return null;
  }
}

async function createPrivateControlsThread(signal, channel, userId) {
  const me = await channel.guild.members.fetch(userId);
  const thread = await channel.threads.create({
    name: `Controls • ${signal.asset} ${signal.side} • ${me.displayName || me.user.username}`,
    autoArchiveDuration: 1440,
    type: ChannelType.PrivateThread,
    invitable: false,
  });
  await thread.members.add(me.id).catch(() => {});
  const msg = await thread.send({ content: 'Your controls:', components: controls(signal) });
  return `https://discord.com/channels/${signal.guildId}/${thread.id}/${msg.id}`;
}

/* --------- Asset/Side pick (ephemeral) --------- */

const pickState = new Map(); // userId -> { channelId, asset, assetWasCustom, side }

function modalAssetCustom() {
  const modal = new ModalBuilder().setCustomId('asset-custom').setTitle('Custom Asset');
  const field = new TextInputBuilder()
    .setCustomId('asset')
    .setLabel('Asset / Symbol')
    .setPlaceholder('e.g., BTC, ETH, SOL, DOGE/USDT')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);
  return modal.addComponents(new ActionRowBuilder().addComponents(field));
}

// 5 rows max → Entry, SL, TP1, TP2, Reason  (TP3 can be adjusted later with an edit flow if needed)
function modalSignalForm(titleText) {
  const modal = new ModalBuilder().setCustomId('signal-create-b').setTitle(titleText);

  const entry = new TextInputBuilder()
    .setCustomId('entry')
    .setLabel('Entry (required)')
    .setPlaceholder('e.g., 108,201 or 108,100–108,300')
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  const sl = new TextInputBuilder()
    .setCustomId('sl')
    .setLabel('SL (optional)')
    .setPlaceholder('e.g., 100,201')
    .setRequired(false)
    .setStyle(TextInputStyle.Short);

  const tp1 = new TextInputBuilder()
    .setCustomId('tp1')
    .setLabel('TP1 (optional)')
    .setPlaceholder('e.g., 110,000')
    .setRequired(false)
    .setStyle(TextInputStyle.Short);

  const tp2 = new TextInputBuilder()
    .setCustomId('tp2')
    .setLabel('TP2 (optional)')
    .setPlaceholder('e.g., 121,201')
    .setRequired(false)
    .setStyle(TextInputStyle.Short);

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Reason (optional)')
    .setPlaceholder('Notes about this setup')
    .setRequired(false)
    .setStyle(TextInputStyle.Paragraph);

  return modal
    .addComponents(new ActionRowBuilder().addComponents(entry))
    .addComponents(new ActionRowBuilder().addComponents(sl))
    .addComponents(new ActionRowBuilder().addComponents(tp1))
    .addComponents(new ActionRowBuilder().addComponents(tp2))
    .addComponents(new ActionRowBuilder().addComponents(reason));
}

function buildPickComponents(userId) {
  const pick = pickState.get(userId) || {};

  const assetMenu = new StringSelectMenuBuilder()
    .setCustomId('pick|asset')
    .setPlaceholder(
      pick.assetWasCustom && pick.asset ? `Asset: ${pick.asset}` : 'Pick Asset (or choose Other…)'
    )
    .addOptions(
      { label: 'BTC', value: 'BTC', default: pick.asset === 'BTC' },
      { label: 'ETH', value: 'ETH', default: pick.asset === 'ETH' },
      { label: 'SOL', value: 'SOL', default: pick.asset === 'SOL' },
      { label: 'Other…', value: 'OTHER', default: pick.assetWasCustom === true }
    );

  const sideMenu = new StringSelectMenuBuilder()
    .setCustomId('pick|side')
    .setPlaceholder('Pick Side')
    .addOptions(
      { label: 'Long', value: 'LONG', default: pick.side === 'LONG' },
      { label: 'Short', value: 'SHORT', default: pick.side === 'SHORT' },
    );

  const nextBtn = new ButtonBuilder()
    .setCustomId('pick|continue')
    .setLabel('Continue')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!(pick.asset && pick.side));

  return [
    new ActionRowBuilder().addComponents(assetMenu),
    new ActionRowBuilder().addComponents(sideMenu),
    new ActionRowBuilder().addComponents(nextBtn),
  ];
}

/* ----------------- Interactions ----------------- */

client.on('interactionCreate', async (interaction) => {
  try {
    // /signal
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      pickState.set(interaction.user.id, { channelId: interaction.channelId });
      await interaction.reply({
        content: 'Pick Asset & Side, then Continue:',
        components: buildPickComponents(interaction.user.id),
        ephemeral: true,
      });
      return;
    }

    // asset select
    if (interaction.isStringSelectMenu() && interaction.customId === 'pick|asset') {
      const pick = pickState.get(interaction.user.id) || { channelId: interaction.channelId };
      if (interaction.values[0] === 'OTHER') {
        pick.assetWasCustom = true;
        pickState.set(interaction.user.id, pick);
        await interaction.showModal(modalAssetCustom());
        return;
      }
      pick.asset = interaction.values[0];
      pick.assetWasCustom = false;
      pickState.set(interaction.user.id, pick);
      await interaction.update({ content: 'Pick Asset & Side, then Continue:', components: buildPickComponents(interaction.user.id) });
      return;
    }

    // side select
    if (interaction.isStringSelectMenu() && interaction.customId === 'pick|side') {
      const pick = pickState.get(interaction.user.id) || { channelId: interaction.channelId };
      pick.side = interaction.values[0];
      pickState.set(interaction.user.id, pick);
      await interaction.update({ content: 'Pick Asset & Side, then Continue:', components: buildPickComponents(interaction.user.id) });
      return;
    }

    // custom asset modal submit
    if (interaction.isModalSubmit() && interaction.customId === 'asset-custom') {
      let symbol = interaction.fields.getTextInputValue('asset') || '';
      symbol = symbol.toUpperCase().trim().replace(/\s+/g, '');
      symbol = symbol.replace(/[^A-Z0-9/.\-]/g, '').slice(0, 20);
      if (!symbol) return interaction.reply({ content: 'Please enter a valid asset symbol.', ephemeral: true });

      const pick = pickState.get(interaction.user.id) || { channelId: interaction.channelId };
      pick.asset = symbol;
      pick.assetWasCustom = true;
      pickState.set(interaction.user.id, pick);

      await interaction.reply({ content: 'Pick Asset & Side, then Continue:', components: buildPickComponents(interaction.user.id), ephemeral: true });
      return;
    }

    // continue → open form
    if (interaction.isButton() && interaction.customId === 'pick|continue') {
      const pick = pickState.get(interaction.user.id);
      if (!pick?.asset || !pick?.side) {
        return interaction.reply({ content: 'Pick an asset and side first.', ephemeral: true });
      }
      const title = `Create ${pick.asset} ${pick.side} Signal`;
      await interaction.showModal(modalSignalForm(title));
      return;
    }

    // create signal form submit
    if (interaction.isModalSubmit() && interaction.customId === 'signal-create-b') {
      const pick = pickState.get(interaction.user.id);
      if (!pick?.asset || !pick?.side) {
        return interaction.reply({ content: 'Session expired. Run /signal again.', ephemeral: true });
      }

      const entry  = interaction.fields.getTextInputValue('entry')?.trim() || '';
      const sl     = interaction.fields.getTextInputValue('sl')?.trim() || '';
      const tp1    = interaction.fields.getTextInputValue('tp1')?.trim() || '';
      const tp2    = interaction.fields.getTextInputValue('tp2')?.trim() || '';
      const reason = interaction.fields.getTextInputValue('reason')?.trim() || '';

      const channel = await client.channels.fetch(pick.channelId);
      const guildId = channel.guildId;

      const signal = {
        id: require('crypto').randomUUID(),
        guildId,
        channelId: channel.id,
        messageId: null,
        createdBy: interaction.user.id,
        asset: pick.asset,
        side: pick.side,
        entry: entry || '-',
        sl: sl || '-',
        tp1: tp1 || '',
        tp2: tp2 || '',
        tp3: '',                // omitted in modal due to 5-row limit
        reason,
        createdAt: new Date().toISOString(),
        closedAt: null,
        status: 'RUNNING_VALID', // RUNNING_VALID | RUNNING_BE | STOPPED_OUT | STOPPED_BE | CLOSED
        latestTpHit: null        // '1' | '2' | '3'
      };

      // content with single-blank-line spacing between sections
      const sections = [
        titleFor(signal),
        blockTradeDetails(signal),
      ];
      if (signal.reason) sections.push(blockReason(signal));
      sections.push(blockStatus(signal));

      const mentionRole = config.mentionRoleId ? `<@&${config.mentionRoleId}>` : '';
      if (mentionRole) sections.push(mentionRole);

      const content = sections.join('\n\n');

      // prefer webhook identity
      let posted;
      try {
        const avatarToUse = STATIC_AVATAR_URL || await getOwnerAvatar(channel.guild);
        const hook = await getOrCreateWebhook(channel, STATIC_NAME, avatarToUse);
        const wc = new WebhookClient({ id: hook.id, token: hook.token });
        posted = await wc.send({ content, username: STATIC_NAME, avatarURL: avatarToUse || undefined });
      } catch {
        posted = await channel.send(content);
      }

      signal.messageId = posted.id;
      store.saveSignal(signal);

      // private controls thread + link back
      try {
        const link = await createPrivateControlsThread(signal, channel, interaction.user.id);
        await interaction.reply({ content: `Signal posted. Open your private controls thread → ${link}`, ephemeral: true });
      } catch (e) {
        console.error('controls-thread error:', e);
        await interaction.reply({
          content: 'Signal posted. (Could not create a private controls thread — check bot permissions: Create Private Threads, Send Messages in Threads, Manage Threads.)',
          ephemeral: true,
        });
      }

      await updateSummary(channel.id).catch(() => {});
      return;
    }

    // private thread controls
    if (interaction.isButton() && interaction.customId.startsWith('ctrl|')) {
      const [, action, id] = interaction.customId.split('|');
      const signal = store.getSignal(id);
      if (!signal) {
        await interaction.reply({ content: 'Signal not found (maybe deleted).', ephemeral: true });
        return;
      }
      if (interaction.user.id !== signal.createdBy) {
        await interaction.reply({ content: 'Only the signal owner can use these controls.', ephemeral: true });
        return;
      }

      if (action === 'tp1') signal.latestTpHit = '1';
      if (action === 'tp2') signal.latestTpHit = '2';
      if (action === 'tp3') signal.latestTpHit = '3';

      if (action === 'running_valid') signal.status = 'RUNNING_VALID';
      if (action === 'running_be')     signal.status = 'RUNNING_BE';
      if (action === 'stopped_out')    signal.status = 'STOPPED_OUT';
      if (action === 'stopped_be')     signal.status = 'STOPPED_BE';

      if (action === 'delete') {
        try {
          const ch = await client.channels.fetch(signal.channelId);
          const msg = await ch.messages.fetch(signal.messageId);
          await msg.delete().catch(() => {});
        } catch {}
        store.deleteSignal(signal.id);
        await interaction.reply({ content: 'Deleted.', ephemeral: true });
        await updateSummary(signal.channelId).catch(() => {});
        return;
      }

      store.saveSignal(signal);
      await interaction.deferUpdate();
      await updateSummary(signal.channelId).catch(() => {});
      return;
    }

  } catch (err) {
    console.error('interactionCreate error:', err);
    try { await interaction.reply({ content: 'An error occurred. Check bot logs.', ephemeral: true }); } catch {}
  }
});

/* -------------- Summary (single message) --------------- */

function eligibleForSummary(s) {
  if (s.closedAt) return false;
  return s.status === 'RUNNING_VALID';
}

async function updateSummary(forChannelId) {
  const summaryChannelId = config.currentTradesChannelId || forChannelId;
  if (!summaryChannelId) return;

  const channel = await client.channels.fetch(summaryChannelId);
  const all = store.listAll();
  const active = all.filter(eligibleForSummary);

  let content;
  if (active.length === 0) {
    content = `${SUMMARY_HEADER_BOLD}
• There are currently no ongoing trades valid for entry — stay posted for future trades.`;
  } else {
    const blocks = active.map((s, idx) => {
      const jump = `https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId}`;
      const entry = `➡️ Entry: ${s.entry || '-'}`;
      const sl    = `🛑 Stop Loss: ${s.sl || '-'}`;
      let nextTp = '';
      if (!s.latestTpHit && s.tp1)               nextTp = `🎯 TP1: ${s.tp1}`;
      else if (s.latestTpHit === '1' && s.tp2)   nextTp = `🎯 TP2: ${s.tp2}`;
      else if (s.latestTpHit === '2' && s.tp3)   nextTp = `🎯 TP3: ${s.tp3}`;
      const title = `${idx + 1}. ${s.asset.toUpperCase()} ${s.side === 'LONG' ? 'Long 🟢' : 'Short 🔴'} — [jump](${jump})`;
      return [title, entry, sl, nextTp].filter(Boolean).join('\n');
    });
    content = `${SUMMARY_HEADER_BOLD}\n\n${blocks.join('\n\n')}`;
  }

  // edit if we have a stored message id
  let keepId = store.getSummaryMessageId(summaryChannelId);
  if (keepId) {
    try {
      const msg = await channel.messages.fetch(keepId);
      await msg.edit(content);
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      recent?.filter(m => typeof m.content === 'string' && m.content.startsWith(SUMMARY_HEADER_BOLD) && m.id !== keepId)
             ?.forEach(m => m.delete().catch(() => {}));
      return;
    } catch {
      // fall through
    }
  }

  // reuse an existing summary
  let existing = null;
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    existing = recent.find(m =>
      typeof m.content === 'string' && m.content.startsWith(SUMMARY_HEADER_BOLD)
    ) || null;
  } catch {}

  if (existing) {
    await existing.edit(content);
    store.setSummaryMessageId(summaryChannelId, existing.id);
    try {
      const recent = await channel.messages.fetch({ limit: 50 });
      recent.filter(m =>
        typeof m.content === 'string' &&
        m.content.startsWith(SUMMARY_HEADER_BOLD) &&
        m.id !== existing.id
      ).forEach(m => m.delete().catch(() => {}));
    } catch {}
    return;
  }

  // create new (prefer webhook identity)
  try {
    const avatarToUse = STATIC_AVATAR_URL || await getOwnerAvatar(channel.guild);
    const hook        = await getOrCreateWebhook(channel, 'JV Current Trades', avatarToUse);
    const wc          = new WebhookClient({ id: hook.id, token: hook.token });
    const sent        = await wc.send({ content, username: STATIC_NAME, avatarURL: avatarToUse || undefined });
    store.setSummaryMessageId(summaryChannelId, sent.id);
  } catch {
    const sent = await channel.send(content);
    store.setSummaryMessageId(summaryChannelId, sent.id);
  }

  // clean any duplicates
  try {
    const recent = await channel.messages.fetch({ limit: 50 });
    recent.filter(m =>
      typeof m.content === 'string' &&
      m.content.startsWith(SUMMARY_HEADER_BOLD) &&
      m.id !== store.getSummaryMessageId(summaryChannelId)
    ).forEach(m => m.delete().catch(() => {}));
  } catch {}
}

/* ---------------- Start ---------------- */
client.login(config.token);
