// register-commands.js
import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

// prefer config.js but allow env
const TOKEN    = config.token || process.env.DISCORD_TOKEN;
const APP_ID   = config.appId || process.env.APP_ID;       // your application (client) id
const GUILD_ID = config.guildId || process.env.GUILD_ID;   // the guild where you want to register

if (!TOKEN || !APP_ID || !GUILD_ID) {
  console.error('Missing TOKEN / APP_ID / GUILD_ID. Put them in config.js or env.');
  process.exit(1);
}

const commands = [];

/* --- keep your existing /signal definition registered elsewhere ---
   If you also register it here, that’s fine; duplicates just overwrite.
*/

/** Recap: week (choose a date via year/month/day pickers; optional end) */
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
      o.setName('end').setDescription('Optional end date YYYY-MM-DD (otherwise uses start + 6 days)')
    )
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
);

/** Recap: trade (single trade by id) */
commands.push(
  new SlashCommandBuilder()
    .setName('recap-trade')
    .setDescription('Post a recap for a specific trade ID.')
    .addStringOption(o =>
      o.setName('id').setDescription('The trade id (from your signal storage)').setRequired(true)
    )
);

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Refreshing application (/) commands…');
    await rest.put(
      Routes.applicationGuildCommands(APP_ID, GUILD_ID),
      { body: commands.map(c => c.toJSON()) }
    );
    console.log('Done ✅');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
