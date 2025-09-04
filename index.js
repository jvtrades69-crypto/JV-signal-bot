// index.js
import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionsBitField,
} from "discord.js";

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

import { renderSignalEmbed, renderSummaryEmbed } from "./embeds.js";

const {
  DISCORD_TOKEN,
  APPLICATION_ID,
  GUILD_ID,
  SIGNALS_CHANNEL_ID,
  CURRENT_TRADES_CHANNEL_ID,
  OWNER_ID,
  USE_WEBHOOK,
} = process.env;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

// ---------------- Slash command registration ----------------
const signalCmd = new SlashCommandBuilder()
  .setName("signal")
  .setDescription("Post a new trade signal")
  .addStringOption((opt) =>
    opt
      .setName("asset")
      .setDescription("Asset")
      .setRequired(true)
      .addChoices(
        { name: "BTC", value: "BTC" },
        { name: "ETH", value: "ETH" },
        { name: "SOL", value: "SOL" },
        { name: "Other (type custom)", value: "OTHER" }
      )
  )
  .addStringOption((opt) =>
    opt
      .setName("custom_asset")
      .setDescription('Only when asset = "Other"')
      .setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName("direction")
      .setDescription("Long or Short")
      .setRequired(true)
      .addChoices(
        { name: "Long", value: "long" },
        { name: "Short", value: "short" }
      )
  )
  .addStringOption((opt) =>
    opt.setName("entry").setDescription("Entry price").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("stop").setDescription("Stop loss").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("tp1").setDescription("TP1 (optional)").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("tp2").setDescription("TP2 (optional)").setRequired(false)
  )
  .addStringOption((opt) =>
    opt.setName("tp3").setDescription("TP3 (optional)").setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName("reason")
      .setDescription("Reason (optional, multi-line allowed)")
      .setRequired(false)
  )
  .addStringOption((opt) =>
    opt
      .setName("mention_role")
      .setDescription("Optional: paste @Role or role ID")
      .setRequired(false)
  );

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(APPLICATION_ID, GUILD_ID), {
    body: [signalCmd.toJSON()],
  });
  console.log("Commands registered");
}

// ---------------- Owner panel buttons ----------------
const BTN = {
  TP1: "tp1_hit",
  TP2: "tp2_hit",
  TP3: "tp3_hit",
  RUN_VALID: "run_valid",
  RUN_BE: "run_be",
  STOP_OUT: "stop_out",
  STOP_BE: "stop_be",
  DELETE: "del_sig",
};

function ownerPanelRows(signalId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BTN.TP1}:${signalId}`)
        .setLabel("TP1 Hit")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${BTN.TP2}:${signalId}`)
        .setLabel("TP2 Hit")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${BTN.TP3}:${signalId}`)
        .setLabel("TP3 Hit")
        .setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BTN.RUN_VALID}:${signalId}`)
        .setLabel("Running (Valid)")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`${BTN.RUN_BE}:${signalId}`)
        .setLabel("Running (BE)")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${BTN.STOP_OUT}:${signalId}`)
        .setLabel("Stopped Out")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`${BTN.STOP_BE}:${signalId}`)
        .setLabel("Stopped BE")
        .setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${BTN.DELETE}:${signalId}`)
        .setLabel("Delete")
        .setStyle(ButtonStyle.Danger)
    ),
  ];
}

// ---------------- Utilities ----------------
async function ensureCurrentTradesMessage(channel) {
  let summaryId = await getSummaryMessageId();
  if (summaryId) {
    try {
      return await channel.messages.fetch(summaryId);
    } catch {
      // fallthrough -> recreate
    }
  }
  const msg = await channel.send({ content: "Setting up summary..." });
  await setSummaryMessageId(msg.id);
  return msg;
}

async function refreshSummary() {
  try {
    const ch = await client.channels.fetch(CURRENT_TRADES_CHANNEL_ID);
    const trades = await listActive(); // your store returns only active+valid
    const embed = renderSummaryEmbed(trades);

    const msg = await ensureCurrentTradesMessage(ch);
    await msg.edit({ content: "", embeds: [embed] });
  } catch (e) {
    console.error("refreshSummary error:", e);
  }
}

