const {
  Client,
  GatewayIntentBits,
  Partials,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");
const { v4: uuidv4 } = require("uuid");

const config = require("./config");     // must export: token, guildId, currentTradesChannelId, mentionRoleId, ownerUserId
const store  = require("./store");      // helpers implemented below
const embeds = require("./embeds");     // formatting helpers implemented below

if (!config.token) {
  console.error("[ERROR] Missing DISCORD_TOKEN / token in config.js");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ------------------------------------------------------------
   Summary message (single message in CURRENT_TRADES_CHANNEL_ID)
------------------------------------------------------------- */
async function rebuildSummaryMessage() {
  const channelId = config.currentTradesChannelId;
  if (!channelId) return;

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (e) {
    console.error("[summary] Cannot fetch summary channel:", e);
    return;
  }
  if (!channel?.isTextBased?.()) {
    console.error("[summary] Channel is not text-based");
    return;
  }

  const trades = store.listActive(); // only active & valid for re-entry
  const content = embeds.renderSummaryEmbed(trades, "JV Current Active Trades 📊");

  const existingId = store.getSummaryMessageId();
  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ content });
      return;
    } catch (e) {
      // fall-through to sending a fresh one if old message is gone
      if (e?.code !== 10008) console.warn("[summary] Edit failed, sending new:", e?.message);
    }
  }

  try {
    const sent = await channel.send({ content });
    store.setSummaryMessageId(sent.id);
  } catch (e) {
    console.error("[summary] Send failed:", e);
  }
}

/* ------------------------------------------------------------
   Helpers
------------------------------------------------------------- */
function isOwner(userId) {
  return String(userId) === String(config.ownerUserId);
}

function statusBadge(signal) {
  const green = "🟩";
  const red   = "🟥";
  const active = signal.active !== false;
  const be    = signal.status === "stopped-be";
  const stopped = signal.status === "stopped";
  if (stopped) return `${red}`;
  if (be)      return `${green}`; // still active but BE
  return `${green}`;
}

