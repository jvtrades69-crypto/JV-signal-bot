// embeds.js — text renderers

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

export function signAbsR(r) {
  const x = Number(r || 0);
  const abs = Math.abs(x).toFixed(2);
  const sign = x > 0 ? '+' : x < 0 ? '-' : '';
  return { text: `${sign}${abs}R`, abs, sign };
}

// ---- R math helpers ----
function rAtPrice(direction, entry, slOriginal, price) {
  if (entry == null || slOriginal == null || price == null) return null;
  const E = Number(entry), S = Number(slOriginal), P = Number(price);
  if ([E,S,P].some(Number.isNaN)) return null;
  if (direction === 'LONG') {
    const risk = E - S; if (risk <= 0) return null; return (P - E) / risk;
  } else {
    const risk = S - E; if (risk <= 0) return null; return (E - P) / risk;
  }
}

function computeRealized(signal) {
  const fills = Array.isArray(signal.fills) ? signal.fills : [];
  let sum = 0;
  const parts = [];
  for (const f of fills) {
    const pct = Number(f.pct || 0);
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, f.price);
    if (Number.isNaN(pct) || r === null) continue;
    sum += (pct * r) / 100;
    const src = String(f.source || '').toUpperCase();
    if (src.startsWith('TP')) parts.push(`${pct}% closed at ${src}`);
    else if (src === 'FINAL_CLOSE') parts.push(`${pct}% closed at ${f.price}`);
    else if (src === 'STOP_BE') parts.push(`${pct}% closed at BE`);
    else if (src === 'STOP_OUT') parts.push(`${pct}% closed at SL`);
  }
  return { realized: Number(sum.toFixed(2)), parts };
}

function computeTpPercents(signal) {
  const planned = signal.plan || {};
  const acc = { TP1: 0, TP2: 0, TP3: 0, TP4: 0, TP5: 0 };
  for (const f of signal.fills || []) {
    const src = String(f.source || '').toUpperCase();
    if (src.startsWith('TP')) {
      const key = src.slice(0, 3);
      if (acc[key] !== undefined) acc[key] += Number(f.pct || 0);
    }
  }
  for (const k of Object.keys(acc)) {
    if (acc[k] <= 0 && planned[k] != null) acc[k] = Number(planned[k]) || 0;
    acc[k] = Math.max(0, Math.min(100, Math.round(acc[k])));
  }
  return acc;
}

// ---- titles ----
function buildTitle(signal) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢';
  const base = `**$${String(signal.asset).toUpperCase()} | ${dirWord} ${circle}**`;

  // If finished & finalR present, show that
  if (signal.status !== 'RUN_VALID' && signal.finalR != null) {
    const fr = Number(signal.finalR);
    if (signal.status === 'STOPPED_BE' && fr === 0) return `**$${String(signal.asset).toUpperCase()} | ${dirWord} ${circle} ( Breakeven )**`;
    if (fr > 0) return `**$${String(signal.asset).toUpperCase()} | ${dirWord} ${circle} ( Win +${fr.toFixed(2)}R )**`;
    if (fr < 0) return `**$${String(signal.asset).toUpperCase()} | ${dirWord} ${circle} ( Loss ${Math.abs(fr).toFixed(2)}R )**`;
    return `${base} ( +0.00R )`;
  }

  const { realized } = computeRealized(signal);
  if (signal.status === 'STOPPED_OUT') return `${base} ( Loss -${Math.abs(realized).toFixed(2)}R )`;
  if (signal.status === 'STOPPED_BE') {
    const anyFill = (signal.fills || []).length > 0;
    return `${base} ( ${anyFill ? `Win +${realized.toFixed(2)}R` : 'Breakeven'} )`;
  }
  if (signal.status === 'CLOSED') return `${base} ( Win +${realized.toFixed(2)}R )`;
  if ((signal.fills || []).length > 0) return `${base} ( Win +${realized.toFixed(2)}R so far )`;
  return base;
}

