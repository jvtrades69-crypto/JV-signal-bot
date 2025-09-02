const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/** Colors + status metadata */
const COLORS = {
  long: 0x00cc66,     // green for Long
  short: 0xff3b30,    // red for Short
  neutral: 0x5865F2,
  running_valid: 0x00cc66,
  running_be: 0xffc107,
  stopped_out: 0xff3b30,
  stopped_be: 0x99aab5,
};

const STATUS_META = {
  RUNNING_VALID: { label: 'Running (Valid entry)', color: COLORS.running_valid, reentry: 'Yes' },
  RUNNING_BE:    { label: 'Running (BE — No re-entry)', color: COLORS.running_be, reentry: 'No' },
  STOPPED_OUT:   { label: 'Stopped Out', color: COLORS.stopped_out, reentry: 'No' },
  STOPPED_BE:    { label: 'Stopped at Breakeven', color: COLORS.stopped_be, reentry: 'No' },
};

/** Helper: inline code block */
const code = (v) => '```' + String(v) + '```';

/** Build the exact description layout you requested */
function buildDescription(signal) {
  // 📊 Trade Details block
  const details = [];
  details.push('📊 **Trade Details**');
  details.push(`Entry: ${signal.entry ? code(signal.entry) : '—'}`);
  details.push(`SL: ${signal.sl ? code(signal.sl) : '—'}`);

  // Targets
  const tps = [signal.tp1, signal.tp2, signal.tp3].filter(Boolean);
  if (tps.length) {
    // Show each TP on its own line if provided
    if (signal.tp1) details.push(`TP1: ${code(signal.tp1)}`);
    if (signal.tp2) details.push(`TP2: ${code(signal.tp2)}`);
    if (signal.tp3) details.push(`TP3: ${code(signal.tp3)}`);
  } else {
    details.push('TPs: —');
  }

  if (signal.timeframe) details.push(`Timeframe: ${code(signal.timeframe)}`);

  // 📝 Reasoning (optional)
  const parts = [];
  parts.push(details.join('\n'));

  if (signal.rationale && signal.rationale.trim() !== '') {
    parts.push('\n📝 **Reasoning**');
    parts.push(signal.rationale.trim().slice(0, 1000));
  }

  // 📍 Status block
  const status = STATUS_META[signal.status] ?? STATUS_META.RUNNING_VALID;
  const running = (signal.status === 'RUNNING_VALID' || signal.status === 'RUNNING_BE');

  const latest = signal.latestTpHit ? ` TP${signal.latestTpHit} hit` : '';
  const activeLine = running
    ? `Active: **YES** — trade is still running${latest}`
    : `Active: **NO** — ${status.label}`;

  const reentryLine = `Valid for Re-entry: **${status.reentry}**` +
    (status.reentry === 'No' ? ' (SL set to breakeven)' : '');

  const statusLines = ['\n📍 **Status**', activeLine, reentryLine];
  parts.push(statusLines.join('\n'));

  return parts.join('\n');
}

/** Build the final embed using a single description string (no Discord "fields") */
function buildEmbed(signal) {
  const sideIsLong = signal.side === 'LONG';
  const sideEmoji = sideIsLong ? '🟢' : '🔴';
  const baseColor = sideIsLong ? COLORS.long : COLORS.short;
  const statusMeta = STATUS_META[signal.status] ?? STATUS_META.RUNNING_VALID;
  const color = statusMeta.color || baseColor;

  const title = `$${String(signal.asset || '').toUpperCase()} | ${sideIsLong ? 'Long' : 'Short'} ${sideEmoji}`;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(buildDescription(signal))
    .setFooter({ text: `Signal • ID: ${signal.id}` })
    .setTimestamp(new Date(signal.createdAt || Date.now()));

  if (signal.imageUrl) embed.setImage(signal.imageUrl);
  return embed;
}

/** Buttons stay the same */
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