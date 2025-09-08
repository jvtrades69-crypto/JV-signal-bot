      const finalRStr = interaction.fields.getTextInputValue('final_r')?.trim();
      const hasFinalR = finalRStr !== undefined && finalRStr !== '';
      if (hasFinalR && !isNum(finalRStr)) {
        return interaction.editReply({ content: '❌ Final R must be a number if provided.' });
      }

      if (hasFinalR) {
        // override path
        signal.finalR = Number(finalRStr);
      } else {
        // normal path (price + %)
        const price = Number(interaction.fields.getTextInputValue('close_price')?.trim());
        if (!isNum(price)) return interaction.editReply({ content: '❌ Close Price must be a number.' });

        const currentPct = (signal.fills || []).reduce((acc, f) => acc + Number(f.pct || 0), 0);
        let pctStr = interaction.fields.getTextInputValue('close_pct')?.trim();
        let pct = isNum(pctStr) ? Number(pctStr) : Math.max(0, 100 - currentPct);
        if (pct < 0 || pct > 100) pct = Math.max(0, Math.min(100, pct));

        if (pct > 0) signal.fills.push({ pct, price, source: 'FINAL_CLOSE' });
      }

      const latest = signal.latestTpHit || TP_KEYS.find(k => signal[k] !== null)?.toUpperCase() || null;
      signal.status = STATUS.CLOSED;
      signal.validReentry = false;
      signal.latestTpHit = latest;

      await updateSignal(id, { fills: signal.fills, status: signal.status, validReentry: false, latestTpHit: latest, ...(hasFinalR ? { finalR: signal.finalR } : {}) });
      await editSignalMessage(signal);
      await updateSummary();
      return interaction.editReply({ content: '✅ Fully closed.' });
    }

    // Final R modal (Stopped BE / Stopped Out) — optional override
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_finalr_')) {
      await interaction.deferReply({ ephemeral: true });
      const parts = interaction.customId.split('_'); // modal_finalr_BE_<id>
      const kind = parts[2];
      const id = parts.slice(3).join('_');
      let signal = normalizeSignal(await getSignal(id));
      if (!signal) return interaction.editReply({ content: 'Signal not found.' });

      const finalRStr = interaction.fields.getTextInputValue('final_r')?.trim();
      const hasFinalR = finalRStr !== undefined && finalRStr !== '';
      if (hasFinalR && !isNum(finalRStr)) {
        return interaction.editReply({ content: '❌ Final R must be a number (e.g., 0, -1, -0.5).' });
      }

      if (hasFinalR) {
        signal.finalR = Number(finalRStr);
      } else {
        // derive price for remaining if no override; we just add a fill for completeness
        let price = null;
        if (signal.direction === DIR.LONG) {
          price = Number(signal.entry); // BE defaults to entry; OUT approximates SL
          if (kind !== 'BE') price = Number(signal.slOriginal ?? signal.sl);
        } else {
          price = Number(signal.entry);
          if (kind !== 'BE') price = Number(signal.slOriginal ?? signal.sl);
        }
        const remaining = 100 - (signal.fills || []).reduce((a, f) => a + Number(f.pct || 0), 0);
        if (remaining > 0 && isNum(price)) {
          signal.fills.push({ pct: remaining, price, source: kind === 'BE' ? 'STOP_BE' : 'STOP_OUT' });
        }
      }

      signal.status = (kind === 'BE') ? STATUS.STOPPED_BE : STATUS.STOPPED_OUT;
      signal.validReentry = false;

      await updateSignal(id, { fills: signal.fills, status: signal.status, validReentry: false, ...(hasFinalR ? { finalR: signal.finalR } : {}) });
      await editSignalMessage(signal);
      await updateSummary();
      await deleteControlThread(id);
      return interaction.editReply({ content: kind === 'BE' ? '✅ Stopped at breakeven.' : '✅ Stopped out.' });
    }

    // ===== Buttons =====
    if (interaction.isButton()) {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({ content: 'Only the owner can use these controls.', ephemeral: true });
      }
      const [action, id] = interaction.customId.split('_');
      if (!id) return interaction.reply({ content: 'Bad button ID.', ephemeral: true });

      if (action === 'upd_tpprices') return interaction.showModal(makeUpdateTPPricesModal(id));
      if (action === 'upd_plan')     return interaction.showModal(makeUpdatePlanModal(id));
      if (action === 'upd_trade')    return interaction.showModal(makeUpdateTradeInfoModal(id));
      if (action === 'upd_roles')    return interaction.showModal(makeUpdateRolesModal(id));
      if (action === 'fullclose')    return interaction.showModal(makeFullCloseModal(id));
      if (action === 'stopbe')       return interaction.showModal(makeFinalRModal(id, 'BE'));
      if (action === 'stopped')      return interaction.showModal(makeFinalRModal(id, 'OUT'));

      if (action === 'del') {
        await interaction.deferReply({ ephemeral: true });
        const sig = await getSignal(id).catch(() => null);
        if (sig) {
          await deleteSignalMessage(sig).catch(() => {});
          await deleteControlThread(id).catch(() => {});
          await deleteSignal(id).catch(() => {});
          await updateSummary().catch(() => {});
        }
        return interaction.editReply({ content: '🗑️ Signal deleted.' });
      }

      if (['tp1','tp2','tp3','tp4','tp5'].includes(action)) {
        const sig = normalizeSignal(await getSignal(id));
        if (!sig) return interaction.reply({ content: 'Signal not found.', ephemeral: true });

        const tpUpper = action.toUpperCase();
        if (sig.tpHits?.[tpUpper]) {
          return interaction.reply({ content: `${tpUpper} already recorded.`, ephemeral: true });
        }

        const planPct = sig.plan?.[tpUpper];
        const tpPrice = sig[action];

        if (isNum(planPct) && Number(planPct) > 0 && isNum(tpPrice)) {
          // avoid duplicate fills
          const already = (sig.fills || []).some(f => String(f.source).toUpperCase() === tpUpper);
          if (!already) sig.fills.push({ pct: Number(planPct), price: Number(tpPrice), source: tpUpper });
          sig.latestTpHit = tpUpper;
          sig.tpHits[tpUpper] = true;

          await updateSignal(id, { fills: sig.fills, latestTpHit: sig.latestTpHit, tpHits: sig.tpHits });
          await editSignalMessage(sig);
          await updateSummary();
          return interaction.reply({ content: `✅ ${tpUpper} executed (${planPct}%).`, ephemeral: true });
        }

        const modal = makeTPModal(id, action);
        if (isNum(planPct)) modal.components[0].components[0].setValue(String(planPct));
        return interaction.showModal(modal);
      }

      return interaction.reply({ content: 'Unknown action.', ephemeral: true });
    }
  } catch (err) {
    console.error('interaction error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Internal error.' });
      } else {
        await interaction.reply({ content: '❌ Internal error.', ephemeral: true });
      }
    } catch {}
  }
});

