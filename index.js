// index.js — JV Trades signal bot (single file)
import { Client, GatewayIntentBits, Partials, REST, Routes, EmbedBuilder, ChannelType, PermissionFlagsBits } from "discord.js";
import dotenv from "dotenv";
dotenv.config();

// ==== ENV ====
const {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  OWNER_ID,
  SIGNALS_CHANNEL_ID,           // optional: where you normally run /signal; if blank we just use interaction channel
  BRAND_NAME = "JV Trades",
  BRAND_AVATAR_URL = "",
  USE_WEBHOOK = "false",
} = process.env;

// ==== CLIENT ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // Toggle ON in Dev Portal → Bot → Privileged Gateway Intents
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
        { name: "direction", description: "Long or Short", type: 3, required: true, choices: [
          { name: "Long", value: "Long" }, { name: "Short", value: "Short" }
        ]},
        { name: "entry", description: "Entry price", type: 3, required: true },
        { name: "stop", description: "Stop loss", type: 3, required: true },
        { name: "tp1", description: "Take Profit 1", type: 3, required: false },
        { name: "tp2", description: "Take Profit 2", type: 3, required: false },
        { name: "tp3", description: "Take Profit 3", type: 3, required: false },
        { name: "reason", description: "Reasoning (optional)", type: 3, required: false },
        { name: "status", description: "Status line (e.g. Active 🟩 — trade is still running; Valid for re-entry: Yes)", type: 3, required: true },
      ]
    }
  ];

  await rest.put(
    Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID),
    { body }
  );
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
    status
  ];

  return new EmbedBuilder()
    .setTitle(`${upAsset} | ${direction} ${direction?.toLowerCase() === "long" ? "🟩" : "🔴"}`)
    .setColor(color)
    .setDescription(lines.join("\n"));
}

async function postWithIdentity(channel, payload) {
  // If webhook identity is requested, post via channel webhook (create one if needed)
  if (String(USE_WEBHOOK).toLowerCase() === "true") {
    try {
      const hooks = await channel.fetchWebhooks();
      let hook = hooks.find(h => h.name === BRAND_NAME) || null;
      if (!hook) hook = await channel.createWebhook({ name: BRAND_NAME, avatar: BRAND_AVATAR_URL || null });
      return hook.send(payload);
    } catch (e) {
      console.warn("⚠️ Webhook failed, falling back to normal send:", e.message);
    }
  }
  // fallback: normal send as the bot
  return channel.send(payload);
}

async function makeOwnerOnlyThread(channel, baseMessage, name) {
  // Try private thread if supported
  try {
    if (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement) {
      // Private threads are supported on text channels if the server setting allows it
      return await channel.threads.create({
        name,
        startMessage: baseMessage,
        type: ChannelType.PrivateThread,
        invitable: false
      });
    }
  } catch (e) {
    // fall through to public with locked perms
  }

  // Fallback: public thread, then lock perms to owner only
  const thread = await channel.threads.create({
    name,
    startMessage: baseMessage,
    type: ChannelType.PublicThread
  });

  try {
    // Deny everyone, then allow OWNER_ID to view/send
    await thread.permissionOverwrites.create(thread.guild.roles.everyone, {
      ViewChannel: false,
      SendMessages: false
    });
    await thread.permissionOverwrites.create(OWNER_ID, {
      ViewChannel: true,
      SendMessages: true,
      SendMessagesInThreads: true,
      CreatePublicThreads: true,
      CreatePrivateThreads: true
    });
  } catch (e) {
    console.warn("⚠️ Could not tighten thread perms (needs Manage Threads perms):", e.message);
  }

  return thread;
}

// ==== EVENTS ====
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "signal") return;

  // ACK early so Discord doesn't time out
  await interaction.deferReply({ ephemeral: false });

  try {
    const asset     = interaction.options.getString("asset");
    const direction = interaction.options.getString("direction");
    const entry     = interaction.options.getString("entry");
    const stop      = interaction.options.getString("stop");
    const tp1       = interaction.options.getString("tp1") || "";
    const tp2       = interaction.options.getString("tp2") || "";
    const tp3       = interaction.options.getString("tp3") || "";
    const reason    = interaction.options.getString("reason") || "";
    const status    = interaction.options.getString("status");

    const embed = makeEmbed({ asset, direction, entry, stop, tp1, tp2, tp3, reason, status });

    // choose where to post: fixed channel or the channel the command ran in
    const channelId = SIGNALS_CHANNEL_ID || interaction.channelId;
    const channel = await client.channels.fetch(channelId);

    // Post the main card (using webhook if enabled)
    const sent = await postWithIdentity(channel, { embeds: [embed] });

    // Create a per-trade thread (owner-only when possible)
    const threadName = `${asset?.toUpperCase()} ${direction} • controls`;
    const thread = await makeOwnerOnlyThread(channel, sent, threadName);

    // Link back to thread under the card
    await sent.reply({ content: `🔗 **Owner controls:** ${thread.toString()}` });

    // Finalize the slash command response
    await interaction.editReply({ content: "✅ Signal posted." });
  } catch (err) {
    console.error("❌ /signal error:", err);
    try {
      await interaction.editReply({ content: "⚠️ Failed to post signal." });
    } catch {}
  }
});

// ==== BOOT ====
registerCommands()
  .then(() => client.login(DISCORD_TOKEN))
  .catch(err => {
    console.error("❌ Failed to register commands/login:", err);
    process.exit(1);
  });