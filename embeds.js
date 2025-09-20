// embeds.js — Text renderers (clean formatted style)

function addCommas(num) {
  if (num === null || num === undefined || num === '') return String(num);
  const n = Number(num);
  if (Number.isNaN(n)) return String(num);
  return n.toLocaleString('en-US');
}

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  return addCommas(n);
}

export function signAbsR(r) {
  const x = Number(r || 0);
  const abs = Math.abs(x).toFixed(2);
  const sign = x > 0 ? '+' : x < 0 ? '-' : '';
  return { text: ${sign}${abs}R, abs, sign };
}

export function rrLineFromChips(rrChips) {
  if (!rrChips || !rrChips.length) return null;
  return rrChips.map(c => ${c.key} ${Number(c.r).toFixed(2)}R).join(' | ');
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

// prefer executed %; else planned %
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
    if (src.startsWith('TP')) parts.push(${pct}% closed at ${src});
    else if (src === 'FINAL_CLOSE') parts.push(${pct}% closed at ${f.price});
    else if (src === 'STOP_BE') parts.push(${pct}% closed at BE);
    else if (src === 'STOP_OUT') parts.push(${pct}% closed at SL);
  }
  return { realized: Number(sum.toFixed(2)), parts };
}

export function buildTitle(signal) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢'; // direction only
  const base = $${signal.asset} | ${dirWord} ${circle};

  // Closures may override with finalR
  if (signal.status !== 'RUN_VALID' && signal.finalR != null) {
    const fr = Number(signal.finalR);
    if (signal.status === 'STOPPED_BE' && fr === 0) return **${base} ( Breakeven )**;
    if (fr > 0) return **${base} ( Win +${fr.toFixed(2)}R )**;
    if (fr < 0) return **${base} ( Loss ${Math.abs(fr).toFixed(2)}R )**;
    return **${base} ( +0.00R )**;
  }

  // Active or calculated closures
  const { realized } = computeRealized(signal);
  if (signal.status === 'STOPPED_OUT') return **${base} ( Loss -${Math.abs(realized).toFixed(2)}R )**;
  if (signal.status === 'STOPPED_BE') {
    const anyFill = (signal.fills || []).length > 0;
    return `**${base} ( ${anyFill ? Win +${realized.toFixed(2)}R : 'Breakeven'} )**`;
  }
  if (signal.status === 'CLOSED') return **${base} ( Win +${realized.toFixed(2)}R )**;

  // Running — only show "so far" if we have any realized
  if ((signal.fills || []).length > 0) return **${base} ( Win +${realized.toFixed(2)}R so far )**;
  return **${base}**;
}

