// embeds.js — Render helpers for signal & summary embeds
// Follows the approved formatting spec (title chips, sections, wording, spacing)

import { EmbedBuilder } from 'discord.js';

// emojis
const EMO = {
  LONG: '🟢',
  SHORT: '🔴',
  ACTIVE: '🟩',
  INACTIVE: '🟥',
};

// Build the title: "ASSET | Long 🟢" or "ASSET | Short 🔴" (+ optional chip)
function buildTitle(signal, titleChip) {
  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle = signal.direction === 'SHORT' ? EMO.SHORT : EMO.LONG; // direction only
  const base = `${signal.asset} | ${dirWord} ${circle}`;
  if (titleChip?.show && titleChip.text) {
    return `${base} ( ${titleChip.text} )`;
  }
  return base;
}

// TP display rules: show "( xx% out )" only if you actually set % > 0 via TP modal
// We derive per-TP filled% from fills: [{pct, source:'TP1'|'TP2'...}]
function computeTpPercents(signal) {
  const map = { TP1: 0, TP2: 0, TP3: 0, TP4: 0, TP5: 0 };
  for (const f of signal.fills || []) {
    const src = String(f.source || '').toUpperCase();
    if (src.startsWith('TP')) {
      const key = src.slice(0, 3); // TP1..TP5
      if (map[key] !== undefined) {
        map[key] += Number(f.pct || 0);
      }
    }
  }
  // clamp to 0..100
  for (const k of Object.keys(map)) {
    const v = map[k];
    map[k] = Math.max(0, Math.min(100, Math.round(v)));
  }
  return map;
}

function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '—';
  return `${v}`;
}

// RR chips line: "TP1 0.40R | TP2 0.80R | ..."
// rrChips = [{key:'TP1', r:0.4}, ...]
function renderRRLine(rrChips) {
  if (!rrChips || !rrChips.length) return null;
  return rrChips.map(c => `${c.key} ${Number(c.r).toFixed(2)}R`).join(' | ');
}

// Status block lines per spec
function renderStatusLines(signal, slMovedToBEActive) {
  const lines = [];
  if (signal.status === 'RUN_VALID') {
    if (slMovedToBEActive) {
      const tp = signal.latestTpHit ? `${signal.latestTpHit}` : '';
      lines.push(`Active ${EMO.ACTIVE} | SL moved to breakeven${tp ? ` after ${tp}` : ''}`);
      lines.push(`Valid for re-entry: No`);
    } else if (signal.latestTpHit) {
      lines.push(`Active ${EMO.ACTIVE} | ${signal.latestTpHit} hit`);
      lines.push(`Valid for re-entry: Yes`);
    } else {
      lines.push(`Active ${EMO.ACTIVE}`);
      lines.push(`Valid for re-entry: Yes`);
    }
    return lines;
  }

  // Inactive states (always no re-entry)
  if (signal.status === 'CLOSED') {
    const tp = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
    lines.push(`Inactive ${EMO.INACTIVE} | Fully closed${tp}`);
  } else if (signal.status === 'STOPPED_BE') {
    const tp = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
    lines.push(`Inactive ${EMO.INACTIVE} | Stopped breakeven${tp}`);
  } else if (signal.status === 'STOPPED_OUT') {
    lines.push(`Inactive ${EMO.INACTIVE} | Stopped out`);
  } else {
    lines.push(`Inactive ${EMO.INACTIVE}`);
  }
  lines.push(`Valid for re-entry: No`);
  return lines;
}

// Realized section per spec
// realizedInfo = { realized: number, textParts: [ "50% closed at TP1", ... ] }
// We decide on the wording by status.
function renderRealizedLines(signal, realizedInfo) {
  const r = Number(realizedInfo.realized || 0);
  const abs = Math.abs(r).toFixed(2);
  const sign = r > 0 ? '+' : r < 0 ? '-' : '';
  const pretty = `${sign}${abs}R`;

  const listParts = realizedInfo.textParts?.length
    ? realizedInfo.textParts.join(', ')
    : null;

  const lines = [];
  if (signal.status === 'RUN_VALID') {
    // running: "... so far ( list )" only if we have fills
    if (listParts) {
      lines.push(`${pretty} so far ( ${listParts} )`);
    }
    return lines;
  }

  if (signal.status === 'CLOSED') {
    const after = signal.latestTpHit ? ` after ${signal.latestTpHit}` : '';
    lines.push(`${pretty} ( fully closed${after} )`);
    return lines;
  }

  if (signal.status === 'STOPPED_BE') {
    if (signal.latestTpHit) {
      lines.push(`${pretty} ( stopped breakeven after ${signal.latestTpHit} )`);
    } else {
      // no TP: true flat
      lines.push(`0.00R ( stopped breakeven )`);
    }
    return lines;
  }

  if (signal.status === 'STOPPED_OUT') {
    lines.push(`${pretty} ( stopped out )`);
    return lines;
  }

  // Fallback (shouldn't hit)
  if (listParts) lines.push(`${pretty} so far ( ${listParts} )`);
  return lines;
}

