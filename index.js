const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const { v4: uuidv4 } = require('uuid');

const config = require('./config');
const { buildEmbed, components, STATUS_META } = require('./embeds');
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

function canManage(interaction, signal) {
  if (!interaction || !signal) return false;
  const userId = interaction.user.id;
  if (signal.ownerId === userId) return true;
  if (config.ownerId && userId === config.ownerId) return true;
  const member = interaction.member;
  if (member?.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (config.allowedRoleId) return Boolean(member?.roles?.cache?.has(config.allowedRoleId));
  return false;
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
        const tpsList = [s.tp1, s.tp2, s.tp3].filter(Boolean).join(' | ') || '-';
        const latest = s.latestTpHit ? ` • Latest: TP${s.latestTpHit}` : '';
        return `• ${name} — Entry ${s.entry} | SL ${s.sl || '-'} | Targets ${tpsList}${latest} — [jump](https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId})`;
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

/** Create modal (5 inputs max per Discord) with clear placeholders */
function buildCreateModal() {
  const modal = new ModalBuilder()
    .setCustomId('signal-create')
    .setTitle('Create Trade Signal');

  const asset = new TextInputBuilder()
    .setCustomId('asset')
    .setLabel('Asset')
    .setPlaceholder('BTC / ETH / SOL')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const side = new TextInputBuilder()
    .setCustomId('side')
    .setLabel('Side')
    .setPlaceholder('LONG or SHORT')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const entry = new TextInputBuilder()
    .setCustomId('entry')
    .setLabel('Entry')
    .setPlaceholder('e.g., 108,201 or 108,100–108,300')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const sl = new TextInputBuilder()
    .setCustomId('sl')
    .setLabel('SL (optional)')
    .setPlaceholder('e.g., 100,201')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const tps = new TextInputBuilder()
    .setCustomId('tps')
    .setLabel('Targets (optional)')
    .setPlaceholder('TP1 | TP2 | TP3 — e.g., 110,000 | 121,201')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

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
    // Slash command -> open modal
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      await interaction.showModal(buildCreateModal());
      return;
    }

    // Modal submit -> create signal
    if (interaction.isModalSubmit() && interaction.customId === 'signal-create') {
      const get = (id) => interaction.fields.getTextInputValue(id) || '';
      const asset = get('asset').trim().toUpperCase();
      const sideRaw = get('side').trim().toUpperCase();
      const side = sideRaw === 'LONG' ? 'LONG' : (sideRaw === 'SHORT' ? 'SHORT' : '');
      const entry = get('entry').trim();
      const sl = get('sl').trim();

      const tpsRaw = get('tps');
      let tp1 = '', tp2 = '', tp3 = '';
      if (tpsRaw) {
        const parts = tpsRaw.split('|').map(s => s.trim()).filter(Boolean);
        [tp1, tp2, tp3] = [parts[0] || '', parts[1] || '', parts[2] || ''];
      }

      if (!asset || !side || !entry) {
        await interaction.reply({
          content: 'Asset, Side, and Entry are required. Side must be LONG or SHORT.',
          flags: 64
        });
        return;
      }

      const id = uuidv4();
      const signal = {
        id,
        guildId: interaction.guildId,
        asset,
        side,
        entry,
        sl,
        tp1, tp2, tp3,
        timeframe: '',
        rationale: '',
        status: 'RUNNING_VALID',
        latestTpHit: null,
        ownerId: interaction.user.id,
        createdAt: Date.now(),
        imageUrl: null,
      };

      const embed = buildEmbed(signal);
      const comps = components(id);

      const channel = interaction.channel;
      const msg = await channel.send({ embeds: [embed], components: comps });

      signal.messageId = msg.id;
      signal.channelId = msg.channelId;
      store.upsert(signal);

      await interaction.reply({
        content: `Signal posted here: https://discord.com/channels/${interaction.guildId}/${msg.channelId}/${msg.id}`,
        flags: 64
      });

      await updateSummary(signal.channelId);
      return;
    }

    // Buttons: status / TP / edit / delete
    if (interaction.isButton()) {
      const parts = interaction.customId.split('|');
      if (parts[0] !== 'signal') return;

      const signalId = parts[1];
      const action = parts[2];

      const signal = store.getById(signalId);
      if (!signal) {
        await interaction.reply({ content: 'Signal not found or storage missing.', flags: 64 });
        return;
      }

      if (!canManage(interaction, signal)) {
        await interaction.reply({ content: 'You do not have permission to manage this signal.', flags: 64 });
        return;
      }

      if (action === 'status') {
        const newStatus = parts[3];
        if (!STATUS_META[newStatus]) {
          await interaction.reply({ content: 'Invalid status.', flags: 64 });
          return;
        }
        signal.status = newStatus;
        store.upsert(signal);

        const channel = await client.channels.fetch(signal.channelId);
        const msg = await channel.messages.fetch(signal.messageId);
        await msg.edit({ embeds: [buildEmbed(signal)], components: components(signal.id) });
        await interaction.reply({ content: `Status updated to **${STATUS_META[newStatus].label}**.`, flags: 64 });

        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'tp') {
        const tpNum = parts[3];
        if (!['1', '2', '3'].includes(tpNum)) {
          await interaction.reply({ content: 'Invalid TP.', flags: 64 });
          return;
        }
        signal.latestTpHit = tpNum;
        store.upsert(signal);

        const channel = await client.channels.fetch(signal.channelId);
        const msg = await channel.messages.fetch(signal.messageId);
        await msg.edit({ embeds: [buildEmbed(signal)], components: components(signal.id) });
        await interaction.reply({ content: `Marked **TP${tpNum} hit**.`, flags: 64 });

        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'edit') {
        const modal = new ModalBuilder()
          .setCustomId(`signal-edit|${signal.id}`)
          .setTitle('Edit Signal');

        const entryInput = new TextInputBuilder()
          .setCustomId('entry')
          .setLabel('Entry')
          .setPlaceholder('e.g., 108,201 or 108,100–108,300')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(signal.entry || '');

        const slInput = new TextInputBuilder()
          .setCustomId('sl')
          .setLabel('SL')
          .setPlaceholder('e.g., 100,201')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(signal.sl || '');

        const tpsInput = new TextInputBuilder()
          .setCustomId('tps')
          .setLabel('Targets (TP1 | TP2 | TP3)')
          .setPlaceholder('e.g., 110,000 | 121,201')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue([signal.tp1, signal.tp2, signal.tp3].filter(Boolean).join(' | '));

        const tfInput = new TextInputBuilder()
          .setCustomId('timeframe')
          .setLabel('Timeframe (e.g., 1H, 4H)')
          .setPlaceholder('e.g., 1H')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setValue(signal.timeframe || '');

        const reasonInput = new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Reason (<= 1000 chars)')
          .setPlaceholder('Short notes about the setup')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
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
        const channel = await client.channels.fetch(signal.channelId);
        const msg = await channel.messages.fetch(signal.messageId);
        await msg.delete().catch(() => {});
        store.removeById(signal.id);
        await interaction.reply({ content: 'Signal deleted.', flags: 64 });

        await updateSummary(signal.channelId);
        return;
      }
    }

    // Edit submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('signal-edit|')) {
      const signalId = interaction.customId.split('|')[1];
      const signal = store.getById(signalId);
      if (!signal) {
        await interaction.reply({ content: 'Signal not found.', flags: 64 });
        return;
      }
      if (!canManage(interaction, signal)) {
        await interaction.reply({ content: 'You do not have permission to edit this signal.', flags: 64 });
        return;
      }

      const entry = interaction.fields.getTextInputValue('entry');
      const sl = interaction.fields.getTextInputValue('sl') || '';
      const tpsRaw = interaction.fields.getTextInputValue('tps') || '';
      const timeframe = interaction.fields.getTextInputValue('timeframe') || '';
      const rationale = interaction.fields.getTextInputValue('reason') || '';

      let tp1 = '', tp2 = '', tp3 = '';
      if (tpsRaw) {
        const parts = tpsRaw.split('|').map(s => s.trim()).filter(Boolean);
        tp1 = parts[0] || '';
        tp2 = parts[1] || '';
        tp3 = parts[2] || '';
      }

      signal.entry = entry;
      signal.sl = sl;
      signal.tp1 = tp1;
      signal.tp2 = tp2;
      signal.tp3 = tp3;
      signal.timeframe = timeframe;
      signal.rationale = rationale;

      store.upsert(signal);

      const channel = await client.channels.fetch(signal.channelId);
      const msg = await channel.messages.fetch(signal.messageId);
      await msg.edit({ embeds: [buildEmbed(signal)], components: components(signal.id) });

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