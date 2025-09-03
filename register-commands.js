// register-commands.js
require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('signal')
    .setDescription('Open the signal creator (asset, side, then form).')
    .toJSON(),
];

(async () => {
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    // guild-scoped for instant availability
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Slash command registered.');
  } catch (e) {
    console.error('Failed to register slash command:', e);
    process.exit(1);
  }
})();
