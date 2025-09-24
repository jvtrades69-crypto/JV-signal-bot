// embeds.js — text renderers
// - "Active 🟩 | Trade running" when no TP hits yet
// - "SL moved to breakeven" shows if you pressed the button (beSet=true) and adds "after TPx" once captured
// - Monthly recap included
// - Recap format matches user's examples + lightweight overrides via recap modal:
//    • "final: 1.00"  -> overrides Final R
//    • "peak: 2.40" / "max: 2.40" -> overrides Peak/Max R
//    • "TP1: Some caption" etc. -> adds caption after that TP

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
  if ([E, S, P].some(Number.isNaN)) return null;
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
    const order = ['TP1','TP2','TP3','TP4','TP5'];
    const hitList = order.filter(k => signal.tpHits && signal.tpHits[k]);
    const perTpExec = Object.fromEntries(order.map(k => [k, 0]));
    for (const f of (signal.fills || [])) {
      const src = String(f.source || '').toUpperCase();
      if (perTpExec[src] !== undefined) perTpExec[src] += Number(f.pct || 0);
    }
    const parts = hitList.map(k => perTpExec[k] > 0 ? `${k} hit (${Math.round(perTpExec[k])}% closed)` : `${k} hit`);

    const activeLine = parts.length
      ? `Active 🟩 | ${parts.join(' , ')}`
      : 'Active 🟩 | Trade running';
    lines.push(activeLine);

    const reentry = signal.validReentry ? '✅' : '❌';

    // Show BE if you pressed it; add "after TPx" once captured
    const showBE = Boolean(signal.beSet) || Boolean(signal.beMovedAfter);
    const afterTxt = (signal.beMovedAfter ? ` after ${signal.beMovedAfter}` : '');
    lines.push(`Valid for re-entry: ${reentry}${showBE ? ' | SL moved to breakeven' + afterTxt : ''}`);
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

  // Chart link (masked text)
  if (signal.chartUrl && !signal.chartAttached) {
    lines.push('');
    lines.push(`[View chart](${signal.chartUrl})`);
  }

  return lines.join('\n');
}

// Summary list
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

<<<<<<< Updated upstream
// Single-trade recap — FORMATTED like your screenshot
=======
// Single-trade recap — FORMATTED like your examples, with overrides
>>>>>>> Stashed changes
export function renderRecapText(signal, extras = {}, rrChips = []) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle  = signal.direction === 'SHORT' ? '🔴' : '🟢';

