// register-commands.js
import 'dotenv/config';
import { REST, Routes } from '@discordjs/rest';
import {
  ApplicationCommandOptionType as Opt,
} from 'discord.js';

const TOKEN     = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID  = process.env.GUILD_ID;

const commands = [
  // keep your existing /signal definition as-is, just re-register together with /recap
  {
    name: 'signal',
    description: 'Create a new trade signal',
    options: [
      { name: 'asset',      description: 'Asset name or OTHER', type: Opt.String, required: true },
      { name: 'direction',  description: 'Long / Short', type: Opt.String, required: true, choices: [
        { name: 'Long',  value: 'Long'  },
        { name: 'Short', value: 'Short' },
      ]},
      { name: 'entry',      description: 'Entry price',   type: Opt.String, required: true },
      { name: 'sl',         description: 'Stop loss',      type: Opt.String, required: true },
      { name: 'tp1',        description: 'TP1 price',      type: Opt.String, required: false },
      { name: 'tp2',        description: 'TP2 price',      type: Opt.String, required: false },
      { name: 'tp3',        description: 'TP3 price',      type: Opt.String, required: false },
      { name: 'tp4',        description: 'TP4 price',      type: Opt.String, required: false },
      { name: 'tp5',        description: 'TP5 price',      type: Opt.String, required: false },
      { name: 'reason',     description: 'Reason (optional)', type: Opt.String, required: false },
      { name: 'extra_role', description: 'Extra role mention(s)', type: Opt.String, required: false },
      { name: 'tp1_pct',    description: 'Planned % at TP1', type: Opt.String, required: false },
      { name: 'tp2_pct',    description: 'Planned % at TP2', type: Opt.String, required: false },
      { name: 'tp3_pct',    description: 'Planned % at TP3', type: Opt.String, required: false },
      { name: 'tp4_pct',    description: 'Planned % at TP4', type: Opt.String, required: false },
      { name: 'tp5_pct',    description: 'Planned % at TP5', type: Opt.String, required: false },
    ],
  },

  // NEW: /recap custom
  {
    name: 'recap',
    description: 'Show trade recap(s)',
    options: [
      {
        type: Opt.Subcommand,
        name: 'custom',
        description: 'Recap closed trades in a custom date range (local time)',
        options: [
          { type: Opt.String, name: 'start', description: 'Start date YYYY-MM-DD', required: true },
          { type: Opt.String, name: 'end',   description: 'End date YYYY-MM-DD (inclusive)', required: true },
        ],
      },
    ],
  },
];

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function main() {
  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );
  console.log('✅ Slash commands registered.');
}

main().catch(console.error);
