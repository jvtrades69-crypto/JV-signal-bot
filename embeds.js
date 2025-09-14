// embeds.js — Text renderers (clean formatted style with backticks and summary tweaks)

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  return `\`${addCommas(v)}\``;
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
  const circle = signal.direction === 'SHORT' ? '🔴' : '🟢';
  return `**$${signal.asset} | ${dirWord} ${circle}**`;
}

export function renderSignalText(signal, rrChips, slMovedToBEActive) {
  const lines = [];

  // Title
  lines.push(buildTitle(signal));
  lines.push('');

  // Trade details
  lines.push(`📊 **Trade Details**`);
  lines.push(`- Entry: ${fmt(signal.entry)}`);
  lines.push(`- SL: ${fmt(signal.sl)}`);

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
      lines.push(`- ${label}: ${fmt(v)} (${pct}% out | ${rrTxt})`);
    } else if (pct > 0) {
      lines.push(`- ${label}: ${fmt(v)} (${pct}% out)`);
    } else {
      lines.push(`- ${label}: ${fmt(v)}`);
    }
  }

  if (signal.reason && String(signal.reason).trim().length) {
    lines.push('');
    lines.push(`📝 **Reasoning**`);
    lines.push(String(signal.reason).trim());
  }

  // Status
  lines.push('');
  lines.push(`🚦 **Status**`);
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
    lines.push(`Inactive 🟥`);
    lines.push(`Valid for re-entry: ❌`);
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
    lines.push(`- Entry: ${fmt(s.entry)}`);
    lines.push(`- SL: ${fmt(s.sl)}`);
    if (s.jumpUrl) {
      lines.push('');
      lines.push(`📎 [View Full Signal](<${s.jumpUrl}>)`);
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}
