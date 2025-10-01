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
  return Number(sum.toFixed(2));
}
function dirWord(signal) { return signal.direction === 'SHORT' ? 'Short' : 'Long'; }
function dirDot(signal) { return signal.direction === 'SHORT' ? '🔴' : '🟢'; }

// ---------- titles ----------
function buildTitle(signal) {
  const riskBadge = (!signal.latestTpHit && signal.riskLabel) ? ` (${signal.riskLabel} risk)` : '';
  const head = `$${String(signal.asset).toUpperCase()} | ${dirWord(signal)} ${dirDot(signal)}${riskBadge}`;

  const isFinal = ['CLOSED', 'STOPPED_BE', 'STOPPED_OUT'].includes(signal.status);
  const hasFinal = signal.finalR != null && isFinite(Number(signal.finalR));
  const useR = (isFinal && hasFinal) ? Number(signal.finalR) : computeRealized(signal);

  let suffix = '';
  if (signal.status === 'STOPPED_OUT') {
    suffix = `Loss -${Math.abs(useR).toFixed(2)}R`;
  } else if (signal.status === 'STOPPED_BE') {
    const anyFill = (signal.fills || []).length > 0;
    suffix = anyFill ? `Win +${useR.toFixed(2)}R` : 'Breakeven';
  } else if (signal.status === 'CLOSED') {
    suffix = `Win +${useR.toFixed(2)}R`;
  } else if ((signal.fills || []).length > 0) {
    suffix = `Win +${useR.toFixed(2)}R so far`;
  }
  return suffix ? `**${head} (${suffix})**` : `**${head}**`;
}

// ---------- main text blocks ----------
export function renderSignalText(signal /*, rrChips, isSlBE */) {
  const lines = [];
  lines.push(buildTitle(signal), '', '📊 **Trade Details**');
  lines.push(`- Entry: \`${fmt(signal.entry)}\``);
  lines.push(`- SL: \`${fmt(signal.sl)}\``);

  for (const key of ['tp1', 'tp2', 'tp3', 'tp4', 'tp5']) {
    const v = signal[key];
    if (v == null || v === '') continue;
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const rr = (r != null) ? `${r.toFixed(2)}R` : null;
    lines.push(rr ? `- ${key.toUpperCase()}: \`${fmt(v)}\` (${rr})` : `- ${key.toUpperCase()}: \`${fmt(v)}\``);
  }

  if (signal.reason && String(signal.reason).trim()) {
    lines.push('', '📝 **Reasoning**', String(signal.reason).trim());
  }

  // Status
  lines.push('', '📍 **Status**');
  if (signal.status === 'RUN_VALID') {
    const hitOrder = ['TP5', 'TP4', 'TP3', 'TP2', 'TP1'];
    const hits = hitOrder.filter(k => signal.tpHits && signal.tpHits[k]).reverse();
    lines.push(hits.length ? `Active 🟩 | ${hits.join(', ')} hit` : 'Active 🟩 | Trade running');
    lines.push(`Valid for re-entry: ${signal.validReentry ? '✅' : '❌'}`);
  } else {
    const tag =
      signal.status === 'CLOSED' ? 'Fully closed' :
      signal.status === 'STOPPED_BE' ? 'Stopped breakeven' :
      signal.status === 'STOPPED_OUT' ? 'Stopped out' : 'Inactive';
    lines.push(`Inactive 🟥 | ${tag}`);
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
    lines.push('', '💰 **Realized**', `${realized >= 0 ? '+' : ''}${realized.toFixed(2)}R${signal.status === 'RUN_VALID' ? ' so far' : ''}`);
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
  lines.push(`**${String(signal.asset).toUpperCase()} — Trade Recap (${dirWord(signal)})**`, '');

  const isFinal = ['CLOSED', 'STOPPED_BE', 'STOPPED_OUT'].includes(signal.status);
  const hasFinal = signal.finalR != null && isFinite(Number(signal.finalR));
  const useR = (isFinal && hasFinal) ? Number(signal.finalR) : computeRealized(signal);

  lines.push('Result', `${useR >= 0 ? '+' : ''}${useR.toFixed(2)}R`, '');

  if (showBasics) {
    lines.push('Basics');
    lines.push(`- Entry: \`${fmt(signal.entry)}\``);
    lines.push(`- SL: \`${fmt(signal.sl)}\``);
    lines.push('');
  }

  if (reasonLines.length) {
    lines.push('Reason', ...reasonLines.map(s => `- ${s}`), '');
  }
  if (confLines.length) {
    lines.push('Confluences', ...confLines.map(s => `- ${s}`), '');
  }
  if (notesLines.length) {
    lines.push('Notes', ...notesLines.map(s => `- ${s}`), '');
  }
  return lines.join('\n').trimEnd();
}

export function renderMonthlyRecap(signals, year, monthIdx) {
  const monthName = new Date(Date.UTC(year, monthIdx, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const closed = (signals || []).filter(s => s && s.status === 'CLOSED' && isFinite(Number(s.finalR)));
  const sum = closed.reduce((acc, s) => acc + Number(s.finalR || 0), 0);
  const wins = closed.filter(s => Number(s.finalR) > 0).length;
  const losses = closed.filter(s => Number(s.finalR) < 0).length;
  const be = closed.filter(s => Number(s.finalR) === 0).length;

  const lines = [];
  lines.push(`**${monthName} ${year} — Monthly Recap**`);
  lines.push(`Trades: ${closed.length} • Wins: ${wins} • BE: ${be} • Losses: ${losses}`);
  lines.push(`Total: ${sum >= 0 ? '+' : ''}${sum.toFixed(2)}R`);
  return lines.join('\n');
}

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
  if (attachmentName && attachmentUrl) {
    embed.fields.push({ name: 'Chart', value: `[${attachmentName}](${attachmentUrl})`, inline: false });
  } else if (imageUrl) {
    embed.image = { url: imageUrl };
  }
  return { embeds: [embed] };
}