// ------------------------------
// Create & Save Signal
// ------------------------------
async function createSignal(payload) {
  const signal = normalizeSignal({
    id: nano(),
    asset: String(payload.asset || '').toUpperCase(),
    direction: (payload.direction || 'LONG').toUpperCase() === 'SHORT' ? DIR.SHORT : DIR.LONG,
    entry: payload.entry,
    sl: payload.sl,
    tp1: payload.tp1, tp2: payload.tp2, tp3: payload.tp3, tp4: payload.tp4, tp5: payload.tp5,
    reason: payload.reason || '',
    extraRole: payload.extraRole || '',
    plan: payload.plan || { TP1:null, TP2:null, TP3:null, TP4:null, TP5:null },
    status: STATUS.RUN_VALID,
    validReentry: true,
    latestTpHit: null,
    fills: [],
    tpHits: { TP1:false, TP2:false, TP3:false, TP4:false, TP5:false },
    finalR: null,
    messageId: null,
    jumpUrl: null
  });

  await saveSignal(signal);

  const msgId = await postSignalMessage(signal);
  signal.messageId = msgId;

  const channel = await client.channels.fetch(config.signalsChannelId);
  const msg = await channel.messages.fetch(msgId);
  signal.jumpUrl = msg.url;

  await updateSignal(signal.id, { messageId: signal.messageId, jumpUrl: signal.jumpUrl });
  await createControlThread(signal);
  await updateSummary();

  return signal;
}

client.login(config.token);