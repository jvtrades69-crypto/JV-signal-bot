import {
  Client, GatewayIntentBits, Partials, Events,
  PermissionsBitField, ChannelType,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder
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
  ].filter(v => v !== null);  // keep "" for blank lines

  if (roleMentionAtBottom && MENTION_ROLE_ID?.trim()) lines.push(`<@&${MENTION_ROLE_ID}>`);
  return lines.join('\n');
}
const rowFor = id => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`sig_run_${id}`).setLabel('🚀 Mark Running').setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`sig_be_${id}`).setLabel('🟨 Set BE').setStyle(ButtonStyle.Secondary),
  new ButtonBuilder().setCustomId(`sig_close_${id}`).setLabel('✅ Close').setStyle(ButtonStyle.Danger),
);

/* ========== Bot Ready ========== */
client.once('ready', () => console.log(`Logged in as ${client.user.tag}`));

/* ========== Slash Commands ========== */
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    /* ====== /signal ====== */
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      if (!userAllowed(interaction)) {
        await interaction.reply({ content: 'Not allowed.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });

      const asset = interaction.options.getString('asset');
      const direction = interaction.options.getString('direction');
      const entry = interaction.options.getString('entry');
      const sl = interaction.options.getString('sl');
      const tp1 = interaction.options.getString('tp1');
      const tp2 = interaction.options.getString('tp2');
      const tp3 = interaction.options.getString('tp3');
      const reason = interaction.options.getString('reason');
      const image = interaction.options.getAttachment('chart');

      const id = Date.now().toString();
      const s = {
        id,
        authorId: interaction.user.id,
        asset, direction, entry, sl, tp1, tp2, tp3, reason,
        status: 'Active',
        statusNote: 'Active',
        createdAt: Date.now()
      };

      const content = buildContent(s, true);
      const msg = await interaction.channel.send({
        content,
        files: image ? [image] : [],
        components: [rowFor(id)]
      });

      s.messageLink = msg.url;
      const db = await loadDB();
      db.signals[id] = s; await saveDB(db);

      await interaction.editReply({ content: 'Signal posted ✅' });
      return;
    }

    /* ====== /signal-update ====== */
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal-update') {
      if (!userAllowed(interaction)) {
        await interaction.reply({ content: 'Not allowed.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });

      const id = interaction.options.getString('id');
      const db = await loadDB();
      const s = db.signals[id];
      if (!s) { await interaction.editReply('Signal not found'); return; }

      const entry = interaction.options.getString('entry');
      const sl = interaction.options.getString('sl');
      const tp1 = interaction.options.getString('tp1');
      const tp2 = interaction.options.getString('tp2');
      const tp3 = interaction.options.getString('tp3');
      const reason = interaction.options.getString('reason');
      const status = interaction.options.getString('status');
      const statusNote = interaction.options.getString('status_note');

      if (entry) s.entry = entry;
      if (sl) s.sl = sl;
      if (tp1) s.tp1 = tp1;
      if (tp2) s.tp2 = tp2;
      if (tp3) s.tp3 = tp3;
      if (reason) s.reason = reason;
      if (status) s.status = status;
      if (statusNote) s.statusNote = statusNote;

      const channel = await interaction.guild.channels.fetch(interaction.channelId);
      const msg = await channel.messages.fetch(s.messageLink.split('/').pop());
      await msg.edit({ content: buildContent(s, true), components: [rowFor(s.id)] });

      db.signals[id] = s; await saveDB(db);
      await interaction.editReply('Signal updated ✅');
      return;
    }

    /* ====== Button: Close ====== */
    if (interaction.isButton() && interaction.customId.startsWith('sig_close_')) {
      const id = interaction.customId.split('_')[2];
      const modal = new ModalBuilder()
        .setCustomId(`sig_close_modal_${id}`)
        .setTitle('Close Trade');

      const resultInput = new TextInputBuilder()
        .setCustomId('result')
        .setLabel('Result: Win / Loss / BE / Manual') // fixed label
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(resultInput));
      await interaction.showModal(modal);
      return;
    }

    // Handle modals (Close etc)
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('sig_close_modal_')) {
        const id = interaction.customId.split('_')[3];
        const db = await loadDB();
        const s = db.signals[id];
        if (!s) { await interaction.reply({ content: 'Signal not found', ephemeral: true }); return; }

        const result = interaction.fields.getTextInputValue('result');
        s.status = 'Closed';
        s.statusNote = result;

        const channel = await interaction.guild.channels.fetch(interaction.channelId);
        const msg = await channel.messages.fetch(s.messageLink.split('/').pop());
        await msg.edit({ content: buildContent(s, true), components: [] });

        db.signals[id] = s; await saveDB(db);
        await interaction.reply({ content: 'Trade closed ✅', ephemeral: true });
        return;
      }
    }

  } catch (e) {
    console.error('Handler error:', e);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: 'Unexpected error. Check bot console.', ephemeral: true }); } catch {}
    }
  }
});

client.login(DISCORD_TOKEN);