// ---- main signal renderer ----
export function renderSignalText(signal) {
  const lines = [];
  lines.push(buildTitle(signal));
  lines.push('');

  // Trade details
  lines.push('📊 **Trade Details**');
  lines.push(`- Entry: \`${fmt(signal.entry)}\``);
  lines.push(`- SL: \`${fmt(signal.sl)}\``);

  // TPs with % or R
  const tps = ['tp1','tp2','tp3','tp4','tp5'];
  const execOrPlan = computeTpPercents(signal);
  for (const k of tps) {
    const v = signal[k];
    if (v == null || v === '') continue;
    const label = k.toUpperCase();
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const rrTxt = (r != null) ? `${r.toFixed(2)}R` : null;
    const pct = execOrPlan[label];
    if (pct > 0 && rrTxt)      lines.push(`- ${label}: \`${fmt(v)}\` (${pct}% out | ${rrTxt})`);
    else if (pct > 0)          lines.push(`- ${label}: \`${fmt(v)}\` (${pct}% out)`);
    else if (rrTxt)            lines.push(`- ${label}: \`${fmt(v)}\` (${rrTxt})`);
    else                       lines.push(`- ${label}: \`${fmt(v)}\``);
  }

  if (signal.reason && String(signal.reason).trim()) {
    lines.push('');
    lines.push('📝 **Reasoning**');
    lines.push(String(signal.reason).trim());
  }

  // Status
  lines.push('');
  lines.push('📍 **Status**');
  if (signal.status === 'RUN_VALID') {
    const slMoved = (signal.entry != null && signal.sl != null && Number(signal.entry) === Number(signal.sl));
    // Build hits list from recorded TP hits; show executed % per TP if any fills exist for that TP
    const order = ['TP1','TP2','TP3','TP4','TP5'];
    const hitList = order.filter(k => signal.tpHits && signal.tpHits[k]);
    const perTpExec = Object.fromEntries(order.map(k => [k, 0]));
    for (const f of (signal.fills || [])) {
      const src = String(f.source || '').toUpperCase();
      if (perTpExec[src] !== undefined) perTpExec[src] += Number(f.pct || 0);
    }
    const parts = hitList.map(k => perTpExec[k] > 0 ? `${k} hit (${Math.round(perTpExec[k])}% closed)` : `${k} hit`);
    if (parts.length) {
      lines.push(`Active 🟩 | ${parts.join(' , ')}`);
    } else {
      lines.push('Active 🟩');
    }
    const reentry = signal.validReentry ? '✅' : '❌';
    const after = slMoved ? (signal.beMovedAfter ? ` after ${signal.beMovedAfter}` : '') : '';
    lines.push(`Valid for re-entry: ${reentry}${slMoved ? ' | SL moved to breakeven' + after : ''}`);
  } else {
      lines.push(`Active 🟩`);
      lines.push(`Valid for re-entry: ✅`);
    }
  } else {
    if (signal.status === 'CLOSED') {
      const tp = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
      lines.push(`Inactive 🟥 | Fully closed${tp}`);
    } else if (signal.status === 'STOPPED_BE') {
      const tp = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
      lines.push(`Inactive 🟥 | Stopped breakeven${tp}`);
    } else if (signal.status === 'STOPPED_OUT') {
      lines.push(`Inactive 🟥 | Stopped out`);
    } else {
      lines.push(`Inactive 🟥`);
    }
    lines.push(`Valid for re-entry: ❌`);
  }

  // Max R
  if (signal.maxR != null && !Number.isNaN(Number(signal.maxR))) {
    const mr = Number(signal.maxR).toFixed(2);
    const soFar = signal.status === 'RUN_VALID' ? ' so far' : '';
    lines.push('');
    lines.push('📈 **Max R reached**');
    lines.push(`${mr}R${soFar}`);
    const anyTpHit = !!(signal.tpHits && Object.values(signal.tpHits).some(Boolean));
    if (signal.status === 'RUN_VALID' && !anyTpHit) lines.push('Awaiting TP1…');
  }

  // Realized (only if finished or we have fills)
  const hasFills = Array.isArray(signal.fills) && signal.fills.length > 0;
  if (signal.status !== 'RUN_VALID' || hasFills) {
    lines.push('');
    lines.push('💰 **Realized**');
    if (signal.status !== 'RUN_VALID' && signal.finalR != null) {
      const { text } = signAbsR(Number(signal.finalR));
      if (signal.status === 'CLOSED') {
        const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
        lines.push(`${text} ( fully closed${after} )`);
      } else if (signal.status === 'STOPPED_BE') {
        if (Number(signal.finalR) === 0) lines.push(`0.00R ( stopped breakeven )`);
        else {
          const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
          lines.push(`${text} ( stopped breakeven${after} )`);
        }
      } else if (signal.status === 'STOPPED_OUT') {
        lines.push(`${text} ( stopped out )`);
      }
    } else {
      const info = computeRealized(signal);
      const pretty = signAbsR(info.realized).text;
      const list = info.parts.length ? info.parts.join(', ') : null;
      if (signal.status === 'RUN_VALID') {
        if (list) lines.push(`${pretty} so far ( ${list} )`);
      } else if (signal.status === 'CLOSED') {
        const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
        lines.push(`${pretty} ( fully closed${after} )`);
      } else if (signal.status === 'STOPPED_BE') {
        if (signal.latestTpHit) lines.push(`${pretty} ( stopped breakeven after ${signal.latestTpHit} )`);
        else lines.push(`0.00R ( stopped breakeven )`);
      } else if (signal.status === 'STOPPED_OUT') {
        lines.push(`${pretty} ( stopped out )`);
      } else if (list) {
        lines.push(`${pretty} so far ( ${list} )`);
      }
    }
  }

  // Chart link (masked text). We never print the raw URL here.
  if (signal.chartUrl && !signal.chartAttached) {
    lines.push('');
    lines.push(`[View chart](${signal.chartUrl})`);
  }

  return lines.join('\n');
}

