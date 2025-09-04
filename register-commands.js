import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

// Define /signal
const commands = [
  new SlashCommandBuilder()
    .setName('signal')
    .setDescription('Create a new trade signal')
    .addStringOption(o => o.setName('asset').setDescription('Asset (BTC, ETH, SOL...)').setRequired(true))
    .addStringOption(o =>
      o.setName('direction')
       .setDescription('Long or Short')
       .addChoices({ name: 'Long', value: 'LONG' }, { name: 'Short', value: 'SHORT' })
       .setRequired(true)
    )
    .addStringOption(o => o.setName('entry').setDescription('Entry price').setRequired(true))
    .addStringOption(o => o.setName('sl').setDescription('Stop Loss').setRequired(true))
    .addStringOption(o => o.setName('tp1').setDescription('TP1'))
    .addStringOption(o => o.setName('tp2').setDescription('TP2'))
    .addStringOption(o => o.setName('tp3').setDescription('TP3'))
    .addStringOption(o => o.setName('reason').setDescription('Reason for trade')),
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(config.appId, config.guildId),
    { body: commands }
  );
  console.log('✅ Slash commands registered');
}

main().catch(err => {
  console.error('Failed to register commands:', err);
  process.exit(1);
});
