import { EmbedBuilder } from "discord.js";

export function renderSignalEmbed(signal) {
  const embed = new EmbedBuilder()
    .setTitle(`${signal.asset} | ${signal.direction} ${signal.direction === "Long" ? "🟢" : "🔴"}`)
    .addFields(
      { name: "Entry", value: `${signal.entry}`, inline: true },
      { name: "Stop Loss", value: `${signal.stopLoss}`, inline: true }
    )
    .setColor(signal.direction === "Long" ? 0x00ff00 : 0xff0000)
    .setFooter({ text: `Status: ${signal.status}` });

  if (signal.tp1) embed.addFields({ name: "TP1", value: signal.tp1.toString(), inline: true });
  if (signal.tp2) embed.addFields({ name: "TP2", value: signal.tp2.toString(), inline: true });
  if (signal.tp3) embed.addFields({ name: "TP3", value: signal.tp3.toString(), inline: true });
  if (signal.reason) embed.addFields({ name: "Reason", value: signal.reason });

  return embed;
}

export function renderSummaryEmbed(signals) {
  if (signals.length === 0) {
    return new EmbedBuilder()
      .setTitle("📊 JV Current Active Trades 📊")
      .setDescription("• There are currently no ongoing trades valid for entry — stay posted for future trades.");
  }

  let desc = "";
  signals.forEach((s, i) => {
    desc += `**${i + 1}. ${s.asset} ${s.direction === "Long" ? "🟢" : "🔴"}** — jump\n`;
    desc += `Entry: ${s.entry}\nStop Loss: ${s.stopLoss}\n\n`;
  });

  return new EmbedBuilder().setTitle("📊 JV Current Active Trades 📊").setDescription(desc);
}
