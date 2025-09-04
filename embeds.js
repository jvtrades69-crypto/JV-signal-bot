import { EmbedBuilder } from 'discord.js';

const GREEN = '🟢';
const RED = '🔴';
const BE = '🟫';
const STOP_BE = '🟥';

export function statusLabel(signal) {
  switch (signal.status) {
    case 'RUN_VALID':   return `Active 🟩 – trade is still running`;
    case 'RUN_BE':      return `Active ${BE} – running at break-even`;
    case 'STOPPED_OUT': return `Stopped Out ${RED}`;
    case 'STOPPED_BE':  return `Stopped BE ${STOP_BE}`;
    default:            return '—';
  }
}

export function titleLine(signal) {
  const d = signal.direction === 'LONG' ? GREEN : RED;
  const dirWord = signal.direction === 'LONG' ? 'Long' : 'Short';
  return `${signal.asset} | ${dirWord} ${d}`;
}

const fmt = (v) => (v ?? '—');

export function renderSignalEmbed(signal, brand = 'JV Trades') {
  return new EmbedBuilder()
    .setColor(signal.direction === 'LONG' ? 0x22c55e : 0xef4444)
    .setTitle(titleLine(signal))
    .setDescription([
      '📊 **Trade Details**',
      `Entry: ${fmt(signal.entry)}`,
      `Stop Loss: ${fmt(signal.stop)}`,
      ...(signal.tp1 || signal.tp2 || signal.tp3
        ? [
            signal.tp1 ? `TP1: ${fmt(signal.tp1)}` : null,
            signal.tp2 ? `TP2: ${fmt(signal.tp2)}` : null,
            signal.tp3 ? `TP3: ${fmt(signal.tp3)}` : null
          ].filter(Boolean)
        : []),
      '',
      ...(signal.reason ? ['📝 **Reasoning**', signal.reason, ''] : []),
      '📍 **Status**',
      statusLabel(signal),
      `Valid for re-entry: ${signal.validReentry ? 'Yes' : 'No'}`
    ].join('\n'))
    .setFooter({ text: brand });
}

export function renderSummaryEmbed(trades, title = '📊 JV Current Active Trades 📊') {
  if (!trades.length) {
    return new EmbedBuilder()
      .setColor(0x60a5fa)
      .setTitle(title)
      .setDescription('• There are currently no ongoing trades valid for entry – stay posted for future trades.');
  }

  const lines = trades.map((t, i) => {
    const dot = t.direction === 'LONG' ? '🟢' : '🔴';
    const jump = t.jumpUrl ? ` — [jump](${t.jumpUrl})` : '';
    return `${i + 1}. ${t.asset} ${t.direction === 'LONG' ? 'Long' : 'Short'} ${dot}${jump}\n` +
           `   Entry: ${fmt(t.entry)}\n` +
           `   Stop Loss: ${fmt(t.stop)}`;
  });

  return new EmbedBuilder()
    .setColor(0x60a5fa)
    .setTitle(title)
    .setDescription(lines.join('\n\n'));
}
