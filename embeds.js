const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const COLORS = {
  long: 0x25b0ff,
  short: 0xff3b30,
  neutral: 0x5865F2,
  running_valid: 0x00cc66,
  running_be: 0xffc107,
  stopped_out: 0xff3b30,
  stopped_be: 0x99aab5,
};

const STATUS_META = {
  RUNNING_VALID: { label: 'Running (Valid entry)', emoji: '🟢', color: COLORS.running_valid, reentry: 'Yes' },
  RUNNING_BE:    { label: 'Running (BE — No re-entry)', emoji: '🟡', color: COLORS.running_be, reentry: 'No' },
  STOPPED_OUT:   { label: 'Stopped Out', emoji: '🔴', color: COLORS.stopped_out, reentry: 'No' },
  STOPPED_BE:    { label: 'Stopped at Breakeven', emoji: '⚪️', color: COLORS.stopped_be, reentry: 'No' },
};

function buildStatusText(signal) {
  const status = STATUS_META[signal.status] ?? STATUS_META.RUNNING_VALID;
  const running = (signal.status === 'RUNNING_VALID' || signal.status === 'RUNNING_BE');
  const latest = signal.latestTpHit ? `, TP${signal.latestTpHit} hit` : '';
  const beFlag = (signal.status === 'RUNNING_BE' || signal.status === 'STOPPED_BE') ? ' • Stops: BE 🟨' : '';
  const activeLine = running
    ? `Active: **YES** — trade is still running${latest}`
    : `Active: **NO** — ${status.label}`;
  const reentryLine = `Valid for Re-entry: **${status.reentry}**` + (status.reentry === 'No' ? ' (SL set to breakeven)' : '');
  return `${activeLine}\n${reentryLine}${beFlag}`.slice(0, 1024);
}

function buildEmbed(signal) {
  const baseColor = signal.side === 'LONG' ? COLORS.long : (signal.side === 'SHORT' ? COLORS.short : COLORS.neutral);
  const status = STATUS_META[signal.status] ?? STATUS_META.RUNNING_VALID;
  const color = status.color || baseColor;

  const title = `$${signal.asset.toUpperCase()} | ${signal.side === 'LONG' ? 'Long' : 'Short'} ${signal.side === 'LONG' ? '🔵' : '🔴'}`;
  const fields = [
    { name: 'Entry', value: code(signal.entry), inline: true },
    { name: 'SL', value: code(signal.sl || '-'), inline: true },
  ];

  const tpVals = [signal.tp1, signal.tp2, signal.tp3].filter(Boolean);
  fields.push({ name: 'Targets', value: code(tpVals.length ? tpVals.join(' | ') : '-'), inline: true });

  if (signal.timeframe) fields.push({ name: 'Timeframe', value: code(signal.timeframe), inline: true });

  fields.push({ name: '📍 Status', value: buildStatusText(signal), inline: false });

  if (signal.rationale) fields.push({ name: 'Reason', value: signal.rationale.slice(0, 1000) });

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(fields)
    .setFooter({ text: `Signal • ID: ${signal.id}` })
    .setTimestamp(new Date(signal.createdAt || Date.now()));

  if (signal.imageUrl) embed.setImage(signal.imageUrl);
  return embed;
}

function code(v) { return '```' + String(v) + '```'; }

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
