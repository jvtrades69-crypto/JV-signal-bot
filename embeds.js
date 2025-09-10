// embeds.js — plain-text renderers for JV bot

/**
 * Render a single trade signal as plain text.
 * @param {object} s - normalized signal (id, asset, direction, entry, sl, tp1..tp5, reason, jumpUrl, status, latestTpHit)
 * @param {Array<{key:string,r:number}>} rrChips - e.g. [{key:'TP1', r:1.2}, ...]
 * @param {boolean} movedToBE - whether SL == Entry and a TP has hit
 */
export function renderSignalText(s, rrChips = [], movedToBE = false) {
  const dir = s.direction || 'LONG';
  const chips = (rrChips || [])
    .map(c => `\`${c.key}:${c.r}R\``)
    .join(' ');
  const rrLine = chips ? `\nR/R @ TPs: ${chips}` : '';

  const tps = ['tp1','tp2','tp3','tp4','tp5']
    .map(k => s[k] ?? null)
    .map((v,i) => (v == null ? `TP${i+1}: —` : `TP${i+1}: ${v}`))
    .join('  •  ');

  const reason = s.reason ? `\nReason: ${s.reason}` : '';
  const status =
    s.status
      ? (s.status === 'RUN_VALID' ? 'Active' : s.status.replaceAll('_', ' '))
      : 'Active';

  const beBadge = movedToBE ? ' (SL at BE)' : '';
  const link = s.jumpUrl ? `\nJump: ${s.jumpUrl}` : '';

  return [
    `**${s.asset} ${dir}** • **${status}**${beBadge}`,
    `Entry: ${s.entry ?? '—'}`,
    `SL: ${s.sl ?? '—'}`,
    tps,
    rrLine,
    reason,
    link
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Render the "Current Trades" summary text.
 * Excludes deleted/invalid ones; caller should pass only active & valid signals.
 * @param {Array<object>} activeSignals - already normalized active signals
 */
export function renderSummaryText(activeSignals = []) {
  if (!activeSignals.length) {
    return [
      `**JV Current Active Trades** 📊`,
      ``,
      `• There are currently no ongoing trades valid for entry – stay posted for future trades!`
    ].join('\n');
  }

  const lines = [];
  lines.push(`**JV Current Active Trades** 📊`);
  lines.push('');

  activeSignals.forEach((s, i) => {
    const dir = s.direction || 'LONG';
    const link = s.jumpUrl ? ` [#](<${s.jumpUrl}>)` : '';
    const entry = s.entry ?? '—';
    const sl = s.sl ?? '—';

    lines.push(
      `${i + 1}. **${s.asset} ${dir}** 🟢 — ${link}`,
    );
    lines.push(`   Entry: ${entry}`);
    lines.push(`   SL: ${sl}`);
    lines.push(''); // spacer
  });

  return lines.join('\n').trimEnd();
}

/**
 * Render a recap (weekly/monthly/etc).
 * You can pass any precomputed summary from your index/store.
 * @param {object} recap
 * @param {string} recap.title - heading, e.g. "JV Weekly Trade Recap (Sep 1–7)"
 * @param {Array<{asset:string, dir:string, r?:number|null, result?:string}>} [recap.rows]
 * @param {string} [recap.footer]
 */
export function renderRecapText(recap = {}) {
  const title = recap.title || '**JV Trade Recap**';
  const rows = Array.isArray(recap.rows) ? recap.rows : [];
  const footer = recap.footer || '';

  if (!rows.length) {
    return `${title}\n\nNo trades in this period.`;
  }

  const body = rows
    .map((r, i) => {
      const rr =
        typeof r.r === 'number' && isFinite(r.r)
          ? `${r.r >= 0 ? '+' : ''}${r.r.toFixed(2)}R`
          : (r.result || '—');
      return `${i + 1}. ${r.asset} ${r.dir} — ${rr}`;
    })
    .join('\n');

  return [title, '', body, footer].filter(Boolean).join('\n');
}
