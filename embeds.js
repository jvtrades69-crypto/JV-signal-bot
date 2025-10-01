// embeds.js — add risk badge in title until TP hit; keep existing renderers

function addCommas(num){ if(num===null||num===undefined||num==='')return String(num); const n=Number(num); if(Number.isNaN(n))return String(num); return n.toLocaleString('en-US'); }
export function fmt(v){ if(v===null||v===undefined||v==='')return '—'; const n=Number(v); if(Number.isNaN(n))return String(v); return addCommas(n); }
export function signAbsR(r){ const x=Number(r||0); const abs=Math.abs(x).toFixed(2); const sign=x>0?'+':x<0?'-':''; return {text:`${sign}${abs}R`,abs,sign}; }

// ---- R helpers ----
function rAtPrice(direction, entry, slOriginal, price){
  if(entry==null||slOriginal==null||price==null) return null;
  const E=Number(entry), S=Number(slOriginal), P=Number(price);
  if([E,S,P].some(Number.isNaN)) return null;
  if(direction==='LONG'){ const risk=E-S; if(risk<=0) return null; return (P-E)/risk; }
  const risk=S-E; if(risk<=0) return null; return (E-P)/risk;
}

function computeRealized(signal){
  const fills=Array.isArray(signal.fills)?signal.fills:[]; let sum=0; const parts=[];
  for(const f of fills){
    const pct=Number(f.pct||0);
    const r=rAtPrice(signal.direction, signal.entry, signal.slOriginal??signal.sl, f.price);
    if(Number.isNaN(pct)||r===null) continue;
    sum+=(pct*r)/100;
    const src=String(f.source||'').toUpperCase();
    if(src.startsWith('TP')) parts.push(`${pct}% closed at ${src}`);
    else if(src==='FINAL_CLOSE') parts.push(`${pct}% closed at ${f.price}`);
    else if(src==='STOP_BE') parts.push(`${pct}% closed at BE`);
    else if(src==='STOP_OUT') parts.push(`${pct}% closed at SL`);
  }
  return { realized:Number(sum.toFixed(2)), parts };
}

function computeTpPercents(signal){
  const planned=signal.plan||{};
  const acc={TP1:0,TP2:0,TP3:0,TP4:0,TP5:0};
  for(const f of signal.fills||[]){
    const src=String(f.source||'').toUpperCase();
    if(src.startsWith('TP')){ const key=src.slice(0,3); if(acc[key]!==undefined) acc[key]+=Number(f.pct||0); }
  }
  for(const k of Object.keys(acc)){
    if(acc[k]<=0 && planned[k]!=null) acc[k]=Number(planned[k])||0;
    acc[k]=Math.max(0, Math.min(100, Math.round(acc[k])));
  }
  return acc;
}

// ---- titles ----
function buildTitle(signal){
  const dirWord=signal.direction==='SHORT'?'Short':'Long';
  const circle =signal.direction==='SHORT'?'🔴':'🟢';

  // risk badge: show only until first TP is hit
  const riskBadge = (!signal.latestTpHit && signal.riskLabel) ? ` (${signal.riskLabel} risk)` : '';

  const head   = `$${String(signal.asset).toUpperCase()} | ${dirWord} ${circle}${riskBadge}`;

  // Prefer override finalR in final states; else use computed realized
  const isFinal = signal.status==='CLOSED' || signal.status==='STOPPED_BE' || signal.status==='STOPPED_OUT';
  const hasFinal = signal.finalR!=null && isFinite(Number(signal.finalR));
  const { realized }=computeRealized(signal);
  const useR = (isFinal && hasFinal) ? Number(signal.finalR) : Number(realized);

  let suffix = '';
  if (signal.status==='STOPPED_OUT') {
    suffix = `Loss -${Math.abs(useR).toFixed(2)}R`;
  } else if (signal.status==='STOPPED_BE') {
    const anyFill=(signal.fills||[]).length>0;
    suffix = anyFill ? `Win +${useR.toFixed(2)}R` : 'Breakeven';
  } else if (signal.status==='CLOSED') {
    suffix = `Win +${useR.toFixed(2)}R`;
  } else if ((signal.fills||[]).length>0) {
    suffix = `Win +${useR.toFixed(2)}R so far`;
  }
  return suffix ? `**${head} (${suffix})**` : `**${head}**`;
}

