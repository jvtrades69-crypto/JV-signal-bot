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
  console.error('[ERROR] Missing DISCORD_TOKEN');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

/* ---------------- state ---------------- */
const pickState = new Map();     // userId -> { asset, side, channelId }
const draftState = new Map();    // userId -> { asset, side, entry, sl, reason, extraRole, channelId }

/* ---------------- helpers ---------------- */

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

async function getOrCreateWebhook(channel, name, avatarURL) {
  const hooks = await channel.fetchWebhooks().catch(() => null);
  let hook = hooks?.find((w) => w.name === name);
  if (!hook) {
    hook = await channel.createWebhook({
      name,
      avatar: avatarURL || channel.guild?.iconURL({ size: 128 }) || undefined,
    });
  }
  return hook;
}

function parseExtraRole(input) {
  if (!input) return null;
  const mentionMatch = input.match(/<@&(\d+)>/);
  if (mentionMatch) return mentionMatch[1];
  const idMatch = input.match(/\b\d{15,21}\b/);
  if (idMatch) return idMatch[0];
  return null;
}

// Fix for role-mention conflict: use either explicit roles OR parse (not both)
function buildAllowedMentions(extraRoleId) {
  const roles = [config.tradeSignalRoleId, extraRoleId].filter(Boolean);
  return roles.length ? { roles } : { parse: [] };
}

/* -------- trade post rendering (plain text) -------- */

function renderTrade(signal) {
  const sideEmoji = signal.side === 'LONG' ? '🟢' : '🔴';
  const lines = [];

  // Title + clean spacer (two blank lines, no emoji)
  lines.push(`# ${signal.asset.toUpperCase()} | ${signal.side === 'LONG' ? 'Long' : 'Short'} ${sideEmoji}`);
  lines.push('');
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

  if (signal.rationale && signal.rationale.trim() !== '') {
    lines.push('📝 Reasoning');
    lines.push(signal.rationale.trim().slice(0, 1000));
    lines.push('');
  }

  const active = !signal.closedAt;
  if (active) {
    const reentry = (signal.status === 'RUNNING_BE') ? 'No ( SL set to breakeven )' : 'Yes';
    let first = `📍 Status : Active 🟩 - trade is still running`;
    if (signal.latestTpHit) first += `\nTP${signal.latestTpHit} hit`;
    lines.push(first);
    lines.push(`Valid for re-entry: ${reentry}`);
  } else {
    lines.push(`📍 Status : Inactive 🟥 - SL set to breakeven`);
    lines.push(`Valid for re-entry: No`);
  }

  const mentions = [];
  if (config.tradeSignalRoleId) mentions.push(`<@&${config.tradeSignalRoleId}>`);
  if (signal.extraRoleId) mentions.push(`<@&${signal.extraRoleId}>`);
  if (mentions.length) {
    lines.push('');
    lines.push(mentions.join(' '));
  }

  return lines.join('\n');
}

/* -------- buttons/controls -------- */

function rowStatus(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal|${id}|status|RUNNING_VALID`).setLabel('Running (Valid)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signal|${id}|status|RUNNING_BE`).setLabel('Set BE').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signal|${id}|close|X`).setLabel('Close Trade').setStyle(ButtonStyle.Danger),
  );
}
function rowTpHits(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal|${id}|tp|1`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signal|${id}|tp|2`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signal|${id}|tp|3`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Primary),
  );
}
function rowManage(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal|${id}|reason|edit`).setLabel('Add/Update Reason').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signal|${id}|edit|X`).setLabel('Edit Fields').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`signal|${id}|delete|X`).setLabel('Delete').setStyle(ButtonStyle.Danger),
  );
}
function rowTpPct(id, which, hasPrice) {
  if (!hasPrice) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`signal|${id}|tppct|${which}`)
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
function controls(signal) {
  const rows = [];
  rows.push(rowStatus(signal.id));
  rows.push(rowTpHits(signal.id));
  const r1 = rowTpPct(signal.id, '1', !!signal.tp1);
  const r2 = rowTpPct(signal.id, '2', !!signal.tp2);
  const r3 = rowTpPct(signal.id, '3', !!signal.tp3);
  if (r1) rows.push(r1);
  if (r2) rows.push(r2);
  if (r3) rows.push(r3);
  rows.push(rowManage(signal.id));
  return rows;
}

