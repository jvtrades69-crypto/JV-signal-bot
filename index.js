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
  StringSelectMenuBuilder,
  ChannelType,
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

/* ---------------- Helpers ---------------- */

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
  const hooks = await channel.fetchWebhooks().catch(() => null);
  let hook = hooks?.find((w) => w.name === config.webhookName);
  if (!hook) {
    hook = await channel.createWebhook({
      name: config.webhookName,
      avatar: channel.guild?.iconURL({ size: 128 }) || undefined,
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
  lines.push(`SL: ${signal.sl || '-'}`);

  if (signal.tp1) {
    const pct = signal.tp1Pct ? ` (${signal.tp1Pct}% out)` : '';
    lines.push(`TP1: ${signal.tp1}${pct}`);
  }
  if (signal.tp2) {
    const pct = signal.tp2Pct ? ` (${signal.tp2Pct}% out)` : '';
    lines.push(`TP2: ${signal.tp2}${pct}`);
  }
  if (signal.tp3) {
    const pct = signal.tp3Pct ? ` (${signal.tp3Pct}% out)` : '';
    lines.push(`TP3: ${signal.tp3}${pct}`);
  }
  lines.push('');

  if (signal.rationale && signal.rationale.trim() !== '') {
    lines.push('📝 Reasoning');
    lines.push(signal.rationale.trim().slice(0, 1000));
    lines.push('');
  }

  // Status formatting per your spec
  const active = signal.closedAt ? false : true;
  if (active) {
    // If SL is BE (status set to BE), re-entry is No (SL set to breakeven)
    const reentry = (signal.status === 'RUNNING_BE') ? 'No ( SL set to breakeven )' : 'Yes';
    let first = `📍 Status : Active 🟩 - trade is still running`;
    if (signal.latestTpHit) first += ` TP${signal.latestTpHit} hit`;
    lines.push(first);
    lines.push(`Valid for re-entry: ${reentry}`);
  } else {
    lines.push(`📍 Status : Inactive 🟥 - SL set to breakeven`);
    lines.push(`Valid for re-entry: No`);
  }

  // Role tag
  if (config.tradeSignalRoleId) {
    lines.push('');
    lines.push(`<@&${config.tradeSignalRoleId}>`);
  }

  return lines.join('\n');
}

function statusControls(signalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal|${signalId}|status|RUNNING_VALID`).setLabel('Running (Valid)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signal|${signalId}|status|RUNNING_BE`).setLabel('Set BE').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signal|${signalId}|close|X`).setLabel('Close Trade').setStyle(ButtonStyle.Danger),
  );
}

function tpHitControls(signalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal|${signalId}|tp|1`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signal|${signalId}|tp|2`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signal|${signalId}|tp|3`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Primary),
  );
}

function tpPercentSelectRow(signalId, which, hasPrice) {
  // Only show a select if that TP price exists
  if (!hasPrice) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`signal|${signalId}|tppct|${which}`)
    .setPlaceholder(`TP${which} % out`)
    .addOptions(
      { label: '25%', value: '25' },
      { label: '50%', value: '50' },
      { label: '75%', value: '75' },
      { label: 'Custom…', value: 'custom' },
      { label: 'Clear', value: 'clear' },
    );
  return new ActionRowBuilder().addComponents(menu);
}

function buildControlComponents(signal) {
  const rows = [];
  rows.push(statusControls(signal.id));
  rows.push(tpHitControls(signal.id));
  const r1 = tpPercentSelectRow(signal.id, '1', !!signal.tp1);
  const r2 = tpPercentSelectRow(signal.id, '2', !!signal.tp2);
  const r3 = tpPercentSelectRow(signal.id, '3', !!signal.tp3);
  if (r1) rows.push(r1);
  if (r2) rows.push(r2);
  if (r3) rows.push(r3);
  return rows;
}

