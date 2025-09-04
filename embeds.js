// embeds.js (ESM)
import { EmbedBuilder } from 'discord.js';

const color = {
  green: 0x22c55e,
  red: 0xef4444,
  yellow: 0xf59e0b,
  // darker gray to make the left color strip almost invisible
  subtle: 0x2b2d31,
};

const emoji = {
  chart: '📊',
  note: '🧾',
  pin: '📍',
  greenDot: '🟢', // circle (requested)
  redDot: '🔴',
};

export function renderSignalEmbed(signal) {
  const {
    asset,
    direction, // 'Long' | 'Short'
    entry,
    stop,
    tp1,
    tp2,
    tp3,
    reason,
    validReentry = 'No',
    status = 'Active',
  } = signal;

  const isLong = direction.toLowerCase() === 'long';

  const embed = new EmbedBuilder()
    .setColor(color.subtle) // subtle bar; change to green/red if you prefer
    .setTitle(`${asset.toUpperCase()} | ${direction} ${isLong ? emoji.greenDot : emoji.redDot}`)
    .setDescription(
      [
        `**${emoji.chart}  Trade Details**`,
        `Entry: ${entry ?? '-'}`,
        `Stop Loss: ${stop ?? '-'}`,
        tp1 ? `TP1: ${tp1}` : null,
        tp2 ? `TP2: ${tp2}` : null,
        tp3 ? `TP3: ${tp3}` : null,
        '',
        `**${emoji.note}  Reasoning**`,
        reason ? `${reason}` : '—',
        '',
        `**${emoji.pin}  Status**`,
        `${status} ${isLong ? emoji.greenDot : emoji.redDot} — trade is still running`,
        `Valid for re-entry: ${validReentry}`,
      ]
        .filter(Boolean)
        .join('\n'),
    );

  return embed;
}

export function renderSummaryEmbed(trades) {
  // Compact one-embed list for the Current Active Trades channel
  const lines = [];

  if (!trades || trades.length === 0) {
    lines.push(
      `**${emoji.chart} JV Current Active Trades**`,
      `• There are currently **no** ongoing trades **valid** for entry — stay posted for future trades.`,
    );
  } else {
    lines.push(`**${emoji.chart} JV Current Active Trades**`, '');
    trades.forEach((t, i) => {
      const dot = t.direction.toLowerCase() === 'long' ? emoji.greenDot : emoji.redDot;
      lines.push(
        `${i + 1}. **${t.asset.toUpperCase()} ${t.direction} ${dot}** — *jump*`,
        `   Entry: ${t.entry ?? '-'}`,
        `   Stop Loss: ${t.stop ?? '-'}`,
        '',
      );
    });
  }

  return new EmbedBuilder().setColor(color.subtle).setDescription(lines.join('\n'));
}
