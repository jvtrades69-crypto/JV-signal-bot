// register-commands.js — reset and add guild commands only (required options first)
import { REST, Routes, SlashCommandBuilder, ChannelType } from 'discord.js';
import 'dotenv/config';

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error('Missing DISCORD_TOKEN / CLIENT_ID / GUILD_ID'); process.exit(1);
}
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

const pct = [
  { name: '25%', value: 25 }, { name: '33%', value: 33 },
  { name: '50%', value: 50 }, { name: '75%', value: 75 },
  { name: '100% (final)', value: 100 },
];
const status = [
  { name: 'Active', value: 'Active' },
  { name: 'Running', value: 'Running' },
  { name: 'BE (Break-even)', value: 'BE' },
  { name: 'Invalid', value: 'Invalid' },
  { name: 'Closed', value: 'Closed' },
];
const result = [
  { name: 'Win', value: 'Win' },
  { name: 'Loss', value: 'Loss' },
  { name: 'Breakeven', value: 'Breakeven' },
  { name: 'Manual Close', value: 'Manual Close' },
];

const guildCommands = [
  // /signal — REQUIRED first, then OPTIONAL
  new SlashCommandBuilder()
    .setName('signal')
    .setDescription('Post a trading signal (manual fill).')
    // REQUIRED — must be first:
    .addStringOption(o => o.setName('asset').setDescription('BTC / ETH / SOL').setRequired(true).addChoices(
      { name: 'BTC', value: 'btc' }, { name: 'ETH', value: 'eth' }, { name: 'SOL', value: 'sol' }
    ))
    .addStringOption(o => o.setName('direction').setDescription('long or short').setRequired(true).addChoices(
      { name: 'Long', value: 'long' }, { name: 'Short', value: 'short' }
    ))
    .addStringOption(o => o.setName('entry').setDescription('Entry').setRequired(true))
    .addStringOption(o => o.setName('sl').setDescription('Stop loss').setRequired(true))
    .addAttachmentOption(o => o.setName('image').setDescription('Chart image').setRequired(true))
    // OPTIONAL — after all required:
    .addStringOption(o => o.setName('timeframe').setDescription('15m / 1H / 4H (optional)'))
    .addStringOption(o => o.setName('tp1').setDescription('TP1 (optional)'))
    .addNumberOption(o => o.setName('tp1_close_pct').setDescription('TP1 close %').addChoices(...pct))
    .addStringOption(o => o.setName('tp2').setDescription('TP2 (optional)'))
    .addNumberOption(o => o.setName('tp2_close_pct').setDescription('TP2 close %').addChoices(...pct))
    .addStringOption(o => o.setName('tp3').setDescription('TP3 (optional)'))
    .addNumberOption(o => o.setName('tp3_close_pct').setDescription('TP3 close %').addChoices(...pct))
    .addNumberOption(o => o.setName('risk').setDescription('Risk % (optional)'))
    .addStringOption(o => o.setName('reason').setDescription('Reason (optional)'))
    .addChannelOption(o => o.setName('channel').setDescription('Channel to post into').addChannelTypes(ChannelType.GuildText))
    .toJSON(),

  // /signal-update — all optional, order doesn’t matter but we keep it tidy
  new SlashCommandBuilder()
    .setName('signal-update')
    .setDescription('Update an existing signal by ID or message link.')
    .addStringOption(o => o.setName('id').setDescription('Signal ID (from private reply)'))
    .addStringOption(o => o.setName('message_link').setDescription('Link to the signal message'))
    .addStringOption(o => o.setName('asset').setDescription('BTC / ETH / SOL').addChoices(
      { name: 'BTC', value: 'btc' }, { name: 'ETH', value: 'eth' }, { name: 'SOL', value: 'sol' }
    ))
    .addStringOption(o => o.setName('direction').setDescription('long or short').addChoices(
      { name: 'Long', value: 'long' }, { name: 'Short', value: 'short' }
    ))
    .addStringOption(o => o.setName('timeframe').setDescription('15m / 1H / 4H'))
    .addStringOption(o => o.setName('entry').setDescription('Entry'))
    .addStringOption(o => o.setName('sl').setDescription('Stop loss'))
    .addStringOption(o => o.setName('tp1').setDescription('TP1'))
    .addNumberOption(o => o.setName('tp1_close_pct').setDescription('TP1 close %').addChoices(...pct))
    .addStringOption(o => o.setName('tp2').setDescription('TP2'))
    .addNumberOption(o => o.setName('tp2_close_pct').setDescription('TP2 close %').addChoices(...pct))
    .addStringOption(o => o.setName('tp3').setDescription('TP3'))
    .addNumberOption(o => o.setName('tp3_close_pct').setDescription('TP3 close %').addChoices(...pct))
    .addNumberOption(o => o.setName('risk').setDescription('Risk %'))
    .addStringOption(o => o.setName('reason').setDescription('Reason'))
    .addAttachmentOption(o => o.setName('image').setDescription('Replace chart image'))
    .addStringOption(o => o.setName('status').setDescription('Status').addChoices(...status))
    .addStringOption(o => o.setName('result').setDescription('If closing, result').addChoices(...result))
    .addNumberOption(o => o.setName('r').setDescription('If closing, R multiple e.g., 2.0'))
    .toJSON()
];

(async () => {
  try {
    console.log('CLIENT_ID:', CLIENT_ID);
    console.log('GUILD_ID :', GUILD_ID);

    const globalBefore = await rest.get(Routes.applicationCommands(CLIENT_ID));
    const guildBefore  = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
    console.log('Global BEFORE:', globalBefore.map(c => c.name));
    console.log('Guild  BEFORE:', guildBefore.map(c => c.name));

    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
    console.log('Cleared all global + guild commands');

    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: guildCommands });
    console.log('Re-registered /signal and /signal-update (guild)');

    const globalAfter = await rest.get(Routes.applicationCommands(CLIENT_ID));
    const guildAfter  = await rest.get(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID));
    console.log('Global AFTER:', globalAfter.map(c => c.name));
    console.log('Guild  AFTER:', guildAfter.map(c => c.name));
    console.log('✅ Done');
  } catch (e) {
    console.error('Registrar error:', e);
    process.exit(1);
  }
})();
