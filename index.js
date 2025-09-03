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

/** Render the *trade post* in your plain-text style */
function renderPlain(signal) {
  const sideEmoji = signal.side === 'LONG' ? '🟢' : '🔴';
  const lines = [];

  // Big title
  lines.push(`# ${signal.asset.toUpperCase()} | ${signal.side === 'LONG' ? 'Long' : 'Short'} ${sideEmoji}`);
  lines.push('');

  // Details
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

  // Reason (optional)
  if (signal.rationale && signal.rationale.trim() !== '') {
    lines.push('📝 Reasoning');
    lines.push(signal.rationale.trim().slice(0, 1000));
    lines.push('');
  }

  // Status formatting (your spec)
  const active = !signal.closedAt;
  if (active) {
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

/** Build the single-line control rows */
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
function manageControls(signalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal|${signalId}|reason|edit`).setLabel('Add/Update Reason').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signal|${signalId}|edit|X`).setLabel('Edit Fields').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signal|${signalId}|delete|X`).setLabel('Delete').setStyle(ButtonStyle.Danger),
  );
}
function tpPercentSelectRow(signalId, which, hasPrice) {
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
  rows.push(manageControls(signal.id));
  return rows;
}

/** Which trades qualify for the summary */
function isSummaryEligible(signal) {
  // Show only trades that are still open AND valid for re-entry
  if (signal.closedAt) return false;
  // RUNNING_VALID => re-entry yes, RUNNING_BE => re-entry no
  return signal.status === 'RUNNING_VALID';
}

/** Render the *summary* with your exact format */
async function updateSummary(forChannelId) {
  try {
    const summaryChannelId = config.currentTradesChannelId || forChannelId;
    if (!summaryChannelId) return;

    const channel = await client.channels.fetch(summaryChannelId);
    const all = store.listAll();
    const active = all.filter(isSummaryEligible);

    const header = '# JV Current Trades 📊';
    let content = '';

    if (active.length === 0) {
      content = `${header}\n- There are current no ongoing trades valid for entry`;
    } else {
      // Numbered blocks
      const blocks = active.map((s, idx) => {
        const base = `${idx + 1}. ${s.asset.toUpperCase()} ${s.side === 'LONG' ? 'Long 🟢' : 'Short 🔴'} — [jump](https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId})`;

        // Determine next TP + label
        let tpLabel = '';
        let tpValue = '';
        if (!s.latestTpHit && s.tp1) { tpLabel = 'Take Profit 1'; tpValue = s.tp1; }
        else if (s.latestTpHit === '1' && s.tp2) { tpLabel = 'Take Profit 2'; tpValue = s.tp2; }
        else if (s.latestTpHit === '2' && s.tp3) { tpLabel = 'Take Profit 3'; tpValue = s.tp3; }

        const entryLine = `➡️ Entry: ${s.entry || '-'}`;
        const slLine = `🛑 Stop Loss: ${s.sl || '-'}`;
        const tpLine = tpValue ? `🎯 ${tpLabel}: ${tpValue}` : null;

        return [base, entryLine, slLine, tpLine].filter(Boolean).join('\n');
      });

      content = `${header}\n\n${blocks.join('\n\n')}`;
    }

    const existingId = store.getSummaryMessageId(summaryChannelId);
    if (existingId) {
      try {
        const msg = await channel.messages.fetch(existingId);
        await msg.edit(content);
        return;
      } catch {
        // If fetch/edit failed (deleted?), fall through to create new
      }
    }
    const newMsg = await channel.send(content);
    store.setSummaryMessageId(summaryChannelId, newMsg.id);
  } catch (e) {
    console.error('updateSummary error:', e);
  }
}

/* --------- Pre-pick dropdowns → modal ---------- */

const pendingPick = new Map(); // key: userId, value: { asset, side, channelId }

/** Build the dropdown UI */
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
  // 5 inputs (Discord modal limit); Reason handled via separate modal/button
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
    // /signal -> pre-pick
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      pendingPick.set(interaction.user.id, { asset: null, side: null, channelId: interaction.channelId });
      await interaction.reply({
        content: 'Pick Asset & Side, then Continue:',
        components: buildPickComponents(interaction.user.id),
        flags: 64, // ephemeral
      });
      return;
    }

    // Pre-pick selections — auto-open modal once both chosen (no "Opening form…" update that would consume it)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('pick|')) {
      const kind = interaction.customId.split('|')[1];
      const pick = pendingPick.get(interaction.user.id) || { channelId: interaction.channelId };

      if (kind === 'asset') {
        const v = interaction.values[0];
        pick.asset = (v === 'OTHER') ? 'OTHER' : v;
      } else if (kind === 'side') {
        pick.side = interaction.values[0];
      }

      pendingPick.set(interaction.user.id, pick);

      if (pick.asset && pick.side) {
        await interaction.showModal(buildCreateModal(pick));
        return;
      }

      // Not both yet: just refresh so Continue enables/disables correctly
      await interaction.update({
        content: 'Pick Asset & Side, then Continue:',
        components: buildPickComponents(interaction.user.id),
      });
      return;
    }

    // Continue button (fallback path)
    if (interaction.isButton() && interaction.customId === 'pick|continue') {
      const pick = pendingPick.get(interaction.user.id);
      if (!pick?.channelId || !(pick.asset && pick.side)) {
        await interaction.update({
          content: 'Pick Asset & Side, then Continue:',
          components: buildPickComponents(interaction.user.id),
        });
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

      // Controls placed "together"
      try {
        if (config.privateControls) {
          const me = await channel.guild.members.fetch(interaction.user.id);
          const thread = await channel.threads.create({
            name: `Controls • ${signal.asset} ${signal.side} • ${interaction.user.username}`,
            autoArchiveDuration: 1440,
            type: ChannelType.PrivateThread,
            invitable: false,
            startMessage: sent,
          });
          await thread.members.add(me.id).catch(() => {});
          await thread.send({ content: 'Your controls:', components: buildControlComponents(signal) });
        } else {
          const msg = await channel.messages.fetch(signal.messageId);
          await msg.reply({ content: 'Controls:', components: buildControlComponents(signal) });
        }
      } catch (e) {
        console.warn('Controls placement failed:', e?.message);
      }

      // Ephemeral confirmation
      await interaction.reply({ content: 'Signal posted.', flags: 64 });
      pendingPick.delete(interaction.user.id);

      await updateSummary(channel.id);
      return;
    }

    // ----- Controls: buttons / selects / modals -----

    if (interaction.isButton() && interaction.customId.startsWith('signal|')) {
      const [, signalId, action, extra] = interaction.customId.split('|');

      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

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
        if (!['1', '2', '3'].includes(extra)) return await interaction.reply({ content: 'Invalid TP.', flags: 64 });
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

      if (action === 'reason') {
        const modal = new ModalBuilder().setCustomId(`reason-edit|${signal.id}`).setTitle('Add / Update Reason');
        const input = new TextInputBuilder()
          .setCustomId('reason').setLabel('Reason (optional)').setPlaceholder('Notes about this setup')
          .setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(signal.rationale || '');
        return await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
      }

      if (action === 'edit') {
        const modal = new ModalBuilder().setCustomId(`signal-edit|${signal.id}`).setTitle('Edit Fields');
        const entry = new TextInputBuilder().setCustomId('entry').setLabel('Entry')
          .setPlaceholder('e.g., 108,201 or 108,100–108,300').setStyle(TextInputStyle.Short).setRequired(true)
          .setValue(signal.entry || '');
        const sl = new TextInputBuilder().setCustomId('sl').setLabel('SL')
          .setPlaceholder('e.g., 100,201').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.sl || '');
        const tp1 = new TextInputBuilder().setCustomId('tp1').setLabel('TP1 (optional)')
          .setPlaceholder('e.g., 110,000').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.tp1 || '');
        const tp2 = new TextInputBuilder().setCustomId('tp2').setLabel('TP2 (optional)')
          .setPlaceholder('e.g., 121,201').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.tp2 || '');
        const tp3 = new TextInputBuilder().setCustomId('tp3').setLabel('TP3 (optional)')
          .setPlaceholder('e.g., 132,500').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.tp3 || '');
        return await interaction.showModal(
          modal.addComponents(
            new ActionRowBuilder().addComponents(entry),
            new ActionRowBuilder().addComponents(sl),
            new ActionRowBuilder().addComponents(tp1),
            new ActionRowBuilder().addComponents(tp2),
            new ActionRowBuilder().addComponents(tp3),
          )
        );
      }

      if (action === 'delete') {
        try {
          await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken }).deleteMessage(signal.messageId);
        } catch {}
        store.removeById(signal.id);
        await interaction.reply({ content: 'Signal deleted.', flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }
    }

    // TP % select & custom modal
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('signal|')) {
      const [, signalId, kind, which] = interaction.customId.split('|');

      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      const choice = interaction.values[0];
      if (kind !== 'tppct' || !['1', '2', '3'].includes(which)) {
        return await interaction.reply({ content: 'Invalid selection.', flags: 64 });
      }

      if (choice === 'custom') {
        const modal = new ModalBuilder().setCustomId(`tppct-custom|${signal.id}|${which}`).setTitle(`TP${which} % (1–100)`);
        const input = new TextInputBuilder().setCustomId('pct').setLabel('Percent out').setPlaceholder('e.g., 33')
          .setStyle(TextInputStyle.Short).setRequired(true);
        return await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
      }

      if (choice === 'clear') signal[`tp${which}Pct`] = null;
      else signal[`tp${which}Pct`] = parseInt(choice, 10);

      store.upsert(signal);
      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken })
        .editMessage(signal.messageId, { content: renderPlain(signal) });

      await interaction.update({ components: buildControlComponents(signal) });
      await updateSummary(signal.channelId);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('tppct-custom|')) {
      const [, signalId, which] = interaction.customId.split('|');
      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      const val = parseInt(oneLine(interaction.fields.getTextInputValue('pct')), 10);
      if (!(val >= 1 && val <= 100)) return await interaction.reply({ content: 'Enter a number between 1 and 100.', flags: 64 });

      signal[`tp${which}Pct`] = val;
      store.upsert(signal);
      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken })
        .editMessage(signal.messageId, { content: renderPlain(signal) });

      await interaction.reply({ content: `Set TP${which} to ${val}%.`, flags: 64 });
      await updateSummary(signal.channelId);
      return;
    }

    // Reason modal submit
    if (interaction.isModalSubmit() && interaction.customId.startsWith('reason-edit|')) {
      const [, signalId] = interaction.customId.split('|');
      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      const reason = interaction.fields.getTextInputValue('reason') || '';
      signal.rationale = reason;
      store.upsert(signal);

      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken })
        .editMessage(signal.messageId, { content: renderPlain(signal) });

      await interaction.reply({ content: 'Reason updated.', flags: 64 });
      await updateSummary(signal.channelId);
      return;
    }

    // Edit fields (entry/sl/tp1-3)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('signal-edit|')) {
      const [, signalId] = interaction.customId.split('|');
      let signal = store.getById(signalId);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      const entry = oneLine(interaction.fields.getTextInputValue('entry'));
      const sl = oneLine(interaction.fields.getTextInputValue('sl') || '');
      const tp1 = oneLine(interaction.fields.getTextInputValue('tp1') || '');
      const tp2 = oneLine(interaction.fields.getTextInputValue('tp2') || '');
      const tp3 = oneLine(interaction.fields.getTextInputValue('tp3') || '');

      signal.entry = entry;
      signal.sl = sl;
      signal.tp1 = tp1;
      signal.tp2 = tp2;
      signal.tp3 = tp3;

      store.upsert(signal);
      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken })
        .editMessage(signal.messageId, { content: renderPlain(signal) });

      await interaction.reply({ content: 'Fields updated.', flags: 64 });
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
