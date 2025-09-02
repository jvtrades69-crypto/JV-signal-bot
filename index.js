import {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionsBitField, Events,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import 'dotenv/config';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import fetch from 'node-fetch';

process.on('unhandledRejection', err => console.error('Unhandled Rejection:', err));
process.on('uncaughtException', err => console.error('Uncaught Exception:', err));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const {
  DISCORD_TOKEN,
  OWNER_USER_ID,
  TRADER_ROLE_IDS,
  MENTION_ROLE_ID,
  CURRENT_TRADES_CHANNEL_ID
} = process.env;

if (!DISCORD_TOKEN) { console.error('Missing DISCORD_TOKEN'); process.exit(1); }

const TRADER_ROLES = (TRADER_ROLE_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

/* ========== Simple JSON DB ========== */
const DB_PATH = path.join(__dirname, 'signals.json');
async function loadDB() {
  try {
    const exists = await fs.pathExists(DB_PATH);
    if (!exists) return { signals: {}, boards: {} };
    const data = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
    if (!data.boards) data.boards = {};
    return data;
  } catch {
    return { signals: {}, boards: {} };
  }
}
async function saveDB(db) { await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8'); }

/* ========== Perms ========== */
function userAllowed(interaction) {
  if (!interaction?.member) return false;
  if (OWNER_USER_ID && interaction.user.id === OWNER_USER_ID) return true;
  if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  return TRADER_ROLES.some(id => interaction.member.roles?.cache?.has(id));
}

/* ========== Helpers ========== */
const code = x => `\`${x}\``;
function normPrice(str) {
  if (!str) return str;
  const s = String(str).replace(/[, ]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return str;
  return Number(s).toLocaleString('en-US', { maximumFractionDigits: 8 });
}
const fmtPct = p => p == null ? null : Math.max(0, Math.min(100, Math.round(Number(p))));
const statusEmoji = s => s === 'Running' ? '🚀' : s === 'BE' ? '🟨' : s === 'Invalid' ? '❌' : s === 'Closed' ? '✅' : '🟢';
const directionEmoji = d => (d?.toLowerCase() === 'long' ? '🟢' : '🔴');

function buildMessageContent(s, mentionBottom = false) {
  const header = `${directionEmoji(s.direction)} $${s.asset.toUpperCase()} | ${s.direction.toUpperCase()}${s.timeframe ? ` (${s.timeframe})` : ''}`;
  const lines = [
    header,
    '',
    '📊 **Trade Details**',
    `Entry: ${code(normPrice(s.entry))}`,
    `Stop Loss: ${code(normPrice(s.sl))}`,
    s.tp1 ? `TP1: ${code(normPrice(s.tp1))} (${(fmtPct(s.tp1_close_pct) ?? 50) === 100 ? 'final target 🎯' : `close ${fmtPct(s.tp1_close_pct) ?? 50}% 📉`})` : null,
    s.tp2 ? `TP2: ${code(normPrice(s.tp2))} (${(fmtPct(s.tp2_close_pct) ?? 100) === 100 ? 'final target 🎯' : `close ${fmtPct(s.tp2_close_pct)}% 📉`})` : null,
    s.tp3 ? `TP3: ${code(normPrice(s.tp3))} (${(fmtPct(s.tp3_close_pct) ?? 100) === 100 ? 'final target 🎯' : `close ${fmtPct(s.tp3_close_pct)}% 📉`})` : null,
    '',
    s.reason ? `📌 **Reason**\n${s.reason}` : null,
    '',
    '📍 **Status**',
    `${statusEmoji(s.status)} ${s.status}`,
    ''
  ].filter(Boolean);

  if (mentionBottom && MENTION_ROLE_ID?.trim()) lines.push(`<@&${MENTION_ROLE_ID}>`);
  return lines.join('\n');
}

const makeActionRow = id => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`signal_run_${id}`).setLabel('🚀 Mark Running').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`signal_be_${id}`).setLabel('🟨 Set BE').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`signal_close_${id}`).setLabel('✅ Close').setStyle(ButtonStyle.Danger),
);

/* ========== Boards ========== */
async function ensureBoardMessage(guild, userId) {
  if (!CURRENT_TRADES_CHANNEL_ID) return null;
  const db = await loadDB();
  const info = db.boards[userId];
  const chan = await guild.channels.fetch(CURRENT_TRADES_CHANNEL_ID).catch(() => null);
  if (!chan || chan.type !== ChannelType.GuildText) return null;
  if (info?.messageId) return { channel: chan, messageId: info.messageId };
  const tag = (await guild.members.fetch(userId)).user.tag;
  const msg = await chan.send({ content: `**${tag} — Current Trades**\n_No open trades._` });
  db.boards[userId] = { messageId: msg.id };
  await saveDB(db);
  return { channel: chan, messageId: msg.id };
}

