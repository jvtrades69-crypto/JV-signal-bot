import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  WebhookClient
} from "discord.js";
import config from "./config.js";
import {
  saveSignal,
  getSignals,
  getSignal,
  updateSignal,
  deleteSignal,
  getSummaryMessageId,
  setSummaryMessageId,
  getWebhook,
  setWebhook
} from "./store.js";
import { renderSignalEmbed, renderSummaryEmbed } from "./embeds.js";
import { v4 as uuidv4 } from "uuid";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

/* ----- Register slash command ----- */
const commands = [
  new SlashCommandBuilder()
    .setName("signal")
    .setDescription("Create a new trade signal")
    .addStringOption(o => o.setName("asset").setDescription("Asset (BTC, ETH, SOL, ...)").setRequired(true))
    .addStringOption(o =>
      o.setName("direction")
        .setDescription("Long or Short")
        .addChoices({ name: "Long", value: "Long" }, { name: "Short", value: "Short" })
        .setRequired(true))
    .addStringOption(o => o.setName("entry").setDescription("Entry price").setRequired(true))
    .addStringOption(o => o.setName("sl").setDescription("Stop Loss").setRequired(true))
    .addStringOption(o => o.setName("tp1").setDescription("TP1"))
    .addStringOption(o => o.setName("tp2").setDescription("TP2"))
    .addStringOption(o => o.setName("tp3").setDescription("TP3"))
    .addStringOption(o => o.setName("reason").setDescription("Reason (optional)"))
    .addRoleOption(o => o.setName("extra_role").setDescription("Extra role to tag (optional)"))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(config.appId, config.guildId), { body: commands });
    console.log("✅ Slash commands registered");
  } catch (e) {
    console.error("❌ Error registering commands:", e);
  }
})();

/* ----- Helpers ----- */
async function findOrCreateWebhook(channel) {
  if (!config.useWebhook) return null;
  // check cached
  const cached = await getWebhook(channel.id);
  if (cached?.id && cached?.token) {
    try { return new WebhookClient({ id: cached.id, token: cached.token }); }
    catch { /* fallthrough */ }
  }
  // find an existing one we created before in this channel
  const hooks = await channel.fetchWebhooks();
  const existing = hooks.find(h => h.name === config.brandName && h.owner?.id === client.user.id && h.token);
  if (existing) {
    await setWebhook(channel.id, { id: existing.id, token: existing.token });
    return new WebhookClient({ id: existing.id, token: existing.token });
  }
  // create a fresh one
  const created = await channel.createWebhook({
    name: config.brandName,
    avatar: config.brandAvatarUrl || undefined
  });
  await setWebhook(channel.id, { id: created.id, token: created.token });
  return new WebhookClient({ id: created.id, token: created.token });
}

async function updateSummary() {
  const all = await getSignals();
  const activeValid = all.filter(s => s.valid && !["Stopped Out ❌", "Stopped BE 🟨", "Fully Closed ✅"].includes(s.status));
  const ch = await client.channels.fetch(config.currentTradesChannelId);
  const embed = renderSummaryEmbed(activeValid, config.brandName);

  const mid = await getSummaryMessageId();
  if (mid) {
    try { const msg = await ch.messages.fetch(mid); await msg.edit({ embeds: [embed] }); return; }
    catch { /* fallthrough to send new */ }
  }
  const m = await ch.send({ embeds: [embed] });
  await setSummaryMessageId(m.id);
}

async function updateSignalMessage(signalId) {
  const s = await getSignal(signalId);
  if (!s) return;
  const ch = await client.channels.fetch(config.signalsChannelId);
  try {
    const msg = await ch.messages.fetch(s.messageId);
    await msg.edit({ embeds: [renderSignalEmbed(s, config.brandName)] });
  } catch (e) {
    console.error("⚠️ Could not update signal message:", e.message);
  }
}

async function cleanupThread(signal) {
  if (signal.threadId) {
    try {
      const thread = await client.channels.fetch(signal.threadId);
      if (thread) await thread.delete();
    } catch (e) {
      console.error("⚠️ Could not delete private thread:", e.message);
    }
    await updateSignal(signal.id, { threadId: null });
  }
}

/* ----- Ready ----- */
client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

