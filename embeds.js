// embeds.js
// Pure formatting helpers. Return markdown strings that Discord renders nicely.

function safeNum(x) {
  if (x === 0) return "0";
  if (x === null || typeof x === "undefined") return "-";
  return String(x);
}

function sideDot(side) {
  if (!side) return "🟢";
  const s = String(side).toLowerCase();
  return s === "short" ? "🔴" : "🟢";
}

function boldTitle(text) {
  return `**${text}**`;
}

/**
 * Big single-signal card.
 * Expected minimal fields on `signal`:
 *   asset, side, entry, sl, tp1, tp2, tp3, reason, active, statusNote, validForReentry
 * Missing fields are rendered cleanly.
 */
function renderSignalEmbed(signal) {
  const asset = (signal.asset || "").toUpperCase();
  const side = (signal.side || "").toUpperCase();
  const dot = sideDot(signal.side);

  const entry = safeNum(signal.entry);
  const sl = safeNum(signal.sl);

  const tpParts = [];
  if (signal.tp1) tpParts.push(`TP1: ${safeNum(signal.tp1)}${signal.tp1Pct ? ` (${signal.tp1Pct}%)` : ""}`);
  if (signal.tp2) tpParts.push(`TP2: ${safeNum(signal.tp2)}${signal.tp2Pct ? ` (${signal.tp2Pct}%)` : ""}`);
  if (signal.tp3) tpParts.push(`TP3: ${safeNum(signal.tp3)}${signal.tp3Pct ? ` (${signal.tp3Pct}%)` : ""}`);

  const reason = signal.reason ? String(signal.reason) : "-";

  const activeWord = signal.active ? "Active 🟩 - trade is still running" : "Inactive 🟥 - SL set to breakeven";
  const statusLine = signal.statusNote ? `${activeWord}\n${signal.statusNote}` : activeWord;

  const reentry = signal.validForReentry ? "Yes" : "No";

  // EXACT spacing: 1 blank line after the big title, then sections.
  const lines = [
    // Big title
    `${boldTitle(`${asset} | ${side}`)} ${dot}`,
    "",
    // Trade details
    "📊 " + boldTitle("Trade Details"),
    `Entry: ${entry}`,
    `SL: ${sl}`,
    ...(tpParts.length ? tpParts : []),
    "",
    // Reasoning
    "📝 " + boldTitle("Reasoning"),
    reason,
    "",
    // Status
    "📍 " + boldTitle("Status"),
    `${statusLine}`,
    `Valid for re-entry: ${reentry}`,
    "",
    // trailing line removed on join to avoid double spacing
  ];

  return lines.join("\n").trim();
}

/**
 * Compact summary for the "JV Current Active Trades" message.
 * `trades` is an array of signal-like objects.
 * `title` is the header (we keep it bolded, not huge).
 */
function renderSummaryEmbed(trades, title = "JV Current Active Trades 📊") {
  if (!trades || trades.length === 0) {
    return `**${title}**\n• There are currently no ongoing trades valid for entry — stay posted for future trades.`;
  }

  // one compact line per trade, numbered, with “jump” link expected to be added by caller if desired
  const items = trades.map((t, i) => {
    const asset = (t.asset || "").toUpperCase();
    const side = (t.side || "").toUpperCase();
    const dot = sideDot(t.side);
    const entry = safeNum(t.entry);
    const sl = safeNum(t.sl);

    const head = `${i + 1}. ${asset} ${side} ${dot}`;
    const body = [
      `➡️ Entry: ${entry}`,
      `🛑 Stop Loss: ${sl}`,
      ...(t.tp1 ? [`🎯 TP1: ${safeNum(t.tp1)}`] : []),
    ].join("\n");

    return `${head}\n${body}`;
  });

  return `**${title}**\n${items.join("\n\n")}`;
}

module.exports = {
  renderSignalEmbed,
  renderSummaryEmbed,
};
