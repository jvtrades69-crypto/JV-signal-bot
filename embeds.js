// embeds.js — Text renderers (clean formatted style)

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return v;
  return addCommas(n);
}

function addCommas(num) {
  if (num === null || num === undefined || num === '') return num;
  const n = Number(num);
  if (isNaN(n)) return num;
  return n.toLocaleString('en-US');
}

function signAbsR(r) {
  const x = Number(r || 0);
  const abs = Math.abs(x).toFixed(2);
  const sign = x > 0 ? '+' : x < 0 ? '-' : '';
  return { text: `${sign}${abs}R`, abs, sign };
}

function rrLineFromChips(rrChips) {
  if (!rrChips || !rrChips.length) return null;
  return rrChips.map(c => `${c.key} ${Number(c.r).toFixed(2)}R`).join(' | ');
}

// prefer executed %; else planned %
function computeTpPercents(signal) {
  const planned = signal.plan || {};
  const acc = { TP1: 0, TP2: 0, TP3: 0, TP4: 0, TP5: 0 };
  for (const f of signal.fills || []) {
    const src = String(f.source || '').toUpperCase();
    if (src.startsWith('TP')) {
      const key = src.slice(0,3);
      if (acc[key] !== undefined) acc[key] += Number(f.pct || 0);
    }
  }
  for (const k of Object.keys(acc)) {
    if (acc[k] <= 0 && planned[k] != null) acc[k] = Number(planned[k]) || 0;
    acc[k] = Math.max(0, Math.min(100, Math.round(acc[k])));
  }
  return acc;
}

// local realized calc (when no override)
function rAtPrice(direction, entry, slOriginal, price) {
  if (entry == null || slOriginal == null || price == null) return null;
  const E = Number(entry), S = Number(slOriginal), P = Number(price);
  if (Number.isNaN(E) || Number.isNaN(S) || Number.isNaN(P)) return null;
  if (direction === 'LONG') {
    const risk = E - S; if (risk <= 0) return null; return (P - E) / risk;
  } else {
    const risk = S - E; if (risk <= 0) return null; return (E - P) / risk;
  }
}
function computeRealized(signal) {
  const fills = signal.fills || [];
  if (!fills.length) return { realized: 0, parts: [] };
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

export function buildTitle(signal) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢'; // direction only
  const base = `$${signal.asset} | ${dirWord} ${circle}`;

  // Closures may override with finalR
  if (signal.status !== 'RUN_VALID' && signal.finalR != null) {
    const fr = Number(signal.finalR);
    if (signal.status === 'STOPPED_BE' && fr === 0) return `**${base} ( Breakeven )**`;
    if (fr > 0) return `**${base} ( Win +${fr.toFixed(2)}R )**`;
    if (fr < 0) return `**${base} ( Loss ${Math.abs(fr).toFixed(2)}R )**`;
    return `**${base} ( +0.00R )**`;
  }

  // Active or calculated closures
  const { realized } = computeRealized(signal);
  if (signal.status === 'STOPPED_OUT') return `**${base} ( Loss -${Math.abs(realized).toFixed(2)}R )**`;
  if (signal.status === 'STOPPED_BE') {
    const anyFill = (signal.fills || []).length > 0;
    return `**${base} ( ${anyFill ? `Win +${realized.toFixed(2)}R` : 'Breakeven'} )**`;
  }
  if (signal.status === 'CLOSED') return `**${base} ( Win +${realized.toFixed(2)}R )**`;

  // Running — only show "so far" if we have any realized
  if ((signal.fills || []).length > 0) return `**${base} ( Win +${realized.toFixed(2)}R so far )**`;
  return `**${base}**`;
}

