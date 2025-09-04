// index.js
import 'dotenv/config';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Routes,
  REST,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import { renderSignalEmbed } from "./embeds.js";

// ---------- config from env ----------
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const SIGNALS_CHANNEL_ID = process.env.SIGNALS_CHANNEL_ID;
const OWNER_ID = process.env.OWNER_ID;
const USE_WEBHOOK = (process.env.USE_WEBHOOK || "true").toLowerCase() === "true";
const BRAND_NAME = process.env.BRAND_NAME || "JV Trades";
const BRAND_AVATAR_URL = process.env.BRAND_AVATAR_URL || "";

// ---------- client ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message],
});

// ---------- register /signal (once at startup) ----------
const rest = new REST({ version: "10" }).setToken(TOKEN);
async function registerCommands() {
  const commands = [
    {
      name: "signal",
      description: "Create a new trade card",
      options: [
        { name: "asset", description: "Asset (e.g., BTC, ETH, SOL…)", type: 3, required: true },
        { name: "direction", description: "Long or Short", type: 3, required: true, choices: [
          { name: "Long", value: "Long" }, { name: "Short", value: "Short" }
        ]},
        { name: "entry", description: "Entry", type: 3, required: true },
        { name: "stoploss", description: "Stop loss", type: 3, required: true },
        { name: "tp1", description: "Take Profit 1", type: 3, required: false },
        { name: "tp2", description: "Take Profit 2", type: 3, required: false },
        { name: "tp3", description: "Take Profit 3", type: 3, required: false },
        { name: "reason", description: "Reason (optional)", type: 3, required: false },
        { name: "valid_reentry", description: "Valid for re-entry? (Yes/No)", type: 3, required: false,
          choices: [{ name: "Yes", value: "Yes" }, { name: "No", value: "No"}]
        },
      ],
    },
  ];
  await rest.put(Routes.applicationGuildCommands(process.env.APPLICATION_ID, GUILD_ID), { body: commands });
}

// ---------- webhook helper ----------
async function getOrCreateWebhook(channel) {
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find(h => h.name === BRAND_NAME);
  if (!hook) {
    hook = await channel.createWebhook({
      name: BRAND_NAME,
      avatar: BRAND_AVATAR_URL || null
    });
  }
  return hook;
}

// ---------- ready ----------
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try { await registerCommands(); } catch (e) { console.error("Register commands failed:", e); }
});

// ---------- interaction ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "signal") return;

  // Only owner can use
  if (interaction.user.id !== OWNER_ID) {
    await interaction.reply({ content: "Only the owner can use this command.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const payload = {
    asset: interaction.options.getString("asset") || "",
    direction: interaction.options.getString("direction") || "Long",
    entry: interaction.options.getString("entry"),
    stopLoss: interaction.options.getString("stoploss"),
    tp1: interaction.options.getString("tp1"),
    tp2: interaction.options.getString("tp2"),
    tp3: interaction.options.getString("tp3"),
    reason: interaction.options.getString("reason") || "",
    validForReentry: (interaction.options.getString("valid_reentry") || "Yes") === "Yes",
    status: "active",
  };

  const signalsChannel = await client.channels.fetch(SIGNALS_CHANNEL_ID);
  if (!signalsChannel) {
    await interaction.editReply("Signals channel not found. Check SIGNALS_CHANNEL_ID.");
    return;
  }

  const embed = renderSignalEmbed(payload);

  // post via webhook to mimic your identity
  let sentMsg;
  try {
    if (USE_WEBHOOK) {
      const hook = await getOrCreateWebhook(signalsChannel);
      const webhookResult = await hook.send({
        username: BRAND_NAME,
        avatarURL: BRAND_AVATAR_URL || undefined,
        embeds: [embed],
        // You can add content mentions here if needed e.g. content: "<@&ROLEID>"
      });
      // webhookResult is the sent message object
      sentMsg = webhookResult;
    } else {
      sentMsg = await signalsChannel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error("Send failed:", err);
    await interaction.editReply("Failed to send the signal (check webhook/channel permissions).");
    return;
  }

  // Create the private control thread, even for webhook messages
  try {
    const thread = await signalsChannel.threads.create({
      name: `${payload.asset.toUpperCase()} ${payload.direction.toUpperCase()} Controls`,
      startMessage: sentMsg.id,
      type: ChannelType.PrivateThread,
      invitable: false,
      autoArchiveDuration: 1440
    });
    await thread.members.add(OWNER_ID);

    // (Optional) owner controls row – just a placeholder here
    const controls = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("tp1").setLabel("TP1 Hit").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("tp2").setLabel("TP2 Hit").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("tp3").setLabel("TP3 Hit").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("close").setLabel("Fully Closed").setStyle(ButtonStyle.Danger),
    );
    await thread.send({ content: "🔒 Owner controls", components: [controls] });
  } catch (e) {
    console.error("Thread creation failed:", e);
  }

  await interaction.editReply("Signal posted ✅");
});

// (You likely have button handlers already; omitted for brevity.)

client.login(TOKEN);