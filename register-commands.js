// register-commands.js — Registers /ping, /signal, and recap commands

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

const { token, clientId, guildId } = config;

const ASSETS = ['BTC', 'ETH', 'SOL', 'OTHER'];

/** /ping */
const pingCmd = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Simple health check (owner only answers).');

/** /signal */
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
  .addStringOption(opt => opt.setName('entry').setDescription('Entry (free text number)').setRequired(true))
  .addStringOption(opt => opt.setName('sl').setDescription('SL (free text number)').setRequired(true))
  .addStringOption(opt => opt.setName('tp1').setDescription('TP1 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp2').setDescription('TP2 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp3').setDescription('TP3 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp4').setDescription('TP4 (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('tp5').setDescription('TP5 (optional)').setRequired(false))
  // planned percentages (optional)
  .addStringOption(opt => opt.setName('tp1_pct').setDescription('Planned % at TP1 (0–100)').setRequired(false))
  .addStringOption(opt => opt.setName('tp2_pct').setDescription('Planned % at TP2 (0–100)').setRequired(false))
  .addStringOption(opt => opt.setName('tp3_pct').setDescription('Planned % at TP3 (0–100)').setRequired(false))
  .addStringOption(opt => opt.setName('tp4_pct').setDescription('Planned % at TP4 (0–100)').setRequired(false))
  .addStringOption(opt => opt.setName('tp5_pct').setDescription('Planned % at TP5 (0–100)').setRequired(false))
  .addStringOption(opt => opt.setName('reason').setDescription('Reason (optional)').setRequired(false))
  .addStringOption(opt => opt.setName('extra_role').setDescription('Extra role(s) to tag (IDs or @mentions)').setRequired(false))
  // NEW: optional chart URL at creation
  .addStringOption(opt => opt.setName('chart_url').setDescription('Chart image URL (optional)').setRequired(false));

/** /recap-week — choose month & day (current year implied) */
const recapWeekCmd = new SlashCommandBuilder()
  .setName('recap-week')
  .setDescription('Post a weekly recap (7-day window starting at chosen date; current year).')
  .addIntegerOption(o =>
    o.setName('month').setDescription('Month (1–12)').setMinValue(1).setMaxValue(12).setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName('day').setDescription('Day of month (1–31)').setMinValue(1).setMaxValue(31).setRequired(true)
  );

/** /recap-month — choose month (current year implied) */
const recapMonthCmd = new SlashCommandBuilder()
  .setName('recap-month')
  .setDescription('Post a monthly recap (current year).')
  .addIntegerOption(o =>
    o.setName('month').setDescription('Month (1–12)').setMinValue(1).setMaxValue(12).setRequired(true)
  );

/** /recap-custom — choose start/end (month/day), year, and title */
const recapCustomCmd = new SlashCommandBuilder()
  .setName('recap-custom')
  .setDescription('Post a recap for a custom date range.')
  .addIntegerOption(o =>
    o.setName('start_month').setDescription('Start month (1–12)').setMinValue(1).setMaxValue(12).setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName('start_day').setDescription('Start day (1–31)').setMinValue(1).setMaxValue(31).setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName('end_month').setDescription('End month (1–12)').setMinValue(1).setMaxValue(12).setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName('end_day').setDescription('End day (1–31)').setMinValue(1).setMaxValue(31).setRequired(true)
  )
  .addIntegerOption(o =>
    o.setName('year').setDescription('Year (e.g., 2024)').setMinValue(2000).setMaxValue(2100).setRequired(true)
  )
  .addStringOption(o =>
    o.setName('title').setDescription('Custom title (e.g., "2024 Trades Recap")').setRequired(true)
  );

/** /recap-trade — no args; bot shows a selector of recent trades */
const recapTradeCmd = new SlashCommandBuilder()
  .setName('recap-trade')
  .setDescription('Post a recap for a specific trade (select from recent list).');

const commands = [
  pingCmd,
  signalCmd,
  recapWeekCmd,
  recapMonthCmd,
  recapCustomCmd,
  recapTradeCmd,
].map(c => c.toJSON());

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
