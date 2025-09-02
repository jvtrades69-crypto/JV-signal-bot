const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

if (!config.token || !config.clientId || !config.guildId) {
  console.error('[ERROR] Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID in .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('signal')
    .setDescription('Post a new trade signal in this channel')
    .addStringOption(o => o.setName('asset').setDescription('Asset ticker, e.g., BTC / ETH / SOL').setRequired(true))
    .addStringOption(o => o.setName('side').setDescription('Long or Short').setRequired(true).addChoices(
      { name: 'Long', value: 'LONG' },
      { name: 'Short', value: 'SHORT' },
    ))
    .addStringOption(o => o.setName('entry').setDescription('Entry (number or range)').setRequired(true))
    .addStringOption(o => o.setName('sl').setDescription('SL').setRequired(false))
    .addStringOption(o => o.setName('tp1').setDescription('Target 1').setRequired(false))
    .addStringOption(o => o.setName('tp2').setDescription('Target 2').setRequired(false))
    .addStringOption(o => o.setName('tp3').setDescription('Target 3').setRequired(false))
    .addStringOption(o => o.setName('timeframe').setDescription('Timeframe (e.g., 1H, 4H)').setRequired(false))
    .addStringOption(o => o.setName('reason').setDescription('Short rationale (<= 1000 chars)').setRequired(false))
    .addAttachmentOption(o => o.setName('image').setDescription('Chart image').setRequired(false))
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(config.token);

(async () => {
  try {
    console.log('Registering guild commands…');
    await rest.put(
      Routes.applicationGuildCommands(config.clientId, config.guildId),
      { body: commands }
    );
    console.log('Done. Slash commands are live.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
