// embeds.js — text renderers used by index.js

// ---------- utils ----------
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
function signAbsR(r) {
  const x = Number(r || 0);
  const abs = Math.abs(x).toFixed(2);
  const sign = x > 0 ? '+' : x < 0 ? '-' : '';
  return { text: `${sign}${abs}R`, abs, sign };
}
function rAtPrice(direction, entry, slOriginal, price) {
  if (entry == null || slOriginal == null || price == null) return null;
  const E = Number(entry), S = Number(slOriginal), P = Number(price);
  if ([E, S, P].some(n => Number.isNaN(n))) return null;
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
    if (src.startsWith('TP')) parts.push(`${pct}% at ${src}`);
    else if (src === 'FINAL_CLOSE') parts.push(`${pct}% at ${f.price}`);
    else if (src === 'STOP_BE') parts.push(`${pct}% at BE`);
    else if (src === 'STOP_OUT') parts.push(`${pct}% at SL`);
  }
  return { realized: Number(sum.toFixed(2)), parts };
}

// ---------- title ----------
function buildTitle(signal) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢';
  const base = `$${signal.asset} | ${dirWord} ${circle}`;

  if (signal.status !== 'RUN_VALID' && signal.finalR != null) {
    const fr = Number(signal.finalR);
    if (signal.status === 'STOPPED_BE' && fr === 0) return `**${base} ( Breakeven )**`;
    if (fr > 0) return `**${base} ( Win +${fr.toFixed(2)}R )**`;
    if (fr < 0) return `**${base} ( Loss ${Math.abs(fr).toFixed(2)}R )**`;
    return `**${base} ( +0.00R )**`;
  }

  const { realized } = computeRealized(signal);
  if (signal.status === 'STOPPED_OUT') return `**${base} ( Loss -${Math.abs(realized).toFixed(2)}R )**`;
  if (signal.status === 'STOPPED_BE') {
    const anyFill = (signal.fills || []).length > 0;
    return `**${base} ( ${anyFill ? `Win +${realized.toFixed(2)}R` : 'Breakeven'} )**`;
  }
  if (signal.status === 'CLOSED') return `**${base} ( Win +${realized.toFixed(2)}R )**`;
  if ((signal.fills || []).length > 0) return `**${base} ( Win +${realized.toFixed(2)}R so far )**`;
  return `**${base}**`;
}

// ---------- main message ----------
export function renderSignalText(signal /* normalized */, rrChips /* unused here */, slMovedToBEActive /* unused */) {
  const lines = [];

  // Title
  lines.push(buildTitle(signal));
  lines.push('');

  // Trade details
  lines.push('📊 **Trade Details**');
  lines.push(`- Entry: \`${fmt(signal.entry)}\``);
  lines.push(`- SL: \`${fmt(signal.sl)}\``);

  const tps = ['tp1','tp2','tp3','tp4','tp5'];
  const execOrPlan = computeTpPercents(signal);
  for (const k of tps) {
    const v = signal[k];
    if (v === null || v === undefined || v === '') continue;
    const label = k.toUpperCase();
    const pct = execOrPlan[label];
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const rrTxt = (r != null) ? `${r.toFixed(2)}R` : null;
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
    lines.push('📝 **Reasoning**');
    lines.push(String(signal.reason).trim());
  }

  // Status
  lines.push('');
  lines.push('📍 **Status**');
  if (signal.status === 'RUN_VALID') {
    const slMoved = (signal.entry != null && signal.sl != null && Number(signal.entry) === Number(signal.sl));
    const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
    if (slMoved) {
      lines.push(`Active 🟩 | SL moved to breakeven${after}`);
    } else if (signal.latestTpHit) {
      lines.push(`Active 🟩 | ${signal.latestTpHit} hit`);
    } else {
      lines.push('Active 🟩');
    }
    lines.push(`Valid for re-entry: ${signal.validReentry ? '✅' : '❌'}`);
  } else {
    if (signal.status === 'CLOSED') {
      const tp = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
      lines.push(`Inactive 🟥 | Fully closed${tp}`);
    } else if (signal.status === 'STOPPED_BE') {
      const tp = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
      lines.push(`Inactive 🟥 | Stopped breakeven${tp}`);
    } else if (signal.status === 'STOPPED_OUT') {
      lines.push('Inactive 🟥 | Stopped out');
    } else {
      lines.push('Inactive 🟥');
    }
    lines.push('Valid for re-entry: ❌');
  }

  // Max R reached
  if (signal.maxR != null && !Number.isNaN(Number(signal.maxR))) {
    const mr = Number(signal.maxR).toFixed(2);
    const soFar = signal.status === 'RUN_VALID' ? ' so far' : '';
    lines.push('');
    lines.push('📈 **Max R reached**');
    lines.push(`${mr}R${soFar}`);
    const anyTpHit = !!(signal.tpHits && Object.values(signal.tpHits).some(Boolean));
    if (signal.status === 'RUN_VALID' && !anyTpHit) {
      lines.push('Awaiting TP1…');
    }
  }

  // Realized
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
        if (Number(signal.finalR) === 0) lines.push('0.00R ( stopped breakeven )');
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
        else lines.push('0.00R ( stopped breakeven )');
      } else if (signal.status === 'STOPPED_OUT') {
        lines.push(`${pretty} ( stopped out )`);
      } else if (list) {
        lines.push(`${pretty} so far ( ${list} )`);
      }
    }
  }

  // NOTE: chart link is appended by index.js, so we do NOT add it here.

  return lines.join('\n');
}