async function updateSummary(forChannelId) {
  try {
    const summaryChannelId = config.currentTradesChannelId || forChannelId;
    if (!summaryChannelId) return;

    const channel = await client.channels.fetch(summaryChannelId);
    const all = store.listAll().filter(s => s.channelId === forChannelId || s.channelId === summaryChannelId);
    const active = all.filter(s => !s.closedAt);

    const header = '📈 **Current Trades**';
    let content = '';
    if (active.length === 0) {
      content = `${header}\n_No current trades running._`;
    } else {
      const lines = active.map(s => {
        const name = `$${s.asset.toUpperCase()} • ${s.side === 'LONG' ? 'Long' : 'Short'}`;
        const targets = [s.tp1, s.tp2, s.tp3].filter(Boolean);
        let next = '';
        if (!s.latestTpHit && targets[0]) next = ` • Next: TP1 ${targets[0]}`;
        else if (s.latestTpHit === '1' && s.tp2) next = ` • Next: TP2 ${s.tp2}`;
        else if (s.latestTpHit === '2' && s.tp3) next = ` • Next: TP3 ${s.tp3}`;

        const latest = s.latestTpHit ? ` • TP${s.latestTpHit} hit` : '';
        return `• ${name} — Entry ${s.entry} | SL ${s.sl || '-'}${latest}${next} — [jump](https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId})`;
      });
      content = `${header}\n${lines.join('\n')}`;
    }

    const existingId = store.getSummaryMessageId(summaryChannelId);
    if (existingId) {
      try {
        const msg = await channel.messages.fetch(existingId);
        await msg.edit(content);
        return;
      } catch {}
    }
    const newMsg = await channel.send(content);
    store.setSummaryMessageId(summaryChannelId, newMsg.id);
  } catch (e) {
    console.error('updateSummary error:', e);
  }
}

/* --------- Pre-pick dropdowns → modal ---------- */

const pendingPick = new Map(); // key: userId, value: { asset, side, channelId }