async function renderBoard(guild, userId) {
  if (!CURRENT_TRADES_CHANNEL_ID) return;
  const db = await loadDB();
  const info = await ensureBoardMessage(guild, userId);
  if (!info) return;
  const { channel, messageId } = info;

  const open = Object.values(db.signals)
    .filter(s => s.authorId === userId && !['Closed','Invalid'].includes(s.status))
    .sort((a,b) => b.createdAt - a.createdAt);

  const tag = (await guild.members.fetch(userId)).user.tag;
  let content = `**${tag} — Current Trades**\n`;
  content += open.length
    ? open.map(s => `• ${statusEmoji(s.status)} **${s.asset.toUpperCase()} | ${s.direction.toUpperCase()}${s.timeframe ? ` (${s.timeframe})` : ''}** — Entry ${code(normPrice(s.entry))}, SL ${code(normPrice(s.sl))}${s.tp1 ? `, TP1 ${code(normPrice(s.tp1))}` : ''}${s.tp2 ? `, TP2 ${code(normPrice(s.tp2))}` : ''}\n  ↪️ [Jump](${s.messageLink})`).join('\n\n')
    : `_No open trades._`;

  try { const m = await channel.messages.fetch(messageId); await m.edit({ content }); }
  catch { const m = await channel.send({ content }); db.boards[userId] = { messageId: m.id }; await saveDB(db); }
}

