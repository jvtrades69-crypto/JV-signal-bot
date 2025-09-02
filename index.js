const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  WebhookClient,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const store = require('./store');

if (!config.token) {
  console.error('[ERROR] Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ---------- helpers ---------- */

const oneLine = (s) => (s || '').replace(/\s+/g, ' ').trim();

function canManage(interaction, signal) {
  if (!interaction || !signal) return false;
  const uid = interaction.user.id;
  if (signal.ownerId === uid) return true;
  if (config.ownerId && uid === config.ownerId) return true;
  const member = interaction.member;
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (config.allowedRoleId) return Boolean(member?.roles?.cache?.has(config.allowedRoleId));
  return false;
}

async function getOrCreateWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  let hook = webhooks.find(w => w.name === config.webhookName);
  if (!hook) {
    // requires Manage Webhooks permission
    hook = await channel.createWebhook({
      name: config.webhookName,
      avatar: channel.guild?.iconURL({ size: 128 }) || undefined
    });
  }
  return hook;
}

function renderPlain(signal) {
  const sideEmoji = signal.side === 'LONG' ? '🟢' : '🔴';
  const lines = [];

  lines.push(`${signal.asset.toUpperCase()} | ${signal.side === 'LONG' ? 'Long' : 'Short'} ${sideEmoji}`);
  lines.push('');
  lines.push('📊 Trade Details');
  lines.push(`Entry: ${signal.entry || '-'}`);
  lines.push(`Stop Loss: ${signal.sl || '-'}`);
  if (signal.tp1) lines.push(`TP1: ${signal.tp1}`);
  if (signal.tp2) lines.push(`TP2: ${signal.tp2}`);
  if (signal.tp3) lines.push(`TP3: ${signal.tp3}`);
  lines.push('');
  if (signal.rationale && signal.rationale.trim() !== '') {
    lines.push('📝 Reasoning');
    lines.push(signal.rationale.trim().slice(0, 1000));
    lines.push('');
  }
  // Compact status exactly as requested
  const statusMap = {
    RUNNING_VALID: { active: 'YES', runningText: 'trade is still running', reentry: 'Yes' },
    RUNNING_BE:    { active: 'YES', runningText: 'trade is still running', reentry: 'No ( SL set to breakeven )' },
    STOPPED_OUT:   { active: 'NO',  runningText: 'trade has stopped out', reentry: 'No' },
    STOPPED_BE:    { active: 'NO',  runningText: 'trade stopped at breakeven', reentry: 'No ( SL set to breakeven )' },
  };
  const st = statusMap[signal.status] || statusMap.RUNNING_VALID;

  lines.push('📍 Status');
  let first = `Active : ${st.active} - ${st.runningText}`;
  if (signal.latestTpHit) first += ` tp${signal.latestTpHit} hit`;
  lines.push(first);
  lines.push(`valid for Re-entry: ${st.reentry}`);

  return lines.join('\n');
}

function controlComponents(signalId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`signal|${signalId}|status|RUNNING_VALID`).setLabel('Running (Valid)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`signal|${signalId}|status|RUNNING_BE`).setLabel('Running (BE)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`signal|${signalId}|status|STOPPED_OUT`).setLabel('Stopped Out').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`signal|${signalId}|status|STOPPED_BE`).setLabel('Stopped BE').setStyle(ButtonStyle.Secondary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`signal|${signalId}|tp|1`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`signal|${signalId}|tp|2`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`signal|${signalId}|tp|3`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`signal|${signalId}|edit`).setLabel('Edit').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`signal|${signalId}|delete`).setLabel('Delete').setStyle(ButtonStyle.Danger)
    )
  ];
}

async function updateSummary(channelId) {
  try {
    const channel = await client.channels.fetch(channelId);
    const all = store.listAll().filter(s => s.channelId === channelId);
    const active = all.filter(s => s.status === 'RUNNING_VALID' || s.status === 'RUNNING_BE');
    const header = '📈 **Current Trades**';
    let content = '';
    if (active.length === 0) {
      content = `${header}\n_No current trades running._`;
    } else {
      const lines = active.map(s => {
        const name = `$${s.asset.toUpperCase()} • ${s.side === 'LONG' ? 'Long' : 'Short'}`;
        const tps = [s.tp1, s.tp2, s.tp3].filter(Boolean).join(' | ') || '-';
        const latest = s.latestTpHit ? ` • Latest: TP${s.latestTpHit}` : '';
        return `• ${name} — Entry ${s.entry} | Stop Loss ${s.sl || '-'} | Targets ${tps}${latest} — [jump](https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId})`;
      });
      content = `${header}\n${lines.join('\n')}`;
    }
    const existingId = store.getSummaryMessageId(channelId);
    if (existingId) {
      try {
        const msg = await channel.messages.fetch(existingId);
        await msg.edit(content);
        return;
      } catch {}
    }
    const newMsg = await channel.send(content);
    store.setSummaryMessageId(channelId, newMsg.id);
  } catch (e) {
    console.error('updateSummary error:', e);
  }
}

