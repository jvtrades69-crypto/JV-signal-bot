// embeds.js — text + embed renderers

// Notes (display-only):
// final: 1.34
// peak: 2.40 | max: 2.40
// entry: 115928
// sl: 115000
// TP1: Buyside liquidity
// tp: TP1 | 1.22R (50% closed) ✅ | Buyside liquidity

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
  const head   = `$${String(signal.asset).toUpperCase()} | ${dirWord} ${circle}`;

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

    // Profit vs BE (mutually exclusive). Profit takes precedence.
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

  }else{
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
    }else if(signal.status==='STOPPED_BE'){
      const tp=signal.latestTpHit?` after ${signal.latestTpHit}`:'';
      lines.push(`Inactive 🟥 | Stopped breakeven${tp}`);
    }else if(signal.status==='STOPPED_OUT'){
      lines.push('Inactive 🟥 | Stopped out');
    }else{
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
      }else if(signal.status==='STOPPED_BE'){
        if(Number(signal.finalR)===0) lines.push('0.00R ( stopped breakeven )');
        else{
          const after=signal.latestTpHit?` after ${signal.latestTpHit}`:'';
          lines.push(`${text} ( stopped breakeven${after}${stopAt} )`);
        }
      }else if(signal.status==='STOPPED_OUT'){
        lines.push(`${text} ( stopped out )`);
      }
    }else{
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
      }else if(signal.status==='STOPPED_BE'){
        if(signal.latestTpHit) lines.push(`${pretty} ( stopped breakeven after ${signal.latestTpHit} )`);
        else lines.push('0.00R ( stopped breakeven )');
      }else if(signal.status==='STOPPED_OUT'){
        lines.push(`${pretty} ( stopped out )`);
      }else if(list){
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
  const dirWord=signal.direction==='SHORT'?'Short':'Long';
  const circle =signal.direction==='SHORT'?'🔴':'🟢';

  const reasonLines=extras.reasonLines||[];
  const confLines=extras.confLines||[];
  let notesLines=extras.notesLines||[];
  const showBasics = extras.showBasics === true;

  let overrideFinal=null, overridePeak=null, entryOv=null, slOv=null;
  const tpCaptions={}, tpManual=[];
  const parsedNotes=[];
  for(const raw of notesLines){
    const line=String(raw).trim();
    const mFinal=line.match(/^final\s*:\s*([+-]?\d+(?:\.\d+)?)(?:\s*R)?\s*$/i);
    const mPeak =line.match(/^(peak|max)\s*:\s*([+-]?\d+(?:\.\d+)?)(?:\s*R)?\s*$/i);
    const mTPcap=line.match(/^TP([1-5])\s*:\s*(.+)$/i);
    const mEntry=line.match(/^entry\s*:\s*(.+)$/i);
    const mSL   =line.match(/^sl\s*:\s*(.+)$/i);
    const mTPman=line.match(/^tp\s*:\s*(.+)$/i);
    if(mFinal){ overrideFinal=Number(mFinal[1]); continue; }
    if(mPeak ){ overridePeak =Number(mPeak[2]);  continue; }
    if(mTPcap){ tpCaptions[`TP${mTPcap[1]}`]=mTPcap[2].trim(); continue; }
    if(mEntry){ entryOv=mEntry[1].trim(); continue; }
    if(mSL)   { slOv   =mSL[1].trim();    continue; }
    if(mTPman){ tpManual.push(mTPman[1].trim()); continue; }
    parsedNotes.push(line);
  }
  notesLines=parsedNotes;

  const entryShown=entryOv!=null&&entryOv!==''?entryOv:signal.entry;
  const slShown   =slOv   !=null&&slOv   !==''?slOv   :signal.sl;

  const { realized }=computeRealized(signal);
  const computedFinal=(signal.status!=='RUN_VALID'&&signal.finalR!=null)?Number(signal.finalR):realized;
  const final=(overrideFinal!=null&&!Number.isNaN(overrideFinal))?overrideFinal:computedFinal;

  const finalChip=signAbsR(final).text;
  const finalMark=final>0?'✅':final<0?'❌':'➖';

  const lines=[];
  const tpPerc=computeTpPercents(signal);
  const tpHits=signal.tpHits||{};
  let tpLines=[];
  if(tpManual.length){ tpLines=tpManual.map(s=>`- ${s}`); }
  else{
    for(let i=1;i<=5;i++){
      const key=`TP${i}`, k=`tp${i}`;
      if(!tpHits[key]) continue;
      const v=signal[k];
      const r=rAtPrice(signal.direction, signal.entry, signal.slOriginal??signal.sl, v);
      const pct=tpPerc[key]>0?` (${tpPerc[key]}% closed)`:''; const caption=tpCaptions[key]?` | ${tpCaptions[key]}`:'';
      tpLines.push(`- ${key} | ${r!=null?`${r.toFixed(2)}R`:'—'}${pct} ✅${caption}`);
    }
  }

  const hasStoredMax=(signal.maxR!=null&&!Number.isNaN(Number(signal.maxR)));
  const showPeakLine=(overridePeak!=null&&!Number.isNaN(Number(overridePeak)))||hasStoredMax;
  const peakR=(overridePeak!=null&&!Number.isNaN(Number(overridePeak)))?Number(overridePeak):hasStoredMax?Number(signal.maxR):null;

  lines.push(`**$${String(signal.asset).toUpperCase()} | Trade Recap ${finalChip} ${finalMark} (${dirWord}) ${circle}**`,'');
  if(reasonLines.length){ lines.push('📍 **Trade Reason**', ...reasonLines.map(ln=>`- ${ln}`),''); }
  if(confLines.length)  { lines.push('📊 **Entry Confluences**', ...confLines.map(ln=>`- ${ln}`),''); }

  lines.push('🎯 **Take Profit**');
  if(tpLines.length) lines.push(...tpLines);
  else{
    if(signal.status==='STOPPED_OUT')     lines.push('- **None** (Stopped Out ❌ before TP1)');
    else if(signal.status==='STOPPED_BE') lines.push('- **None** (Breakeven 🟨 before TP1)');
    else                                  lines.push('- **None yet**');
  }

  lines.push('', '⚖️ **Results**', `- Final: ${finalChip} ${finalMark}`);
  if(showPeakLine) lines.push(`- Peak R: ${Number(peakR).toFixed(2)}R`, '');
  else lines.push('');

  if (showBasics) {
    lines.push('📊 **Basics**', `- Entry: \`${fmt(entryShown)}\``, `- SL: \`${fmt(slShown)}\``, '');
  }

  if(parsedNotes.length){ lines.push('🧠 **Post-Mortem (What I learned)**', ...notesLines.map(ln=>`- ${ln}`),''); }
  if(signal.jumpUrl) lines.push(`🔗 [View Original Trade](${signal.jumpUrl})`);
  return lines.join('\n');
}