export function renderSignalText(signal, rrChips, slMovedToBEActive) {
  const lines = [];

  // Title
  lines.push(buildTitle(signal));
  lines.push('');

  // Trade details
<<<<<<< HEAD
  lines.push(📊 **Trade Details**);
  lines.push(- Entry: \${fmt(signal.entry)}\``);
  lines.push(- SL: \${fmt(signal.sl)}\``);
=======
  lines.push('📊 **Trade Details**');
  lines.push(`- Entry: \`${fmt(signal.entry)}\``);
  lines.push(`- SL: \`${fmt(signal.sl)}\``);
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92

  const tps = ['tp1','tp2','tp3','tp4','tp5'];
  const execOrPlan = computeTpPercents(signal);
  for (const k of tps) {
    const v = signal[k];
    if (v === null || v === undefined || v === '') continue;
    const label = k.toUpperCase();
    const pct = execOrPlan[label];
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const rrTxt = (r != null) ? ${r.toFixed(2)}R : null;
    if (pct > 0 && rrTxt) {
      lines.push(- ${label}: \${fmt(v)}\` (${pct}% out | ${rrTxt})`);
    } else if (pct > 0) {
      lines.push(- ${label}: \${fmt(v)}\` (${pct}% out)`);
    } else if (rrTxt) {
      lines.push(- ${label}: \${fmt(v)}\` (${rrTxt})`);
    } else {
      lines.push(- ${label}: \${fmt(v)}\``);
    }
  }

  if (signal.reason && String(signal.reason).trim().length) {
    lines.push('');
<<<<<<< HEAD
    lines.push(📝 **Reasoning**);
=======
    lines.push('📝 **Reasoning**');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    lines.push(String(signal.reason).trim());
  }

  // Status
  lines.push('');
<<<<<<< HEAD
  lines.push(📍 **Status**);
=======
  lines.push('📍 **Status**');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
  if (signal.status === 'RUN_VALID') {
    const slMoved = (signal.entry != null && signal.sl != null && Number(signal.entry) === Number(signal.sl));
    if (slMoved) {
      const tp = signal.latestTpHit ? ${signal.latestTpHit} : '';
      lines.push(`Active 🟩 | SL moved to breakeven${tp ? ` after ${tp}` : ''}`);
<<<<<<< HEAD
      lines.push(Valid for re-entry: ❌);
    } else if (signal.latestTpHit) {
      lines.push(Active 🟩 | ${signal.latestTpHit} hit);
      lines.push(Valid for re-entry: ✅);
    } else {
      lines.push(Active 🟩);
      lines.push(Valid for re-entry: ✅);
=======
      lines.push('Valid for re-entry: ✅'); // always valid when active
    } else if (signal.latestTpHit) {
      lines.push(`Active 🟩 | ${signal.latestTpHit} hit`);
      lines.push('Valid for re-entry: ✅');
    } else {
      lines.push('Active 🟩');
      lines.push('Valid for re-entry: ✅');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    }
  } else {
    if (signal.status === 'CLOSED') {
      const tp = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
      lines.push(Inactive 🟥 | Fully closed${tp});
    } else if (signal.status === 'STOPPED_BE') {
      const tp = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
      lines.push(Inactive 🟥 | Stopped breakeven${tp});
    } else if (signal.status === 'STOPPED_OUT') {
<<<<<<< HEAD
      lines.push(Inactive 🟥 | Stopped out);
    } else {
      lines.push(Inactive 🟥);
    }
    lines.push(Valid for re-entry: ❌);
=======
      lines.push('Inactive 🟥 | Stopped out');
    } else {
      lines.push('Inactive 🟥');
    }
    lines.push('Valid for re-entry: ❌');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
  }

  // Max R reached
  if (signal.maxR != null && !Number.isNaN(Number(signal.maxR))) {
    const mr = Number(signal.maxR).toFixed(2);
    const soFar = signal.status === 'RUN_VALID' ? ' so far' : '';
    lines.push('');
<<<<<<< HEAD
    lines.push(📈 **Max R reached**);
    lines.push(${mr}R${soFar});
    const anyTpHit = !!(signal.tpHits && Object.values(signal.tpHits).some(Boolean));
    if (signal.status === 'RUN_VALID' && !anyTpHit) {
      lines.push(Awaiting TP1…);
=======
    lines.push('📈 **Max R reached**');
    lines.push(`${mr}R${soFar}`);
    const anyTpHit = !!(signal.tpHits && Object.values(signal.tpHits).some(Boolean));
    if (signal.status === 'RUN_VALID' && !anyTpHit) {
      lines.push('Awaiting TP1…');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    }
  }

  // Realized
  const hasFills = Array.isArray(signal.fills) && signal.fills.length > 0;
  if (signal.status !== 'RUN_VALID' || hasFills) {
    lines.push('');
<<<<<<< HEAD
    lines.push(💰 **Realized**);
=======
    lines.push('💰 **Realized**');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    if (signal.status !== 'RUN_VALID' && signal.finalR != null) {
      const { text } = signAbsR(Number(signal.finalR));
      if (signal.status === 'CLOSED') {
        const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
        lines.push(${text} ( fully closed${after} ));
      } else if (signal.status === 'STOPPED_BE') {
        if (Number(signal.finalR) === 0) lines.push(0.00R ( stopped breakeven ));
        else {
          const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
          lines.push(${text} ( stopped breakeven${after} ));
        }
      } else if (signal.status === 'STOPPED_OUT') {
        lines.push(${text} ( stopped out ));
      }
    } else {
      const info = computeRealized(signal);
      const pretty = signAbsR(info.realized).text;
      const list = info.parts.length ? info.parts.join(', ') : null;
      if (signal.status === 'RUN_VALID') {
        if (list) lines.push(${pretty} so far ( ${list} ));
      } else if (signal.status === 'CLOSED') {
        const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
        lines.push(${pretty} ( fully closed${after} ));
      } else if (signal.status === 'STOPPED_BE') {
        if (signal.latestTpHit) lines.push(${pretty} ( stopped breakeven after ${signal.latestTpHit} ));
        else lines.push(0.00R ( stopped breakeven ));
      } else if (signal.status === 'STOPPED_OUT') {
        lines.push(${pretty} ( stopped out ));
      } else if (list) {
        lines.push(${pretty} so far ( ${list} ));
      }
    }
  }

<<<<<<< HEAD
    // Clean chart link only (signal posting handles attach/link elsewhere)
    if (signal.chartUrl && !signal.chartAttached) {
      lines.push('');
      lines.push([chart](${signal.chartUrl}));
    }
=======
  // Always show a clean chart link when link-only mode is used
  if (signal.chartUrl && !signal.chartAttached) {
    lines.push('');
    lines.push(`[chart](${signal.chartUrl})`);
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
  }

  return lines.join('\n');
}

