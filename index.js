// index.js
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  InteractionType,
} from 'discord.js';
import {
  saveSignal,
  getSignal,
  updateSignal,
  deleteSignal,
  listActive,
  setSummaryMessageId,
  getSummaryMessageId,
  setOwnerPanelMessageId,
  getOwnerPanelMessageId,
} from './store.js';
import { renderSignalEmbed, renderSummaryEmbed } from './embeds.js';
import {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  SIGNALS_CHANNEL_ID,
  CURRENT_TRADES_CHANNEL_ID,
  OWNER_ID,
} from './config.js';

// Create client with minimal intents (slash commands only need Guilds)
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// Slash command builder
const signalCommand = new SlashCommandBuilder()
  .setName('signal')
  .setDescription('Create a trade signal')
  .addStringOption(opt =>
    opt.setName('asset')
      .setDescription('Choose asset or type Other')
      .setRequired(true)
      .addChoices(
        { name: 'BTC', value: 'BTC' },
        { name: 'ETH', value: 'ETH' },
        { name: 'SOL', value: 'SOL' },
        { name: 'Other (custom)', value: 'OTHER' },
      ))
  .addStringOption(opt =>
    opt.setName('direction')
      .setDescription('Trade direction')
      .setRequired(true)
      .addChoices(
        { name: 'Long', value: 'LONG' },
        { name: 'Short', value: 'SHORT' },
      ))
  .addStringOption(opt =>
    opt.setName('entry')
      .setDescription('Entry price')
      .setRequired(true))
  .addStringOption(opt =>
    opt.setName('stop')
      .setDescription('Stop loss')
      .setRequired(true))
  .addStringOption(opt =>
    opt.setName('tp1')
      .setDescription('Take Profit 1 (optional)')
      .setRequired(false))
  .addStringOption(opt =>
    opt.setName('tp2')
      .setDescription('Take Profit 2 (optional)')
      .setRequired(false))
  .addStringOption(opt =>
    opt.setName('tp3')
      .setDescription('Take Profit 3 (optional)')
      .setRequired(false))
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reasoning (optional)')
      .setRequired(false))
  .addStringOption(opt =>
    opt.setName('mention')
      .setDescription('Role to mention (optional)')
      .setRequired(false));

// Deploy commands
async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    console.log('Registering slash commands...');
    await rest.put(
      Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID),
      { body: [signalCommand.toJSON()] },
    );
    console.log('Commands registered');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
}

// Ready
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  registerCommands();
});

// Handle slash commands
client.on('interactionCreate', async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'signal') {
      const asset = interaction.options.getString('asset');
      const direction = interaction.options.getString('direction');
      const entry = interaction.options.getString('entry');
      const stop = interaction.options.getString('stop');
      const tp1 = interaction.options.getString('tp1');
      const tp2 = interaction.options.getString('tp2');
      const tp3 = interaction.options.getString('tp3');
      const reason = interaction.options.getString('reason');
      const mention = interaction.options.getString('mention');

      // Custom asset
      let finalAsset = asset;
      if (asset === 'OTHER') {
        finalAsset = 'Custom'; // or extend to accept typed asset
      }

      // Save signal
      const newSignal = {
        id: Date.now().toString(),
        asset: finalAsset,
        direction,
        entry,
        stop,
        tp1,
        tp2,
        tp3,
        reason,
        mention,
        status: 'Active',
        validReentry: true,
      };

      saveSignal(newSignal);

      // Render embed
      const embed = renderSignalEmbed(newSignal);

      // Send to signals channel
      const signalsChannel = await client.channels.fetch(SIGNALS_CHANNEL_ID);
      await signalsChannel.send({
        content: mention ? `<@&${mention}>` : null,
        embeds: [embed],
      });

      await interaction.reply({
        content: '✅ Signal posted!',
        flags: 64, // ephemeral replacement
      });

      // TODO: Add private owner panel thread + buttons
    }
  } catch (err) {
    console.error('Error handling /signal:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: '❌ Failed to post signal.',
      }).catch(() => {});
    } else {
      await interaction.reply({
        content: '❌ Failed to post signal.',
        flags: 64,
      }).catch(() => {});
    }
  }
});

client.login(DISCORD_TOKEN);
