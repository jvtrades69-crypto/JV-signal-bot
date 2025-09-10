// === Recap renderer ===
export function renderRecapText(trades, opts) {
  const { fromISO, toISO, label, assetFilter, mode = 'SUMMARY' } = opts || {};
  const title = `**JV ${label} Trade Recap** 📈 (${fromISO} → ${toISO})${assetFilter ? ` — ${assetFilter}` : ''}`;

  if (!trades || trades.length === 0) {
    return `${title}\n\n• No closed trades in this period.`;
  }

  // KPIs
  const rs = trades.map(t => Number(t.resultR ?? t.finalR ?? 0));
  const wins = rs.filter(x => x > 0).length;
  const bes  = rs.filter(x => x === 0).length;
  const loss = rs.filter(x => x < 0).length;
  const total = trades.length;
  const sumR = rs.reduce((a,b) => a + b, 0);
  const avgR = sumR / total;
  const best = Math.max(...rs);
  const worst = Math.min(...rs);
  const winRate = total ? ((wins / total) * 100).toFixed(1) : '0.0';

  const lines = [title, ''];
  lines.push(`• Closed trades: ${total}`);
  lines.push(`• Win / BE / Loss: ${wins} / ${bes} / ${loss} (Win rate ${winRate}%)`);
  lines.push(`• Total R: ${sumR.toFixed(2)}R  |  Avg R: ${avgR.toFixed(2)}R  |  Best: ${best.toFixed(2)}R  |  Worst: ${worst.toFixed(2)}R`);

  // Per-asset breakdown
  const byAsset = {};
  for (const t of trades) {
    const k = (t.asset || 'UNKNOWN').toUpperCase();
    byAsset[k] = byAsset[k] || [];
    byAsset[k].push(t);
  }
  const assetKeys = Object.keys(byAsset).sort();
  if (assetKeys.length > 1 || (assetKeys.length === 1 && !assetFilter)) {
    lines.push('');
    lines.push('• Per-asset:');
    for (const a of assetKeys) {
      const arr = byAsset[a];
      const rsum = arr.reduce((acc, x) => acc + Number(x.resultR ?? x.finalR ?? 0), 0);
      const wr = arr.length ? ((arr.filter(x => Number(x.resultR ?? x.finalR ?? 0) > 0).length / arr.length) * 100).toFixed(1) : '0.0';
      lines.push(`   - ${a}: ${rsum.toFixed(2)}R, ${arr.length} trades, win rate ${wr}%`);
    }
  }

  if (mode === 'FULL') {
    lines.push('');
    lines.push('**Every trade**');
    for (const t of trades) {
      const r = Number(t.resultR ?? t.finalR ?? 0);
      const rText = (r > 0 ? '+' : r < 0 ? '' : '') + r.toFixed(2) + 'R';
      const when = t.closedAt ? new Date(t.closedAt).toISOString().slice(0,10) : '—';
      const dir = t.direction === 'SHORT' ? 'Short 🔴' : 'Long 🟢';
      const link = t.jumpUrl ? ` — ${t.jumpUrl}` : '';
      lines.push(`• ${t.asset} ${dir} — ${rText} on ${when}${link}`);
    }
  }

  return lines.join('\n');
}
