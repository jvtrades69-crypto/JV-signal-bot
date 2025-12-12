// embeds.js — text + minimal embeds with risk badge support

// ---------- helpers ----------
function addCommas(num) {
  if (num === null || num === undefined || num === '') return String(num);
  const n = Number(num);
  if (Number.isNaN(n)) return String(num);
  return n.toLocaleString('en-US');
}
export function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return addCommas(n);
}
function rAtPrice(direction, entry, slOriginal, price) {
  if (entry == null || slOriginal == null || price == null) return null;
  const E = Number(entry), S = Number(slOriginal), P = Number(price);
  if ([E, S, P].some(Number.isNaN)) return null;
  if (direction === 'LONG') {
    const risk = E - S; if (risk <= 0) return null; return (P - E) / risk;
  }
  const risk = S - E; if (risk <= 0) return null; return (E - P) / risk;


}
function computeRealized(signal) {
  const fills = Array.isArray(signal.fills) ? signal.fills : [];
  let sum = 0;
  for (const f of fills) {
    const pct = Number(f.pct || 0);
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, f.price);
    if (Number.isNaN(pct) || r === null) continue;
    sum += (pct * r) / 100;
  }
  // apply risk badge multiplier ONLY on net losses
  const lbl = String(signal.riskLabel || '').toLowerCase();
  let factor = 1;
  if (sum < 0) {
    if (lbl === 'half' || lbl === '1/2') factor = 0.5;
    else if (lbl === '1/4' || lbl === 'quarter') factor = 0.25;
    else if (lbl === '3/4' || lbl === 'three-quarter' || lbl === 'threequarter') factor = 0.75;
  }
  return Number((sum * factor).toFixed(2));
}

  function dirWord(signal) { return signal.direction === 'SHORT' ? 'Short' : 'Long'; }
function dirDot(signal) { return signal.direction === 'SHORT' ? '🔴' : '🟢'; }

// Sum executed % per TP from fills; fallback to plan if none executed
function computeTpPercents(signal){
  const acc = {TP1:0,TP2:0,TP3:0,TP4:0,TP5:0};
  for (const f of (signal.fills || [])) {
    const src = String(f.source || '').toUpperCase();
    if (acc[src] !== undefined) acc[src] += Number(f.pct || 0);
  }
  const plan = signal.plan || {};
  for (const k of Object.keys(acc)) {
    if (acc[k] <= 0 && plan[k] != null) acc[k] = Number(plan[k]) || 0;
    acc[k] = Math.max(0, Math.min(100, Math.round(acc[k])));
  }
  return acc;
}

// ---------- titles ----------
function buildTitle(signal) {
  const riskBadge = (!signal.latestTpHit && signal.riskLabel) ? ` (${signal.riskLabel} risk)` : '';
  const head = `$${String(signal.asset).toUpperCase()} | ${dirWord(signal)} ${dirDot(signal)}${riskBadge}`;

  const isFinal = ['CLOSED', 'STOPPED_BE', 'STOPPED_OUT'].includes(signal.status);
  const hasFinal = signal.finalR != null && isFinite(Number(signal.finalR));
  const useR = (isFinal && hasFinal) ? Number(signal.finalR) : computeRealized(signal);

    let suffix = '';
  const sign = useR >= 0 ? '+' : '';
  const verdict = useR >= 0 ? 'Win' : 'Loss';

  if (signal.status === 'STOPPED_OUT') {
    suffix = `Loss -${Math.abs(useR).toFixed(2)}R`;
  } else if (signal.status === 'STOPPED_BE') {
    const anyFill = (signal.fills || []).length > 0;
    suffix = anyFill ? `${verdict} ${sign}${useR.toFixed(2)}R` : 'Breakeven';
  } else if (signal.status === 'CLOSED') {
    suffix = `${verdict} ${sign}${useR.toFixed(2)}R`;
  } else if ((signal.fills || []).length > 0) {
    suffix = `${verdict} ${sign}${useR.toFixed(2)}R so far`;
  }

  return suffix ? `**${head} (${suffix})**` : `**${head}**`;
}

