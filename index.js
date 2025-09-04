// index.js — JV Trades signal bot with owner-only thread controls
import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import dotenv from "dotenv";
dotenv.config();

// ==== ENV ====
const {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  OWNER_ID,
  SIGNALS_CHANNEL_ID,
  BRAND_NAME = "JV Trades",
  BRAND_AVATAR_URL = "",
  USE_WEBHOOK = "false",
} = process.env;

// ==== CLIENT ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ==== REGISTER SLASH COMMAND ====
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

async function registerCommands() {
  const body = [
    {
      name: "signal",
      description: "Create a trade signal",
      options: [
        { name: "asset", description: "Asset (BTC, ETH...)", type: 3, required: true },
        {
          name: "direction",
          description: "Long or Short",
          type: 3,
          required: true,
          choices: [
            { name: "Long", value: "Long" },
            { name: "Short", value: "Short" },
          ],
        },
        { name: "entry", description: "Entry price", type: 3, required: true },
        { name: "stop", description: "Stop loss", type: 3, required: true },
        { name: "tp1", description: "Take Profit 1", type: 3, required: false },
        { name: "tp2", description: "Take Profit 2", type: 3, required: false },
        { name: "tp3", description: "Take Profit 3", type: 3, required: false },
        { name: "reason", description: "Reasoning", type: 3, required: false },
        { name: "status", description: "Status line", type: 3, required: true },
      ],
    },
  ];

  await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), {
    body,
  });
  console.log("✅ /signal registered");
}

// ==== HELPERS ====
function makeEmbed({ asset, direction, entry, stop, tp1, tp2, tp3, reason, status }) {
  const upAsset = (asset || "").toUpperCase();
  const color = direction?.toLowerCase() === "long" ? 0x00cc66 : 0xff4d4d;

  const lines = [
    "📊 **Trade Details**",
    `Entry: **${entry}**`,
    `Stop Loss: **${stop}**`,
    `TP1: **${tp1 || "-"}**`,
    `TP2: **${tp2 || "-"}**`,
    `TP3: **${tp3 || "-"}**`,
    "",
    "📝 **Reasoning**",
    reason || "-",
    "",
    "📌 **Status**",
    status,
  ];

  return new EmbedBuilder()
    .setTitle(`${upAsset} | ${direction} ${direction?.toLowerCase() === "long" ? "🟩" : "🔴"}`)
    .setColor(color)
    .setDescription(lines.join("\n"));
}

function makeControlPanel() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("tp1").setLabel("TP1 Hit").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("tp2").setLabel("TP2 Hit").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("tp3").setLabel("TP3 Hit").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("be").setLabel("Move SL → BE").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("stopped").setLabel("Stopped Out").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("close").setLabel("❌ Close Trade").setStyle(ButtonStyle.Danger)
  );
}

async function makeOwnerOnlyThread(channel, baseMessage, name) {
  let thread;
  try {
    thread = await channel.threads.create({
      name,
      startMessage: baseMessage,
      type: ChannelType.PrivateThread,
      invitable: false,
    });
  } catch {
    thread = await channel.threads.create({
      name,
      startMessage: baseMessage,
      type: ChannelType.PublicThread,
    });
    try {
      await thread.permissionOverwrites.create(thread.guild.roles.everyone, {
        ViewChannel: false,
        SendMessages: false,
      });
      await thread.permissionOverwrites.create(OWNER_ID, {
        ViewChannel: true,
        SendMessages: true,
      });
    } catch {}
  }
  return thread;
}

// ==== EVENTS ====
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand() && interaction.commandName === "signal") {
    await interaction.deferReply({ ephemeral: false });
    try {
      const data = {
        asset: interaction.options.getString("asset"),
        direction: interaction.options.getString("direction"),
        entry: interaction.options.getString("entry"),
        stop: interaction.options.getString("stop"),
        tp1: interaction.options.getString("tp1") || "",
        tp2: interaction.options.getString("tp2") || "",
        tp3: interaction.options.getString("tp3") || "",
        reason: interaction.options.getString("reason") || "",
        status: interaction.options.getString("status"),
      };

      const embed = makeEmbed(data);
      const channelId = SIGNALS_CHANNEL_ID || interaction.channelId;
      const channel = await client.channels.fetch(channelId);

      const sent = await channel.send({ embeds: [embed] });
      const thread = await makeOwnerOnlyThread(channel, sent, `${data.asset.toUpperCase()} ${data.direction} • controls`);

      // Drop control buttons inside thread
      await thread.send({ content: `Owner controls for ${data.asset.toUpperCase()} trade:`, components: [makeControlPanel()] });

      await interaction.editReply({ content: "✅ Signal posted with control thread." });
    } catch (err) {
      console.error("❌ Signal error:", err);
      try {
        await interaction.editReply({ content: "⚠️ Failed to post signal." });
      } catch {}
    }
  }

  if (interaction.isButton()) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: "⛔ Only the owner can use these controls.", ephemeral: true });
    }

    const action = interaction.customId;
    switch (action) {
      case "tp1":
      case "tp2":
      case "tp3":
        await interaction.reply({ content: `✅ ${action.toUpperCase()} hit!`, ephemeral: false });
        break;
      case "be":
        await interaction.reply({ content: "🟦 Stop Loss moved to Break Even.", ephemeral: false });
        break;
      case "stopped":
        await interaction.reply({ content: "🔴 Trade stopped out.", ephemeral: false });
        break;
      case "close":
        await interaction.message.channel.delete().catch(() => {});
        break;
    }
  }
});

// ==== BOOT ====
registerCommands()
  .then(() => client.login(DISCORD_TOKEN))
  .catch((err) => {
    console.error("❌ Startup failed:", err);
    process.exit(1);
  });