import { EmbedBuilder } from "discord.js";

const dirEmoji = d => (d === "Long" ? "🟢" : "🔴");

export function renderSignalEmbed(signal, brand = "JV Trades") {
  const e = new EmbedBuilder()
    .setColor(signal.direction === "Long" ? 0x2ecc71 : 0xe74c3c)
    .setTitle(`${signal.asset} | ${signal.direction} ${dirEmoji(signal.direction)}`)
    .setFooter({ text: `${brand} • Status: ${signal.status}` });

  const lines = [
    `**Entry:** ${signal.entry}`,
    `**Stop Loss:** ${signal.stopLoss}`
  ];
  if (signal.tp1) lines.push(`**TP1:** ${signal.tp1}`);
  if (signal.tp2) lines.push(`**TP2:** ${signal.tp2}`);
  if (signal.tp3) lines.push(`**TP3:** ${signal.tp3}`);

  e.addFields({ name: "📊 Trade Details", value: lines.join("\n") });

  if (signal.reason) {
    e.addFields({ name: "📝 Reason", value: signal.reason.slice(0, 1024) });
  }

  e.addFields({
    name: "📌 Status",
    value: `${signal.status}${signal.valid ? " • Valid for re-entry: **Yes**" : " • Valid for re-entry: **No**"}`
  });

  return e;
}

export function renderSummaryEmbed(trades, brand = "JV Trades") {
  const e = new EmbedBuilder().setColor(0x3498db).setTitle(`📊 ${brand} Current Active Trades`);

  if (!trades.length) {
    e.setDescription("• There are currently no ongoing trades **valid** for entry — stay posted for future trades.");
    return e;
    }

  const parts = trades.map((t, i) => {
    const url = t.messageId
      ? `https://discord.com/channels/${t.guildId}/${t.channelId}/${t.messageId}`
      : null;
    const head = `${i + 1}. **${t.asset} ${dirEmoji(t.direction)}**${url ? ` — [jump](${url})` : ""}`;
    const body = `Entry: ${t.entry}\nStop Loss: ${t.stopLoss}`;
    return `${head}\n${body}`;
  });

  e.setDescription(parts.join("\n\n"));
  return e;
}
