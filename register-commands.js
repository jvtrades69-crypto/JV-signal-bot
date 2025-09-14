// register-commands.js
// Registers: /signal, /recap-week, /recap-month, /recap-trade

import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

// ---- helpers
const months = [
  ['January', 1], ['February', 2], ['March', 3], ['April', 4],
  ['May', 5], ['June', 6], ['July', 7], ['August', 8],
  ['September', 9], ['October', 10], ['November', 11], ['December', 12],
];

// ---- /signal (kept aligned with index.js expectations)
const signalCmd = new SlashCommandBuilder()
  .setName('signal')
  .setDescription('Post a JV trade signal')
  .addStringOption(opt =>
    opt.setName('asset')
      .setDescription('Asset (BTC/ETH/SOL or OTHER)')
      .setRequired(true)
      .addChoices(
        { name: 'BTC', value: 'BTC' },
        { name: 'ETH', value: 'ETH' },
        { name: 'SOL', value: 'SOL' },
        { name: 'OTHER', value: 'OTHER' },
      )
  )
  .addStringOption(opt =>
    opt.setName('direction')
      .setDescription('Direction')
      .setRequired(true)
      .addChoices(
        { name: 'LONG', value: 'LONG' },
        { name: 'SHORT', value: 'SHORT' },
      )
  )
  .addStringOption(o => o.setName('entry').setDescription('Entry price').setRequired(true))
  .addStringOption(o => o.setName('sl').setDescription('Stop loss').setRequired(true))
  .addStringOption(o => o.setName('tp1').setDescription('TP1').setRequired(false))
  .addStringOption(o => o.setName('tp2').setDescription('TP2').setRequired(false))
  .addStringOption(o => o.setName('tp3').setDescription('TP3').setRequired(false))
  .addStringOption(o => o.setName('tp4').setDescription('TP4').setRequired(false))
  .addStringOption(o => o.setName('tp5').setDescription('TP5').setRequired(false))
  .addStringOption(o => o.setName('tp1_pct').setDescription('Planned % at TP1 (0-100)').setRequired(false))
  .addStringOption(o => o.setName('tp2_pct').setDescription('Planned % at TP2 (0-100)').setRequired(false))
  .addStringOption(o => o.setName('tp3_pct').setDescription('Planned % at TP3 (0-100)').setRequired(false))
  .addStringOption(o => o.setName('tp4_pct').setDescription('Planned % at TP4 (0-100)').setRequired(false))
  .addStringOption(o => o.setName('tp5_pct').setDescription('Planned % at TP5 (0-100)').setRequired(false))
  .addStringOption(o => o.setName('reason').setDescription('Reason (optional)').setRequired(false))
  .addStringOption(o => o.setName('extra_role').setDescription('Extra role mention(s) (IDs or @mentions)').setRequired(false));

// ---- /recap-week (lets you pick dates without typing via choices or you can still type)
// You can either type YYYY-MM-DD, or pick from the quick-pick choices here.
const quickWeeks = [
  // name, [start, end] (YYYY-MM-DD)
  ['This Week (Mon–Sun)', 'this'],
  ['Last 7 Days', 'last7'],
  ['Last Week (Mon–Sun)', 'lastweek'],
];

const recapWeekCmd = new SlashCommandBuilder()
  .setName('recap-week')
  .setDescription('Weekly recap over a date range')
  .addStringOption(o =>
    o.setName('start')
      .setDescription('Start date (YYYY-MM-DD) — or pick a quick range in "range"')
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName('end')
      .setDescription('End date (YYYY-MM-DD)')
      .setRequired(false)
  )
  .addStringOption(o =>
    o.setName('range')
      .setDescription('Quick pick range (optional)')
      .setRequired(false)
      .addChoices(
        ...quickWeeks.map(([name, val]) => ({ name, value: val }))
      )
  );

// ---- /recap-month (selectable month + year)
const now = new Date();
const thisYear = now.getUTCFullYear();
const recapMonthCmd = new SlashCommandBuilder()
  .setName('recap-month')
  .setDescription('Monthly recap for a given month/year')
  .addIntegerOption(o =>
    o.setName('month')
      .setDescription('Month')
      .setRequired(false)
      .addChoices(...months.map(([name, num]) => ({ name, value: num })))
  )
  .addIntegerOption(o =>
    o.setName('year')
      .setDescription('Year')
      .setRequired(false)
      .setMinValue(2000)
      .setMaxValue(2100)
      .setChoices(
        { name: String(thisYear - 2), value: thisYear - 2 },
        { name: String(thisYear - 1), value: thisYear - 1 },
        { name: String(thisYear),     value: thisYear     },
        { name: String(thisYear + 1), value: thisYear + 1 },
      )
  );

// ---- /recap-trade (ID string for now; selection menu is handled in index if you add it later)
const recapTradeCmd = new SlashCommandBuilder()
  .setName('recap-trade')
  .setDescription('Per-trade recap')
  .addStringOption(o =>
    o.setName('id')
      .setDescription('Trade ID (from the message link or DB)')
      .setRequired(true)
  );

// ---- push
const commands = [
  signalCmd,
  recapWeekCmd,
  recapMonthCmd,
  recapTradeCmd,
].map(c => c.toJSON());

async function main() {
  const rest = new REST({ version: '10' }).setToken(config.token);
  // Register as guild commands for faster updates during development
  await rest.put(
    Routes.applicationGuildCommands(config.applicationId, config.guildId),
    { body: commands }
  );
  console.log('✅ Slash commands registered.');
}

main().catch(err => {
  console.error('Failed to register commands:', err);
  process.exit(1);
});