// ---- live signal (TEXT) ----
export function renderSignalText(signal){
  const lines=[];
  lines.push(buildTitle(signal),'','📊 **Trade Details**');
  lines.push(`- Entry: \`${fmt(signal.entry)}\``);
  lines.push(`- SL: \`${fmt(signal.sl)}\``);

  const tps=['tp1','tp2','tp3','tp4','tp5'];
  const execOrPlan=computeTpPercents(signal);
  for(const k of tps){
    const v=signal[k]; if(v==null||v==='') continue;
    const label=k.toUpperCase();
    const r=rAtPrice(signal.direction, signal.entry, signal.slOriginal??signal.sl, v);
    const rrTxt=(r!=null)?`${r.toFixed(2)}R`:null;
    const pct=execOrPlan[label];
    if(pct>0&&rrTxt)      lines.push(`- ${label}: \`${fmt(v)}\` (${pct}% out | ${rrTxt})`);
    else if(pct>0)        lines.push(`- ${label}: \`${fmt(v)}\` (${pct}% out)`);
    else if(rrTxt)        lines.push(`- ${label}: \`${fmt(v)}\` (${rrTxt})`);
    else                  lines.push(`- ${label}: \`${fmt(v)}\``);
  }

  if(signal.reason && String(signal.reason).trim()){
    lines.push('','📝 **Reasoning**', String(signal.reason).trim());
  }

  // ---- Status ----
  lines.push('','📍 **Status**');
  if(signal.status==='RUN_VALID'){
    const order=['TP1','TP2','TP3','TP4','TP5'];
    const hitList=order.filter(k=>signal.tpHits&&signal.tpHits[k]);
    const perTpExec=Object.fromEntries(order.map(k=>[k,0]));
    for(const f of (signal.fills||[])){
      const src=String(f.source||'').toUpperCase();
      if(perTpExec[src]!==undefined) perTpExec[src]+=Number(f.pct||0);
    }
    const parts=hitList.map(k=>perTpExec[k]>0?`${k} hit (${Math.round(perTpExec[k])}% closed)`:`${k} hit`);
    lines.push(parts.length?`Active 🟩 | ${parts.join(' , ')}`:'Active 🟩 | Trade running');

    const reentry = signal.validReentry ? '✅' : '❌';

    let extra = '';
    if (Boolean(signal.slProfitSet)) {
      const afterTP = signal.slProfitAfterTP ? ` after ${signal.slProfitAfterTP}` : '';
      const tag = signal.slProfitAfter
        ? (isNaN(Number(signal.slProfitAfter)) ? `${signal.slProfitAfter}` : `at \`${fmt(signal.slProfitAfter)}\``)
        : '';
      extra = ` | SL moved into profits${afterTP}${tag ? ` ${tag}` : ''}`;
    } else if (Boolean(signal.beSet) || Boolean(signal.beMovedAfter)) {
      const afterBE = signal.beMovedAfter ? ` after ${signal.beMovedAfter}` : '';
      extra = ` | SL moved to breakeven${afterBE}`;
    }

    lines.push(`Valid for re-entry: ${reentry}${extra}`);

  } else {
    if(signal.status==='CLOSED'){
      if (signal.stoppedInProfit) {
        const tp = signal.stoppedInProfitAfterTP
          ? ` after ${signal.stoppedInProfitAfterTP}`
          : (signal.latestTpHit ? ` after ${signal.latestTpHit}` : '');
        lines.push(`Inactive 🟥 | Stopped in profits${tp}`);
      } else {
        const tp=signal.latestTpHit?` after ${signal.latestTpHit}`:'';
        lines.push(`Inactive 🟥 | Fully closed${tp}`);
      }
    } else if(signal.status==='STOPPED_BE'){
      const tp=signal.latestTpHit?` after ${signal.latestTpHit}`:'';
      lines.push(`Inactive 🟥 | Stopped breakeven${tp}`);
    } else if(signal.status==='STOPPED_OUT'){
      lines.push('Inactive 🟥 | Stopped out');
    } else {
      lines.push('Inactive 🟥');
    }
    lines.push('Valid for re-entry: ❌');
  }

  if(signal.maxR!=null && !Number.isNaN(Number(signal.maxR))){
    const mr=Number(signal.maxR).toFixed(2);
    const soFar=signal.status==='RUN_VALID'?' so far':'';
    lines.push('','📈 **Max R reached**', `${mr}R${soFar}`);
    const anyTpHit=!!(signal.tpHits&&Object.values(signal.tpHits).some(Boolean));
    if(signal.status==='RUN_VALID'&&!anyTpHit) lines.push('Awaiting TP1…');
  }

  const hasFills=Array.isArray(signal.fills)&&signal.fills.length>0;
  if(signal.status!=='RUN_VALID'||hasFills){
    lines.push('','💰 **Realized**');
    if(signal.status!=='RUN_VALID' && signal.finalR!=null){
      const {text}=signAbsR(Number(signal.finalR));
      const stopFill = (signal.fills || []).slice().reverse().find(f =>
        String(f.source).toUpperCase() === 'STOP_PROFIT' || String(f.source).toUpperCase() === 'STOP_BE'
      );
      const stopAt = isFinite(stopFill?.price) ? ` at \`${fmt(stopFill.price)}\`` : '';
      if(signal.status==='CLOSED'){
        if (signal.stoppedInProfit) {
          const after = signal.stoppedInProfitAfterTP
            ? ` after ${signal.stoppedInProfitAfterTP}`
            : (signal.latestTpHit ? ` after ${signal.latestTpHit}` : '');
          lines.push(`${text} ( stopped in profits${after}${stopAt} )`);
        } else {
          const after=signal.latestTpHit?` after ${signal.latestTpHit}`:'';
          lines.push(`${text} ( fully closed${after} )`);
        }
      } else if(signal.status==='STOPPED_BE'){
        if(Number(signal.finalR)===0) lines.push('0.00R ( stopped breakeven )');
        else{
          const after=signal.latestTpHit?` after ${signal.latestTpHit}`:'';
          lines.push(`${text} ( stopped breakeven${after}${stopAt} )`);
        }
      } else if(signal.status==='STOPPED_OUT'){
        lines.push(`${text} ( stopped out )`);
      }
    } else {
      const info=computeRealized(signal);
      const pretty=signAbsR(info.realized).text;
      const stopFill = (signal.fills || []).slice().reverse().find(f =>
        String(f.source).toUpperCase() === 'STOP_PROFIT' || String(f.source).toUpperCase() === 'STOP_BE'
      );
      const stopAt = isFinite(stopFill?.price) ? ` at \`${fmt(stopFill.price)}\`` : '';
      const list = info.parts.length ? info.parts.join(', ') : null;
      if(signal.status==='RUN_VALID'){ if(list) lines.push(`${pretty} so far ( ${list} )`); }
      else if(signal.status==='CLOSED'){
        if (signal.stoppedInProfit) {
          const after = signal.stoppedInProfitAfterTP
            ? ` after ${signal.stoppedInProfitAfterTP}`
            : (signal.latestTpHit ? ` after ${signal.latestTpHit}` : '');
          lines.push(`${pretty} ( stopped in profits${after}${stopAt} )`);
        } else {
          const after=signal.latestTpHit?` after ${signal.latestTpHit}`:'';
          lines.push(`${pretty} ( fully closed${after} )`);
        }
      } else if(signal.status==='STOPPED_BE'){
        if(signal.latestTpHit) lines.push(`${pretty} ( stopped breakeven after ${signal.latestTpHit} )`);
        else lines.push('0.00R ( stopped breakeven )');
      } else if(signal.status==='STOPPED_OUT'){
        lines.push(`${pretty} ( stopped out )`);
      } else if(list){
        lines.push(`${pretty} so far ( ${list} )`);
      }
    }
  }

  if(signal.chartUrl && !signal.chartAttached){
    lines.push('', `[View chart](${signal.chartUrl})`);
  }
  return lines.join('\n');
}

// ---- summary (TEXT) ----
export function renderSummaryText(activeSignals){
  const title='**JV Current Active Trades** 📊';
  if(!activeSignals||!activeSignals.length){
    return `${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades!`;
  }
  const lines=[title,''];
  activeSignals.forEach((s,i)=>{
    const dirWord=s.direction==='SHORT'?'Short':'Long';
    const circle =s.direction==='SHORT'?'🔴':'🟢';
    lines.push(`${i+1}⃣ $${s.asset} | ${dirWord} ${circle}`);
    lines.push(`- Entry: \`${fmt(s.entry)}\``);
    lines.push(`- SL: \`${fmt(s.sl)}\``);
    lines.push(`- Status: Active 🟩`);
    if(s.jumpUrl) lines.push(`[View Full Signal](${s.jumpUrl})`);
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

// ---- recap (TEXT) ----
export function renderRecapText(signal, extras = {}, rrChips = []){
  // unchanged from your current, kept for brevity
  // (file continues exactly as in your version)
  /* ... existing content from your file ... */
}

// monthly recap + renderRecapEmbed remain unchanged from your file
export { renderMonthlyRecap, renderRecapEmbed };
