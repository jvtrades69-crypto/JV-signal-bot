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
import fetch from 'node-fetch';

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
  // EXACT format you asked for, with finger spacing
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
  ].filter(Boolean);

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
    /* Slash cmd: /signal */
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const asset = interaction.options.getString('asset', true);
      const direction = interaction.options.getString('direction', true);
      const entry = interaction.options.getString('entry', true);
      const sl = interaction.options.getString('sl', true);
      const image = interaction.options.getAttachment('image', true);

      const timeframe = interaction.options.getString('timeframe', false);
      const tp1 = interaction.options.getString('tp1', false);
      const tp1p = interaction.options.getNumber('tp1_close_pct', false) ?? null;
      const tp2 = interaction.options.getString('tp2', false);
      const tp2p = interaction.options.getNumber('tp2_close_pct', false) ?? null;
      const tp3 = interaction.options.getString('tp3', false);
      const tp3p = interaction.options.getNumber('tp3_close_pct', false) ?? null;
      const risk = interaction.options.getNumber('risk', false) ?? null;
      const reason = interaction.options.getString('reason', false) || null;
      const target = interaction.options.getChannel('channel', false) || interaction.channel;

      const s = {
        id: crypto.randomUUID().slice(0,8),
        authorId: interaction.user.id,
        asset, direction, timeframe: timeframe || null,
        entry, entry_type: /market/i.test(entry) ? 'market' : null,
        sl, tp1: tp1 || null, tp1_close_pct: tp1p,
        tp2: tp2 || null, tp2_close_pct: tp2p,
        tp3: tp3 || null, tp3_close_pct: tp3p,
        risk, reason,
        status: 'Active',
        statusNote: null,
        createdAt: Date.now(),
        messageLink: null
      };

      // send
      const fileRes = await fetch(image.url);
      const fileBuf = Buffer.from(await fileRes.arrayBuffer());
      const msg = await target.send({
        content: buildContent(s, true),
        components: [rowFor(s.id)],
        files: [{ attachment: fileBuf, name: image.name || 'chart.png' }]
      });
      s.messageLink = msg.url;

      const db = await loadDB(); db.signals[s.id] = s; await saveDB(db);
      await renderBoard(interaction.guild, s.authorId);
      return interaction.editReply({ content: `Signal posted ✔️  • ID: **${s.id}**` });
    }

    /* Slash cmd: /signal-update */
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal-update') {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });

      const id = interaction.options.getString('id', false);
      const link = interaction.options.getString('message_link', false);
      const db = await loadDB();
      let s = id ? db.signals[id] : null;
      if (!s && link) s = Object.values(db.signals).find(x => x.messageLink === link);
      if (!s) return interaction.editReply({ content: 'Signal not found.' });

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
      const statusNote = interaction.options.getString('status_note', false);
      if (statusNote !== null) { s.statusNote = statusNote; changed = true; }

      const newImg = interaction.options.getAttachment('image', false);
      let file = null;
      if (newImg?.url) {
        const r = await fetch(newImg.url);
        file = { attachment: Buffer.from(await r.arrayBuffer()), name: newImg.name || 'chart.png' };
      }

      if (!changed && !file) return interaction.editReply({ content: 'Nothing to update.' });
      await saveDB(db);

      try {
        const url = new URL(s.messageLink);
        const [,,, channelId, messageId] = url.pathname.split('/');
        const channel = await interaction.guild.channels.fetch(channelId);
        const m = await channel.messages.fetch(messageId);
        const content = buildContent(s, false);
        const comps = (s.status === 'Closed' || s.status === 'Invalid') ? [] : [rowFor(s.id)];
        if (file) await m.edit({ content, components: comps, files: [file] });
        else await m.edit({ content, components: comps });
      } catch (e) { console.error('Edit failed:', e); }

      await renderBoard(interaction.guild, s.authorId);
      return interaction.editReply({ content: 'Updated ✔️' });
    }

    /* Buttons */
    if (interaction.isButton()) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const [k, act, id] = interaction.customId.split('_'); // sig_run_<id> / sig_be_<id> / sig_close_<id>
      if (k !== 'sig') return;

      const db = await loadDB();
      const s = db.signals[id];
      if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      if (act === 'run') {
        s.status = 'Running';
        if (!s.statusNote) s.statusNote = 'running';
        await saveDB(db);

        try {
          const url = new URL(s.messageLink);
          const [,,, chId, msgId] = url.pathname.split('/');
          const channel = await interaction.guild.channels.fetch(chId);
          const msg = await channel.messages.fetch(msgId);
          await msg.edit({ content: buildContent(s, false), components: [rowFor(s.id)] });
        } catch {}
        await renderBoard(interaction.guild, s.authorId);
        return interaction.reply({ content: 'Marked Running ✔️', ephemeral: true });
      }

      if (act === 'be') {
        // Open BE modal with required note
        const modal = new ModalBuilder().setCustomId(`be_modal_${id}`).setTitle('Set BE — Status Note');
        const note = new TextInputBuilder()
          .setCustomId('note')
          .setLabel('Status note (required)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setPlaceholder('e.g., stopped breakeven after tp1');
        modal.addComponents(new ActionRowBuilder().addComponents(note));
        await interaction.showModal(modal);
        return;
      }

      if (act === 'close') {
        const modal = new ModalBuilder().setCustomId(`close_modal_${id}`).setTitle('Close Trade');
        const result = new TextInputBuilder().setCustomId('result').setLabel('Result (Win / Loss / Breakeven / Manual Close)').setStyle(TextInputStyle.Short).setRequired(true);
        const rmult  = new TextInputBuilder().setCustomId('r').setLabel('R multiple (optional, e.g., 2.0)').setStyle(TextInputStyle.Short).setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(result),
          new ActionRowBuilder().addComponents(rmult),
        );
        await interaction.showModal(modal);
        return;
      }
    }

    /* Modal: Set BE */
    if (interaction.isModalSubmit() && interaction.customId.startsWith('be_modal_')) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const id = interaction.customId.replace('be_modal_','');
      const note = interaction.fields.getTextInputValue('note')?.trim();
      const db = await loadDB();
      const s = db.signals[id];
      if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      s.status = 'BE';
      s.statusNote = note || 'BE';
      await saveDB(db);

      try {
        const url = new URL(s.messageLink);
        const [,,, chId, msgId] = url.pathname.split('/');
        const channel = await interaction.guild.channels.fetch(chId);
        const msg = await channel.messages.fetch(msgId);
        await msg.edit({ content: buildContent(s, false), components: [rowFor(s.id)] });
      } catch(e){ console.error('BE edit failed:', e); }

      await renderBoard(interaction.guild, s.authorId);
      return interaction.reply({ content: 'BE set ✔️', ephemeral: true });
    }

    /* Modal: Close */
    if (interaction.isModalSubmit() && interaction.customId.startsWith('close_modal_')) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const id = interaction.customId.replace('close_modal_','');
      const resultRaw = interaction.fields.getTextInputValue('result')?.trim() || '';
      const rRaw      = interaction.fields.getTextInputValue('r')?.trim();
      const map = new Map([['win','Win'],['loss','Loss'],['lose','Loss'],['breakeven','Breakeven'],['be','Breakeven'],['manual close','Manual Close'],['manual','Manual Close']]);
      const normalized = map.get(resultRaw.toLowerCase()) || map.get(resultRaw.toLowerCase().replace(/\s+/g,''));
      if (!normalized) return interaction.reply({ content: 'Invalid result. Use: Win, Loss, Breakeven, Manual Close.', ephemeral: true });
      const r = rRaw ? Number(rRaw.replace(/[^0-9.+-]/g,'')) : null;

      const db = await loadDB();
      const s = db.signals[id];
      if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      s.status = 'Closed';
      s.statusNote = `fully closed in ${normalized.toLowerCase()}${Number.isFinite(r) ? ` • ${r}R` : ''}`;
      await saveDB(db);

      try {
        const url = new URL(s.messageLink);
        const [,,, chId, msgId] = url.pathname.split('/');
        const channel = await interaction.guild.channels.fetch(chId);
        const msg = await channel.messages.fetch(msgId);
        await msg.edit({ content: buildContent(s, false), components: [] }); // remove buttons on close
      } catch(e){ console.error('Close edit failed:', e); }

      await renderBoard(interaction.guild, s.authorId);
      return interaction.reply({ content: `Closed ✔️ (${s.statusNote})`, ephemeral: true });
    }

  } catch (e) {
    console.error('Handler error:', e);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: 'Unexpected error. Check bot console.', ephemeral: true }); } catch {}
    }
  }
});

client.login(DISCORD_TOKEN);
