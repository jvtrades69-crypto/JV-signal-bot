// embeds.js — renderers for signals, summary, and recaps

// (your existing renderSignalText and renderSummaryText stay here untouched)

// ===========================
// Recap Renderers
// ===========================

export function renderWeeklyRecap(signals) {
  const title = `📊 **JV Trades Weekly Recap**`;
  if (!signals || !signals.length) {
    return `${title}\n\n⚠️ No closed trades this week.`;
  }

  const lines = [title, ''];
  let totalSecured = 0;
  let totalMax = 0;
  let wins = 0;
  let losses = 0;
  let idx = 1;

  signals.forEach((s) => {
    if (!s.closedAt) return; // only closed trades

    const dirWord = s.direction === 'SHORT' ? 'Short' : 'Long';
    const circle = s.direction === 'SHORT' ? '🔴' : '🟢';

    lines.push(`${idx}️⃣ $${s.asset} ${dirWord} ${circle} | R Secured: ${s.rSecured ?? '0'}R` +
      (s.rSecured > 0 ? ' ✅' : s.rSecured < 0 ? ' ❌' : ''));

    if (s.tp1) lines.push(`🎯 TP1 ${s.hitTp1 ? '✅' : ''} | ${s.tp1R ?? ''}R: \`${s.tp1}\``);
    if (s.tp2) lines.push(`🎯 TP2 ${s.hitTp2 ? '✅' : ''} | ${s.tp2R ?? ''}R: \`${s.tp2}\``);
    if (s.tp3) lines.push(`🎯 TP3 ${s.hitTp3 ? '✅' : ''} | ${s.tp3R ?? ''}R: \`${s.tp3}\``);
    if (s.tp4) lines.push(`🎯 TP4 ${s.hitTp4 ? '✅' : ''} | ${s.tp4R ?? ''}R: \`${s.tp4}\``);
    if (s.tp5) lines.push(`🎯 TP5 ${s.hitTp5 ? '✅' : ''} | ${s.tp5R ?? ''}R: \`${s.tp5}\``);

    lines.push(`⚖️ Max R Reached: ${s.maxR ?? '0'}R`);
    lines.push(`🔗 View Original Trade #${s.tradeNumber ?? idx}`);
    lines.push('');

    totalSecured += s.rSecured ?? 0;
    totalMax += s.maxR ?? 0;
    if ((s.rSecured ?? 0) > 0) wins++;
    if ((s.rSecured ?? 0) < 0) losses++;
    idx++;
  });

  lines.push('---');
  lines.push('⚖️ **Weekly Totals**');
  lines.push(`- Trades Taken: ${wins + losses}`);
  lines.push(`- Wins: ${wins} | Losses: ${losses}`);
  lines.push(`- Net R Secured: ${totalSecured.toFixed(2)}R`);
  lines.push(`- Net Max R: ${totalMax.toFixed(2)}R`);
  lines.push(`- Win Rate: ${wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : 0}%`);

  return lines.join('\n');
}

export function renderMonthlyRecap(signals) {
  const title = `📅 **JV Trades Monthly Recap**`;
  if (!signals || !signals.length) {
    return `${title}\n\n⚠️ No closed trades this month.`;
  }

  const lines = [title, ''];
  let totalSecured = 0;
  let wins = 0;
  let losses = 0;
  let idx = 1;

  signals.forEach((s) => {
    if (!s.closedAt) return; // only closed trades

    const dirWord = s.direction === 'SHORT' ? 'Short' : 'Long';
    const circle = s.direction === 'SHORT' ? '🔴' : '🟢';

    lines.push(`${idx}️⃣ $${s.asset} ${dirWord} ${circle} | R Secured: ${s.rSecured ?? '0'}R` +
      (s.rSecured > 0 ? ' ✅' : s.rSecured < 0 ? ' ❌' : ''));
    lines.push(`🔗 View Original Trade #${s.tradeNumber ?? idx}`);
    lines.push('');

    totalSecured += s.rSecured ?? 0;
    if ((s.rSecured ?? 0) > 0) wins++;
    if ((s.rSecured ?? 0) < 0) losses++;
    idx++;
  });

  lines.push('---');
  lines.push('⚖️ **Monthly Totals**');
  lines.push(`- Trades Taken: ${wins + losses}`);
  lines.push(`- Wins: ${wins} | Losses: ${losses}`);
  lines.push(`- Net R Secured: ${totalSecured.toFixed(2)}R`);
  lines.push(`- Win Rate: ${wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : 0}%`);

  return lines.join('\n');
}