// ---------------- Interaction handling ----------------
client.on("interactionCreate", async (interaction) => {
  try {
    // Slash command
    if (interaction.isChatInputCommand() && interaction.commandName === "signal") {
      // owner-only guard (optional)
      if (OWNER_ID && interaction.user.id !== OWNER_ID) {
        await interaction.reply({ content: "Not allowed.", ephemeral: true });
        return;
      }

      const assetChoice = interaction.options.getString("asset", true);
      const customAsset = interaction.options.getString("custom_asset") || "";
      const asset = assetChoice === "OTHER" ? customAsset : assetChoice;

      const payload = {
        asset,
        direction: interaction.options.getString("direction", true),
        entry: interaction.options.getString("entry", true),
        stop: interaction.options.getString("stop", true),
        tp1: interaction.options.getString("tp1") || "",
        tp2: interaction.options.getString("tp2") || "",
        tp3: interaction.options.getString("tp3") || "",
        reason: interaction.options.getString("reason") || "",
        statusText: "Active — trade is still running",
        validReentry: "Yes",
        ownerId: interaction.user.id,
      };

      // Post signal in signals channel
      const signalsCh = await client.channels.fetch(SIGNALS_CHANNEL_ID);
      const embed = renderSignalEmbed(payload);
      const mention = interaction.options.getString("mention_role") || "";
      const msg = await signalsCh.send({
        content: mention ? `${mention}` : undefined,
        embeds: [embed],
      });

      // Save to store
      const signal = await saveSignal({
        ...payload,
        messageId: msg.id,
        channelId: msg.channelId,
        jumpUrl: msg.url,
        active: true,
        valid: true,
      });

      // Create private owner thread with buttons
      const thread = await signalsCh.threads.create({
        name: `Owner • ${signal.asset} ${signal.direction}`,
        startMessage: msg,
        type: ChannelType.PrivateThread,
        invitable: false,
      });
      await thread.members.add(OWNER_ID || interaction.user.id);

      const panelMsg = await thread.send({
        content: "Owner panel created.",
        components: ownerPanelRows(signal.id),
      });
      await setOwnerPanelMessageId(signal.id, panelMsg.id);

      // Acknowledge
      await interaction.reply({ content: "Signal posted ✅", ephemeral: true });

      // Keep summary fresh
      await refreshSummary();
      return;
    }

    // Button clicks (owner only)
    if (interaction.isButton()) {
      if (OWNER_ID && interaction.user.id !== OWNER_ID) {
        await interaction.reply({ content: "Not allowed.", ephemeral: true });
        return;
      }

      const [key, id] = interaction.customId.split(":");
      const signal = await getSignal(id);
      if (!signal) {
        await interaction.reply({ content: "Signal not found.", ephemeral: true });
        return;
      }

      const signalsCh = await client.channels.fetch(SIGNALS_CHANNEL_ID);
      const msg = await signalsCh.messages.fetch(signal.messageId);

      if (key === BTN.DELETE) {
        await deleteSignal(id);
        try { await msg.delete(); } catch {}
        await interaction.reply({ content: "Deleted.", ephemeral: true });
        await refreshSummary();
        return;
      }

      // Update status based on button
      const patch = {};
      switch (key) {
        case BTN.TP1:
          patch.statusText = "TP1 hit — still running";
          break;
        case BTN.TP2:
          patch.statusText = "TP2 hit — still running";
          break;
        case BTN.TP3:
          patch.statusText = "TP3 hit — still running";
          break;
        case BTN.RUN_VALID:
          patch.statusText = "Active — trade is still running";
          patch.validReentry = "Yes";
          patch.active = true;
          patch.valid = true;
          break;
        case BTN.RUN_BE:
          patch.statusText = "Running (BE)";
          patch.validReentry = "No";
          patch.active = true;
          patch.valid = false;
          break;
        case BTN.STOP_OUT:
          patch.statusText = "Stopped Out";
          patch.validReentry = "No";
          patch.active = false;
          patch.valid = false;
          break;
        case BTN.STOP_BE:
          patch.statusText = "Stopped BE";
          patch.validReentry = "No";
          patch.active = false;
          patch.valid = false;
          break;
      }

      const updated = await updateSignal(id, patch);
      const newEmbed = renderSignalEmbed({ ...signal, ...updated });
      await msg.edit({ embeds: [newEmbed] });

      await interaction.reply({ content: "Updated ✅", ephemeral: true });
      await refreshSummary();
    }
  } catch (err) {
    console.error("interaction error:", err);
    if (interaction.isRepliable()) {
      try {
        await interaction.reply({ content: "Failed to handle.", ephemeral: true });
      } catch {}
    }
  }
});

// ---------------- Boot ----------------
client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  await registerCommands();
  await refreshSummary();
});

client.login(DISCORD_TOKEN);
