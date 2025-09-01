const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
const { config } = require('dotenv');
config();

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID in .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('signal')
    .setDescription('Post a trading signal embed.')
    .addStringOption(o => o.setName('asset').setDescription('e.g., BTC, ETH, SOL').setRequired(true))
    .addStringOption(o => o.setName('direction').setDescription('long or short').setRequired(true).addChoices(
      { name: 'Long', value: 'long' },
      { name: 'Short', value: 'short' }
    ))
    .addStringOption(o => o.setName('entry').setDescription('Entry price or range').setRequired(true))
    .addStringOption(o => o.setName('sl').setDescription('Stop loss').setRequired(true))
    .addStringOption(o => o.setName('tp1').setDescription('Take profit 1 (optional)'))
    .addStringOption(o => o.setName('tp2').setDescription('Take profit 2 (optional)'))
    .addStringOption(o => o.setName('tp3').setDescription('Take profit 3 (optional)'))
    .addStringOption(o => o.setName('timeframe').setDescription('e.g., 15m / 1H / 4H (optional)'))
    .addNumberOption(o => o.setName('risk').setDescription('Risk % (optional)'))
    .addStringOption(o => o.setName('chart').setDescription('Chart image URL (optional)'))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to post into').addChannelTypes(ChannelType.GuildText))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('signal-update')
    .setDescription('Update an existing signal by ID.')
    .addStringOption(o => o.setName('id').setDescription('Signal ID').setRequired(true))
    .addStringOption(o => o.setName('entry').setDescription('New entry'))
    .addStringOption(o => o.setName('sl').setDescription('New SL'))
    .addStringOption(o => o.setName('tp1').setDescription('New TP1'))
    .addStringOption(o => o.setName('tp2').setDescription('New TP2'))
    .addStringOption(o => o.setName('tp3').setDescription('New TP3'))
    .addStringOption(o => o.setName('chart').setDescription('New chart URL'))
    .addStringOption(o => o.setName('timeframe').setDescription('New timeframe'))
    .addNumberOption(o => o.setName('risk').setDescription('New risk %'))
    .toJSON(),

  new SlashCommandBuilder()
    .setName('signal-close')
    .setDescription('Close a signal by ID.')
    .addStringOption(o => o.setName('id').setDescription('Signal ID').setRequired(true))
    .addStringOption(o => o.setName('result').setDescription('Result').setRequired(true).addChoices(
      { name: 'Win', value: 'Win' },
      { name: 'Loss', value: 'Loss' },
      { name: 'Breakeven', value: 'Breakeven' },
      { name: 'Manual Close', value: 'Manual Close' }
    ))
    .addNumberOption(o => o.setName('r').setDescription('R multiple, e.g., 2.0'))
    .toJSON()
];

(async () => {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  try {
    console.log('Registering slash commands…');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log('Commands registered ✅');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