function buildPickComponents(userId) {
  const pick = pendingPick.get(userId) || {};
  const assetMenu = new StringSelectMenuBuilder()
    .setCustomId('pick|asset')
    .setPlaceholder('Pick Asset (or choose Other…)')
    .addOptions(
      { label: 'BTC', value: 'BTC' },
      { label: 'ETH', value: 'ETH' },
      { label: 'SOL', value: 'SOL' },
      { label: 'Other…', value: 'OTHER' },
    );

  const sideMenu = new StringSelectMenuBuilder()
    .setCustomId('pick|side')
    .setPlaceholder('Pick Side')
    .addOptions(
      { label: 'Long', value: 'LONG' },
      { label: 'Short', value: 'SHORT' },
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

function buildCreateModal(preset) {
  const modal = new ModalBuilder().setCustomId('signal-create').setTitle(`Create ${preset.asset || ''} ${preset.side || ''} Signal`);

  const entry = new TextInputBuilder()
    .setCustomId('entry').setLabel('Entry').setPlaceholder('e.g., 108,201 or 108,100–108,300')
    .setStyle(TextInputStyle.Short).setRequired(true);

  const sl = new TextInputBuilder()
    .setCustomId('sl').setLabel('SL').setPlaceholder('e.g., 100,201')
    .setStyle(TextInputStyle.Short).setRequired(false);

  const tp1 = new TextInputBuilder()
    .setCustomId('tp1').setLabel('TP1 (optional)').setPlaceholder('e.g., 110,000')
    .setStyle(TextInputStyle.Short).setRequired(false);

  const tp2 = new TextInputBuilder()
    .setCustomId('tp2').setLabel('TP2 (optional)').setPlaceholder('e.g., 121,201')
    .setStyle(TextInputStyle.Short).setRequired(false);

  const tp3 = new TextInputBuilder()
    .setCustomId('tp3').setLabel('TP3 (optional)').setPlaceholder('e.g., 132,500')
    .setStyle(TextInputStyle.Short).setRequired(false);

  return modal.addComponents(
    new ActionRowBuilder().addComponents(entry),
    new ActionRowBuilder().addComponents(sl),
    new ActionRowBuilder().addComponents(tp1),
    new ActionRowBuilder().addComponents(tp2),
    new ActionRowBuilder().addComponents(tp3),
  );
}

/* ----------------- Interactions ----------------- */

client.on('interactionCreate', async (interaction) => {
  try {
    // /signal -> show pre-pick dropdowns (ephemeral)
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      pendingPick.set(interaction.user.id, { asset: null, side: null, channelId: interaction.channelId });
      await interaction.reply({
        content: 'Pick Asset & Side, then Continue:',
        components: buildPickComponents(interaction.user.id),
        flags: 64,
      });
      return;
    }

    // Handle pre-pick selects & continue
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('pick|')) {
      const kind = interaction.customId.split('|')[1];
      const pick = pendingPick.get(interaction.user.id) || { channelId: interaction.channelId };

      if (kind === 'asset') {
        const v = interaction.values[0];
        if (v === 'OTHER') {
          // Let them type in the modal later; set placeholder 'OTHER'
          pick.asset = 'OTHER';
        } else {
          pick.asset = v;
        }
      } else if (kind === 'side') {
        pick.side = interaction.values[0];
      }

      pendingPick.set(interaction.user.id, pick);
      await interaction.update({
        content: 'Pick Asset & Side, then Continue:',
        components: buildPickComponents(interaction.user.id),
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'pick|continue') {
      const pick = pendingPick.get(interaction.user.id);
      if (!pick?.channelId) {
        await interaction.reply({ content: 'Start again with /signal.', flags: 64 });
        return;
      }
      await interaction.showModal(buildCreateModal(pick));
      return;
    }

    // Create submit
    if (interaction.isModalSubmit() && interaction.customId === 'signal-create') {
      const pick = pendingPick.get(interaction.user.id) || {};
      const asset = (pick.asset && pick.asset !== 'OTHER') ? pick.asset : 'ASSET';
      const side = pick.side || 'LONG';

      const entry = oneLine(interaction.fields.getTextInputValue('entry'));
      const sl = oneLine(interaction.fields.getTextInputValue('sl') || '');
      const tp1 = oneLine(interaction.fields.getTextInputValue('tp1') || '');
      const tp2 = oneLine(interaction.fields.getTextInputValue('tp2') || '');
      const tp3 = oneLine(interaction.fields.getTextInputValue('tp3') || '');

      if (!asset || !side || !entry) {
        await interaction.reply({ content: 'Asset, Side, and Entry are required.', flags: 64 });
        return;
      }

      const id = uuidv4();
      const channel = await client.channels.fetch(pick.channelId || interaction.channelId);
      const webhook = await getOrCreateWebhook(channel);
      const hookClient = new WebhookClient({ id: webhook.id, token: webhook.token });

      const signal = {
        id,
        guildId: interaction.guildId,
        channelId: channel.id,
        asset, side,
        entry, sl,
        tp1, tp2, tp3,
        tp1Pct: null, tp2Pct: null, tp3Pct: null,
        rationale: '',
        status: 'RUNNING_VALID', // or RUNNING_BE
        latestTpHit: null,
        ownerId: interaction.user.id,
        createdAt: Date.now(),
        webhookId: webhook.id,
        webhookToken: webhook.token,
        messageId: null,
        closedAt: null,
      };

      // Post clean plaintext via webhook
      const sent = await hookClient.send({ content: renderPlain(signal), allowedMentions: { parse: ['roles'] } });
      signal.messageId = sent.id;
      store.upsert(signal);

      // Controls together with the message:
      if (config.privateControls) {
        // Private thread just for you (if channel allows)
        try {
          const me = await channel.guild.members.fetch(interaction.user.id);
          const thread = await channel.threads.create({
            name: `Controls • ${signal.asset} ${signal.side} • ${interaction.user.username}`,
            autoArchiveDuration: 1440,
            type: ChannelType.PrivateThread,
            invitable: false,
            startMessage: sent, // attach to the post
          });
          await thread.members.add(me.id).catch(() => {});
          await thread.send({ content: 'Your controls:', components: buildControlComponents(signal) });
        } catch (e) {
          console.warn('Private thread failed, falling back to public reply:', e?.message);
          const msg = await channel.messages.fetch(signal.messageId);
          await msg.reply({ content: 'Controls:', components: buildControlComponents(signal) });
        }
      } else {
        const msg = await channel.messages.fetch(signal.messageId);
        await msg.reply({ content: 'Controls:', components: buildControlComponents(signal) });
      }

      // Confirm (ephemeral)
      await interaction.reply({ content: 'Signal posted.', flags: 64 });
      pendingPick.delete(interaction.user.id);

      await updateSummary(channel.id);
      return;
    }

    // CONTROL BUTTONS (status/TP hit/close)
    if (interaction.isButton() && interaction.customId.startsWith('signal|')) {
      const [, signalId, action, extra] = interaction.customId.split('|');

      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) {
        await interaction.reply({ content: 'Signal not found.', flags: 64 });
        return;
      }
      if (!canManage(interaction, signal)) {
        await interaction.reply({ content: 'No permission.', flags: 64 });
        return;
      }

      const hook = new WebhookClient({ id: signal.webhookId, token: signal.webhookToken });

      if (action === 'status') {
        signal.status = extra; // RUNNING_VALID or RUNNING_BE
        store.upsert(signal);
        await hook.editMessage(signal.messageId, { content: renderPlain(signal) });
        await interaction.reply({ content: 'Status updated.', flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'tp') {
        if (!['1', '2', '3'].includes(extra)) {
          await interaction.reply({ content: 'Invalid TP.', flags: 64 });
          return;
        }
        signal.latestTpHit = extra;
        store.upsert(signal);
        await hook.editMessage(signal.messageId, { content: renderPlain(signal) });
        await interaction.reply({ content: `Marked TP${extra} hit.`, flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'close') {
        signal.closedAt = Date.now();
        store.upsert(signal);
        await hook.editMessage(signal.messageId, { content: renderPlain(signal) });
        await interaction.reply({ content: 'Trade closed.', flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }
    }

    // TP PERCENT SELECTS (25/50/75/custom/clear)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('signal|')) {
      const [, signalId, kind, which] = interaction.customId.split('|'); // kind=tppct, which=1/2/3

      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) {
        await interaction.reply({ content: 'Signal not found.', flags: 64 });
        return;
      }
      if (!canManage(interaction, signal)) {
        await interaction.reply({ content: 'No permission.', flags: 64 });
        return;
      }

      const choice = interaction.values[0];
      if (kind !== 'tppct' || !['1', '2', '3'].includes(which)) {
        await interaction.reply({ content: 'Invalid selection.', flags: 64 });
        return;
      }

      if (choice === 'custom') {
        const modal = new ModalBuilder().setCustomId(`tppct-custom|${signal.id}|${which}`).setTitle(`TP${which} % (1–100)`);
        const input = new TextInputBuilder().setCustomId('pct').setLabel('Percent out').setPlaceholder('e.g., 33')
          .setStyle(TextInputStyle.Short).setRequired(true);
        return await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
      }

      if (choice === 'clear') {
        signal[`tp${which}Pct`] = null;
      } else {
        signal[`tp${which}Pct`] = parseInt(choice, 10);
      }

      store.upsert(signal);
      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken })
        .editMessage(signal.messageId, { content: renderPlain(signal) });

      await interaction.update({ components: buildControlComponents(signal) });
      await updateSummary(signal.channelId);
      return;
    }

    // Custom % modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('tppct-custom|')) {
      const [, signalId, which] = interaction.customId.split('|');
      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) {
        await interaction.reply({ content: 'Signal not found.', flags: 64 });
        return;
      }
      if (!canManage(interaction, signal)) {
        await interaction.reply({ content: 'No permission.', flags: 64 });
        return;
      }

      const val = parseInt(oneLine(interaction.fields.getTextInputValue('pct')), 10);
      if (!(val >= 1 && val <= 100)) {
        await interaction.reply({ content: 'Enter a number between 1 and 100.', flags: 64 });
        return;
      }

      signal[`tp${which}Pct`] = val;
      store.upsert(signal);

      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken })
        .editMessage(signal.messageId, { content: renderPlain(signal) });

      // Try to find the control message and update components (best-effort)
      try {
        const channel = await client.channels.fetch(signal.channelId);
        const msg = await channel.messages.fetch(signal.messageId);
        const replies = await msg.fetch(true); // noop; kept for parity
      } catch {}

      await interaction.reply({ content: `Set TP${which} to ${val}%.`, flags: 64 });
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
