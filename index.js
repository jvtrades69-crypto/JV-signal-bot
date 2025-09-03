import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from "discord.js";
import config from "./config.js";
import {
  saveSignal,
  getSignals,
  updateSignal,
  deleteSignal,
  getSummaryMessageId,
  setSummaryMessageId
} from "./store.js";
import { renderSignalEmbed, renderSummaryEmbed } from "./embeds.js";
import { v4 as uuidv4 } from "uuid";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// ====== Register Slash Commands ======
const commands = [
  new SlashCommandBuilder()
    .setName("signal")
    .setDescription("Create a new trade signal")
    .addStringOption(opt =>
      opt.setName("asset").setDescription("Asset (BTC, ETH, SOL...)").setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName("direction")
        .setDescription("Long or Short")
        .addChoices({ name: "Long", value: "Long" }, { name: "Short", value: "Short" })
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("entry").setDescription("Entry price").setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName("sl").setDescription("Stop Loss").setRequired(true)
    )
    .addStringOption(opt => opt.setName("tp1").setDescription("TP1"))
    .addStringOption(opt => opt.setName("tp2").setDescription("TP2"))
    .addStringOption(opt => opt.setName("tp3").setDescription("TP3"))
    .addStringOption(opt => opt.setName("reason").setDescription("Reason for trade"))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands("YOUR_APP_ID", config.guildId), {
      body: commands
    });
    console.log("✅ Slash commands registered");
  } catch (err) {
    console.error("Error registering commands:", err);
  }
})();

// ====== Ready ======
client.on("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ====== Interaction Handling ======
client.on("interactionCreate", async interaction => {
  // ---- Slash Command ----
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "signal") {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({
          content: "Only the owner can use this command.",
          ephemeral: true
        });
      }

      const signal = {
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
        threadId: null
      };

      saveSignal(signal);

      const signalsChannel = await client.channels.fetch(config.signalsChannelId);
      const embed = renderSignalEmbed(signal);

      // Post main trade signal (public, no buttons)
      const message = await signalsChannel.send({ embeds: [embed] });

      // Create private thread for owner-only controls
      const thread = await message.startThread({
        name: `${signal.asset} ${signal.direction} Controls`,
        autoArchiveDuration: 1440, // 24h
        type: ChannelType.PrivateThread
      });

      // Add owner only
      try {
        await thread.members.add(config.ownerId);
      } catch (e) {
        console.error("⚠️ Could not add owner to thread:", e);
      }

      // Save thread ID for cleanup later
      updateSignal(signal.id, { threadId: thread.id });

      // Owner control buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`tp1_${signal.id}`)
          .setLabel("TP1 🎯")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`tp2_${signal.id}`)
          .setLabel("TP2 🎯")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`tp3_${signal.id}`)
          .setLabel("TP3 🎯")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`stop_${signal.id}`)
          .setLabel("Stopped Out ❌")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`be_${signal.id}`)
          .setLabel("Stopped BE 🟨")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`close_${signal.id}`)
          .setLabel("Fully Closed ✅")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`delete_${signal.id}`)
          .setLabel("Delete 🗑")
          .setStyle(ButtonStyle.Secondary)
      );

      await thread.send({
        content: `🔒 Owner Controls for **${signal.asset} | ${signal.direction}**`,
        components: [row]
      });

      await updateSummary();
      return interaction.reply({ content: "✅ Trade signal posted.", ephemeral: true });
    }
  }

  // ---- Button Controls ----
  if (interaction.isButton()) {
    if (interaction.user.id !== config.ownerId) {
      return interaction.reply({
        content: "Only the owner can control signals.",
        ephemeral: true
      });
    }

    const [action, signalId] = interaction.customId.split("_");
    const signals = getSignals();
    const signal = signals.find(s => s.id === signalId);
    if (!signal) return interaction.reply({ content: "⚠️ Trade not found.", ephemeral: true });

    // ====== Status updates ======
    if (action === "tp1" || action === "tp2" || action === "tp3") {
      updateSignal(signalId, { status: `${action.toUpperCase()} Hit 🎯` });
    } else if (action === "stop") {
      updateSignal(signalId, { status: "Stopped Out ❌" });
      await cleanupThread(signal);
    } else if (action === "be") {
      updateSignal(signalId, { status: "Stopped BE 🟨" });
      await cleanupThread(signal);
    } else if (action === "close") {
      updateSignal(signalId, { status: "Fully Closed ✅" });
      await cleanupThread(signal);
    } else if (action === "delete") {
      // Hard delete: remove embed, thread, DB entry
      await deleteTrade(signal);
      return interaction.reply({ content: "🗑 Trade deleted.", ephemeral: true });
    }

    // ====== Update main embed ======
    try {
      const signalsChannel = await client.channels.fetch(config.signalsChannelId);
      const messages = await signalsChannel.messages.fetch({ limit: 50 });
      const target = messages.find(
        m => m.embeds.length > 0 && m.embeds[0].title?.includes(signal.asset)
      );
      if (target) {
        await target.edit({ embeds: [renderSignalEmbed(signal)] });
      }
    } catch (e) {
      console.error("Error updating main embed:", e);
    }

    await updateSummary();
    return interaction.reply({ content: "✅ Signal updated.", ephemeral: true });
  }
});

// ====== Helpers ======
async function cleanupThread(signal) {
  // Remove from summary but keep embed visible
  await updateSummary();

  // Delete private thread if exists
  if (signal.threadId) {
    try {
      const thread = await client.channels.fetch(signal.threadId);
      if (thread) await thread.delete();
    } catch (e) {
      console.error("⚠️ Could not delete thread:", e);
    }
    updateSignal(signal.id, { threadId: null });
  }
}

async function deleteTrade(signal) {
  // Delete DB entry
  deleteSignal(signal.id);

  // Delete public embed
  try {
    const signalsChannel = await client.channels.fetch(config.signalsChannelId);
    const messages = await signalsChannel.messages.fetch({ limit: 50 });
    const target = messages.find(
      m => m.embeds.length > 0 && m.embeds[0].title?.includes(signal.asset)
    );
    if (target) await target.delete();
  } catch (e) {
    console.error("⚠️ Could not delete trade embed:", e);
  }

  // Delete private thread
  if (signal.threadId) {
    try {
      const thread = await client.channels.fetch(signal.threadId);
      if (thread) await thread.delete();
    } catch (e) {
      console.error("⚠️ Could not delete thread:", e);
    }
  }

  await updateSummary();
}

// ====== Update Summary ======
async function updateSummary() {
  const trades = getSignals().filter(
    s => !["Stopped Out ❌", "Stopped BE 🟨", "Fully Closed ✅"].includes(s.status)
  );
  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const embed = renderSummaryEmbed(trades);

  const summaryMessageId = getSummaryMessageId();
  if (summaryMessageId) {
    try {
      const msg = await channel.messages.fetch(summaryMessageId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch (e) {
      console.log("⚠️ Could not edit summary message, sending new one...");
    }
  }

  const newMsg = await channel.send({ embeds: [embed] });
  setSummaryMessageId(newMsg.id);
}

client.login(config.token);
