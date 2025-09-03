// index.js
// Discord.js v14
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const {
  saveSignal,
  getSignal,
  deleteSignal,
  listAll,
  getSummaryMessageId,
  setSummaryMessageId,
} = require('./store');

const config = require('./config'); // only used for OWNER/ROLE checks if you keep them

// ---------- Client ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---------------------------------------------------------------------
// Helpers: message formatting (signal) – matches the style you asked for
// ---------------------------------------------------------------------
function bigTitle(asset, side, dot) {
  // one blank line after the title (exactly one)
  return `**${asset} | ${side} ${dot}**\n`;
}

function formatSignalBody(sig) {
  const lines = [];

  // Title
  const dot = (sig.side || '').toLowerCase() === 'long' ? '🟢' : '🔴';
  lines.push(bigTitle(sig.asset, sig.side, dot));

  // Trade details
  lines.push('📊 **Trade Details**');
  lines.push(`Entry: ${sig.entry ?? '-'}`);
  lines.push(`SL: ${sig.sl ?? '-'}`);
  if (sig.tp1) lines.push(`TP1: ${sig.tp1}`);
  if (sig.tp2) lines.push(`TP2: ${sig.tp2}`);
  if (sig.tp3) lines.push(`TP3: ${sig.tp3}`);
  lines.push(''); // gap

  // Reason (optional)
  if (sig.reason && sig.reason.trim().length) {
    lines.push('📝 **Reasoning**');
    lines.push(sig.reason.trim());
    lines.push('');
  }

  // Status
  const activeLabel = sig.active ? 'Active 🟩 - trade is still running' : 'Inactive 🟥 - SL set to breakeven';
  const reentry = sig.validForReentry ? 'Yes' : 'No';
  lines.push('📍 **Status**');
  if (sig.tpHitLabel) lines.push(`${activeLabel}\n${sig.tpHitLabel}`);
  else lines.push(activeLabel);
  lines.push(`Valid for re-entry: ${reentry}`);

  // trailing tag role if any
  if (sig.tagRoleId) {
    lines.push('');
    lines.push(`<@&${sig.tagRoleId}>`);
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------
// Summary (Current Active Trades) – always one message (no duplicates)
// ---------------------------------------------------------------------
function buildSummaryContent(signals) {
  // Title bold only
  let out = `**JV Current Active Trades 📊**\n`;

  if (!signals.length) {
    out += `• There are currently no ongoing trades valid for entry — stay posted for future trades.\n`;
    return out;
  }

  signals.forEach((s, i) => {
    const dot = (s.side || '').toLowerCase() === 'long' ? '🟢' : '🔴';
    const first = `${i + 1}. ${s.asset} ${s.side} ${dot} — [jump](https://discord.com/channels/${s.guildId}/${s.channelId}/${s.messageId})`;
    const entry = `➡️ Entry: ${s.entry ?? '-'}`;
    const sl = `🛑 Stop Loss: ${s.sl ?? '-'}`;
    const tps = [];
    if (s.tp1) tps.push(`🎯 TP1: ${s.tp1}`);
    if (s.tp2) tps.push(`🎯 TP2: ${s.tp2}`);
    if (s.tp3) tps.push(`🎯 TP3: ${s.tp3}`);

    out += `\n${first}\n${entry}\n${sl}\n${tps.join('\n')}\n`;
  });

  return out.trim() + '\n';
}

async function upsertSummaryMessage(channel, content) {
  const channelId = channel.id;
  const storedId = getSummaryMessageId(channelId);

  if (storedId) {
    try {
      const msg = await channel.messages.fetch(storedId);
      await msg.edit({ content });
      return;
    } catch {
      // fall through: send fresh
    }
  }

  const newMsg = await channel.send({ content });
  setSummaryMessageId(channelId, newMsg.id);

  if (storedId && storedId !== newMsg.id) {
    try {
      const old = await channel.messages.fetch(storedId);
      await old.delete().catch(() => {});
    } catch {}
  }
}

async function refreshCurrentTradesSummary(client, channelId) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel) return;

  // Your rule: hide signals that aren't valid for re-entry (e.g., SL BE or closed)
  const active = listAll().filter(s => s.validForReentry !== false);
  const content = buildSummaryContent(active);
  await upsertSummaryMessage(channel, content);
}

