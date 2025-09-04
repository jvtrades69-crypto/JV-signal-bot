// index.js
import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { REST } from "@discordjs/rest";
import {
  saveSignal,
  getSignal,
  updateSignal,
  deleteSignal,
  listActive,
  getSummaryMessageId,
  setSummaryMessageId,
  getOwnerPanelMessageId,
  setOwnerPanelMessageId,
} from "./store.js";
import {
  renderSignalEmbed,
  renderSummaryEmbed,
  renderOwnerControls,
} from "./embeds.js";
import {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  SIGNALS_CHANNEL_ID,
  CURRENT_TRADES_CHANNEL_ID,
  OWNER_ID,
} from "./config.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

client.commands = new Collection();

const commands = [
  {
    name: "signal",
    description: "Create a new trade signal",
    options: [
      {
        type: 3,
        name: "asset",
        description: "Asset (BTC, ETH, SOL, or custom)",
        required: true,
      },
      {
        type: 3,
        name: "direction",
        description: "Trade direction (Long or Short)",
        required: true,
        choices: [
          { name: "Long", value: "Long" },
          { name: "Short", value: "Short" },
        ],
      },
      {
        type: 3,
        name: "entry",
        description: "Entry price",
        required: true,
      },
      {
        type: 3,
        name: "stop",
        description: "Stop loss",
        required: true,
      },
      {
        type: 3,
        name: "tp1",
        description: "Take Profit 1 (optional)",
        required: false,
      },
      {
        type: 3,
        name: "tp2",
        description: "Take Profit 2 (optional)",
        required: false,
      },
      {
        type: 3,
        name: "tp3",
        description: "Take Profit 3 (optional)",
        required: false,
      },
      {
        type: 3,
        name: "reason",
        description: "Reasoning (optional, multiline)",
        required: false,
      },
      {
        type: 3,
        name: "role",
        description: "Extra role to mention (@Role or ID, optional)",
        required: false,
      },
    ],
  },
];

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), {
      body: commands,
    });
    console.log("✅ Commands registered");
  } catch (err) {
    console.error("Error registering commands:", err);
  }
});

// Handle interactions
client.on("interactionCreate", async (interaction) => {
  if (interaction.isCommand()) {
    if (interaction.commandName === "signal") {
      try {
        const asset = interaction.options.getString("asset");
        const direction = interaction.options.getString("direction");
        const entry = interaction.options.getString("entry");
        const stop = interaction.options.getString("stop");
        const tp1 = interaction.options.getString("tp1");
        const tp2 = interaction.options.getString("tp2");
        const tp3 = interaction.options.getString("tp3");
        const reason = interaction.options.getString("reason");
        const role = interaction.options.getString("role");

        const signal = await saveSignal({
          asset,
          direction,
          entry,
          stop,
          tp1,
          tp2,
          tp3,
          reason,
          role,
          status: "Active 🟩",
          reentry: "Yes",
        });

        const signalsChannel = await client.channels.fetch(SIGNALS_CHANNEL_ID);
        const signalEmbed = renderSignalEmbed(signal);

        const sentMessage = await signalsChannel.send({
          content: role ? `<@&${role}>` : "",
          embeds: [signalEmbed],
        });

        await updateSummaryMessage();

        await interaction.reply({
          content: "✅ Signal created!",
          flags: 64, // replaces ephemeral: true
        });

        // Create owner-only control panel thread
        const thread = await sentMessage.startThread({
          name: `Owner Controls – ${signal.asset}`,
          autoArchiveDuration: 1440,
          reason: "Owner-only control panel",
        });

        await thread.send({
          content: "Owner panel created.",
          components: [renderOwnerControls(signal.id)],
        });

        await setOwnerPanelMessageId(signal.id, thread.id);
      } catch (err) {
        console.error("Error handling /signal:", err);
        if (!interaction.replied) {
          await interaction.reply({
            content: "❌ Failed to post signal.",
            flags: 64,
          });
        }
      }
    }
  }
});

async function updateSummaryMessage() {
  try {
    const trades = await listActive();
    const summaryEmbed = renderSummaryEmbed(trades, "JV Current Active Trades");

    const channel = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
    const msgId = await getSummaryMessageId();

    if (msgId) {
      try {
        const msg = await channel.messages.fetch(msgId);
        await msg.edit({ embeds: [summaryEmbed] });
        return;
      } catch {
        console.warn("⚠️ Old summary message not found, sending new one.");
      }
    }

    const newMsg = await channel.send({ embeds: [summaryEmbed] });
    await setSummaryMessageId(newMsg.id);
  } catch (err) {
    console.error("Error updating summary message:", err);
  }
}

client.login(DISCORD_TOKEN);
