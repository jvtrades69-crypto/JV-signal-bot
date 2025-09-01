const {
  Client, GatewayIntentBits, Partials,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionsBitField, Events,
  ModalBuilder, TextInputBuilder, TextInputStyle
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

// ===== DB =====
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
async function saveDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ===== Perms =====
function userAllowed(interaction) {
  if (!interaction?.member) return false;
  if (OWNER_USER_ID && interaction.user.id === OWNER_USER_ID) return true;
  if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) return true;
  for (const r of TRADER_ROLES) {
    if (interaction.member.roles?.cache?.has(r)) return true;
  }
  return false;
}

// ===== Helpers =====
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
function statusEmoji(s) {
  if (s === 'Running') return '🚀';
  if (s === 'BE') return '🟨';
  if (s === 'Invalid') return '❌';
  if (s === 'Closed') return '✅';
  return '🟢';
}
function directionEmoji(dir) {
  return (dir?.toLowerCase() === 'long') ? '🟢' : '🔴';
}
function buildMessageContent(s, includeMentionAtBottom = false) {
  const header = `${directionEmoji(s.direction)} $${s.asset.toUpperCase()} | ${s.direction.toUpperCase()}${s.timeframe ? ` (${s.timeframe})` : ''}`;
  const tradeLines = [
    `Entry: ${code(normPrice(s.entry))}${s.entry_note ? ` (${s.entry_note})` : ''}`,
    `Stop Loss: ${code(normPrice(s.sl))}`,
    s.tp1 ? `TP1: ${code(normPrice(s.tp1))} (${(fmtPct(s.tp1_close_pct) ?? 50) === 100 ? 'final target 🎯' : `close ${fmtPct(s.tp1_close_pct) ?? 50}% 📉`})` : null,
    s.tp2 ? `TP2: ${code(normPrice(s.tp2))} (${(fmtPct(s.tp2_close_pct) ?? 100) === 100 ? 'final target 🎯' : `close ${fmtPct(s.tp2_close_pct)}% 📉`})` : null,
    s.tp3 ? `TP3: ${code(normPrice(s.tp3))} (${(fmtPct(s.tp3_close_pct) ?? 100) === 100 ? 'final target 🎯' : `close ${fmtPct(s.tp3_close_pct)}% 📉`})` : null
  ].filter(Boolean);

  const parts = [
    header,
    '',
    '📊 **Trade Details**',
    ...tradeLines,
    '',
    s.reason ? `📌 **Reason**\n${s.reason}` : null,
    '',
    '📍 **Status**',
    `${statusEmoji(s.status)} ${s.status}`,
    ''
  ].filter(Boolean);

  if (includeMentionAtBottom && MENTION_ROLE_ID && MENTION_ROLE_ID.trim().length > 0) {
    parts.push(`<@&${MENTION_ROLE_ID}>`);
  }
  return parts.join('\n');
}

// ===== Boards (Current Trades) =====
async function ensureBoardMessage(guild, userId) {
  if (!CURRENT_TRADES_CHANNEL_ID) return null;
  const db = await loadDB();
  const existing = db.boards[userId];
  const chan = await guild.channels.fetch(CURRENT_TRADES_CHANNEL_ID).catch(() => null);
  if (!chan || chan.type !== ChannelType.GuildText) return null;

  if (existing?.messageId) {
    return { channel: chan, messageId: existing.messageId };
  }
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
  if (!open.length) {
    content += `_No open trades._`;
  } else {
    content += open.map(s => {
      const line = `• ${statusEmoji(s.status)} **${s.asset.toUpperCase()} | ${s.direction.toUpperCase()}${s.timeframe ? ` (${s.timeframe})` : ''}** — Entry ${code(normPrice(s.entry))}, SL ${code(normPrice(s.sl))}${s.tp1 ? `, TP1 ${code(normPrice(s.tp1))}` : ''}${s.tp2 ? `, TP2 ${code(normPrice(s.tp2))}` : ''}\n  ↪️ [Jump](${s.messageLink})`;
      return line;
    }).join('\n\n');
  }

  try {
    const msg = await channel.messages.fetch(messageId);
    await msg.edit({ content });
  } catch {
    const msg = await channel.send({ content });
    db.boards[userId] = { messageId: msg.id };
    await saveDB(db);
  }
}

