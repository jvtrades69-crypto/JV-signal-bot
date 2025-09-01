const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, PermissionsBitField, Events
} = require('discord.js');
const { config } = require('dotenv');
const fs = require('fs-extra');
const path = require('path');
const { nanoid } = require('nanoid');

config();

const {
  DISCORD_TOKEN,
  OWNER_USER_ID,
  ALLOWED_ROLE_ID,
  MENTION_ROLE_ID
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN in .env');
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel]
});

// ==== simple JSON storage ====
const DB_PATH = path.join(__dirname, 'signals.json');
async function loadDB() {
  try {
    const exists = await fs.pathExists(DB_PATH);
    if (!exists) return { signals: {} };
    return JSON.parse(await fs.readFile(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('DB read error:', e);
    return { signals: {} };
  }
}
async function saveDB(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ==== perms helper ====
function userAllowed(interaction) {
  if (!interaction?.member) return false;
  if (OWNER_USER_ID && interaction.user.id === OWNER_USER_ID) return true;
  if (ALLOWED_ROLE_ID && interaction.member.roles?.cache?.has(ALLOWED_ROLE_ID)) return true;
  return interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
}

// ==== embed render (pro format) ====
function fmtPct(p) {
  if (p == null) return null;
  const n = Number(p);
  if (!isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function code(x) { return `\`${x}\``; }

function titleFrom(s) {
  const asset = s.asset.toUpperCase();
  const dir = s.direction.toUpperCase();
  const tf = s.timeframe ? ` (${s.timeframe})` : '';
  const emoji = s.direction.toLowerCase() === 'long' ? '🟢' : '🔴';
  return `${emoji} $${asset} | ${dir}${tf}`;
}

function makeSignalEmbed(s) {
  const color = s.direction.toLowerCase() === 'long' ? 0x00A86B : 0xE63946; // green/red
  const e = new EmbedBuilder()
    .setTitle(titleFrom(s))
    .setColor(color)
    .setTimestamp(new Date(s.createdAt))
    .setFooter({ text: `Signal ID: ${s.id} • Status: ${s.status}` });

  // 📌 Reason (optional)
  if (s.reason && s.reason.trim().length) {
    e.addFields({ name: '📌 Reason for Setup', value: s.reason.trim().slice(0, 1024) });
  }

  // 📊 Trade details
  const lines = [];
  lines.push(`**Entry:** ${code(s.entry)}`);
  lines.push(`**Stop Loss:** ${code(s.sl)}`);
  if (s.tp1) {
    const pct = fmtPct(s.tp1_close_pct) ?? 50;
    lines.push(`**TP1:** ${code(s.tp1)} (${pct === 100 ? 'final target 🎯' : `close ${pct}% 📉`})`);
  }
  if (s.tp2) {
    const pct = fmtPct(s.tp2_close_pct);
    const label = (pct == null || pct >= 100) ? 'final target 🎯' : `close ${pct}% 📉`;
    lines.push(`**TP2:** ${code(s.tp2)} (${label})`);
  }
  if (s.tp3) {
    const pct = fmtPct(s.tp3_close_pct);
    const label = (pct == null || pct >= 100) ? 'final target 🎯' : `close ${pct}% 📉`;
    lines.push(`**TP3:** ${code(s.tp3)} (${label})`);
  }
  e.addFields({ name: '📊 Trade Details', value: lines.join('\n') });

  // 💵 Risk (optional)
  if (s.risk != null) {
    e.addFields({ name: '💵 Risk', value: `${s.risk}%`, inline: true });
  }

  // 🔗 Chart (optional)
  if (s.chart) {
    e.addFields({ name: '🔗 Chart / Setup', value: `<${s.chart}>` });
  }

  return e;
}

function makeActionRow(s) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`signal_run_${s.id}`).setLabel('Mark Running').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`signal_update_${s.id}`).setLabel('Update').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`signal_close_${s.id}`).setLabel('Close').setStyle(ButtonStyle.Danger)
  );
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

// ==== interactions ====
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;

      // /signal
      if (name === 'signal') {
        if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });

        const asset = interaction.options.getString('asset', true);               // choices: btc/eth/sol
        const direction = interaction.options.getString('direction', true);       // long/short
        const entry = interaction.options.getString('entry', true);
        const sl = interaction.options.getString('sl', true);
        const tp1 = interaction.options.getString('tp1', false);
        const tp2 = interaction.options.getString('tp2', false);
        const tp3 = interaction.options.getString('tp3', false);
        const tp1_close_pct = interaction.options.getNumber('tp1_close_pct', false) ?? 50;
        const tp2_close_pct = interaction.options.getNumber('tp2_close_pct', false) ?? 100;
        const tp3_close_pct = interaction.options.getNumber('tp3_close_pct', false) ?? null;
        const timeframe = interaction.options.getString('timeframe', false);
        const risk = interaction.options.getNumber('risk', false);
        const reason = interaction.options.getString('reason', false);
        const chart = interaction.options.getString('chart', false);
        const channelOpt = interaction.options.getChannel('channel', false);

        const s = {
          id: nanoid(8),
          asset, direction, entry, sl, tp1, tp2, tp3,
          tp1_close_pct, tp2_close_pct, tp3_close_pct,
          timeframe, risk, reason, chart,
          status: 'Open',
          createdAt: Date.now(),
          messageLink: null
        };

        const embed = makeSignalEmbed(s);
        const row = makeActionRow(s);

        // choose destination (prefer provided, else where command was used)
        let target = null;
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

        return interaction.reply({
          content: `Signal posted ✔️ • ID: **${s.id}** • [Jump](${s.messageLink})`,
          ephemeral: true
        });
      }

      // /signal-update
      if (name === 'signal-update') {
        if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const id = interaction.options.getString('id', true);
        const db = await loadDB();
        const s = db.signals[id];
        if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

        const fields = ['entry','sl','tp1','tp2','tp3','timeframe','reason','chart'];
        let changed = false;
        for (const f of fields) {
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

        if (!changed) return interaction.reply({ content: 'Nothing to update.', ephemeral: true });

        const embed = makeSignalEmbed(s);
        await saveDB(db);

        // try to edit original message
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

        return interaction.reply({ content: `Signal **${id}** updated.`, ephemeral: true });
      }

      // /signal-close
      if (name === 'signal-close') {
        if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const id = interaction.options.getString('id', true);
        const result = interaction.options.getString('result', true); // Win/Loss/Breakeven/Manual Close
        const r = interaction.options.getNumber('r', false);

        const db = await loadDB();
        const s = db.signals[id];
        if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

        s.status = `Closed (${result}${r !== null ? ` • ${r}R` : ''})`;

        const embed = makeSignalEmbed(s).setColor(0x6C757D);
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

        return interaction.reply({ content: `Signal **${id}** closed as **${result}**${r !== null ? ` (${r}R)` : ''}.`, ephemeral: true });
      }
    }

    // Buttons
    if (interaction.isButton()) {
      if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
      const [prefix, action, id] = interaction.customId.split('_'); // signal_run_ID
      if (prefix !== 'signal') return;

      const db = await loadDB();
      const s = db.signals[id];
      if (!s) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

      if (action === 'run') {
        s.status = 'Running';
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
            await msg.edit({ embeds: [embed], components: [makeActionRow(s)] });
          } catch (_) {}
        }

        return interaction.reply({ content: `Signal **${id}** marked **Running**.`, ephemeral: true });
      }

      if (action === 'update') {
        return interaction.reply({ content: `Use **/signal-update id:${id}** with any fields to change.`, ephemeral: true });
      }

      if (action === 'close') {
        return interaction.reply({ content: `Use **/signal-close id:${id}** and set result + R.`, ephemeral: true });
      }
    }
  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      interaction.reply({ content: 'Unexpected error. Check bot console.', ephemeral: true }).catch(() => {});
    }
  }
});

client.login(DISCORD_TOKEN);
