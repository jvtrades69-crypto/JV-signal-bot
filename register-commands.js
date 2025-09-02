const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const config = require('./config');

if (!config.token || !config.clientId || !config.guildId) {
  console.error('[ERROR] Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID in .env');
  process.exit(1);
}

const commands = [
  new SlashCommandBuilder()
    .setName('signal')
    .setDescription('Open the JV signal form to post a trade in this channel')
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
