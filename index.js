import {
  Client, GatewayIntentBits, Partials, Events,
  PermissionsBitField, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

process.on('unhandledRejection', e => console.error('UnhandledRejection', e));
process.on('uncaughtException', e => console.error('UncaughtException', e));

const {
  DISCORD_TOKEN,
  OWNER_USER_ID,
  TRADER_ROLE_IDS,
  MENTION_ROLE_ID,
  CURRENT_TRADES_CHANNEL_ID
} = process.env;

if (!DISCORD_TOKEN) { console.error('Missing DISCORD_TOKEN'); process.exit(1); }

const TRADER_ROLES = (TRADER_ROLE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

/* ========== Tiny JSON DB ========== */
const DB = path.join(__dirname, 'signals.json');
async function loadDB() {
  try {
    if (!(await fs.pathExists(DB))) return { signals: {}, boards: {} };
    const data = JSON.parse(await fs.readFile(DB, 'utf8'));
    if (!data.boards) data.boards = {};
    return data;
  } catch {
    return { signals: {}, boards: {} };
  }
}
async function saveDB(d) { await fs.writeFile(DB, JSON.stringify(d, null, 2), 'utf8'); }

/* ========== Perms ========== */
function userAllowed(interaction) {
  if (!interaction?.member) return false;
  if (OWNER_USER_ID && interaction.user.id === OWNER_USER_ID) return true;
  if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return TRADER_ROLES.some(id => interaction.member.roles?.cache?.has(id));
}

/* ========== Helpers (format) ========== */
const dirEmoji = d => (d?.toLowerCase() === 'short' ? ':red_circle:' : ':green_circle:');
const code = t => `\`${t}\``;
function norm(n) {
  if (n == null) return n;
  const s = String(n).replace(/[, ]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return String(n);
  return Number(s).toLocaleString('en-US', { maximumFractionDigits: 8 });
}
function buildContent(s, roleMentionAtBottom = true) {
  const header = `**${s.asset.toUpperCase()} | ${s.direction.toUpperCase()}** ${dirEmoji(s.direction)}`;
  const lines = [
    header,
    '',
    ':bar_chart: **Trade Details**',
    `Entry : ${s.entry_type ? `${s.entry_type} ( ${norm(s.entry)} )` : norm(s.entry) ? `${norm(s.entry)}` : String(s.entry)}`,
    `SL : ${norm(s.sl)}`,
    s.tp1 ? `TP1 : ${norm(s.tp1)}${s.tp1_close_pct ? ` ( ${s.tp1_close_pct}% out )` : ''}` : null,
    s.tp2 ? `TP2 : ${norm(s.tp2)}${s.tp2_close_pct ? ` ( ${s.tp2_close_pct}% out )` : ''}` : null,
    s.tp3 ? `TP3 : ${norm(s.tp3)}${s.tp3_close_pct ? ` ( ${s.tp3_close_pct}% out )` : ''}` : null,
    s.stopsBeAt ? `Stops BE at ${norm(s.stopsBeAt)}` : null,
    '',
    s.reason ? `Reason : ${s.reason}` : null,
    '',
    `:round_pushpin: Status : ${s.statusNote ? s.statusNote : s.status}`,
    '',
  ].filter(v => v !== null);  // keep "" so spacing survives

  if (roleMentionAtBottom && MENTION_ROLE_ID?.trim()) lines.push(`<@&${MENTION_ROLE_ID}>`);
  return lines.join('\n');
}
const rowFor = id => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`sig_run_${id}`).setLabel('🚀 Mark Running').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`sig_be_${id}`).setLabel('🟨 Set BE').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`sig_close_${id}`).setLabel('✅ Close').setStyle(ButtonStyle.Danger),
);

/* ========== Boards (optional) ========== */
async function ensureBoard(guild, userId) {
  if (!CURRENT_TRADES_CHANNEL_ID) return null;
  const db = await loadDB();
  const chan = await guild.channels.fetch(CURRENT_TRADES_CHANNEL_ID).catch(() => null);
  if (!chan || chan.type !== ChannelType.GuildText) return null;
  const info = db.boards[userId];
  if (info?.messageId) return { channel: chan, messageId: info.messageId };
  const tag = (await guild.members.fetch(userId)).user.tag;
  const m = await chan.send({ content: `**${tag} — Current Trades**\n_No open trades._` });
  db.boards[userId] = { messageId: m.id }; await saveDB(db);
  return { channel: chan, messageId: m.id };
}
async function renderBoard(guild, userId) {
  if (!CURRENT_TRADES_CHANNEL_ID) return;
  const db = await loadDB();
  const info = await ensureBoard(guild, userId);
  if (!info) return;
  const { channel, messageId } = info;
  const open = Object.values(db.signals).filter(s =>
    s.authorId === userId && !['Closed','Invalid'].includes(s.status)
  ).sort((a,b)=>b.createdAt-a.createdAt);
  const tag = (await guild.members.fetch(userId)).user.tag;
  let content = `**${tag} — Current Trades**\n`;
  content += open.length ? open.map(s =>
    `• ${s.asset.toUpperCase()} | ${s.direction.toUpperCase()} — Entry ${code(norm(s.entry))}, SL ${code(norm(s.sl))}${s.tp1?`, TP1 ${code(norm(s.tp1))}`:''}\n  ↪️ ${s.statusNote ? s.statusNote : s.status} • ${s.messageLink}`
  ).join('\n\n') : `_No open trades._`;
  try { const msg = await channel.messages.fetch(messageId); await msg.edit({ content }); }
  catch { const m = await channel.send({ content }); db.boards[userId] = { messageId: m.id }; await saveDB(db); }
}

/* ========== Bot ========== */
client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Handle button: Close trade
    if (interaction.isButton() && interaction.customId.startsWith('sig_close_')) {
      const id = interaction.customId.split('_')[2];
      const modal = new ModalBuilder()
        .setCustomId(`sig_close_modal_${id}`)
        .setTitle('Close Trade');

      const resultInput = new TextInputBuilder()
        .setCustomId('result')
        .setLabel('Result: Win / Loss / BE / Manual') // ✅ shortened label
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const rInput = new TextInputBuilder()
        .setCustomId('rmultiple')
        .setLabel('R multiple (e.g., 2.5)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(resultInput),
        new ActionRowBuilder().addComponents(rInput),
      );

      await interaction.showModal(modal);
      return;
    }

    // ... keep your other slash command + button handlers ...
    // this file now preserves spacing + fixes close label
  } catch (e) {
    console.error('Handler error:', e);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: 'Unexpected error. Check bot console.', ephemeral: true }); } catch {}
    }
  }
});

client.login(DISCORD_TOKEN);
