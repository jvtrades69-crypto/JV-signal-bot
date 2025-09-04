const { EmbedBuilder } = require('discord.js');

function titleFor(signal) {
  const sideEmoji = signal.side === 'Long' ? '🟢' : '🔴';
  return `${signal.asset} | ${signal.side} ${sideEmoji}`;
}

function statusLine(signal) {
  // Map status + flags to the exact phrasing required
  let line = '';
  if (signal.status === 'ACTIVE') {
    line = 'Active 🟩 – trade is still running';
  } else if (signal.status === 'RUNNING_BE') {
    line = 'Running (BE) 🟫 – stops set to breakeven';
  } else if (signal.status === 'STOPPED_OUT') {
    line = 'Stopped Out 🔴';
  } else if (signal.status === 'STOPPED_BE') {
    line = 'Stopped at BE 🟥';
  } else {
    line = 'Closed';
  }
  return line;
}

function renderSignalEmbed(signal) {
  const color = signal.side === 'Long' ? 0x22c55e : 0xef4444; // green/red

  // Build Trade Details
  const td = [];
  td.push(`Entry: ${signal.entry}`);
  td.push(`Stop Loss: ${signal.sl}`);
  if (signal.tp1) td.push(`TP1: ${signal.tp1}${signal.tp1Hit ? ' ✅' : ''}${signal.tp1Note ? ` (${signal.tp1Note})` : ''}`);
  if (signal.tp2) td.push(`TP2: ${signal.tp2}${signal.tp2Hit ? ' ✅' : ''}${signal.tp2Note ? ` (${signal.tp2Note})` : ''}`);
  if (signal.tp3) td.push(`TP3: ${signal.tp3}${signal.tp3Hit ? ' ✅' : ''}${signal.tp3Note ? ` (${signal.tp3Note})` : ''}`);

  const fields = [
    { name: '📊 Trade Details', value: td.join('\n'), inline: false },
  ];

  if (signal.reason && signal.reason.trim().length > 0) {
    fields.push({ name: '📝 Reasoning', value: signal.reason.trim(), inline: false });
  }

  fields.push({
    name: '📍 Status',
    value: `${statusLine(signal)}\nValid for re-entry: ${signal.validForReentry ? 'Yes' : 'No'}`,
    inline: false,
  });

  const embed = new EmbedBuilder()
    .setTitle(titleFor(signal))
    .setColor(color)
    .addFields(fields)
    .setTimestamp(new Date(signal.updatedAt || signal.createdAt || Date.now()))
    .setFooter({ text: `Signal ID: ${signal.id}` });

  if (signal.jumpUrl) {
    embed.setURL(signal.jumpUrl);
  }

  return embed;
}

function renderSummaryEmbed(trades, title = '📊 JV Current Active Trades 📊') {
  const emb = new EmbedBuilder().setTitle(title).setColor(0x60a5fa); // blue

  if (!trades || trades.length === 0) {
    emb.setDescription('• There are currently no ongoing trades valid for entry – stay posted for future trades.');
    return emb;
  }

  // Build a numbered list per spec
  const lines = [];
  trades.forEach((t, i) => {
    const sideEmoji = t.side === 'Long' ? '🟢' : '🔴';
    lines.push(`${i + 1}. ${t.asset} ${t.side} ${sideEmoji} — [jump](${t.jumpUrl})\n   Entry: ${t.entry}\n   Stop Loss: ${t.sl}`);
  });
  emb.setDescription(lines.join('\n\n'));
  return emb;
}

module.exports = {
  renderSignalEmbed,
  renderSummaryEmbed,
  titleFor,
  statusLine,
};
