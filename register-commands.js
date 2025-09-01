const { REST, Routes, SlashCommandBuilder, ChannelType } = require('discord.js');
const { config } = require('dotenv');
config();

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID in .env');
  process.exit(1);
}

const pctChoices = [
  { name: '25%', value: 25 },
  { name: '33%', value: 33 },
  { name: '50%', value: 50 },
  { name: '75%', value: 75 },
  { name: '100% (final)', value: 100 }
];

const statusChoices = [
  { name: 'Active', value: 'Active' },
  { name: 'Running', value: 'Running' },
  { name: 'BE (Break-even)', value: 'BE' },
  { name: 'Invalid', value: 'Invalid' },
  { name: 'Closed', value: 'Closed' }
];

const resultChoices = [
  { name: 'Win', value: 'Win' },
  { name: 'Loss', value: 'Loss' },
  { name: 'Breakeven', value: 'Breakeven' },
  { name: 'Manual Close', value: 'Manual Close' }
];

const commands = [
  // AUTO: caption + image (OCR fallback)
  new SlashCommandBuilder()
    .setName('signal-auto')
    .setDescription('Post a signal by parsing a caption and/or chart image (OCR beta).')
    .addAttachmentOption(o => o.setName('image').setDescription('Chart screenshot (recommended)'))
    .addStringOption(o => o.setName('caption').setDescription('e.g., ETH | LONG entry 2520 sl 2433 tp1 2656@50'))
    .addStringOption(o => o.setName('timeframe').setDescription('15m / 1H / 4H (optional)'))
    .addNumberOption(o => o.setName('risk').setDescription('Risk % (optional)'))
    .addStringOption(o => o.setName('reason').setDescription('Reason for setup (optional)'))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to post into').addChannelTypes(ChannelType.GuildText))
    .toJSON(),

  // UPDATE: change anything (including image)
  new SlashCommandBuilder()
    .setName('signal-update')
    .setDescription('Update an existing signal by ID or message link.')
    .addStringOption(o => o.setName('id').setDescription('Signal ID (from your ephemeral reply, optional)'))
    .addStringOption(o => o.setName('message_link').setDescription('Link to the signal message (optional)'))
    .addStringOption(o => o.setName('asset').setDescription('BTC / ETH / SOL').addChoices(
      { name: 'BTC', value: 'btc' },
      { name: 'ETH', value: 'eth' },
      { name: 'SOL', value: 'sol' }
    ))
    .addStringOption(o => o.setName('direction').setDescription('long or short').addChoices(
      { name: 'Long', value: 'long' },
      { name: 'Short', value: 'short' }
    ))
    .addStringOption(o => o.setName('timeframe').setDescription('15m / 1H / 4H'))
    .addStringOption(o => o.setName('entry').setDescription('Entry'))
    .addStringOption(o => o.setName('sl').setDescription('Stop loss'))
    .addStringOption(o => o.setName('tp1').setDescription('TP1'))
    .addNumberOption(o => o.setName('tp1_close_pct').setDescription('TP1 close %').addChoices(...pctChoices))
    .addStringOption(o => o.setName('tp2').setDescription('TP2'))
    .addNumberOption(o => o.setName('tp2_close_pct').setDescription('TP2 close %').addChoices(...pctChoices))
    .addStringOption(o => o.setName('tp3').setDescription('TP3'))
    .addNumberOption(o => o.setName('tp3_close_pct').setDescription('TP3 close %').addChoices(...pctChoices))
    .addNumberOption(o => o.setName('risk').setDescription('Risk %'))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .addAttachmentOption(o => o.setName('image').setDescription('New chart image'))
    .addStringOption(o => o.setName('status').setDescription('Status').addChoices(...statusChoices))
    .addStringOption(o => o.setName('result').setDescription('If closing, result').addChoices(...resultChoices))
    .addNumberOption(o => o.setName('r').setDescription('If closing, R multiple e.g., 2.0'))
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
