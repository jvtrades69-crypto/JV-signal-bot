// index.js
const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  WebhookClient,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
} = require("discord.js");

const { v4: uuidv4 } = require("uuid");

const config = require("./config");
const store = require("./store");
const embeds = require("./embeds");

if (!config.token) {
  console.error("[ERROR] Missing DISCORD_TOKEN in config!");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ============= Rebuild Summary =============
async function rebuildSummaryMessage(client) {
  const channelId = config.currentTradesChannelId;
  if (!channelId) return;

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (e) {
    console.error("[summary] Failed to fetch current-trades channel:", e);
    return;
  }
  if (!channel || !channel.isTextBased?.()) {
    console.error("[summary] Channel is not text-based or unavailable.");
    return;
  }

  const trades = store.listActive();
  const content = embeds.renderSummaryEmbed(trades, "JV Current Active Trades 📊");

  const existingId = store.getSummaryMessageId();
  if (existingId) {
    try {
      const msg = await channel.messages.fetch(existingId);
      await msg.edit({ content });
      return;
    } catch (e) {
      if (e?.code !== 10008) {
        console.error("[summary] Edit failed:", e);
      }
    }
  }

  try {
    const sent = await channel.send({ content });
    store.setSummaryMessageId(sent.id);
  } catch (e) {
    console.error("[summary] Send failed:", e);
  }
}

// ============= Example interaction handlers =============
client.on("interactionCreate", async (interaction) => {
  try {
    // Example: trade creation
    if (interaction.isCommand() && interaction.commandName === "signal") {
      // build your modal/select here...
      await interaction.reply({ content: "Signal posted!", ephemeral: true });

      // store the trade
      const id = uuidv4();
      store.saveSignal({ id, symbol: "BTC", side: "Long", status: "active" });

      // rebuild summary
      await rebuildSummaryMessage(client);
    }

    // Example: button for TP hit
    if (interaction.isButton()) {
      const id = interaction.customId.split(":")[1]; // e.g. "tp1:tradeId"
      if (interaction.customId.startsWith("tp1")) {
        store.updateSignal(id, { status: "TP1 Hit" });
        await interaction.reply({ content: "TP1 marked as hit ✅", ephemeral: true });
        await rebuildSummaryMessage(client);
      }
    }
  } catch (err) {
    console.error("interactionCreate error:", err);
  }
});

// ============= Start bot =============
client.login(config.token);
