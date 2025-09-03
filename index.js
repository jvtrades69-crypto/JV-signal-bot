import 'dotenv/config';
import { Client, REST, Routes, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder } from 'discord.js';
import fs from 'fs-extra';

// ---------- CONFIG ----------
const {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  CURRENT_TRADES_CHANNEL_ID,
  TRADER_ROLE_ID,
  BRAND_NAME = 'JV Trades'
} = process.env;

if (!DISCORD_TOKEN || !APPLICATION_ID || !GUILD_ID || !CURRENT_TRADES_CHANNEL_ID) {
  console.error('Missing env vars. Check .env');
  process.exit(1);
}

// No privileged intents needed (fixes “Used disallowed intents”)
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ---------- SIMPLE DB (JSON FILE) ----------
const DATA_DIR = './data';
const DB_PATH = `${DATA_DIR}/trades.json`;

await fs.ensureDir(DATA_DIR);
if (!(await fs.pathExists(DB_PATH))) await fs.writeJson(DB_PATH, { trades: {} }, { spaces: 2 });

const db = {
  read: async () => (await fs.readJson(DB_PATH)),
  write: async (data) => fs.writeJson(DB_PATH, data, { spaces: 2 }),
  getTrade: async (id) => (await db.read()).trades[id],
  setTrade: async (id, trade) => {
    const data = await db.read();
    data.trades[id] = trade;
    await db.write(data);
  },
  deleteTrade: async (id) => {
    const data = await db.read();
    delete data.trades[id];
    await db.write(data);
  }
};

// ---------- COMMAND REGISTRATION ----------
const commands = [
  new SlashCommandBuilder()
    .setName('trade')
    .setDescription('Create or manage trades')
    .addSubcommand(sub =>
      sub.setName('new')
        .setDescription('Create a new trade card')
        .addStringOption(o => o.setName('asset').setDescription('e.g. BTC, ETH, SOL, NQ, ES').setRequired(true))
        .addStringOption(o => o.setName('direction').setDescription('long/short').addChoices({name:'Long', value:'long'},{name:'Short', value:'short'}).setRequired(true))
        .addStringOption(o => o.setName('entry').setDescription('Entry price').setRequired(true))
        .addStringOption(o => o.setName('sl').setDescription('Stop loss').setRequired(true))
        .addStringOption(o => o.setName('tp1').setDescription('TP1').setRequired(false))
        .addStringOption(o => o.setName('tp2').setDescription('TP2').setRequired(false))
        .addStringOption(o => o.setName('tp3').setDescription('TP3').setRequired(false))
        .addStringOption(o => o.setName('reason').setDescription('Optional reason/notes').setRequired(false))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
    .toJSON()
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), { body: commands });
  console.log('✅ Slash commands registered.');
}

// ---------- UI HELPERS ----------
const dirEmoji = (d) => d === 'long' ? '🟢' : '🔴';
const titleLine = (a, d, active=true, be=false) =>
  `$${a.toUpperCase()} | ${d.toUpperCase()} ${dirEmoji(d)} ${active ? '(Active)' : '(Closed)'}${be ? ' — Stops @ BE ✅' : ''}`;

function buildEmbed({ asset, direction, entry, sl, tps=[], reason, ownerTag, active=true, be=false, createdAt, nextIndex }) {
  const embed = new EmbedBuilder()
    .setColor(direction === 'long' ? 0x25B0FF : 0xFF0000)
    .setTitle(titleLine(asset, direction, active, be))
    .addFields(
      { name: 'Entry', value: entry, inline: true },
      { name: 'SL', value: sl, inline: true },
      { name: 'Next', value: nextIndex !== null && nextIndex < tps.length ? `TP${nextIndex+1} ${tps[nextIndex]}` : '—', inline: true },
      { name: 'Targets', value: (tps.length ? tps.map((v,i)=>`TP${i+1}: ${v}`).join(' • ') : '—') },
    )
    .setFooter({ text: `${BRAND_NAME} • ${ownerTag}` })
    .setTimestamp(createdAt ?? new Date());
  if (reason) embed.addFields({ name: 'Reason', value: reason });
  return embed;
}

function controlRow(tradeId, disabled=false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`upd_${tradeId}`).setLabel('Update').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`tp1_${tradeId}`).setLabel('TP1 Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`tp2_${tradeId}`).setLabel('TP2 Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`tp3_${tradeId}`).setLabel('TP3 Hit').setStyle(ButtonStyle.Primary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`be_${tradeId}`).setLabel('Stops → BE').setStyle(ButtonStyle.Success).setDisabled(disabled)
  );
}
function controlRow2(tradeId, disabled=false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`partial_${tradeId}`).setLabel('Partial').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`addtp_${tradeId}`).setLabel('Add TP').setStyle(ButtonStyle.Secondary).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`close_${tradeId}`).setLabel('Close Trade').setStyle(ButtonStyle.Danger).setDisabled(disabled)
  );
}