// ---------- summary ----------
export function renderSummaryText(activeSignals) {
  const title = `**JV Current Active Trades** 📊`;
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

// ---------- recap (used by /recap flow in index.js) ----------
export function renderRecapText(signal, extras = {}, rrChips /* provided by index if needed */) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢';

  // Decide finalR for title/result
  const realizedObj = computeRealized(signal);
  const finalR =
    (signal.status !== 'RUN_VALID' && signal.finalR != null)
      ? Number(signal.finalR)
      : realizedObj.realized;

  const resIcon = finalR > 0 ? '✅' : finalR < 0 ? '❌' : '➖';
  const titleR = signAbsR(finalR).text;

  const lines = [];
  lines.push(`**$${String(signal.asset).toUpperCase()} | Trade Recap ${titleR} ${resIcon} (${dirWord}) ${circle}**`);
  lines.push('');

  // Reason
  const reasonLines = extras.reasonLines || [];
  if (reasonLines.length) {
    lines.push('📍 **Trade Reason**');
    for (const ln of reasonLines) lines.push(`- ${ln}`);
    lines.push('');
  }

  // Confluences
  const confLines = extras.confLines || [];
  if (confLines.length) {
    lines.push('📊 **Entry Confluences**');
    for (const ln of confLines) lines.push(`- ${ln}`);
    lines.push('');
  }

  // Take Profit summary (R values + % closed + hit marks)
  const tpKeys = ['tp1','tp2','tp3','tp4','tp5'];
  const tpOut = [];
  for (let i = 0; i < tpKeys.length; i++) {
    const k = tpKeys[i];
    const v = signal[k];
    if (v == null || v === '') continue;
    const label = `TP${i + 1}`;
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const rTxt = r != null ? `${r.toFixed(2)}R` : '';
    // compute executed % (fallback to plan)
    let pct = 0;
    for (const f of signal.fills || []) {
      if (String(f.source || '').toUpperCase() === label) pct += Number(f.pct || 0);
    }
    if (pct <= 0 && signal.plan && signal.plan[label] != null) pct = Number(signal.plan[label]) || 0;
    pct = Math.max(0, Math.min(100, Math.round(pct)));
    const hit = signal.tpHits?.[label] ? ' ✅' : '';
    tpOut.push(`- ${label} | ${rTxt}${pct ? ` (${pct}% closed)` : ''}${hit}`);
  }
  if (tpOut.length) {
    lines.push('🎯 **Take Profit**');
    lines.push(...tpOut);
    lines.push('');
  }

  // Results
  lines.push('⚖️ **Results**');
  lines.push(`- Final: ${signAbsR(finalR).text} ${resIcon}`);
  if (signal.maxR != null && !Number.isNaN(Number(signal.maxR))) {
    lines.push(`- Max R Reached: ${Number(signal.maxR).toFixed(2)}R`);
  }
  const afterTp = signal.latestTpHit && /^TP\d$/i.test(signal.latestTpHit) ? signal.latestTpHit.toUpperCase() : null;
  if (signal.status === 'STOPPED_BE' && afterTp) lines.push(`- Stopped breakeven after ${afterTp}`);
  if (signal.status === 'STOPPED_OUT' && afterTp) lines.push(`- Stopped out after ${afterTp}`);
  lines.push('');

  // Notes
  const notesLines = extras.notesLines || [];
  if (notesLines.length) {
    lines.push('📝 **Notes**');
    for (const ln of notesLines) lines.push(`- ${ln}`);
    lines.push('');
  }

  // Do NOT add chart here; index attaches it.
  return lines.join('\n');
}