/* ------------------------ NEW: Monthly recap ------------------------ */
export function renderMonthlyRecap(signals = [], year, monthIdx){
  const monthName = new Date(Date.UTC(year, monthIdx ?? 0, 1))
    .toLocaleString('en-US', { month: 'long' });
  const title = `📊 **Monthly Trade Recap — ${monthName} ${year}**`;

  if (!Array.isArray(signals) || signals.length === 0) {
    return `${title}\nNo trades this month.`;
  }

  let wins = 0, losses = 0, be = 0, net = 0;

  const chip = (r) => {
    const v = Number(r || 0);
    const emo = v > 0 ? '✅' : v < 0 ? '❌' : '➖';
    const sign = v > 0 ? '+' : v < 0 ? '' : '';
    return `${sign}${v.toFixed(2)}R ${emo}`;
  };

  const lines = [title, ''];

  for (const s of signals) {
    const { realized } = computeRealized(s);
    const r = s.finalR != null ? Number(s.finalR) : realized;
    net += r;
    if (r > 0) wins++; else if (r < 0) losses++; else be++;

    const dir = s.direction === 'SHORT' ? 'Short 🔴' : 'Long 🟢';
    lines.push(`**$${s.asset} | ${chip(r)} (${dir})**`);
  }

  lines.splice(1, 0,
    `**Total trades:** ${signals.length} | Wins: ${wins} | Losses: ${losses} | BE: ${be}`,
    `**Net Result:** ${chip(net)}`,
    ''
  );

  return lines.join('\n');
}

/* ----------------------- NEW: Recap embed builder ----------------------- */
export function renderRecapEmbed(
  signal,
  {
    roleId,
    imageUrl,
    attachmentName,   // if provided, use attachment://
    attachmentUrl,    // link to chart
    chartUrl,         // override link target if provided
    notesLines = [],
    beColor = { win: 0x2ecc71, be: 0xf1c40f, loss: 0xe74c3c }
  } = {}
){
  const realized = computeRealized(signal).realized;
  const r = signal.finalR != null ? Number(signal.finalR) : realized;

  const state = r > 0 ? 'WIN' : r < 0 ? 'LOSS' : 'BE';
  const color = state === 'WIN' ? beColor.win : state === 'LOSS' ? beColor.loss : beColor.be;

  const dirWord = signal.direction === 'SHORT' ? 'Short' : 'Long';
  const circle  = signal.direction === 'SHORT' ? '🔴' : '🟢';

  const title = `${String(signal.asset).toUpperCase()} — Trade Recap (${dirWord}) ${circle}`;
  const fields = [
    { name: 'Result', value: `R: ${r.toFixed(2)}`, inline: true },
  ];

  const link = chartUrl || attachmentUrl || imageUrl || signal.chartUrl || null;
  if (signal.jumpUrl) fields.push({ name: 'Signal', value: `[View original signal](${signal.jumpUrl})` });
  if (link)          fields.push({ name: 'Chart',  value: `[View chart](${link})` });

  const embed = { title, description: '', fields, color };

  if (attachmentName)      embed.image = { url: `attachment://${attachmentName}` };
  else if (imageUrl)       embed.image = { url: imageUrl };
  else if (attachmentUrl)  embed.image = { url: attachmentUrl };

  return {
    content: roleId ? `<@&${roleId}>` : undefined,
    embeds: [embed],
    allowedMentions: roleId ? { roles: [roleId] } : undefined
  };
}