export function renderSignalText(signal, rrChips, slMovedToBEActive) {
  const lines = [];

  // Title
  lines.push(buildTitle(signal));
  lines.push('');

  // Trade details
  lines.push(`📊 **Trade Details**`);
  lines.push(`- Entry: \`${fmt(signal.entry)}\``);
  lines.push(`- SL: \`${fmt(signal.sl)}\``);

  const tps = ['tp1','tp2','tp3','tp4','tp5'];
  const execOrPlan = computeTpPercents(signal);
  for (const k of tps) {
    const v = signal[k];
    if (v === null || v === undefined || v === '') continue;
    const label = k.toUpperCase();
    const pct = execOrPlan[label];
    const chip = rrChips.find(c => c.key === label);
    const rrTxt = chip ? `${chip.r.toFixed(2)}R` : null;
    if (pct > 0 && rrTxt) {
      lines.push(`- ${label}: \`${fmt(v)}\` (${pct}% out | ${rrTxt})`);
    } else if (pct > 0) {
      lines.push(`- ${label}: \`${fmt(v)}\` (${pct}% out)`);
    } else if (rrTxt) {
      lines.push(`- ${label}: \`${fmt(v)}\` (${rrTxt})`);
    } else {
      lines.push(`- ${label}: \`${fmt(v)}\``);
    }
  }

  if (signal.reason && String(signal.reason).trim().length) {
    lines.push('');
    lines.push(`📝 **Reasoning**`);
    lines.push(String(signal.reason).trim());
  }

  // Status
  lines.push('');
  lines.push(`📍 **Status**`);
  if (signal.status === 'RUN_VALID') {
    if (slMovedToBEActive) {
      const tp = signal.latestTpHit ? `${signal.latestTpHit}` : '';
      lines.push(`Active 🟩 | SL moved to breakeven${tp ? ` after ${tp}` : ''}`);
      lines.push(`Valid for re-entry: ❌`);
    } else if (signal.latestTpHit) {
      lines.push(`Active 🟩 | ${signal.latestTpHit} hit`);
      lines.push(`Valid for re-entry: ✅`);
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

  // Max R reached (before Realized)
  if (signal.maxR != null && !Number.isNaN(Number(signal.maxR))) {
    const mr = Number(signal.maxR).toFixed(2);
    const soFar = signal.status === 'RUN_VALID' ? ' so far' : '';
    lines.push('');
    lines.push(`📈 **Max R reached**`);
    lines.push(`${mr}R${soFar}`);
    // If no TP hits yet and trade still running, mention awaiting TP1
    const anyTpHit = !!(signal.tpHits && Object.values(signal.tpHits).some(Boolean));
    if (signal.status === 'RUN_VALID' && !anyTpHit) {
      lines.push(`Awaiting TP1…`);
    }
  }

  // Chart link (always as text; creation-attachment is handled by index.js)
  if (signal.chartUrl) {
    lines.push('');
    lines.push(`🖼️ **Chart**`);
    lines.push(`${signal.chartUrl}`);
  }

  // Realized
  const hasFills = Array.isArray(signal.fills) && signal.fills.length > 0;
  if (signal.status !== 'RUN_VALID' || hasFills) {
    lines.push('');
    lines.push(`💰 **Realized**`);
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

  return lines.join('\n');
}

export function renderSummaryText(activeSignals) {
  const title = `**JV Current Active Trades** 📊`;
  if (!activeSignals || !activeSignals.length) {
    return `${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades.`;
  }
  const lines = [title, ''];
  activeSignals.forEach((s, i) => {
    const dirWord = s.direction === 'SHORT' ? 'Short' : 'Long';
    const circle = s.direction === 'SHORT' ? '🔴' : '🟢';
    lines.push(`${i+1}️⃣ $${s.asset} | ${dirWord} ${circle}`);
    lines.push(`- Entry: \`${fmt(s.entry)}\``);
    lines.push(`- SL: \`${fmt(s.sl)}\``);
    lines.push(`- Status: Active 🟩`);
    if (s.jumpUrl) {
      lines.push(`[View Full Signal](${s.jumpUrl})`);
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}