// ---------- main text blocks ----------
export function renderSignalText(signal /*, rrChips, isSlBE */) {
  const lines = [];
  lines.push(buildTitle(signal), '', '📊 **Trade Details**');
  lines.push(`- Entry: \`${fmt(signal.entry)}\``);
  lines.push(`- SL: \`${fmt(signal.sl)}\``);

 
 
   // TP lines with % out, R and hit marker
  const tpPerc = computeTpPercents(signal);
  for (const key of ['tp1','tp2','tp3','tp4','tp5']) {
    const v = signal[key];
    if (v == null || v === '') continue;
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const rrTxt = (r != null) ? `${r.toFixed(2)}R` : null;
    const label = key.toUpperCase();
    const pct = tpPerc[label];
    const hitMark = signal.tpHits?.[label] ? ' ✅' : '';

    if (pct > 0 && rrTxt)      lines.push(`- ${label}: \`${fmt(v)}\` (${pct}% out | ${rrTxt})${hitMark}`);
    else if (pct > 0)          lines.push(`- ${label}: \`${fmt(v)}\` (${pct}% out)${hitMark}`);
    else if (rrTxt)            lines.push(`- ${label}: \`${fmt(v)}\` (${rrTxt})${hitMark}`);
    else                       lines.push(`- ${label}: \`${fmt(v)}\`${hitMark}`);
  }

  // BE plan line must appear after TP lines
  if (signal.beAt) {
    lines.push(`- Stops to breakeven at \`${fmt(signal.beAt)}\``);
  }

  if (signal.reason && String(signal.reason).trim()) {
    lines.push('', '📝 **Reasoning**', String(signal.reason).trim());
  }

  // Status
  lines.push('', '📍 **Status**');
  if (signal.status === 'RUN_VALID') {
    const hitOrder = ['TP5','TP4','TP3','TP2','TP1'];
    const highestTP = hitOrder.find(k => signal.tpHits && signal.tpHits[k]) || null;
    const hitsLine = highestTP ? `Active 🟩 | ${highestTP} hit` : 'Active 🟩 | Trade running';

    let tail = '';
    if (signal.slProfitSet) {
      const afterTP = signal.slProfitAfterTP ? ` after ${signal.slProfitAfterTP}` : (highestTP ? ` after ${highestTP}` : '');
      const atPrice = isFinite(Number(signal.slProfitAfter)) ? ` at \`${fmt(signal.slProfitAfter)}\`` : '';
      tail = ` | SL moved into profits${afterTP}${atPrice}`;
    } else if (signal.beSet || signal.beMovedAfter) {
      const afterTP = signal.beMovedAfter ? ` after ${signal.beMovedAfter}` : (highestTP ? ` after ${highestTP}` : '');
      // no price here
      tail = ` | SL moved to breakeven${afterTP}`;
    }

    lines.push(hitsLine);
    lines.push(`Valid for re-entry: ${signal.validReentry ? '✅' : '❌'}${tail}`);
  } else {
    const highestTP = ['TP5','TP4','TP3','TP2','TP1'].find(k => signal.tpHits && signal.tpHits[k]) || null;
    const afterTP = highestTP ? ` after ${highestTP}` : '';

    if (signal.status === 'CLOSED') {
      if (signal.stoppedInProfit) {
        const atPrice = isFinite(Number(signal.slProfitAfter)) ? ` at \`${fmt(signal.slProfitAfter)}\`` : '';
        lines.push(`Inactive 🟥 | Stopped in profits${afterTP}${atPrice}`);
      } else {
        // show final close price if available
        const fills = Array.isArray(signal.fills) ? signal.fills : [];
        const finalFill = [...fills].reverse().find(f => {
          const src = String(f.source || '').toUpperCase();
          return src === 'FINAL_CLOSE' || src === 'FINAL_CLOSE_PROFIT';
        });
        const priceTail = finalFill && isFinite(Number(finalFill.price)) ? ` at \`${fmt(finalFill.price)}\`` : '';
        lines.push(`Inactive 🟥 | Fully closed${afterTP}${priceTail}`);
      }
    }
    else if (signal.status === 'STOPPED_BE') {
      // final BE without price
      lines.push(`Inactive 🟥 | Stopped breakeven${afterTP}`);
    } else if (signal.status === 'STOPPED_OUT') {
      lines.push('Inactive 🟥 | Stopped out');
    } else {
      lines.push('Inactive 🟥');
    }
    lines.push('Valid for re-entry: ❌');
  }

  // Max R
  if (signal.maxR != null && isFinite(Number(signal.maxR))) {
    const mr = Number(signal.maxR).toFixed(2);
    const tail = signal.status === 'RUN_VALID' ? ' so far' : '';
    lines.push('', '📈 **Max R reached**', `${mr}R${tail}`);
  }

  // Realized
  const realized = (signal.status !== 'RUN_VALID' && signal.finalR != null)
    ? Number(signal.finalR)
    : computeRealized(signal);

  if (signal.status !== 'RUN_VALID' || realized !== 0) {
    let tail = '';
    if (signal.status === 'CLOSED') {
      if (signal.stoppedInProfit) {
        const highestTP = ['TP5','TP4','TP3','TP2','TP1'].find(k => signal.tpHits && signal.tpHits[k]) || null;
        const afterTP = highestTP ? ` after ${highestTP}` : '';
        const atPrice = isFinite(Number(signal.slProfitAfter)) ? ` at \`${fmt(signal.slProfitAfter)}\`` : '';
        tail = ` ( stopped in profits${afterTP}${atPrice} )`;
      } else {
        const highestTP = ['TP5','TP4','TP3','TP2','TP1'].find(k => signal.tpHits && signal.tpHits[k]) || null;
        const afterTP = highestTP ? ` after ${highestTP}` : '';
        tail = ` ( fully closed${afterTP} )`;
      }
    } else if (signal.status === 'STOPPED_BE') {
      const highestTP = ['TP5','TP4','TP3','TP2','TP1'].find(k => signal.tpHits && signal.tpHits[k]) || null;
      const afterTP = highestTP ? ` after ${highestTP}` : '';
      tail = ` ( stopped breakeven${afterTP} )`; // no price
    } else if (signal.status === 'STOPPED_OUT') {
      tail = ' ( stopped out )';
    } else if (signal.status === 'RUN_VALID') {
      tail = ' so far';
    }

    lines.push('', '💰 **Realized**', `${realized >= 0 ? '+' : ''}${realized.toFixed(2)}R${tail}`);
  }

  if (signal.chartUrl && !signal.chartAttached) {
    lines.push('', `[View chart](${signal.chartUrl})`);
  }
  return lines.join('\n');
}