function partialMenu(tradeId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`partialmenu_${tradeId}`)
      .setPlaceholder('Select partial close %')
      .addOptions(
        { label: '25%', value: '25' },
        { label: '50%', value: '50' },
        { label: '75%', value: '75' },
        { label: 'Custom…', value: 'custom' }
      )
  );
}

// ---------- PERMISSION CHECK ----------
function isAllowed(interaction, ownerId) {
  if (interaction.user.id === ownerId) return true;
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  if (TRADER_ROLE_ID && interaction.member?.roles?.valueOf()?.has?.(TRADER_ROLE_ID)) return true;
  return false;
}

// ---------- RUNTIME ----------
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  try {
    // Slash command: /trade new
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'trade' && interaction.options.getSubcommand() === 'new') {
        // Role/permission gate to create trades
        if (!isAllowed(interaction, interaction.user.id)) {
          return interaction.reply({ content: 'You are not allowed to create trades.', ephemeral: true });
        }

        const asset = interaction.options.getString('asset', true);
        const direction = interaction.options.getString('direction', true);
        const entry = interaction.options.getString('entry', true);
        const sl = interaction.options.getString('sl', true);
        const tp1 = interaction.options.getString('tp1');
        const tp2 = interaction.options.getString('tp2');
        const tp3 = interaction.options.getString('tp3');
        const reason = interaction.options.getString('reason') ?? '';

        const tps = [tp1, tp2, tp3].filter(Boolean);
        const channel = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);

        // Draft initial embed
        const trade = {
          id: '', // fill after send
          asset, direction, entry, sl, tps,
          reason,
          ownerId: interaction.user.id,
          ownerTag: interaction.user.tag,
          active: true,
          be: false,
          createdAt: new Date(),
          nextIndex: tps.length ? 0 : null, // first unhit tp
          partials: [] // {percent, at, note}
        };

        const msg = await channel.send({
          embeds: [buildEmbed(trade)],
          components: [controlRow('tmp'), controlRow2('tmp')]
        });

        // Update with IDs + buttons bound to id
        trade.id = msg.id;
        const jump = `https://discord.com/channels/${interaction.guildId}/${msg.channelId}/${msg.id}`;
        const embed = buildEmbed({ ...trade });
        embed.addFields({ name: 'Link', value: `[jump](${jump})` });
        await msg.edit({ embeds: [embed], components: [controlRow(trade.id), controlRow2(trade.id)] });

        await db.setTrade(trade.id, trade);
        return interaction.reply({ content: `Trade posted in <#${CURRENT_TRADES_CHANNEL_ID}>`, ephemeral: true });
      }
    }

    // Buttons
    if (interaction.isButton()) {
      const [action, tradeId] = interaction.customId.split('_');
      const trade = await db.getTrade(tradeId);
      if (!trade) return interaction.reply({ content: 'Trade not found.', ephemeral: true });

      if (!isAllowed(interaction, trade.ownerId)) {
        return interaction.reply({ content: 'Only the trade owner (or permitted role) can do that.', ephemeral: true });
      }
      if (!trade.active && action !== 'close') {
        return interaction.reply({ content: 'Trade is already closed.', ephemeral: true });
      }

      if (action === 'be') {
        trade.be = true; // stays active
        await db.setTrade(trade.id, trade);
        const channel = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
        const msg = await channel.messages.fetch(trade.id);
        await msg.edit({ embeds: [buildEmbed(trade)], components: [controlRow(trade.id), controlRow2(trade.id)] });
        return interaction.reply({ content: 'Stops moved to Breakeven ✅ (trade remains active).', ephemeral: true });
      }

      if (action.startsWith('tp')) {
        const idx = Number(action.replace('tp','')) - 1;
        if (idx >= 0 && idx < trade.tps.length) {
          // mark that TP as hit by advancing nextIndex
          if (trade.nextIndex !== null && idx >= trade.nextIndex) trade.nextIndex = idx + 1 < trade.tps.length ? idx + 1 : null;
          await db.setTrade(trade.id, trade);
          const channel = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
          const msg = await channel.messages.fetch(trade.id);
          await msg.edit({ embeds: [buildEmbed(trade)], components: [controlRow(trade.id), controlRow2(trade.id)] });
          return interaction.reply({ content: `Marked TP${idx+1} as hit.`, ephemeral: true });
        }
      }

      if (action === 'partial') {
        return interaction.reply({ content: 'Select a partial close %', components: [partialMenu(trade.id)], ephemeral: true });
      }

      if (action === 'addtp') {
        const modal = new ModalBuilder().setCustomId(`addtpmodal_${trade.id}`).setTitle('Add Take Profit');
        const tpField = new TextInputBuilder().setCustomId('tpv').setLabel('New TP value').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(tpField));
        return interaction.showModal(modal);
      }

      if (action === 'upd') {
        const modal = new ModalBuilder().setCustomId(`updmodal_${trade.id}`).setTitle('Update Trade');
        const eField = new TextInputBuilder().setCustomId('entry').setLabel('Entry (leave blank to keep)').setStyle(TextInputStyle.Short).setRequired(false);
        const sField = new TextInputBuilder().setCustomId('sl').setLabel('SL (leave blank to keep)').setStyle(TextInputStyle.Short).setRequired(false);
        const rField = new TextInputBuilder().setCustomId('reason').setLabel('Reason (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false);
        modal.addComponents(
          new ActionRowBuilder().addComponents(eField),
          new ActionRowBuilder().addComponents(sField),
          new ActionRowBuilder().addComponents(rField)
        );
        return interaction.showModal(modal);
      }

      if (action === 'close') {
        trade.active = false;
        await db.setTrade(trade.id, trade);
        const channel = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
        const msg = await channel.messages.fetch(trade.id);
        await msg.edit({ embeds: [buildEmbed(trade)], components: [controlRow(trade.id, true), controlRow2(trade.id, true)] });
        return interaction.reply({ content: 'Trade closed.', ephemeral: true });
      }
    }

    // Select menu for partials
    if (interaction.isStringSelectMenu()) {
      const [name, tradeId] = interaction.customId.split('_');
      if (name !== 'partialmenu') return;
      const trade = await db.getTrade(tradeId);
      if (!trade) return interaction.reply({ content: 'Trade not found.', ephemeral: true });
      if (!isAllowed(interaction, trade.ownerId)) return interaction.reply({ content: 'Not allowed.', ephemeral: true });

      const val = interaction.values[0];
      if (val === 'custom') {
        const modal = new ModalBuilder().setCustomId(`partialmodal_${trade.id}`).setTitle('Custom Partial %');
        const pField = new TextInputBuilder().setCustomId('pct').setLabel('Enter % (1-99)').setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(pField));
        return interaction.showModal(modal);
      } else {
        const percent = Number(val);
        trade.partials.push({ percent, at: new Date(), note: `Partial ${percent}%` });
        await db.setTrade(trade.id, trade);
        return interaction.update({ content: `Partial ${percent}% recorded.`, components: [], ephemeral: true });
      }
    }

    // Modals
    if (interaction.isModalSubmit()) {
      const [mtype, tradeId] = interaction.customId.split('_');
      const trade = await db.getTrade(tradeId);
      if (!trade) return interaction.reply({ content: 'Trade not found.', ephemeral: true });
      if (!isAllowed(interaction, trade.ownerId)) return interaction.reply({ content: 'Not allowed.', ephemeral: true });

      if (mtype === 'updmodal') {
        const newEntry = interaction.fields.getTextInputValue('entry')?.trim();
        const newSL = interaction.fields.getTextInputValue('sl')?.trim();
        const newReason = interaction.fields.getTextInputValue('reason')?.trim();

        if (newEntry) trade.entry = newEntry;
        if (newSL) trade.sl = newSL;
        if (newReason !== undefined) trade.reason = newReason;

        await db.setTrade(trade.id, trade);
        const channel = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
        const msg = await channel.messages.fetch(trade.id);
        await msg.edit({ embeds: [buildEmbed(trade)], components: [controlRow(trade.id), controlRow2(trade.id)] });
        return interaction.reply({ content: 'Trade updated.', ephemeral: true });
      }

      if (mtype === 'addtpmodal') {
        const tpv = interaction.fields.getTextInputValue('tpv')?.trim();
        if (tpv) {
          trade.tps.push(tpv);
          if (trade.nextIndex === null) trade.nextIndex = trade.tps.length - 1;
          await db.setTrade(trade.id, trade);
          const channel = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
          const msg = await channel.messages.fetch(trade.id);
          await msg.edit({ embeds: [buildEmbed(trade)], components: [controlRow(trade.id), controlRow2(trade.id)] });
          return interaction.reply({ content: `Added TP${trade.tps.length}: ${tpv}`, ephemeral: true });
        }
      }

      if (mtype === 'partialmodal') {
        const pct = Number(interaction.fields.getTextInputValue('pct'));
        if (isNaN(pct) || pct <= 0 || pct >= 100) return interaction.reply({ content: 'Enter a value between 1 and 99.', ephemeral: true });
        trade.partials.push({ percent: pct, at: new Date(), note: `Partial ${pct}%` });
        await db.setTrade(trade.id, trade);
        return interaction.reply({ content: `Partial ${pct}% recorded.`, ephemeral: true });
      }
    }

  } catch (err) {
    console.error(err);
    if (interaction.isRepliable()) {
      try { await interaction.reply({ content: `Error: ${String(err.message || err)}`, ephemeral: true }); } catch {}
    }
  }
});

// CLI: register-only mode
if (process.argv[2] === 'register') {
  await registerCommands();
  process.exit(0);
}

await registerCommands();
client.login(DISCORD_TOKEN);