// ==== Recap helpers (internal) ====

const _isNum = (v) => v !== undefined && v !== null && v !== '' && !isNaN(Number(v));
const _toNum = (v) => (_isNum(v) ? Number(v) : null);

const _DIR = { LONG: 'LONG', SHORT: 'SHORT' };

// R multiple at a given price (same math you use elsewhere)
function _rAtPrice(direction, entry, slOriginal, price) {
  const E = _toNum(entry), S = _toNum(slOriginal), P = _toNum(price);
  if (E === null || S === null || P === null) return null;
  if (direction === _DIR.LONG) {
    const risk = E - S; if (risk <= 0) return null;
    return (P - E) / risk;
  } else {
    const risk = S - E; if (risk <= 0) return null;
    return (E - P) / risk;
  }
}

// Weighted R from fills (fallback when finalR is not provided)
// expects fills: [{ pct, price }], uses entry/slOriginal to convert each fill to R, then weights by pct.
function _weightedRFromFills(trade) {
  if (!Array.isArray(trade?.fills) || !trade.fills.length) return null;
  const E = _toNum(trade.entry);
  const S = _toNum(trade.slOriginal ?? trade.sl);
  if (E === null || S === null) return null;

  let totalPct = 0;
  let accR = 0;
  for (const f of trade.fills) {
    const pct = _toNum(f.pct);
    const price = _toNum(f.price);
    if (pct === null || price === null) continue;
    const r = _rAtPrice(trade.direction, E, S, price);
    if (r === null) continue;
    totalPct += pct;
    accR += (pct / 100) * r;
  }
  if (totalPct === 0) return null;
  // If not fully closed, this is still a meaningful “secured R” on booked fills.
  return accR;
}

function _formatR(r, digits = 2) {
  if (r === null || r === undefined || isNaN(r)) return null;
  const v = Number(r);
  // strip trailing .00 for neatness
  const s = Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(digits);
  return (v >= 0 ? '+' : '') + s + 'R';
}

function _dirEmoji(direction) {
  return direction === _DIR.LONG ? '🟢' : '🔴';
}

function _resultEmoji(r) {
  if (r === null) return 'ℹ️';
  return r >= 0 ? '✅' : '❌';
}

function _tpList(trade) {
  // Builds an array like [{label:'TP1', price: <num>, r:<num>|null, hit: true|false}, ...]
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const key = `tp${i}`;
    const hitKey = `TP${i}`;
    const price = _toNum(trade[key]);
    const hit = trade?.tpHits?.[hitKey] === true;
    const r = _rAtPrice(trade.direction, trade.entry, (trade.slOriginal ?? trade.sl), price);
    out.push({ label: `TP${i}`, price, r, hit });
  }
  return out;
}

function _maxRFromTrade(trade) {
  // If you don’t store an explicit maxR, estimate as max R over hit TPs
  const tps = _tpList(trade);
  let maxR = null;
  for (const t of tps) {
    if (!t.hit || t.r === null) continue;
    maxR = (maxR === null) ? t.r : Math.max(maxR, t.r);
  }
  return maxR;
}

