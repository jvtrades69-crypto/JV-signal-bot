import { EmbedBuilder } from 'discord.js';

const GREEN_DOT = '🟩';
const RED_DOT = '🔴';
const BROWN = '🟫';
const BLACK = '⬛';

export function statusLabel(signal) {
  switch (signal.status) {
    case 'RUN_VALID': return `Active ${GREEN_DOT} — trade is still running`;
    case 'RUN_BE':    return `Active ${BROWN} — running at break-even`;
    case 'STOPPED_OUT': return `Stopped Out ${RED_DOT}`;
    case 'STOPPED_BE':  return `Stopped BE ${BLACK}`;
    default: return '—';
  }
}

export function titleLine(signal) {
  const d = signal.direction === 'LONG' ? GREEN_DOT : RED_DOT;
  return `${signal.asset} | ${signal.direction[0]}${signal.direction.slice(1).toLowerCase()} ${d}`;
}

function fmt(v) {
  return v ?? '—';
}

export function renderSignalEmbed(signal, brand = 'JV Trades') {
  const e = new EmbedBuilder()
    .setColor(signal.direction === 'LONG' ? 0x22c55e : 0xef4444)
    .setTitle(titleLine(signal))
    .setDescription([
      '📊 **Trade Details**',
      `**Entry:** ${fmt(signal.entry)}`,
      `**Stop Loss:** ${fmt(signal.stop)}`,
      ...(signal.tp1 || signal.tp2 || signal.tp3
        ? [
            `**TP1:** ${fmt(signal.tp1)}`,
            `**TP2:** ${fmt(signal.tp2)}`,
            `**TP3:** ${fmt(signal.tp3)}`
          ]
        : []),
      '',
      ...(signal.reason
        ? ['📝 **Reasoning**', signal.reason, '']
        : []),
      '📍 **Status**',
      statusLabel(signal),
      `Valid for re-entry: ${signal.validReentry ? 'Yes' : 'No'}`
    ].join('\n'))
    .setFooter({ text: brand });

  return e;
}

export function renderSummaryEmbed(trades, title = '📊 JV Current Active Trades') {
  if (!trades.length) {
    return new EmbedBuilder()
      .setColor(0x60a5fa)
      .setTitle(title)
      .setDescription('There are currently **no** ongoing trades **valid for entry** — stay posted for future trades.');
  }

  const lines = trades.map((t, i) => {
    const dot = t.direction === 'LONG' ? '🟩' : '🔴';
    const jump = t.jumpUrl ? ` — [jump](${t.jumpUrl})` : '';
    return `${i + 1}. **${t.asset} ${t.direction === 'LONG' ? 'Long' : 'Short'} ${dot}**${jump}\n` +
           `   **Entry:** ${fmt(t.entry)}\n` +
           `   **Stop Loss:** ${fmt(t.stop)}`;
  });

  return new EmbedBuilder()
    .setColor(0x60a5fa)
    .setTitle(title)
    .setDescription(lines.join('\n\n'));
}
