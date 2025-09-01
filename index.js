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

// ==== embed render ====
function makeSignalEmbed(s) {
  const dirColor = s.direction.toLowerCase() === 'long' ? 0x00A86B : 0xE63946; // green/red
  const title = `${s.asset.toUpperCase()} | ${s.direction.toUpperCase()} ${s.timeframe ? `(${s.timeframe})` : ''}`.trim();

  const rows = [
    `**Entry:** ${s.entry}`,
    `**SL:** ${s.sl}`,
    s.tp1 ? `**TP1:** ${s.tp1}` : null,
    s.tp2 ? `**TP2:** ${s.tp2}` : null,
    s.tp3 ? `**TP3:** ${s.tp3}` : null,
    s.risk ? `**Risk:** ${s.risk}%` : null,
    s.chart ? `**Chart:** ${s.chart}` : null
  ].filter(Boolean);

  const desc = rows.join(' • ').replace('**Chart:**', '\n**Chart:**');

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(desc)
    .setFooter({ text: `Signal ID: ${s.id} • Status: ${s.status}` })
    .setTimestamp(new Date(s.createdAt))
    .setColor(dirColor);
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

        const asset = interaction.options.getString('asset', true);
        const direction = interaction.options.getString('direction', true);
        const entry = interaction.options.getString('entry', true);
        const sl = interaction.options.getString('sl', true);
        const tp1 = interaction.options.getString('tp1', false);
        const tp2 = interaction.options.getString('tp2', false);
        const tp3 = interaction.options.getString('tp3', false);
        const timeframe = interaction.options.getString('timeframe', false);
        const risk = interaction.options.getNumber('risk', false);
        const chart = interaction.options.getString('chart', false);
        const channelOpt = interaction.options.getChannel('channel', false);

        const s = {
          id: nanoid(8),
          asset, direction, entry, sl, tp1, tp2, tp3,
          timeframe, risk, chart,
          status: 'Open',
          createdAt: Date.now(),
          messageLink: null
        };

        const embed = makeSignalEmbed(s);
        const row = makeActionRow(s);

        // pick destination (prefer provided, else where the command was used)
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

        const fields = ['entry','sl','tp1','tp2','tp3','chart','timeframe'];
        let changed = false;
        for (const f of fields) {
          const val = interaction.options.getString(f, false);
          if (val !== null) { s[f] = val; changed = true; }
        }
        const riskNum = interaction.options.getNumber('risk', false);
        if (riskNum !== null) { s.risk = riskNum; changed = true; }

        if (!changed) return interaction.reply({ content: 'Nothing to update.', ephemeral: true });

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

        return interaction.reply({ content: `Signal **${id}** updated.`, ephemeral: true });
      }

      // /signal-close
      if (name === 'signal-close') {
        if (!userAllowed(interaction)) return interaction.reply({ content: 'No permission.', ephemeral: true });
        const id = interaction.options.getString('id', true);
        const result = interaction.options.getString('result', true);
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
      const [prefix, action, id] = interaction.customId.split('_');
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
        return interaction.reply({ content: `Use **/signal-update id:${id}** with the fields you want to change.`, ephemeral: true });
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
