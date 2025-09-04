// embeds.js
import { EmbedBuilder } from "discord.js";

/** helpers */
const dashIfEmpty = (v) => {
  if (v === 0) return "0";
  return (v === undefined || v === null || String(v).trim() === "") ? "–" : String(v).trim();
};
const uc = (s) => (s ? String(s).toUpperCase() : s);

/** Status line renderer */
function statusBlock(signal) {
  const statusEmoji =
    signal.status === "active" ? "🟩"
    : signal.status === "tp1" || signal.status === "tp2" || signal.status === "tp3" ? "🟧"
    : signal.status === "stopped" || signal.status === "stopped_be" ? "🟥"
    : "🟩";

  const valid = signal.validForReentry === false ? "No" : "Yes";

  return [
    "📌 **Status**",
    `Active ${statusEmoji} — trade is still running`,
    `Valid **for** re-entry: **${valid}**`
  ].join("\n");
}

/** Big trade card */
export function renderSignalEmbed(signal) {
  const titleDot =
    signal.direction?.toLowerCase() === "short" ? "🔴" : "🟢";

  const lines = [
    "📊 **Trade Details**",
    `**Entry:** ${dashIfEmpty(signal.entry)}`,
    `**Stop Loss:** ${dashIfEmpty(signal.stopLoss)}`,
    `**TP1:** ${dashIfEmpty(signal.tp1)}`,
    `**TP2:** ${dashIfEmpty(signal.tp2)}`,
    `**TP3:** ${dashIfEmpty(signal.tp3)}`,
    "", // spacer
  ];

  // Reason (only if present)
  const reason = (signal.reason ?? "").trim();
  if (reason) {
    lines.push("📋✏️ **Reasoning**");
    lines.push(reason);
    lines.push(""); // spacer
  }

  // Status block (always)
  lines.push(statusBlock(signal));

  const embed = new EmbedBuilder()
    .setColor(signal.direction?.toLowerCase() === "short" ? 0xff4d4f : 0x22c55e)
    .setTitle(`${uc(signal.asset)} | ${uc(signal.direction)} ${titleDot}`)
    .setDescription(lines.join("\n"));

  // No footer (avoid duplicate status)
  return embed;
}

/** Compact summary list embed for "Current Active Trades" */
export function renderSummaryEmbed(trades, title = "JV Current Active Trades") {
  const desc = trades.length === 0
    ? "• There are currently no ongoing trades **valid** for entry — stay posted for future trades."
    : trades.map((t, i) => {
        const dot = t.direction?.toLowerCase() === "short" ? "🔴" : "🟢";
        return [
          `**${i + 1}. ${uc(t.asset)} ${uc(t.direction)} ${dot} — jump**`,
          `   Entry: ${dashIfEmpty(t.entry)}`,
          `   Stop Loss: ${dashIfEmpty(t.stopLoss)}`
        ].join("\n");
      }).join("\n\n");

  return new EmbedBuilder()
    .setColor(0x3b82f6)
    .setTitle(`📊 ${title}`)
    .setDescription(desc);
}