// ===== Parsing & OCR =====
function parseCaption(caption) {
  if (!caption) return {};
  const out = {};

  // Asset | Direction
  const header = caption.match(/\b(BTC|ETH|SOL)\b.*?\b(LONG|SHORT)\b/i);
  if (header) {
    out.asset = header[1].toLowerCase();
    out.direction = header[2].toLowerCase();
  }

  // Entry: allow "Entry (103,201)" or "entry 103201" or "e=103201" or "market (..)"
  const entryParen = caption.match(/entry[^0-9]*\(([0-9,.\s]+)\)/i);
  const entryA = entryParen?.[1] || (caption.match(/\b(?:entry|e|@e|e=)\s*[:=]?\s*([0-9,.\s]+)/i)?.[1]);
  if (entryA) out.entry = entryA.trim();
  if (/market/i.test(caption)) out.entry_note = 'Market';

  // Stop loss
  const slA = caption.match(/\b(?:sl|stop|s|sl=)\s*[:=]?\s*([0-9,.\s]+)/i)?.[1];
  if (slA) out.sl = slA.trim();

  // TP1/TP2/TP3 with optional @%
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
  } catch {
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
  if (isFinite(e) && isFinite(s)) return s < e ? 'long' : 'short';
  return null;
}

// ===== Buttons row =====
function makeActionRow(id) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal_run_${id}`).setLabel('🚀 Mark Running').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signal_be_${id}`).setLabel('🟨 Set BE').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signal_close_${id}`).setLabel('✅ Close').setStyle(ButtonStyle.Danger)
  );
}

// ===== Client =====
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ===== Interactions =====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Slash commands
    if (interaction.isChatInputCommand()) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });

      const name = interaction.commandName;

      // ---------- /signal-auto ----------
      if (name === 'signal-auto') {
        const caption = interaction.options.getString('caption', false) || '';
        const image = interaction.options.getAttachment('image', false);
        const timeframe = interaction.options.getString('timeframe', false);
        const risk = interaction.options.getNumber('risk', false);
        const reason = interaction.options.getString('reason', false);
        const channelOpt = interaction.options.getChannel('channel', false);

        let parsed = parseCaption(caption);

        // OCR fallback
        if ((!parsed.entry || !parsed.sl) && image?.url) {
          const text = await ocrImageToText(image.url);
          const fromOcr = guessFromOCR(text);
          parsed = { ...fromOcr, ...parsed }; // caption overrides OCR
        }

        if (parsed.tp1 && parsed.tp1_close_pct == null) parsed.tp1_close_pct = 50;
        if (parsed.tp2 && parsed.tp2_close_pct == null) parsed.tp2_close_pct = 100;
        if (!parsed.direction && parsed.entry && parsed.sl) parsed.direction = inferDirection(parsed.entry, parsed.sl, parsed.tp1) || 'long';

        const s = {
          id: nanoid(8),
          authorId: interaction.user.id,
          asset: (parsed.asset || 'eth'),
          direction: (parsed.direction || 'long'),
          timeframe: timeframe || null,
          entry: parsed.entry || '—',
          entry_note: parsed.entry_note || null,
          sl: parsed.sl || '—',
          tp1: parsed.tp1 || null, tp1_close_pct: parsed.tp1_close_pct ?? null,
          tp2: parsed.tp2 || null, tp2_close_pct: parsed.tp2_close_pct ?? null,
          tp3: parsed.tp3 || null, tp3_close_pct: parsed.tp3_close_pct ?? null,
          risk: risk ?? null,
          reason: reason || null,
          status: 'Active',
          createdAt: Date.now(),
          messageLink: null,
          hasImage: !!image
        };

        // destination
        let target = channelOpt ? channelOpt : interaction.channel;
        if (target.type !== ChannelType.GuildText) {
          return interaction.reply({ content: 'Pick a **text** channel.', ephemeral: true });
        }

        // build message content (with mention at bottom)
        const content = buildMessageContent(s, true);

        // assemble message payload (attach image if present)
        const payload = { content, components: [makeActionRow(s.id)] };
        if (image?.url) {
          const res = await fetch(image.url);
          const buf = Buffer.from(await res.arrayBuffer());
          const name = image.name || 'chart.png';
          payload.files = [{ attachment: buf, name }];
        }

        const msg = await target.send(payload);
        s.messageLink = msg.url;

        // save
        const db = await loadDB();
        db.signals[s.id] = s;
        await saveDB(db);

        // update board
        await renderBoard(interaction.guild, s.authorId);

        // ephemeral confirmation with ID
        return interaction.reply({ content: `Signal posted ✔️ • ID: **${s.id}** • [Jump](${s.messageLink})`, ephemeral: true });
      }

      // ---------- /signal-update ----------
      if (name === 'signal-update') {
        const id = interaction.options.getString('id', false);
        const messageLink = interaction.options.getString('message_link', false);

        const db = await loadDB();
        let s = null;
        if (id) s = db.signals[id];
        if (!s && messageLink) s = Object.values(db.signals).find(x => x.messageLink === messageLink);
        if (!s) return interaction.reply({ content: 'Signal not found (ID or message link).', ephemeral: true });

        // string fields
        const strFields = ['asset','direction','timeframe','entry','sl','tp1','tp2','tp3','reason'];
        let changed = false;
        for (const f of strFields) {
          const val = interaction.options.getString(f, false);
          if (val !== null) { s[f] = val; changed = true; }
        }

        // numbers
        const numFieldSpecs = [
          ['tp1_close_pct','tp1'], ['tp2_close_pct','tp2'], ['tp3_close_pct','tp3'], ['risk', null]
        ];
        for (const [name, depends] of numFieldSpecs) {
          const v = interaction.options.getNumber(name, false);
          if (v !== null) {
            if (!depends || s[depends]) { s[name] = v; changed = true; }
          }
        }

        // status/result/R
        const newStatus = interaction.options.getString('status', false);
        if (newStatus !== null) { s.status = newStatus; changed = true; }
        const result = interaction.options.getString('result', false);
        const r = interaction.options.getNumber('r', false);
        if (s.status === 'Closed' && (result || r !== null)) {
          s.closeInfo = `${result || ''}${r !== null ? ` • ${r}R` : ''}`.trim();
        } else if (s.status !== 'Closed') {
          s.closeInfo = null;
        }

        // image replacement
        const newImg = interaction.options.getAttachment('image', false);
        let newFile = null;
        if (newImg?.url) {
          const res = await fetch(newImg.url);
          const buf = Buffer.from(await res.arrayBuffer());
          newFile = { attachment: buf, name: newImg.name || 'chart.png' };
          s.hasImage = true;
        }

        if (!changed && !newFile) {
          return interaction.reply({ content: 'Nothing to update.', ephemeral: true });
        }

        await saveDB(db);

        // edit original message
        try {
          const url = new URL(s.messageLink);
          const parts = url.pathname.split('/');
          const channelId = parts[3];
          const messageId = parts[4];
          const channel = await interaction.guild.channels.fetch(channelId);
          const msg = await channel.messages.fetch(messageId);

          const content = buildMessageContent(s, false); // no mention on edits
          const components = (s.status === 'Closed' || s.status === 'Invalid') ? [] : [makeActionRow(s.id)];

          if (newFile) {
            await msg.edit({ content, components, files: [newFile], attachments: [] });
          } else {
            await msg.edit({ content, components });
          }
        } catch (e) {
          console.error('Edit failed:', e);
        }

        await renderBoard(interaction.guild, s.authorId);

        return interaction.reply({ content: `Updated ✔️${s.status === 'Closed' ? ` (Closed ${s.closeInfo || ''})` : ''}`, ephemeral: true });
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
        // Show modal to collect result + R
        const modal = new ModalBuilder().setCustomId(`signal_close_modal_${id}`).setTitle('Close Trade');
        const resultInput = new TextInputBuilder()
          .setCustomId('result').setLabel('Result (Win / Loss / Breakeven / Manual Close)')
          .setStyle(TextInputStyle.Short).setRequired(true);
        const rInput = new TextInputBuilder()
          .setCustomId('rmultiple').setLabel('R multiple (e.g., 2.5) — optional')
          .setStyle(TextInputStyle.Short).setRequired(false);
        const row1 = new ActionRowBuilder().addComponents(resultInput);
        const row2 = new ActionRowBuilder().addComponents(rInput);
        modal.addComponents(row1, row2);
        return interaction.showModal(modal);
      }

      await saveDB(db);

      // edit original
      try {
        const url = new URL(s.messageLink);
        const parts = url.pathname.split('/');
        const channelId = parts[3];
        const messageId = parts[4];
        const channel = await interaction.guild.channels.fetch(channelId);
        const msg = await channel.messages.fetch(messageId);
        const content = buildMessageContent(s, false);
        await msg.edit({ content, components: [makeActionRow(s.id)] });
      } catch {}

      await renderBoard(interaction.guild, s.authorId);
      return interaction.reply({ content: `Status set to **${s.status}**.`, ephemeral: true });
    }

    // ---------- Modal submit (Close) ----------
    if (interaction.isModalSubmit() && interaction.customId.startsWith('signal_close_modal_')) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });

      const id = interaction.customId.replace('signal_close_modal_', '');
      const db = await loadDB();
      const s = db.signals[id];
      if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      const resultRaw = interaction.fields.getTextInputValue('result')?.trim() || '';
      const rRaw = interaction.fields.getTextInputValue('rmultiple')?.trim();

      const allowed = new Map([
        ['win','Win'],
        ['loss','Loss'],
        ['lose','Loss'],
        ['breakeven','Breakeven'],
        ['be','Breakeven'],
        ['manual close','Manual Close'],
        ['manual','Manual Close'],
        ['manualclose','Manual Close']
      ]);

      const key = resultRaw.toLowerCase();
      const normalized = allowed.get(key) || allowed.get(key.replace(/\s+/g,''));
      if (!normalized) {
        return interaction.reply({ content: 'Invalid result. Use: Win, Loss, Breakeven, Manual Close.', ephemeral: true });
      }

      let r = null;
      if (rRaw && rRaw.length) {
        const n = Number(rRaw.replace(/[^0-9.+-]/g,''));
        if (isFinite(n)) r = n;
      }

      s.status = 'Closed';
      s.closeInfo = `${normalized}${r != null ? ` • ${r}R` : ''}`;

      await saveDB(db);

      // edit original
      try {
        const url = new URL(s.messageLink);
        const parts = url.pathname.split('/');
        const channelId = parts[3];
        const messageId = parts[4];
        const channel = await interaction.guild.channels.fetch(channelId);
        const msg = await channel.messages.fetch(messageId);
        const content = buildMessageContent(s, false);
        await msg.edit({ content, components: [] });
      } catch (e) {
        console.error('Edit message after close failed:', e);
      }

      await renderBoard(interaction.guild, s.authorId);
      return interaction.reply({ content: `Closed ✔️ (${s.closeInfo})`, ephemeral: true });
    }

  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      interaction.reply({ content: 'Unexpected error. Check bot console.', ephemeral: true }).catch(() => {});
    }
  }
});
client.login(DISCORD_TOKEN);
