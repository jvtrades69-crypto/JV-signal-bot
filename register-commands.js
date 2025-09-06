import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Health check'),

  new SlashCommandBuilder()
    .setName('signal')
    .setDescription('Create a new trade signal')
    .addStringOption(o =>
      o.setName('asset')
        .setDescription('Asset')
        .setRequired(true)
        .addChoices(
          { name: 'BTC', value: 'BTC' },
          { name: 'ETH', value: 'ETH' },
          { name: 'SOL', value: 'SOL' },
          { name: 'Other (type in modal)', value: 'OTHER' }
        )
    )
    .addStringOption(o =>
      o.setName('direction')
        .setDescription('Trade direction')
        .addChoices({ name: 'Long', value: 'LONG' }, { name: 'Short', value: 'SHORT' })
        .setRequired(true)
    )
    .addStringOption(o => o.setName('entry').setDescription('Entry price').setRequired(true))
    .addStringOption(o => o.setName('sl').setDescription('SL').setRequired(true))
    .addStringOption(o => o.setName('tp1').setDescription('TP1 (optional)'))
    .addStringOption(o => o.setName('tp2').setDescription('TP2 (optional)'))
    .addStringOption(o => o.setName('tp3').setDescription('TP3 (optional)'))
    .addStringOption(o => o.setName('reason').setDescription('Reason (optional, can be multiline)'))
    .addStringOption(o => o.setName('extra_role').setDescription('Extra role to tag (ID or @mention)'))
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