/* ----- Interactions ----- */
client.on("interactionCreate", async (interaction) => {
  /* /signal */
  if (interaction.isChatInputCommand() && interaction.commandName === "signal") {
    if (interaction.user.id !== config.ownerId) {
      return interaction.reply({ content: "Only the owner can use this command.", ephemeral: true });
    }

    const payload = {
      id: uuidv4(),
      asset: interaction.options.getString("asset"),
      direction: interaction.options.getString("direction"),
      entry: interaction.options.getString("entry"),
      stopLoss: interaction.options.getString("sl"),
      tp1: interaction.options.getString("tp1"),
      tp2: interaction.options.getString("tp2"),
      tp3: interaction.options.getString("tp3"),
      reason: interaction.options.getString("reason"),
      status: "Active 🟩",
      valid: true,
      messageId: null,
      threadId: null,
      guildId: config.guildId,
      channelId: config.signalsChannelId,
      createdAt: Date.now()
    };

    const signalsChannel = await client.channels.fetch(config.signalsChannelId);
    const embed = renderSignalEmbed(payload, config.brandName);

    // Mentions
    const extraRole = interaction.options.getRole("extra_role");
    const contentMentions = [
      config.traderRoleId ? `<@&${config.traderRoleId}>` : null,
      extraRole ? `<@&${extraRole.id}>` : null
    ].filter(Boolean).join(" ");

    // Post via webhook (identity) or regular bot
    let message;
    if (config.useWebhook) {
      const hook = await findOrCreateWebhook(signalsChannel);
      message = await hook.send({
        content: contentMentions || undefined,
        embeds: [embed],
        allowedMentions: { parse: ["roles"] },
        wait: true
      });
    } else {
      message = await signalsChannel.send({
        content: contentMentions || undefined,
        embeds: [embed],
        allowedMentions: { parse: ["roles"] }
      });
    }

    payload.messageId = message.id;
    await saveSignal(payload);

    // Create private control thread
    const thread = await message.startThread({
      name: `${payload.asset} ${payload.direction} Controls`,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread
    });
    await thread.members.add(config.ownerId);
    await updateSignal(payload.id, { threadId: thread.id });

    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tp1_${payload.id}`).setLabel("TP1 🎯").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp2_${payload.id}`).setLabel("TP2 🎯").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`tp3_${payload.id}`).setLabel("TP3 🎯").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`runvalid_${payload.id}`).setLabel("Running (Valid) 🟩").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`runbe_${payload.id}`).setLabel("Running (BE) 🟫").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`stop_${payload.id}`).setLabel("Stopped Out ❌").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`be_${payload.id}`).setLabel("Stopped BE 🟨").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`close_${payload.id}`).setLabel("Fully Closed ✅").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`delete_${payload.id}`).setLabel("Delete 🗑").setStyle(ButtonStyle.Secondary)
    );

    await thread.send({ content: `🔒 Owner controls for **${payload.asset} | ${payload.direction}**`, components: [controls] });

    await updateSummary();
    return interaction.reply({ content: "✅ Trade signal posted.", ephemeral: true });
  }

  /* Buttons */
  if (interaction.isButton()) {
    if (interaction.user.id !== config.ownerId) {
      return interaction.reply({ content: "Only the owner can control signals.", ephemeral: true });
    }

    const [action, id] = interaction.customId.split("_");
    const signal = await getSignal(id);
    if (!signal) return interaction.reply({ content: "⚠️ Trade not found.", ephemeral: true });

    if (action === "tp1" || action === "tp2" || action === "tp3") {
      await updateSignal(id, { status: `${action.toUpperCase()} Hit 🎯` });
    } else if (action === "runvalid") {
      await updateSignal(id, { status: "Active 🟩", valid: true });
    } else if (action === "runbe") {
      await updateSignal(id, { status: "Running BE 🟫", valid: false });
    } else if (action === "stop") {
      await updateSignal(id, { status: "Stopped Out ❌", valid: false });
      await cleanupThread(signal);
    } else if (action === "be") {
      await updateSignal(id, { status: "Stopped BE 🟨", valid: false });
      await cleanupThread(signal);
    } else if (action === "close") {
      await updateSignal(id, { status: "Fully Closed ✅", valid: false });
      await cleanupThread(signal);
    } else if (action === "delete") {
      // Hard delete: remove embed, thread, db entry
      const ch = await client.channels.fetch(config.signalsChannelId);
      try { const msg = await ch.messages.fetch(signal.messageId); await msg.delete(); } catch {}
      await cleanupThread(signal);
      await deleteSignal(id);
      await updateSummary();
      return interaction.reply({ content: "🗑 Trade deleted.", ephemeral: true });
    }

    await updateSignalMessage(id);
    await updateSummary();
    return interaction.reply({ content: "✅ Signal updated.", ephemeral: true });
  }
});

/* ----- Login ----- */
client.login(config.token);
