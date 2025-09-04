import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  WebhookClient
} from 'discord.js';
import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, getSignals, updateSignal, deleteSignal,
  listActive, getSummaryMessageId, setSummaryMessageId,
  getOwnerPanelMessageId, setOwnerPanelMessageId,
  getStoredWebhook, setStoredWebhook
} from './store.js';
import { renderSignalEmbed, renderSummaryEmbed } from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------- Utils ----------
async function getOrCreateWebhook(channel) {
  // Reuse if saved
  const stored = await getStoredWebhook(channel.id);
  if (stored) {
    return new WebhookClient({ id: stored.id, token: stored.token });
  }
  // Otherwise create
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find(h => h.name === config.brandName);
  if (!hook) {
    hook = await channel.createWebhook({
      name: config.brandName,
      avatar: config.brandAvatarUrl || null
    });
  }
  await setStoredWebhook(channel.id, { id: hook.id, token: hook.token });
  return new WebhookClient({ id: hook.id, token: hook.token });
}

// ---------- Event: Ready ----------
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ---------- Event: Interaction ----------
client.on('interactionCreate', async (interaction) => {
  // /signal command
  if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
    if (interaction.user.id !== config.ownerId) {
      return interaction.reply({ content: 'Only the owner can use this command.', ephemeral: true });
    }

    // Asset
    let asset = interaction.options.getString('asset');
    if (asset === 'OTHER') {
      asset = interaction.options.getString('asset_manual') || 'ASSET';
    }

    const signal = {
      id: nano(),
      asset,
      direction: interaction.options.getString('direction'), // LONG/SHORT
      entry: interaction.options.getString('entry'),
      stop: interaction.options.getString('sl'),
      tp1: interaction.options.getString('tp1'),
      tp2: interaction.options.getString('tp2'),
      tp3: interaction.options.getString('tp3'),
      reason: interaction.options.getString('reason'),
      extraRole: interaction.options.getString('extra_role'),
      status: 'RUN_VALID',
      validReentry: true,
      jumpUrl: null
    };

    await saveSignal(signal);

    // Post via webhook to signals channel
    const signalsChannel = await client.channels.fetch(config.signalsChannelId);
    const webhook = await getOrCreateWebhook(signalsChannel);
    const embed = renderSignalEmbed(signal, config.brandName);

    const contentParts = [];
    if (config.mentionRoleId) contentParts.push(`<@&${config.mentionRoleId}>`);
    if (signal.extraRole) contentParts.push(signal.extraRole);
    const content = contentParts.length ? contentParts.join(' ') : undefined;

    const msg = await webhook.send({
      content,
      embeds: [embed]
    });

    await updateSignal(signal.id, { jumpUrl: msg.url });

    // Create private thread for owner controls
    const thread = await signalsChannel.threads.create({
      name: `controls-${signal.asset}-${signal.id.slice(0, 4)}`,
      type: ChannelType.PrivateThread,
      invitable: false
    });
    await thread.members.add(config.ownerId);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tp1_${signal.id}`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp2_${signal.id}`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp3_${signal.id}`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`run_${signal.id}`).setLabel('🟩 Running (Valid)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`be_${signal.id}`).setLabel('🟫 Running (BE)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`stopped_${signal.id}`).setLabel('🔴 Stopped Out').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`stopbe_${signal.id}`).setLabel('🟥 Stopped BE').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`del_${signal.id}`).setLabel('❌ Delete').setStyle(ButtonStyle.Secondary)
    );

    const panelMsg = await thread.send({ content: 'Owner Control Panel', components: [row] });
    await setOwnerPanelMessageId(signal.id, panelMsg.id);

    await updateSummary();
    return interaction.reply({ content: '✅ Trade signal posted.', ephemeral: true });
  }

  // Button interactions
  if (interaction.isButton()) {
    const [action, id] = interaction.customId.split('_');
    if (interaction.user.id !== config.ownerId) {
      return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
    }

    const signal = await getSignal(id);
    if (!signal) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

    if (action === 'del') {
      await deleteSignal(id);
      await updateSummary();
      return interaction.reply({ content: '❌ Trade deleted.', ephemeral: true });
    }

    const patches = {
      tp1: { tp1: '✅ Hit' },
      tp2: { tp2: '✅ Hit' },
      tp3: { tp3: '✅ Hit' },
      run: { status: 'RUN_VALID', validReentry: true },
      be: { status: 'RUN_BE', validReentry: true },
      stopped: { status: 'STOPPED_OUT', validReentry: false },
      stopbe: { status: 'STOPPED_BE', validReentry: false }
    };

    if (patches[action]) {
      await updateSignal(id, patches[action]);
    }

    // Re-render signal via webhook edit
    const signalsChannel = await client.channels.fetch(config.signalsChannelId);
    const webhook = await getOrCreateWebhook(signalsChannel);
    const updated = await getSignal(id);
    const embed = renderSignalEmbed(updated, config.brandName);

    if (updated.jumpUrl) {
      // Webhook messages can be edited by ID
      const parts = updated.jumpUrl.split('/');
      const messageId = parts[parts.length - 1];
      await webhook.editMessage(messageId, { embeds: [embed] });
    }

    await updateSummary();
    return interaction.reply({ content: '✅ Updated.', ephemeral: true });
  }
});

// ---------- Summary ----------
async function updateSummary() {
  const trades = await listActive();
  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const webhook = await getOrCreateWebhook(channel);
  const embed = renderSummaryEmbed(trades);

  const summaryId = await getSummaryMessageId();
  if (summaryId) {
    try {
      await webhook.editMessage(summaryId, { embeds: [embed] });
      return;
    } catch {
      // fall through
    }
  }

  const msg = await webhook.send({ embeds: [embed] });
  await setSummaryMessageId(msg.id);
}

client.login(config.token);