export function renderSummaryText(activeSignals) {
  const title = **JV Current Active Trades** 📊;
  if (!activeSignals || !activeSignals.length) {
<<<<<<< HEAD
    return ${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades.;
=======
    return `${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades!`;
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
  }
  const lines = [title, ''];
  activeSignals.forEach((s, i) => {
    const dirWord = s.direction === 'SHORT' ? 'Short' : 'Long';
    const circle = s.direction === 'SHORT' ? '🔴' : '🟢';
<<<<<<< HEAD
    lines.push(${i+1}⃣ $${s.asset} | ${dirWord} ${circle});
    lines.push(- Entry: \${fmt(s.entry)}\``);
    lines.push(- SL: \${fmt(s.sl)}\``);
    lines.push(- Status: Active 🟩);
=======
    lines.push(`${i + 1}⃣ $${s.asset} | ${dirWord} ${circle}`);
    lines.push(`- Entry: \`${fmt(s.entry)}\``);
    lines.push(`- SL: \`${fmt(s.sl)}\``);
    lines.push(`- Status: Active 🟩`);
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    if (s.jumpUrl) {
      lines.push([View Full Signal](${s.jumpUrl}));
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

/* ---------------------------
   Fancy single-trade recap renderer (used by /recap)
----------------------------*/
function tpClosedPct(signal, tpUpper) {
  let pct = 0;
  for (const f of signal.fills || []) {
    if (String(f.source || '').toUpperCase() === tpUpper) {
      pct += Number(f.pct || 0);
    }
  }
  // Fallback: planned % if not executed
  if (pct <= 0 && signal.plan && signal.plan[tpUpper] != null) {
    pct = Number(signal.plan[tpUpper]) || 0;
  }
  return Math.max(0, Math.min(100, Math.round(pct)));
}

export function renderSingleTradeRecapFancy(signal, extras = {}) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢';

  const realizedObj = computeRealized(signal);
  const finalR =
    (signal.status !== 'RUN_VALID' && signal.finalR != null)
      ? Number(signal.finalR)
      : realizedObj.realized;

  const resIcon = finalR > 0 ? '✅' : finalR < 0 ? '❌' : '➖';
  const titleR = signAbsR(finalR).text;

  const lines = [];
  lines.push(**$${String(signal.asset).toUpperCase()} | Trade Recap ${titleR} ${resIcon} (${dirWord}) ${circle}**);
  lines.push('');

  // Trade Reason
  const reasonText = (extras.reason || signal.reason || '').trim();
  if (reasonText) {
<<<<<<< HEAD
    lines.push(📍 **Trade Reason**);
=======
    lines.push('📍 **Trade Reason**');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    for (const ln of reasonText.split('\n').map(s => s.trim()).filter(Boolean)) {
      lines.push(- ${ln});
    }
    lines.push('');
  }

  // Entry Confluences
  const conf = (extras.confluences || '').trim();
  if (conf) {
<<<<<<< HEAD
    lines.push(📊 **Entry Confluences**);
=======
    lines.push('📊 **Entry Confluences**');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    for (const ln of conf.split('\n').map(s => s.trim()).filter(Boolean)) {
      lines.push(- ${ln});
    }
    lines.push('');
  }

  // Take Profit
  const tpKeys = ['tp1','tp2','tp3','tp4','tp5'];
  const tpLines = [];
  tpKeys.forEach((k, idx) => {
    const v = signal[k];
    if (v == null || v === '') return;
<<<<<<< HEAD
    const label = TP${idx+1};
=======
    const label = `TP${idx + 1}`;
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const rTxt = r != null ? ${r.toFixed(2)}R : '';
    const pct = tpClosedPct(signal, label);
    const hit = signal.tpHits?.[label] ? ' ✅' : '';
    tpLines.push(`- ${label} | ${rTxt}${pct ? ` (${pct}% closed)` : ''}${hit}`);
  });
  if (tpLines.length) {
<<<<<<< HEAD
    lines.push(🎯 **Take Profit**);
=======
    lines.push('🎯 **Take Profit**');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    lines.push(...tpLines);
    lines.push('');
  }

  // Results
<<<<<<< HEAD
  lines.push(⚖ **Results**);
  lines.push(- Final: ${signAbsR(finalR).text} ${resIcon});
=======
  lines.push('⚖️ **Results**');
  lines.push(`- Final: ${signAbsR(finalR).text} ${resIcon}`);
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
  if (signal.maxR != null && !Number.isNaN(Number(signal.maxR))) {
    lines.push(- Max R Reached: ${Number(signal.maxR).toFixed(2)}R);
  }
<<<<<<< HEAD
  // NEW: annotate “stopped breakeven/out after TPx”
=======
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
  const afterTp = signal.latestTpHit && /^TP\d$/i.test(signal.latestTpHit) ? signal.latestTpHit.toUpperCase() : null;
  if (signal.status === 'STOPPED_BE' && afterTp) {
    lines.push(- Stopped breakeven after ${afterTp});
  } else if (signal.status === 'STOPPED_OUT' && afterTp) {
    lines.push(- Stopped out after ${afterTp});
  }
  lines.push('');

  // Notes
  const notes = (extras.notes || '').trim();
  if (notes) {
<<<<<<< HEAD
    lines.push(📝 **Notes**);
=======
    lines.push('📝 **Notes**');
>>>>>>> 1c1655422725ed6054613376a2f43e3c76fa2c92
    for (const ln of notes.split('\n').map(s => s.trim()).filter(Boolean)) {
      lines.push(- ${ln});
    }
    lines.push('');
  }

  // Original link
  if (signal.jumpUrl) {
    lines.push(🔗 [View Original Trade](${signal.jumpUrl}));
  }

  return lines.join('\n');
}