<<<<<<< Updated upstream
  // Final R (closed/BE/OUT -> finalR; else realized)
  const { realized } = computeRealized(signal);
  const final = (signal.status !== 'RUN_VALID' && signal.finalR != null)
    ? Number(signal.finalR)
    : realized;

  const finalChip = signAbsR(final).text;
  const finalMark = final > 0 ? '✅' : final < 0 ? '❌' : '➖';

  // TP list (only ones actually hit)
  const tpPerc  = computeTpPercents(signal);
  const tpHits  = signal.tpHits || {};
  const tpLines = [];
  for (let i = 1; i <= 5; i++) {
    const key = `TP${i}`, k = `tp${i}`;
    if (!tpHits[key]) continue;
    const v = signal[k];
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const pct = tpPerc[key] > 0 ? ` (${tpPerc[key]}% closed)` : '';
    tpLines.push(`• ${key} | ${r != null ? `${r.toFixed(2)}R` : '—'}${pct} ✅`);
  }

  // Peak/Max R
  const peakR = (signal.maxR != null && !Number.isNaN(Number(signal.maxR))) ? Number(signal.maxR) : 0;

  const reasonLines = extras.reasonLines || [];
  const confLines   = extras.confLines   || [];
  const notesLines  = extras.notesLines  || [];

  const lines = [];

  // Title
  lines.push(`**$${String(signal.asset).toUpperCase()} | Trade Recap ${finalChip} ${finalMark} (${dirWord}) ${circle}**`);
  lines.push('');

  // Trade Reason
  if (reasonLines.length) {
    lines.push('📍 **Trade Reason**');
    reasonLines.forEach(ln => lines.push(`• ${ln}`));
=======
  // Parse overrides & TP captions from extras.notesLines
  const reasonLines = extras.reasonLines || [];
  const confLines   = extras.confLines   || [];
  let   notesLines  = extras.notesLines  || [];

  let overrideFinal = null;
  let overridePeak  = null;
  const tpCaptions  = {}; // { TP1: 'text', ... }

  const parsedNotes = [];
  for (const raw of notesLines) {
    const line = String(raw).trim();

    // final/max/peak override: "final: 1.00", "max: 2.4", "peak: 2.4"
    const mFinal = line.match(/^final\s*:\s*([+-]?\d+(\.\d+)?)/i);
    const mPeak  = line.match(/^(peak|max)\s*:\s*([+-]?\d+(\.\d+)?)/i);
    const mTP    = line.match(/^TP([1-5])\s*:\s*(.+)$/i);

    if (mFinal) { overrideFinal = Number(mFinal[1]); continue; }
    if (mPeak)  { overridePeak  = Number(mPeak[2]);  continue; }
    if (mTP)    { tpCaptions[`TP${mTP[1]}`] = mTP[2].trim(); continue; }

    parsedNotes.push(line);
  }
  notesLines = parsedNotes;

  // Final R
  const { realized } = computeRealized(signal);
  const computedFinal = (signal.status !== 'RUN_VALID' && signal.finalR != null)
    ? Number(signal.finalR)
    : realized;
  const final = (overrideFinal != null && !Number.isNaN(overrideFinal)) ? overrideFinal : computedFinal;

  const finalChip = signAbsR(final).text;
  const finalMark = final > 0 ? '✅' : final < 0 ? '❌' : '➖';

  // TP list (only ones actually hit)
  const tpPerc  = computeTpPercents(signal);
  const tpHits  = signal.tpHits || {};
  const tpLines = [];
  for (let i = 1; i <= 5; i++) {
    const key = `TP${i}`, k = `tp${i}`;
    if (!tpHits[key]) continue;
    const v = signal[k];
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, v);
    const pct = tpPerc[key] > 0 ? ` (${tpPerc[key]}% closed)` : '';
    const caption = tpCaptions[key] ? ` | ${tpCaptions[key]}` : '';
    tpLines.push(`${key} | ${r != null ? `${r.toFixed(2)}R` : '—'}${pct} ✅${caption}`);
  }

  // Peak/Max R
  const storedMax = (signal.maxR != null && !Number.isNaN(Number(signal.maxR))) ? Number(signal.maxR) : 0;
  const peakR = (overridePeak != null && !Number.isNaN(overridePeak)) ? overridePeak : storedMax;

  const lines = [];

  // Title
  lines.push(`**$${String(signal.asset).toUpperCase()} | Trade Recap ${finalChip} ${finalMark} (${dirWord}) ${circle}**`);
  lines.push('');

  // Trade Reason
  if (reasonLines.length) {
    lines.push('📍 **Trade Reason**');
    reasonLines.forEach(ln => lines.push(`- ${ln}`));
>>>>>>> Stashed changes
    lines.push('');
  }

  // Entry Confluences
  if (confLines.length) {
    lines.push('📊 **Entry Confluences**');
<<<<<<< Updated upstream
    confLines.forEach(ln => lines.push(`• ${ln}`));
    lines.push('');
=======
    confLines.forEach(ln => lines.push(`- ${ln}`));
    lines.push('');
  }

  // Take Profit
  lines.push('🎯 **Take Profit**');
  if (tpLines.length) {
    // match exact example style (bullet with bold TP lines)
    tpLines.forEach(t => lines.push(`- ${t}`));
  } else {
    if (signal.status === 'STOPPED_OUT')      lines.push('- **None** (Stopped Out ❌ before TP1)');
    else if (signal.status === 'STOPPED_BE')  lines.push('- **None** (Breakeven 🟨 before TP1)');
    else                                      lines.push('- **None yet**');
  }
  lines.push('');

  // Results
  lines.push('⚖️ **Results**');
  lines.push(`- Final: ${finalChip} ${finalMark}`);
  lines.push(`- Peak R: ${Number(peakR).toFixed(2)}R`);
  lines.push('');

  // Post-Mortem / Notes
  if (notesLines.length) {
    lines.push('🧠 **Post-Mortem (What I learned)**');
    notesLines.forEach(ln => lines.push(`- ${ln}`));
    lines.push('');
  }

  // Link
  if (signal.jumpUrl) {
    lines.push(`🔗 [View Original Trade](${signal.jumpUrl})`);
>>>>>>> Stashed changes
  }

  // Take Profit
  lines.push('🎯 **Take Profit**');
  if (tpLines.length) {
    lines.push(...tpLines);
  } else {
    if (signal.status === 'STOPPED_OUT')      lines.push('• **None** (Stopped Out ❌ before TP1)');
    else if (signal.status === 'STOPPED_BE')  lines.push('• **None** (Breakeven 🟨 before TP1)');
    else                                      lines.push('• **None yet**');
  }
  lines.push('');

  // Results
  lines.push('⚖️ **Results**');
  lines.push(`• Final: **${finalChip}** ${finalMark}`);
  lines.push(`• Peak R: **${peakR.toFixed(2)}R**`);
  lines.push('');

  // Post-Mortem
  if (notesLines.length) {
    lines.push('🧠 **Post-Mortem (What I learned)**');
    notesLines.forEach(ln => lines.push(`• ${ln}`));
    lines.push('');
  }

  // Link
  if (signal.jumpUrl) lines.push(`🔗 [View Original Trade](${signal.jumpUrl})`);

  return lines.join('\n');
}

// Monthly recap renderer
export function renderMonthlyRecap(signals, year, monthIdx) {
  const monthName = new Date(Date.UTC(year, monthIdx, 1))
    .toLocaleString('en-US', { month: 'long' });
  const title = `📊 **Monthly Trade Recap — ${monthName} ${year}**`;

  if (!signals.length) return `${title}\nNo trades this month.`;

  let wins = 0, losses = 0, be = 0, net = 0;
  const rChip = (r) => {
    const v = Number(r || 0);
    const emo = v > 0 ? '✅' : v < 0 ? '❌' : '➖';
    const sign = v > 0 ? '+' : v < 0 ? '' : '';
    return `${sign}${v.toFixed(2)}R ${emo}`;
  };

  const lines = [];
  for (const s of signals) {
    const { realized } = computeRealized(s);
    const r = s.finalR != null ? Number(s.finalR) : realized;
    net += r;
    if (r > 0) wins++; else if (r < 0) losses++; else be++;
    const dir = s.direction === 'SHORT' ? 'Short 🔴' : 'Long 🟢';
    lines.push(`**$${s.asset} | ${rChip(r)} (${dir})**`);
  }

  const header =
    `**Total trades:** ${signals.length} | Wins: ${wins} | Losses: ${losses} | BE: ${be}\n` +
    `**Net Result:** ${rChip(net)}`;

  return [title, header, '', ...lines].join('\n');
}