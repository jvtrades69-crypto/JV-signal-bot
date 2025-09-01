const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionsBitField, Events
} = require('discord.js');
const { config } = require('dotenv');
const fs = require('fs-extra');
const path = require('path');
const { nanoid } = require('nanoid');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const Tesseract = require('tesseract.js'); // OCR (beta)

config();

const {
  DISCORD_TOKEN,
  OWNER_USER_ID,
  TRADER_ROLE_IDS,
  MENTION_ROLE_ID,
  CURRENT_TRADES_CHANNEL_ID
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const TRADER_ROLES = (TRADER_ROLE_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

// ==== simple JSON storage ====
const DB_PATH = path.join(__dirname, 'signals.json');
async function loadDB() {
  try {
    const exists = await fs.pathExists(DB_PATH);
    if (!exists) return { signals: {}, boards: {} }; // boards: { userId: { messageId } }
    const data = JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
    if (!data.boards) data.boards = {};
    return data;
  } catch (e) {
    console.error('DB read error:', e);
    return { signals: {}, boards: {} };
  }
}
async function saveDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ==== perms helper ====
function userAllowed(interaction) {
  if (!interaction?.member) return false;
  if (OWNER_USER_ID && interaction.user.id === OWNER_USER_ID) return true;
  if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  if (TRADER_ROLES.length) {
    for (const r of TRADER_ROLES) {
      if (interaction.member.roles?.cache?.has(r)) return true;
    }
  }
  return false;
}

// ==== utils ====
function fmtPct(p) {
  if (p == null) return null;
  const n = Number(p);
  if (!isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function code(x) { return `\`${x}\``; }
function normPrice(str) {
  if (!str) return str;
  const s = String(str).replace(/[, ]/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return str;
  return Number(s).toLocaleString('en-US', { maximumFractionDigits: 8 });
}
function titleFrom(s) {
  const asset = s.asset.toUpperCase();
  const dir = s.direction.toUpperCase();
  const tf = s.timeframe ? ` (${s.timeframe})` : '';
  const emoji = s.direction.toLowerCase() === 'long' ? '🟢' : '🔴';
  return `${emoji} $${asset} | ${dir}${tf}`;
}

function makeSignalEmbed(s) {
  const color = s.status === 'Closed' ? 0x6C757D : (s.direction.toLowerCase() === 'long' ? 0x00A86B : 0xE63946);

  const e = new EmbedBuilder()
    .setTitle(titleFrom(s))
    .setColor(color)
    .setTimestamp(new Date(s.createdAt));

  // 📌 Reason (optional)
  if (s.reason && s.reason.trim().length) {
    e.addFields({ name: '📌 Reason', value: s.reason.trim().slice(0, 1024) });
  }

  // 📊 Trade details
  const lines = [];
  lines.push(`**Entry:** ${code(normPrice(s.entry))}${s.entry_note ? ` (${s.entry_note})` : ''}`);
  lines.push(`**Stop Loss:** ${code(normPrice(s.sl))}`);
  if (s.tp1) {
    const pct = fmtPct(s.tp1_close_pct) ?? 50;
    lines.push(`**TP1:** ${code(normPrice(s.tp1))} (${pct === 100 ? 'final target 🎯' : `close ${pct}% 📉`})`);
  }
  if (s.tp2) {
    const pct = fmtPct(s.tp2_close_pct);
    const label = (pct == null || pct >= 100) ? 'final target 🎯' : `close ${pct}% 📉`;
    lines.push(`**TP2:** ${code(normPrice(s.tp2))} (${label})`);
  }
  if (s.tp3) {
    const pct = fmtPct(s.tp3_close_pct);
    const label = (pct == null || pct >= 100) ? 'final target 🎯' : `close ${pct}% 📉`;
    lines.push(`**TP3:** ${code(normPrice(s.tp3))} (${label})`);
  }
  e.addFields({ name: '📊 Trade Details', value: lines.join('\n') });

  // 💵 Risk (optional)
  if (s.risk != null) e.addFields({ name: '💵 Risk', value: `${s.risk}%`, inline: true });

  // 📍 Status
  const statusEmoji = s.status === 'Running' ? '🚀' :
                      s.status === 'BE' ? '🟨' :
                      s.status === 'Invalid' ? '❌' :
                      s.status === 'Closed' ? '✅' : '🟢';
  e.addFields({ name: '📍 Status', value: `${statusEmoji} ${s.status}`, inline: true });

  // 🔗 Chart (optional)
  if (s.chart) e.addFields({ name: '🔗 Chart / Setup', value: `<${s.chart}>` });

  // Author
  if (s.authorTag) e.setAuthor({ name: s.authorTag });

  return e;
}

function makeActionRow(s) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal_run_${s.id}`).setLabel('🚀 Mark Running').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signal_be_${s.id}`).setLabel('🟨 Set BE').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signal_close_${s.id}`).setLabel('✅ Close').setStyle(ButtonStyle.Danger)
  );
}

// ===== Board (Current Trades) =====
async function ensureBoardMessage(guild, userId) {
  if (!CURRENT_TRADES_CHANNEL_ID) return null;
  const db = await loadDB();
  const existing = db.boards[userId];
  const chan = await guild.channels.fetch(CURRENT_TRADES_CHANNEL_ID).catch(() => null);
  if (!chan || chan.type !== ChannelType.GuildText) return null;

  if (existing?.messageId) {
    return { channel: chan, messageId: existing.messageId };
  }
  // create new placeholder
  const msg = await chan.send({ content: `**${(await guild.members.fetch(userId)).user.tag} — Current Trades**\n_No open trades._` });
  db.boards[userId] = { messageId: msg.id };
  await saveDB(db);
  return { channel: chan, messageId: msg.id };
}

function statusIcon(s) {
  if (s.status === 'Running') return '🚀';
  if (s.status === 'BE') return '🟨';
  if (s.status === 'Invalid') return '❌';
  if (s.status === 'Closed') return '✅';
  return '🟢';
}

async function renderBoard(guild, userId) {
  if (!CURRENT_TRADES_CHANNEL_ID) return;
  const db = await loadDB();
  const { channel, messageId } = await ensureBoardMessage(guild, userId) || {};
  if (!channel || !messageId) return;

  // collect open signals for this user
  const open = Object.values(db.signals).filter(s =>
    s.authorId === userId && !['Closed','Invalid'].includes(s.status)
  ).sort((a,b) => b.createdAt - a.createdAt);

  let content = `**${(await guild.members.fetch(userId)).user.tag} — Current Trades**\n`;
  if (!open.length) {
    content += `_No open trades._`;
  } else {
    content += open.map(s => {
      const line = `• ${statusIcon(s)} **${s.asset.toUpperCase()} | ${s.direction.toUpperCase()}${s.timeframe ? ` (${s.timeframe})` : ''}** — Entry ${code(normPrice(s.entry))}, SL ${code(normPrice(s.sl))}${s.tp1 ? `, TP1 ${code(normPrice(s.tp1))}` : ''}${s.tp2 ? `, TP2 ${code(normPrice(s.tp2))}` : ''}\n  ↪️ [Jump](${s.messageLink})`;
      return line;
    }).join('\n\n');
  }

  try {
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ content });
  } catch {
    // recreate if missing
    const msg = await channel.send({ content });
    db.boards[userId] = { messageId: msg.id };
    await saveDB(db);
  }
}

// ===== Parsing & OCR (beta) =====
function parseCaption(caption) {
  if (!caption) return {};
  const out = {};

  // Asset & direction: e.g. "ETH | LONG"
  const header = caption.match(/\b(BTC|ETH|SOL)\b.*?\b(LONG|SHORT)\b/i);
  if (header) {
    out.asset = header[1].toLowerCase();
    out.direction = header[2].toLowerCase();
  }

  // entry (supports "entry 103,201", "e: 103201", "Entry (103,201)", "E=103201", "market (103,201)")
  const entryParen = caption.match(/entry[^0-9]*\(([0-9,.\s]+)\)/i);
  const entryA = entryParen?.[1] || (caption.match(/\b(?:entry|e|@e|e=)\s*[:=]?\s*([0-9,.\s]+)/i)?.[1]);
  if (entryA) {
    out.entry = entryA.trim();
  }
  if (/market/i.test(caption)) out.entry_note = 'Market';

  // stop loss: "sl 103201", "stop 103,201", "SL=103201"
  const slA = caption.match(/\b(?:sl|stop|s|sl=)\s*[:=]?\s*([0-9,.\s]+)/i)?.[1];
  if (slA) out.sl = slA.trim();

  // TP patterns: "tp1 102,201@50" OR "tp1 102,201 (50%)"
  const tp1 = caption.match(/\btp1?\s*[:=]?\s*([0-9,.\s]+)(?:\s*@\s*(\d{1,3}))?/i);
  if (tp1) {
    out.tp1 = tp1[1].trim();
    if (tp1[2]) out.tp1_close_pct = Number(tp1[2]);
    const pctParen = caption.match(/\btp1?[^\n]*\((\d{1,3})%\)/i);
    if (!out.tp1_close_pct && pctParen) out.tp1_close_pct = Number(pctParen[1]);
  }
  const tp2 = caption.match(/\btp2\s*[:=]?\s*([0-9,.\s]+)(?:\s*@\s*(\d{1,3}))?/i);
  if (tp2) {
    out.tp2 = tp2[1].trim();
    if (tp2[2]) out.tp2_close_pct = Number(tp2[2]);
    const pctParen = caption.match(/\btp2[^\n]*\((\d{1,3})%\)/i);
    if (!out.tp2_close_pct && pctParen) out.tp2_close_pct = Number(pctParen[1]);
  }
  const tp3 = caption.match(/\btp3\s*[:=]?\s*([0-9,.\s]+)(?:\s*@\s*(\d{1,3}))?/i);
  if (tp3) {
    out.tp3 = tp3[1].trim();
    if (tp3[2]) out.tp3_close_pct = Number(tp3[2]);
    const pctParen = caption.match(/\btp3[^\n]*\((\d{1,3})%\)/i);
    if (!out.tp3_close_pct && pctParen) out.tp3_close_pct = Number(pctParen[1]);
  }

  return out;
}

async function ocrImageToText(url) {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const { data } = await Tesseract.recognize(Buffer.from(buf), 'eng', { tessedit_char_whitelist: '0123456789.,ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz ' });
    return data?.text || '';
  } catch (e) {
    return '';
  }
}

function guessFromOCR(text) {
  const out = {};
  const cleaned = text.replace(/\s+/g, ' ');
  const entry = cleaned.match(/entry[^0-9]*([0-9][0-9,.\s]+)/i);
  if (entry) out.entry = entry[1].trim();
  const sl = cleaned.match(/\b(?:sl|stop)[^0-9]*([0-9][0-9,.\s]+)/i);
  if (sl) out.sl = sl[1].trim();

  const asset = cleaned.match(/\b(BTC|ETH|SOL)\b/i);
  if (asset) out.asset = asset[1].toLowerCase();

  const dir = cleaned.match(/\b(LONG|SHORT)\b/i);
  if (dir) out.direction = dir[1].toLowerCase();

  return out;
}

function inferDirection(entry, sl, tp1) {
  const e = Number(String(entry).replace(/[, ]/g, ''));
  const s = Number(String(sl).replace(/[, ]/g, ''));
  const t = tp1 ? Number(String(tp1).replace(/[, ]/g, '')) : null;
  if (isFinite(e) && isFinite(s) && isFinite(t)) {
    if (t > e && s < e) return 'long';
    if (t < e && s > e) return 'short';
  }
  if (isFinite(e) && isFinite(s)) {
    return s < e ? 'long' : 'short';
  }
  return null;
}

// ===== Client =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== Interactions =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });

      // ---------- /signal (manual) ----------
      if (name === 'signal') {
        const s = await buildSignalFromInteraction(interaction);
        await postSignal(interaction, s);
        return;
      }

      // ---------- /signal-auto ----------
      if (name === 'signal-auto') {
        const caption = interaction.options.getString('caption', false) || '';
        const image = interaction.options.getAttachment('image', false);
        const timeframe = interaction.options.getString('timeframe', false);
        const risk = interaction.options.getNumber('risk', false);
        const reason = interaction.options.getString('reason', false);
        const chart = interaction.options.getString('chart', false);
        const channelOpt = interaction.options.getChannel('channel', false);

        let parsed = parseCaption(caption);

        // OCR fallback (beta)
        if ((!parsed.entry || !parsed.sl) && image?.url) {
          const text = await ocrImageToText(image.url);
          const fromOcr = guessFromOCR(text);
          parsed = { ...fromOcr, ...parsed }; // caption overrides OCR
        }

        // defaults for TP labels
        if (parsed.tp1 && parsed.tp1_close_pct == null) parsed.tp1_close_pct = 50;
        if (parsed.tp2 && parsed.tp2_close_pct == null) parsed.tp2_close_pct = 100;

        // infer direction if missing
        if (!parsed.direction && parsed.entry && parsed.sl) {
          parsed.direction = inferDirection(parsed.entry, parsed.sl, parsed.tp1) || 'long';
        }

        // If asset missing, force choose; we’ll default to ETH
        const asset = parsed.asset || 'eth';

        const s = {
          id: nanoid(8),
          authorId: interaction.user.id,
          authorTag: interaction.user.tag,
          asset,
          direction: parsed.direction || 'long',
          entry: parsed.entry || '—',
          entry_note: parsed.entry_note || null,
          sl: parsed.sl || '—',
          tp1: parsed.tp1 || null,
          tp1_close_pct: parsed.tp1_close_pct ?? null,
          tp2: parsed.tp2 || null,
          tp2_close_pct: parsed.tp2_close_pct ?? null,
          tp3: parsed.tp3 || null,
          tp3_close_pct: parsed.tp3_close_pct ?? null,
          timeframe: timeframe || null,
          risk: risk ?? null,
          reason: reason || null,
          chart: chart || null,
          status: 'Active',
          createdAt: Date.now(),
          messageLink: null
        };

        await postSignal(interaction, s, channelOpt);
        return;
      }

      // ---------- /signal-update ----------
      if (name === 'signal-update') {
        const id = interaction.options.getString('id', false);
        const messageLink = interaction.options.getString('message_link', false);

        const db = await loadDB();
        let s = null;

        if (id) s = db.signals[id];
        if (!s && messageLink) {
          s = Object.values(db.signals).find(x => x.messageLink === messageLink);
        }
        if (!s) return interaction.reply({ content: 'Signal not found (ID or message link).', ephemeral: true });

        const fieldsStr = ['entry','sl','tp1','tp2','tp3','timeframe','reason','chart'];
        let changed = false;
        for (const f of fieldsStr) {
          const val = interaction.options.getString(f, false);
          if (val !== null) { s[f] = val; changed = true; }
        }

        const riskNum = interaction.options.getNumber('risk', false);
        if (riskNum !== null) { s.risk = riskNum; changed = true; }

        const p1 = interaction.options.getNumber('tp1_close_pct', false);
        if (p1 !== null) { s.tp1_close_pct = p1; changed = true; }
        const p2 = interaction.options.getNumber('tp2_close_pct', false);
        if (p2 !== null) { s.tp2_close_pct = p2; changed = true; }
        const p3 = interaction.options.getNumber('tp3_close_pct', false);
        if (p3 !== null) { s.tp3_close_pct = p3; changed = true; }

        const status = interaction.options.getString('status', false);
        if (status !== null) { s.status = status; changed = true; }

        // Closing extras
        const result = interaction.options.getString('result', false);
        const r = interaction.options.getNumber('r', false);
        if (s.status === 'Closed' && (result || r !== null)) {
          s.closeInfo = `${result || ''}${r !== null ? ` • ${r}R` : ''}`.trim();
        } else if (s.status !== 'Closed') {
          s.closeInfo = null;
        }

        if (!changed) return interaction.reply({ content: 'Nothing to update.', ephemeral: true });

        const embed = makeSignalEmbed(s);
        await saveDB(db);

        // edit original message
        if (s.messageLink) {
          try {
            const url = new URL(s.messageLink);
            const parts = url.pathname.split('/');
            const channelId = parts[3];
            const messageId = parts[4];
            const channel = await interaction.guild.channels.fetch(channelId);
            const msg = await channel.messages.fetch(messageId);
            await msg.edit({ embeds: [embed], components: s.status === 'Closed' ? [] : [makeActionRow(s)] });
          } catch (_) {}
        }

        // update board (remove if Closed/Invalid)
        await renderBoard(interaction.guild, s.authorId);

        return interaction.reply({ content: `Updated ✔️ ${s.status === 'Closed' ? `(Closed ${s.closeInfo || ''})` : ''}`, ephemeral: true });
      }

      // ---------- /signal-close (shortcut) ----------
      if (name === 'signal-close') {
        const id = interaction.options.getString('id', true);
        const result = interaction.options.getString('result', true);
        const r = interaction.options.getNumber('r', false);

        const db = await loadDB();
        const s = db.signals[id];
        if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

        s.status = 'Closed';
        s.closeInfo = `${result}${r !== null ? ` • ${r}R` : ''}`;

        const embed = makeSignalEmbed(s);
        await saveDB(db);

        if (s.messageLink) {
          try {
            const url = new URL(s.messageLink);
            const parts = url.pathname.split('/');
            const channelId = parts[3];
            const messageId = parts[4];
            const channel = await interaction.guild.channels.fetch(channelId);
            const msg = await channel.messages.fetch(messageId);
            await msg.edit({ embeds: [embed], components: [] });
          } catch (_) {}
        }

        await renderBoard(interaction.guild, s.authorId);
        return interaction.reply({ content: `Closed ✔️ (${s.closeInfo})`, ephemeral: true });
      }
    }

    // ---------- Buttons ----------
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
        return interaction.reply({ content: `Use **/signal-update** with \`status:Closed\` (and result/R if needed).`, ephemeral: true });
      }

      const embed = makeSignalEmbed(s);
      await saveDB(db);

      // edit original
      if (s.messageLink) {
        try {
          const url = new URL(s.messageLink);
          const parts = url.pathname.split('/');
          const channelId = parts[3];
          const messageId = parts[4];
          const channel = await interaction.guild.channels.fetch(channelId);
          const msg = await channel.messages.fetch(messageId);
          await msg.edit({ embeds: [embed], components: [makeActionRow(s)] });
        } catch (_) {}
      }

      await renderBoard(interaction.guild, s.authorId);
      return interaction.reply({ content: `Status set to **${s.status}**.`, ephemeral: true });
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      interaction.reply({ content: 'Unexpected error. Check bot console.', ephemeral: true }).catch(() => {});
    }
  }
});

