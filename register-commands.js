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
  .addStringOption(opt => opt.setName('entry').setDescription('Entry (free text number)').setRequired(true))
  .addStringOption(opt => opt.setName('sl').setDescription('SL (free text number)').setRequired(true))
  .addAttachmentOption(opt =>
    opt.setName('chart').setDescription('Attach chart image (optional)').setRequired(false)
  )
  .addStringOption(opt => opt.setName('tp1').setDescription('TP1 (optional)'))
  .addStringOption(opt => opt.setName('tp2').setDescription('TP2 (optional)'))
  .addStringOption(opt => opt.setName('tp3').setDescription('TP3 (optional)'))
  .addStringOption(opt => opt.setName('tp4').setDescription('TP4 (optional)'))
  .addStringOption(opt => opt.setName('tp5').setDescription('TP5 (optional)'))
  .addStringOption(opt => opt.setName('tp1_pct').setDescription('Planned % at TP1 (0–100)'))
  .addStringOption(opt => opt.setName('tp2_pct').setDescription('Planned % at TP2 (0–100)'))
  .addStringOption(opt => opt.setName('tp3_pct').setDescription('Planned % at TP3 (0–100)'))
  .addStringOption(opt => opt.setName('tp4_pct').setDescription('Planned % at TP4 (0–100)'))
  .addStringOption(opt => opt.setName('tp5_pct').setDescription('Planned % at TP5 (0–100)'))
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Open reason modal (optional)')
      .setRequired(false)
      .addChoices({ name: 'Fill via modal', value: 'modal' })
  )
  .addStringOption(opt => opt.setName('extra_role').setDescription('Extra role(s) to tag (IDs or @mentions)'))
  .addStringOption(opt =>
    opt.setName('risk')
      .setDescription('half | 1/4 | 3/4 (optional)')
      .setRequired(false)
      .addChoices(
        { name: 'half', value: 'half' },
        { name: '1/4',  value: '1/4' },
        { name: '3/4',  value: '3/4' },
      )
  )
  .addStringOption(opt =>
    opt.setName('be_at')
      .setDescription('Price to move SL → BE (optional)')
      .setRequired(false)
  );

/* /recap */
const recapCmd = new SlashCommandBuilder()
  .setName('recap')
  .setDescription('Show recap of trades.')
  .addStringOption(opt =>
    opt.setName('period')
      .setDescription('Recap type')
      .setRequired(true)
      .addChoices(
        { name: 'Monthly',     value: 'monthly' },
        { name: 'Weekly',      value: 'weekly'  },
        { name: 'Trade Recap', value: 'trade'   },
      )
  );
  .addStringOption(opt =>
    opt.setName('id')
      .setDescription('Signal ID to recap (autocomplete; ignored for trade picker)')
      .setRequired(false)
      .setAutocomplete(true)
  )
  // NEW: allow attaching a chart image directly on /recap
  .addAttachmentOption(opt =>
    opt.setName('chart')
      .setDescription('Attach chart image for the recap (optional)')
      .setRequired(false)
  );

/* /thread-restore */
const threadRestoreCmd = new SlashCommandBuilder()
  .setName('thread-restore')
  .setDescription('Restore a trade’s thread if it was deleted or archived')
  .addStringOption(opt =>
    opt.setName('trade')
      .setDescription('Pick a trade (autocomplete)')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption(opt =>
    opt.setName('mode')
      .setDescription('Post style in restored thread')
      .setRequired(false)
      .addChoices(
        { name: 'Recap embed', value: 'embed' },
        { name: 'Recap text',  value: 'text'  }
      )
  );

/* /signal-restore */
const signalRestoreCmd = new SlashCommandBuilder()
  .setName('signal-restore')
  .setDescription('Restore a soft-deleted trade signal')
  .addStringOption(opt =>
    opt.setName('id')
      .setDescription('Deleted signal ID (autocomplete)')
      .setRequired(true)
      .setAutocomplete(true)
  );

const commands = [pingCmd, signalCmd, recapCmd, threadRestoreCmd, signalRestoreCmd].map(c => c.toJSON());

async function main() {
  if (!token || !clientId || !guildId) {
    throw new Error('Missing token/clientId/guildId in config.js.');
  }
  const rest = new REST({ version: '10' }).setToken(token);

  console.log('🧹 Clearing global commands…');
  await rest.put(Routes.applicationCommands(clientId), { body: [] });

  console.log('🔧 Registering application commands (guild)…');
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
  console.log('✅ Successfully registered guild commands.');
}

main().catch(err => {
  console.error('❌ Failed to register commands:', err);
  process.exit(1);
});