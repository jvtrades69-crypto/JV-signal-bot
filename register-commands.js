// register-commands.js — add /signal and /recap for your guild
import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN/CLIENT_ID/GUILD_ID env vars.');
  process.exit(1);
}

const commands = [
  {
    name: 'signal',
    description: 'Create a new trade signal',
    dm_permission: false,
    default_member_permissions: '0', // owner-only gate in code as well
    options: [
      {
        name: 'asset',
        description: 'BTC / ETH / SOL / OTHER',
        type: 3,
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
        description: 'Direction',
        type: 3,
        required: true,
        choices: [
          { name: 'LONG', value: 'LONG' },
          { name: 'SHORT', value: 'SHORT' },
        ],
      },
      { name: 'entry', description: 'Entry price', type: 3, required: true },
      { name: 'sl', description: 'Stop loss', type: 3, required: true },
      { name: 'tp1', description: 'TP1', type: 3, required: false },
      { name: 'tp2', description: 'TP2', type: 3, required: false },
      { name: 'tp3', description: 'TP3', type: 3, required: false },
      { name: 'tp4', description: 'TP4', type: 3, required: false },
      { name: 'tp5', description: 'TP5', type: 3, required: false },
      { name: 'reason', description: 'Reason (optional)', type: 3, required: false },
      { name: 'extra_role', description: 'Extra role mention(s) text', type: 3, required: false },
      { name: 'tp1_pct', description: 'Planned % at TP1', type: 3, required: false },
      { name: 'tp2_pct', description: 'Planned % at TP2', type: 3, required: false },
      { name: 'tp3_pct', description: 'Planned % at TP3', type: 3, required: false },
      { name: 'tp4_pct', description: 'Planned % at TP4', type: 3, required: false },
      { name: 'tp5_pct', description: 'Planned % at TP5', type: 3, required: false },
    ],
  },

  {
    name: 'recap',
    description: 'Post a recap summary (weekly / monthly / custom)',
    dm_permission: false,
    default_member_permissions: '0', // owner-only gate in code as well
    options: [
      {
        name: 'period',
        description: 'Time window',
        type: 3,
        required: false,
        choices: [
          { name: 'week (previous Mon–Sun)', value: 'week' },
          { name: 'month (previous calendar month)', value: 'month' },
          { name: 'custom (use from/to)', value: 'custom' },
        ],
      },
      { name: 'from', description: 'YYYY-MM-DD (custom only)', type: 3, required: false },
      { name: 'to', description: 'YYYY-MM-DD (custom only)', type: 3, required: false },
      { name: 'asset', description: 'Filter by asset (e.g., BTC)', type: 3, required: false },
      {
        name: 'format',
        description: 'Output detail',
        type: 3,
        required: false,
        choices: [
          { name: 'summary', value: 'summary' },
          { name: 'full (adds per-trade lines)', value: 'full' },
        ],
      },
    ],
  },
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Registering application (guild) commands...');
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('✅ Commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
<<<<<<< HEAD
})();
=======
})();
>>>>>>> 3c87fe3eda9c5df9a42ee048d64673e58c109994