/* ---------- interactions ---------- */

function buildCreateModal() {
  const modal = new ModalBuilder()
    .setCustomId('signal-create')
    .setTitle('Create Trade Signal');

  const asset = new TextInputBuilder()
    .setCustomId('asset').setLabel('Asset').setPlaceholder('BTC / ETH / SOL')
    .setStyle(TextInputStyle.Short).setRequired(true);

  const side = new TextInputBuilder()
    .setCustomId('side').setLabel('Side').setPlaceholder('LONG or SHORT')
    .setStyle(TextInputStyle.Short).setRequired(true);

  const entry = new TextInputBuilder()
    .setCustomId('entry').setLabel('Entry').setPlaceholder('e.g., 108,201 or 108,100–108,300')
    .setStyle(TextInputStyle.Short).setRequired(true);

  const sl = new TextInputBuilder()
    .setCustomId('sl').setLabel('Stop Loss').setPlaceholder('e.g., 100,201')
    .setStyle(TextInputStyle.Short).setRequired(false);

  const tps = new TextInputBuilder()
    .setCustomId('tps').setLabel('Targets').setPlaceholder('TP1 | TP2 | TP3 — 110,000 | 121,201')
    .setStyle(TextInputStyle.Short).setRequired(false);

  return modal.addComponents(
    new ActionRowBuilder().addComponents(asset),
    new ActionRowBuilder().addComponents(side),
    new ActionRowBuilder().addComponents(entry),
    new ActionRowBuilder().addComponents(sl),
    new ActionRowBuilder().addComponents(tps),
  );
}

