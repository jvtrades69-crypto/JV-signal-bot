const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const STATUS_META = {
  RUNNING_VALID: { label: 'trade is still running', active: 'YES', reentry: 'Yes', be: false },
  RUNNING_BE:    { label: 'trade is still running', active: 'YES', reentry: 'No ( SL set to breakeven )', be: true },
  STOPPED_OUT:   { label: 'trade has stopped out', active: 'NO', reentry: 'No', be: false },
  STOPPED_BE:    { label: 'trade stopped at breakeven', active: 'NO', reentry: 'No ( SL set to breakeven )', be: true },
};

function buildEmbed(signal) {
  const status = STATUS_META[signal.status] ?? STATUS_META.RUNNING_VALID;
  const sideEmoji = signal.side === 'LONG' ? '🟢' : '🔴';

  // 📊 Trade Details
  let desc = `**📊 Trade Details**\n`;
  desc += `Entry: ${fmt(signal.entry)}\n`;
  desc += `Stop Loss: ${fmt(signal.sl)}\n`;
  if (signal.tp1) desc += `TP1: ${fmt(signal.tp1)}\n`;
  if (signal.tp2) desc += `TP2: ${fmt(signal.tp2)}\n`;
  if (signal.tp3) desc += `TP3: ${fmt(signal.tp3)}\n`;
  desc += `\n`;

  // 📝 Reasoning
  if (signal.rationale) {
    desc += `**📝 Reasoning**\n${signal.rationale.slice(0, 1000)}\n\n`;
  }

  // 📍 Status (compact format)
  let statusText = `**📍 Status**\n`;
  statusText += `Active : **${status.active}** - ${status.label}`;
  if (signal.latestTpHit) statusText += ` TP${signal.latestTpHit} hit`;
  statusText += `\nvalid for Re-entry: ${status.reentry}`;
  desc += statusText;

  const embed = new EmbedBuilder()
    .setTitle(`${signal.asset.toUpperCase()} | ${signal.side === 'LONG' ? 'Long' : 'Short'} ${sideEmoji}`)
    .setColor(signal.side === 'LONG' ? 0x00cc66 : 0xff3b30)
    .setDescription(desc)
    .setFooter({ text: `Signal • ID: ${signal.id}` })
    .setTimestamp(new Date(signal.createdAt || Date.now()));

  if (signal.imageUrl) embed.setImage(signal.imageUrl);
  return embed;
}

function fmt(v) {
  return v && String(v).trim() !== '' ? v : '-';
}

function components(signalId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`signal|${signalId}|status|RUNNING_VALID`).setLabel('Running (Valid)').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`signal|${signalId}|status|RUNNING_BE`).setLabel('Running (BE)').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`signal|${signalId}|status|STOPPED_OUT`).setLabel('Stopped Out').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`signal|${signalId}|status|STOPPED_BE`).setLabel('Stopped BE').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`signal|${signalId}|tp|1`).setLabel('🎯 TP1 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`signal|${signalId}|tp|2`).setLabel('🎯 TP2 Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`signal|${signalId}|tp|3`).setLabel('🎯 TP3 Hit').setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`signal|${signalId}|edit`).setLabel('Edit').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`signal|${signalId}|delete`).setLabel('Delete').setStyle(ButtonStyle.Danger),
    )
  ];
}

module.exports = { buildEmbed, components, STATUS_META };