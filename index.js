// index.js (ESM)
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ChannelType,
} from 'discord.js';
import {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  SIGNALS_CHANNEL_ID,
  CURRENT_TRADES_CHANNEL_ID,
  OWNER_ID,
  USE_WEBHOOK,
  BRAND_NAME,
  BRAND_AVATAR_URL,
} from './config.js';
import {
  saveSignal,
  listActive,
  getSummaryMessageId,
  setSummaryMessageId,
} from './store.js';
import { renderSignalEmbed, renderSummaryEmbed } from './embeds.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

/* ------------------------------
   Slash command (REQUIRED FIRST)
--------------------------------*/
const SignalCmd = new SlashCommandBuilder()
  .setName('signal')
  .setDescription('Post a trade signal')

  // REQUIRED first
  .addStringOption((o) =>
    o
      .setName('asset')
      .setDescription('Pick an asset or Other')
      .setRequired(true)
      .addChoices(
        { name: 'BTC', value: 'BTC' },
        { name: 'ETH', value: 'ETH' },
        { name: 'SOL', value: 'SOL' },
        { name: 'Other', value: 'OTHER' },
      ),
  )
  .addStringOption((o) =>
    o
      .setName('direction')
      .setDescription('Long or Short')
      .setRequired(true)
      .addChoices({ name: 'Long', value: 'Long' }, { name: 'Short', value: 'Short' }),
  )
  .addStringOption((o) => o.setName('entry').setDescription('Entry price').setRequired(true))
  .addStringOption((o) => o.setName('stop').setDescription('Stop Loss').setRequired(true))

  // OPTIONAL after
  .addStringOption((o) =>
    o
      .setName('custom_asset')
      .setDescription('If you chose Other, type the asset (e.g., XRP)')
      .setRequired(false),
  )
  .addStringOption((o) => o.setName('tp1').setDescription('Take Profit 1').setRequired(false))
  .addStringOption((o) => o.setName('tp2').setDescription('Take Profit 2').setRequired(false))
  .addStringOption((o) => o.setName('tp3').setDescription('Take Profit 3').setRequired(false))
  .addStringOption((o) => o.setName('reason').setDescription('Reason (optional)').setRequired(false))
  .addStringOption((o) =>
    o.setName('mention_role').setDescription('Extra role to tag (@Role or ID)').setRequired(false),
  );

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), {
    body: [SignalCmd.toJSON()],
  });
  console.log('[slash] /signal registered');
}

/* ------------------------------
   Helpers
--------------------------------*/
async function getOrCreateWebhook(channel) {
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find((h) => h.name === 'JV Signal Hook');
  if (!hook) hook = await channel.createWebhook({ name: 'JV Signal Hook' });
  return hook;
}

async function postAsWebhook(channel, payload) {
  const hook = await getOrCreateWebhook(channel);
  return hook.send({
    username: BRAND_NAME,
    avatarURL: BRAND_AVATAR_URL || undefined,
    ...payload,
  });
}

async function upsertSummary() {
  const currentCh = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
  const trades = await listActive();
  const summaryEmbed = renderSummaryEmbed(trades);

  let summaryId = await getSummaryMessageId();
  if (!summaryId) {
    const msg = await currentCh.send({ embeds: [summaryEmbed], allowedMentions: { parse: [] } });
    await setSummaryMessageId(msg.id);
  } else {
    try {
      const msg = await currentCh.messages.fetch(summaryId);
      await msg.edit({ embeds: [summaryEmbed], allowedMentions: { parse: [] } });
    } catch {
      const msg = await currentCh.send({ embeds: [summaryEmbed], allowedMentions: { parse: [] } });
      await setSummaryMessageId(msg.id);
    }
  }
}

/* ------------------------------
   Runtime
--------------------------------*/
client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'signal') return;

  try {
    await interaction.deferReply({ ephemeral: true });

    const assetChoice = interaction.options.getString('asset', true);
    const customAsset = interaction.options.getString('custom_asset') || '';
    const asset = assetChoice === 'OTHER' ? (customAsset || 'ASSET').toUpperCase() : assetChoice;

    const direction = interaction.options.getString('direction', true);
    const entry = interaction.options.getString('entry', true);
    const stop = interaction.options.getString('stop', true);
    const tp1 = interaction.options.getString('tp1') || '';
    const tp2 = interaction.options.getString('tp2') || '';
    const tp3 = interaction.options.getString('tp3') || '';
    const reason = interaction.options.getString('reason') || '';
    const mentionRole = interaction.options.getString('mention_role') || '';

    const signal = {
      asset,
      direction,
      entry,
      stop,
      tp1,
      tp2,
      tp3,
      reason,
      status: 'Active',
      validReentry: 'No',
    };

    const parentChannel = await client.channels.fetch(SIGNALS_CHANNEL_ID);
    const embed = renderSignalEmbed(signal);

    let sent;
    if (USE_WEBHOOK) {
      sent = await postAsWebhook(parentChannel, {
        embeds: [embed],
        content: mentionRole ? `${mentionRole}` : undefined,
        allowedMentions: { parse: [], roles: [], users: [] },
      });
    } else {
      sent = await parentChannel.send({
        embeds: [embed],
        content: mentionRole ? `${mentionRole}` : undefined,
        allowedMentions: { parse: [], roles: [], users: [] },
      });
    }

    await saveSignal({
      ...signal,
      channelId: sent.channel.id,
      messageId: sent.id,
      createdBy: interaction.user.id,
      createdAt: Date.now(),
    });

    await upsertSummary();

    try {
      const thread = await parentChannel.threads.create({
        name: `Owner • ${signal.asset} ${signal.direction}`,
        type: ChannelType.PrivateThread,
        invitable: false,
        reason: 'Owner control panel',
      });
      await thread.members.add(OWNER_ID);
      await thread.send('Owner panel created. (Buttons can be added later.)');
    } catch {
      // ignore if missing perms
    }

    await interaction.editReply('✅ Signal posted.');
  } catch (err) {
    console.error('Error handling /signal:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply('❌ Failed to post signal.');
    }
  }
});

client.login(DISCORD_TOKEN);
