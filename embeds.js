// Renders plain-text blocks (keeps your exact layout)
function padIf(text) {
  return text ? String(text) : "-";
}

function titleLine(asset, side, statusIcon) {
  // Exactly ONE blank line between title and details
  return `**${asset} | ${side} ${statusIcon}**\n`;
}

function statusText(signal) {
  const active = signal.active !== false;
  const runningBE = signal.status === "running-be";
  const stopped = signal.status === "stopped";
  const stoppedBE = signal.status === "stopped-be";

  if (stopped)   return "📍 **Status : Inactive 🟥** - SL set to breakeven\nValid for re-entry: Yes";
  if (stoppedBE) return "📍 **Status : Inactive 🟥** - SL set to breakeven\nValid for re-entry: Yes";
  if (runningBE) return "📍 **Status : Active 🟩** - trade is still running\nValid for re-entry: No ( SL set to breakeven )";
  return "📍 **Status : Active 🟩** - trade is still running\nValid for re-entry: Yes";
}

function renderSignalEmbed(signal, roleMention) {
  const icon = "🟢"; // (you can map based on side if you want)
  const title = titleLine(signal.asset, signal.side, icon);

  const lines = [];
  lines.push(title); // includes trailing newline
  lines.push("📊 **Trade Details**");
  lines.push(`Entry: ${padIf(signal.entry)}`);
  lines.push(`SL: ${padIf(signal.sl)}`);
  if (signal.tp1) lines.push(`TP1: ${signal.tp1}`);
  if (signal.tp2) lines.push(`TP2: ${signal.tp2}`);
  if (signal.tp3) lines.push(`TP3: ${signal.tp3}`);
  lines.push(""); // blank line

  lines.push("📝 **Reasoning**");
  lines.push(signal.reason ? signal.reason : "-");
  lines.push(""); // blank

  lines.push(statusText(signal));
  if (roleMention) {
    lines.push("");
    lines.push(roleMention);
  }

  return lines.join("\n");
}

function renderSummaryEmbed(trades, title) {
  if (!trades?.length) {
    return `**${title}**\n• There are currently no ongoing trades valid for entry — stay posted for future trades.`;
  }
  const out = [`**${title}**`];
  trades.forEach((t, i) => {
    const emoji = "🟢";
    out.push(`${i + 1}. ${t.asset} ${t.side} ${emoji} — [jump](https://discord.com/channels/${t.guildId || ""}/${t.channelId || ""}/${t.messageId || ""})`);
    out.push(`➡️ Entry: ${padIf(t.entry)}`);
    out.push(`🛑 Stop Loss: ${padIf(t.sl)}`);
    if (t.tp1) out.push(`🎯 TP1: ${t.tp1}`);
    out.push(""); // spacer between trades
  });
  return out.join("\n");
}

module.exports = {
  renderSignalEmbed,
  renderSummaryEmbed,
};