/* -------- summary (JV Current Trades 📊) -------- */

function eligibleForSummary(s) {
  if (s.closedAt) return false;
  return s.status === 'RUNNING_VALID'; // only valid for re-entry
}

async function getOwnerAvatar(guild) {
  try {
    if (!config.ownerId) return null;
    const m = await guild.members.fetch(config.ownerId);
    return m?.user?.displayAvatarURL({ size: 128 }) || null;
  } catch { return null; }
}

async function updateSummary(forChannelId) {
  try {
    const summaryChannelId = config.currentTradesChannelId || forChannelId;
    if (!summaryChannelId) return;

    const channel = await client.channels.fetch(summaryChannelId);
    const all = store.listAll();
    const active = all.filter(eligibleForSummary);

    const header = '# JV Current Trades 📊';
    let content = '';

    if (active.length === 0) {
      content = `${header}\n- There are currently no ongoing trades valid for entry — stay posted for future trades.`;
    } else {
      const blocks = active.map((s, idx) => {
        const base = `${idx + 1}. ${s.asset.toUpperCase()} ${s.side === 'LONG' ? 'Long 🟢' : 'Short 🔴'} — [jump](https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId})`;

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

    // Edit/create summary message
    const existingId = store.getSummaryMessageId(summaryChannelId);
    if (existingId) {
      try {
        const msg = await channel.messages.fetch(existingId);
        await msg.edit(content);
        return;
      } catch {
        // fall through
      }
    }
    const ownerAvatar = await getOwnerAvatar(channel.guild);
    const summaryHook = await getOrCreateWebhook(channel, config.summaryWebhookName, ownerAvatar);
    const hookClient = new WebhookClient({ id: summaryHook.id, token: summaryHook.token });
    const sent = await hookClient.send({
      content,
      username: 'JV Current Trades',
      avatarURL: ownerAvatar || undefined,
    });
    store.setSummaryMessageId(summaryChannelId, sent.id);
  } catch (e) {
    console.error('updateSummary error:', e);
  }
}

/* -------- pick (asset/side) -------- */

function buildPickComponents(userId) {
  const pick = pickState.get(userId) || {};

  const assetMenu = new StringSelectMenuBuilder()
    .setCustomId('pick|asset')
    .setPlaceholder('Pick Asset (or choose Other…)')
    .addOptions(
      { label: 'BTC', value: 'BTC', default: pick.asset === 'BTC' },
      { label: 'ETH', value: 'ETH', default: pick.asset === 'ETH' },
      { label: 'SOL', value: 'SOL', default: pick.asset === 'SOL' },
      { label: 'Other…', value: 'OTHER', default: pick.asset === 'OTHER' },
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

/* -------- create modals (Step A + Step B via button) -------- */

function modalStepA(preset) {
  const modal = new ModalBuilder().setCustomId('signal-create-a').setTitle(`Create ${preset.asset || ''} ${preset.side || ''} Signal`);

  const entry = new TextInputBuilder().setCustomId('entry').setLabel('Entry *').setPlaceholder('e.g., 108,201 or 108,100–108,300').setStyle(TextInputStyle.Short).setRequired(true);
  const sl = new TextInputBuilder().setCustomId('sl').setLabel('SL (optional)').setPlaceholder('e.g., 100,201').setStyle(TextInputStyle.Short).setRequired(false);
  const reason = new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setPlaceholder('Notes about this setup').setStyle(TextInputStyle.Paragraph).setRequired(false);
  const extraRole = new TextInputBuilder().setCustomId('extra').setLabel('Extra role to tag (optional)').setPlaceholder('paste @Role or role ID').setStyle(TextInputStyle.Short).setRequired(false);

  return modal.addComponents(
    new ActionRowBuilder().addComponents(entry),
    new ActionRowBuilder().addComponents(sl),
    new ActionRowBuilder().addComponents(reason),
    new ActionRowBuilder().addComponents(extraRole),
  );
}

function modalStepB() {
  const modal = new ModalBuilder().setCustomId('signal-create-b').setTitle('Targets (optional)');

  const tp1 = new TextInputBuilder().setCustomId('tp1').setLabel('TP1 (optional)').setPlaceholder('e.g., 110,000').setStyle(TextInputStyle.Short).setRequired(false);
  const tp2 = new TextInputBuilder().setCustomId('tp2').setLabel('TP2 (optional)').setPlaceholder('e.g., 121,201').setStyle(TextInputStyle.Short).setRequired(false);
  const tp3 = new TextInputBuilder().setCustomId('tp3').setLabel('TP3 (optional)').setPlaceholder('e.g., 132,500').setStyle(TextInputStyle.Short).setRequired(false);

  return modal.addComponents(
    new ActionRowBuilder().addComponents(tp1),
    new ActionRowBuilder().addComponents(tp2),
    new ActionRowBuilder().addComponents(tp3),
  );
}

function draftPromptRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('draft|targets').setLabel('Add Targets').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('draft|post').setLabel('Post Now').setStyle(ButtonStyle.Success),
    ),
  ];
}

/* ---------------- interactions ---------------- */

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  // Ensure the summary shows “no trades” even before first signal
  try {
    if (config.currentTradesChannelId) {
      await updateSummary(config.currentTradesChannelId);
    }
  } catch (e) {
    console.error('initial updateSummary failed:', e);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    // /signal command -> start pick
    if (interaction.isChatInputCommand && interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      pickState.set(interaction.user.id, { asset: null, side: null, channelId: interaction.channelId });
      await interaction.reply({ content: 'Pick Asset & Side, then Continue:', components: buildPickComponents(interaction.user.id), flags: 64 });
      return;
    }

    // pick selections (asset/side)
    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu() && interaction.customId.startsWith('pick|')) {
      const which = interaction.customId.split('|')[1];
      const pick = pickState.get(interaction.user.id) || { channelId: interaction.channelId };
      if (which === 'asset') pick.asset = interaction.values[0];
      if (which === 'side')  pick.side  = interaction.values[0];
      pickState.set(interaction.user.id, pick);

      await interaction.update({
        content: 'Pick Asset & Side, then Continue:',
        components: buildPickComponents(interaction.user.id),
      });
      return;
    }

    // continue button -> open first modal
    if (interaction.isButton && interaction.isButton() && interaction.customId === 'pick|continue') {
      const pick = pickState.get(interaction.user.id);
      if (!pick?.asset || !pick?.side) {
        await interaction.update({ content: 'Pick Asset & Side, then Continue:', components: buildPickComponents(interaction.user.id) });
        return;
      }
      await interaction.showModal(modalStepA(pick));
      return;
    }

    // create step A submit -> show ephemeral prompt with buttons
    if (interaction.isModalSubmit && interaction.isModalSubmit() && interaction.customId === 'signal-create-a') {
      const pick = pickState.get(interaction.user.id) || {};
      const data = {
        asset: pick.asset || 'ASSET',
        side: pick.side || 'LONG',
        entry: oneLine(interaction.fields.getTextInputValue('entry')),
        sl: oneLine(interaction.fields.getTextInputValue('sl') || ''),
        reason: interaction.fields.getTextInputValue('reason') || '',
        extraRole: interaction.fields.getTextInputValue('extra') || '',
        channelId: pick.channelId || interaction.channelId,
      };
      draftState.set(interaction.user.id, data);

      await interaction.reply({
        content: 'Add targets (optional) or post now:',
        components: draftPromptRows(),
        flags: 64,
      });
      return;
    }

    // draft buttons
    if (interaction.isButton && interaction.isButton() && interaction.customId === 'draft|targets') {
      const draft = draftState.get(interaction.user.id);
      if (!draft) return await interaction.reply({ content: 'Draft not found. Run /signal again.', flags: 64 });
      await interaction.showModal(modalStepB());
      return;
    }
    if (interaction.isButton && interaction.isButton() && interaction.customId === 'draft|post') {
      const draft = draftState.get(interaction.user.id);
      if (!draft) return await interaction.reply({ content: 'Draft not found. Run /signal again.', flags: 64 });

      const channel = await client.channels.fetch(draft.channelId);
      const creatorAvatar = interaction.user.displayAvatarURL({ size: 128 });
      const hook = await getOrCreateWebhook(channel, config.webhookName, creatorAvatar);
      const hookClient = new WebhookClient({ id: hook.id, token: hook.token });

      const extraRoleId = parseExtraRole(draft.extraRole);

      const signal = {
        id: uuidv4(),
        guildId: interaction.guildId,
        channelId: channel.id,
        asset: draft.asset,
        side: draft.side,
        entry: draft.entry,
        sl: draft.sl,
        tp1: '', tp2: '', tp3: '',
        tp1Pct: null, tp2Pct: null, tp3Pct: null,
        rationale: draft.reason,
        extraRoleId,
        status: 'RUNNING_VALID',
        latestTpHit: null,
        ownerId: interaction.user.id,
        createdAt: Date.now(),
        webhookId: hook.id,
        webhookToken: hook.token,
        messageId: null,
        closedAt: null,
      };

      const sent = await hookClient.send({
        content: renderTrade(signal),
        username: interaction.user.username,
        avatarURL: creatorAvatar,
        allowedMentions: buildAllowedMentions(extraRoleId),
      });
      signal.messageId = sent.id;
      store.upsert(signal);

      // PRIVATE controls thread only; if it fails, tell creator ephemerally
      try {
        const me = await channel.guild.members.fetch(interaction.user.id);
        const thread = await channel.threads.create({
          name: `Controls • ${signal.asset} ${signal.side} • ${interaction.user.username}`,
          autoArchiveDuration: 1440,
          type: ChannelType.PrivateThread,
          invitable: false,
          startMessage: sent,
        });
        await thread.members.add(me.id).catch(() => {});
        await thread.send({ content: 'Your controls:', components: controls(signal) });
      } catch (e) {
        console.error('controls-thread error:', e);
        try {
          await interaction.followUp({
            content: 'Could not create a private control thread. Check bot permissions (Create Private Threads / Manage Threads).',
            flags: 64,
          });
        } catch {}
      }

      pickState.delete(interaction.user.id);
      draftState.delete(interaction.user.id);

      await interaction.update({ content: 'Signal posted.', components: [], flags: 64 });
      await updateSummary(channel.id);
      return;
    }

    // create step B submit -> post with targets
    if (interaction.isModalSubmit && interaction.isModalSubmit() && interaction.customId === 'signal-create-b') {
      const draft = draftState.get(interaction.user.id);
      if (!draft) { await interaction.reply({ content: 'Something went wrong. Please try /signal again.', flags: 64 }); return; }

      const tp1 = oneLine(interaction.fields.getTextInputValue('tp1') || '');
      const tp2 = oneLine(interaction.fields.getTextInputValue('tp2') || '');
      const tp3 = oneLine(interaction.fields.getTextInputValue('tp3') || '');

      const extraRoleId = parseExtraRole(draft.extraRole);
      const channel = await client.channels.fetch(draft.channelId);
      const creatorAvatar = interaction.user.displayAvatarURL({ size: 128 });
      const hook = await getOrCreateWebhook(channel, config.webhookName, creatorAvatar);
      const hookClient = new WebhookClient({ id: hook.id, token: hook.token });

      const signal = {
        id: uuidv4(),
        guildId: interaction.guildId,
        channelId: channel.id,
        asset: draft.asset,
        side: draft.side,
        entry: draft.entry,
        sl: draft.sl,
        tp1, tp2, tp3,
        tp1Pct: null, tp2Pct: null, tp3Pct: null,
        rationale: draft.reason,
        extraRoleId,
        status: 'RUNNING_VALID',
        latestTpHit: null,
        ownerId: interaction.user.id,
        createdAt: Date.now(),
        webhookId: hook.id,
        webhookToken: hook.token,
        messageId: null,
        closedAt: null,
      };

      const sent = await hookClient.send({
        content: renderTrade(signal),
        username: interaction.user.username,
        avatarURL: creatorAvatar,
        allowedMentions: buildAllowedMentions(extraRoleId),
      });
      signal.messageId = sent.id;
      store.upsert(signal);

      // PRIVATE controls thread only; if it fails, tell creator ephemerally
      try {
        const me = await channel.guild.members.fetch(interaction.user.id);
        const thread = await channel.threads.create({
          name: `Controls • ${signal.asset} ${signal.side} • ${interaction.user.username}`,
          autoArchiveDuration: 1440,
          type: ChannelType.PrivateThread,
          invitable: false,
          startMessage: sent,
        });
        await thread.members.add(me.id).catch(() => {});
        await thread.send({ content: 'Your controls:', components: controls(signal) });
      } catch (e) {
        console.error('controls-thread error:', e);
        try {
          await interaction.followUp({
            content: 'Could not create a private control thread. Check bot permissions (Create Private Threads / Manage Threads).',
            flags: 64,
          });
        } catch {}
      }

      pickState.delete(interaction.user.id);
      draftState.delete(interaction.user.id);

      await interaction.reply({ content: 'Signal posted.', flags: 64 });
      await updateSummary(channel.id);
      return;
    }

    // ----- controls handlers -----
    if (interaction.isButton && interaction.isButton() && interaction.customId.startsWith('signal|')) {
      const [, id, action, extra] = interaction.customId.split('|');

      let signal = store.getById(id);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      const hook = new WebhookClient({ id: signal.webhookId, token: signal.webhookToken });

      if (action === 'status') {
        signal.status = extra; // RUNNING_VALID / RUNNING_BE
        store.upsert(signal);
        await hook.editMessage(signal.messageId, { content: renderTrade(signal) });
        await interaction.reply({ content: 'Status updated.', flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'tp') {
        if (!['1', '2', '3'].includes(extra)) return await interaction.reply({ content: 'Invalid TP.', flags: 64 });
        signal.latestTpHit = extra;
        store.upsert(signal);
        await hook.editMessage(signal.messageId, { content: renderTrade(signal) });
        await interaction.reply({ content: `Marked TP${extra} hit.`, flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'close') {
        signal.closedAt = Date.now();
        store.upsert(signal);
        await hook.editMessage(signal.messageId, { content: renderTrade(signal) });
        await interaction.reply({ content: 'Trade closed.', flags: 64 });
        await updateSummary(signal.channelId);
        return;
      }

      if (action === 'reason') {
        const modal = new ModalBuilder().setCustomId(`reason-edit|${signal.id}`).setTitle('Add / Update Reason');
        const input = new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setPlaceholder('Notes about this setup').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue(signal.rationale || '');
        return await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
      }

      if (action === 'edit') {
        const modal = new ModalBuilder().setCustomId(`signal-edit|${signal.id}`).setTitle('Edit Fields');

        const entry = new TextInputBuilder().setCustomId('entry').setLabel('Entry').setPlaceholder('e.g., 108,201 or 108,100–108,300').setStyle(TextInputStyle.Short).setRequired(true).setValue(signal.entry || '');
        const sl = new TextInputBuilder().setCustomId('sl').setLabel('SL').setPlaceholder('e.g., 100,201').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.sl || '');
        const tp1 = new TextInputBuilder().setCustomId('tp1').setLabel('TP1 (optional)').setPlaceholder('e.g., 110,000').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.tp1 || '');
        const tp2 = new TextInputBuilder().setCustomId('tp2').setLabel('TP2 (optional)').setPlaceholder('e.g., 121,201').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.tp2 || '');
        const tp3 = new TextInputBuilder().setCustomId('tp3').setLabel('TP3 (optional)').setPlaceholder('e.g., 132,500').setStyle(TextInputStyle.Short).setRequired(false).setValue(signal.tp3 || '');

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

    // TP % select + custom modal
    if (interaction.isStringSelectMenu && interaction.isStringSelectMenu() && interaction.customId.startsWith('signal|')) {
      const [, id, kind, which] = interaction.customId.split('|');

      let signal = store.getById(id);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      const choice = interaction.values[0];
      if (kind !== 'tppct' || !['1', '2', '3'].includes(which)) return await interaction.reply({ content: 'Invalid selection.', flags: 64 });

      if (choice === 'custom') {
        const modal = new ModalBuilder().setCustomId(`tppct-custom|${signal.id}|${which}`).setTitle(`TP${which} % (1–100)`);
        const input = new TextInputBuilder().setCustomId('pct').setLabel('Percent out').setPlaceholder('e.g., 33').setStyle(TextInputStyle.Short).setRequired(true);
        return await interaction.showModal(modal.addComponents(new ActionRowBuilder().addComponents(input)));
      }

      signal[`tp${which}Pct`] = (choice === 'clear') ? null : parseInt(choice, 10);
      store.upsert(signal);
      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken }).editMessage(signal.messageId, { content: renderTrade(signal) });
      await interaction.update({ components: controls(signal) });
      await updateSummary(signal.channelId);
      return;
    }

    if (interaction.isModalSubmit && interaction.isModalSubmit() && interaction.customId.startsWith('tppct-custom|')) {
      const [, id, which] = interaction.customId.split('|');
      let signal = store.getById(id);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      const val = parseInt(oneLine(interaction.fields.getTextInputValue('pct')), 10);
      if (!(val >= 1 && val <= 100)) return await interaction.reply({ content: 'Enter a number between 1 and 100.', flags: 64 });

      signal[`tp${which}Pct`] = val;
      store.upsert(signal);
      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken }).editMessage(signal.messageId, { content: renderTrade(signal) });
      await interaction.reply({ content: `Set TP${which} to ${val}%.`, flags: 64 });
      await updateSummary(signal.channelId);
      return;
    }

    // Reason update
    if (interaction.isModalSubmit && interaction.isModalSubmit() && interaction.customId.startsWith('reason-edit|')) {
      const [, id] = interaction.customId.split('|');
      let signal = store.getById(id);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      signal.rationale = interaction.fields.getTextInputValue('reason') || '';
      store.upsert(signal);
      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken }).editMessage(signal.messageId, { content: renderTrade(signal) });
      await interaction.reply({ content: 'Reason updated.', flags: 64 });
      await updateSummary(signal.channelId);
      return;
    }

    // Edit fields modal submit
    if (interaction.isModalSubmit && interaction.isModalSubmit() && interaction.customId.startsWith('signal-edit|')) {
      const [, id] = interaction.customId.split('|');
      let signal = store.getById(id);
      if (!signal) signal = store.getByMessageId(interaction.message?.id);
      if (!signal) return await interaction.reply({ content: 'Signal not found.', flags: 64 });
      if (!canManage(interaction, signal)) return await interaction.reply({ content: 'No permission.', flags: 64 });

      signal.entry = oneLine(interaction.fields.getTextInputValue('entry'));
      signal.sl = oneLine(interaction.fields.getTextInputValue('sl') || '');
      signal.tp1 = oneLine(interaction.fields.getTextInputValue('tp1') || '');
      signal.tp2 = oneLine(interaction.fields.getTextInputValue('tp2') || '');
      signal.tp3 = oneLine(interaction.fields.getTextInputValue('tp3') || '');

      store.upsert(signal);
      await new WebhookClient({ id: signal.webhookId, token: signal.webhookToken }).editMessage(signal.messageId, { content: renderTrade(signal) });
      await interaction.reply({ content: 'Fields updated.', flags: 64 });
      await updateSummary(signal.channelId);
      return;
    }

  } catch (err) {
    console.error('interactionCreate error:', err);
    try {
      if (interaction.isRepliable && interaction.isRepliable()) {
        await interaction.reply({ content: 'An error occurred. Check bot logs.', flags: 64 });
      }
    } catch {}
  }
});

client.login(config.token);