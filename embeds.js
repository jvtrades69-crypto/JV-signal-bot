// embeds.js — Text renderers (no embeds). Messages look like a person wrote them.

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  return `${v}`;
}

export function buildTitle(signal, titleChip) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢'; // direction only
  const base = `${signal.asset} | ${dirWord} ${circle}`;
  if (titleChip?.show && titleChip.text) return `**${base} ( ${titleChip.text} )**`;
  return `**${base}**`;
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

export function renderRRLine(rrChips) {
  if (!rrChips || !rrChips.length) return null;
  return rrChips.map(c => `${c.key} ${Number(c.r).toFixed(2)}R`).join(' | ');
}

function renderStatusLines(signal, slMovedToBEActive) {
  const lines = [];
  if (signal.status === 'RUN_VALID') {
    if (slMovedToBEActive) {
      const tp = signal.latestTpHit ? `${signal.latestTpHit}` : '';
      lines.push(`Active 🟩 | SL moved to breakeven${tp ? ` after ${tp}` : ''}`);
      lines.push(`Valid for re-entry: No`);
    } else if (signal.latestTpHit) {
      lines.push(`Active 🟩 | ${signal.latestTpHit} hit`);
      lines.push(`Valid for re-entry: Yes`);
    } else {
      lines.push(`Active 🟩`);
      lines.push(`Valid for re-entry: Yes`);
    }
    return lines;
  }
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
  lines.push(`Valid for re-entry: No`);
  return lines;
}

// local realized calc for display
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

function renderRealizedLines(signal) {
  const info = computeRealized(signal);
  const r = Number(info.realized || 0);
  const abs = Math.abs(r).toFixed(2);
  const sign = r > 0 ? '+' : r < 0 ? '-' : '';
  const pretty = `${sign}${abs}R`;
  const list = info.parts.length ? info.parts.join(', ') : null;

  const lines = [];
  if (signal.status === 'RUN_VALID') {
    if (list) lines.push(`${pretty} so far ( ${list} )`);
    return lines;
  }
  if (signal.status === 'CLOSED') {
    const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
    lines.push(`${pretty} ( fully closed${after} )`);
    return lines;
  }
  if (signal.status === 'STOPPED_BE') {
    if (signal.latestTpHit) lines.push(`${pretty} ( stopped breakeven after ${signal.latestTpHit} )`);
    else lines.push(`0.00R ( stopped breakeven )`);
    return lines;
  }
  if (signal.status === 'STOPPED_OUT') {
    lines.push(`${pretty} ( stopped out )`);
    return lines;
  }
  if (list) lines.push(`${pretty} so far ( ${list} )`);
  return lines;
}

export function renderSignalText(signal, rrChips, titleChip, slMovedToBEActive) {
  const lines = [];

  lines.push(buildTitle(signal, titleChip));
  lines.push('');

  lines.push(`📊 **Trade Details**`);
  lines.push(`Entry: ${fmt(signal.entry)}`);
  lines.push(`SL: ${fmt(signal.sl)}`);

  const tps = ['tp1','tp2','tp3','tp4','tp5'];
  const execOrPlan = computeTpPercents(signal);
  for (const k of tps) {
    const v = signal[k];
    if (v === null || v === undefined || v === '') continue;
    const label = k.toUpperCase();
    const pct = execOrPlan[label];
    lines.push(pct > 0 ? `${label}: ${fmt(v)} ( ${pct}% out )` : `${label}: ${fmt(v)}`);
  }

  const rrLine = renderRRLine(rrChips);
  if (rrLine) {
    lines.push('');
    lines.push(`📐 **Risk–Reward**`);
    lines.push(rrLine);
  }

  if (signal.reason && String(signal.reason).trim().length) {
    lines.push('');
    lines.push(`📝 **Reasoning**`);
    lines.push(String(signal.reason).trim());
  }

  lines.push('');
  lines.push(`🚦 **Status**`);
  lines.push(...renderStatusLines(signal, slMovedToBEActive));

  const hasFills = Array.isArray(signal.fills) && signal.fills.length > 0;
  if (signal.status !== 'RUN_VALID' || hasFills) {
    lines.push('');
    lines.push(`💰 **Realized**`);
    lines.push(...renderRealizedLines(signal));
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
    const jump = s.jumpUrl ? ` — ${s.jumpUrl}` : '';
    lines.push(`${i+1}. ${s.asset} ${dirWord} ${circle}${jump}`);
    lines.push(`   Entry: ${fmt(s.entry)}`);
    lines.push(`   SL: ${fmt(s.sl)}`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}
