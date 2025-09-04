import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, updateSignal, deleteSignal,
  listActive, getSummaryMessageId, setSummaryMessageId
} from './store.js';
import { renderSignalEmbed, renderSummaryEmbed } from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------- Ready ----------
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag} (id: ${client.user.id})`);
});

// ---------- Helpers ----------
async function editPostedSignal(signal) {
  const channel = await client.channels.fetch(config.signalsChannelId);
  if (!signal.messageId) return; // nothing to edit yet
  const msg = await channel.messages.fetch(signal.messageId).catch(() => null);
  if (!msg) return;
  const embed = renderSignalEmbed(signal, config.brandName);
  await msg.edit({ embeds: [embed] });
}

async function updateSummary() {
  const trades = await listActive();
  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const embed = renderSummaryEmbed(trades);

  const summaryId = await getSummaryMessageId();
  if (summaryId) {
    try {
      const m = await channel.messages.fetch(summaryId);
      await m.edit({ embeds: [embed] });
      return;
    } catch {
      // fallthrough to send new
    }
  }
  const newMsg = await channel.send({ embeds: [embed] });
  await setSummaryMessageId(newMsg.id);
}

function ownerPanel(signalId) {
  // Row 1: quick marks
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tp1hit_${signalId}`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp2hit_${signalId}`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tp3hit_${signalId}`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`run_${signalId}`).setLabel('🟩 Running (Valid)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`be_${signalId}`).setLabel('🟫 Running (BE)').setStyle(ButtonStyle.Secondary)
  );
  // Row 2: edit TP text/percent + stop states
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`edit_tp1_${signalId}`).setLabel('✏️ Edit TP1').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`edit_tp2_${signalId}`).setLabel('✏️ Edit TP2').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`edit_tp3_${signalId}`).setLabel('✏️ Edit TP3').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`stopped_${signalId}`).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`stopbe_${signalId}`).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger)
  );
  // Row 3: delete
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`del_${signalId}`).setLabel('❌ Delete').setStyle(ButtonStyle.Secondary)
  );
  return [row1, row2, row3];
}