function _shortId(id) {
  if (!id) return '';
  return '#' + String(id).slice(0, 4);
}
// ==== Public: Per-trade recap ====
export function renderTradeRecap(trade) {
  const asset = trade?.asset ? String(trade.asset).toUpperCase() : 'ASSET';
  const dir = trade?.direction === _DIR.SHORT ? _DIR.SHORT : _DIR.LONG;
  const colorEmoji = _dirEmoji(dir);

  // R secured: prefer explicit finalR; else weighted R from fills; else 0 if closed/out; else null
  const finalR = _isNum(trade?.finalR) ? Number(trade.finalR) : _weightedRFromFills(trade);
  const rStr = _formatR(finalR ?? 0);
  const resEmoji = _resultEmoji(finalR ?? 0);

  // Header
  const header = `**$${asset} | Trade Recap ${rStr} ${resEmoji} (${dir === _DIR.LONG ? 'Long' : 'Short'}) ${colorEmoji}**`;

  // Entry Reason
  const reason = (trade?.reason && trade.reason.trim().length)
    ? `\n\n📍 **Entry Reason**\n- ${trade.reason.trim()}`
    : '';

  // Confluences (optional: if you ever add trade.confluences = ['...','...'])
  let confluences = '';
  if (Array.isArray(trade?.confluences) && trade.confluences.length) {
    confluences = `\n\n📊 **Confluences**\n` + trade.confluences.map(c => `- ${c}`).join('\n');
  }

  // Take Profits (only show those hit)
  const tps = _tpList(trade).filter(t => t.hit);
  const tpLines = tps.map(t => {
    const rText = t.r !== null ? `${Math.round(t.r * 100) / 100}R` : '—';
    const priceText = t.price !== null ? `\`${t.price}\`` : '`—`';
    return `- ${t.label} ✅ | ${rText}: ${priceText}`;
  }).join('\n');
  const tpBlock = tps.length
    ? `\n\n🎯 **Take Profit**\n${tpLines}`
    : '';

  // Final Result
  const finalBlock = `\n\n⚖️ **Final Result**\n- ${rStr} ${resEmoji}`;

  // Notes (optional)
  const notesBlock = (trade?.notes && trade.notes.trim().length)
    ? `\n\n📝 **Notes** (optional)\n- ${trade.notes.trim()}`
    : '';

  // Link
  const linkTarget = trade?.jumpUrl ? trade.jumpUrl : '';
  const tradeId = _shortId(trade?.id);
  const linkBlock = linkTarget
    ? `\n\n🔗 [View Original Trade ${tradeId}](${linkTarget})`
    : (tradeId ? `\n\n🔗 View Original Trade ${tradeId}` : '');

  return [
    header,
    reason,
    confluences,
    tpBlock,
    finalBlock,
    notesBlock,
    linkBlock
  ].join('');
}
// ==== Public: Weekly recap ====
export function renderWeeklyRecap(trades, range) {
  const start = range?.startLabel ?? 'Start';
  const end = range?.endLabel ?? 'End';

  let lines = [];
  lines.push(`📊 **JV Trades Weekly Recap (${start} – ${end})**`);

  const items = [];
  trades.forEach((t, idx) => {
    const asset = t?.asset ? `$${String(t.asset).toUpperCase()}` : '$ASSET';
    const dirWord = (t?.direction === _DIR.SHORT) ? 'Short' : 'Long';
    const dirEmoji = _dirEmoji(t?.direction === _DIR.SHORT ? _DIR.SHORT : _DIR.LONG);

    const rSec = _isNum(t?.finalR) ? Number(t.finalR) : _weightedRFromFills(t) ?? 0;
    const rSecStr = _formatR(rSec);
    const resEmoji = _resultEmoji(rSec);

    const tps = _tpList(t).filter(x => x.hit);
    const tpLines = tps.map(tp => {
      const rText = tp.r !== null ? `${Math.round(tp.r * 100) / 100}R` : '—';
      const priceText = tp.price !== null ? `\`${tp.price}\`` : '`—`';
      return `🎯 ${tp.label} ✅ | ${rText}: ${priceText}`;
    });
    const maxR = _maxRFromTrade(t);
    const maxRLine = `⚖️ Max R Reached: ${maxR !== null ? (Math.round(maxR * 100) / 100) : '—'}R`;

    const tradeId = _shortId(t?.id);
    const link = t?.jumpUrl ? `[View Original Trade ${tradeId}](${t.jumpUrl})` : `View Original Trade ${tradeId}`;

    const block = [
      `${idx + 1}️⃣ ${asset} ${dirWord} ${dirEmoji} | R Secured: ${rSecStr} ${resEmoji}`,
      ...(tpLines.length ? tpLines : []),
      maxRLine,
      `🔗 ${link}`
    ].join('\n');

    items.push(block);
  });

  if (items.length) {
    lines.push('');
    lines.push(items.join('\n\n'));
  }

  // Totals
  const count = trades.length;
  const wins = trades.filter(t => {
    const r = _isNum(t?.finalR) ? Number(t.finalR) : _weightedRFromFills(t) ?? 0;
    return r > 0;
  }).length;
  const losses = count - wins;
  const netR = trades.reduce((acc, t) => {
    const r = _isNum(t?.finalR) ? Number(t.finalR) : _weightedRFromFills(t) ?? 0;
    return acc + r;
  }, 0);
  const netMaxR = trades.reduce((acc, t) => {
    const mr = _maxRFromTrade(t);
    return acc + (mr ?? 0);
  }, 0);
  const winRate = count ? Math.round((wins / count) * 100) : 0;

  lines.push('\n---');
  lines.push('⚖️ **Weekly Totals**');
  lines.push(`- Trades Taken: ${count}`);
  lines.push(`- Wins: ${wins} | Losses: ${losses}`);
  lines.push(`- Net R Secured: ${_formatR(netR)} ${netR >= 0 ? '✅' : '❌'}`);
  lines.push(`- Net Max R: ${_formatR(netMaxR)} ${netMaxR >= 0 ? '✅' : '❌'}`);
  lines.push(`- Win Rate: ${winRate}%`);

  return lines.join('\n');
}
// ==== Public: Monthly recap ====
export function renderMonthlyRecap(trades, monthLabel) {
  const titleMonth = monthLabel ?? 'This Month';
  let lines = [];
  lines.push(`📅 **JV Trades Monthly Recap – ${titleMonth}**`);

  const items = [];
  trades.forEach((t, idx) => {
    const asset = t?.asset ? `$${String(t.asset).toUpperCase()}` : '$ASSET';
    const dirWord = (t?.direction === _DIR.SHORT) ? 'Short' : 'Long';
    const dirEmoji = _dirEmoji(t?.direction === _DIR.SHORT ? _DIR.SHORT : _DIR.LONG);

    const rSec = _isNum(t?.finalR) ? Number(t.finalR) : _weightedRFromFills(t) ?? 0;
    const rSecStr = _formatR(rSec);
    const resEmoji = _resultEmoji(rSec);

    const tradeId = _shortId(t?.id);
    const link = t?.jumpUrl ? `[View Original Trade ${tradeId}](${t.jumpUrl})` : `View Original Trade ${tradeId}`;

    const block = `${idx + 1}️⃣ ${asset} ${dirWord} ${dirEmoji} | R Secured: ${rSecStr} ${resEmoji}\n🔗 ${link}`;
    items.push(block);
  });

  if (items.length) {
    lines.push('');
    lines.push(items.join('\n\n'));
  }

  // Totals
  const count = trades.length;
  const wins = trades.filter(t => {
    const r = _isNum(t?.finalR) ? Number(t.finalR) : _weightedRFromFills(t) ?? 0;
    return r > 0;
  }).length;
  const losses = count - wins;
  const netR = trades.reduce((acc, t) => {
    const r = _isNum(t?.finalR) ? Number(t.finalR) : _weightedRFromFills(t) ?? 0;
    return acc + r;
  }, 0);
  const winRate = count ? Math.round((wins / count) * 100) : 0;

  lines.push('\n---');
  lines.push('⚖️ **Monthly Totals**');
  lines.push(`- Trades Taken: ${count}`);
  lines.push(`- Wins: ${wins} | Losses: ${losses}`);
  lines.push(`- Net R Secured: ${_formatR(netR)} ${netR >= 0 ? '✅' : '❌'}`);
  lines.push(`- Win Rate: ${winRate}%`);

  return lines.join('\n');
}
// embeds.js — Text renderers (clean formatted style)

function fmt(v) {
  if (v === null || v === undefined || v === '') return '—';
  return addCommas(v);
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

  // Realized (unchanged)
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
      // computed path
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
    lines.push(`- Entry: ${fmt(s.entry)}`);
    lines.push(`- SL: ${fmt(s.sl)}`);
    lines.push(`- Status: Active 🟩`);
    if (s.jumpUrl) {
      lines.push('');
      lines.push(`[View Full Signal](${s.jumpUrl})`);
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}