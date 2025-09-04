import { EmbedBuilder } from "discord.js";

// Always uppercase asset, clean consistent sections, no duplicate footer.
export function renderSignalEmbed({
  asset,
  direction,
  entry,
  stopLoss,
  tp1,
  tp2,
  tp3,
  reasoning,
  status = "Active 🟩",
}) {
  const a = (asset || "").toUpperCase();
  const d = (direction || "").trim();
  const title = `${a} | ${d} ${d.toLowerCase() === "long" ? "🟩" : "🔴"}`;

  const details = [
    `**Entry:** ${entry}`,
    `**Stop Loss:** ${stopLoss}`,
    tp1 ? `**TP1:** ${tp1}` : `**TP1:** –`,
    tp2 ? `**TP2:** ${tp2}` : `**TP2:** –`,
    tp3 ? `**TP3:** ${tp3}` : `**TP3:** –`,
  ].join("\n");

  const lines = [];

  lines.push("📊 **Trade Details**");
  lines.push(details);

  if (reasoning && reasoning.trim().length) {
    lines.push("");
    lines.push("📝 **Reasoning**");
    lines.push(reasoning.trim());
  }

  lines.push("");
  lines.push("📌 **Status**");
  // Keep exactly one status block
  lines.push(`${status}\nValid for re-entry: ${/active/i.test(status) ? "Yes" : "No"}`);

  return new EmbedBuilder()
    .setColor(/long/i.test(direction) ? 0x22c55e : 0xef4444)
    .setTitle(title)
    .setDescription(lines.join("\n"));
}