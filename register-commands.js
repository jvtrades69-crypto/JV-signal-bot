// register-commands.js — Registers /ping and /signal (with TP1–TP5)
// Run this once per deploy (or when you change command schema).

import { REST, Routes, SlashCommandBuilder } from 'discord.js';
import config from './config.js';

const {
  token,
  clientId,
  guildId,
  assetChoices = [
    'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'PEPE', 'OP', 'ARB', 'LINK', 'ADA', 'BNB', 'MATIC', 'APT', 'SUI', 'DOT', 'ATOM', 'AVAX', 'NEAR', 'RNDR', 'TIA', 'WIF', 'BONK', 'SEI', 'OTHER'
  ],
} = config;

// Ensure OTHER is present (users can type a custom asset via modal).
const uniqAssets = Array.from(new Set([...assetChoices.filter(Boolean).map(String)])).map(s => s.toUpperCase());
if (!uniqAssets.includes('OTHER')) uniqAssets.push('OTHER');

const pingCmd = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Simple health check (owner only answers).');

const signalCmd = new SlashCommandBuilder()
  .setName('signal')
  .setDescription('Create a trade signal (owner only).')
  .addStringOption(opt =>
    opt.setName('asset')
      .setDescription('Choose an asset (select OTHER to type a custom one).')
      .setRequired(true)
      .addChoices(...uniqAssets.map(a => ({ name: a, value: a })))
  )
  .addStringOption(opt =>
    opt.setName('direction')
      .setDescription('Trade direction')
      .setRequired(true)
      .addChoices(
        { name: 'Long', value: 'LONG' },
        { name: 'Short', value: 'SHORT' },
      )
  )
  .addStringOption(opt =>
    opt.setName('entry')
      .setDescription('Entry price (free text number)')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('sl')
      .setDescription('Stop loss (free text number)')
      .setRequired(true)
  )
  .addStringOption(opt =>
    opt.setName('tp1')
      .setDescription('TP1 (optional, free text number)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('tp2')
      .setDescription('TP2 (optional, free text number)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('tp3')
      .setDescription('TP3 (optional, free text number)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('tp4')
      .setDescription('TP4 (optional, free text number)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('tp5')
      .setDescription('TP5 (optional, free text number)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('reason')
      .setDescription('Reasoning (optional)')
      .setRequired(false)
  )
  .addStringOption(opt =>
    opt.setName('extra_role')
      .setDescription('Extra role mention (e.g., @VIP or role ID)')
      .setRequired(false)
  );

const commands = [pingCmd, signalCmd].map(c => c.toJSON());

async function main() {
  if (!token || !clientId || !guildId) {
    throw new Error('Missing token/clientId/guildId in config.js. Please set them before registering commands.');
  }

  const rest = new REST({ version: '10' }).setToken(token);

  console.log('🔧 Registering application commands (guild)...');
  try {
    await rest.put(
      Routes.applicationGuildCommands(clientId, guildId),
      { body: commands }
    );
    console.log('✅ Successfully registered guild commands.');
  } catch (err) {
    console.error('❌ Failed to register commands:', err);
    process.exit(1);
  }
}

main();
