// register-commands.js
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

// Pull everything from config.js (which reads your env)
const TOKEN    = config.token;
const APP_ID   = config.appId;      // application (client) id
const GUILD_ID = config.guildId;    // guild to register in

if (!TOKEN || !APP_ID || !GUILD_ID) {
  console.error('Missing TOKEN / APP_ID / GUILD_ID. Check config.js/env.');
  process.exit(1);
}

const commands = [];

/** Recap: week (pick start by year/month/day; optional end YYYY-MM-DD) */
commands.push(
  new SlashCommandBuilder()
    .setName('recap-week')
    .setDescription('Post a weekly recap (7-day window starting at the chosen date).')
    .addIntegerOption(o =>
      o.setName('year').setDescription('Year (e.g., 2025)').setMinValue(2000).setMaxValue(2100)
    )
    .addIntegerOption(o =>
      o.setName('month').setDescription('Month (1-12)').setMinValue(1).setMaxValue(12)
    )
    .addIntegerOption(o =>
      o.setName('day').setDescription('Day of month (1-31)').setMinValue(1).setMaxValue(31)
    )
    .addStringOption(o =>
      o.setName('end').setDescription('Optional end date YYYY-MM-DD (otherwise start+6 days)')
    )
    .setDMPermission(false)
);

/** Recap: month (pick month & year) */
commands.push(
  new SlashCommandBuilder()
    .setName('recap-month')
    .setDescription('Post a monthly recap.')
    .addIntegerOption(o =>
      o.setName('month').setDescription('Month (1-12)').setMinValue(1).setMaxValue(12)
    )
    .addIntegerOption(o =>
      o.setName('year').setDescription('Year (e.g., 2025)').setMinValue(2000).setMaxValue(2100)
    )
    .setDMPermission(false)
);

/** Recap: trade (single trade by id) */
commands.push(
  new SlashCommandBuilder()
    .setName('recap-trade')
    .setDescription('Post a recap for a specific trade ID.')
    .addStringOption(o =>
      o.setName('id').setDescription('The trade id (from your signal storage)').setRequired(true)
    )
    .setDMPermission(false)
);

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Refreshing guild application (/) commands…');
    await rest.put(
      Routes.applicationGuildCommands(APP_ID, GUILD_ID),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('Done ✅');
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();