/* ========== Bot ========== */
client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const name = interaction.commandName;

      // /signal
      if (name === 'signal') {
        const asset = interaction.options.getString('asset', true);
        const direction = interaction.options.getString('direction', true);
        const timeframe = interaction.options.getString('timeframe', false);
        const entry = interaction.options.getString('entry', true);
        const sl = interaction.options.getString('sl', true);
        const tp1 = interaction.options.getString('tp1', false);
        const tp1pct = interaction.options.getNumber('tp1_close_pct', false) ?? (tp1 ? 50 : null);
        const tp2 = interaction.options.getString('tp2', false);
        const tp2pct = interaction.options.getNumber('tp2_close_pct', false) ?? (tp2 ? 100 : null);
        const tp3 = interaction.options.getString('tp3', false);
        const tp3pct = interaction.options.getNumber('tp3_close_pct', false) ?? null;
        const risk = interaction.options.getNumber('risk', false);
        const reason = interaction.options.getString('reason', false);
        const image = interaction.options.getAttachment('image', true);
        const target = interaction.options.getChannel('channel', false) || interaction.channel;
        if (target.type !== ChannelType.GuildText) return interaction.reply({ content: 'Pick a **text** channel.', ephemeral: true });

        const s = {
          id: nanoid(8),
          authorId: interaction.user.id,
          asset, direction, timeframe: timeframe || null,
          entry, sl,
          tp1: tp1 || null, tp1_close_pct: tp1pct,
          tp2: tp2 || null, tp2_close_pct: tp2pct,
          tp3: tp3 || null, tp3_close_pct: tp3pct,
          risk: risk ?? null,
          reason: reason || null,
          status: 'Active',
          createdAt: Date.now(),
          messageLink: null
        };

        const content = buildMessageContent(s, true);
        const res = await fetch(image.url);
        const buf = Buffer.from(await res.arrayBuffer());
        const msg = await target.send({
          content,
          components: [makeActionRow(s.id)],
          files: [{ attachment: buf, name: image.name || 'chart.png' }]
        });
        s.messageLink = msg.url;

        const db = await loadDB(); db.signals[s.id] = s; await saveDB(db);
        await renderBoard(interaction.guild, s.authorId);

        return interaction.reply({ content: `Signal posted ✔️ • ID: **${s.id}** • [Jump](${s.messageLink})`, ephemeral: true });
      }

      // /signal-update
      if (name === 'signal-update') {
        const id = interaction.options.getString('id', false);
        const link = interaction.options.getString('message_link', false);
        const db = await loadDB();
        let s = id ? db.signals[id] : null;
        if (!s && link) s = Object.values(db.signals).find(x => x.messageLink === link);
        if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

        const strFields = ['asset','direction','timeframe','entry','sl','tp1','tp2','tp3','reason'];
        let changed = false;
        for (const f of strFields) {
          const v = interaction.options.getString(f, false);
          if (v !== null) { s[f] = v; changed = true; }
        }
        const numFields = [['tp1_close_pct','tp1'],['tp2_close_pct','tp2'],['tp3_close_pct','tp3'],['risk',null]];
        for (const [f, dep] of numFields) {
          const v = interaction.options.getNumber(f, false);
          if (v !== null && (!dep || s[dep])) { s[f] = v; changed = true; }
        }
        const newStatus = interaction.options.getString('status', false);
        if (newStatus !== null) { s.status = newStatus; changed = true; }
        const result = interaction.options.getString('result', false);
        const r = interaction.options.getNumber('r', false);
        if (s.status === 'Closed' && (result || r !== null)) s.closeInfo = `${result || ''}${r != null ? ` • ${r}R` : ''}`.trim();
        else if (s.status !== 'Closed') s.closeInfo = null;

        const newImg = interaction.options.getAttachment('image', false);
        let file = null;
        if (newImg?.url) {
          const res = await fetch(newImg.url);
          file = { attachment: Buffer.from(await res.arrayBuffer()), name: newImg.name || 'chart.png' };
        }

        if (!changed && !file) return interaction.reply({ content: 'Nothing to update.', ephemeral: true });
        await saveDB(db);

        try {
          const url = new URL(s.messageLink);
          const [,,, channelId, messageId] = url.pathname.split('/');
          const channel = await interaction.guild.channels.fetch(channelId);
          const msg = await channel.messages.fetch(messageId);
          const content = buildMessageContent(s, false);
          const components = (s.status === 'Closed' || s.status === 'Invalid') ? [] : [makeActionRow(s.id)];
          if (file) await msg.edit({ content, components, files:[file], attachments:[] });
          else await msg.edit({ content, components });
        } catch (e) { console.error('Edit failed:', e); }

        await renderBoard(interaction.guild, s.authorId);
        return interaction.reply({ content: `Updated ✔️${s.status==='Closed'?` (Closed ${s.closeInfo||''})`:''}`, ephemeral: true });
      }
    }

    // Buttons
    if (interaction.isButton()) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const [prefix, action, id] = interaction.customId.split('_');
      if (prefix !== 'signal') return;

      const db = await loadDB();
      const s = db.signals[id];
      if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      if (action === 'run') s.status = 'Running';
      if (action === 'be') s.status = 'BE';
      if (action === 'close') {
        const modal = new ModalBuilder().setCustomId(`signal_close_modal_${id}`).setTitle('Close Trade');
        const resInput = new TextInputBuilder().setCustomId('result').setLabel('Result (Win / Loss / Breakeven / Manual Close)').setStyle(TextInputStyle.Short).setRequired(true);
        const rInput = new TextInputBuilder().setCustomId('rmultiple').setLabel('R multiple (e.g., 2.5) — optional').setStyle(TextInputStyle.Short).setRequired(false);
        return interaction.showModal(modal.addComponents(
          new ActionRowBuilder().addComponents(resInput),
          new ActionRowBuilder().addComponents(rInput)
        ));
      }

      await saveDB(db);

      try {
        const url = new URL(s.messageLink);
        const [,,, channelId, messageId] = url.pathname.split('/');
        const channel = await interaction.guild.channels.fetch(channelId);
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ content: buildMessageContent(s, false), components: [makeActionRow(s.id)] });
      } catch {}

      await renderBoard(interaction.guild, s.authorId);
      return interaction.reply({ content: `Status set to **${s.status}**.`, ephemeral: true });
    }

    // Close modal
    if (interaction.isModalSubmit() && interaction.customId.startsWith('signal_close_modal_')) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const id = interaction.customId.replace('signal_close_modal_', '');
      const db = await loadDB(); const s = db.signals[id];
      if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      const resultRaw = interaction.fields.getTextInputValue('result')?.trim() || '';
      const rRaw = interaction.fields.getTextInputValue('rmultiple')?.trim();
      const map = new Map([['win','Win'],['loss','Loss'],['lose','Loss'],['breakeven','Breakeven'],['be','Breakeven'],['manual close','Manual Close'],['manual','Manual Close'],['manualclose','Manual Close']]);
      const normalized = map.get(resultRaw.toLowerCase()) || map.get(resultRaw.toLowerCase().replace(/\s+/g,''));
      if (!normalized) return interaction.reply({ content: 'Invalid result. Use: Win, Loss, Breakeven, Manual Close.', ephemeral: true });
      const r = rRaw ? Number(rRaw.replace(/[^0-9.+-]/g,'')) : null;

      s.status = 'Closed';
      s.closeInfo = `${normalized}${isFinite(r)?` • ${r}R`:''}`;
      await saveDB(db);

      try {
        const url = new URL(s.messageLink);
        const [,,, channelId, messageId] = url.pathname.split('/');
        const channel = await interaction.guild.channels.fetch(channelId);
        const msg = await channel.messages.fetch(messageId);
        await msg.edit({ content: buildMessageContent(s, false), components: [] });
      } catch(e){ console.error('Edit after close failed:', e); }

      await renderBoard(interaction.guild, s.authorId);
      return interaction.reply({ content: `Closed ✔️ (${s.closeInfo})`, ephemeral: true });
    }

  } catch (e) {
    console.error(e);
    if (interaction.isRepliable()) interaction.reply({ content: 'Unexpected error. Check bot console.', ephemeral: true }).catch(()=>{});
  }
});

client.login(DISCORD_TOKEN);