function buildTpModal(signalId, tpKey) {
  const modalId = `modal_${tpKey}_${signalId}`;
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle(`Update ${tpKey.toUpperCase()}`);

  const valueInput = new TextInputBuilder()
    .setCustomId('tp_value')
    .setLabel('TP value (e.g., 110000)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  const noteInput = new TextInputBuilder()
    .setCustomId('tp_note')
    .setLabel('Note / % close (e.g., close 50%)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false);

  modal.addComponents(
    new ActionRowBuilder().addComponents(valueInput),
    new ActionRowBuilder().addComponents(noteInput)
  );
  return modal;
}

// ---------- Interactions ----------
client.on('interactionCreate', async (interaction) => {
  try {
    // /ping
    if (interaction.isChatInputCommand() && interaction.commandName === 'ping') {
      return interaction.reply({ content: '🏓 pong', ephemeral: true });
    }

    // /signal
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
      }

      // Fast ack to avoid timeouts
      await interaction.deferReply({ ephemeral: true });

      // Asset
      let asset = interaction.options.getString('asset');
      if (asset === 'OTHER') asset = interaction.options.getString('asset_manual') || 'ASSET';

      const signal = {
        id: nano(),
        asset,
        direction: interaction.options.getString('direction'),
        entry: interaction.options.getString('entry'),
        stop: interaction.options.getString('sl'),
        tp1: interaction.options.getString('tp1'),
        tp2: interaction.options.getString('tp2'),
        tp3: interaction.options.getString('tp3'),
        reason: interaction.options.getString('reason'),
        extraRole: interaction.options.getString('extra_role'),
        status: 'RUN_VALID',
        validReentry: true,
        jumpUrl: null,
        messageId: null
      };

      await saveSignal(signal);

      // Post as BOT (no webhooks)
      const signalsChannel = await client.channels.fetch(config.signalsChannelId);
      const embed = renderSignalEmbed(signal, config.brandName);

      const contentParts = [];
      if (config.mentionRoleId) contentParts.push(`<@&${config.mentionRoleId}>`);
      if (signal.extraRole) contentParts.push(signal.extraRole);
      const content = contentParts.length ? contentParts.join(' ') : undefined;

      const posted = await signalsChannel.send({ content, embeds: [embed] });
      await updateSignal(signal.id, { jumpUrl: posted.url, messageId: posted.id });

      // Owner control thread (private)
      const thread = await signalsChannel.threads.create({
        name: `controls-${signal.asset}-${signal.id.slice(0, 4)}`,
        type: ChannelType.PrivateThread,
        invitable: false
      });
      await thread.members.add(config.ownerId);

      const rows = ownerPanel(signal.id);
      await thread.send({ content: 'Owner Control Panel', components: rows });

      await updateSummary();
      await interaction.editReply({ content: '✅ Trade signal posted (as bot).' });
      return;
    }

    // Buttons
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }

      const [action, id] = interaction.customId.split('_');

      // Edit TP (open modal)
      if (action === 'edit') {
        const tpKey = interaction.customId.split('_')[1]; // tp1 / tp2 / tp3
        const modal = buildTpModal(id, tpKey);
        return interaction.showModal(modal);
      }

      // Mutating actions — defer reply
      await interaction.deferReply({ ephemeral: true });

      const signal = await getSignal(id);
      if (!signal) {
        return interaction.editReply({ content: 'Signal not found.' });
      }

      if (action === 'del') {
        // delete the original message too
        if (signal.messageId) {
          const ch = await client.channels.fetch(config.signalsChannelId);
          const msg = await ch.messages.fetch(signal.messageId).catch(() => null);
          if (msg) { try { await msg.delete(); } catch {} }
        }
        await deleteSignal(id);
        await updateSummary();
        return interaction.editReply({ content: '❌ Trade deleted.' });
      }

      const patches = {
        tp1hit: { tp1: '✅ Hit' },
        tp2hit: { tp2: '✅ Hit' },
        tp3hit: { tp3: '✅ Hit' },
        run: { status: 'RUN_VALID', validReentry: true },
        be: { status: 'RUN_BE', validReentry: true },
        stopped: { status: 'STOPPED_OUT', validReentry: false },
        stopbe: { status: 'STOPPED_BE', validReentry: false }
      };

      if (patches[action]) {
        await updateSignal(id, patches[action]);
      }

      const updated = await getSignal(id);
      await editPostedSignal(updated);
      await updateSummary();

      return interaction.editReply({ content: '✅ Updated.' });
    }

    // Modal submissions (Edit TP values/notes)
    if (interaction.isModalSubmit()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }

      await interaction.deferReply({ ephemeral: true });

      // customId: modal_tp1_<id> or modal_tp2_<id> or modal_tp3_<id>
      const parts = interaction.customId.split('_'); // ["modal","tp1","<id>"]
      const tpKey = parts[1]; // tp1/tp2/tp3
      const id = parts[2];

      const signal = await getSignal(id);
      if (!signal) {
        return interaction.editReply({ content: 'Signal not found.' });
      }

      const value = interaction.fields.getTextInputValue('tp_value')?.trim();
      const note = interaction.fields.getTextInputValue('tp_note')?.trim();

      let newText = null;
      if (value && note) newText = `${value} (${note})`;
      else if (value) newText = value;
      else if (note) newText = `(${note})`;

      if (newText) {
        await updateSignal(id, { [tpKey]: newText });
      }

      const updated = await getSignal(id);
      await editPostedSignal(updated);
      await updateSummary();

      return interaction.editReply({ content: `✅ ${tpKey.toUpperCase()} updated.` });
    }
  } catch (err) {
    console.error('interaction error:', err);
    if (interaction?.deferred || interaction?.replied) {
      try { await interaction.editReply({ content: '❌ Internal error.' }); } catch {}
    }
  }
});

client.login(config.token);