// ===== helpers =====
async function buildSignalFromInteraction(interaction) {
  const asset = interaction.options.getString('asset', true);
  const direction = interaction.options.getString('direction', true);
  const entry = interaction.options.getString('entry', true);
  const sl = interaction.options.getString('sl', true);
  const tp1 = interaction.options.getString('tp1', false);
  const tp2 = interaction.options.getString('tp2', false);
  const tp3 = interaction.options.getString('tp3', false);
  const tp1_close_pct = interaction.options.getNumber('tp1_close_pct', false) ?? (tp1 ? 50 : null);
  const tp2_close_pct = interaction.options.getNumber('tp2_close_pct', false) ?? (tp2 ? 100 : null);
  const tp3_close_pct = interaction.options.getNumber('tp3_close_pct', false) ?? null;
  const timeframe = interaction.options.getString('timeframe', false);
  const risk = interaction.options.getNumber('risk', false);
  const reason = interaction.options.getString('reason', false);
  const chart = interaction.options.getString('chart', false);
  const channelOpt = interaction.options.getChannel('channel', false);

  return {
    id: nanoid(8),
    authorId: interaction.user.id,
    authorTag: interaction.user.tag,
    asset, direction, entry, sl,
    tp1, tp1_close_pct,
    tp2, tp2_close_pct,
    tp3, tp3_close_pct,
    timeframe: timeframe || null,
    risk: risk ?? null,
    reason: reason || null,
    chart: chart || null,
    status: 'Active',
    createdAt: Date.now(),
    messageLink: null,
    _channelOpt: channelOpt || null
  };
}

async function postSignal(interaction, s, channelOptOverride = null) {
  const embed = makeSignalEmbed(s);
  const row = makeActionRow(s);

  // destination
  let target = null;
  const channelOpt = channelOptOverride || s._channelOpt;
  if (channelOpt) {
    if (channelOpt.type !== ChannelType.GuildText) {
      return interaction.reply({ content: 'Pick a **text** channel.', ephemeral: true });
    }
    target = channelOpt;
  } else {
    target = interaction.channel;
  }

  // optional role mention
  if (MENTION_ROLE_ID && MENTION_ROLE_ID.trim().length > 0) {
    await target.send({ content: `<@&${MENTION_ROLE_ID}>` }).catch(() => null);
  }

  const msg = await target.send({ embeds: [embed], components: [row] });
  s.messageLink = msg.url;

  const db = await loadDB();
  db.signals[s.id] = s;
  await saveDB(db);

  // Board update
  await renderBoard(interaction.guild, s.authorId);

  // Ephemeral confirmation (hide ID publicly)
  return interaction.reply({
    content: `Signal posted ✔️ • ID: **${s.id}** • [Jump](${s.messageLink})`,
    ephemeral: true
  });
}

client.login(DISCORD_TOKEN);
