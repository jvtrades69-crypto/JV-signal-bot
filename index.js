// index.js
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import dotenv from "dotenv";
import {
  saveSignal,
  updateSignal,
  deleteSignal,
  listActive,
  getSummaryMessageId,
  setSummaryMessageId,
  getOwnerPanelMessageId,
  setOwnerPanelMessageId,
} from "./store.js";
import { renderSignalEmbed, renderSummaryEmbed } from "./embeds.js";
import {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  SIGNALS_CHANNEL_ID,
  CURRENT_TRADES_CHANNEL_ID,
  OWNER_ID,
  USE_WEBHOOK,
  BRAND_NAME,
  BRAND_AVATAR_URL,
} from "./config.js";

dotenv.config();

// ✅ Minimal intents: only Guilds
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

// Slash command definition
const signalCommand = new SlashCommandBuilder()
  .setName("signal")
  .setDescription("Post a new trade signal")
  .addStringOption((opt) =>
    opt
      .setName("asset")
      .setDescription("Trading asset (BTC, ETH, SOL, or type custom)")
      .setRequired(true)
      .addChoices(
        { name: "BTC", value: "BTC" },
        { name: "ETH", value: "ETH" },
        { name: "SOL", value: "SOL" },
        { name: "Other (custom)", value: "CUSTOM" }
      )
  )
  .addStringOption((opt) =>
    opt
      .setName("direction")
      .setDescription("Long or Short")
      .setRequired(true)
      .addChoices(
        { name: "Long", value: "Long" },
        { name: "Short", value: "Short" }
      )
  )
  .addStringOption((opt) =>
    opt.setName("entry").setDescription("Entry price").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("stop").setDescription("Stop loss").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("tp1").setDescription("Take Profit 1").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("tp2").setDescription("Take Profit 2").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("tp3").setDescription("Take Profit 3").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("reason").setDescription("Reasoning (optional)").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("role").setDescription("Role ID or @Role to tag").setRequired(false)
  );

// Register commands
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

async function registerCommands() {
  try {
    await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), {
      body: [signalCommand.toJSON()],
    });
    console.log("✅ Commands registered");
  } catch (err) {
    console.error("❌ Failed to register commands", err);
  }
}

client.on("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await registerCommands();
});

// Handle /signal command
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;
  if (interaction.commandName !== "signal") return;

  try {
    const assetChoice = interaction.options.getString("asset");
    let asset =
      assetChoice === "CUSTOM"
        ? interaction.options.getString("custom") || "Custom Asset"
        : assetChoice;

    const signal = {
      id: Date.now().toString(),
      asset,
      direction: interaction.options.getString("direction"),
      entry: interaction.options.getString("entry"),
      stop: interaction.options.getString("stop"),
      tp1: interaction.options.getString("tp1"),
      tp2: interaction.options.getString("tp2"),
      tp3: interaction.options.getString("tp3"),
      reason: interaction.options.getString("reason"),
      role: interaction.options.getString("role"),
      status: "Active",
    };

    saveSignal(signal);

    const channel = await client.channels.fetch(SIGNALS_CHANNEL_ID);
    const embed = renderSignalEmbed(signal);

    let message;
    if (USE_WEBHOOK) {
      const webhooks = await channel.fetchWebhooks();
      let webhook = webhooks.find((wh) => wh.name === BRAND_NAME);
      if (!webhook) {
        webhook = await channel.createWebhook({
          name: BRAND_NAME,
          avatar: BRAND_AVATAR_URL,
        });
      }
      message = await webhook.send({
        embeds: [embed],
        username: BRAND_NAME,
        avatarURL: BRAND_AVATAR_URL,
      });
    } else {
      message = await channel.send({ embeds: [embed] });
    }

    // Update summary
    const summaryChannel = await client.channels.fetch(
      CURRENT_TRADES_CHANNEL_ID
    );
    const trades = listActive();
    const summaryEmbed = renderSummaryEmbed(trades, "JV Current Active Trades");

    let summaryMsgId = getSummaryMessageId();
    if (summaryMsgId) {
      const oldMsg = await summaryChannel.messages.fetch(summaryMsgId);
      if (oldMsg) await oldMsg.edit({ embeds: [summaryEmbed] });
    } else {
      const msg = await summaryChannel.send({ embeds: [summaryEmbed] });
      setSummaryMessageId(msg.id);
    }

    await interaction.reply({
      content: "✅ Trade signal posted!",
      ephemeral: true,
    });
  } catch (err) {
    console.error("❌ Error handling /signal:", err);
    if (!interaction.replied) {
      await interaction.reply({
        content: "❌ Failed to post signal.",
        ephemeral: true,
      });
    }
  }
});

client.login(DISCORD_TOKEN);
