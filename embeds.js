// embeds.js — all visual formatting for Discord messages
import {
  EmbedBuilder,
  inlineCode,
} from 'discord.js';
import { GUILD_ID } from './config.js';

// small helpers
const green = 0x22C55E;
const red = 0xEF4444;
const yellow = 0xF59E0B;
const gray = 0x6B7280;

const emoji = {
  chart: '📊',
  note: '🧾',
  pin: '📍',
  greenDot: '🟩',
  redDot: '🔴',
};

function titleLine(asset, direction) {
  // Always uppercase asset, direction “Long|Short”
  const a = String(asset || '').toUpperCase();
  const d = direction === 'Short' ? 'Short' : 'Long';
  const dot = d === 'Long' ? emoji.greenDot : emoji.redDot;
  return `${a} | ${d} ${dot}`;
}

function statusLines(signal) {
  // human readable block
  const d = new EmbedBuilder().setDescription(
    [
      `${emoji.pin} **Status**`,
      `Active ${signal.direction === 'Long' ? emoji.greenDot : emoji.redDot} — trade is still running`,
      `Valid ${inlineCode('for')} re-entry: ${signal.validReentry ? 'Yes' : 'No'}`,
    ].join('\n')
  );
  return d.data.description;
}

function formatNumber(n) {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  if (Number.isFinite(v)) {
    // format like 21,000
    return v.toLocaleString('en-US');
  }
  // leave raw if it’s not a clean number
  return String(n);
}

export function renderSignalEmbed(signal) {
  const color =
    signal.status === 'stopped' ? red :
    signal.status?.startsWith('tp') ? yellow :
    green;

  const parts = [];

  // Trade details
  const entry = formatNumber(signal.entry);
  const stop = formatNumber(signal.stop);
  const tp1 = formatNumber(signal.tp1);
  const tp2 = formatNumber(signal.tp2);
  const tp3 = formatNumber(signal.tp3);

  const tradeLines = [
    `${emoji.chart} **Trade Details**`,
    `**Entry:** ${entry ?? '-'}`,
    `**Stop Loss:** ${stop ?? '-'}`,
  ];

  // TPs only if provided
  if (tp1 || tp2 || tp3) {
    if (tp1) tradeLines.push(`**TP1:** ${tp1}`);
    if (tp2) tradeLines.push(`**TP2:** ${tp2}`);
    if (tp3) tradeLines.push(`**TP3:** ${tp3}`);
  }

  parts.push(tradeLines.join('\n'));

  // Reason block only if provided
  if (signal.reason && String(signal.reason).trim().length) {
    parts.push([
      `${emoji.note} **Reasoning**`,
      String(signal.reason).trim(),
    ].join('\n'));
  }

  // Status block (always)
  parts.push(statusLines(signal));

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(titleLine(signal.asset, signal.direction))
    .setDescription(parts.join('\n\n'));

  return embed;
}

/**
 * Compact “Current Active Trades” embed.
 * Each item can link back to the full signal if we know channelId + messageId.
 */
export function renderSummaryEmbed(trades, title = 'JV Current Active Trades') {
  const embed = new EmbedBuilder()
    .setColor(gray)
    .setTitle(`${emoji.chart} ${title}`);

  if (!trades?.length) {
    embed.setDescription(
      '• There are currently **no** ongoing trades **valid for** entry — stay posted for future trades.'
    );
    return embed;
  }

  const lines = [];
  trades.forEach((t, i) => {
    const idx = i + 1;
    const dot = t.direction === 'Long' ? emoji.greenDot : emoji.redDot;

    // link back if we have message + channel
    let jump = '— jump';
    if (t.channelId && t.messageId && GUILD_ID) {
      const url = `https://discord.com/channels/${GUILD_ID}/${t.channelId}/${t.messageId}`;
      jump = `— [jump](${url})`;
    }

    const entry = formatNumber(t.entry);
    const stop = formatNumber(t.stop);

    lines.push(
      [
        `${idx}. ${String(t.asset).toUpperCase()} ${t.direction} ${dot} ${jump}`,
        '',
        `**Entry:** ${entry ?? '-'}`,
        `**Stop Loss:** ${stop ?? '-'}`,
      ].join('\n')
    );
  });

  embed.setDescription(lines.join('\n\n'));
  return embed;
}