// ---------------------------------------------------------------------
// Owner check (if you want it). Otherwise, comment it out.
// ---------------------------------------------------------------------
function isOwner(interaction) {
  const ownerId = process.env.OWNER_USER_ID || config?.ownerId;
  return ownerId ? interaction.user.id === ownerId : true;
}

// ---------------------------------------------------------------------
// Slash command: /signal → step 1 select asset & side
// ---------------------------------------------------------------------
client.on('interactionCreate', async (interaction) => {
  try {
    // ----- Slash command -----
    if (interaction.isChatInputCommand && interaction.commandName === 'signal') {
      if (!isOwner(interaction)) {
        return interaction.reply({ content: 'Only the owner can use this.', ephemeral: true });
      }

      // Asset select (+ free text via “Other…”)
      const assetSelect = new StringSelectMenuBuilder()
        .setCustomId('sig.asset')
        .setPlaceholder('Pick Asset (or choose Other…)')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('BTC').setValue('BTC'),
          new StringSelectMenuOptionBuilder().setLabel('ETH').setValue('ETH'),
          new StringSelectMenuOptionBuilder().setLabel('SOL').setValue('SOL'),
          new StringSelectMenuOptionBuilder().setLabel('Other…').setValue('OTHER'),
        );

      const sideSelect = new StringSelectMenuBuilder()
        .setCustomId('sig.side')
        .setPlaceholder('Pick Side')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('Long').setValue('Long'),
          new StringSelectMenuOptionBuilder().setLabel('Short').setValue('Short'),
        );

      const row1 = new ActionRowBuilder().addComponents(assetSelect);
      const row2 = new ActionRowBuilder().addComponents(sideSelect);
      const row3 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sig.continue').setLabel('Continue').setStyle(ButtonStyle.Primary),
      );

      await interaction.reply({
        content: 'Pick Asset & Side, then Continue:',
        components: [row1, row2, row3],
        ephemeral: true,
      });
      return;
    }

    // ----- Selects / Continue -----
    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'sig.asset' || interaction.customId === 'sig.side') {
        // Just acknowledge so the selection is kept visible
        return interaction.deferUpdate();
      }
    }

    if (interaction.isButton() && interaction.customId === 'sig.continue') {
      // Get the message components the user just interacted with
      const parentMsg = await interaction.message.fetch();
      const comps = parentMsg.components;

      const assetVal = comps[0]?.components[0]?.values?.[0];
      const sideVal = comps[1]?.components[0]?.values?.[0];

      if (!assetVal || !sideVal) {
        return interaction.reply({ content: 'Pick both Asset and Side first.', ephemeral: true });
      }

      // If "OTHER", we’ll ask for the custom asset in the modal
      const assetIsOther = assetVal === 'OTHER';

      // Build modal for Entry/SL/TPs/Reason/Role
      const modal = new ModalBuilder()
        .setCustomId(`sig.modal.${assetVal}.${sideVal}`)
        .setTitle(`Create ${assetIsOther ? 'CUSTOM' : assetVal} ${sideVal.toUpperCase()} Signal`);

      const customAsset = new TextInputBuilder()
        .setCustomId('assetCustom')
        .setLabel('Custom Asset (only if you picked Other…)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const entry = new TextInputBuilder()
        .setCustomId('entry')
        .setLabel('Entry (e.g., 108,201 or 108,100–108,300)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const sl = new TextInputBuilder()
        .setCustomId('sl')
        .setLabel('SL (e.g., 100,201)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const tp = new TextInputBuilder()
        .setCustomId('tp')
        .setLabel('Targets (optional, e.g., "TP1 110,000 | TP2 121,201")')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      const reason = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      const role = new TextInputBuilder()
        .setCustomId('extraRole')
        .setLabel('Extra role to tag (optional, paste @Role or ID)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      const rows = [
        new ActionRowBuilder().addComponents(customAsset),
        new ActionRowBuilder().addComponents(entry),
        new ActionRowBuilder().addComponents(sl),
        new ActionRowBuilder().addComponents(tp),
        new ActionRowBuilder().addComponents(reason),
      ];

      // Discord limits modals to 5 fields; if you want the extraRole too,
      // you can swap it with reason or include it in TP text (your call).
      // Here we keep reason and omit extraRole due to the 5-field limit.

      await interaction.showModal(modal.setComponents(rows));
      return;
    }

    // ----- Modal submit: create the signal message -----
    if (interaction.isModalSubmit() && interaction.customId.startsWith('sig.modal.')) {
      const parts = interaction.customId.split('.');
      const assetVal = parts[2]; // BTC/ETH/SOL/OTHER
      const sideVal = parts[3];  // Long/Short

      const customAsset = interaction.fields.getTextInputValue('assetCustom')?.trim();
      const entry = interaction.fields.getTextInputValue('entry')?.trim();
      const sl = interaction.fields.getTextInputValue('sl')?.trim();
      const tp = interaction.fields.getTextInputValue('tp')?.trim();
      const reason = interaction.fields.getTextInputValue('reason')?.trim();

      // Parse TPs (simple parse: look for lines with TP1/TP2/TP3)
      let tp1, tp2, tp3;
      if (tp) {
        const lines = tp.split(/\r?\n/).map(s => s.trim());
        for (const ln of lines) {
          const m1 = ln.match(/TP1[^0-9]*([\d,.\-]+)/i);
          const m2 = ln.match(/TP2[^0-9]*([\d,.\-]+)/i);
          const m3 = ln.match(/TP3[^0-9]*([\d,.\-]+)/i);
          if (m1) tp1 = m1[1];
          if (m2) tp2 = m2[1];
          if (m3) tp3 = m3[1];
        }
      }

      const assetFinal = assetVal === 'OTHER' ? (customAsset || 'OTHER') : assetVal;

      // Create the signal message in the current channel
      const sig = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        messageId: null, // set after we send
        asset: assetFinal,
        side: sideVal,
        entry: entry || '-',
        sl: sl || '-',
        tp1,
        tp2,
        tp3,
        reason: reason || '',
        tagRoleId: process.env.MENTION_ROLE_ID || null, // your default mention role for signals
        active: true,
        validForReentry: true,
        tpHitLabel: '', // shown in status line when e.g. "TP1 hit"
        ownerId: interaction.user.id,
      };

      // Post message
      const msg = await interaction.channel.send({ content: formatSignalBody(sig) });
      sig.messageId = msg.id;

      // Save + ack
      saveSignal(sig);
      await interaction.reply({ content: 'Signal posted.', ephemeral: true });

      // Private controls thread (owner only)
      try {
        const thread = await msg.startThread({
          name: `controls-${sig.asset}-${sig.side}`.slice(0, 96),
          autoArchiveDuration: 1440,
          reason: 'Signal controls',
        });

        // Restrict visibility: make it private if allowed in the server
        // (If server doesn’t allow private threads, this will be public)
        // NOTE: If you must ensure private-only, set channel perms accordingly in Discord.

        const controls = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ctl.run.valid:${sig.id}`).setLabel('Running (Valid)').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`ctl.run.be:${sig.id}`).setLabel('Running (BE)').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(`ctl.stop.out:${sig.id}`).setLabel('Stopped Out').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`ctl.stop.be:${sig.id}`).setLabel('Stopped BE').setStyle(ButtonStyle.Secondary),
        );
        const tps = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ctl.tp1:${sig.id}`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`ctl.tp2:${sig.id}`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(`ctl.tp3:${sig.id}`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Primary),
        );
        const editDel = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ctl.edit:${sig.id}`).setLabel('Edit').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`ctl.delete:${sig.id}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
        );

        await thread.send({ content: `Controls (only you can use): <@${sig.ownerId}>`, components: [controls, tps, editDel] });
      } catch (e) {
        console.error('Thread create failed:', e.message);
      }

      // === keep summary to ONE message ===
      await refreshCurrentTradesSummary(client, process.env.CURRENT_TRADES_CHANNEL_ID);
      return;
    }

    // ----- Button controls (status / tps / delete) -----
    if (interaction.isButton() && interaction.customId.startsWith('ctl.')) {
      // Only the original signal owner or the configured owner can use
      const ownerOk = isOwner(interaction);
      // optional: allow the signal owner
      const allowUserId = interaction.user.id;

      const [ns, action, idPart] = interaction.customId.split(':'); // e.g. "ctl.tp1:<id>"
      const sigId = idPart;
      const sig = getSignal(sigId);
      if (!sig) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      if (!(ownerOk || allowUserId === sig.ownerId)) {
        return interaction.reply({ content: 'Not allowed.', ephemeral: true });
      }

      let editedBodyNeeded = false;

      if (action === 'run.valid') {
        sig.active = true;
        sig.validForReentry = true;
        sig.tpHitLabel = '';
        editedBodyNeeded = true;
      } else if (action === 'run.be') {
        sig.active = true;
        sig.validForReentry = false; // you said: once SL to BE, Valid for re-entry: No
        sig.tpHitLabel = '';
        editedBodyNeeded = true;
      } else if (action === 'stop.out') {
        sig.active = false;
        sig.validForReentry = false;
        sig.tpHitLabel = '';
        editedBodyNeeded = true;
      } else if (action === 'stop.be') {
        sig.active = false;
        sig.validForReentry = false;
        sig.tpHitLabel = '';
        editedBodyNeeded = true;
      } else if (action === 'tp1') {
        sig.tpHitLabel = 'TP1 hit';
        editedBodyNeeded = true;
      } else if (action === 'tp2') {
        sig.tpHitLabel = 'TP2 hit';
        editedBodyNeeded = true;
      } else if (action === 'tp3') {
        sig.tpHitLabel = 'TP3 hit';
        editedBodyNeeded = true;
      } else if (action === 'edit') {
        // Minimal inline edit example: toggle re-entry
        sig.validForReentry = !sig.validForReentry;
        editedBodyNeeded = true;
      } else if (action === 'delete') {
        // Delete original signal message
        try {
          const ch = await client.channels.fetch(sig.channelId);
          const m = await ch.messages.fetch(sig.messageId);
          await m.delete().catch(() => {});
        } catch {}
        deleteSignal(sig.id);
        await interaction.reply({ content: 'Signal deleted.', ephemeral: true });

        // refresh summary (removes it if it was there)
        await refreshCurrentTradesSummary(client, process.env.CURRENT_TRADES_CHANNEL_ID);
        return;
      }

      saveSignal(sig);

      if (editedBodyNeeded) {
        try {
          const ch = await client.channels.fetch(sig.channelId);
          const m = await ch.messages.fetch(sig.messageId);
          await m.edit({ content: formatSignalBody(sig) });
        } catch (e) {
          console.error('Failed to edit signal message:', e.message);
        }
      }

      await interaction.reply({ content: 'Updated.', ephemeral: true });

      // === keep summary to ONE message ===
      await refreshCurrentTradesSummary(client, process.env.CURRENT_TRADES_CHANNEL_ID);
      return;
    }
  } catch (err) {
    console.error('interactionCreate error:', err);
    if (interaction?.replied || interaction?.deferred) {
      try { await interaction.followUp({ content: 'An error occurred. Check bot logs.', ephemeral: true }); } catch {}
    } else {
      try { await interaction.reply({ content: 'An error occurred. Check bot logs.', ephemeral: true }); } catch {}
    }
  }
});

// ---------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------
if (!process.env.DISCORD_TOKEN) {
  console.error('[ERROR] Missing DISCORD_TOKEN in .env');
  process.exit(1);
}
client.login(process.env.DISCORD_TOKEN);
