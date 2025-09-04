import {
  Client,
  GatewayIntentBits,
  Routes,
  REST,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config.js';
import {
  renderSignalEmbed,
  renderSummaryEmbed,
  titleCaseDir,
} from './embeds.js';
import {
  saveSignal,
  listActive,
  getSummaryMessageId,
  setSummaryMessageId,
} from './store.js';

// ---------- Robust logging (NO exits) ----------
process.on('unhandledRejection', (e) => {
  console.error('[UNHANDLED REJECTION]', e);
});
process.on('uncaughtException', (e) => {
  console.error('[UNCAUGHT EXCEPTION]', e);
});

// Keepalive heartbeat so the worker never looks idle
setInterval(() => console.log('[HEARTBEAT] alive'), 60_000);

console.log('[BOOT] starting… node=%s', process.version);
console.log('[BOOT] guildId=%s, appId=%s', config.guildId, config.appId);

// Only what we need: Guilds
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---- Slash commands (required options FIRST) ----
const commands = [
  {
    name: 'signal',
    description: 'Create a new trade signal',
    // String is required by API for default_member_permissions
    default_member_permissions: String(PermissionFlagsBits.SendMessages),
    dm_permission: false,
    options: [
      { name: 'asset', description: 'Asset symbol (e.g. BTC)', type: 3, required: true },
      { name: 'direction', description: 'long or short', type: 3, required: true, choices: [
        { name: 'Long', value: 'long' }, { name: 'Short', value: 'short' }
      ]},
      { name: 'entry', description: 'Entry price', type: 3, required: true },
      { name: 'sl', description: 'Stop loss', type: 3, required: true },

      { name: 'tp1', description: 'Take profit 1', type: 3, required: false },
      { name: 'tp2', description: 'Take profit 2', type: 3, required: false },
      { name: 'tp3', description: 'Take profit 3', type: 3, required: false },
      { name: 'reason', description: 'Reasoning (optional)', type: 3, required: false },
      { name: 'valid_reentry', description: 'Valid for re-entry? (Yes/No)', type: 3, required: false, choices: [
        { name: 'Yes', value: 'Yes' }, { name: 'No', value: 'No' }
      ]},
      { name: 'mention_role', description: 'Role ID to mention (optional)', type: 3, required: false }
    ]
  }
];

async function registerCommands() {
  try {
    console.log('[REG] registering commands…');
    const rest = new REST({ version: '10' }).setToken(config.token);
    const res = await rest.put(
      Routes.applicationGuildCommands(config.appId, config.guildId),
      { body: commands }
    );
    console.log('[REG] registered (%s commands).', Array.isArray(res) ? res.length : '?');
  } catch (e) {
    // Do NOT exit — just log the precise API complaint
    console.error('[REG] failed:', e?.rawError ?? e?.data ?? e?.message ?? e);
  }
}

async function upsertSummary() {
  try {
    const channel = await client.channels.fetch(config.currentTradesChannelId);
    if (!channel) return console.error('[SUMMARY] currentTradesChannel not found');

    const trades = await listActive();
    const embed = renderSummaryEmbed(trades, 'JV Current Active Trades 📊');

    const existingId = await getSummaryMessageId();
    if (existingId) {
      try {
        const msg = await channel.messages.fetch(existingId);
        await msg.edit({ embeds: [embed] });
        console.log('[SUMMARY] updated');
        return;
      } catch {
        console.log('[SUMMARY] prior message missing, sending new');
      }
    }
    const newMsg = await channel.send({ embeds: [embed] });
    await setSummaryMessageId(newMsg.id);
    console.log('[SUMMARY] sent new');
  } catch (e) {
    console.error('[SUMMARY] error:', e?.message ?? e);
  }
}

client.once('ready', async () => {
  try {
    console.log('[READY] logged in as %s', client.user.tag);
  } catch {}
  await registerCommands();
  await upsertSummary();
});

// Interaction flow — always defer, never crash
client.on('interactionCreate', async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'signal') return;

    try { await interaction.deferReply({ ephemeral: true }); }
    catch (e) { console.warn('[INT] defer failed:', e?.message ?? e); }

    const opts = interaction.options;
    const asset = (opts.getString('asset') || '').trim().toUpperCase();
    const direction = (opts.getString('direction') || 'long').toLowerCase();
    const entry = opts.getString('entry');
    const sl = opts.getString('sl');
    const tp1 = opts.getString('tp1') || null;
    const tp2 = opts.getString('tp2') || null;
    const tp3 = opts.getString('tp3') || null;
    const reason = opts.getString('reason') || '';
    const validReEntry = (opts.getString('valid_reentry') || 'Yes');
    const mentionRole = opts.getString('mention_role') || null;

    const statusText = `Active 🟩 — trade is still running`;
    const validReEntryText = validReEntry;

    const signal = {
      id: Date.now().toString(),
      asset, direction, entry, sl, tp1, tp2, tp3, reason,
      statusText, validReEntryText, active: true
    };

    // Send in signals channel
    const channel = await client.channels.fetch(config.signalsChannelId);
    if (!channel) {
      console.error('[INT] signals channel not found:', config.signalsChannelId);
      await interaction.editReply({ content: '❌ Signals channel not found.' });
      return;
    }

    const embed = renderSignalEmbed(signal);
    const content = mentionRole ? `<@&${mentionRole}>` : undefined;

    const message = await channel.send({ content, embeds: [embed] });
    console.log('[INT] signal sent messageId=%s', message.id);

    // Best-effort thread: message.startThread only makes PUBLIC threads from a message.
    // Create a *public* owner panel, then immediately lock/invite restriction. Private threads require Channel#createThread.
    try {
      if (channel.type === ChannelType.GuildText) {
        await message.startThread({
          name: `${asset} ${titleCaseDir(direction)} – Owner Panel`,
          autoArchiveDuration: 1440
        });
        console.log('[THREAD] started (public). If you want private, use channel.createThread with PrivateThread in a non-community text channel).');
      }
    } catch (e) {
      console.warn('[THREAD] could not start thread:', e?.message ?? e);
    }

    await saveSignal(signal);
    await upsertSummary();
    await interaction.editReply({ content: '✅ Signal posted.' });
  } catch (e) {
    console.error('[INT] handler error:', e?.rawError ?? e?.data ?? e?.message ?? e);
    try { await interaction.editReply({ content: '❌ Failed to create signal. Check logs.' }); } catch {}
  }
});

// ---- Login (no exit on failure; just log) ----
(async () => {
  try {
    console.log('[LOGIN] logging in…');
    await client.login(config.token);
    console.log('[LOGIN] success');
  } catch (e) {
    console.error('[LOGIN] failed:', e?.message ?? e);
  }
})();