// Summary list for the “Current Active Trades” message
export function renderSummaryText(activeSignals) {
  const title = '**JV Current Active Trades** 📊';
  if (!activeSignals || !activeSignals.length) {
    return `${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades!`;
  }
  const lines = [title, ''];
  activeSignals.forEach((s, i) => {
    const dirWord = s.direction === 'SHORT' ? 'Short' : 'Long';
    const circle = s.direction === 'SHORT' ? '🔴' : '🟢';
    lines.push(`${i + 1}⃣ $${s.asset} | ${dirWord} ${circle}`);
    lines.push(`- Entry: \`${fmt(s.entry)}\``);
    lines.push(`- SL: \`${fmt(s.sl)}\``);
    lines.push(`- Status: Active 🟩`);
    if (s.jumpUrl) lines.push(`[View Full Signal](${s.jumpUrl})`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

// /recap text used by index.js
export function renderRecapText(signal, extras = {}, rrChips = []) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢';

  // pick finalR if closed/BE/OUT, else realized so far
  const { realized } = computeRealized(signal);
  const final =
    signal.status !== 'RUN_VALID' && signal.finalR != null
      ? Number(signal.finalR)
      : realized;

  const lines = [];
  lines.push(`**$${String(signal.asset).toUpperCase()} | Trade Recap ${signAbsR(final).text} (${dirWord}) ${circle}**`);
  lines.push('');
  lines.push('📊 **Basics**');
  lines.push(`- Entry: \`${fmt(signal.entry)}\``);
  lines.push(`- SL: \`${fmt(signal.sl)}\``);

  const tpKeys = ['tp1','tp2','tp3','tp4','tp5'];
  tpKeys.forEach((k, idx) => {
    const v = signal[k];
    if (v == null || v === '') return;
    const label = `TP${idx + 1}`;
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    lines.push(`- ${label}: \`${fmt(v)}\`${r != null ? ` (${r.toFixed(2)}R)` : ''}`);
  });
  if (rrChips?.length) {
    lines.push(`- R/R map: ${rrChips.map(c => `${c.key} ${Number(c.r).toFixed(2)}R`).join(' | ')}`);
  }

  const reasonLines = extras.reasonLines || [];
  if (reasonLines.length) {
    lines.push('');
    lines.push('📍 **Trade Reason**');
    reasonLines.forEach(ln => lines.push(`- ${ln}`));
  }
  const confLines = extras.confLines || [];
  if (confLines.length) {
    lines.push('');
    lines.push('🔎 **Entry Confluences**');
    confLines.forEach(ln => lines.push(`- ${ln}`));
  }
  const notesLines = extras.notesLines || [];
  if (notesLines.length) {
    lines.push('');
    lines.push('📝 **Notes**');
    notesLines.forEach(ln => lines.push(`- ${ln}`));
  }

  if (signal.jumpUrl) {
    lines.push('');
    lines.push(`🔗 [View Original Trade](${signal.jumpUrl})`);
  }

  return lines.join('\n');
}