async function postSignalCard(interaction, signal) {
  const roleMention = config.mentionRoleId ? `<@&${config.mentionRoleId}>` : "";
  const content = embeds.renderSignalEmbed(signal, roleMention);

  // Post main card where slash command was used
  const sent = await interaction.channel.send({ content });

  // Create private owner controls thread on that message
  let thread;
  try {
    thread = await sent.startThread({
      name: `controls-${signal.id.slice(0, 6)}`,
      autoArchiveDuration: 1440,
      reason: "Owner controls",
      type: ChannelType.PrivateThread,
    });
  } catch (e) {
    console.warn("[thread] Private thread creation failed, trying public:", e?.message);
    thread = await sent.startThread({
      name: `controls-${signal.id.slice(0, 6)}`,
      autoArchiveDuration: 1440,
      reason: "Owner controls",
    });
  }

  // Post control panel (only owner should see; thread is private)
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tp1:${signal.id}`).setLabel("🎯 TP1 Hit").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`tp2:${signal.id}`).setLabel("🎯 TP2 Hit").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`tp3:${signal.id}`).setLabel("🎯 TP3 Hit").setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`run-valid:${signal.id}`).setLabel("Running (Valid)").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`run-be:${signal.id}`).setLabel("Running (BE)").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`stopped:${signal.id}`).setLabel("Stopped Out").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`stopped-be:${signal.id}`).setLabel("Stopped BE").setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`delete:${signal.id}`).setLabel("Delete").setStyle(ButtonStyle.Danger)
  );

  await thread.send({ content: "**Your controls:**", components: [row1, row2, row3] });

  // Persist linkage for updates & deletions
  store.updateSignal(signal.id, {
    messageId: sent.id,
    channelId: sent.channelId,
    threadId: thread?.id || null,
  });

  await rebuildSummaryMessage();
}

async function updateMainCard(signal) {
  if (!signal.messageId || !signal.channelId) return;
  try {
    const channel = await client.channels.fetch(signal.channelId);
    const msg = await channel.messages.fetch(signal.messageId);
    const roleMention = config.mentionRoleId ? `<@&${config.mentionRoleId}>` : "";
    const newContent = embeds.renderSignalEmbed(signal, roleMention);
    await msg.edit({ content: newContent });
  } catch (e) {
    console.warn("[updateMainCard] edit failed:", e?.message);
  }
}

/* ------------------------------------------------------------
   Slash command: /signal  (opens modal)
------------------------------------------------------------- */
client.on("interactionCreate", async (interaction) => {
  try {
    /* ----- slash command ----- */
    if (interaction.isChatInputCommand && interaction.commandName === "signal") {
      if (!isOwner(interaction.user.id)) {
        await interaction.reply({ content: "Only the owner can post signals.", ephemeral: true });
        return;
      }

      const modal = new ModalBuilder()
        .setCustomId("signal_modal")
        .setTitle("Create Trade Signal");

      const asset = new TextInputBuilder()
        .setCustomId("asset")
        .setLabel("Asset (BTC/ETH/SOL or custom)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const side = new TextInputBuilder()
        .setCustomId("side")
        .setLabel("Side (Long/Short)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const entry = new TextInputBuilder()
        .setCustomId("entry")
        .setLabel("Entry (e.g., 108,201 or range 108,100–108,300)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const sl = new TextInputBuilder()
        .setCustomId("sl")
        .setLabel("SL (e.g., 100,201)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Reason (optional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(asset),
        new ActionRowBuilder().addComponents(side),
        new ActionRowBuilder().addComponents(entry),
        new ActionRowBuilder().addComponents(sl),
        new ActionRowBuilder().addComponents(reason),
      );

      await interaction.showModal(modal);
      return;
    }

    /* ----- modal submission -> create signal ----- */
    if (interaction.isModalSubmit() && interaction.customId === "signal_modal") {
      if (!isOwner(interaction.user.id)) {
        await interaction.reply({ content: "Only the owner can post signals.", ephemeral: true });
        return;
      }

      const id = uuidv4();
      const asset  = interaction.fields.getTextInputValue("asset")?.trim() || "BTC";
      const side   = interaction.fields.getTextInputValue("side")?.trim();
      const entry  = interaction.fields.getTextInputValue("entry")?.trim();
      const sl     = interaction.fields.getTextInputValue("sl")?.trim();
      const reason = interaction.fields.getTextInputValue("reason")?.trim();

      const signal = {
        id,
        authorId: interaction.user.id,
        asset,
        side,
        entry,
        sl,
        tp1: null,
        tp2: null,
        tp3: null,
        reason: reason || null,
        active: true,
        status: "running-valid",      // running-valid | running-be | stopped | stopped-be
        validForReentry: true,        // controls appearance in summary
        createdAt: Date.now(),
      };

      store.saveSignal(signal);
      await interaction.reply({ content: "Signal posted!", ephemeral: true });
      await postSignalCard(interaction, signal);
      return;
    }

    /* ----- button controls in private thread ----- */
    if (interaction.isButton()) {
      const [action, id] = interaction.customId.split(":");
      const s = store.getSignal(id);
      if (!s) {
        await interaction.reply({ content: "Signal not found.", ephemeral: true });
        return;
      }
      if (!isOwner(interaction.user.id)) {
        await interaction.reply({ content: "Only the owner can use these controls.", ephemeral: true });
        return;
      }

      if (action === "tp1" || action === "tp2" || action === "tp3") {
        // Just append a note in status line; you can extend to record percentages etc.
        s.lastTp = action.toUpperCase();
        store.updateSignal(s.id, s);
        await updateMainCard(s);
        await interaction.reply({ content: `${action.toUpperCase()} marked ✅`, ephemeral: true });
        return;
      }

      if (action === "run-valid") {
        store.updateSignal(s.id, { status: "running-valid", active: true, validForReentry: true });
        await updateMainCard(store.getSignal(s.id));
        await rebuildSummaryMessage();
        await interaction.reply({ content: "Marked Running (Valid).", ephemeral: true });
        return;
      }
      if (action === "run-be") {
        store.updateSignal(s.id, { status: "running-be", active: true, validForReentry: false });
        await updateMainCard(store.getSignal(s.id));
        await rebuildSummaryMessage();
        await interaction.reply({ content: "Marked Running (BE).", ephemeral: true });
        return;
      }
      if (action === "stopped") {
        store.updateSignal(s.id, { status: "stopped", active: false, validForReentry: false });
        await updateMainCard(store.getSignal(s.id));
        await rebuildSummaryMessage();
        await interaction.reply({ content: "Marked Stopped Out.", ephemeral: true });
        return;
      }
      if (action === "stopped-be") {
        store.updateSignal(s.id, { status: "stopped-be", active: false, validForReentry: false });
        await updateMainCard(store.getSignal(s.id));
        await rebuildSummaryMessage();
        await interaction.reply({ content: "Marked Stopped (BE).", ephemeral: true });
        return;
      }
      if (action === "delete") {
        // delete main message
        if (s.channelId && s.messageId) {
          try {
            const ch = await client.channels.fetch(s.channelId);
            const m  = await ch.messages.fetch(s.messageId);
            await m.delete();
          } catch (e) { /* ignore */ }
        }
        // delete thread
        if (s.threadId) {
          try {
            const th = await client.channels.fetch(s.threadId);
            await th.delete();
          } catch (e) { /* ignore */ }
        }
        store.deleteSignal(s.id);
        await rebuildSummaryMessage();
        await interaction.reply({ content: "Signal deleted.", ephemeral: true });
        return;
      }
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
    if (interaction?.replied === false && interaction?.deferred === false) {
      try { await interaction.reply({ content: "An error occurred.", ephemeral: true }); } catch {}
    }
  }
});

client.login(config.token);