export function renderSummaryText(activeSignals) {
  const title = '**JV Current Active Trades** 📊';
  if (!activeSignals || !activeSignals.length) {
    return `${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades!`;
  }
  const lines = [title, ''];
  activeSignals.forEach((s, i) => {
    lines.push(`${i + 1}⃣ $${s.asset} | ${dirWord(s)} ${dirDot(s)}`);
    lines.push(`- Entry: \`${fmt(s.entry)}\``);
    lines.push(`- SL: \`${fmt(s.sl)}\``);
    if (s.jumpUrl) lines.push(`[View Full Signal](${s.jumpUrl})`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

export function renderRecapText(signal, extras = {}, rrChips = []) {
  const { reasonLines = [], confLines = [], notesLines = [], showBasics = false } = extras || {};
  const lines = [];

  // ---- Title with outcome emoji and direction dot
  const isFinal = ['CLOSED', 'STOPPED_BE', 'STOPPED_OUT'].includes(signal.status);
  const hasFinal = signal.finalR != null && isFinite(Number(signal.finalR));
  const useR = (isFinal && hasFinal) ? Number(signal.finalR) : computeRealized(signal);
  const outcome = useR >= 0 ? '✅' : '❌';
  const title = `$${String(signal.asset).toUpperCase()} | Trade Recap ${useR >= 0 ? '+' : ''}${useR.toFixed(2)}R ${outcome} (${dirWord(signal)}) ${dirDot(signal)}`;
  lines.push(`**${title}**`, '');

  // ---- Trade Reason
  if (reasonLines.length) {
    lines.push('🧠 **Trade Reason**', ...reasonLines.map(s => `• ${s}`), '');
  }

  // ---- Entry Confluences
  if (confLines.length) {
    lines.push('📊 **Entry Confluences**', ...confLines.map(s => `• ${s}`), '');
  }

  // ---- Take Profit (from plan/fills with R)
  const tpPerc = computeTpPercents(signal);
  const tpLines = [];
  for (const key of ['tp1','tp2','tp3','tp4','tp5']) {
    const v = signal[key];
    if (v == null || v === '') continue;
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const rrTxt = (r != null) ? `${r.toFixed(2)}R` : null;
    const label = key.toUpperCase();
    const pct = tpPerc[label];
        const hitMark = signal.tpHits?.[label] ? ' ✅' : '';
    if (pct > 0 && rrTxt)      tpLines.push(`• ${label} \`${fmt(v)}\` (${pct}% | ${rrTxt})${hitMark}`);
    else if (pct > 0)          tpLines.push(`• ${label} \`${fmt(v)}\` (${pct}%)${hitMark}`);
    else if (rrTxt)            tpLines.push(`• ${label} \`${fmt(v)}\` (${rrTxt})${hitMark}`);
    else                       tpLines.push(`• ${label} \`${fmt(v)}\`${hitMark}`);

  }
  if (tpLines.length) {
    lines.push('🎯 **Take Profit**', ...tpLines, '');
  }

  // ---- Results (Final + Max R)
  const resultsBlock = [];
  resultsBlock.push(`• Final: ${useR >= 0 ? '+' : ''}${useR.toFixed(2)}R`);
  if (signal.maxR != null && isFinite(Number(signal.maxR))) {
    resultsBlock.push(`• Max R Reached: ${Number(signal.maxR).toFixed(2)}R`);
  }
  lines.push('⚖ **Results**', ...resultsBlock, '');

  // ---- Notes
  if (notesLines.length) {
    lines.push('📝 **Notes**', ...notesLines.map(s => `• ${s}`), '');
  }

  // ---- Optional basics (if requested)
  if (showBasics) {
    lines.push('Basics');
    lines.push(`- Entry: \`${fmt(signal.entry)}\``);
    lines.push(`- SL: \`${fmt(signal.sl)}\``, '');
  }

  // ---- Link to original signal
  if (signal.jumpUrl) {
    lines.push(`[View original signal](${signal.jumpUrl})`);
  }

  return lines.join('\n').trimEnd();
}

export function renderMonthlyRecap(trades, year, monthIndex, { notesLines = [] } = {}) {
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const mname = MONTHS[monthIndex] || `M${monthIndex + 1}`;

  const isNum = (v) =>
    v !== null &&
    v !== undefined &&
    v !== '' &&
    Number.isFinite(Number(String(v).replace(/[,_\s]/g, '')));
  const toN = (v) => Number(String(v).replace(/[,_\s]/g, ''));
  const rAt = (dir, entry, sl0, price) => {
    if (!isNum(entry) || !isNum(sl0) || !isNum(price)) return null;
    const E = toN(entry), S = toN(sl0), P = toN(price);
    if (String(dir).toUpperCase() === 'LONG') {
      const r = E - S; if (r <= 0) return null; return (P - E) / r;
    }
    const r = S - E; if (r <= 0) return null; return (E - P) / r;
  };
  const plusR = (x) => (x >= 0 ? `+${x.toFixed(2)}R` : `${x.toFixed(2)}R`);

  const all = (Array.isArray(trades) ? trades : []).filter(t => {
    const ts = Number(t?.createdAt || 0);
    if (!Number.isFinite(ts)) return false;
    const d = new Date(ts);
    return d.getUTCFullYear() === year && d.getUTCMonth() === monthIndex;
  });

  const closed = all.filter(t => String(t?.status).toUpperCase() !== 'RUN_VALID');
  const open   = all.filter(t => String(t?.status).toUpperCase() === 'RUN_VALID');

  const finalR = (t) => (isNum(t?.finalR) ? Number(t.finalR) : 0);

  const wins      = closed.filter(t => finalR(t) > 0).length;
  const losses    = closed.filter(t => finalR(t) < 0).length;
  const breakeven = closed.filter(t => finalR(t) === 0).length;

  const denom = wins + losses;
  const winRatePct = denom ? Math.round((wins / denom) * 100) : 0;
  const avgRClosed = denom ? (closed.reduce((a, t) => a + finalR(t), 0) / denom) : 0;

  const netClosedR = closed.reduce((a, t) => a + finalR(t), 0);
  const unrealisedR = open.reduce((acc, t) => {
    const fills = Array.isArray(t?.fills) ? t.fills : [];
    const usedPct = fills.reduce((a, f) => a + Number(f?.pct || 0), 0);
    const remainingPct = Math.max(0, 100 - usedPct);

    const highest = ['TP5', 'TP4', 'TP3', 'TP2', 'TP1'].find(k => t?.tpHits?.[k]) || null;
    if (!highest || remainingPct <= 0) return acc;

    const price = t[String(highest).toLowerCase()];
    const rr = rAt(t.direction, t.entry, (t.slOriginal ?? t.sl), price);
    if (rr == null) return acc;

    return acc + (remainingPct / 100) * rr;
  }, 0);
  const netAllR = netClosedR + unrealisedR;

  const tradeLineClosed = (t) => {
    const asset = `$${String(t.asset || '').toUpperCase()}`;
    const dir   = String(t.direction).toUpperCase() === 'SHORT' ? 'Short' : 'Long';
    const url   = t.jumpUrl ? t.jumpUrl : '#️⃣';

    const r = finalR(t);
    const badge = r > 0 ? '✅' : r < 0 ? '❌' : '🟡';
    return `- **${asset} ${dir}**  \`${plusR(r)}\` ${badge}  [View Trade](${url})`;
  };

  const tradeLineOpen = (t) => {
    const asset = `$${String(t.asset || '').toUpperCase()}`;
    const dir   = String(t.direction).toUpperCase() === 'SHORT' ? 'Short' : 'Long';
    const url   = t.jumpUrl ? t.jumpUrl : '#️⃣';

    const fills = Array.isArray(t?.fills) ? t.fills : [];
    const usedPct = Math.min(100, Math.max(0, fills.reduce((a, f) => a + Number(f?.pct || 0), 0)));
    const remPct  = Math.max(0, 100 - usedPct);

    const realised = fills.reduce((a, f) => {
      const rr = rAt(t.direction, t.entry, (t.slOriginal ?? t.sl), f?.price);
      const pct = Number(f?.pct || 0);
      return (!Number.isFinite(pct) || rr == null) ? a : a + (pct / 100) * rr;
    }, 0);

    let approxRunner = 0;
    const highest = ['TP5', 'TP4', 'TP3', 'TP2', 'TP1'].find(k => t?.tpHits?.[k]) || null;
    if (highest && remPct > 0) {
      const p = t[String(highest).toLowerCase()];
      const rr = rAt(t.direction, t.entry, (t.slOriginal ?? t.sl), p);
      if (rr != null) approxRunner = (remPct / 100) * rr;
    }

    return `- **${asset} ${dir}**  \`${plusR(realised)}\` so far ✅  (\`${usedPct}%\` closed, \`${remPct}%\` runner open ~\`${approxRunner.toFixed(2)}R\` unrealised)  [View Trade](${url})`;
  };

    const L = [];
  L.push(`📊 **JV Trades | Monthly Recap (${mname} ${year})**`, '');
  L.push(`- **Total trades:** \`${closed.length}\``);
  L.push(`- ✅ **Wins:** \`${wins}\``);
  L.push(`- ❌ **Losses:** \`${losses}\``);
  L.push(`- 🟡 **Breakeven:** \`${breakeven}\``);
  L.push(`- **Net R (closed):** \`${plusR(netClosedR)}\``);
  L.push(`- **Avg R/closed trade:** \`${plusR(avgRClosed)}\``);
  L.push(`- **Win rate:** \`${winRatePct}%\`  *(BE counted as non-wins)*`, '');

  L.push(`🔮 **All ${closed.length} Trades (closed)**`);
  if (closed.length) closed.forEach(t => L.push(tradeLineClosed(t)));
  else L.push('- —');

    if (open.length) {
    L.push('', '📂 **Open positions carried to next month**');
    open.forEach(t => L.push(tradeLineOpen(t)));
  }


  if (Array.isArray(notesLines)) {
    L.push('', '🗒️ **Notes**');
    if (notesLines.length) {
      notesLines.forEach(n => L.push(`- ${n}`));
    } else {
      L.push('- —');
    }
  }

  return L.join('\n');
}
// ---- recap embed for attachments ----
export function renderRecapEmbed(signal, { imageUrl, attachmentName, attachmentUrl } = {}) {
  const isFinal = ['CLOSED', 'STOPPED_BE', 'STOPPED_OUT'].includes(signal.status);
  const hasFinal = signal.finalR != null && isFinite(Number(signal.finalR));
  const useR = (isFinal && hasFinal) ? Number(signal.finalR) : computeRealized(signal);

  const title = `${String(signal.asset).toUpperCase()} — Trade Recap (${dirWord(signal)})`;
  const embed = {
    type: 'rich',
    title,
    color: signal.direction === 'SHORT' ? 0xED4245 : 0x57F287,
    fields: [
      { name: 'Result', value: `${useR >= 0 ? '+' : ''}${useR.toFixed(2)}R`, inline: false },
    ],
  };
  if (signal.jumpUrl) {
    embed.fields.push({ name: 'Signal', value: `[View original signal](${signal.jumpUrl})`, inline: false });
  }
  // Prefer an explicit URL if provided…
  if (imageUrl) {
    embed.image = { url: imageUrl };
  } else if (attachmentName) {
    // …otherwise show the uploaded file
    embed.image = { url: `attachment://${attachmentName}` };
    // keep a link field too if we have the source URL
    if (attachmentUrl) {
      embed.fields.push({ name: 'Chart', value: `[${attachmentName}](${attachmentUrl})`, inline: false });
    }
  }

  return { embeds: [embed] };
}

/* ===========================
   DETAILED TEMPLATES PER SPEC
   =========================== */

export function renderMonthlyRecapDetailed({ monthName, year, totals, best, worst, allTrades, notes }) {
  const L = [];

  L.push(`📊 **JV Trades | Monthly Recap (${monthName} ${year})**`, '');
  L.push(`- Trades: ${totals.total}`);
  L.push(`- Wins: ${totals.wins} | Losses: ${totals.losses}`);
  L.push(`- Net: **${Number(totals.netR).toFixed(2)}R**`);
  L.push(`- Win Rate: ${Number(totals.winRatePct).toFixed(0)}%`);
  L.push(`- Avg R/Trade: ${Number(totals.avgR).toFixed(2)}`, '');

  L.push(`🏆 **Best Trade** → **$${best.asset} ${best.dirWord} (${Number(best.r).toFixed(2)}R)** → ${best.jumpUrl ? `[View Trade](${best.jumpUrl})` : '[View Trade](#️⃣)'}`);
  L.push(`🎯 **Take Profit Path**`);
  if (best.tp && best.tp.length) {
    for (const t of best.tp) {
      const note = t.note ? ` ${t.note}` : '';
      L.push(`- ${t.label} | ${Number(t.r).toFixed(2)}R (${Number(t.pct).toFixed(0)}%)${note}`);
    }
  } else {
    L.push(`- —`);
  }

  L.push(`💀 **Worst Trade** → **$${worst.asset} ${worst.dirWord} (${Number(worst.r).toFixed(2)}R)** → ${worst.jumpUrl ? `[View Trade](${worst.jumpUrl})` : '[View Trade](#️⃣)'}`);
  L.push(`🎯 **Take Profit Path**`);
  L.push(`- ${worst.tpNote || 'None (Stopped Out ❌)'}`);

  L.push(`🧾 **All Trades (summary)**`);
  if (allTrades && allTrades.length) {
    allTrades.forEach((t, i) => {
      L.push(`${i + 1}. $${t.asset} ${t.dirWord} ${Number(t.r).toFixed(2)}R ${t.ok ? '✅' : '❌'}`);
    });
  } else {
    L.push('—');
  }

  L.push('', `🗒️ **Notes**`);
  if (notes && notes.length) {
    notes.forEach(n => L.push(`- ${n}`));
  } else {
    L.push('- —');
  }

  L.push('', '#Crypto #DayTrading #PriceAction');
  return L.join('\n');
}

export function renderWeeklyRecapDetailed({ startDateStr, endDateStr, totals, topMoves, allTrades, takeaways, focus }) {
  const L = [];
  L.push(`📈 **JV Trades | Weekly Recap (${startDateStr} → ${endDateStr})**`, '');
  L.push(`- Trades: ${totals.total}`);
  L.push(`- Net: **${Number(totals.netR).toFixed(2)}R**`);
  L.push(`- Win Rate: ${Number(totals.winRatePct).toFixed(0)}%`);
  L.push(`- Avg R/Trade: ${Number(totals.avgR).toFixed(2)}`, '');

  L.push(`🔥 **Top Moves**`);
  if (topMoves && topMoves.length) {
    topMoves.slice(0, 2).forEach(t => {
      L.push(`- **$${t.asset} ${t.dirWord}** → **${Number(t.r).toFixed(2)}R** → ${t.jumpUrl ? `[View](${t.jumpUrl})` : '[View](#️⃣)'}`);
    });
  } else {
    L.push('- —');
  }

  L.push('', `🧾 **All Trades (quick list)**`);
  if (allTrades && allTrades.length) {
    allTrades.forEach((t, i) => {
      L.push(`${i + 1}. $${t.asset} ${t.dirWord} ${Number(t.r).toFixed(2)}R ${t.ok ? '✅' : '❌'}`);
    });
  } else {
    L.push('—');
  }

  L.push('', `🔧 **This Week’s Takeaways**`);
  if (takeaways && takeaways.length) {
    takeaways.forEach(n => L.push(`- ${n}`));
  } else {
    L.push('- —');
  }

  L.push('', `🎯 **Focus Next Week**`);
  if (focus && focus.length) {
    focus.forEach(n => L.push(`- ${n}`));
  } else {
    L.push('- —');
  }

  L.push('', '#BTC #ETH #SOL #DayTrading');
  return L.join('\n');
}
