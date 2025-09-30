// register-commands.js — Registers /ping, /signal, /recap, /thread-restore, /signal-restore

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

const { token, clientId, guildId } = config;

const ASSETS = ['BTC', 'ETH', 'SOL', 'OTHER'];

/* /ping */
const pingCmd = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Simple health check (owner only answers).');

/* /signal */
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
  .addStringOption(opt => opt.setName('entry').setDescription('Entry').setRequired(true))
  .addStringOption(opt => opt.setName('sl').setDescription('SL').setRequired(true))
  .addAttachmentOption(opt => opt.setName('chart').setDescription('Attach chart image').setRequired(false))
  .addStringOption(opt => opt.setName('tp1').setDescription('TP1'))
  .addStringOption(opt => opt.setName('tp2').setDescription('TP2'))
  .addStringOption(opt => opt.setName('tp3').setDescription('TP3'))
  .addStringOption(opt => opt.setName('tp4').setDescription('TP4'))
  .addStringOption(opt => opt.setName('tp5').setDescription('TP5'))
  .addStringOption(opt => opt.setName('tp1_pct').setDescription('Planned % at TP1 (0–100)'))
  .addStringOption(opt => opt.setName('tp2_pct').setDescription('Planned % at TP2 (0–100)'))
  .addStringOption(opt => opt.setName('tp3_pct').setDescription('Planned % at TP3 (0–100)'))
  .addStringOption(opt => opt.setName('tp4_pct').setDescription('Planned % at TP4 (0–100)'))
  .addStringOption(opt => opt.setName('tp5_pct').setDescription('Planned % at TP5 (0–100)'))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason (optional)'))
  .addStringOption(opt => opt.setName('extra_role').setDescription('Extra role(s) to tag (IDs or @mentions)'));

/* /recap */
const recapCmd = new SlashCommandBuilder()
  .setName('recap')
  .setDescription('Show recap of trades.')
  .addStringOption(opt =>
    opt.setName('period')
      .setDescription('Recap period')
      .setRequired(false)
      .addChoices({ name: 'Monthly', value: 'monthly' })
  )
  .addStringOption(opt =>
    opt.setName('id')
      .setDescription('Signal ID to recap (autocomplete)')
      .setRequired(false)
      .setAutocomplete(true)
  );

/* /thread-restore */
const threadRestoreCmd = new SlashCommandBuilder()
  .setName('thread-restore')
  .setDescription('Restore the private control thread for an existing live signal')
  .addStringOption(opt =>
    opt.setName('id')
      .setDescription('Signal ID (autocomplete)')
      .setRequired(true)
      .setAutocomplete(true)
  );

/* /signal-restore — restore soft-deleted signal first */
const signalRestoreCmd = new SlashCommandBuilder()
  .setName('signal-restore')
  .setDescription('Restore a soft-deleted signal (then you can restore its thread)')
  .addStringOption(opt =>
    opt.setName('id')
      .setDescription('Deleted signal id (autocomplete)')
      .setRequired(true)
      .setAutocomplete(true)
  );

const commands = [pingCmd, signalCmd, recapCmd, threadRestoreCmd, signalRestoreCmd].map(c => c.toJSON());

async function main() {
  if (!token || !clientId || !guildId) {
    throw new Error('Missing token/clientId/guildId in config.js.');
  }
  const rest = new REST({ version: '10' }).setToken(token);
  console.log('🔧 Registering application commands (guild)…');
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('✅ Successfully registered guild commands.');
}

main().catch(err => {
  console.error('❌ Failed to register commands:', err);
  process.exit(1);
});
