import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import {
  saveSignal,
  getSignal,
  updateSignal,
  deleteSignal,
  listActive,
  getSummaryMessageId,
  setSummaryMessageId,
} from "./store.js";
import { v4 as uuidv4 } from "uuid";

const {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  OWNER_ID,
  SIGNALS_CHANNEL_ID,
  CURRENT_TRADES_CHANNEL_ID,
  USE_WEBHOOK,
  BRAND_NAME,
  BRAND_AVATAR_URL,
} = process.env;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

// === Register Commands ===
const commands = [
  new SlashCommandBuilder()
    .setName("signal")
    .setDescription("Post a trade signal")
    .addStringOption((opt) =>
      opt.setName("asset").setDescription("Asset (e.g. BTC)").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("direction")
        .setDescription("Long or Short")
        .setRequired(true)
        .addChoices({ name: "Long", value: "Long" }, { name: "Short", value: "Short" })
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
      opt.setName("reason").setDescription("Reasoning").setRequired(false)
    ),
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), {
  body: commands,
});

// === Bot Ready ===
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// === Handle Commands ===
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "signal") {
    const id = uuidv4();
    const signal = {
      id,
      asset: interaction.options.getString("asset").toUpperCase(),
      direction: interaction.options.getString("direction"),
      entry: interaction.options.getString("entry"),
      stop: interaction.options.getString("stop"),
      tp1: interaction.options.getString("tp1") || "-",
      tp2: interaction.options.getString("tp2") || "-",
      tp3: interaction.options.getString("tp3") || "-",
      reason: interaction.options.getString("reason") || "-",
      status: "active",
    };

    await saveSignal(signal);

    const embed = {
      title: `${signal.asset} | ${signal.direction} ${
        signal.direction === "Long" ? "🟢" : "🔴"
      }`,
      description: `📊 **Trade Details**\nEntry: ${signal.entry}\nStop Loss: ${signal.stop}\nTP1: ${signal.tp1}\nTP2: ${signal.tp2}\nTP3: ${signal.tp3}\n\n📝 **Reasoning**\n${signal.reason}\n\n📌 **Status**\nActive ✅ - trade is still running`,
      color: signal.direction === "Long" ? 0x00ff00 : 0xff0000,
    };

    const channel = await client.channels.fetch(SIGNALS_CHANNEL_ID);
    await channel.send({ embeds: [embed] });

    await interaction.reply({ content: "✅ Signal posted!", ephemeral: true });
  }
});

client.login(DISCORD_TOKEN);
