// register-commands.js
// Registers /signal plus the recap commands (trade/week/month).

import { Routes, ApplicationCommandOptionType } from 'discord.js';
import { REST } from '@discordjs/rest';
import config from './config.js';

// sanity checks
if (!config.token || !config.clientId || !config.guildId) {
  console.error('Missing token/clientId/guildId in config.js');
  process.exit(1);
}

const commands = [
  // --- existing /signal (kept minimal here; adjust types to your current index.js) ---
  {
    name: 'signal',
    description: 'Create a new trade signal',
    options: [
      {
        name: 'asset',
        description: 'BTC/ETH/SOL or select OTHER to type a custom asset',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'BTC', value: 'BTC' },
          { name: 'ETH', value: 'ETH' },
          { name: 'SOL', value: 'SOL' },
          { name: 'OTHER', value: 'OTHER' },
        ],
      },
      {
        name: 'direction',
        description: 'LONG or SHORT',
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: [
          { name: 'LONG', value: 'LONG' },
          { name: 'SHORT', value: 'SHORT' },
        ],
      },
      { name: 'entry', description: 'Entry price', type: ApplicationCommandOptionType.String, required: true },
      { name: 'sl',    description: 'Stop loss',   type: ApplicationCommandOptionType.String, required: true },
      { name: 'tp1',   description: 'TP1 price',   type: ApplicationCommandOptionType.String, required: false },
      { name: 'tp2',   description: 'TP2 price',   type: ApplicationCommandOptionType.String, required: false },
      { name: 'tp3',   description: 'TP3 price',   type: ApplicationCommandOptionType.String, required: false },
      { name: 'tp4',   description: 'TP4 price',   type: ApplicationCommandOptionType.String, required: false },
      { name: 'tp5',   description: 'TP5 price',   type: ApplicationCommandOptionType.String, required: false },
      { name: 'reason', description: 'Reasoning (optional)', type: ApplicationCommandOptionType.String, required: false },

      // optional planned close %
      { name: 'tp1_pct', description: 'Planned % at TP1 (0-100)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'tp2_pct', description: 'Planned % at TP2 (0-100)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'tp3_pct', description: 'Planned % at TP3 (0-100)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'tp4_pct', description: 'Planned % at TP4 (0-100)', type: ApplicationCommandOptionType.String, required: false },
      { name: 'tp5_pct', description: 'Planned % at TP5 (0-100)', type: ApplicationCommandOptionType.String, required: false },

      // role mentions string (IDs or @mentions)
      { name: 'extra_role', description: 'Extra role mention(s)', type: ApplicationCommandOptionType.String, required: false },
    ],
  },

  // --- recap: single trade ---
  {
    name: 'recap-trade',
    description: 'Show recap for a specific trade ID',
    options: [
      {
        name: 'id',
        description: 'Trade ID (the short or full ID you stored)',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },

  // --- recap: weekly ---
  {
    name: 'recap-week',
    description: 'Post a weekly recap',
    options: [
      {
        name: 'start',
        description: 'Start label (e.g., Sep 8)',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
      {
        name: 'end',
        description: 'End label (e.g., Sep 14)',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },

  // --- recap: monthly ---
  {
    name: 'recap-month',
    description: 'Post a monthly recap',
    options: [
      {
        name: 'month',
        description: 'Month label (e.g., September 2025)',
        type: ApplicationCommandOptionType.String,
        required: true,
      },
    ],
  },
];

async function main() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  console.log('Registering application (guild) commands…');
  await rest.put(
    Routes.applicationGuildCommands(config.clientId, config.guildId),
    { body: commands }
  );
  console.log('✅ Commands registered.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
