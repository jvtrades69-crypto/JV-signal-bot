// embeds.js
import { EmbedBuilder } from "discord.js";

// Emojis (kept simple and consistent)
const EMO = {
  chart: "📊",
  memo: "📝",
  pin: "📍",
  greenDot: "🟢",
  redDot: "🔴",
};

function circleForDirection(direction) {
  return direction.toLowerCase() === "long" ? EMO.greenDot : EMO.redDot;
}

function toUpperAsset(asset) {
  return (asset || "").trim().toUpperCase();
}

function fieldIf(label, value) {
  if (!value && value !== 0) return null;
  const str = String(value).trim();
  if (!str) return null;
  return { name: label, value: str, inline: false };
}

/**
 * Main trade signal embed
 * - Title: BTC | Long 🟢
 * - Sections:
 *    📊 Trade Details
 *    📝 Reasoning (only if provided)
 *    📍 Status
 * - Neutral color (no green strip). Leaving color undefined keeps Discord’s default subtle edge.
 */
export function renderSignalEmbed(signal) {
  const {
    asset,
    direction,
    entry,
    stop,
    tp1,
    tp2,
    tp3,
    reason,
    statusText = "Active — trade is still running",
    validReentry = "Yes",
  } = signal;

  const title = `${toUpperAsset(asset)} | ${capitalize(direction)} ${circleForDirection(
    direction
  )}`;

  const detailsLines = [
    `**Entry:** ${entry ?? "-"}`,
    `**Stop Loss:** ${stop ?? "-"}`,
  ];
  if (tp1) detailsLines.push(`**TP1:** ${tp1}`);
  if (tp2) detailsLines.push(`**TP2:** ${tp2}`);
  if (tp3) detailsLines.push(`**TP3:** ${tp3}`);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(
      [
        `**${EMO.chart}  Trade Details**`,
        detailsLines.join("\n"),
        reason
          ? `\n**${EMO.memo}  Reasoning**\n${String(reason)}`
          : null,
        `\n**${EMO.pin}  Status**`,
        `${statusText}`,
        `Valid for re-entry: ${validReentry}`,
      ]
        .filter(Boolean)
        .join("\n")
    );
  // NOTE: no .setColor() -> avoids the strong colored strip

  return embed;
}

/**
 * Compact summary embed for “Current Active Trades” channel.
 * One embed that lists several trades; each item can include a jump link.
 */
export function renderSummaryEmbed(trades, title = "JV Current Active Trades") {
  const embed = new EmbedBuilder().setTitle(`📊 ${title}`);

  if (!trades?.length) {
    embed.setDescription(
      "• There are currently **no** ongoing trades **valid** for entry — stay posted for future trades."
    );
    return embed;
  }

  const lines = trades.map((t, i) => {
    const bullet =
      t.direction?.toLowerCase() === "long" ? EMO.greenDot : EMO.redDot;
    const jump = t.jumpUrl ? ` — [jump](${t.jumpUrl})` : "";
    const header = `${i + 1}. ${toUpperAsset(t.asset)} ${capitalize(
      t.direction
    )} ${bullet}${jump}`;
    const body = [`Entry: ${t.entry ?? "-"}`, `Stop Loss: ${t.stop ?? "-"}`]
      .filter(Boolean)
      .join("\n");

    return `**${header}**\n${body}`;
  });

  embed.setDescription(lines.join("\n\n"));
  return embed;
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