// Build the full description
function buildDescription(signal, rrChips, slMovedToBEActive) {
  const lines = [];

  // 📊 Trade Details
  lines.push(`📊 **Trade Details**`);
  lines.push(`Entry: ${fmtNum(signal.entry)}`);
  lines.push(`SL: ${fmtNum(signal.sl)}`);

  const tpPerc = computeTpPercents(signal);
  const TP_ORDER = ['tp1', 'tp2', 'tp3', 'tp4', 'tp5'];
  for (const key of TP_ORDER) {
    const v = signal[key];
    if (v === null || v === undefined || v === '') continue;
    const label = key.toUpperCase();
    const pct = tpPerc[label]; // 0..100 (only show if > 0)
    if (pct > 0) {
      lines.push(`${label}: ${fmtNum(v)} ( ${pct}% out )`);
    } else {
      lines.push(`${label}: ${fmtNum(v)}`);
    }
  }

  // 📐 Risk–Reward (only if we have TPs)
  const rrLine = renderRRLine(rrChips);
  if (rrLine) {
    lines.push(``);
    lines.push(`📐 **Risk–Reward**`);
    lines.push(rrLine);
  }

  // Reason (optional)
  if (signal.reason && String(signal.reason).trim().length) {
    lines.push(``);
    lines.push(`📝 **Reasoning**`);
    lines.push(String(signal.reason).trim());
  }

  // 🚦 Status
  lines.push(``);
  lines.push(`🚦 **Status**`);
  const statusLines = renderStatusLines(signal, slMovedToBEActive);
  lines.push(...statusLines);

  // 💰 Realized (only if we have anything to show by rules)
  const hasFills = Array.isArray(signal.fills) && signal.fills.length > 0;
  if (
    signal.status !== 'RUN_VALID' || // any inactive
    hasFills // active but partial fills
  ) {
    lines.push(``);
    lines.push(`💰 **Realized**`);
    // realized lines constructed in index.js computeRealized; we pass them in via caller
    // but we rebuild here by convention: index.js will pass in computed realized number through title chip, while
    // we derive text again in the embed using computeRealized there. To keep a pure renderer, we expect caller to
    // provide realizedInfo in the embed? -> We will compute in index and pass via signal._realizedInfo if present.
    const realizedInfo = signal._realizedInfo || { realized: 0, textParts: [] };
    const rl = renderRealizedLines(signal, realizedInfo);
    lines.push(...rl);
  }

  return lines.join('\n');
}

// PUBLIC: render a single signal embed
// index.js passes:
// - signal (already normalized there)
// - rrChips (array)
// - titleChip ({show, text})
// - slMovedToBEActive (boolean)
export function renderSignalEmbed(signal, rrChips, titleChip, slMovedToBEActive) {
  // compute realized here again to keep embed pure (index also uses it for title)
  const realizedInfo = computeRealizedLocal(signal);
  // stash for buildDescription
  const sigWithRealized = { ...signal, _realizedInfo: realizedInfo };

  const title = buildTitle(signal, titleChip);

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(buildDescription(sigWithRealized, rrChips, slMovedToBEActive));

  // color cue (optional): green for long, red for short
  embed.setColor(signal.direction === 'SHORT' ? 0xE03131 : 0x2F9E44);

  return embed;
}

// Compute realized locally (duplicate of logic from index, kept here for rendering independence)
function rAtPrice(direction, entry, slOriginal, price) {
  if (entry == null || slOriginal == null || price == null) return null;
  const E = Number(entry), S = Number(slOriginal), P = Number(price);
  if (Number.isNaN(E) || Number.isNaN(S) || Number.isNaN(P)) return null;

  if (direction === 'LONG') {
    const risk = E - S;
    if (risk <= 0) return null;
    return (P - E) / risk;
  } else {
    const risk = S - E;
    if (risk <= 0) return null;
    return (E - P) / risk;
  }
}

function computeRealizedLocal(signal) {
  const fills = signal.fills || [];
  if (!fills.length) return { realized: 0, textParts: [] };
  let sum = 0;
  const parts = [];
  for (const f of fills) {
    const pct = Number(f.pct || 0);
    const r = rAtPrice(signal.direction, signal.entry, signal.slOriginal ?? signal.sl, f.price);
    if (Number.isNaN(pct) || r === null) continue;
    sum += (pct * r) / 100;

    const src = String(f.source || '').toUpperCase();
    if (src.startsWith('TP')) {
      parts.push(`${pct}% closed at ${src}`);
    } else if (src === 'FINAL_CLOSE') {
      parts.push(`${pct}% closed at ${f.price}`);
    } else if (src === 'STOP_BE') {
      parts.push(`${pct}% closed at BE`);
    } else if (src === 'STOP_OUT') {
      parts.push(`${pct}% closed at SL`);
    }
  }
  return { realized: Number(sum.toFixed(2)), textParts: parts };
}

// PUBLIC: render the summary embed (active & valid trades only)
export function renderSummaryEmbed(activeSignals) {
  const title = `**JV Current Active Trades** 📊`;
  if (!activeSignals || !activeSignals.length) {
    const desc = `${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades.`;
    return new EmbedBuilder().setDescription(desc).setColor(0x5865F2);
  }

  const lines = [title, ''];
  activeSignals.forEach((s, idx) => {
    const dirWord = s.direction === 'SHORT' ? 'Short' : 'Long';
    const circle = s.direction === 'SHORT' ? EMO.SHORT : EMO.LONG;
    const jump = s.jumpUrl ? ` — ${s.jumpUrl}` : '';
    lines.push(`${idx + 1}. ${s.asset} ${dirWord} ${circle}${jump}`);
    lines.push(`   Entry: ${fmtNum(s.entry)}`);
    lines.push(`   SL: ${fmtNum(s.sl)}`);
    lines.push('');
  });

  const embed = new EmbedBuilder()
    .setDescription(lines.join('\n').trimEnd())
    .setColor(0x5865F2);

  return embed;
}
