// register-commands.js — Registers /ping, /signal, and /recap

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

const { token, clientId, guildId } = config;

const ASSETS = ['BTC', 'ETH', 'SOL', 'OTHER'];

const pingCmd = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Simple health check (owner only answers).');

const signalCmd = new SlashCommandBuilder()
  .setName('signal')
  .setDescription('Create a new trade signal.')
  .addStringOption(opt =>
    opt.setName('asset').setDescription('Asset').setRequired(true)
      .addChoices(...ASSETS.map(a => ({ name: a, value: a })))
  )
  .addStringOption(opt =>
    opt.setName('direction').setDescription('Trade direction').setRequired(true)
      .addChoices({ name: 'Long', value: 'LONG' }, { name: 'Short', value: 'SHORT' })
  )
  .addStringOption(opt => opt.setName('entry').setDescription('Entry (number)').setRequired(true))
  .addStringOption(opt => opt.setName('sl').setDescription('Stop Loss (number)').setRequired(true))
  .addStringOption(opt => opt.setName('tp1').setDescription('TP1 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp2').setDescription('TP2 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp3').setDescription('TP3 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp4').setDescription('TP4 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp5').setDescription('TP5 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp1_pct').setDescription('Planned % at TP1').setRequired(false))
  .addStringOption(opt => opt.setName('tp2_pct').setDescription('Planned % at TP2').setRequired(false))
  .addStringOption(opt => opt.setName('tp3_pct').setDescription('Planned % at TP3').setRequired(false))
  .addStringOption(opt => opt.setName('tp4_pct').setDescription('Planned % at TP4').setRequired(false))
  .addStringOption(opt => opt.setName('tp5_pct').setDescription('Planned % at TP5').setRequired(false))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('extra_role').setDescription('Extra role(s) to tag').setRequired(false));

const recapCmd = new SlashCommandBuilder()
  .setName('recap')
  .setDescription('Generate a trade recap (weekly or monthly).')
  .addSubcommand(sub =>
    sub.setName('weekly').setDescription('Generate the weekly recap.')
  )
  .addSubcommand(sub =>
    sub.setName('monthly').setDescription('Generate the monthly recap.')
  );

const commands = [pingCmd, signalCmd, recapCmd].map(c => c.toJSON());

async function main() {
  if (!token || !clientId || !guildId) {
    throw new Error('Missing token/clientId/guildId in config.js.');
  }
  const rest = new REST({ version: '10' }).setToken(token);
  console.log('🔧 Registering application commands…');
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('✅ Successfully registered commands.');
}

main().catch(err => {
  console.error('❌ Failed to register commands:', err);
  process.exit(1);
});
