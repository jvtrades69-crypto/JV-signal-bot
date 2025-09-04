import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from 'discord.js';
import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignals, updateSignal, deleteSignal,
  getSummaryMessageId, setSummaryMessageId
} from './store.js';
import { renderSignalEmbed, renderSummaryEmbed } from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  // /signal command
  if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
    if (interaction.user.id !== config.ownerId) {
      return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    }

    const signal = {
      id: nano(),
      asset: interaction.options.getString('asset').toUpperCase(),
      direction: interaction.options.getString('direction'), // 'LONG' | 'SHORT'
      entry: interaction.options.getString('entry'),
      stop: interaction.options.getString('sl'),
      tp1: interaction.options.getString('tp1') || null,
      tp2: interaction.options.getString('tp2') || null,
      tp3: interaction.options.getString('tp3') || null,
      reason: interaction.options.getString('reason') || null,
      status: 'RUN_VALID',
      validReentry: true,
      jumpUrl: null
    };

    await saveSignal(signal);

    const signalsChannel = await client.channels.fetch(config.signalsChannelId);
    const embed = renderSignalEmbed(signal, config.brandName);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tp1_${signal.id}`).setLabel('TP1 🎯').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp2_${signal.id}`).setLabel('TP2 🎯').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp3_${signal.id}`).setLabel('TP3 🎯').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`be_${signal.id}`).setLabel('Set BE ⬛').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`stopped_${signal.id}`).setLabel('Stopped Out ❌').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`del_${signal.id}`).setLabel('Delete 🗑').setStyle(ButtonStyle.Secondary)
    );

    const msg = await signalsChannel.send({
      content: config.mentionRoleId ? `<@&${config.mentionRoleId}>` : undefined,
      embeds: [embed],
      components: [row]
    });

    await updateSignal(signal.id, { jumpUrl: msg.url });
    await updateSummary();

    return interaction.reply({ content: '✅ Trade signal posted.', ephemeral: true });
  }

  // Buttons on a signal
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_');

    if (interaction.user.id !== config.ownerId) {
      return interaction.reply({ content: 'Only the owner can update signals.', ephemeral: true });
    }

    if (action === 'del') {
      await deleteSignal(id);
      try { await interaction.message.delete(); } catch {}
      await updateSummary();
      return interaction.reply({ content: '🗑 Deleted.', ephemeral: true });
    }

    let patch = {};
    if (action === 'tp1') patch = { tp1: '✅ Hit' };
    if (action === 'tp2') patch = { tp2: '✅ Hit' };
    if (action === 'tp3') patch = { tp3: '✅ Hit' };
    if (action === 'be')  patch = { status: 'RUN_BE', validReentry: true };
    if (action === 'stopped') patch = { status: 'STOPPED_OUT', validReentry: false };

    await updateSignal(id, patch);

    const all = await getSignals();
    const s = all.find(x => x.id === id);
    if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

    const newEmbed = renderSignalEmbed(s, config.brandName);
    await interaction.message.edit({ embeds: [newEmbed] });

    await updateSummary();
    return interaction.reply({ content: '✅ Updated.', ephemeral: true });
  }
});

async function updateSummary() {
  const trades = (await getSignals()).filter(
    s => s.status === 'RUN_VALID' || s.status === 'RUN_BE'
  );
  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const embed = renderSummaryEmbed(trades, config.summaryTitle);

  const summaryMessageId = await getSummaryMessageId();
  if (summaryMessageId) {
    try {
      const msg = await channel.messages.fetch(summaryMessageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      // message missing; will repost
    }
  }

  const newMsg = await channel.send({ embeds: [embed] });
  await setSummaryMessageId(newMsg.id);
}

client.login(config.token);