client.on('interactionCreate', async (interaction) => {
  try {
    // /signal -> open modal
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      await interaction.showModal(buildCreateModal());
      return;
    }

    // Create submit
    if (interaction.isModalSubmit() && interaction.customId === 'signal-create') {
      const asset = oneLine(interaction.fields.getTextInputValue('asset')).toUpperCase();
      const sideRaw = oneLine(interaction.fields.getTextInputValue('side')).toUpperCase();
      const side = sideRaw === 'LONG' ? 'LONG' : (sideRaw === 'SHORT' ? 'SHORT' : '');
      const entry = oneLine(interaction.fields.getTextInputValue('entry'));
      const sl = oneLine(interaction.fields.getTextInputValue('sl') || '');
      const tpsRaw = oneLine(interaction.fields.getTextInputValue('tps') || '');

      let tp1 = '', tp2 = '', tp3 = '';
      if (tpsRaw) {
        const parts = tpsRaw.split('|').map(s => oneLine(s));
        [tp1, tp2, tp3] = [parts[0] || '', parts[1] || '', parts[2] || ''];
      }

      if (!asset || !side || !entry) {
        await interaction.reply({ content: 'Asset, Side, and Entry are required. Side must be LONG or SHORT.', flags: 64 });
        return;
      }

      const id = uuidv4();
      const channel = interaction.channel;
      const webhook = await getOrCreateWebhook(channel);
      const hookClient = new WebhookClient({ id: webhook.id, token: webhook.token });

      const signal = {
        id,
        guildId: interaction.guildId,
        channelId: channel.id,
        asset, side, entry, sl, tp1, tp2, tp3,
        timeframe: '', rationale: '',
        status: 'RUNNING_VALID',
        latestTpHit: null,
        ownerId: interaction.user.id,
        createdAt: Date.now(),
        webhookId: webhook.id,
        webhookToken: webhook.token,
        messageId: null
      };

      const sent = await hookClient.send({
        content: renderPlain(signal),
        allowedMentions: { parse: [] }
      });

      signal.messageId = sent.id;
      store.upsert(signal);

      await interaction.reply({
        content: 'Controls (only you can see):',
        components: controlComponents(signal.id),
        flags: 64
      });

      await updateSummary(signal.channelId);
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      const [prefix, signalId, action, extra] = interaction.customId.split('|');
      if (prefix !== 'signal') return;

      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) {
        await interaction.reply({ content: 'Signal not found (storage reset or message is stale).', flags: 64 });
        return;
      }
      if (!canManage(interaction, signal)) {
        await interaction.reply({ content: 'You do not have permission to manage this signal.', flags: 64 });
        return;
      }

      const hook = new WebhookClient({ id: signal.webhookId, token: signal.webhookToken });

      if (action === 'status') {
        const newStatus = extra;
        if (!['RUNNING_VALID','RUNNING_BE','STOPPED_OUT','STOPPED_BE'].includes(newStatus)) {
          await interaction.reply({ content: 'Invalid status.', flags: 64 }); return;
        }
        signal.status = newStatus;
        store.upsert(signal);
        await hook.editMessage(signal.messageId, { content: renderPlain(signal) });
        await interaction.reply({ content: 'Status updated.', flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'tp') {
        if (!['1','2','3'].includes(extra)) {
          await interaction.reply({ content: 'Invalid TP.', flags: 64 }); return;
        }
        signal.latestTpHit = extra;
        store.upsert(signal);
        await hook.editMessage(signal.messageId, { content: renderPlain(signal) });
        await interaction.reply({ content: `Marked TP${extra} hit.`, flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'edit') {
        const modal = new ModalBuilder().setCustomId(`signal-edit|${signal.id}`).setTitle('Edit Signal');

        const entryInput = new TextInputBuilder().setCustomId('entry').setLabel('Entry')
          .setPlaceholder('e.g., 108,201 or 108,100–108,300').setStyle(TextInputStyle.Short).setRequired(true).setValue(signal.entry || '');
        const slInput = new TextInputBuilder().setCustomId('sl').setLabel('Stop Loss')
          .setPlaceholder('e.g., 100,201').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.sl || '');
        const tpsInput = new TextInputBuilder().setCustomId('tps').setLabel('Targets (TP1 | TP2 | TP3)')
          .setPlaceholder('e.g., 110,000 | 121,201').setStyle(TextInputStyle.Short).setRequired(false)
          .setValue([signal.tp1, signal.tp2, signal.tp3].filter(Boolean).join(' | '));
        const tfInput = new TextInputBuilder().setCustomId('timeframe').setLabel('Timeframe (e.g., 1H, 4H)')
          .setPlaceholder('e.g., 1H').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.timeframe || '');
        const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Reason (<= 1000 chars)')
          .setPlaceholder('Short notes about the setup').setStyle(TextInputStyle.Paragraph).setRequired(false)
          .setValue(signal.rationale ? signal.rationale.slice(0, 1000) : '');

        const row1 = new ActionRowBuilder().addComponents(entryInput);
        const row2 = new ActionRowBuilder().addComponents(slInput);
        const row3 = new ActionRowBuilder().addComponents(tpsInput);
        const row4 = new ActionRowBuilder().addComponents(tfInput);
        const row5 = new ActionRowBuilder().addComponents(reasonInput);
        modal.addComponents(row1, row2, row3, row4, row5);

        await interaction.showModal(modal);
        return;
      }

      if (action === 'delete') {
        try {
          await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken })
            .deleteMessage(signal.messageId);
        } catch {}
        store.removeById(signal.id);
        await interaction.reply({ content: 'Signal deleted.', flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }
    }

    // Edit submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('signal-edit|')) {
      const signalId = interaction.customId.split('|')[1];
      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) { await interaction.reply({ content: 'Signal not found.', flags: 64 }); return; }
      if (!canManage(interaction, signal)) { await interaction.reply({ content: 'No permission.', flags: 64 }); return; }

      const entry = oneLine(interaction.fields.getTextInputValue('entry'));
      const sl = oneLine(interaction.fields.getTextInputValue('sl') || '');
      const tpsRaw = oneLine(interaction.fields.getTextInputValue('tps') || '');
      const timeframe = oneLine(interaction.fields.getTextInputValue('timeframe') || '');
      const rationale = interaction.fields.getTextInputValue('reason') || '';

      let tp1 = '', tp2 = '', tp3 = '';
      if (tpsRaw) {
        const parts = tpsRaw.split('|').map(s => oneLine(s));
        [tp1, tp2, tp3] = [parts[0] || '', parts[1] || '', parts[2] || ''];
      }

      signal.entry = entry;
      signal.sl = sl;
      signal.tp1 = tp1;
      signal.tp2 = tp2;
      signal.tp3 = tp3;
      signal.timeframe = timeframe;
      signal.rationale = rationale;

      store.upsert(signal);

      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken })
        .editMessage(signal.messageId, { content: renderPlain(signal) });

      await interaction.reply({ content: 'Signal updated.', flags: 64 });
      await updateSummary(signal.channelId);
      return;
    }

  } catch (err) {
    console.error('interactionCreate error:', err);
    try {
      if (interaction.isRepliable()) {
        await interaction.reply({ content: 'An error occurred. Check bot logs.', flags: 64 });
      }
    } catch {}
  }
});

client.login(config.token);
